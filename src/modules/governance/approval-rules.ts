import "server-only";
import Decimal from "decimal.js";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { type DbOrTx, db } from "@/db/client";
import { APPROVAL_DOCUMENT_TYPES, APPROVAL_THRESHOLD_BASES, approvalRules, sites } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { PERMISSIONS, ROLE_BUNDLES } from "@/lib/permissions";
import { getSetting, type SettingKey } from "@/lib/settings";
import { type ApprovalDocumentType, type ApprovalRuleSpec, BASE_APPROVE_PERMISSION, CONFIGURABLE_SOD_TYPES, DEFAULT_APPROVAL_RULES, type ThresholdBasis } from "./default-rules";
import { requireReauthentication } from "./reauth";

/**
 * Approval rules (US-1-14 AC2–AC4, docs/permissions-matrix.md §5.2, docs/data-model.md §7 item 8).
 * One shared evaluation for every module: site-specific rules beat organization-wide ones, matching
 * rows are ordered by step, each step needs `required_count` distinct users holding one of the
 * roles (any role when none is listed) and the permission at the record's site; escalation roles
 * may approve after `escalation_after_hours`; no matching rule → the base `.approve` permission
 * suffices (one approver).
 */

/** A basis value: a number, `unbounded` (unknown value treated as above every bound) or true for credit_check_failed. */
export type BasisValue = Decimal.Value | "unbounded" | boolean;
export type ApprovalBasis = Partial<Record<ThresholdBasis, BasisValue>>;

export type EvaluatedStep = {
  step: number;
  label: string;
  ruleIds: string[];
  /** Any of these roles may decide; empty = any role holding the permission. */
  roleCodes: string[];
  /** Permission the approver must hold (rule permission, else the record type's base `.approve`). */
  permission: string | null;
  requiredCount: number;
  posterMayEqualApprover: boolean;
  escalation: { roleCodes: string[]; afterHours: number } | null;
};

export type ApprovalEvaluation = {
  documentType: ApprovalDocumentType;
  siteId: string | null;
  on: string;
  /** rules = stored rows; defaults = built-in defaults (no rows for this type); none = no rule matched. */
  source: "rules" | "defaults" | "none";
  steps: EvaluatedStep[];
  ruleIds: string[];
};

type RuleRow = ApprovalRuleSpec & { id: string | null; siteId: string | null };

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function matches(r: RuleRow, basis: ApprovalBasis): boolean {
  if (r.thresholdBasis === "always") return true;
  const v = basis[r.thresholdBasis];
  if (v === undefined || v === null) return false;
  if (r.thresholdBasis === "credit_check_failed") return v === true;
  if (v === "unbounded") return r.maxValue === null;
  if (typeof v === "boolean") return false;
  const x = new Decimal(v);
  if (r.minValue !== null && !x.gt(r.minValue)) return false;
  if (r.maxValue !== null && !x.lte(r.maxValue)) return false;
  return true;
}

async function loadRules(q: DbOrTx, organizationId: string, documentType: ApprovalDocumentType) {
  return q
    .select()
    .from(approvalRules)
    .where(and(eq(approvalRules.organizationId, organizationId), eq(approvalRules.documentType, documentType)))
    .orderBy(asc(approvalRules.step), asc(approvalRules.createdAt));
}

function toRow(r: typeof approvalRules.$inferSelect): RuleRow {
  return {
    id: r.id,
    siteId: r.siteId,
    documentType: r.documentType as ApprovalDocumentType,
    label: r.label,
    thresholdBasis: r.thresholdBasis as ThresholdBasis,
    minValue: r.minValue,
    maxValue: r.maxValue,
    currency: r.currency,
    step: r.step,
    requiredCount: r.requiredCount,
    requiredRoleCodes: r.requiredRoleCodes ?? [],
    requiredPermissionCode: r.requiredPermissionCode,
    posterMayEqualApprover: r.posterMayEqualApprover,
    escalationRoleCodes: r.escalationRoleCodes ?? null,
    escalationAfterHours: r.escalationAfterHours,
    source: r.source ?? "",
  };
}

/**
 * Pure evaluation (no audit). `on` is the business date of the record (injected clock in tests).
 */
export async function evaluateApprovalRules(
  q: DbOrTx,
  organizationId: string,
  input: { documentType: ApprovalDocumentType; siteId?: string | null; basis?: ApprovalBasis; on?: Date },
): Promise<ApprovalEvaluation> {
  const on = isoDay(input.on ?? new Date());
  const siteId = input.siteId ?? null;
  const stored = await loadRules(q, organizationId, input.documentType);
  let candidates: RuleRow[];
  let source: ApprovalEvaluation["source"];
  if (stored.length === 0) {
    candidates = DEFAULT_APPROVAL_RULES.filter((r) => r.documentType === input.documentType).map((r) => ({ ...r, id: null, siteId: null }));
    source = "defaults";
  } else {
    const effective = stored.filter((r) => !r.deletedAt && r.effectiveFrom <= on && (r.effectiveTo === null || r.effectiveTo > on)).map(toRow);
    const siteRules = siteId ? effective.filter((r) => r.siteId === siteId) : [];
    candidates = siteRules.length > 0 ? siteRules : effective.filter((r) => r.siteId === null);
    source = "rules";
  }
  const matched = candidates.filter((r) => matches(r, input.basis ?? {}));
  const base = BASE_APPROVE_PERMISSION[input.documentType] ?? null;
  const byStep = new Map<number, EvaluatedStep>();
  for (const r of matched) {
    const cur = byStep.get(r.step);
    const escalation = r.escalationRoleCodes && r.escalationAfterHours ? { roleCodes: r.escalationRoleCodes, afterHours: r.escalationAfterHours } : null;
    if (!cur) {
      byStep.set(r.step, {
        step: r.step,
        label: r.label,
        ruleIds: r.id ? [r.id] : [],
        roleCodes: [...r.requiredRoleCodes],
        permission: r.requiredPermissionCode ?? base,
        requiredCount: r.requiredCount,
        posterMayEqualApprover: r.posterMayEqualApprover,
        escalation,
      });
    } else {
      // Several rows for one step: any listed role may decide, the strictest count applies.
      if (r.id) cur.ruleIds.push(r.id);
      cur.roleCodes = cur.roleCodes.length === 0 || r.requiredRoleCodes.length === 0 ? [] : [...new Set([...cur.roleCodes, ...r.requiredRoleCodes])];
      cur.requiredCount = Math.max(cur.requiredCount, r.requiredCount);
      cur.posterMayEqualApprover = cur.posterMayEqualApprover && r.posterMayEqualApprover;
      cur.escalation ??= escalation;
    }
  }
  const steps = [...byStep.values()].sort((a, b) => a.step - b.step);
  return { documentType: input.documentType, siteId, on, source: steps.length === 0 ? "none" : source, steps, ruleIds: steps.flatMap((s) => s.ruleIds) };
}

/** Evaluation plus the audit event `platform.approval_rule.evaluated` with the rule ids (AC2). */
export async function evaluateApprovalRulesAudited(
  tx: DbOrTx,
  ctx: AuthContext,
  input: { documentType: ApprovalDocumentType; siteId?: string | null; basis?: ApprovalBasis; on?: Date; recordId: string; recordNumber?: string | null },
): Promise<ApprovalEvaluation> {
  const ev = await evaluateApprovalRules(tx, ctx.organizationId, input);
  await audit(tx, ctx, {
    action: "platform.approval_rule.evaluated",
    entityType: input.documentType,
    entityId: input.recordId,
    entityNumber: input.recordNumber ?? null,
    siteId: input.siteId ?? null,
    after: {
      source: ev.source,
      ruleIds: ev.ruleIds,
      steps: ev.steps.map((s) => ({ step: s.step, roles: s.roleCodes, permission: s.permission, requiredCount: s.requiredCount })),
      basis: Object.fromEntries(Object.entries(input.basis ?? {}).map(([k, v]) => [k, typeof v === "object" ? String(v) : v])),
      on: ev.on,
    },
  });
  return ev;
}

/**
 * Roles allowed to decide a step now: the step roles, plus the escalation roles once the step has
 * waited `afterHours` since `pendingSince` (AC2). Empty = any role holding the permission.
 */
export function rolesAllowedNow(step: EvaluatedStep, pendingSince: Date | null, now = new Date()): string[] {
  if (step.roleCodes.length === 0) return [];
  if (step.escalation && pendingSince && now.getTime() - pendingSince.getTime() >= step.escalation.afterHours * 3_600_000) {
    return [...new Set([...step.roleCodes, ...step.escalation.roleCodes])];
  }
  return step.roleCodes;
}

/** Whether `ctx` may decide the step (permission + role; separation of duties is checked by the caller). */
export function canDecideEvaluatedStep(ctx: AuthContext, step: EvaluatedStep, pendingSince: Date | null = null, now = new Date()): boolean {
  if (step.permission && !ctx.can(step.permission as never)) return false;
  const roles = rolesAllowedNow(step, pendingSince, now);
  return roles.length === 0 || ctx.hasAnyRole(roles);
}

/**
 * AC4: whether separation of duties applies to a record type. Mandatory types always; the
 * configurable `approval?` types (A-PM-14) follow setting `approvals.sod.<type>` (default true).
 */
export async function sodRequired(q: DbOrTx, organizationId: string, recordType: string): Promise<boolean> {
  if (!(CONFIGURABLE_SOD_TYPES as readonly string[]).includes(recordType)) return true;
  return getSetting(q, organizationId, `approvals.sod.${recordType}` as SettingKey) as Promise<boolean>;
}

/* ------------------------------------------------------------------ admin (owner) */

const KNOWN_ROLES = Object.keys(ROLE_BUNDLES);
const decimalString = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,6})?$/, "Enter a number (up to 6 decimals).");

export const ApprovalRuleInput = z
  .object({
    documentType: z.enum(APPROVAL_DOCUMENT_TYPES),
    siteId: z.uuid().nullable(),
    label: z.string().trim().min(3, "Give the step a short name.").max(120),
    thresholdBasis: z.enum(APPROVAL_THRESHOLD_BASES),
    minValue: decimalString.nullable(),
    maxValue: decimalString.nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    step: z.number().int().min(1).max(5),
    requiredCount: z.number().int().min(1).max(5),
    requiredRoleCodes: z.array(z.string().refine((r) => KNOWN_ROLES.includes(r), "Unknown role.")).max(6),
    requiredPermissionCode: z
      .string()
      .refine((p) => (PERMISSIONS as readonly string[]).includes(p) && p.endsWith(".approve"), "Choose an approve permission.")
      .nullable(),
    posterMayEqualApprover: z.boolean(),
    escalationRoleCodes: z.array(z.string().refine((r) => KNOWN_ROLES.includes(r), "Unknown role.")).max(6).nullable(),
    escalationAfterHours: z.number().int().min(1).max(24 * 30).nullable(),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().nullable(),
    source: z.string().trim().max(200).nullable(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.thresholdBasis === "always" && (v.minValue !== null || v.maxValue !== null)) c.addIssue({ code: "custom", path: ["minValue"], message: "A rule that always applies has no bounds." });
    if (v.minValue !== null && v.maxValue !== null && new Decimal(v.minValue).gt(v.maxValue)) c.addIssue({ code: "custom", path: ["maxValue"], message: "The upper bound must not be below the lower bound." });
    if (v.requiredRoleCodes.length === 0 && !v.requiredPermissionCode) c.addIssue({ code: "custom", path: ["requiredRoleCodes"], message: "Name at least one role or a permission." });
    if ((v.escalationRoleCodes?.length ? 1 : 0) !== (v.escalationAfterHours ? 1 : 0)) c.addIssue({ code: "custom", path: ["escalationAfterHours"], message: "Escalation needs both a role and a delay." });
    if (v.effectiveTo && v.effectiveTo <= v.effectiveFrom) c.addIssue({ code: "custom", path: ["effectiveTo"], message: "The end date must be after the start date." });
    if (v.thresholdBasis === "amount" && !v.currency) c.addIssue({ code: "custom", path: ["currency"], message: "Amounts need a currency." });
  });
export type ApprovalRuleInput = z.infer<typeof ApprovalRuleInput>;

function snapshot(r: typeof approvalRules.$inferSelect) {
  const { createdAt: _c, updatedAt: _u, ...rest } = r;
  return rest;
}

/**
 * The first write for a record type materialises the built-in defaults as rows, so editing one
 * rule never silently drops the other default steps of that type.
 */
async function materialiseDefaults(tx: DbOrTx, ctx: AuthContext, documentType: ApprovalDocumentType) {
  const existing = await loadRules(tx, ctx.organizationId, documentType);
  if (existing.length > 0) return;
  const defaults = DEFAULT_APPROVAL_RULES.filter((r) => r.documentType === documentType);
  if (defaults.length) await tx.insert(approvalRules).values(defaults.map((d) => ({ ...d, organizationId: ctx.organizationId, createdBy: ctx.userId, updatedBy: ctx.userId })));
}

async function assertSite(ctx: AuthContext, siteId: string | null) {
  if (!siteId) return;
  const [s] = await db.select({ id: sites.id }).from(sites).where(and(eq(sites.id, siteId), eq(sites.organizationId, ctx.organizationId))).limit(1);
  if (!s) throw new DomainError("not_found", "Site not found.");
}

/** Lists rules (stored rows; plus the built-in defaults of types that have none). */
export async function listApprovalRules(ctx: AuthContext) {
  ctx.require("platform.approval_rule.view");
  const rows = await db.select().from(approvalRules).where(eq(approvalRules.organizationId, ctx.organizationId)).orderBy(asc(approvalRules.documentType), asc(approvalRules.step), asc(approvalRules.createdAt));
  const visible = rows.filter((r) => !r.siteId || ctx.allowedSiteIds.includes(r.siteId));
  const typesWithRows = new Set(rows.map((r) => r.documentType));
  const defaults = DEFAULT_APPROVAL_RULES.filter((d) => !typesWithRows.has(d.documentType));
  return { rules: visible, defaults };
}

export async function getApprovalRule(ctx: AuthContext, id: string) {
  ctx.require("platform.approval_rule.view");
  if (!z.uuid().safeParse(id).success) throw new DomainError("not_found", "Rule not found.");
  const [r] = await db.select().from(approvalRules).where(and(eq(approvalRules.id, id), eq(approvalRules.organizationId, ctx.organizationId))).limit(1);
  if (!r || (r.siteId && !ctx.allowedSiteIds.includes(r.siteId))) throw new DomainError("not_found", "Rule not found.");
  return r;
}

/** Owner-only (restricted): creates a rule. Re-authentication required; audit `platform.approval_rule.changed`. */
export async function createApprovalRule(ctx: AuthContext, raw: unknown, reauth: { password: string; reason: string }) {
  ctx.require("platform.approval_rule.admin");
  const input = ApprovalRuleInput.parse(raw);
  if (input.siteId) ctx.requireSite(input.siteId);
  await assertSite(ctx, input.siteId);
  await requireReauthentication(ctx, reauth.password, "platform.approval_rule.admin");
  const reason = reauth.reason.trim();
  if (reason.length < 3) throw new DomainError("validation", "Say why the rule changes (at least 3 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    await materialiseDefaults(tx, ctx, input.documentType);
    const [r] = await tx.insert(approvalRules).values({ ...input, organizationId: ctx.organizationId, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
    await audit(tx, ctx, { action: "platform.approval_rule.changed", entityType: "approval_rule", entityId: r.id, siteId: r.siteId, reason, before: null, after: snapshot(r) });
    return r;
  });
}

/** Owner-only (restricted): edits a rule with optimistic concurrency (`version`). */
export async function updateApprovalRule(ctx: AuthContext, id: string, raw: unknown, expectedVersion: number, reauth: { password: string; reason: string }) {
  ctx.require("platform.approval_rule.admin");
  const input = ApprovalRuleInput.parse(raw);
  if (input.siteId) ctx.requireSite(input.siteId);
  await assertSite(ctx, input.siteId);
  const current = await getApprovalRule(ctx, id);
  if (current.deletedAt) throw new DomainError("state", "This rule was removed; create a new one instead.");
  if (current.documentType !== input.documentType) throw new DomainError("validation", "A rule's record type cannot change; create a new rule.", { field: "documentType" });
  await requireReauthentication(ctx, reauth.password, "platform.approval_rule.admin");
  const reason = reauth.reason.trim();
  if (reason.length < 3) throw new DomainError("validation", "Say why the rule changes (at least 3 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(approvalRules).where(eq(approvalRules.id, id)).for("update").limit(1);
    if (before.version !== expectedVersion) throw new DomainError("conflict", "Someone else changed this rule meanwhile. Reload and try again.");
    const [after] = await tx
      .update(approvalRules)
      .set({ ...input, version: before.version + 1, updatedBy: ctx.userId, updatedAt: new Date() })
      .where(eq(approvalRules.id, id))
      .returning();
    await audit(tx, ctx, { action: "platform.approval_rule.changed", entityType: "approval_rule", entityId: id, siteId: after.siteId, reason, before: snapshot(before), after: snapshot(after) });
    return after;
  });
}

/** Owner-only (restricted): soft-deletes a rule (kept for history). */
export async function removeApprovalRule(ctx: AuthContext, id: string, reauth: { password: string; reason: string }) {
  ctx.require("platform.approval_rule.admin");
  const current = await getApprovalRule(ctx, id);
  if (current.deletedAt) throw new DomainError("state", "This rule was already removed.");
  await requireReauthentication(ctx, reauth.password, "platform.approval_rule.admin");
  const reason = reauth.reason.trim();
  if (reason.length < 3) throw new DomainError("validation", "Say why the rule is removed (at least 3 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const [after] = await tx.update(approvalRules).set({ deletedAt: new Date(), deletedBy: ctx.userId, version: current.version + 1, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(approvalRules.id, id)).returning();
    await audit(tx, ctx, { action: "platform.approval_rule.changed", entityType: "approval_rule", entityId: id, siteId: after.siteId, reason, before: snapshot(current), after: { deletedAt: after.deletedAt } });
    return after;
  });
}

/** Effective rows for a type and day, for the admin "preview" (no audit). */
export async function previewApprovalRules(ctx: AuthContext, input: { documentType: ApprovalDocumentType; siteId: string | null; basis: ApprovalBasis; on?: Date }) {
  ctx.require("platform.approval_rule.view");
  if (input.siteId) ctx.requireSite(input.siteId);
  return evaluateApprovalRules(db, ctx.organizationId, input);
}

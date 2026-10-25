import "server-only";
import { and, asc, desc, eq, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { numberingRuleVersions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import {
  DOCUMENT_TYPES,
  type DocumentType,
  NUMBERING_DEFAULTS,
  type ResetPeriod,
  effectiveNumberingRule,
  formatNumber,
  isDocumentType,
  listNumberingCounters,
  numberingBusinessDate,
  peekNextNumber,
  validateNumberingRule,
} from "@/lib/numbering";
import { auditDenied, requireReauthentication } from "./reauth";

/**
 * Numbering rules admin (US-1-19 AC1–AC2, docs/data-model.md §9). A pattern change is a new
 * version submitted by one holder of `platform.numbering_rule.admin` and approved by a different
 * one (A-DM-25) with an effective date of today or later; approval closes the previous approved
 * version on that date (approved ranges never overlap) and writes `platform.numbering_rule.changed`.
 * Numbers already issued keep the pattern that produced them; the running sequence of the period
 * continues (`continue_sequence_on_version`).
 */

export async function listNumberingAdmin(ctx: AuthContext) {
  ctx.require("platform.numbering_rule.view");
  const [versions, counters] = await Promise.all([
    db
      .select({ v: numberingRuleVersions, submitter: users.displayName })
      .from(numberingRuleVersions)
      .innerJoin(users, eq(users.id, numberingRuleVersions.submittedBy))
      .where(and(eq(numberingRuleVersions.organizationId, ctx.organizationId), isNull(numberingRuleVersions.siteId)))
      .orderBy(asc(numberingRuleVersions.documentType), desc(numberingRuleVersions.versionNo)),
    listNumberingCounters(db, ctx.organizationId),
  ]);
  const out = [];
  for (const t of DOCUMENT_TYPES) {
    const rule = await effectiveNumberingRule(db, ctx.organizationId, t);
    let expected: string | null = null;
    if (!rule.isGapless) expected = await peekNextNumber(db, ctx.organizationId, t);
    out.push({
      documentType: t,
      rule,
      example: formatNumber(rule, 1),
      expectedNext: expected,
      versions: versions.filter((x) => x.v.documentType === t).map((x) => ({ ...x.v, submitterName: x.submitter })),
      counters: counters.filter((c) => c.documentType === t).slice(0, 4),
    });
  }
  return out;
}

export const NumberingVersionInput = z
  .object({
    documentType: z.string().refine(isDocumentType, "Unknown document type."),
    prefix: z.string().trim().toUpperCase(),
    pattern: z.string().trim().toUpperCase(),
    resetPeriod: z.enum(["never", "yearly", "monthly", "daily"]),
    sequenceWidth: z.coerce.number().int(),
    isGapless: z.boolean(),
    effectiveFrom: z.iso.date(),
    changeSummary: z.string().trim().min(3, "Say what changes and why (at least 3 characters).").max(500),
  })
  .strict();

/** Submits a new version (status submitted). Re-authentication required (restricted permission). */
export async function submitNumberingRuleVersion(ctx: AuthContext, raw: z.input<typeof NumberingVersionInput>, password: string | null | undefined) {
  ctx.require("platform.numbering_rule.admin");
  const input = NumberingVersionInput.parse(raw);
  const fieldErrors = validateNumberingRule({ ...input, resetPeriod: input.resetPeriod as ResetPeriod, scope: "organization" });
  if (Object.keys(fieldErrors).length) throw new DomainError("validation", Object.values(fieldErrors)[0], { fieldErrors });
  if (input.effectiveFrom < numberingBusinessDate()) throw new DomainError("validation", "The effective date cannot be in the past.", { field: "effectiveFrom" });
  await requireReauthentication(ctx, password, "platform.numbering_rule.admin");
  const t = input.documentType as DocumentType;
  return db.transaction(async (tx) => {
    const [{ n }] = await tx
      .select({ n: max(numberingRuleVersions.versionNo) })
      .from(numberingRuleVersions)
      .where(and(eq(numberingRuleVersions.organizationId, ctx.organizationId), eq(numberingRuleVersions.documentType, t), isNull(numberingRuleVersions.siteId)));
    const [v] = await tx
      .insert(numberingRuleVersions)
      .values({
        organizationId: ctx.organizationId,
        documentType: t,
        scope: "organization",
        versionNo: Number(n ?? 0) + 1,
        status: "submitted",
        prefix: input.prefix,
        pattern: input.pattern,
        resetPeriod: input.resetPeriod,
        sequenceWidth: input.sequenceWidth,
        isGapless: input.isGapless,
        effectiveFrom: input.effectiveFrom,
        changeSummary: input.changeSummary,
        submittedBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, { action: "platform.numbering_rule.submitted", entityType: "numbering_rule", entityId: v.id, entityNumber: `${t} v${v.versionNo}`, siteId: null, reason: input.changeSummary, after: { pattern: v.pattern, prefix: v.prefix, resetPeriod: v.resetPeriod, sequenceWidth: v.sequenceWidth, effectiveFrom: v.effectiveFrom } });
    return v;
  });
}

async function lockVersion(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], ctx: AuthContext, id: string) {
  if (!z.uuid().safeParse(id).success) throw new DomainError("not_found", "Numbering rule version not found.");
  const [v] = await tx
    .select()
    .from(numberingRuleVersions)
    .where(and(eq(numberingRuleVersions.id, id), eq(numberingRuleVersions.organizationId, ctx.organizationId)))
    .for("update")
    .limit(1);
  if (!v) throw new DomainError("not_found", "Numbering rule version not found.");
  return v;
}

/** A different holder of the permission approves; the previous approved version closes on the effective date. */
export async function approveNumberingRuleVersion(ctx: AuthContext, id: string, password: string | null | undefined) {
  ctx.require("platform.numbering_rule.admin");
  const peek = await db.transaction((tx) => lockVersion(tx, ctx, id));
  if (ctx.sodBlocks(peek.submittedBy === ctx.userId, "SEPARATION_OF_DUTIES: you submitted this numbering change, so a different administrator must approve it.")) {
    await auditDenied(ctx, { permission: "platform.numbering_rule.admin", entityType: "numbering_rule", entityId: peek.id, rule: "authz.sod.approve_own" });
    throw new DomainError("separation_of_duties", "SEPARATION_OF_DUTIES: you submitted this numbering change, so a different administrator must approve it.", ctx.refusalDetails());
  }
  await requireReauthentication(ctx, password, "platform.numbering_rule.admin");
  return db.transaction(async (tx) => {
    const v = await lockVersion(tx, ctx, id);
    if (v.status !== "submitted") throw new DomainError("state", `This version is ${v.status}; only a submitted version can be approved.`);
    if (v.effectiveFrom < numberingBusinessDate()) throw new DomainError("conflict", "The effective date of this version has passed. Reject it and submit a new version.");
    const t = v.documentType as DocumentType;
    const before = await effectiveNumberingRule(tx, ctx.organizationId, t);
    const open = await tx
      .select()
      .from(numberingRuleVersions)
      .where(and(eq(numberingRuleVersions.organizationId, ctx.organizationId), eq(numberingRuleVersions.documentType, t), isNull(numberingRuleVersions.siteId), eq(numberingRuleVersions.status, "approved"), isNull(numberingRuleVersions.effectiveTo)))
      .for("update");
    let supersedesId: string | null = null;
    for (const p of open) {
      if (p.effectiveFrom >= v.effectiveFrom) throw new DomainError("conflict", `Version ${p.versionNo} is already approved from ${p.effectiveFrom}. Choose a later effective date.`);
      await tx.update(numberingRuleVersions).set({ effectiveTo: v.effectiveFrom, updatedAt: new Date() }).where(eq(numberingRuleVersions.id, p.id));
      supersedesId = p.id;
    }
    const now = new Date();
    const [after] = await tx
      .update(numberingRuleVersions)
      .set({ status: "approved", approvedBy: ctx.userId, approvedAt: now, supersedesId, updatedAt: now })
      .where(eq(numberingRuleVersions.id, v.id))
      .returning();
    await audit(tx, ctx, {
      action: "platform.numbering_rule.changed",
      entityType: "numbering_rule",
      entityId: v.id,
      entityNumber: `${t} v${v.versionNo}`,
      siteId: null,
      reason: v.changeSummary,
      before: { source: before.source, versionNo: before.versionNo, pattern: before.pattern, prefix: before.prefix, resetPeriod: before.resetPeriod, sequenceWidth: before.sequenceWidth },
      after: { versionNo: after.versionNo, pattern: after.pattern, prefix: after.prefix, resetPeriod: after.resetPeriod, sequenceWidth: after.sequenceWidth, effectiveFrom: after.effectiveFrom },
    });
    return after;
  });
}

export async function rejectNumberingRuleVersion(ctx: AuthContext, id: string, reason: string) {
  ctx.require("platform.numbering_rule.admin");
  const why = reason?.trim() ?? "";
  if (why.length < 3) throw new DomainError("validation", "Say why the version is rejected (at least 3 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const v = await lockVersion(tx, ctx, id);
    if (v.status !== "submitted") throw new DomainError("state", `This version is ${v.status}; only a submitted version can be rejected.`);
    const own = v.submittedBy === ctx.userId;
    const now = new Date();
    await tx
      .update(numberingRuleVersions)
      .set(own ? { status: "cancelled", rejectionReason: why, updatedAt: now } : { status: "rejected", rejectedBy: ctx.userId, rejectedAt: now, rejectionReason: why, updatedAt: now })
      .where(eq(numberingRuleVersions.id, v.id));
    await audit(tx, ctx, { action: own ? "platform.numbering_rule.cancelled" : "platform.numbering_rule.rejected", entityType: "numbering_rule", entityId: v.id, entityNumber: `${v.documentType} v${v.versionNo}`, siteId: null, reason: why, before: { status: v.status }, after: { status: own ? "cancelled" : "rejected" } });
  });
}

export { NUMBERING_DEFAULTS };

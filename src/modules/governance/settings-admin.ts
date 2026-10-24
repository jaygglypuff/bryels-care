import "server-only";
import { and, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { approvalDecisions, settingChangeRequests, sites, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { SETTINGS, type SettingDefinition, type SettingKey, isSettingKey, listStoredSettings, readStoredSetting, writeStoredSetting } from "@/lib/settings";
import { canDecideEvaluatedStep, evaluateApprovalRulesAudited } from "./approval-rules";
import { auditDenied, requireReauthentication } from "./reauth";

/**
 * Settings administration (US-1-19 AC3) and setting change requests (US-1-14 AC1, S1-03).
 *
 * - `platform.settings.admin` (R, re-authentication) changes a key. Keys registered with
 *   `requiresApproval` become a `setting_change_requests` row (`submitted`); other keys are written
 *   at once and recorded as an `applied` row (the version history) with `platform.setting.changed`.
 * - `platform.settings.approve` (R): owner_director or a second system_admin approves; the
 *   submitter can never approve (409 SEPARATION_OF_DUTIES + `identity.authorization.denied`).
 *   Approval writes the setting, `approval_decisions`, `platform.setting_change_request.approved`
 *   and `platform.setting.changed` and marks the request `applied` in one transaction.
 */

export type SettingRow = {
  key: SettingKey;
  def: SettingDefinition;
  organizationValue: unknown;
  organizationStored: boolean;
  siteValues: { siteId: string; siteCode: string; value: unknown }[];
  invalidStored: boolean;
  pending: number;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Every registered key with its organization value, site overrides (allowed sites only) and pending requests. */
export async function listSettingsForAdmin(ctx: AuthContext) {
  ctx.require("platform.settings.view");
  const stored = await listStoredSettings(db, ctx.organizationId);
  const pending = await db
    .select({ key: settingChangeRequests.key })
    .from(settingChangeRequests)
    .where(and(eq(settingChangeRequests.organizationId, ctx.organizationId), eq(settingChangeRequests.status, "submitted")));
  const siteCode = new Map(ctx.allowedSites.map((s) => [s.id, s.code]));
  const rows: SettingRow[] = (Object.keys(SETTINGS) as SettingKey[]).map((key) => {
    const def = SETTINGS[key] as SettingDefinition;
    const org = stored.find((s) => s.key === key && s.scope === "organization");
    const orgValid = org ? def.schema.safeParse(org.value).success : true;
    return {
      key,
      def,
      organizationValue: org && orgValid ? org.value : def.default,
      organizationStored: !!org,
      siteValues: stored
        .filter((s) => s.key === key && s.scope === "site" && s.siteId && siteCode.has(s.siteId))
        .map((s) => ({ siteId: s.siteId!, siteCode: siteCode.get(s.siteId!)!, value: s.value })),
      invalidStored: !orgValid,
      pending: pending.filter((p) => p.key === key).length,
    };
  });
  const orphans = stored.filter((s) => !isSettingKey(s.key)).map((s) => ({ key: s.key, scope: s.scope, siteId: s.siteId }));
  return { rows, orphans };
}

export const ChangeSettingInput = z
  .object({
    key: z.string().min(1).max(120),
    siteId: z.uuid().nullable(),
    /** The new value (already parsed from JSON), or null to remove the stored row (back to default/organization value). */
    value: z.unknown().nullable(),
    reason: z.string().trim().min(3, "Say why the setting changes (at least 3 characters).").max(500),
  })
  .strict();

/** US-1-19 AC3 / US-1-14: change a setting (direct or as a change request). */
export async function changeSetting(ctx: AuthContext, raw: z.input<typeof ChangeSettingInput>, password: string | null | undefined) {
  ctx.require("platform.settings.admin");
  const input = ChangeSettingInput.parse(raw);
  if (!isSettingKey(input.key)) throw new DomainError("validation", "Unknown setting.", { field: "key" });
  const key = input.key;
  const def = SETTINGS[key] as SettingDefinition;
  if (input.siteId) {
    if (!def.scopes.includes("site")) throw new DomainError("validation", "This setting has no site-level value.", { field: "siteId" });
    ctx.requireSite(input.siteId);
  }
  if (input.value !== null && input.value !== undefined) {
    const parsed = def.schema.safeParse(input.value);
    if (!parsed.success) throw new DomainError("validation", `Not a valid value: ${parsed.error.issues[0]?.message ?? "check the format"}.`, { field: "value" });
    input.value = parsed.data;
  }
  await requireReauthentication(ctx, password, `platform.settings.admin:${key}`);
  const current = await readStoredSetting(db, ctx.organizationId, key, input.siteId);
  if (same(current?.value ?? null, input.value ?? null)) throw new DomainError("validation", "The value is unchanged.", { field: "value" });

  return db.transaction(async (tx) => {
    const scope = input.siteId ? "site" : "organization";
    if (def.requiresApproval) {
      const [dup] = await tx
        .select({ id: settingChangeRequests.id })
        .from(settingChangeRequests)
        .where(
          and(
            eq(settingChangeRequests.organizationId, ctx.organizationId),
            eq(settingChangeRequests.key, key),
            eq(settingChangeRequests.status, "submitted"),
            input.siteId ? eq(settingChangeRequests.siteId, input.siteId) : isNull(settingChangeRequests.siteId),
          ),
        )
        .limit(1);
      if (dup) throw new DomainError("conflict", "A change to this setting is already waiting for approval. Approve, reject or cancel it first.");
      const [req] = await tx
        .insert(settingChangeRequests)
        .values({ organizationId: ctx.organizationId, scope, siteId: input.siteId, key, oldValue: current?.value ?? null, newValue: input.value ?? null, reason: input.reason, requiresApproval: true, status: "submitted", submittedBy: ctx.userId })
        .returning();
      await audit(tx, ctx, {
        action: "platform.setting_change_request.submitted",
        entityType: "setting_change_request",
        entityId: req.id,
        entityNumber: key,
        siteId: input.siteId,
        reason: input.reason,
        before: { value: current?.value ?? null },
        after: { value: input.value ?? null },
      });
      return { status: "submitted" as const, requestId: req.id };
    }
    await writeStoredSetting(tx, { organizationId: ctx.organizationId, key, siteId: input.siteId, value: input.value ?? null, updatedBy: ctx.userId });
    const now = new Date();
    const [req] = await tx
      .insert(settingChangeRequests)
      .values({ organizationId: ctx.organizationId, scope, siteId: input.siteId, key, oldValue: current?.value ?? null, newValue: input.value ?? null, reason: input.reason, requiresApproval: false, status: "applied", submittedBy: ctx.userId, appliedAt: now })
      .returning();
    const auditEventId = await auditSettingChanged(tx, ctx, { key, siteId: input.siteId, before: current?.value ?? null, after: input.value ?? null, reason: input.reason, requestId: req.id });
    return { status: "applied" as const, requestId: req.id, auditEventId };
  });
}

async function auditSettingChanged(tx: Parameters<typeof audit>[0], ctx: AuthContext, a: { key: string; siteId: string | null; before: unknown; after: unknown; reason: string; requestId: string }) {
  // The id of the audit row is cited in the cutover record (runbook §17a.2).
  return audit(tx, ctx, { action: "platform.setting.changed", entityType: "setting", entityId: a.requestId, entityNumber: a.key, siteId: a.siteId, reason: a.reason, before: { value: a.before }, after: { value: a.after } });
}

async function lockRequest(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], ctx: AuthContext, id: string) {
  if (!z.uuid().safeParse(id).success) throw new DomainError("not_found", "Change request not found.");
  const [r] = await tx
    .select()
    .from(settingChangeRequests)
    .where(and(eq(settingChangeRequests.id, id), eq(settingChangeRequests.organizationId, ctx.organizationId)))
    .for("update")
    .limit(1);
  if (!r || (r.siteId && !ctx.allowedSiteIds.includes(r.siteId))) throw new DomainError("not_found", "Change request not found.");
  return r;
}

/** S1-03: approve a submitted change (a different user holding platform.settings.approve). */
export async function approveSettingChange(ctx: AuthContext, id: string, input: { note?: string | null; password?: string | null }) {
  ctx.require("platform.settings.approve");
  const peek = await db.transaction((tx) => lockRequest(tx, ctx, id));
  if (peek.submittedBy === ctx.userId) {
    await auditDenied(ctx, { permission: "platform.settings.approve", entityType: "setting_change_request", entityId: peek.id, siteId: peek.siteId, rule: "authz.sod.approve_own" });
    throw new DomainError("separation_of_duties", "SEPARATION_OF_DUTIES: you submitted this change, so a different person must approve it.", { rule: "authz.sod.approve_own" });
  }
  await requireReauthentication(ctx, input.password, "platform.settings.approve");
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, ctx, id);
    if (r.status !== "submitted") throw new DomainError("state", `This change request is ${r.status}; only a submitted request can be approved.`);
    if (r.submittedBy === ctx.userId) throw new DomainError("separation_of_duties", "SEPARATION_OF_DUTIES: you submitted this change, so a different person must approve it.");
    if (!isSettingKey(r.key)) throw new DomainError("state", "This setting no longer exists in the registry; reject the request.");
    const ev = await evaluateApprovalRulesAudited(tx, ctx, { documentType: "setting_change_request", siteId: r.siteId, recordId: r.id, recordNumber: r.key });
    const step = ev.steps[0];
    if (step && !canDecideEvaluatedStep(ctx, step)) {
      throw new DomainError("forbidden", `This approval needs ${step.roleCodes.map((x) => x.replace(/_/g, " ")).join(" or ")}.`);
    }
    const current = await readStoredSetting(tx, ctx.organizationId, r.key, r.siteId);
    if (!same(current?.value ?? null, r.oldValue ?? null)) {
      throw new DomainError("conflict", "The setting changed after this request was submitted. Reject it and submit a new request.");
    }
    await writeStoredSetting(tx, { organizationId: ctx.organizationId, key: r.key, siteId: r.siteId, value: r.newValue ?? null, updatedBy: ctx.userId });
    const now = new Date();
    await tx.insert(approvalDecisions).values({ organizationId: ctx.organizationId, siteId: r.siteId, recordType: "setting_change_request", recordId: r.id, step: 1, decision: "approved", decidedBy: ctx.userId, note: input.note?.trim() || null });
    await tx
      .update(settingChangeRequests)
      .set({ status: "applied", approvedBy: ctx.userId, approvedAt: now, approvalNote: input.note?.trim() || null, appliedAt: now, updatedAt: now })
      .where(eq(settingChangeRequests.id, r.id));
    await audit(tx, ctx, {
      action: "platform.setting_change_request.approved",
      entityType: "setting_change_request",
      entityId: r.id,
      entityNumber: r.key,
      siteId: r.siteId,
      reason: input.note?.trim() || null,
      before: { status: "submitted" },
      after: { status: "applied" },
    });
    const auditEventId = await auditSettingChanged(tx, ctx, { key: r.key, siteId: r.siteId, before: r.oldValue ?? null, after: r.newValue ?? null, reason: r.reason, requestId: r.id });
    return { status: "applied" as const, auditEventId };
  });
}

/** Reject a submitted change (a different user holding platform.settings.approve). */
export async function rejectSettingChange(ctx: AuthContext, id: string, reason: string) {
  ctx.require("platform.settings.approve");
  const why = reason?.trim() ?? "";
  if (why.length < 3) throw new DomainError("validation", "Say why the change is rejected (at least 3 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, ctx, id);
    if (r.status !== "submitted") throw new DomainError("state", `This change request is ${r.status}; only a submitted request can be rejected.`);
    if (r.submittedBy === ctx.userId) throw new DomainError("separation_of_duties", "SEPARATION_OF_DUTIES: cancel your own request instead of rejecting it.");
    const now = new Date();
    await tx.insert(approvalDecisions).values({ organizationId: ctx.organizationId, siteId: r.siteId, recordType: "setting_change_request", recordId: r.id, step: 1, decision: "rejected", decidedBy: ctx.userId, note: why });
    await tx.update(settingChangeRequests).set({ status: "rejected", rejectedBy: ctx.userId, rejectedAt: now, rejectionReason: why, updatedAt: now }).where(eq(settingChangeRequests.id, r.id));
    await audit(tx, ctx, { action: "platform.setting_change_request.rejected", entityType: "setting_change_request", entityId: r.id, entityNumber: r.key, siteId: r.siteId, reason: why, before: { status: "submitted" }, after: { status: "rejected" } });
  });
}

/** The submitter withdraws a request that is still waiting. */
export async function cancelSettingChange(ctx: AuthContext, id: string) {
  ctx.require("platform.settings.admin");
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, ctx, id);
    if (r.status !== "submitted") throw new DomainError("state", `This change request is ${r.status}; only a submitted request can be cancelled.`);
    if (r.submittedBy !== ctx.userId) throw new DomainError("forbidden", "Only the person who submitted this request can cancel it.");
    const now = new Date();
    await tx.update(settingChangeRequests).set({ status: "cancelled", cancelledAt: now, updatedAt: now }).where(eq(settingChangeRequests.id, r.id));
    await audit(tx, ctx, { action: "platform.setting_change_request.cancelled", entityType: "setting_change_request", entityId: r.id, entityNumber: r.key, siteId: r.siteId, before: { status: "submitted" }, after: { status: "cancelled" } });
  });
}

/** Change requests and the applied history (settings are versioned), newest first. */
export async function listSettingChangeRequests(ctx: AuthContext, f: { status?: string; key?: string; limit?: number } = {}) {
  ctx.require("platform.settings.view");
  const conds: SQL[] = [eq(settingChangeRequests.organizationId, ctx.organizationId)];
  if (f.status) conds.push(eq(settingChangeRequests.status, f.status));
  if (f.key) conds.push(eq(settingChangeRequests.key, f.key));
  const rows = await db
    .select({ r: settingChangeRequests, submitter: users.displayName, siteCode: sites.code })
    .from(settingChangeRequests)
    .innerJoin(users, eq(users.id, settingChangeRequests.submittedBy))
    .leftJoin(sites, eq(sites.id, settingChangeRequests.siteId))
    .where(and(...conds))
    .orderBy(desc(settingChangeRequests.createdAt))
    .limit(Math.min(f.limit ?? 50, 200));
  const approverIds = [...new Set(rows.map((x) => x.r.approvedBy ?? x.r.rejectedBy).filter((x): x is string => !!x))];
  const approvers = approverIds.length ? await db.select({ id: users.id, name: users.displayName }).from(users).where(and(eq(users.organizationId, ctx.organizationId), inArray(users.id, approverIds))) : [];
  const name = new Map(approvers.map((a) => [a.id, a.name]));
  return rows
    .filter((x) => !x.r.siteId || ctx.allowedSiteIds.includes(x.r.siteId))
    .map((x) => ({
      ...x.r,
      submitterName: x.submitter,
      siteCode: x.siteCode,
      deciderName: x.r.approvedBy ? (name.get(x.r.approvedBy) ?? null) : x.r.rejectedBy ? (name.get(x.r.rejectedBy) ?? null) : null,
      label: isSettingKey(x.r.key) ? (SETTINGS[x.r.key] as SettingDefinition).label : x.r.key,
    }));
}

import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { RETENTION_ACTIONS, RETENTION_BASES, RETENTION_DATA_CLASSES, retentionPolicies, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { auditDenied, requireReauthentication } from "@/modules/governance";

/**
 * Retention policies (US-9-05, docs/data-model.md §12.1–§12.2, docs/security.md §7). The periods
 * below are the engineering placeholders of the data model; they are NOT legal advice and stay
 * "unconfirmed" until the company's qualified reviewers confirm them (the owner signs as
 * `confirmed_by`). An unconfirmed class is only ever reported by the sweep, never acted on.
 */
import { PROTECTED_CLASSES, RETENTION_DEFAULTS, policyKey, type PolicyDefault, type RetentionAction, type RetentionBasis, type RetentionDataClass } from "./retention-defaults";

export { PROTECTED_CLASSES, RETENTION_DEFAULTS, periodLabel, policyKey, type PolicyDefault, type RetentionAction, type RetentionBasis, type RetentionDataClass } from "./retention-defaults";

export type PolicyView = PolicyDefault & {
  id: string | null;
  source: "stored" | "default";
  isConfirmed: boolean;
  confirmedBy: string | null;
  confirmedByName: string | null;
  confirmedAt: Date | null;
  confirmationNote: string | null;
  effectiveFrom: string | null;
  updatedBy: string | null;
  updatedAt: Date | null;
  protected: boolean;
};

/** Stored rows merged with the shipped defaults (internal: the sweep and the screen share it). */
export async function effectivePolicies(q: DbOrTx, organizationId: string): Promise<PolicyView[]> {
  const stored = await q
    .select({ p: retentionPolicies, confirmedByName: users.displayName })
    .from(retentionPolicies)
    .leftJoin(users, eq(users.id, retentionPolicies.confirmedBy))
    .where(eq(retentionPolicies.organizationId, organizationId));
  const byKey = new Map(stored.map((r) => [policyKey(r.p), r]));
  const out: PolicyView[] = RETENTION_DEFAULTS.map((def) => {
    const r = byKey.get(policyKey(def));
    byKey.delete(policyKey(def));
    if (!r) return { ...def, id: null, source: "default", isConfirmed: false, confirmedBy: null, confirmedByName: null, confirmedAt: null, confirmationNote: null, effectiveFrom: null, updatedBy: null, updatedAt: null, protected: PROTECTED_CLASSES.includes(def.dataClass) };
    return fromRow(r.p, r.confirmedByName, def.description);
  });
  // Stored rows for targets without a shipped default (added by an administrator) still show.
  for (const r of byKey.values()) out.push(fromRow(r.p, r.confirmedByName, "Added by an administrator"));
  return out;
}

function fromRow(p: typeof retentionPolicies.$inferSelect, confirmedByName: string | null, description: string): PolicyView {
  return {
    dataClass: p.dataClass as RetentionDataClass,
    target: p.target,
    retentionMonths: p.retentionMonths,
    retentionDays: p.retentionDays,
    basis: p.basis as RetentionBasis,
    minimumMonths: p.minimumMonths,
    action: p.action as RetentionAction,
    assumptionId: p.assumptionId ?? "",
    description,
    id: p.id,
    source: "stored",
    isConfirmed: p.isConfirmed,
    confirmedBy: p.confirmedBy,
    confirmedByName,
    confirmedAt: p.confirmedAt,
    confirmationNote: p.confirmationNote,
    effectiveFrom: p.effectiveFrom,
    updatedBy: p.updatedBy,
    updatedAt: p.updatedAt,
    protected: PROTECTED_CLASSES.includes(p.dataClass as RetentionDataClass),
  };
}

export async function listRetentionPolicies(ctx: AuthContext): Promise<PolicyView[]> {
  ctx.require("platform.retention_policy.view");
  return effectivePolicies(db, ctx.organizationId);
}

export const PolicyEditSchema = z
  .object({
    dataClass: z.enum(RETENTION_DATA_CLASSES),
    target: z.string().trim().regex(/^(\*|[a-z_]{3,63})$/, "Use * or a table name."),
    period: z.discriminatedUnion("unit", [
      z.object({ unit: z.literal("months"), value: z.number().int().min(1).max(1200) }),
      z.object({ unit: z.literal("days"), value: z.number().int().min(1).max(36_500) }),
      z.object({ unit: z.literal("none") }),
    ]),
    basis: z.enum(RETENTION_BASES),
    minimumMonths: z.number().int().min(1).max(1200).nullable(),
    action: z.enum(RETENTION_ACTIONS),
    effectiveFrom: z.iso.date(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

/**
 * Creates or changes one policy row. Restricted: re-authentication; any change clears the
 * reviewer confirmation, so the sweep stops acting on that class until it is confirmed again.
 * Protected classes (ledgers, quality, finance, payroll, audit) can never be set to delete or
 * anonymise.
 */
export async function saveRetentionPolicy(ctx: AuthContext, raw: z.input<typeof PolicyEditSchema>, password: string | null) {
  ctx.require("platform.retention_policy.edit");
  ctx.assertWritable();
  const input = PolicyEditSchema.parse(raw);
  if (PROTECTED_CLASSES.includes(input.dataClass) && (input.action === "delete" || input.action === "anonymise")) {
    throw new DomainError("validation", "This class holds immutable business records; it can only be archived or kept, never deleted or anonymised (ADR-006).", { field: "action" });
  }
  if (input.action !== "keep" && input.period.unit === "none") throw new DomainError("validation", "Enter a retention period, or choose Keep.", { field: "period" });
  await requireReauthentication(ctx, password, "change a retention policy");
  const months = input.period.unit === "months" ? input.period.value : null;
  const days = input.period.unit === "days" ? input.period.value : null;
  const def = RETENTION_DEFAULTS.find((x) => x.dataClass === input.dataClass && x.target === input.target);
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(retentionPolicies)
      .where(and(eq(retentionPolicies.organizationId, ctx.organizationId), eq(retentionPolicies.dataClass, input.dataClass), eq(retentionPolicies.target, input.target)))
      .for("update");
    const values = {
      retentionMonths: months,
      retentionDays: days,
      basis: input.basis,
      minimumMonths: input.minimumMonths,
      action: input.action,
      effectiveFrom: input.effectiveFrom,
      isConfirmed: false,
      confirmedBy: null,
      confirmedAt: null,
      confirmationNote: null,
      updatedBy: ctx.userId,
      updatedAt: new Date(),
    };
    const [row] = before
      ? await tx.update(retentionPolicies).set(values).where(eq(retentionPolicies.id, before.id)).returning()
      : await tx
          .insert(retentionPolicies)
          .values({ organizationId: ctx.organizationId, dataClass: input.dataClass, target: input.target, assumptionId: def?.assumptionId ?? null, ...values })
          .returning();
    await audit(tx, ctx, {
      action: "platform.retention_policy.updated",
      entityType: "retention_policies",
      entityId: row.id,
      entityNumber: policyKey(row),
      siteId: null,
      reason: input.reason,
      before: before ? pick(before) : def ? { ...pick(def), source: "default" } : null,
      after: pick(row),
    });
    return row;
  });
}

const pick = (p: { retentionMonths: number | null; retentionDays: number | null; basis: string; minimumMonths: number | null; action: string; isConfirmed?: boolean }) => ({
  retentionMonths: p.retentionMonths,
  retentionDays: p.retentionDays,
  basis: p.basis,
  minimumMonths: p.minimumMonths,
  action: p.action,
  isConfirmed: p.isConfirmed ?? false,
});

/**
 * The qualified reviewers' confirmation, signed by the holder of `platform.retention_policy.approve`
 * (owner_director by default). A default class is stored first with its shipped values. The person
 * who last changed the row cannot confirm it (separation of duties, ck_retention_policies_confirm_sod).
 */
export async function confirmRetentionPolicy(ctx: AuthContext, input: { dataClass: string; target: string; note: string }, password: string | null) {
  ctx.require("platform.retention_policy.approve");
  ctx.assertWritable();
  const note = input.note.trim();
  if (note.length < 3) throw new DomainError("validation", "Name the reviewer and what was checked (at least 3 characters).", { field: "note" });
  const dataClass = z.enum(RETENTION_DATA_CLASSES).parse(input.dataClass);
  await requireReauthentication(ctx, password, "confirm a retention policy");
  const [existing] = await db
    .select({ id: retentionPolicies.id, updatedBy: retentionPolicies.updatedBy })
    .from(retentionPolicies)
    .where(and(eq(retentionPolicies.organizationId, ctx.organizationId), eq(retentionPolicies.dataClass, dataClass), eq(retentionPolicies.target, input.target)));
  if (ctx.sodBlocks(existing?.updatedBy === ctx.userId, "You changed this policy; a different person must confirm it.")) {
    await auditDenied(ctx, { permission: "platform.retention_policy.approve", entityType: "retention_policies", entityId: existing.id, siteId: null, rule: "confirmer_is_editor" });
    throw new DomainError("separation_of_duties", "You changed this policy; a different person must confirm it.", ctx.refusalDetails());
  }
  return db.transaction(async (tx) => {
    let [row] = await tx
      .select()
      .from(retentionPolicies)
      .where(and(eq(retentionPolicies.organizationId, ctx.organizationId), eq(retentionPolicies.dataClass, dataClass), eq(retentionPolicies.target, input.target)))
      .for("update");
    if (!row) {
      const def = RETENTION_DEFAULTS.find((x) => x.dataClass === dataClass && x.target === input.target);
      if (!def) throw new DomainError("not_found", "Retention policy not found.");
      [row] = await tx
        .insert(retentionPolicies)
        .values({ organizationId: ctx.organizationId, dataClass, target: def.target, retentionMonths: def.retentionMonths, retentionDays: def.retentionDays, basis: def.basis, minimumMonths: def.minimumMonths, action: def.action, effectiveFrom: new Date().toISOString().slice(0, 10), assumptionId: def.assumptionId })
        .returning();
    }
    if (row.isConfirmed) throw new DomainError("conflict", "This policy is already confirmed. Change it first if the reviewers set a different period.");
    ctx.assertSeparation(!!row.updatedBy && row.updatedBy === ctx.userId, "You changed this policy; a different person must confirm it.");
    const now = new Date();
    const [after] = await tx.update(retentionPolicies).set({ isConfirmed: true, confirmedBy: ctx.userId, confirmedAt: now, confirmationNote: note, updatedAt: now }).where(eq(retentionPolicies.id, row.id)).returning();
    await audit(tx, ctx, { action: "platform.retention_policy.confirmed", entityType: "retention_policies", entityId: after.id, entityNumber: policyKey(after), siteId: null, reason: note, before: pick(row), after: pick(after) });
    return after;
  });
}

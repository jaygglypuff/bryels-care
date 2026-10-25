import "server-only";
import { and, asc, desc, eq, gt, isNull, lte, max, or } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import { TAX_APPLIES_TO, TAX_KINDS, TAX_ROUNDING, taxConfigurations } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { requireReauthentication } from "@/modules/governance";
import { DATE_RE, businessDate, isUuid, namesOf, requireReason } from "./shared";

/**
 * Tax configuration as reviewed data (US-6-14, FR-finance-06, docs/modules/finance.md §5). No tax rate
 * exists in code: a code's rate lives in `tax_configurations`, one row per version, effective from a date.
 * A version is proposed by one holder of `finance.tax_config.admin` and becomes effective only when a
 * second holder (the reviewer, normally the accountant) approves it; until then it is shown as "Pending
 * accountant review" and no document resolves it. Every change is restricted (re-authentication) and
 * audited with before/after. Posted documents snapshot the rate they used, so later changes never alter them.
 */

export type TaxConfigRow = typeof taxConfigurations.$inferSelect;
export type TaxAppliesTo = (typeof TAX_APPLIES_TO)[number];

export const TAX_KIND_LABEL: Record<(typeof TAX_KINDS)[number], string> = {
  vat_output: "Output tax on sales",
  vat_input: "Input tax on purchases",
  withholding_receivable: "Withheld by customers",
  withholding_payable: "Withheld from suppliers",
  exempt: "Exempt",
  zero_rated: "Zero-rated",
  other: "Other",
};

export const TaxConfigInput = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/, "Use 1–20 capital letters, digits, '-' or '_'."),
    name: z.string().trim().min(3, "Give the tax a name.").max(80),
    kind: z.enum(TAX_KINDS),
    ratePct: z
      .string()
      .trim()
      .regex(/^\d{1,3}(\.\d{1,4})?$/, "Enter a percentage (up to 4 decimals).")
      .refine((v) => Number(v) <= 100, "The rate cannot be above 100 %."),
    inclusive: z.boolean(),
    appliesTo: z.enum(TAX_APPLIES_TO),
    rounding: z.enum(TAX_ROUNDING),
    effectiveFrom: z.string().regex(DATE_RE, "Choose the date it applies from."),
    sourceNote: z.string().trim().max(500).optional().nullable(),
  })
  .strict();
export type TaxConfigInput = z.input<typeof TaxConfigInput>;

function view(r: TaxConfigRow, names: Map<string, string>, today: string, effectiveIds: Set<string>) {
  return {
    ...r,
    proposedByName: names.get(r.proposedBy) ?? null,
    reviewedByName: r.reviewedBy ? names.get(r.reviewedBy) ?? null : null,
    pendingReview: r.status === "proposed",
    effectiveNow: effectiveIds.has(r.id),
    scheduled: r.status === "approved" && r.effectiveFrom > today,
  };
}

/** The approved version of `code` effective on `onDate` for `appliesTo` (null when none). */
export async function resolveTaxConfiguration(q: DbOrTx, organizationId: string, code: string, appliesTo: TaxAppliesTo, onDate: string): Promise<TaxConfigRow | null> {
  const [r] = await q
    .select()
    .from(taxConfigurations)
    .where(
      and(
        eq(taxConfigurations.organizationId, organizationId),
        eq(taxConfigurations.code, code),
        eq(taxConfigurations.appliesTo, appliesTo),
        eq(taxConfigurations.status, "approved"),
        lte(taxConfigurations.effectiveFrom, onDate),
        or(isNull(taxConfigurations.effectiveTo), gt(taxConfigurations.effectiveTo, onDate)),
      ),
    )
    .orderBy(desc(taxConfigurations.effectiveFrom), desc(taxConfigurations.versionNo))
    .limit(1);
  return r ?? null;
}

/** V-FIN-TAX: like resolve, but 422 TAX_CONFIG_MISSING when a code is named and nothing reviewed is effective. */
export async function requireTaxConfiguration(q: DbOrTx, organizationId: string, code: string, appliesTo: TaxAppliesTo, onDate: string): Promise<TaxConfigRow> {
  const r = await resolveTaxConfiguration(q, organizationId, code, appliesTo, onDate);
  if (!r) {
    throw new DomainError("validation", `TAX_CONFIG_MISSING: tax code ${code} has no reviewed rate effective on ${onDate} for ${appliesTo}. Ask finance to have the rate approved (Finance → Tax configuration).`, {
      code: "TAX_CONFIG_MISSING",
      field: "taxCode",
    });
  }
  return r;
}

/** The configured default tax code of sales or purchases (setting, A-W4B-02); null = no tax line. */
export async function defaultTaxCode(q: DbOrTx, organizationId: string, appliesTo: "sales" | "purchases"): Promise<string | null> {
  return appliesTo === "sales" ? getSetting(q, organizationId, "finance.tax.default_sales_code") : getSetting(q, organizationId, "finance.tax.default_purchase_code");
}

/**
 * Sales tax rate of quotes and orders (registered as the sales module's resolver in src/modules/wiring.ts):
 * the default sales code's reviewed rate on the day, 0 when no code is configured. A configured code that
 * does not resolve refuses (TAX_CONFIG_MISSING) instead of silently dropping the tax.
 */
export async function salesTaxRateFor(q: DbOrTx, organizationId: string, onDate: string): Promise<string> {
  const code = await defaultTaxCode(q, organizationId, "sales");
  if (!code) return "0";
  return (await requireTaxConfiguration(q, organizationId, code, "sales", onDate)).ratePct;
}

export async function listTaxConfigurations(ctx: AuthContext) {
  ctx.require("finance.tax_config.view");
  const rows = await db.select().from(taxConfigurations).where(eq(taxConfigurations.organizationId, ctx.organizationId)).orderBy(asc(taxConfigurations.code), desc(taxConfigurations.versionNo));
  const today = businessDate();
  const names = await namesOf(db, rows.flatMap((r) => [r.proposedBy, r.reviewedBy]));
  const effective = new Set<string>();
  for (const code of new Set(rows.map((r) => `${r.code}|${r.appliesTo}`))) {
    const [c, a] = code.split("|");
    const e = await resolveTaxConfiguration(db, ctx.organizationId, c, a as TaxAppliesTo, today);
    if (e) effective.add(e.id);
  }
  const defaults = { sales: await defaultTaxCode(db, ctx.organizationId, "sales"), purchases: await defaultTaxCode(db, ctx.organizationId, "purchases") };
  return { rows: rows.map((r) => view(r, names, today, effective)), defaults, today };
}

async function loadForUpdate(tx: DbOrTx, ctx: AuthContext, id: string) {
  if (!isUuid(id)) throw new DomainError("not_found", "Tax configuration not found.");
  const [r] = await (tx as typeof db)
    .select()
    .from(taxConfigurations)
    .where(and(eq(taxConfigurations.id, id), eq(taxConfigurations.organizationId, ctx.organizationId)))
    .for("update")
    .limit(1);
  if (!r) throw new DomainError("not_found", "Tax configuration not found.");
  return r;
}

/** Proposes a new version of a tax code (restricted). Not effective until a second person approves it. */
export async function proposeTaxConfiguration(ctx: AuthContext, raw: TaxConfigInput, reauth: { password?: string | null }) {
  ctx.require("finance.tax_config.admin");
  const input = TaxConfigInput.parse(raw);
  await requireReauthentication(ctx, reauth.password, "finance.tax_config.admin");
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select({ v: max(taxConfigurations.versionNo) })
      .from(taxConfigurations)
      .where(and(eq(taxConfigurations.organizationId, ctx.organizationId), eq(taxConfigurations.code, input.code)));
    const [row] = await tx
      .insert(taxConfigurations)
      .values({ ...input, sourceNote: input.sourceNote?.trim() || null, organizationId: ctx.organizationId, versionNo: (m?.v ?? 0) + 1, status: "proposed", proposedBy: ctx.userId })
      .returning();
    await audit(tx, ctx, { action: "finance.tax_configuration.proposed", entityType: "tax_configuration", entityId: row.id, entityNumber: `${row.code} v${row.versionNo}`, siteId: null, after: row });
    return row;
  });
}

/**
 * Reviewer approval (second person, restricted): the version becomes effective from its date; the version
 * it supersedes keeps its history (resolution picks the latest effective version).
 */
export async function approveTaxConfiguration(ctx: AuthContext, id: string, input: { note?: string | null; password?: string | null }) {
  ctx.require("finance.tax_config.admin");
  await requireReauthentication(ctx, input.password, "finance.tax_config.admin");
  return db.transaction(async (tx) => {
    const r = await loadForUpdate(tx, ctx, id);
    if (r.status !== "proposed") throw new DomainError("state", `This version is ${r.status}; only a proposed version can be approved.`);
    ctx.assertSeparation(r.proposedBy === ctx.userId, "You proposed this rate, so a second person (the reviewer) must approve it.", { code: "SEPARATION_OF_DUTIES" });
    const before = await resolveTaxConfiguration(tx, ctx.organizationId, r.code, r.appliesTo as TaxAppliesTo, r.effectiveFrom);
    const [after] = await tx
      .update(taxConfigurations)
      .set({ status: "approved", reviewedBy: ctx.userId, reviewedAt: new Date(), reviewNote: input.note?.trim() || null, updatedAt: new Date() })
      .where(eq(taxConfigurations.id, r.id))
      .returning();
    await audit(tx, ctx, {
      action: "finance.tax_configuration.changed",
      entityType: "tax_configuration",
      entityId: r.id,
      entityNumber: `${r.code} v${r.versionNo}`,
      siteId: null,
      reason: input.note?.trim() || null,
      before: before ? { id: before.id, versionNo: before.versionNo, ratePct: before.ratePct, inclusive: before.inclusive, effectiveFrom: before.effectiveFrom } : null,
      after: { id: after.id, versionNo: after.versionNo, ratePct: after.ratePct, inclusive: after.inclusive, effectiveFrom: after.effectiveFrom, reviewedBy: ctx.userId },
    });
    return after;
  });
}

export async function rejectTaxConfiguration(ctx: AuthContext, id: string, input: { reason: string }) {
  ctx.require("finance.tax_config.admin");
  const reason = requireReason(input.reason);
  return db.transaction(async (tx) => {
    const r = await loadForUpdate(tx, ctx, id);
    if (r.status !== "proposed") throw new DomainError("state", `This version is ${r.status}; only a proposed version can be rejected.`);
    const [after] = await tx.update(taxConfigurations).set({ status: "rejected", rejectedBy: ctx.userId, rejectedAt: new Date(), rejectionReason: reason, updatedAt: new Date() }).where(eq(taxConfigurations.id, r.id)).returning();
    await audit(tx, ctx, { action: "finance.tax_configuration.rejected", entityType: "tax_configuration", entityId: r.id, entityNumber: `${r.code} v${r.versionNo}`, siteId: null, reason, before: { status: r.status }, after: { status: after.status } });
    return after;
  });
}

/** Ends an approved version from a date (restricted). Documents already posted keep their snapshot. */
export async function retireTaxConfiguration(ctx: AuthContext, id: string, input: { reason: string; effectiveTo?: string | null; password?: string | null }) {
  ctx.require("finance.tax_config.admin");
  const reason = requireReason(input.reason);
  const to = input.effectiveTo || businessDate();
  if (!DATE_RE.test(to)) throw new DomainError("validation", "Choose the last day plus one.", { field: "effectiveTo" });
  await requireReauthentication(ctx, input.password, "finance.tax_config.admin");
  return db.transaction(async (tx) => {
    const r = await loadForUpdate(tx, ctx, id);
    if (r.status !== "approved") throw new DomainError("state", `This version is ${r.status}; only an approved version can be retired.`);
    if (to <= r.effectiveFrom) throw new DomainError("validation", "The end date must be after the start date.", { field: "effectiveTo" });
    const [after] = await tx.update(taxConfigurations).set({ status: "retired", effectiveTo: to, retiredBy: ctx.userId, retiredAt: new Date(), retireReason: reason, updatedAt: new Date() }).where(eq(taxConfigurations.id, r.id)).returning();
    await audit(tx, ctx, { action: "finance.tax_configuration.changed", entityType: "tax_configuration", entityId: r.id, entityNumber: `${r.code} v${r.versionNo}`, siteId: null, reason, before: { status: r.status, effectiveTo: r.effectiveTo }, after: { status: after.status, effectiveTo: after.effectiveTo } });
    return after;
  });
}

/** Form options for the caller (invoice drafts, bill entry, tax screen): reviewed codes effective today. */
export async function taxCodeOptionsFor(ctx: AuthContext, appliesTo: TaxAppliesTo) {
  if (!ctx.can("finance.invoice.edit") && !ctx.can("finance.supplier_bill.create") && !ctx.can("finance.tax_config.view")) ctx.require("finance.tax_config.view");
  return taxCodeOptions(db, ctx.organizationId, appliesTo);
}

/** Effective approved codes for a document side (form options). */
export async function taxCodeOptions(q: DbOrTx, organizationId: string, appliesTo: TaxAppliesTo, onDate = businessDate()) {
  const rows = await q.select().from(taxConfigurations).where(and(eq(taxConfigurations.organizationId, organizationId), eq(taxConfigurations.appliesTo, appliesTo), eq(taxConfigurations.status, "approved")));
  const out: { code: string; label: string; ratePct: string }[] = [];
  for (const code of [...new Set(rows.map((r) => r.code))].sort()) {
    const e = await resolveTaxConfiguration(q, organizationId, code, appliesTo, onDate);
    if (e) out.push({ code, label: `${code} · ${e.name} (${Number(e.ratePct)} %${e.inclusive ? ", inclusive" : ""})${e.isFictional ? " · FICTIONAL" : ""}`, ratePct: e.ratePct });
  }
  return out;
}

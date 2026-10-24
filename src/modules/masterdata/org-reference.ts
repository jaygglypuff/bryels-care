import { and, eq, inArray, isNull } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { reasonCodes, uomConversions, uoms } from "../../db/schema";
import { DEFAULT_REASON_CODES } from "./reason-codes-defaults";
import { DEFAULT_UOMS, METRIC_DEFAULT_CONVERSIONS } from "./uom-math";

/**
 * Installs the reference master data every organization needs before stock moves (US-1-21,
 * US-1-24): units g, kg, mg, mL, L, pcs; the SI conversions kg→g, mg→g, L→mL as approved system
 * versions (the factors the MVP ledger had in code); and the default reason codes.
 * Idempotent: existing rows (by code / by unit pair) are left untouched, so a company's edits
 * survive a re-run. Used by the demo seed and for a new production organization
 * (`pnpm tsx scripts/install-reference-data.ts`, see README). No server-only import: runs from tsx.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;

export async function installReferenceData(q: AnyDb, organizationId: string): Promise<{ uoms: number; conversions: number; reasonCodes: number }> {
  const insertedUoms = await q
    .insert(uoms)
    .values(DEFAULT_UOMS.map((u) => ({ organizationId, ...u })))
    .onConflictDoNothing()
    .returning({ id: uoms.id });
  const units = await q.select({ id: uoms.id, code: uoms.code }).from(uoms).where(and(eq(uoms.organizationId, organizationId), inArray(uoms.code, DEFAULT_UOMS.map((u) => u.code))));
  const idOf = (code: string) => units.find((u) => u.code === code)?.id;
  let conversions = 0;
  for (const c of METRIC_DEFAULT_CONVERSIONS) {
    const fromUomId = idOf(c.from);
    const toUomId = idOf(c.to);
    if (!fromUomId || !toUomId) continue;
    const existing = await q
      .select({ id: uomConversions.id })
      .from(uomConversions)
      .where(and(eq(uomConversions.organizationId, organizationId), inArray(uomConversions.fromUomId, [fromUomId, toUomId]), inArray(uomConversions.toUomId, [fromUomId, toUomId]), isNull(uomConversions.materialId)))
      .limit(1);
    if (existing.length) continue;
    const now = new Date();
    await q.insert(uomConversions).values({ organizationId, fromUomId, toUomId, factor: c.factor, status: "approved", isSystem: true, approvedAt: now, effectiveFrom: now, changeReason: "SI reference conversion installed with the system" });
    conversions++;
  }
  const insertedCodes = await q
    .insert(reasonCodes)
    .values(DEFAULT_REASON_CODES.map((r) => ({ organizationId, code: r.code, name: r.name, appliesTo: r.appliesTo, requiresNote: r.requiresNote ?? false, requiresApproval: r.requiresApproval ?? false, sortOrder: r.sortOrder, isSystem: true })))
    .onConflictDoNothing()
    .returning({ id: reasonCodes.id });
  return { uoms: insertedUoms.length, conversions, reasonCodes: insertedCodes.length };
}

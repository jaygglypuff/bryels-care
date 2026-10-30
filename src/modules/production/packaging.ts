import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import Decimal from "decimal.js";
import { type DbOrTx, type Tx, db } from "@/db/client";
import { inventoryBalances, inventoryLots, locations, materials, packagingReconciliations } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { assertLotUsable } from "@/modules/inventory/ledger";
import { assertLocationNotHeld, resolveLotRef } from "@/modules/inventory/holds";
import { type BatchRow, type SnapshotStep, type StepRecord, findStep, openStep, stepLabel } from "./execution";
import { assertStockCovers } from "./execution-postings";
import { idempotent, lockBatch } from "./shared";

/** Step kinds with packaging component issue and reconciliation (W05-15). */
export const RECONCILED_STEP_KINDS = ["packaging", "filling"] as const;

function parseCount(v: string | null | undefined, label: string, field: string) {
  const s = (v ?? "").trim().replace(/,/g, "");
  if (!s) return new Decimal(0);
  let d: Decimal;
  try {
    d = new Decimal(s);
  } catch {
    throw new DomainError("validation", `${label} must be a number.`, { field });
  }
  if (!d.isFinite() || d.lt(0)) throw new DomainError("validation", `${label} cannot be negative.`, { field });
  if (d.decimalPlaces() > 3) throw new DomainError("validation", `${label} can have at most 3 decimals.`, { field });
  return d;
}

/** Current (not superseded, not voided) packaging rows of a batch. */
export async function currentPackaging(q: DbOrTx, batchId: string) {
  return q
    .select({ r: packagingReconciliations, materialCode: materials.code, materialName: materials.name, lotNumber: inventoryLots.lotNumber, locationCode: locations.code })
    .from(packagingReconciliations)
    .innerJoin(materials, eq(materials.id, packagingReconciliations.materialId))
    .innerJoin(inventoryLots, eq(inventoryLots.id, packagingReconciliations.lotId))
    .innerJoin(locations, eq(locations.id, packagingReconciliations.fromLocationId))
    .where(and(eq(packagingReconciliations.batchId, batchId), isNull(packagingReconciliations.voidedAt)));
}

/**
 * Issues a packaging or label lot to the packaging step by scan (US-3-12): the lot must be a
 * packaging material (V-MAT), released and in date (V-EXP/V-HOLD), taken from a location that is
 * not under a hold, with enough unpromised stock. Consumption (issued − returned) is posted at the
 * end of the packaging step or at transfer to quarantine (A-PROC-31).
 */
export async function issuePackaging(
  ctx: AuthContext,
  input: { batchId: string; stepNo: number; lotRef: string; locationRef?: string | null; qty: string; idempotencyKey?: string | null },
) {
  ctx.require("production.process_step_record.create");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.packaging.issue", async () => {
      const step = findStep(batch, input.stepNo);
      if (!(RECONCILED_STEP_KINDS as readonly string[]).includes(step.stepKind)) throw new DomainError("validation", `${stepLabel(step)} does not issue packaging components.`);
      const rec = await openStep(tx, ctx, batch, step);
      const lot = await resolveLotRef(tx, ctx, input.lotRef);
      if (lot.siteId !== batch.siteId) throw new DomainError("not_found", `Lot ${lot.lotNumber} is not at this batch's site.`, { field: "lot" });
      const [m] = lot.materialId ? await tx.select().from(materials).where(eq(materials.id, lot.materialId)).limit(1) : [];
      if (!m || m.materialKind !== "packaging") {
        throw new DomainError("blocked_lot", `Lot ${lot.lotNumber} is ${m ? m.name : "a finished product"}, not a packaging component. Scan the wrapper, label or carton lot.`, { rule: "V-MAT", field: "lot" });
      }
      assertLotUsable(lot);
      const qty = parseCount(input.qty, "Issued quantity", "qty");
      if (qty.lte(0)) throw new DomainError("validation", "Enter the quantity issued.", { field: "qty" });
      let loc;
      if (input.locationRef?.trim()) {
        const v = input.locationRef.trim();
        const isId = /^[0-9a-f-]{36}$/i.test(v);
        const code = v.toUpperCase().replace(/^BC:LOC:/, "");
        [loc] = await tx.select().from(locations).where(and(eq(locations.siteId, batch.siteId), isId ? eq(locations.id, v) : eq(locations.code, code))).limit(1);
        if (!loc) throw new DomainError("not_found", `Location ${code} not found at this site.`, { field: "location" });
      } else {
        const rows = await tx
          .select({ loc: locations })
          .from(inventoryBalances)
          .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
          .where(and(eq(inventoryBalances.lotId, lot.id), gt(inventoryBalances.qtyBase, "0")));
        if (rows.length !== 1) {
          throw new DomainError("validation", rows.length ? `Lot ${lot.lotNumber} is in several locations; choose the one you take it from.` : `Lot ${lot.lotNumber} has no stock.`, { field: "location" });
        }
        loc = rows[0].loc;
      }
      await assertLocationNotHeld(tx, loc);
      await assertStockCovers(tx, lot, loc, qty);
      const [row] = await tx
        .insert(packagingReconciliations)
        .values({
          organizationId: ctx.organizationId,
          siteId: batch.siteId,
          batchId: batch.id,
          processStepRecordId: rec.id,
          materialId: m.id,
          lotId: lot.id,
          fromLocationId: loc.id,
          baseUom: lot.baseUom,
          issuedQty: qty.toString(),
          issuedBy: ctx.userId,
        })
        .returning();
      await audit(tx, ctx, {
        action: "production.packaging_component.issued",
        entityType: "packaging_reconciliation",
        entityId: row.id,
        entityNumber: batch.batchNumber,
        siteId: batch.siteId,
        after: { stepNo: step.stepNo, material: m.code, lot: lot.lotNumber, location: loc.code, issued: qty.toString(), uom: lot.baseUom },
      });
      return { reconciliationId: row.id, materialName: m.name, lotNumber: lot.lotNumber };
    });
    return result;
  });
}

/**
 * Counts a packaging component at the end of packaging: used, damaged and returned against issued
 * (W05-15). variance = issued − used − damaged − returned must be within the configured tolerance
 * (setting production.packaging.reconciliation_tolerance; default 0, A-PROC-19). A recount supersedes
 * the earlier count with a reason.
 */
export type CountPackagingInput = { reconciliationId: string; used: string; damaged?: string | null; returned?: string | null; correctionReason?: string | null; idempotencyKey?: string | null };

export async function countPackaging(ctx: AuthContext, input: CountPackagingInput) {
  ctx.require("production.process_step_record.create");
  const [head] = await db.select({ batchId: packagingReconciliations.batchId }).from(packagingReconciliations).where(eq(packagingReconciliations.id, input.reconciliationId)).limit(1);
  if (!head) throw new DomainError("not_found", "Packaging component not found.");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, head.batchId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.packaging.count", () => countPackagingLocked(tx, ctx, batch, input));
    return result;
  });
}

/**
 * Body of countPackaging for a caller that already holds the batch lock (finishBatch, ADR-080 §6).
 * Lock order: batch (caller) → reconciliation row. The caller checks permissions.
 */
export async function countPackagingLocked(tx: Tx, ctx: AuthContext, batch: BatchRow, input: Omit<CountPackagingInput, "idempotencyKey">) {
  const [r] = await tx.select().from(packagingReconciliations).where(eq(packagingReconciliations.id, input.reconciliationId)).for("update").limit(1);
  if (!r || r.batchId !== batch.id) throw new DomainError("not_found", "Packaging component not found.");
  if (r.voidedAt) throw new DomainError("state", "This count was replaced by a recount; count the current row.");
  if (r.productionPostingId) throw new DomainError("state", "This component's consumption is already posted.");
  if (batch.status !== "in_process") throw new DomainError("state", `Batch ${batch.batchNumber} is ${batch.status.replace(/_/g, " ")}.`);
  const used = parseCount(input.used, "Used", "used");
  const damaged = parseCount(input.damaged, "Damaged", "damaged");
  const returned = parseCount(input.returned, "Returned", "returned");
  if (returned.gt(r.issuedQty)) throw new DomainError("validation", "Returned cannot exceed issued.", { field: "returned" });
  const variance = new Decimal(r.issuedQty).minus(used).minus(damaged).minus(returned);
  const [m] = await tx.select({ code: materials.code, name: materials.name }).from(materials).where(eq(materials.id, r.materialId)).limit(1);
  const tol = await getSetting(tx, ctx.organizationId, "production.packaging.reconciliation_tolerance", batch.siteId);
  const tolerance = new Decimal(tol.byMaterialCode?.[m.code] ?? tol.defaultQty);
  const within = variance.abs().lte(tolerance);
  const counted = { usedQty: used.toString(), damagedQty: damaged.toString(), returnedQty: returned.toString(), varianceQty: variance.toString(), toleranceQty: tolerance.toString(), isWithinTolerance: within, countedBy: ctx.userId, countedAt: new Date() };
  let id = r.id;
  if (r.countedAt) {
    const reason = input.correctionReason?.trim() ?? "";
    if (reason.length < 5) throw new DomainError("validation", "This component was already counted. Give the reason for the recount (at least 5 characters).", { field: "correctionReason" });
    await tx.update(packagingReconciliations).set({ voidedAt: new Date() }).where(eq(packagingReconciliations.id, r.id));
    const [n] = await tx
      .insert(packagingReconciliations)
      .values({
        organizationId: r.organizationId,
        siteId: r.siteId,
        batchId: r.batchId,
        processStepRecordId: r.processStepRecordId,
        materialId: r.materialId,
        lotId: r.lotId,
        fromLocationId: r.fromLocationId,
        baseUom: r.baseUom,
        issuedQty: r.issuedQty,
        issuedBy: r.issuedBy,
        issuedAt: r.issuedAt,
        ...counted,
        supersedesId: r.id,
        correctionReason: reason,
      })
      .returning();
    id = n.id;
  } else {
    await tx.update(packagingReconciliations).set(counted).where(eq(packagingReconciliations.id, r.id));
  }
  await audit(tx, ctx, {
    action: r.countedAt ? "production.packaging_reconciliation.recounted" : "production.packaging_reconciliation.counted",
    entityType: "packaging_reconciliation",
    entityId: id,
    entityNumber: batch.batchNumber,
    siteId: batch.siteId,
    reason: r.countedAt ? input.correctionReason : null,
    before: r.countedAt ? { used: r.usedQty, damaged: r.damagedQty, returned: r.returnedQty, variance: r.varianceQty } : null,
    after: { material: m.code, issued: r.issuedQty, used: counted.usedQty, damaged: counted.damagedQty, returned: counted.returnedQty, variance: counted.varianceQty, tolerance: counted.toleranceQty, within },
  });
  return { reconciliationId: id, variance: variance.toString(), within, materialName: m.name };
}

/**
 * What keeps a packaging step from completing: no component issued, and a counted reconciliation
 * outside tolerance (exceptionable only with a deviation). ADR-080 §6: the wrappers may be counted
 * at Finish (damaged and left over only), so a component not counted yet no longer blocks the step;
 * posting to the hold area refuses uncounted components instead (`uncountedPackagingBlockers`).
 */
export async function packagingBlockers(q: DbOrTx, batch: BatchRow, step: SnapshotStep, rec: StepRecord | null) {
  if (!(RECONCILED_STEP_KINDS as readonly string[]).includes(step.stepKind)) return [];
  const rows = rec ? (await currentPackaging(q, batch.id)).filter((x) => x.r.processStepRecordId === rec.id) : [];
  const out: { message: string; exceptionable: boolean }[] = [];
  if (!rows.length) out.push({ message: "Issue the packaging and label lots used (scan each lot).", exceptionable: false });
  for (const { r, materialName, lotNumber } of rows) {
    if (!r.countedAt) continue;
    if (!r.isWithinTolerance && !rec?.deviationId) {
      out.push({ message: `${materialName} (lot ${lotNumber}) does not reconcile: ${new Decimal(r.varianceQty ?? 0).toString()} ${r.baseUom} unexplained (allowed ${new Decimal(r.toleranceQty ?? 0).toString()}). Recount, or raise a deviation.`, exceptionable: true });
    }
  }
  return out;
}

/** Packaging components issued to the batch but not counted yet (blocks posting to the hold area). */
export async function uncountedPackagingBlockers(q: DbOrTx, batchId: string): Promise<string[]> {
  return (await currentPackaging(q, batchId)).filter((x) => !x.r.countedAt).map((x) => `Count ${x.materialName} (lot ${x.lotNumber}): damaged and left over.`);
}

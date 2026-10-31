import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { batchMaterials, batches, inventoryLots, locations, materials, products, stockReservations } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import {
  approveProductionOrder,
  completeStep,
  createBatch,
  createProductionOrder,
  issuePackaging,
  recordDispense,
  recordReading,
  selectEquipment,
  stageMaterial,
  startBatch,
} from "@/modules/production";
import { type Kit, makeLot } from "./kit";
import { acapulcoRevisionId, allowDirectBatches, cleanEquipment, manilaDay, signChecklist, snapshotOf, weighAllAtTarget } from "./w2b";

/**
 * Stage G3 fixtures (ADR-080 §6): an Acapulco Soap batch made through every service up to Finish
 * (all steps done, wrappers issued but NOT counted: the count happens at Finish). Fictional data.
 */
export type Crew = { manager: AuthContext; operator: AuthContext; checker: AuthContext; planner?: AuthContext; warehouse?: AuthContext };

async function locId(siteId: string, code: string) {
  const [l] = await db.select().from(locations).where(and(eq(locations.siteId, siteId), eq(locations.code, code)));
  return l.id;
}

/** Weighs every line from the lots staged for the batch (work-order batches), at PRD-01. */
async function weighStaged(operator: AuthContext, checker: AuthContext, batchId: string) {
  const lines = await db.select({ bm: batchMaterials }).from(batchMaterials).where(eq(batchMaterials.batchId, batchId));
  const rsv = await db
    .select({ r: stockReservations, lot: inventoryLots })
    .from(stockReservations)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockReservations.lotId))
    .where(and(eq(stockReservations.demandType, "batch"), eq(stockReservations.demandId, batchId), eq(stockReservations.status, "active")));
  for (const { bm } of lines.sort((a, z) => a.bm.lineNo - z.bm.lineNo)) {
    if (bm.status === "packaging") continue; // ADR-088 §3: packaging lines are not weighed
    const mine = rsv.filter((x) => x.lot.materialId === bm.materialId);
    let left = new Decimal(bm.theoreticalQtyG).toDecimalPlaces(3);
    for (const [i, x] of mine.entries()) {
      const last = i === mine.length - 1;
      const qty = last ? left : Decimal.min(left, x.r.qtyBase);
      left = left.minus(qty);
      await recordDispense(operator, { batchId, batchMaterialId: bm.id, lotRef: `BC:LOT:${x.lot.lotNumber}`, locationRef: "PRD-01", qty: qty.toString(), equipmentRef: "SC-01", partial: !last }, { checker });
    }
  }
}

/** Stages every reserved lot of the work order to PRD-01 for this batch (staging by scan). */
async function stageAll(warehouse: AuthContext, workOrderId: string, batchId: string) {
  const rsv = await db
    .select({ lotNumber: inventoryLots.lotNumber })
    .from(stockReservations)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockReservations.lotId))
    .where(and(eq(stockReservations.demandType, "work_order"), eq(stockReservations.demandId, workOrderId), eq(stockReservations.status, "active")));
  for (const r of rsv) {
    try {
      await stageMaterial(warehouse, { batchId, lotCode: `BC:LOT:${r.lotNumber}`, toLocationCode: "BC:LOC:PRD-01" });
    } catch {
      // The line already has what it needs (the lot's reservation covers a later batch).
    }
  }
}

/** Runs every step except the transfer; the packaging step issues `wrappers` and completes without a count. */
async function runSteps(c: Crew, batchId: string, opts: { wrappers: string; staged: boolean }) {
  await cleanEquipment(c.operator, "SC-01");
  await cleanEquipment(c.operator, "MIX-01");
  const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
  const steps = [...snapshotOf(b!).steps].sort((x, y) => x.stepNo - y.stepNo);
  let wrappersLotId: string | null = null;
  for (const s of steps) {
    if (s.stepKind === "line_clearance") await signChecklist(c.operator, c.checker, batchId, s);
    else if (s.stepKind === "dispensing") {
      if (opts.staged) await weighStaged(c.operator, c.checker, batchId);
      else await weighAllAtTarget(c.operator, c.checker, batchId);
      await completeStep(c.operator, { batchId, stepNo: s.stepNo }, { checker: c.checker });
    } else if (s.stepKind === "process") {
      if (s.requiresEquipment) await selectEquipment(c.operator, { batchId, stepNo: s.stepNo, equipmentRef: "MIX-01" });
      for (const p of s.parameters ?? []) {
        if (!p.isRequired) continue;
        await recordReading(c.operator, { batchId, stepNo: s.stepNo, parameterId: p.id, value: p.valueKind === "numeric" ? (p.targetValue ?? p.minValue ?? "45") : p.valueKind === "boolean" ? "yes" : "MOULD-A" });
      }
      await completeStep(c.operator, { batchId, stepNo: s.stepNo }, { checker: c.checker });
    } else if (s.stepKind === "packaging") {
      const wrappers = await makeLot(c.manager, b!.siteId, await locId(b!.siteId, "PKG-01"), "500", { materialCode: "PKG-0101" });
      wrappersLotId = wrappers.id;
      await issuePackaging(c.operator, { batchId, stepNo: s.stepNo, lotRef: wrappers.id, qty: opts.wrappers });
      for (const p of s.parameters ?? []) if (p.isRequired) await recordReading(c.operator, { batchId, stepNo: s.stepNo, parameterId: p.id, value: "1" });
      await completeStep(c.operator, { batchId, stepNo: s.stepNo }, { checker: c.checker });
    }
  }
  const [m] = await db.select({ id: materials.id }).from(materials).where(eq(materials.code, "PKG-0101"));
  return { wrappersLotId: wrappersLotId!, wrapperMaterialId: m.id };
}

/** A direct (no work order) batch ready to finish. 8.8 kg ≈ 61 bars expected. */
export async function directBatchReadyToFinish(kit: Kit, c: Crew, opts: { plannedSizeKg?: string; wrappers?: string } = {}) {
  await allowDirectBatches(kit);
  const { batchId, batchNumber } = await createBatch(c.manager, { formulaRevisionId: await acapulcoRevisionId(), plannedSizeKg: opts.plannedSizeKg ?? "8.8", plannedStartOn: manilaDay(0) });
  await startBatch(c.operator, batchId);
  const r = await runSteps(c, batchId, { wrappers: opts.wrappers ?? "70", staged: false });
  return { batchId, batchNumber, ...r };
}

/** A production order (work order) with `batches` batches of 8.8 kg (≈ 61 bars), each made up to Finish. */
export async function orderReadyToFinish(kit: Kit, c: Required<Crew>, opts: { batches?: number; salesOrderId?: string | null; wrappers?: string; batchSizeKg?: string } = {}) {
  const [acs] = await db.select({ id: products.id }).from(products).where(eq(products.skuCode, "ACS-135"));
  const order = await createProductionOrder(c.planner, { productId: acs.id, plannedStart: manilaDay(0), plannedEnd: manilaDay(1), batchCount: opts.batches ?? 1, batchSizeKg: opts.batchSizeKg ?? "8.8", salesOrderId: opts.salesOrderId ?? null });
  await approveProductionOrder(c.manager, order.workOrderId);
  const list = await db.select().from(batches).where(eq(batches.workOrderId, order.workOrderId));
  const out: { batchId: string; batchNumber: string; wrappersLotId: string; wrapperMaterialId: string }[] = [];
  for (const b of list.sort((x, y) => x.batchNumber.localeCompare(y.batchNumber))) {
    await stageAll(c.warehouse, order.workOrderId, b.id);
    const r = await runSteps(c, b.id, { wrappers: opts.wrappers ?? "70", staged: true });
    out.push({ batchId: b.id, batchNumber: b.batchNumber, ...r });
  }
  return { workOrderId: order.workOrderId, batches: out };
}

import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import {
  auditEvents,
  batchMaterials,
  batchStateTransitions,
  batches,
  dispenseRecords,
  dispositions,
  inventoryBalances,
  inventoryLots,
  locations,
  materials,
  processStepRecords,
  products,
  testResults,
  users,
  stockReservations,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { approvedFormulaRevisionOptions, getEffectiveRouting } from "@/modules/masterdata";
import { type FormulaSnapshot, eligibleCheckers, manilaToday } from "./shared";
import { toleranceRange } from "./dispensing";

async function userNames(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Batches at the current site with step progress, newest first. */
export async function listBatches(ctx: AuthContext) {
  ctx.require("production.batch.view");
  const rows = await db
    .select({
      id: batches.id,
      batchNumber: batches.batchNumber,
      status: batches.status,
      plannedSizeG: batches.plannedSizeG,
      plannedStartOn: batches.plannedStartOn,
      startedAt: batches.startedAt,
      completedAt: batches.completedAt,
      createdAt: batches.createdAt,
      yieldPct: batches.yieldPct,
      actualUnits: batches.actualUnits,
      snapshot: batches.formulaSnapshot,
      productName: products.name,
      productSku: products.skuCode,
      stepsDone: sql<number>`(select count(*)::int from ${processStepRecords} where ${processStepRecords.batchId} = ${batches.id} and ${processStepRecords.status} = 'completed')`,
    })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .where(and(eq(batches.organizationId, ctx.organizationId), eq(batches.siteId, ctx.currentSiteId)))
    .orderBy(desc(batches.createdAt));
  return rows.map(({ snapshot, ...r }) => {
    const s = snapshot as FormulaSnapshot;
    return { ...r, stepsTotal: s.steps.length, formulaCode: s.formulaCode, revisionNo: s.revisionNo };
  });
}
export type BatchListRow = Awaited<ReturnType<typeof listBatches>>[number];

/** "Step x of n" wording used on cards, the table and the workspace header. */
export function progressLabel(status: string, done: number, total: number) {
  if (status === "planned" || status === "draft") return `Not started · ${total} steps`;
  if (done >= total) return `${total} of ${total} steps done`;
  return `Step ${done + 1} of ${total}`;
}

/** Everything the batch workspace and the BMR print need, scoped to the caller's sites. */
export async function getBatchRecord(ctx: AuthContext, batchId: string) {
  ctx.require("production.batch.view");
  const [row] = await db
    .select({ batch: batches, product: products })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId), inArray(batches.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Batch not found in your sites.");
  const { batch, product } = row;
  ctx.requireSite(batch.siteId);
  const snapshot = batch.formulaSnapshot as FormulaSnapshot;

  const mats = await db
    .select({ bm: batchMaterials, material: materials })
    .from(batchMaterials)
    .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
    .where(eq(batchMaterials.batchId, batch.id))
    .orderBy(asc(batchMaterials.lineNo));
  const dispenses = mats.length
    ? await db
        .select({ rec: dispenseRecords, lotNumber: inventoryLots.lotNumber, lotExpiresOn: inventoryLots.expiresOn, locationCode: locations.code })
        .from(dispenseRecords)
        .innerJoin(inventoryLots, eq(inventoryLots.id, dispenseRecords.lotId))
        .innerJoin(locations, eq(locations.id, dispenseRecords.fromLocationId))
        .where(and(inArray(dispenseRecords.batchMaterialId, mats.map((m) => m.bm.id)), isNull(dispenseRecords.voidedAt)))
        .orderBy(asc(dispenseRecords.recordedAt))
    : [];
  const stepRecs = await db.select().from(processStepRecords).where(eq(processStepRecords.batchId, batch.id)).orderBy(asc(processStepRecords.stepNo));
  const transitions = await db.select().from(batchStateTransitions).where(eq(batchStateTransitions.batchId, batch.id)).orderBy(asc(batchStateTransitions.at));
  const audits = await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, ctx.organizationId),
        or(eq(auditEvents.entityId, batch.id), and(eq(auditEvents.entityNumber, batch.batchNumber), inArray(auditEvents.entityType, ["dispense_record", "process_step_record", "batch", "process_step_reading", "equipment_use", "packaging_reconciliation", "yield_record", "scrap_rework_record", "production_posting"]))),
      ),
    )
    .orderBy(asc(auditEvents.occurredAt));
  const tests = await db.select().from(testResults).where(eq(testResults.batchId, batch.id)).orderBy(asc(testResults.testedAt));
  const disps = await db
    .select()
    .from(dispositions)
    .where(and(eq(dispositions.organizationId, ctx.organizationId), eq(dispositions.subjectType, "batch"), eq(dispositions.subjectId, batch.id)))
    .orderBy(asc(dispositions.decidedAt));
  const [outputLot] = batch.outputLotId ? await db.select().from(inventoryLots).where(eq(inventoryLots.id, batch.outputLotId)).limit(1) : [];

  const names = await userNames([
    batch.createdBy,
    ...dispenses.flatMap((d) => [d.rec.operatorId, d.rec.checkerId, d.rec.exceptionApprovedBy]),
    ...stepRecs.flatMap((s) => [s.conductedBy, s.checkedBy]),
    ...transitions.map((t) => t.actorId),
    ...audits.map((a) => a.actorId),
    ...tests.map((t) => t.testedBy),
    ...disps.map((d) => d.decidedBy),
  ]);
  const nm = (id: string | null | undefined) => (id ? (names.get(id) ?? "Unknown user") : null);

  const ingredients = mats.map(({ bm, material }) => {
    const { min, max } = toleranceRange(bm.theoreticalQtyG, bm.tolerancePct, bm.toleranceAbsG);
    return {
      id: bm.id,
      lineNo: bm.lineNo,
      materialId: material.id,
      materialCode: material.code,
      materialName: material.name,
      inciName: material.inciName,
      baseUom: material.baseUom,
      theoreticalQtyG: bm.theoreticalQtyG,
      tolerancePct: bm.tolerancePct,
      toleranceAbsG: bm.toleranceAbsG,
      minG: min.toString(),
      maxG: max.toString(),
      dispensedQtyG: bm.dispensedQtyG,
      status: bm.status,
      records: dispenses
        .filter((d) => d.rec.batchMaterialId === bm.id)
        .map((d) => ({
          id: d.rec.id,
          lotNumber: d.lotNumber,
          lotExpiresOn: d.lotExpiresOn,
          locationCode: d.locationCode,
          actualQtyG: d.rec.actualQtyG,
          isWithinTolerance: d.rec.isWithinTolerance,
          scaleCode: d.rec.scaleCode,
          operator: nm(d.rec.operatorId),
          checker: nm(d.rec.checkerId),
          exceptionReason: d.rec.exceptionReason,
          exceptionApprovedBy: nm(d.rec.exceptionApprovedBy),
          isPartial: d.rec.isPartial,
          checkedAt: d.rec.checkedAt,
          recordedAt: d.rec.recordedAt,
        })),
    };
  });

  const steps = [...snapshot.steps]
    .sort((a, z) => a.stepNo - z.stepNo)
    .map((s) => {
      // Only signed-off steps count as done on the record (W2B: in-progress rows exist while a step runs).
      const rec = stepRecs.find((r) => r.stepNo === s.stepNo && r.status === "completed");
      return {
        ...s,
        record: rec ? { conductedBy: nm(rec.conductedBy), checkedBy: nm(rec.checkedBy), readings: rec.readings, completedAt: rec.completedAt } : null,
      };
    });
  const stepsDone = steps.filter((s) => s.record).length;
  const nextStep = steps.find((s) => !s.record) ?? null;

  const totalTheoG = ingredients.reduce((acc, i) => acc.plus(i.theoreticalQtyG), new Decimal(0));
  const totalActualG = ingredients.reduce((acc, i) => acc.plus(i.dispensedQtyG), new Decimal(0));

  return {
    batch,
    product,
    snapshot,
    createdByName: nm(batch.createdBy),
    ingredients,
    totals: { theoreticalG: totalTheoG.toString(), actualG: totalActualG.toString() },
    allWeighed: ingredients.every((i) => i.status !== "pending" && i.status !== "partial"),
    steps,
    stepsDone,
    nextStep,
    transitions: transitions.map((t) => ({ ...t, actor: nm(t.actorId) })),
    audits: audits.map((a) => ({ ...a, actor: nm(a.actorId) })),
    tests: tests.map((t) => ({ ...t, testedByName: nm(t.testedBy) })),
    dispositions: disps.map((d) => ({ ...d, decidedByName: nm(d.decidedBy) })),
    outputLot: outputLot ?? null,
  };
}
export type BatchRecord = Awaited<ReturnType<typeof getBatchRecord>>;

/**
 * Lots the operator may weigh from, per material of the batch: RELEASED, not expired, at the
 * batch site, with stock at a location; FEFO order (earliest expiry first). The server re-checks
 * every rule when posting (assertLotUsable), this list is only guidance.
 */
export async function usableLotsForBatch(ctx: AuthContext, batchId: string) {
  ctx.require("production.batch.view");
  const [b] = await db
    .select({ id: batches.id, siteId: batches.siteId })
    .from(batches)
    .where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId)))
    .limit(1);
  if (!b) throw new DomainError("not_found", "Batch not found.");
  ctx.requireSite(b.siteId);
  const materialIds = (await db.select({ m: batchMaterials.materialId }).from(batchMaterials).where(eq(batchMaterials.batchId, b.id))).map((r) => r.m);
  if (!materialIds.length) return {} as Record<string, LotOption[]>;
  const today = manilaToday();
  const rows = await db
    .select({
      lotId: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      materialId: inventoryLots.materialId,
      expiresOn: inventoryLots.expiresOn,
      supplierLotNumber: inventoryLots.supplierLotNumber,
      locationId: locations.id,
      locationCode: locations.code,
      locationName: locations.name,
      qty: inventoryBalances.qtyBase,
    })
    .from(inventoryLots)
    .innerJoin(inventoryBalances, eq(inventoryBalances.lotId, inventoryLots.id))
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .where(
      and(
        eq(inventoryLots.organizationId, ctx.organizationId),
        eq(inventoryLots.siteId, b.siteId),
        eq(inventoryLots.itemKind, "material"),
        inArray(inventoryLots.materialId, materialIds),
        eq(inventoryLots.qualityStatus, "released"),
        or(isNull(inventoryLots.expiresOn), sql`${inventoryLots.expiresOn} >= ${today}`),
        gt(inventoryBalances.qtyBase, "0"),
      ),
    )
    .orderBy(sql`${inventoryLots.expiresOn} asc nulls last`, asc(inventoryLots.lotNumber), asc(locations.code));
  // W2A staging: stock staged (reserved) for this batch is recommended first, at its staging location.
  const staged = await db
    .select({ lotId: stockReservations.lotId, locationId: stockReservations.locationId })
    .from(stockReservations)
    .where(and(eq(stockReservations.demandType, "batch"), eq(stockReservations.demandId, b.id), eq(stockReservations.status, "active")));
  const isStaged = (r: { lotId: string; locationId: string }) => staged.some((x) => x.lotId === r.lotId && (!x.locationId || x.locationId === r.locationId));
  const ordered = [...rows.filter(isStaged), ...rows.filter((r) => !isStaged(r))];
  const out: Record<string, LotOption[]> = {};
  for (const r of ordered) {
    (out[r.materialId!] ??= []).push({
      lotId: r.lotId,
      lotNumber: r.lotNumber,
      expiresOn: r.expiresOn,
      supplierLotNumber: r.supplierLotNumber,
      locationId: r.locationId,
      locationCode: r.locationCode,
      locationName: r.locationName,
      qty: r.qty,
    });
  }
  return out;
}
export type LotOption = {
  lotId: string;
  lotNumber: string;
  expiresOn: string | null;
  supplierLotNumber: string | null;
  locationId: string;
  locationCode: string;
  locationName: string;
  qty: string;
};

/** People who may sign as checker at the batch site, excluding the signed-in user. */
export async function checkerOptions(ctx: AuthContext, siteId: string) {
  ctx.requireSite(siteId);
  const list = await eligibleCheckers(db, ctx.organizationId, siteId);
  const others = list.filter((u) => u.id !== ctx.userId);
  return ctx.ownerOverride ? [{ ...list.find((u) => u.id === ctx.userId), id: ctx.userId, displayName: `${ctx.displayName} (you)` } as (typeof list)[number], ...others] : others;
}

/**
 * Approved formula revisions available for a new batch, with their product and the routing that
 * will be snapshotted (resolution happens again at creation for the planned date).
 */
export async function approvedFormulaOptions(ctx: AuthContext) {
  ctx.require("production.batch.create");
  const rows = await approvedFormulaRevisionOptions(ctx);
  const today = manilaToday();
  const out = [];
  for (const r of rows) {
    const routing = await getEffectiveRouting(ctx, r.productId, r.effectiveFrom && r.effectiveFrom > today ? r.effectiveFrom : today);
    out.push({ ...r, stepCount: routing?.steps.length ?? 0, routingLabel: routing ? `${routing.routing.code} rev ${routing.rev.revisionNo}` : null });
  }
  return out;
}

/** Products with finished-goods stock on hand in the caller's sites (all statuses and released). */
export async function listProducts(ctx: AuthContext) {
  ctx.require("masterdata.product.view");
  const rows = await db.select().from(products).where(eq(products.organizationId, ctx.organizationId)).orderBy(asc(products.skuCode));
  const stock = await db
    .select({
      productId: inventoryLots.productId,
      onHand: sql<string>`coalesce(sum(${inventoryBalances.qtyBase}), 0)::text`,
      released: sql<string>`coalesce(sum(case when ${inventoryLots.qualityStatus} = 'released' and (${inventoryLots.expiresOn} is null or ${inventoryLots.expiresOn} >= ${manilaToday()}) then ${inventoryBalances.qtyBase} else 0 end), 0)::text`,
    })
    .from(inventoryBalances)
    .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
    .where(and(eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.itemKind, "product"), inArray(inventoryBalances.siteId, ctx.allowedSiteIds)))
    .groupBy(inventoryLots.productId);
  return rows.map((p) => {
    const s = stock.find((x) => x.productId === p.id);
    return { ...p, onHand: s?.onHand ?? "0", released: s?.released ?? "0" };
  });
}

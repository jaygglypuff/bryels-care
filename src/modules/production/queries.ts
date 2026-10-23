import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import {
  auditEvents,
  batchMaterials,
  batchStateTransitions,
  batches,
  bomLines,
  dispenseRecords,
  dispositions,
  formulaRevisions,
  formulas,
  inventoryBalances,
  inventoryLots,
  locations,
  materials,
  processStepRecords,
  products,
  routingSteps,
  testResults,
  users,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
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
      stepsDone: sql<number>`(select count(*)::int from ${processStepRecords} where ${processStepRecords.batchId} = ${batches.id})`,
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
        .where(inArray(dispenseRecords.batchMaterialId, mats.map((m) => m.bm.id)))
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
        or(eq(auditEvents.entityId, batch.id), and(eq(auditEvents.entityNumber, batch.batchNumber), inArray(auditEvents.entityType, ["dispense_record", "process_step_record", "batch"]))),
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
    ...dispenses.flatMap((d) => [d.rec.operatorId, d.rec.checkerId]),
    ...stepRecs.flatMap((s) => [s.conductedBy, s.checkedBy]),
    ...transitions.map((t) => t.actorId),
    ...audits.map((a) => a.actorId),
    ...tests.map((t) => t.testedBy),
    ...disps.map((d) => d.decidedBy),
  ]);
  const nm = (id: string | null | undefined) => (id ? (names.get(id) ?? "Unknown user") : null);

  const ingredients = mats.map(({ bm, material }) => {
    const { min, max } = toleranceRange(bm.theoreticalQtyG, bm.tolerancePct);
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
          recordedAt: d.rec.recordedAt,
        })),
    };
  });

  const steps = [...snapshot.steps]
    .sort((a, z) => a.stepNo - z.stepNo)
    .map((s) => {
      const rec = stepRecs.find((r) => r.stepNo === s.stepNo);
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
    allWeighed: ingredients.every((i) => i.status !== "pending"),
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
  const out: Record<string, LotOption[]> = {};
  for (const r of rows) {
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
  return list.filter((u) => u.id !== ctx.userId);
}

/** Approved formula revisions available for a new batch, with their product. */
export async function approvedFormulaOptions(ctx: AuthContext) {
  ctx.require("production.batch.create");
  const rows = await db
    .select({
      revisionId: formulaRevisions.id,
      revisionNo: formulaRevisions.revisionNo,
      referenceBatchSizeG: formulaRevisions.referenceBatchSizeG,
      theoreticalYieldPct: formulaRevisions.theoreticalYieldPct,
      formulaCode: formulas.code,
      formulaName: formulas.name,
      productId: products.id,
      productName: products.name,
      productSku: products.skuCode,
      lineCount: sql<number>`(select count(*)::int from ${bomLines} where ${bomLines.formulaRevisionId} = ${formulaRevisions.id})`,
      stepCount: sql<number>`(select count(*)::int from ${routingSteps} where ${routingSteps.formulaRevisionId} = ${formulaRevisions.id})`,
    })
    .from(formulaRevisions)
    .innerJoin(formulas, eq(formulas.id, formulaRevisions.formulaId))
    .innerJoin(products, eq(products.id, formulas.productId))
    .where(and(eq(formulas.organizationId, ctx.organizationId), eq(formulaRevisions.status, "approved")))
    .orderBy(asc(products.name), desc(formulaRevisions.revisionNo));
  return rows;
}

/** Formula list (organization master data) with the latest approved revision summary. */
export async function listFormulas(ctx: AuthContext) {
  ctx.require("masterdata.formula.view");
  const rows = await db
    .select({
      formulaId: formulas.id,
      code: formulas.code,
      name: formulas.name,
      productName: products.name,
      productSku: products.skuCode,
      revisionId: formulaRevisions.id,
      revisionNo: formulaRevisions.revisionNo,
      status: formulaRevisions.status,
      referenceBatchSizeG: formulaRevisions.referenceBatchSizeG,
      theoreticalYieldPct: formulaRevisions.theoreticalYieldPct,
      lineCount: sql<number>`(select count(*)::int from ${bomLines} where ${bomLines.formulaRevisionId} = ${formulaRevisions.id})`,
    })
    .from(formulas)
    .innerJoin(products, eq(products.id, formulas.productId))
    .leftJoin(formulaRevisions, eq(formulaRevisions.formulaId, formulas.id))
    .where(eq(formulas.organizationId, ctx.organizationId))
    .orderBy(asc(formulas.code), desc(formulaRevisions.revisionNo));
  // One row per formula: the approved revision if any, otherwise the latest.
  const byFormula = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const cur = byFormula.get(r.formulaId);
    if (!cur || (cur.status !== "approved" && r.status === "approved")) byFormula.set(r.formulaId, r);
  }
  return [...byFormula.values()];
}

export async function getFormula(ctx: AuthContext, formulaId: string) {
  ctx.require("masterdata.formula.view");
  const [f] = await db
    .select({ formula: formulas, product: products })
    .from(formulas)
    .innerJoin(products, eq(products.id, formulas.productId))
    .where(and(eq(formulas.id, formulaId), eq(formulas.organizationId, ctx.organizationId)))
    .limit(1);
  if (!f) return null;
  const revisions = await db.select().from(formulaRevisions).where(eq(formulaRevisions.formulaId, f.formula.id)).orderBy(desc(formulaRevisions.revisionNo));
  const current = revisions.find((r) => r.status === "approved") ?? revisions[0] ?? null;
  const lines = current
    ? await db
        .select({ line: bomLines, material: materials })
        .from(bomLines)
        .innerJoin(materials, eq(materials.id, bomLines.materialId))
        .where(eq(bomLines.formulaRevisionId, current.id))
        .orderBy(asc(bomLines.lineNo))
    : [];
  const steps = current ? await db.select().from(routingSteps).where(eq(routingSteps.formulaRevisionId, current.id)).orderBy(asc(routingSteps.stepNo)) : [];
  const names = await userNames(revisions.flatMap((r) => [r.submittedBy, r.approvedBy]));
  return {
    ...f,
    revisions: revisions.map((r) => ({ ...r, submittedByName: r.submittedBy ? names.get(r.submittedBy) : null, approvedByName: r.approvedBy ? names.get(r.approvedBy) : null })),
    current,
    lines,
    steps,
  };
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

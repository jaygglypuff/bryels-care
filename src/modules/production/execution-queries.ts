import "server-only";
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import {
  batchMaterials,
  batchOutputs,
  batches,
  dispenseRecords,
  equipment,
  equipmentUses,
  inventoryBalances,
  inventoryLots,
  locations,
  materials,
  processStepReadings,
  productionPostings,
  products,
  scrapReworkRecords,
  users,
  yieldRecords,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
import { businessToday, deriveAvailability, equipmentAvailability, reasonCodeOptions } from "@/modules/masterdata";
import { type SnapshotStep, type StepRecord, eligibleSigners, routingStepDetails, sortedSteps, stepRecords } from "./execution";
import { currentChecklistAnswers } from "./line-clearance";
import { currentPackaging } from "./packaging";
import { currentReadings, limitsLabel } from "./process";
import { type FormulaSnapshot, manilaToday } from "./shared";
import { stepBlockers } from "./steps";
import { transferBlockers } from "./output";
import { yieldLimits } from "./yield";

async function names(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, r.n]));
}

/**
 * Everything the batch workspace (operator mode) needs to run the steps, scoped to the caller's
 * sites: per step its record, checklist answers, readings, equipment uses, packaging rows and the
 * blockers of the current step; weighings with check and void state; yield, scrap, outputs and
 * postings; and the transfer blockers.
 */
export async function getBatchExecution(ctx: AuthContext, batchId: string) {
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
  const recs = await stepRecords(db, batch.id);
  const recIds = recs.map((r) => r.id);
  const uses = recIds.length
    ? await db
        .select({ use: equipmentUses, code: equipment.code, name: equipment.name })
        .from(equipmentUses)
        .innerJoin(equipment, eq(equipment.id, equipmentUses.equipmentId))
        .where(eq(equipmentUses.batchId, batch.id))
        .orderBy(asc(equipmentUses.startedAt))
    : [];
  const allReadings = recIds.length ? await db.select().from(processStepReadings).where(inArray(processStepReadings.processStepRecordId, recIds)).orderBy(asc(processStepReadings.recordedAt)) : [];
  const pkg = await currentPackaging(db, batch.id);

  const lines = await db
    .select({ bm: batchMaterials, m: materials })
    .from(batchMaterials)
    .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
    .where(eq(batchMaterials.batchId, batch.id))
    .orderBy(asc(batchMaterials.lineNo));
  const disp = lines.length
    ? await db
        .select({ d: dispenseRecords, lotNumber: inventoryLots.lotNumber, lotExpiresOn: inventoryLots.expiresOn, locationCode: locations.code })
        .from(dispenseRecords)
        .innerJoin(inventoryLots, eq(inventoryLots.id, dispenseRecords.lotId))
        .innerJoin(locations, eq(locations.id, dispenseRecords.fromLocationId))
        .where(inArray(dispenseRecords.batchMaterialId, lines.map((l) => l.bm.id)))
        .orderBy(asc(dispenseRecords.recordedAt))
    : [];
  const yields = await db.select().from(yieldRecords).where(eq(yieldRecords.batchId, batch.id)).orderBy(asc(yieldRecords.recordedAt));
  const scrap = await db.select().from(scrapReworkRecords).where(eq(scrapReworkRecords.batchId, batch.id)).orderBy(asc(scrapReworkRecords.recordedAt));
  const outputs = await db
    .select({ o: batchOutputs, lotNumber: inventoryLots.lotNumber, expiresOn: inventoryLots.expiresOn, qualityStatus: inventoryLots.qualityStatus, locationCode: locations.code })
    .from(batchOutputs)
    .leftJoin(inventoryLots, eq(inventoryLots.id, batchOutputs.lotId))
    .innerJoin(locations, eq(locations.id, batchOutputs.toLocationId))
    .where(eq(batchOutputs.batchId, batch.id));
  const postings = await db
    .select({ type: productionPostings.postingType, n: sql<number>`count(*)::int` })
    .from(productionPostings)
    .where(eq(productionPostings.batchId, batch.id))
    .groupBy(productionPostings.postingType);

  const nm = await names([
    ...recs.flatMap((r) => [r.conductedBy, r.checkedBy, r.exceptionApprovedBy]),
    ...disp.flatMap((d) => [d.d.operatorId, d.d.checkerId, d.d.exceptionApprovedBy, d.d.voidedBy]),
    ...allReadings.map((r) => r.recordedBy),
    ...uses.map((u) => u.use.operatorId),
    ...pkg.flatMap((p) => [p.r.issuedBy, p.r.countedBy]),
    ...yields.flatMap((y) => [y.recordedBy, y.approvedBy]),
    ...scrap.flatMap((s) => [s.recordedBy, s.decidedBy]),
  ]);
  const n = (id: string | null | undefined) => (id ? (nm.get(id) ?? "Unknown user") : null);

  const ordered = sortedSteps(snapshot);
  const current = ordered.find((s) => recs.find((r) => r.stepNo === s.stepNo)?.status !== "completed") ?? null;

  const steps = [];
  for (const s of ordered) {
    const rec = recs.find((r) => r.stepNo === s.stepNo) ?? null;
    const answers = rec ? await currentChecklistAnswers(db, rec.id) : [];
    const readings = rec ? await currentReadings(db, rec.id) : [];
    const details = await routingStepDetails(db, s.routingStepId);
    const isCurrent = current?.stepNo === s.stepNo && (batch.status === "in_process" || batch.status === "materials_staged");
    const blockers = isCurrent && s.stepKind !== "transfer" ? await stepBlockers(db, ctx, batch, s, rec) : [];
    steps.push({
      ...s,
      minDurationMinutes: details.minDurationMinutes,
      recordMode: details.recordMode,
      hasInspectionPlan: !!details.inspectionPlanId,
      isCurrent,
      status: (rec?.status ?? "pending") as string,
      record: rec ? recordView(rec, n) : null,
      checklist: (s.checklistItems ?? []).map((it) => {
        const a = answers.find((x) => x.routingStepChecklistItemId === it.id);
        return { ...it, answer: a?.answer ?? null, note: a?.note ?? null, photoAttachmentId: a?.photoAttachmentId ?? null, answeredBy: n(a?.answeredBy), answeredAt: a?.answeredAt ?? null };
      }),
      parameters: (s.parameters ?? []).map((p) => {
        const r = readings.find((x) => x.routingStepParameterId === p.id);
        const history = rec ? allReadings.filter((x) => x.processStepRecordId === rec.id && x.routingStepParameterId === p.id) : [];
        return {
          ...p,
          limits: limitsLabel(p),
          reading: r
            ? { id: r.id, value: r.valueNumeric !== null ? new Decimal(r.valueNumeric).toString() : (r.valueText ?? (r.valueBoolean ? "yes" : "no")), isWithinLimits: r.isWithinLimits, recordedBy: n(r.recordedBy), recordedAt: r.recordedAt, correctionReason: r.correctionReason }
            : null,
          corrections: Math.max(0, history.length - 1),
        };
      }),
      equipmentUses: rec
        ? uses
            .filter((u) => u.use.processStepRecordId === rec.id)
            .map((u) => ({ id: u.use.id, code: u.code, name: u.name, startedAt: u.use.startedAt, endedAt: u.use.endedAt, reasons: u.use.availabilityReasons ?? [], override: !!u.use.overrideRequestId, deviationId: u.use.deviationId, operator: n(u.use.operatorId), calibrationDue: u.use.calibrationDueDateAtUse }))
        : [],
      packaging: rec
        ? pkg
            .filter((p) => p.r.processStepRecordId === rec.id)
            .map((p) => ({
              id: p.r.id,
              materialCode: p.materialCode,
              materialName: p.materialName,
              lotNumber: p.lotNumber,
              locationCode: p.locationCode,
              uom: p.r.baseUom,
              issued: p.r.issuedQty,
              used: p.r.usedQty,
              damaged: p.r.damagedQty,
              returned: p.r.returnedQty,
              variance: p.r.varianceQty,
              tolerance: p.r.toleranceQty,
              within: p.r.isWithinTolerance,
              counted: !!p.r.countedAt,
              posted: !!p.r.productionPostingId,
              issuedBy: n(p.r.issuedBy),
              countedBy: n(p.r.countedBy),
              recount: !!p.r.supersedesId,
            }))
        : [],
      blockers,
    });
  }

  // ADR-088 §3: packaging lines are not weighed; they are issued at the packaging step.
  const ingredients = lines.filter(({ m }) => m.materialKind !== "packaging").map(({ bm, m }) => ({
    id: bm.id,
    lineNo: bm.lineNo,
    materialCode: m.code,
    materialName: m.name,
    baseUom: m.baseUom,
    status: bm.status,
    dispensedQtyG: bm.dispensedQtyG,
    theoreticalQtyG: bm.theoreticalQtyG,
    weighings: disp
      .filter((d) => d.d.batchMaterialId === bm.id)
      .map((d) => ({
        id: d.d.id,
        sequence: d.d.sequence,
        lotNumber: d.lotNumber,
        lotExpiresOn: d.lotExpiresOn,
        locationCode: d.locationCode,
        qtyG: d.d.actualQtyG,
        entered: d.d.enteredQty && d.d.enteredUom ? `${new Decimal(d.d.enteredQty).toString()} ${d.d.enteredUom}` : null,
        tareG: d.d.tareQtyG,
        grossG: d.d.grossQtyG,
        partial: d.d.isPartial,
        within: d.d.isWithinTolerance,
        scale: d.d.scaleCode,
        operatorId: d.d.operatorId,
        operator: n(d.d.operatorId),
        checker: n(d.d.checkerId),
        checkedAt: d.d.checkedAt,
        exceptionApprovedBy: n(d.d.exceptionApprovedBy),
        exceptionReason: d.d.exceptionReason,
        deviationId: d.d.deviationId,
        voided: !!d.d.voidedAt,
        voidReason: d.d.voidReason,
        voidedBy: n(d.d.voidedBy),
        supersedesId: d.d.supersedesId,
        correctionReason: d.d.correctionReason,
        posted: !!d.d.productionPostingId,
        recordedAt: d.d.recordedAt,
      })),
  }));

  const cy = yields.find((y) => y.isCurrent) ?? null;
  const limits = await yieldLimits(db, ctx.organizationId, batch.siteId, product.skuCode);
  // Scrap and rework reasons (shared reason codes; one list in the form, validated per kind).
  const reasonCodes = [...(await reasonCodeOptions(db, ctx.organizationId, "scrap")), ...(await reasonCodeOptions(db, ctx.organizationId, "rework"))]
    .filter((r, i, all) => all.findIndex((x) => x.code === r.code) === i)
    .map((r) => ({ code: r.code, label: r.label }));
  const postAtDispense = await getSetting(db, ctx.organizationId, "production.post_consumption_at_dispense", batch.siteId);
  const transferStep = ordered.find((s) => s.stepKind === "transfer") ?? null;
  const readyForTransfer = batch.status === "in_process" && ordered.filter((s) => s.stepKind !== "transfer").every((s) => recs.find((r) => r.stepNo === s.stepNo)?.status === "completed");

  return {
    batch,
    product,
    snapshot,
    steps,
    currentStepNo: current?.stepNo ?? null,
    stepsCompleted: steps.filter((s) => s.status === "completed").length,
    ingredients,
    yieldRecord: cy
      ? { ...cy, recordedByName: n(cy.recordedBy), approvedByName: n(cy.approvedBy) }
      : null,
    yieldHistory: yields.filter((y) => !y.isCurrent).map((y) => ({ id: y.id, actualUnits: y.actualUnits, yieldPct: y.yieldPct, recordedBy: n(y.recordedBy), recordedAt: y.recordedAt })),
    yieldLimits: limits,
    scrap: scrap.map((s) => ({ ...s, recordedByName: n(s.recordedBy), decidedByName: n(s.decidedBy), reasonLabel: reasonCodes.find((c) => c.code === s.reasonCode)?.label ?? s.reasonCode })),
    reasonCodes,
    outputs: outputs.map((o) => ({ ...o.o, lotNumber: o.lotNumber, expiresOn: o.expiresOn, qualityStatus: o.qualityStatus, locationCode: o.locationCode })),
    postings: Object.fromEntries(postings.map((p) => [p.type, p.n])) as Record<string, number>,
    postAtDispense,
    transferStep,
    readyForTransfer,
    transferBlockers: readyForTransfer ? await transferBlockers(batch) : [],
  };
}
export type BatchExecution = Awaited<ReturnType<typeof getBatchExecution>>;
export type ExecStep = BatchExecution["steps"][number];

function recordView(rec: StepRecord, n: (id: string | null | undefined) => string | null) {
  return {
    id: rec.id,
    status: rec.status,
    conductedBy: n(rec.conductedBy),
    conductedById: rec.conductedBy,
    checkedBy: n(rec.checkedBy),
    startedAt: rec.startedAt,
    performedAt: rec.performedAt,
    completedAt: rec.completedAt,
    checkedAt: rec.checkedAt,
    earliestCompletionAt: rec.earliestCompletionAt,
    blockedReason: rec.blockedReason,
    notes: rec.notes,
    readings: rec.readings,
    exceptionApprovedBy: n(rec.exceptionApprovedBy),
    exceptionReason: rec.exceptionReason,
    deviationId: rec.deviationId,
  };
}

/** Equipment of a kind at a site with derived availability and any approved override (selection list). */
export async function equipmentOptions(ctx: AuthContext, siteId: string, kind: string | null) {
  ctx.requireSite(siteId);
  if (!ctx.can("production.equipment_use.create") && !ctx.can("masterdata.equipment.view")) return [];
  const rows = await db
    .select()
    .from(equipment)
    .where(and(eq(equipment.organizationId, ctx.organizationId), eq(equipment.siteId, siteId), kind ? eq(equipment.equipmentKind, kind) : undefined))
    .orderBy(asc(equipment.code));
  const today = businessToday();
  const out = [];
  for (const e of rows) {
    const av = deriveAvailability(e, today);
    const full = av.selectable ? null : await equipmentAvailability(ctx, e.id);
    out.push({
      id: e.id,
      code: e.code,
      name: e.name,
      kind: e.equipmentKind,
      calibrationDueDate: e.calibrationDueDate,
      capacity: e.capacityMax ? `${e.capacityMin ?? "0"}–${e.capacityMax} ${e.capacityUom ?? ""}`.trim() : null,
      usable: av.selectable || !!full?.override,
      viaOverride: !av.selectable && !!full?.override,
      reasons: av.reasons.map((r) => r.detail),
      blocking: av.blockingReasons.map((r) => r.detail),
    });
  }
  return out;
}

/** Released, unexpired packaging-material lots with stock at a site, FEFO (guidance; the server re-checks on issue). */
export async function packagingLotOptions(ctx: AuthContext, siteId: string) {
  ctx.requireSite(siteId);
  const today = manilaToday();
  return db
    .select({ lotId: inventoryLots.id, lotNumber: inventoryLots.lotNumber, materialCode: materials.code, materialName: materials.name, expiresOn: inventoryLots.expiresOn, locationId: locations.id, locationCode: locations.code, locationName: locations.name, qty: inventoryBalances.qtyBase, uom: inventoryLots.baseUom })
    .from(inventoryLots)
    .innerJoin(materials, eq(materials.id, inventoryLots.materialId))
    .innerJoin(inventoryBalances, eq(inventoryBalances.lotId, inventoryLots.id))
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .where(
      and(
        eq(inventoryLots.organizationId, ctx.organizationId),
        eq(inventoryLots.siteId, siteId),
        eq(materials.materialKind, "packaging"),
        eq(inventoryLots.qualityStatus, "released"),
        or(isNull(inventoryLots.expiresOn), sql`${inventoryLots.expiresOn} >= ${today}`),
        gt(inventoryBalances.qtyBase, "0"),
      ),
    )
    .orderBy(sql`${inventoryLots.expiresOn} asc nulls last`, asc(inventoryLots.lotNumber));
}

/** People who may co-sign at a site with a permission, excluding the signed-in user. */
export async function signerOptions(ctx: AuthContext, siteId: string, permission: Permission) {
  ctx.requireSite(siteId);
  const list = await eligibleSigners(db, ctx.organizationId, siteId, permission);
  const others = list.filter((u) => u.id !== ctx.userId);
  // ADR-073: under the owner override the owner may sign their own work (recorded as an override).
  return ctx.ownerOverride ? [{ ...list.find((u) => u.id === ctx.userId), id: ctx.userId, displayName: `${ctx.displayName} (you)` } as (typeof list)[number], ...others] : others;
}

export type { SnapshotStep };

/** Site of a batch in the caller's scope (used to scope a co-signature). */
export async function batchSiteId(ctx: AuthContext, batchId: string) {
  const [b] = await db.select({ siteId: batches.siteId }).from(batches).where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId))).limit(1);
  if (!b) throw new DomainError("not_found", "Batch not found.");
  ctx.requireSite(b.siteId);
  return b.siteId;
}

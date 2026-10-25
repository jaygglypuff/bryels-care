import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import Decimal from "decimal.js";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  batches,
  containers,
  deviations,
  inspectionPlanTests,
  inspectionPlans,
  inspectionSamples,
  inspectionStateTransitions,
  inspections,
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
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { postMovement } from "@/modules/inventory/ledger";
import { equipmentAvailability, getInspectionPlan } from "@/modules/masterdata";
import { paperRecordBlockers, transitionBatch } from "@/modules/production";
import { openDeviation } from "./deviations";
import {
  INSPECTION_OPEN_STATUSES,
  INSPECTION_STATUS_LABEL,
  canInspectionTransition,
  evaluateResult,
  liveResults,
  missingRequiredTests,
  specLabel,
  type InspectionStatus,
  type PlanTest,
} from "./inspection-rules";
import { assertUuid, isUuid, manilaToday, optionalText, reasonText, withIdempotency } from "./shared";

/**
 * Inspections, sampling and append-only test results (US-3-14, process map W06-01..04).
 * Every inspection points at a QA-approved inspection plan revision: the batch's frozen plan
 * (batches.inspection_plan_id, W1D snapshot) or, for an incoming material lot, the plan effective
 * today. Results are evaluated against that plan; corrections append a superseding row.
 */

type InspectionRow = typeof inspections.$inferSelect;
const tester = alias(users, "tester_user");

/** Batch statuses in which a batch inspection may be started or worked on. */
const INSPECTABLE_BATCH_STATUSES = ["in_process", "awaiting_qc", "quarantined"];

async function writeTransition(tx: Tx, ctx: AuthContext, ins: { id: string; siteId: string }, from: string | null, to: string, reason: string | null) {
  await tx.insert(inspectionStateTransitions).values({ organizationId: ctx.organizationId, siteId: ins.siteId, inspectionId: ins.id, fromState: from, toState: to, actorId: ctx.userId, reason });
}

/** Moves an inspection through the §6.6 table (caller holds the row lock), with transition row. */
async function moveInspection(tx: Tx, ctx: AuthContext, ins: InspectionRow, to: InspectionStatus, reason: string | null, set: Partial<typeof inspections.$inferInsert> = {}) {
  if (!canInspectionTransition(ins.status, to)) {
    throw new DomainError("state", `Inspection ${ins.inspectionNumber} is ${INSPECTION_STATUS_LABEL[ins.status]?.toLowerCase() ?? ins.status}; it cannot move to ${INSPECTION_STATUS_LABEL[to].toLowerCase()}.`);
  }
  await tx
    .update(inspections)
    .set({ ...set, status: to, statusChangedAt: new Date(), statusChangedBy: ctx.userId })
    .where(eq(inspections.id, ins.id));
  await writeTransition(tx, ctx, ins, ins.status, to, reason);
  ins.status = to;
}

export async function planTests(q: DbOrTx, planId: string): Promise<PlanTest[]> {
  const rows = await q.select().from(inspectionPlanTests).where(eq(inspectionPlanTests.inspectionPlanId, planId)).orderBy(asc(inspectionPlanTests.sequence));
  return rows.map((r) => ({ id: r.id, testCode: r.testCode, name: r.name, method: r.method, valueKind: r.valueKind, uom: r.uom, specMin: r.specMin, specMax: r.specMax, specText: r.specText, isRequired: r.isRequired, sequence: r.sequence }));
}

async function lockInspection(tx: Tx, ctx: AuthContext, inspectionId: string) {
  assertUuid(inspectionId, "Inspection");
  const [ins] = await tx.select().from(inspections).where(and(eq(inspections.id, inspectionId), eq(inspections.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!ins || !ctx.allowedSiteIds.includes(ins.siteId)) throw new DomainError("not_found", "Inspection not found in your sites.");
  ctx.requireSite(ins.siteId);
  return ins;
}

/* ------------------------------------------------------------------ create */

export type InspectionSubject =
  | { batchId: string; lotId?: never; processStepRecordId?: never }
  | { lotId: string; batchId?: never; processStepRecordId?: never }
  /** In-process inspection of one executed routing step (W05-12): the step's own inspection plan. */
  | { batchId: string; processStepRecordId: string; lotId?: never };

/**
 * Creates (or returns the live) inspection for a subject inside the caller's transaction. Used by
 * createInspection and by the production stream at the trigger (US-3-13 output posting) through
 * ensureBatchInspection. Serializes on the subject row lock; the partial unique index backs it up.
 */
async function createInspectionTx(tx: Tx, ctx: AuthContext, subject: InspectionSubject, opts: { idempotencyKey?: string | null } = {}) {
  const now = new Date();
  let siteId: string;
  let planId: string;
  let kind: string;
  let lotId: string | null = null;
  let batchId: string | null = null;
  let label: string;
  let stepRecordId: string | null = null;

  if (subject.batchId && subject.processStepRecordId) {
    assertUuid(subject.batchId, "Batch");
    assertUuid(subject.processStepRecordId, "Step");
    const [b] = await tx.select().from(batches).where(and(eq(batches.id, subject.batchId), eq(batches.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!b || !ctx.allowedSiteIds.includes(b.siteId)) throw new DomainError("not_found", "Batch not found in your sites.");
    ctx.requireSite(b.siteId);
    if (b.status !== "in_process") throw new DomainError("state", `Batch ${b.batchNumber} is ${b.status.replace(/_/g, " ")}; in-process inspections are recorded while it is in process.`);
    const [rec] = await tx
      .select({ id: processStepRecords.id, batchId: processStepRecords.batchId, stepNo: processStepRecords.stepNo, name: processStepRecords.name, planId: routingSteps.inspectionPlanId })
      .from(processStepRecords)
      .innerJoin(routingSteps, eq(routingSteps.id, processStepRecords.routingStepId))
      .where(eq(processStepRecords.id, subject.processStepRecordId))
      .limit(1);
    if (!rec || rec.batchId !== b.id) throw new DomainError("not_found", "Step not found on this batch.");
    if (!rec.planId) throw new DomainError("state", `Step ${rec.stepNo} (${rec.name}) has no in-process inspection plan in its routing.`);
    const [plan] = await tx.select().from(inspectionPlans).where(eq(inspectionPlans.id, rec.planId)).limit(1);
    if (!plan || plan.status === "draft") throw new DomainError("state", `The in-process inspection plan of step ${rec.stepNo} is not approved.`);
    siteId = b.siteId;
    planId = plan.id;
    kind = "in_process";
    batchId = b.id;
    lotId = null;
    stepRecordId = rec.id;
    label = `${b.batchNumber} step ${rec.stepNo}`;
    const [live] = await tx
      .select()
      .from(inspections)
      .where(and(eq(inspections.processStepRecordId, rec.id), eq(inspections.inspectionPlanId, plan.id), ne(inspections.status, "cancelled")))
      .limit(1);
    if (live) return { inspectionId: live.id, inspectionNumber: live.inspectionNumber, created: false };
  } else if (subject.batchId) {
    assertUuid(subject.batchId, "Batch");
    const [b] = await tx.select().from(batches).where(and(eq(batches.id, subject.batchId), eq(batches.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!b || !ctx.allowedSiteIds.includes(b.siteId)) throw new DomainError("not_found", "Batch not found in your sites.");
    ctx.requireSite(b.siteId);
    if (!INSPECTABLE_BATCH_STATUSES.includes(b.status)) throw new DomainError("state", `Batch ${b.batchNumber} is ${b.status.replace(/_/g, " ")}; inspections are recorded while it is in process or awaiting QC.`);
    if (!b.inspectionPlanId) {
      throw new DomainError(
        "state",
        `Batch ${b.batchNumber} has no frozen inspection plan (no approved finished-product plan was effective when it was created). Record its results on the batch release page.`,
      );
    }
    const [plan] = await tx.select().from(inspectionPlans).where(eq(inspectionPlans.id, b.inspectionPlanId)).limit(1);
    siteId = b.siteId;
    planId = plan.id;
    kind = plan.planKind;
    batchId = b.id;
    lotId = b.outputLotId;
    label = b.batchNumber;
    const [live] = await tx
      .select()
      .from(inspections)
      .where(and(eq(inspections.batchId, b.id), eq(inspections.inspectionPlanId, plan.id), isNull(inspections.processStepRecordId), ne(inspections.status, "cancelled")))
      .limit(1);
    if (live) return { inspectionId: live.id, inspectionNumber: live.inspectionNumber, created: false };
  } else if (subject.lotId) {
    assertUuid(subject.lotId, "Lot");
    const [lot] = await tx.select().from(inventoryLots).where(and(eq(inventoryLots.id, subject.lotId), eq(inventoryLots.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!lot || !ctx.allowedSiteIds.includes(lot.siteId)) throw new DomainError("not_found", "Lot not found in your sites.");
    ctx.requireSite(lot.siteId);
    if (lot.itemKind !== "material" || !lot.materialId) throw new DomainError("state", `Lot ${lot.lotNumber} is a finished-goods lot; it is inspected through its batch.`);
    if (!["quarantine", "on_hold"].includes(lot.qualityStatus)) throw new DomainError("state", `Lot ${lot.lotNumber} is ${lot.qualityStatus.replace("_", " ")}; incoming inspections are for quarantined or held lots.`);
    const plan = await getInspectionPlan(ctx, { planKind: "incoming", materialId: lot.materialId, date: manilaToday(now) }, { tx });
    if (!plan) {
      const [m] = await tx.select({ name: materials.name }).from(materials).where(eq(materials.id, lot.materialId)).limit(1);
      throw new DomainError("state", `There is no approved incoming inspection plan for ${m?.name ?? "this material"}. QA must approve one first (Inspection plans).`);
    }
    siteId = lot.siteId;
    planId = plan.plan.id;
    kind = "incoming";
    lotId = lot.id;
    label = lot.lotNumber;
    const [live] = await tx
      .select()
      .from(inspections)
      .where(and(eq(inspections.lotId, lot.id), sql`${inspections.batchId} is null`, eq(inspections.inspectionPlanId, plan.plan.id), ne(inspections.status, "cancelled")))
      .limit(1);
    if (live) return { inspectionId: live.id, inspectionNumber: live.inspectionNumber, created: false };
  } else {
    throw new DomainError("validation", "Choose the lot or batch to inspect.");
  }

  const dueHours = await getSetting(tx, ctx.organizationId, "quality.inspection.due_hours", siteId);
  const inspectionNumber = await nextNumber(tx, ctx.organizationId, "INS");
  const [ins] = await tx
    .insert(inspections)
    .values({
      organizationId: ctx.organizationId,
      siteId,
      inspectionNumber,
      status: "pending",
      inspectionKind: kind,
      inspectionPlanId: planId,
      lotId,
      batchId,
      processStepRecordId: stepRecordId,
      dueAt: new Date(now.getTime() + dueHours * 3600_000),
      createdBy: ctx.userId,
      statusChangedBy: ctx.userId,
      idempotencyKey: opts.idempotencyKey ?? null,
    })
    .returning();
  await writeTransition(tx, ctx, ins, null, "pending", null);
  await audit(tx, ctx, {
    action: "quality.inspection.created",
    entityType: "inspection",
    entityId: ins.id,
    entityNumber: inspectionNumber,
    siteId,
    after: { kind, subject: label, batchId, lotId, processStepRecordId: stepRecordId, inspectionPlanId: planId },
  });
  return { inspectionId: ins.id, inspectionNumber, created: true };
}

/** Starts the inspection of a batch (its frozen plan) or of a quarantined material lot (plan effective today). */
export async function createInspection(ctx: AuthContext, input: { batchId?: string | null; lotId?: string | null; processStepRecordId?: string | null; idempotencyKey?: string | null }) {
  ctx.require("quality.inspection.create");
  if (!!input.batchId === !!input.lotId) throw new DomainError("validation", "Choose the lot or the batch to inspect.");
  if (input.processStepRecordId && !input.batchId) throw new DomainError("validation", "An in-process inspection belongs to a batch step.");
  // In-process inspections are QA work (W05-12): operators and the warehouse may start incoming and
  // finished-product inspections, but the result of an in-process check decides whether a step may close.
  if (input.processStepRecordId) ctx.require("quality.inspection.approve");
  const subject: InspectionSubject = input.processStepRecordId ? { batchId: input.batchId!, processStepRecordId: input.processStepRecordId } : input.batchId ? { batchId: input.batchId } : { lotId: input.lotId! };
  return db.transaction((tx) => withIdempotency(tx, ctx, input.idempotencyKey ? `inspection:${input.idempotencyKey}` : null, "quality.inspection.create", () => createInspectionTx(tx, ctx, subject)));
}

/**
 * For the production stream (W2B, US-3-13): creates the finished-product inspection of a batch in the
 * caller's transaction when the output is posted (W06-01 "system" trigger). No permission check beyond
 * site scope: the trigger is the posting itself. Returns null when the batch has no frozen plan.
 */
export async function ensureBatchInspection(tx: Tx, ctx: AuthContext, batchId: string) {
  const [b] = await tx.select({ planId: batches.inspectionPlanId }).from(batches).where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId))).limit(1);
  if (!b?.planId) return null;
  return createInspectionTx(tx, ctx, { batchId });
}

/* ------------------------------------------------------------------ sampling */

export type RecordSampleInput = { inspectionId: string; fromLocationId: string; qty: string; containerRef?: string | null; note?: string | null; idempotencyKey: string };

/**
 * Records a physical sample (W06-02): posts a consumption movement with reason `sample` (A-PROC-34)
 * from the location the sample was taken, numbers the sample and moves the inspection to in progress.
 * Sampling quarantined or released stock is allowed; held/recalled stock needs the held-stock issue
 * exception (CX-LOT); rejected or expired stock is never sampled here.
 */
export async function recordSample(ctx: AuthContext, input: RecordSampleInput) {
  ctx.require("quality.inspection.create");
  if (!isUuid(input.idempotencyKey)) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  if (!isUuid(input.fromLocationId)) throw new DomainError("validation", "Choose the location the sample was taken from.", { field: "fromLocationId" });
  let qty: Decimal;
  try {
    qty = new Decimal(String(input.qty ?? "").trim());
  } catch {
    throw new DomainError("validation", "Enter the sample quantity.", { field: "qty" });
  }
  if (!qty.isFinite() || qty.lte(0)) throw new DomainError("validation", "The sample quantity must be greater than zero.", { field: "qty" });
  const note = optionalText(input.note, "note", 500);

  return db.transaction(async (tx) => {
    const ins = await lockInspection(tx, ctx, input.inspectionId);
    const [dup] = await tx.select().from(inspectionSamples).where(and(eq(inspectionSamples.organizationId, ctx.organizationId), eq(inspectionSamples.idempotencyKey, input.idempotencyKey))).limit(1);
    if (dup) return { sampleId: dup.id, sampleNo: dup.sampleNo, replayed: true };
    if (!["pending", "in_progress"].includes(ins.status)) throw new DomainError("state", `Inspection ${ins.inspectionNumber} is ${INSPECTION_STATUS_LABEL[ins.status].toLowerCase()}; samples are taken while it is pending or in progress.`);
    if (!ins.lotId) throw new DomainError("state", "The batch has no output lot yet; there is nothing to sample.");
    const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, ins.lotId)).limit(1);
    if (["on_hold", "recalled"].includes(lot.qualityStatus)) {
      throw new DomainError("blocked_lot", `Lot ${lot.lotNumber} is ${lot.qualityStatus.replace("_", " ")}. Take the sample through the held-stock issue exception (purpose: sampling) instead.`, { rule: "CX-LOT" });
    }
    if (!["quarantine", "released"].includes(lot.qualityStatus) || (lot.expiresOn && new Date(lot.expiresOn + "T23:59:59+08:00") < new Date())) {
      throw new DomainError("blocked_lot", `Lot ${lot.lotNumber} is ${lot.qualityStatus === "released" ? "past its expiry date" : lot.qualityStatus.replace("_", " ")} and cannot be sampled.`);
    }
    if (lot.baseUom === "pcs" && !qty.isInteger()) throw new DomainError("validation", "This lot is counted in pieces; enter a whole number.", { field: "qty" });
    const [loc] = await tx.select().from(locations).where(and(eq(locations.id, input.fromLocationId), eq(locations.siteId, lot.siteId))).limit(1);
    if (!loc) throw new DomainError("validation", "Choose a location of this lot's site.", { field: "fromLocationId" });

    let containerId: string | null = null;
    const ref = (input.containerRef ?? "").trim().toUpperCase().replace(/^BC:BOX:/, "");
    if (ref) {
      const [c] = await tx
        .select()
        .from(containers)
        .where(and(eq(containers.organizationId, ctx.organizationId), eq(containers.siteId, lot.siteId), eq(containers.containerNumber, ref)))
        .limit(1);
      if (!c) throw new DomainError("validation", `Box ${ref} not found at this site.`, { field: "containerRef" });
      if (c.currentLocationId !== loc.id) throw new DomainError("validation", `Box ${ref} is not at ${loc.code}.`, { field: "containerRef" });
      containerId = c.id;
    }

    const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(${inspectionSamples.sampleNo}), 0)::int` }).from(inspectionSamples).where(eq(inspectionSamples.inspectionId, ins.id));
    const sampleNo = Number(n) + 1;
    const { movement } = await postMovement(tx, ctx, {
      movementType: "consumption",
      lotId: lot.id,
      fromLocationId: loc.id,
      qtyBase: qty,
      sourceDocumentType: "inspection",
      sourceDocumentId: ins.id,
      sourceDocumentNumber: ins.inspectionNumber,
      reason: "sample",
      idempotencyKey: `sample:${input.idempotencyKey}`,
      meta: { inspectionNumber: ins.inspectionNumber, sampleNo, containerId, location: loc.code },
    });
    const [sample] = await tx
      .insert(inspectionSamples)
      .values({
        organizationId: ctx.organizationId,
        siteId: ins.siteId,
        inspectionId: ins.id,
        sampleNo,
        lotId: lot.id,
        containerId,
        fromLocationId: loc.id,
        qtyBase: qty.toString(),
        baseUom: lot.baseUom,
        note,
        sampledBy: ctx.userId,
        consumptionMovementId: movement.id,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    const total = new Decimal(ins.sampleQtyBase ?? 0).plus(qty);
    const set = { sampleQtyBase: total.toString(), sampleUom: lot.baseUom, sampledAt: ins.sampledAt ?? sample.sampledAt, sampledBy: ins.sampledBy ?? ctx.userId };
    if (ins.status === "pending") await moveInspection(tx, ctx, ins, "in_progress", `Sample ${sampleNo} taken`, set);
    else await tx.update(inspections).set(set).where(eq(inspections.id, ins.id));
    await audit(tx, ctx, {
      action: "quality.inspection.sampled",
      entityType: "inspection",
      entityId: ins.id,
      entityNumber: ins.inspectionNumber,
      siteId: ins.siteId,
      after: { sampleNo, lotNumber: lot.lotNumber, qtyBase: qty.toString(), baseUom: lot.baseUom, location: loc.code, containerId, movementId: movement.id },
    });
    return { sampleId: sample.id, sampleNo, replayed: false };
  });
}

/* ------------------------------------------------------------------ results */

async function inspectionResults(q: DbOrTx, inspectionId: string) {
  return q.select().from(testResults).where(eq(testResults.inspectionId, inspectionId)).orderBy(asc(testResults.testedAt), asc(testResults.id));
}

/** in_progress → awaiting_review once every required plan test has a live result (W06-03). */
async function maybeAdvance(tx: Tx, ctx: AuthContext, ins: InspectionRow) {
  if (ins.status !== "in_progress") return;
  const tests = await planTests(tx, ins.inspectionPlanId);
  const live = liveResults(await inspectionResults(tx, ins.id));
  if (live.length > 0 && missingRequiredTests(tests, live).length === 0) await moveInspection(tx, ctx, ins, "awaiting_review", "Every required test has a result");
}

async function checkInstrument(tx: Tx, ctx: AuthContext, ins: InspectionRow, equipmentId: string | null | undefined) {
  if (!equipmentId) return null;
  if (!isUuid(equipmentId)) throw new DomainError("validation", "Choose the instrument.", { field: "instrumentEquipmentId" });
  const av = await equipmentAvailability(ctx, equipmentId, new Date(), { tx });
  if (av.equipment.siteId !== ins.siteId) throw new DomainError("validation", "The instrument belongs to another site.", { field: "instrumentEquipmentId" });
  if (!av.usable) throw new DomainError("state", `Instrument ${av.equipment.code} cannot be used now (calibration, maintenance or status). Use another instrument or ask for an approved override.`, { rule: "V-CAL", field: "instrumentEquipmentId" });
  return av.equipment.id;
}

export type RecordResultInput = {
  inspectionId: string;
  planTestId: string;
  value?: string | null;
  uom?: string | null;
  conforms?: boolean | null;
  instrumentEquipmentId?: string | null;
  idempotencyKey?: string | null;
};

/** Appends a result for one plan test (W06-03). Evaluation is against the inspection's plan only. */
export async function recordInspectionResult(ctx: AuthContext, input: RecordResultInput) {
  ctx.require("quality.test_result.create");
  return db.transaction(async (tx) => {
    const ins = await lockInspection(tx, ctx, input.inspectionId);
    return withIdempotency(tx, ctx, input.idempotencyKey ? `test-result:${input.idempotencyKey}` : null, "quality.test_result.record", async () => {
      if (!(INSPECTION_OPEN_STATUSES as readonly string[]).includes(ins.status)) {
        throw new DomainError("state", `Inspection ${ins.inspectionNumber} is ${INSPECTION_STATUS_LABEL[ins.status].toLowerCase()}; results can no longer be added. Raise a deviation if something is wrong.`);
      }
      const tests = await planTests(tx, ins.inspectionPlanId);
      const t = tests.find((x) => x.id === input.planTestId);
      if (!t) throw new DomainError("validation", "Choose a test of this inspection's plan.", { field: "planTestId" });
      const ev = evaluateResult(t, input);
      const instrument = await checkInstrument(tx, ctx, ins, input.instrumentEquipmentId);
      const [row] = await tx
        .insert(testResults)
        .values({
          batchId: ins.batchId,
          testName: t.name,
          specification: specLabel(t),
          result: ev.resultText,
          passed: ev.passed,
          testedBy: ctx.userId,
          inspectionId: ins.id,
          inspectionPlanTestId: t.id,
          testCode: t.testCode,
          valueNumeric: ev.valueNumeric,
          valueText: ev.valueText,
          valuePass: ev.valuePass,
          uom: ev.uom,
          instrumentEquipmentId: instrument,
        })
        .returning();
      if (!ins.performedBy) await tx.update(inspections).set({ performedBy: ctx.userId }).where(eq(inspections.id, ins.id));
      if (ins.status === "pending") await moveInspection(tx, ctx, ins, "in_progress", "First result entered");
      await maybeAdvance(tx, ctx, ins);
      await audit(tx, ctx, {
        action: "quality.test_result.recorded",
        entityType: "test_result",
        entityId: row.id,
        entityNumber: ins.inspectionNumber,
        siteId: ins.siteId,
        after: { inspectionId: ins.id, testCode: t.testCode, specification: row.specification, result: row.result, passed: row.passed, instrumentEquipmentId: instrument },
      });
      return { resultId: row.id, passed: row.passed, result: row.result, testName: row.testName, inspectionStatus: ins.status };
    });
  });
}

export type CorrectResultInput = { resultId: string; value?: string | null; uom?: string | null; conforms?: boolean | null; reason: string; instrumentEquipmentId?: string | null };

/**
 * Corrects a result by appending a new row that supersedes it, with a reason (W06 exception path).
 * The original stays visible (struck through). Only a live result can be corrected, once; the unique
 * index on supersedes_id makes two concurrent corrections of the same row end in one success.
 */
export async function correctInspectionResult(ctx: AuthContext, input: CorrectResultInput) {
  ctx.require("quality.test_result.void");
  const reason = reasonText(input.reason);
  assertUuid(input.resultId, "Result");
  return db.transaction(async (tx) => {
    const [orig] = await tx.select().from(testResults).where(eq(testResults.id, input.resultId)).limit(1);
    if (!orig?.inspectionId) throw new DomainError("not_found", "Result not found in your sites.");
    const ins = await lockInspection(tx, ctx, orig.inspectionId);
    if (!(INSPECTION_OPEN_STATUSES as readonly string[]).includes(ins.status)) {
      throw new DomainError("state", `Inspection ${ins.inspectionNumber} is ${INSPECTION_STATUS_LABEL[ins.status].toLowerCase()}; its results can no longer be corrected. Raise a deviation instead.`);
    }
    const [already] = await tx.select({ id: testResults.id }).from(testResults).where(eq(testResults.supersedesId, orig.id)).limit(1);
    if (already) throw new DomainError("conflict", "This result was already corrected. Correct the newest entry instead.");
    const tests = await planTests(tx, ins.inspectionPlanId);
    const t = tests.find((x) => x.id === orig.inspectionPlanTestId);
    if (!t) throw new DomainError("state", "The plan test of this result no longer exists.");
    const ev = evaluateResult(t, input);
    const instrument = await checkInstrument(tx, ctx, ins, input.instrumentEquipmentId ?? orig.instrumentEquipmentId);
    let row: typeof testResults.$inferSelect;
    try {
      [row] = await tx
        .insert(testResults)
        .values({
          batchId: ins.batchId,
          testName: t.name,
          specification: specLabel(t),
          result: ev.resultText,
          passed: ev.passed,
          testedBy: ctx.userId,
          inspectionId: ins.id,
          inspectionPlanTestId: t.id,
          testCode: t.testCode,
          valueNumeric: ev.valueNumeric,
          valueText: ev.valueText,
          valuePass: ev.valuePass,
          uom: ev.uom,
          instrumentEquipmentId: instrument,
          supersedesId: orig.id,
          correctionReason: reason,
        })
        .returning();
    } catch (e) {
      if (String((e as { code?: string })?.code) === "23505") throw new DomainError("conflict", "This result was already corrected. Correct the newest entry instead.");
      throw e;
    }
    if (!ins.performedBy) await tx.update(inspections).set({ performedBy: ctx.userId }).where(eq(inspections.id, ins.id));
    await maybeAdvance(tx, ctx, ins);
    await audit(tx, ctx, {
      action: "quality.test_result.corrected",
      entityType: "test_result",
      entityId: row.id,
      entityNumber: ins.inspectionNumber,
      siteId: ins.siteId,
      reason,
      before: { resultId: orig.id, result: orig.result, passed: orig.passed },
      after: { resultId: row.id, result: row.result, passed: row.passed, supersedes: orig.id },
    });
    return { resultId: row.id, passed: row.passed, result: row.result };
  });
}

/* ------------------------------------------------------------------ submit, review, cancel */

/** Hands an in-progress inspection to review when every required test has a live result. */
export async function submitInspection(ctx: AuthContext, input: { inspectionId: string }) {
  ctx.require("quality.inspection.submit");
  return db.transaction(async (tx) => {
    const ins = await lockInspection(tx, ctx, input.inspectionId);
    if (ins.status !== "in_progress") throw new DomainError("state", `Inspection ${ins.inspectionNumber} is ${INSPECTION_STATUS_LABEL[ins.status].toLowerCase()}; only an inspection in progress can be submitted.`);
    const tests = await planTests(tx, ins.inspectionPlanId);
    const live = liveResults(await inspectionResults(tx, ins.id));
    const missing = missingRequiredTests(tests, live);
    if (live.length === 0 || missing.length) throw new DomainError("state", `Enter every required test first${missing.length ? ` (missing: ${missing.map((m) => m.name).join(", ")})` : ""}.`);
    await moveInspection(tx, ctx, ins, "awaiting_review", "Submitted for review");
    await audit(tx, ctx, { action: "quality.inspection.submitted", entityType: "inspection", entityId: ins.id, entityNumber: ins.inspectionNumber, siteId: ins.siteId, after: { status: "awaiting_review" } });
    return { status: ins.status };
  });
}

export type ReviewDecision = "approve" | "reject" | "return";

/**
 * Review by a second QA user (W06-04, G-W06-A): approve (outcome pass, or fail when a live result is
 * out of specification), reject, or return for retest. The reviewer may not have entered any result
 * of the inspection (sod.results.reviewer_not_tester). Approving a finished-product inspection of a
 * batch awaiting QC moves the batch to quarantined (data-model §6.2).
 */
export async function reviewInspection(ctx: AuthContext, input: { inspectionId: string; decision: ReviewDecision; note?: string | null }) {
  ctx.require("quality.inspection.approve");
  if (!["approve", "reject", "return"].includes(input.decision)) throw new DomainError("validation", "Choose approve, reject or return.", { field: "decision" });
  const note = input.decision === "approve" ? optionalText(input.note, "note", 1000) : reasonText(input.note, "note");
  return db.transaction(async (tx) => {
    const ins = await lockInspection(tx, ctx, input.inspectionId);
    if (ins.status !== "awaiting_review") throw new DomainError("state", `Inspection ${ins.inspectionNumber} is ${INSPECTION_STATUS_LABEL[ins.status].toLowerCase()}; only an inspection awaiting review can be reviewed.`);
    const all = await inspectionResults(tx, ins.id);
    if (ctx.sodBlocks(ins.performedBy === ctx.userId || all.some((r) => r.testedBy === ctx.userId), "You entered results on this inspection, so another QA user must review it (separation of duties).")) {
      throw new DomainError("separation_of_duties", "You entered results on this inspection, so another QA user must review it (separation of duties).", ctx.refusalDetails());
    }
    const live = liveResults(all);
    let batchNote: string | null = null;
    let reviewedOutcome: "pass" | "fail" | null = null;
    if (input.decision === "return") {
      await moveInspection(tx, ctx, ins, "in_progress", note, { reviewNote: note });
    } else if (input.decision === "reject") {
      await moveInspection(tx, ctx, ins, "rejected", note, { reviewedBy: ctx.userId, reviewedAt: new Date(), outcome: "fail", reviewNote: note });
      reviewedOutcome = "fail";
    } else {
      const missing = missingRequiredTests(await planTests(tx, ins.inspectionPlanId), live);
      if (missing.length) throw new DomainError("state", `Required test(s) without a result: ${missing.map((m) => m.name).join(", ")}. Return the inspection for testing.`);
      const outcome = live.some((r) => !r.passed) ? "fail" : "pass";
      await moveInspection(tx, ctx, ins, "approved", note, { reviewedBy: ctx.userId, reviewedAt: new Date(), outcome, reviewNote: note });
      reviewedOutcome = outcome;
      if (ins.batchId && ins.inspectionKind === "finished_product") {
        const [b] = await tx.select().from(batches).where(eq(batches.id, ins.batchId)).for("update").limit(1);
        if (b.status === "awaiting_qc") {
          // data-model §6.2: leaving awaiting_qc needs every paper page reviewed (W2D). The inspection is
          // approved regardless; the batch waits in awaiting_qc and the release view lists the pages.
          if ((await paperRecordBlockers(tx, b.id)).length) batchNote = "awaiting_paper_review";
          else {
            await transitionBatch(tx, ctx, b, "quarantined", { reason: `Inspection ${ins.inspectionNumber} reviewed (${outcome})` });
            batchNote = "quarantined";
          }
        }
      }
    }
    // W05-12: a failed in-process inspection keeps its step blocked (inProcessQcStatus "failed": the
    // batch cannot move on, the WIP hold) and opens an in-process deviation for QA to investigate.
    if (ins.inspectionKind === "in_process" && ins.batchId && reviewedOutcome === "fail") {
      const [stepRec] = ins.processStepRecordId ? await tx.select({ stepNo: processStepRecords.stepNo, name: processStepRecords.name }).from(processStepRecords).where(eq(processStepRecords.id, ins.processStepRecordId)).limit(1) : [];
      await openDeviation(
        ctx,
        {
          batchId: ins.batchId,
          processStepRecordId: ins.processStepRecordId,
          inspectionId: ins.id,
          source: "in_process_check",
          stepRef: stepRec ? `Step ${stepRec.stepNo} ${stepRec.name}` : null,
          description: `In-process inspection ${ins.inspectionNumber} ${input.decision === "reject" ? "rejected" : "failed"}${note ? `: ${note}` : "."}`,
          idempotencyKey: `in-process-fail:${ins.id}:${ins.status}`,
        },
        { tx },
      );
    }
    await audit(tx, ctx, {
      action: input.decision === "return" ? "quality.inspection.returned" : "quality.inspection.reviewed",
      entityType: "inspection",
      entityId: ins.id,
      entityNumber: ins.inspectionNumber,
      siteId: ins.siteId,
      reason: note,
      after: { status: ins.status, decision: input.decision, liveResults: live.length, failed: live.filter((r) => !r.passed).length, batchStatus: batchNote },
    });
    return { status: ins.status, batchStatus: batchNote };
  });
}

/** Cancels an inspection that has no results yet (results are evidence and are never discarded). */
export async function cancelInspection(ctx: AuthContext, input: { inspectionId: string; reason: string }) {
  ctx.require("quality.inspection.submit");
  const reason = reasonText(input.reason);
  return db.transaction(async (tx) => {
    const ins = await lockInspection(tx, ctx, input.inspectionId);
    const [any] = await tx.select({ id: testResults.id }).from(testResults).where(eq(testResults.inspectionId, ins.id)).limit(1);
    if (any) throw new DomainError("state", "This inspection already has results; complete the review instead of cancelling it.");
    await moveInspection(tx, ctx, ins, "cancelled", reason, { cancelReason: reason });
    await audit(tx, ctx, { action: "quality.inspection.cancelled", entityType: "inspection", entityId: ins.id, entityNumber: ins.inspectionNumber, siteId: ins.siteId, reason, after: { status: "cancelled" } });
    return { status: ins.status };
  });
}

/* ------------------------------------------------------------------ release facts */

export type InspectionFacts = {
  inspection: { id: string; number: string; status: string; outcome: string | null } | null;
  missing: string[];
  liveCount: number;
  failed: { resultId: string; testName: string }[];
  testerIds: string[];
};

/** The live (not cancelled) inspection of a batch for its frozen plan, with result facts. */
export async function batchInspectionFacts(q: DbOrTx, batch: { id: string; inspectionPlanId: string | null }): Promise<InspectionFacts | null> {
  if (!batch.inspectionPlanId) return null;
  const [ins] = await q
    .select()
    .from(inspections)
    .where(and(eq(inspections.batchId, batch.id), eq(inspections.inspectionPlanId, batch.inspectionPlanId), isNull(inspections.processStepRecordId), ne(inspections.status, "cancelled")))
    .limit(1);
  return factsFor(q, ins ?? null, batch.inspectionPlanId);
}

/** Every live inspection of a material lot (incoming), with result facts. */
export async function lotInspectionFacts(q: DbOrTx, lotId: string): Promise<InspectionFacts[]> {
  const rows = await q.select().from(inspections).where(and(eq(inspections.lotId, lotId), sql`${inspections.batchId} is null`, ne(inspections.status, "cancelled")));
  return Promise.all(rows.map((r) => factsFor(q, r, r.inspectionPlanId)));
}

async function factsFor(q: DbOrTx, ins: InspectionRow | null, planId: string): Promise<InspectionFacts> {
  const tests = await planTests(q, planId);
  if (!ins) return { inspection: null, missing: tests.filter((t) => t.isRequired).map((t) => t.name), liveCount: 0, failed: [], testerIds: [] };
  const all = await inspectionResults(q, ins.id);
  const live = liveResults(all);
  return {
    inspection: { id: ins.id, number: ins.inspectionNumber, status: ins.status, outcome: ins.outcome },
    missing: missingRequiredTests(tests, live).map((t) => t.name),
    liveCount: live.length,
    failed: live.filter((r) => !r.passed).map((r) => ({ resultId: r.id, testName: r.testName })),
    testerIds: [...new Set(all.map((r) => r.testedBy))],
  };
}

/* ------------------------------------------------------------------ queries */

/** QA inspection queue of the current site: open inspections first, with due times. */
export async function listInspections(ctx: AuthContext, f: { status?: string } = {}) {
  ctx.require("quality.inspection.view");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);
  const conds = [eq(inspections.siteId, siteId), eq(inspections.organizationId, ctx.organizationId)];
  if (!f.status || f.status === "open") conds.push(inArray(inspections.status, [...INSPECTION_OPEN_STATUSES]));
  else if (f.status !== "all" && f.status in INSPECTION_STATUS_LABEL) conds.push(eq(inspections.status, f.status));
  const rows = await db
    .select({
      id: inspections.id,
      number: inspections.inspectionNumber,
      status: inspections.status,
      kind: inspections.inspectionKind,
      outcome: inspections.outcome,
      dueAt: inspections.dueAt,
      createdAt: inspections.createdAt,
      planCode: inspectionPlans.code,
      planRevision: inspectionPlans.revisionNo,
      planIsPlaceholder: inspectionPlans.isPlaceholder,
      lotId: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      batchId: batches.id,
      batchNumber: batches.batchNumber,
      itemName: sql<string>`coalesce(${materials.name}, ${products.name})`,
      liveResults: sql<number>`(select count(*)::int from ${testResults} r where r.inspection_id = ${inspections.id} and not exists (select 1 from ${testResults} s where s.supersedes_id = r.id))`,
      requiredTests: sql<number>`(select count(*)::int from ${inspectionPlanTests} t where t.inspection_plan_id = ${inspections.inspectionPlanId} and t.is_required)`,
    })
    .from(inspections)
    .innerJoin(inspectionPlans, eq(inspectionPlans.id, inspections.inspectionPlanId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, inspections.lotId))
    .leftJoin(batches, eq(batches.id, inspections.batchId))
    .leftJoin(materials, eq(materials.id, inspectionPlans.materialId))
    .leftJoin(products, eq(products.id, inspectionPlans.productId))
    .where(and(...conds))
    .orderBy(asc(inspections.dueAt), desc(inspections.createdAt))
    .limit(300);
  const now = Date.now();
  return rows.map((r) => ({ ...r, overdue: !!r.dueAt && (INSPECTION_OPEN_STATUSES as readonly string[]).includes(r.status) && r.dueAt.getTime() < now }));
}

/**
 * For the execution hook (W2B `inProcessQcStatus`, W05-12): the state of the in-process inspection of
 * one step record. Read-only. pending until QA approves it; failed when approved with a failing result
 * or rejected (the step stays blocked; the deviation was opened at review).
 */
export async function inProcessQcStatus(q: DbOrTx, _ctx: AuthContext, input: { batchId: string; processStepRecordId: string; inspectionPlanId: string }): Promise<{ status: "pending" | "passed" | "failed"; message?: string }> {
  const [ins] = await q
    .select({ number: inspections.inspectionNumber, status: inspections.status, outcome: inspections.outcome })
    .from(inspections)
    .where(and(eq(inspections.batchId, input.batchId), eq(inspections.processStepRecordId, input.processStepRecordId), eq(inspections.inspectionPlanId, input.inspectionPlanId), ne(inspections.status, "cancelled")))
    .orderBy(desc(inspections.createdAt))
    .limit(1);
  if (!ins) return { status: "pending", message: "The in-process inspection of this step has not been started. QA starts it from Inspections (steps waiting for an in-process check)." };
  if (ins.status === "rejected" || (ins.status === "approved" && ins.outcome === "fail")) {
    return { status: "failed", message: `In-process inspection ${ins.number} failed. The step is blocked; QA handles the deviation.` };
  }
  if (ins.status === "approved") return { status: "passed" };
  return { status: "pending", message: `In-process inspection ${ins.number} is not complete yet (${INSPECTION_STATUS_LABEL[ins.status as InspectionStatus]?.toLowerCase() ?? ins.status}).` };
}

/** Lots and batches at the current site that could start an inspection (QA queue "Start inspection"). */
export async function inspectionCandidates(ctx: AuthContext) {
  ctx.require("quality.inspection.view");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);
  const batchRows = await db
    .select({ id: batches.id, number: batches.batchNumber, status: batches.status, productName: products.name, planCode: inspectionPlans.code, planRevision: inspectionPlans.revisionNo })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .innerJoin(inspectionPlans, eq(inspectionPlans.id, batches.inspectionPlanId))
    .where(
      and(
        eq(batches.siteId, siteId),
        inArray(batches.status, ["awaiting_qc", "in_process"]),
        sql`not exists (select 1 from ${inspections} i where i.batch_id = ${batches.id} and i.inspection_plan_id = ${batches.inspectionPlanId} and i.process_step_record_id is null and i.status <> 'cancelled')`,
      ),
    )
    .orderBy(asc(batches.batchNumber));
  // W05-12: started steps whose routing step carries an in-process plan and that have no live inspection.
  const stepRows = await db
    .select({
      batchId: batches.id,
      batchNumber: batches.batchNumber,
      processStepRecordId: processStepRecords.id,
      stepNo: processStepRecords.stepNo,
      stepName: processStepRecords.name,
      planCode: inspectionPlans.code,
      planRevision: inspectionPlans.revisionNo,
    })
    .from(processStepRecords)
    .innerJoin(batches, eq(batches.id, processStepRecords.batchId))
    .innerJoin(routingSteps, eq(routingSteps.id, processStepRecords.routingStepId))
    .innerJoin(inspectionPlans, eq(inspectionPlans.id, routingSteps.inspectionPlanId))
    .where(
      and(
        eq(batches.siteId, siteId),
        eq(batches.status, "in_process"),
        inArray(processStepRecords.status, ["in_progress", "awaiting_check"]),
        sql`not exists (select 1 from ${inspections} i where i.process_step_record_id = ${processStepRecords.id} and i.status <> 'cancelled')`,
      ),
    )
    .orderBy(asc(batches.batchNumber), asc(processStepRecords.stepNo));
  return { batches: batchRows, steps: stepRows };
}

const sampler = alias(users, "sampler_user");
const reviewer = alias(users, "reviewer_user");

export async function getInspection(ctx: AuthContext, inspectionId: string) {
  ctx.require("quality.inspection.view");
  assertUuid(inspectionId, "Inspection");
  const [row] = await db
    .select({ ins: inspections, plan: inspectionPlans, reviewerName: reviewer.displayName, samplerName: sampler.displayName })
    .from(inspections)
    .innerJoin(inspectionPlans, eq(inspectionPlans.id, inspections.inspectionPlanId))
    .leftJoin(reviewer, eq(reviewer.id, inspections.reviewedBy))
    .leftJoin(sampler, eq(sampler.id, inspections.sampledBy))
    .where(and(eq(inspections.id, inspectionId), eq(inspections.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row || !ctx.allowedSiteIds.includes(row.ins.siteId)) throw new DomainError("not_found", "Inspection not found in your sites.");
  ctx.requireSite(row.ins.siteId);
  const ins = row.ins;
  const lot = ins.lotId
    ? ((
        await db
          .select({ id: inventoryLots.id, lotNumber: inventoryLots.lotNumber, qualityStatus: inventoryLots.qualityStatus, baseUom: inventoryLots.baseUom, expiresOn: inventoryLots.expiresOn, itemName: sql<string>`coalesce(${materials.name}, ${products.name})` })
          .from(inventoryLots)
          .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
          .leftJoin(products, eq(products.id, inventoryLots.productId))
          .where(eq(inventoryLots.id, ins.lotId))
          .limit(1)
      )[0] ?? null)
    : null;
  const batch = ins.batchId ? ((await db.select({ id: batches.id, batchNumber: batches.batchNumber, status: batches.status }).from(batches).where(eq(batches.id, ins.batchId)).limit(1))[0] ?? null) : null;
  const tests = await planTests(db, ins.inspectionPlanId);
  const results = await db
    .select({ r: testResults, testerName: tester.displayName })
    .from(testResults)
    .innerJoin(tester, eq(tester.id, testResults.testedBy))
    .where(eq(testResults.inspectionId, ins.id))
    .orderBy(asc(testResults.testedAt), asc(testResults.id));
  const live = new Set(liveResults(results.map((x) => x.r)).map((r) => r.id));
  const supersededBy = new Map(results.filter((x) => x.r.supersedesId).map((x) => [x.r.supersedesId!, x.r.id]));
  const samples = await db
    .select({ s: inspectionSamples, locationCode: locations.code, samplerName: users.displayName, containerNumber: containers.containerNumber })
    .from(inspectionSamples)
    .innerJoin(locations, eq(locations.id, inspectionSamples.fromLocationId))
    .innerJoin(users, eq(users.id, inspectionSamples.sampledBy))
    .leftJoin(containers, eq(containers.id, inspectionSamples.containerId))
    .where(eq(inspectionSamples.inspectionId, ins.id))
    .orderBy(asc(inspectionSamples.sampleNo));
  const timeline = await db
    .select({ from: inspectionStateTransitions.fromState, to: inspectionStateTransitions.toState, reason: inspectionStateTransitions.reason, at: inspectionStateTransitions.occurredAt, by: users.displayName })
    .from(inspectionStateTransitions)
    .innerJoin(users, eq(users.id, inspectionStateTransitions.actorId))
    .where(eq(inspectionStateTransitions.inspectionId, ins.id))
    .orderBy(asc(inspectionStateTransitions.occurredAt));
  const stock = lot
    ? await db
        .select({ locationId: locations.id, locationCode: locations.code, kind: locations.kind, qty: inventoryBalances.qtyBase })
        .from(inventoryBalances)
        .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
        .where(and(eq(inventoryBalances.lotId, lot.id), gt(inventoryBalances.qtyBase, "0")))
        .orderBy(asc(locations.code))
    : [];
  const linkedDeviations = await db
    .select({ id: deviations.id, number: deviations.deviationNumber, status: deviations.status, testResultId: deviations.testResultId, releasePermitted: deviations.releasePermitted })
    .from(deviations)
    .where(eq(deviations.inspectionId, ins.id));
  const open = (INSPECTION_OPEN_STATUSES as readonly string[]).includes(ins.status);
  const isTester = ctx.sodConflict(ins.performedBy) || results.some((x) => ctx.sodConflict(x.r.testedBy));
  const liveRows = results.filter((x) => live.has(x.r.id)).map((x) => x.r);
  return {
    inspection: { ...ins, reviewerName: row.reviewerName, samplerName: row.samplerName, statusLabel: INSPECTION_STATUS_LABEL[ins.status] ?? ins.status },
    plan: { id: row.plan.id, code: row.plan.code, name: row.plan.name, revisionNo: row.plan.revisionNo, isPlaceholder: row.plan.isPlaceholder, samplingInstructions: row.plan.samplingInstructions },
    lot,
    batch,
    tests: tests.map((t) => ({ ...t, spec: specLabel(t), hasLive: liveRows.some((r) => r.inspectionPlanTestId === t.id) })),
    results: results.map((x) => ({
      ...x.r,
      testerName: x.testerName,
      live: live.has(x.r.id),
      supersededById: supersededBy.get(x.r.id) ?? null,
      oosDeviation: linkedDeviations.find((d) => d.testResultId === x.r.id) ?? null,
    })),
    samples: samples.map((s) => ({ ...s.s, locationCode: s.locationCode, samplerName: s.samplerName, containerNumber: s.containerNumber })),
    timeline,
    stock,
    deviations: linkedDeviations,
    missing: missingRequiredTests(tests, liveRows).map((t) => t.name),
    isTester,
    can: {
      sample: open && ins.status !== "awaiting_review" && !!lot && ctx.can("quality.inspection.create"),
      record: open && ctx.can("quality.test_result.create"),
      correct: open && ctx.can("quality.test_result.void"),
      submit: ins.status === "in_progress" && ctx.can("quality.inspection.submit"),
      review: ins.status === "awaiting_review" && ctx.can("quality.inspection.approve") && !isTester,
      reviewBlockedReason: ins.status === "awaiting_review" && ctx.can("quality.inspection.approve") && isTester ? "You entered results on this inspection; another QA user must review it." : null,
      cancel: ["pending", "in_progress"].includes(ins.status) && results.length === 0 && ctx.can("quality.inspection.submit"),
      raiseDeviation: ctx.can("quality.deviation.create"),
    },
  };
}

/** Inspections of a batch or lot for the release pages (all statuses, newest first). */
export async function inspectionsFor(q: DbOrTx, subject: { batchId?: string; lotId?: string }) {
  const cond = subject.batchId ? eq(inspections.batchId, subject.batchId) : and(eq(inspections.lotId, subject.lotId!), sql`${inspections.batchId} is null`);
  return q
    .select({ id: inspections.id, number: inspections.inspectionNumber, status: inspections.status, outcome: inspections.outcome, kind: inspections.inspectionKind, createdAt: inspections.createdAt })
    .from(inspections)
    .where(cond)
    .orderBy(desc(inspections.createdAt));
}

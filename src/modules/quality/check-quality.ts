import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import Decimal from "decimal.js";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  auditEvents,
  batchMaterials,
  batchOutputs,
  batchQualityChecks,
  batches,
  dispenseRecords,
  dispositions,
  inspections,
  inventoryBalances,
  inventoryLots,
  materials,
  packagingReconciliations,
  processStepReadings,
  processStepRecords,
  products,
  salesOrders,
  scrapReworkRecords,
  stockMovements,
  testResults,
  users,
  workOrders,
  yieldRecords,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { notifyUsers } from "@/modules/platform";
import { batchFacts, decideBatchInTx } from "./dispositions";
import { deviationsFor } from "./deviations";
import { batchInspectionFacts, getInspection, reviewInspectionForPass } from "./inspections";
import { qualityReleaseHooks } from "./release-hooks";
import { BATCH_AWAITING_DECISION, MIN_REASON_LENGTH } from "./rules";
import { isIsoDate, isUuid, manilaToday, withIdempotency } from "./shared";
import { queueStatusLabel } from "./status-labels";

/**
 * Check quality (ADR-080 §8–9, slice V2-7): ONE page per finished batch with Pass / Not yet / Fail.
 *
 * | Decision | Needs                                              | Does (one transaction)                                                     |
 * |----------|----------------------------------------------------|----------------------------------------------------------------------------|
 * | Pass     | "batch record reviewed" tick; every release rule   | reviews the inspection (tester may when the setting allows), releases the  |
 * |          | (tests, problem reports, holds, paper pages);      | batch and its lot (moves it to finished goods), closes the batch through   |
 * |          | the releaser did not weigh, check or do a step     | the release hook when every closure check passes (else generates the BMR), |
 * |          | (owner override only with a typed reason)          | tells the person who made the linked customer order                        |
 * | Not yet  | reason + "check again on" date                     | finished lot → on hold ("Quality check · On hold"); the batch keeps waiting |
 * | Fail     | reason                                             | batch and lot rejected, stock moved to the rejected area                   |
 *
 * Release independence (QA review B1, S8): the "makers" of a batch are everyone who weighed or checked
 * a weighing, did or checked a step, recorded the output or the yield (Finish), recorded rejects or
 * counted packaging. A maker can never pass the batch; only the owner override (ADR-073) lets one pass,
 * and only with a typed reason that is stored, audited and printed on the batch record. The person who
 * entered the test results may pass when `quality.release.tester_may_release` is on (QA review B2).
 * The decision is always taken from the decider's own signed-in session: the service takes no
 * co-signer and refuses system contexts.
 */

export type QualityCheckDecision = "pass" | "not_yet" | "fail";
export const QUALITY_CHECK_DECISIONS: readonly QualityCheckDecision[] = ["pass", "not_yet", "fail"];
export const QUALITY_CHECK_LABEL: Record<QualityCheckDecision, string> = { pass: "Pass", not_yet: "Not yet", fail: "Fail" };

export type QualityCheckInput = {
  batchId: string;
  decision: QualityCheckDecision;
  recordReviewed?: boolean;
  reason?: string | null;
  /** Not yet: when QA checks again (YYYY-MM-DD, today or later). */
  checkAgainOn?: string | null;
  /** Owner override past release independence: why the owner passes a batch they worked on. */
  overrideReason?: string | null;
  idempotencyKey: string;
};

export type ExceptionItem = { kind: string; text: string };

const MIN_OVERRIDE_REASON = 10;

/* ------------------------------------------------------------------ makers (release independence) */

/** Everyone who made the batch, with what they did (QA review B1/S8). */
export async function batchMakers(q: DbOrTx, batchId: string): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const add = (id: string | null | undefined, what: string) => {
    if (!id) return;
    const s = out.get(id) ?? new Set<string>();
    s.add(what);
    out.set(id, s);
  };
  const disp = await q
    .select({ op: dispenseRecords.operatorId, ch: dispenseRecords.checkerId })
    .from(dispenseRecords)
    .innerJoin(batchMaterials, eq(batchMaterials.id, dispenseRecords.batchMaterialId))
    .where(eq(batchMaterials.batchId, batchId));
  for (const d of disp) {
    add(d.op, "weighed");
    add(d.ch, "checked a weighing");
  }
  for (const r of await q.select({ by: processStepRecords.conductedBy, ch: processStepRecords.checkedBy }).from(processStepRecords).where(eq(processStepRecords.batchId, batchId))) {
    add(r.by, "did a step");
    add(r.ch, "checked a step");
  }
  for (const r of await q.select({ by: batchOutputs.recordedBy, ch: batchOutputs.checkedBy }).from(batchOutputs).where(eq(batchOutputs.batchId, batchId))) {
    add(r.by, "finished the batch");
    add(r.ch, "checked the finish");
  }
  for (const r of await q.select({ by: yieldRecords.recordedBy }).from(yieldRecords).where(eq(yieldRecords.batchId, batchId))) add(r.by, "counted the good pieces");
  for (const r of await q.select({ by: scrapReworkRecords.recordedBy }).from(scrapReworkRecords).where(eq(scrapReworkRecords.batchId, batchId))) add(r.by, "recorded rejects");
  for (const r of await q.select({ by: packagingReconciliations.issuedBy, c: packagingReconciliations.countedBy }).from(packagingReconciliations).where(eq(packagingReconciliations.batchId, batchId))) {
    add(r.by, "took wrappers");
    add(r.c, "counted wrappers");
  }
  return out;
}

async function testerIds(q: DbOrTx, batch: { id: string; inspectionPlanId: string | null }) {
  const ids = new Set((await q.select({ by: testResults.testedBy }).from(testResults).where(eq(testResults.batchId, batch.id))).map((r) => r.by));
  const insp = await batchInspectionFacts(q, batch);
  for (const id of insp?.testerIds ?? []) ids.add(id);
  return ids;
}

/* ------------------------------------------------------------------ exceptions box (QA review S6) */

/** Everything that left the normal path in this batch, for the "Exceptions in this batch" box. */
export async function batchExceptions(q: DbOrTx, batch: typeof batches.$inferSelect, lotId: string | null): Promise<ExceptionItem[]> {
  const out: ExceptionItem[] = [];
  const weigh = await q
    .select({ r: dispenseRecords, name: materials.name })
    .from(dispenseRecords)
    .innerJoin(batchMaterials, eq(batchMaterials.id, dispenseRecords.batchMaterialId))
    .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
    .where(eq(batchMaterials.batchId, batch.id))
    .orderBy(asc(dispenseRecords.recordedAt));
  for (const { r, name } of weigh) {
    if (r.voidedAt) out.push({ kind: "weighing_voided", text: `Weighing of ${name} was cancelled and done again. Reason: ${r.voidReason ?? "—"}` });
    else if (!r.isWithinTolerance) out.push({ kind: "weighing_out_of_range", text: `${name} weighed ${new Decimal(r.actualQtyG).toString()} g, outside the allowed range. Reason: ${r.exceptionReason ?? "—"}` });
  }
  const recs = await q.select().from(processStepRecords).where(eq(processStepRecords.batchId, batch.id)).orderBy(asc(processStepRecords.stepNo));
  if (recs.length) {
    const readings = await q.select().from(processStepReadings).where(inArray(processStepReadings.processStepRecordId, recs.map((r) => r.id)));
    const superseded = new Set(readings.map((r) => r.supersedesId).filter(Boolean));
    for (const r of readings) {
      if (superseded.has(r.id) || r.isWithinLimits) continue;
      const step = recs.find((x) => x.id === r.processStepRecordId);
      const v = r.valueNumeric !== null ? new Decimal(r.valueNumeric).toString() : r.valueBoolean !== null ? (r.valueBoolean ? "yes" : "no") : (r.valueText ?? "");
      out.push({ kind: "reading_out_of_range", text: `Step ${step?.stepNo} ${step?.name}: ${r.parameterName} ${v}${r.uom ? ` ${r.uom}` : ""} outside the limits.` });
    }
    for (const r of readings) if (r.supersedesId) out.push({ kind: "reading_corrected", text: `${r.parameterName} was corrected. Reason: ${r.correctionReason ?? "—"}` });
  }
  for (const r of recs) {
    if (!r.exceptionReason) continue;
    const early = r.stepKind === "curing" || r.stepKind === "hold";
    out.push({ kind: early ? "curing_ended_early" : "step_exception", text: `${early ? "Waiting time ended early" : "Exception"} on step ${r.stepNo} ${r.name}. Reason: ${r.exceptionReason}` });
  }
  const ys = await q.select().from(yieldRecords).where(eq(yieldRecords.batchId, batch.id)).orderBy(asc(yieldRecords.recordedAt));
  const y = ys.find((x) => x.isCurrent);
  if (y && !y.isWithinLimits) {
    out.push({ kind: "yield_out_of_range", text: `Made ${new Decimal(y.yieldPct).toString()} % of the expected amount (OK from ${new Decimal(y.minPct).toString()} to ${new Decimal(y.maxPct).toString()} %). ${y.notes ? `Reason: ${y.notes}` : ""}`.trim() });
  }
  for (const c of ys.filter((x) => x.correctionReason)) out.push({ kind: "count_corrected", text: `Good pieces corrected. Reason: ${c.correctionReason}` });
  for (const s of await q.select().from(scrapReworkRecords).where(and(eq(scrapReworkRecords.batchId, batch.id), isNull(scrapReworkRecords.voidedAt)))) {
    if (s.requiresApproval) out.push({ kind: "rejects_above_limit", text: `${new Decimal(s.qty).toString()} rejects (${s.note ?? s.reasonCode}) are above the approval limit${s.status === "approved" ? " (approved)" : " (not approved yet)"}.` });
  }
  for (const p of await q.select({ r: packagingReconciliations, name: materials.name }).from(packagingReconciliations).innerJoin(materials, eq(materials.id, packagingReconciliations.materialId)).where(eq(packagingReconciliations.batchId, batch.id))) {
    if (p.r.voidedAt && p.r.correctionReason === null) continue;
    if (p.r.supersedesId) out.push({ kind: "packaging_recounted", text: `${p.name} counted again. Reason: ${p.r.correctionReason ?? "—"}` });
    if (!p.r.voidedAt && p.r.isWithinTolerance === false) out.push({ kind: "packaging_not_balanced", text: `${p.name}: ${new Decimal(p.r.varianceQty ?? 0).toString()} not accounted for.` });
  }
  for (const d of await deviationsFor(q, { batchId: batch.id, lotIds: lotId ? [lotId] : [] })) {
    if (d.status !== "closed") out.push({ kind: "open_problem_report", text: `Problem report ${d.number} is ${d.status.replace(/_/g, " ")}: ${d.description}` });
    else out.push({ kind: "problem_report", text: `Problem report ${d.number} (closed): ${d.description}` });
  }
  const overrides = await q
    .select({ after: auditEvents.after, at: auditEvents.occurredAt, name: users.displayName })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(and(eq(auditEvents.organizationId, batch.organizationId), eq(auditEvents.action, "governance.owner_override.used"), or(eq(auditEvents.entityId, batch.id), eq(auditEvents.entityNumber, batch.batchNumber))));
  for (const o of overrides) {
    const a = (o.after ?? {}) as { forAction?: string };
    out.push({ kind: "owner_override", text: `Owner override used by ${o.name ?? "the owner"} (${(a.forAction ?? "").replace(/\./g, " ")}).` });
  }
  return out;
}

/* ------------------------------------------------------------------ read model */

async function loadBatch(q: DbOrTx, ctx: AuthContext, batchId: string, lock = false) {
  if (!isUuid(batchId)) throw new DomainError("not_found", "Batch not found.");
  const where = and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId));
  const [b] = lock ? await q.select().from(batches).where(where).for("update").limit(1) : await q.select().from(batches).where(where).limit(1);
  if (!b) throw new DomainError("not_found", "Batch not found.");
  ctx.requireSite(b.siteId);
  return b;
}

async function lastCheck(q: DbOrTx, batchId: string) {
  const [c] = await q
    .select({ c: batchQualityChecks, by: users.displayName })
    .from(batchQualityChecks)
    .innerJoin(users, eq(users.id, batchQualityChecks.decidedBy))
    .where(eq(batchQualityChecks.batchId, batchId))
    .orderBy(desc(batchQualityChecks.decidedAt))
    .limit(1);
  return c ? { ...c.c, decidedByName: c.by } : null;
}

export async function getQualityCheck(ctx: AuthContext, batchId: string) {
  ctx.require("quality.disposition.view");
  const batch = await loadBatch(db, ctx, batchId);
  const [product] = await db.select().from(products).where(eq(products.id, batch.productId)).limit(1);
  const [wo] = batch.workOrderId ? await db.select({ id: workOrders.id, number: workOrders.workOrderNumber, salesOrderId: workOrders.salesOrderId }).from(workOrders).where(eq(workOrders.id, batch.workOrderId)).limit(1) : [];
  const lot = batch.outputLotId ? ((await db.select().from(inventoryLots).where(eq(inventoryLots.id, batch.outputLotId)).limit(1))[0] ?? null) : null;
  const [onHand] = lot ? await db.select({ q: sql<string>`coalesce(sum(${inventoryBalances.qtyBase}), 0)::text` }).from(inventoryBalances).where(and(eq(inventoryBalances.lotId, lot.id), gt(inventoryBalances.qtyBase, "0"))) : [];
  const [samples] = await db
    .select({ q: sql<string>`coalesce(sum(${stockMovements.qtyBase}), 0)::text` })
    .from(stockMovements)
    .where(and(eq(stockMovements.sourceDocumentType, "batch_retained_sample"), eq(stockMovements.sourceDocumentId, batch.id)));
  const y = (await db.select().from(yieldRecords).where(and(eq(yieldRecords.batchId, batch.id), eq(yieldRecords.isCurrent, true))).limit(1))[0] ?? null;
  const rejects = await db.select().from(scrapReworkRecords).where(and(eq(scrapReworkRecords.batchId, batch.id), isNull(scrapReworkRecords.voidedAt)));
  const testerMayRelease = await getSetting(db, ctx.organizationId, "quality.release.tester_may_release", batch.siteId);
  const decidable = (BATCH_AWAITING_DECISION as readonly string[]).includes(batch.status);
  const facts = decidable ? await batchFacts(db, ctx, batch, lot, { testerMayRelease }) : [];
  const insp = await batchInspectionFacts(db, batch);
  // Required tests may still be entered on this page; the pass reviews the inspection itself (B2).
  const stateBlockers = facts
    .filter((b) => b.code !== "separation_of_duties")
    .map((b) => b.message)
    .filter((m) => !(insp?.inspection && /a second QA user must review/.test(m) && ["pending", "in_progress", "awaiting_review"].includes(insp.inspection.status)));
  const makers = await batchMakers(db, batch.id);
  const mine = makers.get(ctx.userId);
  const testers = await testerIds(db, batch);
  const inspection = insp?.inspection ? await getInspection(ctx, insp.inspection.id).catch(() => null) : null;
  const check = await lastCheck(db, batch.id);
  const unitMass = new Decimal(product.unitNetMassG);
  const expected = unitMass.gt(0) ? new Decimal(batch.theoreticalYieldG ?? 0).div(unitMass).floor().toString() : null;
  return {
    batch: { id: batch.id, number: batch.batchNumber, status: batch.status, siteId: batch.siteId, completedAt: batch.completedAt },
    product: { name: product.name, family: product.family, uom: product.baseUom },
    order: wo ? { id: wo.id, number: wo.number, salesOrderId: wo.salesOrderId } : null,
    lot: lot ? { id: lot.id, number: lot.lotNumber, status: lot.qualityStatus, expiresOn: lot.expiresOn, onHand: new Decimal(onHand?.q ?? 0).toString() } : null,
    counts: {
      good: y?.actualUnits ? new Decimal(y.actualUnits).toString() : batch.actualUnits ? new Decimal(batch.actualUnits).toString() : null,
      samples: new Decimal(samples?.q ?? 0).toString(),
      expected,
      yieldPct: y ? new Decimal(y.yieldPct).toString() : null,
      range: y ? `${new Decimal(y.minPct).toString()}–${new Decimal(y.maxPct).toString()} %` : null,
      withinRange: y ? y.isWithinLimits : null,
      rejects: rejects.map((r) => ({ what: r.note?.replace(/^Reject: /, "") ?? r.reasonCode, qty: new Decimal(r.qty).toString(), kind: r.recordKind })),
    },
    exceptions: await batchExceptions(db, batch, lot?.id ?? null),
    inspection: inspection
      ? {
          id: inspection.inspection.id,
          number: inspection.inspection.inspectionNumber,
          status: inspection.inspection.status,
          tests: inspection.tests.map((t) => {
            const r = inspection.results.find((x) => x.live && x.inspectionPlanTestId === t.id);
            return { id: t.id, name: t.name, valueKind: t.valueKind, uom: t.uom, spec: t.spec, isRequired: t.isRequired, result: r ? { text: r.result, passed: r.passed, by: r.testerName } : null };
          }),
          canRecord: inspection.can.record,
        }
      : null,
    planDriven: !!batch.inspectionPlanId,
    /** Batches without a test list: results typed by hand (one place, 2026-10-31 audit item 4). Live rows only. */
    freeTests: batch.inspectionPlanId
      ? []
      : (
          await db
            .select({ id: testResults.id, name: testResults.testName, result: testResults.result, passed: testResults.passed, supersedesId: testResults.supersedesId, by: users.displayName })
            .from(testResults)
            .innerJoin(users, eq(users.id, testResults.testedBy))
            .where(eq(testResults.batchId, batch.id))
            .orderBy(asc(testResults.testedAt))
        ).filter((t, _i, all) => !all.some((x) => x.supersedesId === t.id)),
    canRecordFreeTest: !batch.inspectionPlanId && ctx.can("quality.test_result.create") && ["in_process", "awaiting_qc", "quarantined"].includes(batch.status),
    blockers: stateBlockers,
    independence: { isMaker: !!mine, what: mine ? [...mine] : [], ownerOverride: ctx.ownerOverride },
    isTester: testers.has(ctx.userId),
    testerMayRelease,
    lastCheck: check ? { decision: check.decision as QualityCheckDecision, reason: check.reason, checkAgainOn: check.checkAgainOn, by: check.decidedByName, at: check.decidedAt } : null,
    onHold: lot?.qualityStatus === "on_hold",
    decidable,
    can: { decide: decidable && ctx.canAt("quality.disposition.approve", batch.siteId), pass: decidable && ctx.canAt("quality.disposition.approve", batch.siteId) && (!mine || ctx.ownerOverride) && (!testers.has(ctx.userId) || testerMayRelease || ctx.ownerOverride) },
  };
}
export type QualityCheckView = Awaited<ReturnType<typeof getQualityCheck>>;

/** QA list "Waiting for check": finished batches of the current site waiting for a decision. */
export async function listWaitingForCheck(ctx: AuthContext) {
  ctx.require("quality.disposition.view");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);
  const rows = await db
    .select({
      id: batches.id,
      batchNumber: batches.batchNumber,
      status: batches.status,
      completedAt: batches.completedAt,
      actualUnits: batches.actualUnits,
      productName: products.name,
      family: products.family,
      lotNumber: inventoryLots.lotNumber,
      lotStatus: inventoryLots.qualityStatus,
      workOrderId: batches.workOrderId,
      checkAgainOn: sql<string | null>`(select c.check_again_on::text from batch_quality_checks c where c.batch_id = ${batches.id} order by c.decided_at desc limit 1)`,
      openProblems: sql<number>`(select count(*)::int from deviations d where (d.batch_id = ${batches.id} or d.lot_id = ${batches.outputLotId}) and d.status <> 'closed')`,
    })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, batches.outputLotId))
    .where(and(eq(batches.organizationId, ctx.organizationId), eq(batches.siteId, siteId), inArray(batches.status, [...BATCH_AWAITING_DECISION])))
    .orderBy(asc(batches.completedAt));
  return rows.map((r) => ({ ...r, onHold: r.lotStatus === "on_hold" }));
}

/* ------------------------------------------------------------------ command */

function text(v: string | null | undefined, min: number, field: string, message: string) {
  const t = (v ?? "").trim();
  if (t.length < min) throw new DomainError("validation", message, { field, fieldErrors: { [field]: message } });
  if (t.length > 1000) throw new DomainError("validation", "Keep it under 1,000 characters.", { field, fieldErrors: { [field]: "Too long." } });
  return t;
}

export async function decideQualityCheck(ctx: AuthContext, input: QualityCheckInput) {
  ctx.require("quality.disposition.approve");
  if (!QUALITY_CHECK_DECISIONS.includes(input.decision)) throw new DomainError("validation", "Choose Pass, Not yet or Fail.", { field: "decision" });
  if (ctx.actor.kind !== "user") throw new DomainError("forbidden", "The quality check is decided by a person from their own sign-in, never by the system.");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  if (!isUuid(input.batchId)) throw new DomainError("not_found", "Batch not found.");
  const r = await db.transaction(async (tx) => {
    // Lock order as reviewInspection: inspection, then batch, then lot (decideBatchInTx).
    const [head] = await tx.select({ siteId: batches.siteId, planId: batches.inspectionPlanId }).from(batches).where(and(eq(batches.id, input.batchId), eq(batches.organizationId, ctx.organizationId))).limit(1);
    if (!head) throw new DomainError("not_found", "Batch not found.");
    ctx.requireAt("quality.disposition.approve", head.siteId);
    return withIdempotency(tx, ctx, `quality-check:${input.idempotencyKey}`, "quality.quality_check.decide", () => decideLocked(tx, ctx, input));
  });
  if (!r.replayed && r.lotId && r.decision !== "not_yet") {
    const label = await queueStatusLabel(ctx, { id: r.lotId, siteId: r.siteId, lotNumber: r.lotNumber! }, r.lotDispositionId ?? r.checkId);
    return { ...r, labelQueued: label.queued };
  }
  return { ...r, labelQueued: false };
}

async function decideLocked(tx: Tx, ctx: AuthContext, input: QualityCheckInput) {
  const [insRow] = await tx
    .select({ id: inspections.id })
    .from(inspections)
    .where(and(eq(inspections.batchId, input.batchId), isNull(inspections.processStepRecordId), ne(inspections.status, "cancelled"), eq(inspections.inspectionKind, "finished_product")))
    .limit(1);
  const testerMayRelease = await getSetting(tx, ctx.organizationId, "quality.release.tester_may_release", (await loadBatch(tx, ctx, input.batchId)).siteId);
  let tested = false;
  let overrideReason: string | null = null;
  let mine: Set<string> | undefined;
  if (input.decision === "pass") {
    if (!input.recordReviewed) throw new DomainError("validation", "Tick \"I reviewed the batch record\" first.", { field: "recordReviewed", fieldErrors: { recordReviewed: "Read the exceptions and the batch record, then tick." } });
    // Release independence first (B1): a maker never passes; the owner override only with a typed reason.
    mine = (await batchMakers(tx, input.batchId)).get(ctx.userId);
    if (mine) {
      const what = [...mine].join(", ");
      const [b] = await tx.select({ siteId: batches.siteId }).from(batches).where(eq(batches.id, input.batchId)).limit(1);
      if (!ctx.ownerOverride) {
        throw new DomainError("separation_of_duties", `You ${what} on this batch, so you cannot pass it. Another QA person must check it (production and release are kept apart).`, { permission: "quality.disposition.approve", siteId: b.siteId });
      }
      overrideReason = text(input.overrideReason, MIN_OVERRIDE_REASON, "overrideReason", `You ${what} on this batch. To pass it anyway, write why (at least ${MIN_OVERRIDE_REASON} characters). It is printed on the batch record.`);
      ctx.sodBlocks(true, `Release by a person who worked on the batch: ${overrideReason}`);
    }
  }
  if (input.decision === "pass" && insRow) {
    // The pass is also the review of the tests (one-person QA, B2). Locks the inspection first.
    const rv = await reviewInspectionForPass(tx, ctx, insRow.id, { testerMayRelease });
    tested = rv.tested;
  }
  const batch = await loadBatch(tx, ctx, input.batchId, true);
  if (!(BATCH_AWAITING_DECISION as readonly string[]).includes(batch.status)) {
    throw new DomainError("state", `Batch ${batch.batchNumber} is ${batch.status.replace(/_/g, " ")}; only a finished batch waiting for the quality check can be decided.`);
  }
  const lot = batch.outputLotId ? ((await tx.select().from(inventoryLots).where(eq(inventoryLots.id, batch.outputLotId)).for("update").limit(1))[0] ?? null) : null;
  const exceptions = await batchExceptions(tx, batch, lot?.id ?? null);
  const checkId = uuidv7();
  const base = { entityType: "batch", entityId: batch.id, entityNumber: batch.batchNumber, siteId: batch.siteId } as const;
  const insertCheck = (v: Partial<typeof batchQualityChecks.$inferInsert>) =>
    tx.insert(batchQualityChecks).values({
      id: checkId,
      organizationId: ctx.organizationId,
      siteId: batch.siteId,
      batchId: batch.id,
      decision: input.decision,
      recordReviewed: !!input.recordReviewed,
      exceptions,
      idempotencyKey: input.idempotencyKey,
      decidedBy: ctx.userId,
      ...v,
    });

  if (input.decision === "not_yet") {
    const reason = text(input.reason, MIN_REASON_LENGTH, "reason", `Write why it is not ready yet (at least ${MIN_REASON_LENGTH} characters).`);
    const on = (input.checkAgainOn ?? "").trim();
    if (!isIsoDate(on) || on < manilaToday()) throw new DomainError("validation", "Choose the day to check again (today or later).", { field: "checkAgainOn", fieldErrors: { checkAgainOn: "Today or later." } });
    let dispositionId: string | null = null;
    if (lot && lot.qualityStatus === "quarantine") {
      dispositionId = uuidv7();
      await tx.insert(dispositions).values({ id: dispositionId, organizationId: ctx.organizationId, siteId: lot.siteId, subjectType: "lot", subjectId: lot.id, decision: "hold", fromStatus: lot.qualityStatus, toStatus: "on_hold", reason, decidedBy: ctx.userId, reviewDate: on });
      await tx.update(inventoryLots).set({ qualityStatus: "on_hold" }).where(eq(inventoryLots.id, lot.id));
      await audit(tx, ctx, { action: "quality.disposition.held", entityType: "inventory_lot", entityId: lot.id, entityNumber: lot.lotNumber, siteId: lot.siteId, reason, before: { qualityStatus: lot.qualityStatus }, after: { qualityStatus: "on_hold", dispositionId, checkAgainOn: on, batch: batch.batchNumber } });
    }
    await insertCheck({ reason, checkAgainOn: on, dispositionId });
    await audit(tx, ctx, { ...base, action: "quality.quality_check.not_yet", reason, after: { checkAgainOn: on, lot: lot?.lotNumber ?? null, exceptions: exceptions.length } });
    return { checkId, decision: "not_yet" as const, batchNumber: batch.batchNumber, batchStatus: batch.status, lotId: lot?.id ?? null, lotNumber: lot?.lotNumber ?? null, siteId: batch.siteId, lotDispositionId: dispositionId, checkAgainOn: on, closed: false, closeBlockers: [] as string[], documentNumber: null as string | null, notified: 0 };
  }

  if (input.decision === "fail") {
    const reason = text(input.reason, MIN_REASON_LENGTH, "reason", `Write why the batch failed (at least ${MIN_REASON_LENGTH} characters).`);
    const d = await decideBatchInTx(tx, ctx, { batchId: batch.id, decision: "reject", reason });
    await insertCheck({ reason, dispositionId: d.lotDispositionId });
    await audit(tx, ctx, { ...base, action: "quality.quality_check.failed", reason, after: { lot: d.lotNumber, movedTo: d.movedTo, exceptions: exceptions.length, recordReviewed: !!input.recordReviewed } });
    return { checkId, decision: "fail" as const, batchNumber: batch.batchNumber, batchStatus: d.toStatus, lotId: d.lotId, lotNumber: d.lotNumber, siteId: batch.siteId, lotDispositionId: d.lotDispositionId, checkAgainOn: null, closed: false, closeBlockers: [] as string[], documentNumber: null as string | null, notified: 0 };
  }

  // Pass.
  const testers = await testerIds(tx, batch);
  tested = tested || testers.has(ctx.userId);
  const reason = (input.reason ?? "").trim() || "Passed on the quality check";
  // A "Not yet" hold from this page is lifted by the pass (the lot returns to the hold-area status first).
  if (lot && lot.qualityStatus === "on_hold") {
    const last = await lastCheck(tx, batch.id);
    if (last?.decision !== "not_yet") throw new DomainError("state", `Lot ${lot.lotNumber} is on hold for another reason. Lift that hold first.`);
    await tx.insert(dispositions).values({ organizationId: ctx.organizationId, siteId: lot.siteId, subjectType: "lot", subjectId: lot.id, decision: "hold_lifted", fromStatus: "on_hold", toStatus: "quarantine", reason: `Checked again: ${reason}`, decidedBy: ctx.userId });
    await tx.update(inventoryLots).set({ qualityStatus: "quarantine" }).where(eq(inventoryLots.id, lot.id));
    await audit(tx, ctx, { action: "quality.hold.lifted", entityType: "inventory_lot", entityId: lot.id, entityNumber: lot.lotNumber, siteId: lot.siteId, reason, before: { qualityStatus: "on_hold" }, after: { qualityStatus: "quarantine", batch: batch.batchNumber } });
  }
  const d = await decideBatchInTx(tx, ctx, { batchId: batch.id, decision: "release", reason, testerMayRelease: testerMayRelease || false });
  await insertCheck({ reason: input.reason?.trim() || null, overrideReason, testerReleased: tested, dispositionId: d.lotDispositionId });
  // ADR-080 §9: close automatically through the release hook (never a direct call into production).
  const hook = qualityReleaseHooks().onBatchReleased;
  const close = hook ? await hook(tx, ctx, { batchId: batch.id, idempotencyKey: input.idempotencyKey }) : { closed: false, blockers: [{ code: "hook", label: "Closure", detail: "Automatic closure is not connected; close the batch from its page." }], documentNumber: null };
  // Tell the person who took the linked customer order (no automatic allocation).
  let notified = 0;
  const [wo] = batch.workOrderId ? await tx.select({ number: workOrders.workOrderNumber, salesOrderId: workOrders.salesOrderId }).from(workOrders).where(eq(workOrders.id, batch.workOrderId)).limit(1) : [];
  if (wo?.salesOrderId) {
    const [so] = await tx.select({ id: salesOrders.id, number: salesOrders.orderNumber, createdBy: salesOrders.createdBy }).from(salesOrders).where(eq(salesOrders.id, wo.salesOrderId)).limit(1);
    if (so) {
      const [p] = await tx.select({ name: products.name }).from(products).where(eq(products.id, batch.productId)).limit(1);
      const [bal] = lot ? await tx.select({ q: sql<string>`coalesce(sum(${inventoryBalances.qtyBase}), 0)::text` }).from(inventoryBalances).where(eq(inventoryBalances.lotId, lot.id)) : [];
      const sent = await notifyUsers(tx, [so.createdBy], {
        organizationId: ctx.organizationId,
        siteId: batch.siteId,
        kind: "sales.order.stock_available",
        severity: "info",
        title: `${p?.name ?? "Product"} ready for ${so.number}`,
        body: `Batch ${batch.batchNumber} passed the quality check: ${new Decimal(bal?.q ?? 0).toString()} ready to sell (lot ${d.lotNumber ?? "—"}). Production order ${wo.number}.`,
        entityType: "sales_order",
        entityId: so.id,
        link: `/sales/${so.id}`,
        dedupeKey: `stock-available:${batch.id}`,
      });
      notified = sent.length;
      await audit(tx, ctx, { action: "sales.order.stock_available", entityType: "sales_order", entityId: so.id, entityNumber: so.number, siteId: batch.siteId, after: { batch: batch.batchNumber, lot: d.lotNumber, notified } });
    }
  }
  await audit(tx, ctx, {
    ...base,
    action: "quality.quality_check.passed",
    reason: overrideReason ?? input.reason?.trim() ?? null,
    after: { lot: d.lotNumber, movedTo: d.movedTo, recordReviewed: true, exceptions: exceptions.length, overrideReason, makerActions: mine ? [...mine] : [], testerReleased: tested, autoClosed: close.closed, closeBlockers: close.blockers.map((b) => b.label), bmrDocument: close.documentNumber },
  });
  return {
    checkId,
    decision: "pass" as const,
    batchNumber: batch.batchNumber,
    batchStatus: close.closed ? "closed" : d.toStatus,
    lotId: d.lotId,
    lotNumber: d.lotNumber,
    siteId: batch.siteId,
    lotDispositionId: d.lotDispositionId,
    checkAgainOn: null,
    closed: close.closed,
    closeBlockers: close.blockers.map((b) => `${b.label}: ${b.detail}`),
    documentNumber: close.documentNumber,
    notified,
  };
}

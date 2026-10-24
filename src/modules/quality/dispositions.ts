import "server-only";
import { and, asc, desc, eq, gt, inArray, like, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { db, type Tx } from "@/db/client";
import {
  batchMaterials,
  batchStateTransitions,
  batches,
  dispenseRecords,
  dispositions,
  goodsReceiptLines,
  goodsReceipts,
  inventoryBalances,
  inventoryLots,
  locations,
  materials,
  processStepRecords,
  products,
  testResults,
  users,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { postMovement } from "@/modules/inventory/ledger";
import { lotReleaseBlockers } from "@/modules/inventory";
import { deviationBlockerMessages, deviationFacts, deviationsFor } from "./deviations";
import { batchInspectionFacts, inspectionsFor, lotInspectionFacts } from "./inspections";
import { liveResults } from "./inspection-rules";
import { queueStatusLabel } from "./status-labels";
import {
  BATCH_AWAITING_DECISION,
  BATCH_DECIDED_STATUSES,
  BATCH_TRANSITIONS,
  LOT_DECISIONS,
  LOT_TRANSITIONS,
  MIN_REASON_LENGTH,
  batchReleaseBlockers,
  isLotExpired,
  lotDecisionBlocker,
  type BatchDecision,
  type LotDecision,
} from "./rules";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const operator = alias(users, "operator_user");
const checker = alias(users, "checker_user");

function assertUuid(id: string, what: string) {
  if (!UUID_RE.test(id)) throw new DomainError("not_found", `${what} not found.`);
}

function cleanReason(reason: string): string {
  const r = (reason ?? "").trim();
  if (r.length < MIN_REASON_LENGTH) throw new DomainError("validation", `Give a reason of at least ${MIN_REASON_LENGTH} characters.`, { field: "reason" });
  if (r.length > 1000) throw new DomainError("validation", "Reason is too long (max 1,000 characters).", { field: "reason" });
  return r;
}

/* ------------------------------------------------------------------ queue */

export async function getQaQueue(ctx: AuthContext) {
  ctx.require("quality.disposition.view");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);

  const lotRows = await db
    .select({
      id: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      itemKind: inventoryLots.itemKind,
      qualityStatus: inventoryLots.qualityStatus,
      expiresOn: inventoryLots.expiresOn,
      supplierName: inventoryLots.supplierName,
      supplierLotNumber: inventoryLots.supplierLotNumber,
      baseUom: inventoryLots.baseUom,
      createdAt: inventoryLots.createdAt,
      materialName: materials.name,
      materialCode: materials.code,
      productName: products.name,
      productSku: products.skuCode,
    })
    .from(inventoryLots)
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .where(
      and(
        eq(inventoryLots.siteId, siteId),
        eq(inventoryLots.organizationId, ctx.organizationId),
        or(and(eq(inventoryLots.qualityStatus, "quarantine"), eq(inventoryLots.itemKind, "material")), eq(inventoryLots.qualityStatus, "on_hold")),
      ),
    )
    .orderBy(asc(inventoryLots.createdAt));

  const lotIds = lotRows.map((l) => l.id);
  const qtyRows = lotIds.length
    ? await db
        .select({ lotId: inventoryBalances.lotId, qty: sql<string>`sum(${inventoryBalances.qtyBase})::text`, locs: sql<string>`string_agg(${locations.code}, ', ' order by ${locations.code})` })
        .from(inventoryBalances)
        .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
        .where(and(inArray(inventoryBalances.lotId, lotIds), gt(inventoryBalances.qtyBase, "0")))
        .groupBy(inventoryBalances.lotId)
    : [];
  const receiptRows = lotIds.length
    ? await db
        .select({ lotId: goodsReceiptLines.lotId, receiptNumber: goodsReceipts.receiptNumber, receivedAt: goodsReceipts.receivedAt, receivedByName: users.displayName })
        .from(goodsReceiptLines)
        .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.goodsReceiptId))
        .innerJoin(users, eq(users.id, goodsReceipts.receivedBy))
        .where(inArray(goodsReceiptLines.lotId, lotIds))
    : [];
  const lots = lotRows.map((l) => {
    const q = qtyRows.find((r) => r.lotId === l.id);
    const r = receiptRows.find((x) => x.lotId === l.id);
    return {
      ...l,
      itemName: l.materialName ?? l.productName ?? "—",
      itemCode: l.materialCode ?? l.productSku ?? "",
      onHand: q?.qty ?? "0",
      locationCodes: q?.locs ?? "",
      receiptNumber: r?.receiptNumber ?? null,
      receivedAt: r?.receivedAt ?? l.createdAt,
      receivedByName: r?.receivedByName ?? null,
      expired: isLotExpired(l),
    };
  });

  const outLot = alias(inventoryLots, "out_lot");
  const batchRows = await db
    .select({
      id: batches.id,
      batchNumber: batches.batchNumber,
      status: batches.status,
      completedAt: batches.completedAt,
      yieldPct: batches.yieldPct,
      actualUnits: batches.actualUnits,
      productName: products.name,
      outputLotId: outLot.id,
      outputLotNumber: outLot.lotNumber,
      outputLotStatus: outLot.qualityStatus,
      testCount: sql<number>`(select count(*)::int from ${testResults} r where r.batch_id = ${batches.id} and not exists (select 1 from ${testResults} s where s.supersedes_id = r.id))`,
      failedCount: sql<number>`(select count(*)::int from ${testResults} r where r.batch_id = ${batches.id} and not r.passed and not exists (select 1 from ${testResults} s where s.supersedes_id = r.id))`,
      inspectionStatus: sql<string | null>`(select i.status from inspections i where i.batch_id = ${batches.id} and i.status <> 'cancelled' order by i.created_at desc limit 1)`,
      openDeviations: sql<number>`(select count(*)::int from deviations d where (d.batch_id = ${batches.id} or d.lot_id = ${batches.outputLotId}) and d.status <> 'closed')`,
    })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .leftJoin(outLot, eq(outLot.id, batches.outputLotId))
    .where(and(eq(batches.siteId, siteId), eq(batches.organizationId, ctx.organizationId), inArray(batches.status, [...BATCH_AWAITING_DECISION])))
    .orderBy(asc(batches.completedAt));

  const decisions = await recentDecisions(ctx, siteId, 20);
  return { lots, batches: batchRows, decisions };
}

async function recentDecisions(ctx: AuthContext, siteId: string, limit: number) {
  const rows = await db
    .select({
      id: dispositions.id,
      subjectType: dispositions.subjectType,
      subjectId: dispositions.subjectId,
      decision: dispositions.decision,
      fromStatus: dispositions.fromStatus,
      toStatus: dispositions.toStatus,
      reason: dispositions.reason,
      decidedAt: dispositions.decidedAt,
      decidedByName: users.displayName,
    })
    .from(dispositions)
    .innerJoin(users, eq(users.id, dispositions.decidedBy))
    .where(and(eq(dispositions.siteId, siteId), eq(dispositions.organizationId, ctx.organizationId)))
    .orderBy(desc(dispositions.decidedAt), desc(dispositions.id))
    .limit(limit);
  const lotIds = rows.filter((r) => r.subjectType === "lot").map((r) => r.subjectId);
  const batchIds = rows.filter((r) => r.subjectType === "batch").map((r) => r.subjectId);
  const lotNums = lotIds.length ? await db.select({ id: inventoryLots.id, n: inventoryLots.lotNumber }).from(inventoryLots).where(inArray(inventoryLots.id, lotIds)) : [];
  const batchNums = batchIds.length ? await db.select({ id: batches.id, n: batches.batchNumber }).from(batches).where(inArray(batches.id, batchIds)) : [];
  return rows.map((r) => ({
    ...r,
    subjectNumber: (r.subjectType === "lot" ? lotNums : batchNums).find((x) => x.id === r.subjectId)?.n ?? "—",
    href: r.subjectType === "lot" ? `/quality/lots/${r.subjectId}` : `/quality/batches/${r.subjectId}`,
  }));
}

async function historyFor(subjectType: "lot" | "batch", subjectId: string) {
  return db
    .select({
      id: dispositions.id,
      decision: dispositions.decision,
      fromStatus: dispositions.fromStatus,
      toStatus: dispositions.toStatus,
      reason: dispositions.reason,
      decidedAt: dispositions.decidedAt,
      decidedByName: users.displayName,
    })
    .from(dispositions)
    .innerJoin(users, eq(users.id, dispositions.decidedBy))
    .where(and(eq(dispositions.subjectType, subjectType), eq(dispositions.subjectId, subjectId)))
    .orderBy(desc(dispositions.decidedAt), desc(dispositions.id));
}

/* ---------------------------------------------------------- lot decision */

/** Users who received the lot (goods receipt received_by) or created it; they may not release it. */
async function receiverIds(tx: Tx | typeof db, lot: { id: string; createdBy: string | null }) {
  const rows = await tx
    .select({ by: goodsReceipts.receivedBy })
    .from(goodsReceiptLines)
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.goodsReceiptId))
    .where(eq(goodsReceiptLines.lotId, lot.id));
  const ids = new Set(rows.map((r) => r.by));
  if (lot.createdBy) ids.add(lot.createdBy);
  return ids;
}

/** Batch number when the lot is a finished-goods output still waiting for batch disposition. */
async function pendingBatchFor(tx: Tx | typeof db, lot: { sourceBatchId: string | null }) {
  if (!lot.sourceBatchId) return null;
  const [b] = await tx.select({ id: batches.id, number: batches.batchNumber, status: batches.status }).from(batches).where(eq(batches.id, lot.sourceBatchId)).limit(1);
  if (!b) return null;
  return (BATCH_DECIDED_STATUSES as readonly string[]).includes(b.status) ? null : b;
}

/**
 * W2C (US-3-14/15/21): what inspections and deviations say about releasing a lot. Open or rejected
 * inspections, failed results without a permitting OOS closure, and open or "not releasable"
 * deviations block release; result-entry users may not decide (separation of duties).
 */
async function lotQualityFacts(q: Tx | typeof db, lotId: string) {
  const insp = await lotInspectionFacts(q, lotId);
  const dev = await deviationFacts(q, { lotIds: [lotId] });
  const blockers: string[] = [];
  for (const f of insp) {
    const i = f.inspection!;
    if (i.status === "rejected") blockers.push(`Inspection ${i.number} was rejected by QA review.`);
    else if (i.status !== "approved") blockers.push(`Inspection ${i.number} is ${i.status.replace(/_/g, " ")}; a second QA user must review and approve it before release.`);
    const failed = f.failed.filter((x) => !dev.permittedResultIds.has(x.resultId));
    if (failed.length) blockers.push(`Failed test(s) ${failed.map((x) => x.testName).join(", ")} on inspection ${i.number} need an OOS deviation closed with the conclusion that release may proceed.`);
  }
  blockers.push(...deviationBlockerMessages(dev));
  return { blockers, testers: new Set(insp.flatMap((f) => f.testerIds)) };
}

export async function getLotDisposition(ctx: AuthContext, lotId: string) {
  ctx.require("quality.disposition.view");
  assertUuid(lotId, "Lot");
  const [row] = await db
    .select({
      lot: inventoryLots,
      materialName: materials.name,
      materialCode: materials.code,
      productName: products.name,
      productSku: products.skuCode,
      createdByName: users.displayName,
    })
    .from(inventoryLots)
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .leftJoin(users, eq(users.id, inventoryLots.createdBy))
    .where(and(eq(inventoryLots.id, lotId), eq(inventoryLots.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Lot not found.");
  ctx.requireSite(row.lot.siteId);
  const lot = row.lot;

  const [receipt] = await db
    .select({
      receiptId: goodsReceipts.id,
      receiptNumber: goodsReceipts.receiptNumber,
      supplierName: goodsReceipts.supplierName,
      supplierDocumentNumber: goodsReceipts.supplierDocumentNumber,
      receivedAt: goodsReceipts.receivedAt,
      receivedByName: users.displayName,
      qtyReceived: goodsReceiptLines.qtyBase,
    })
    .from(goodsReceiptLines)
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.goodsReceiptId))
    .innerJoin(users, eq(users.id, goodsReceipts.receivedBy))
    .where(eq(goodsReceiptLines.lotId, lot.id))
    .limit(1);

  const stock = await db
    .select({ locationCode: locations.code, locationName: locations.name, kind: locations.kind, qty: inventoryBalances.qtyBase })
    .from(inventoryBalances)
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .where(and(eq(inventoryBalances.lotId, lot.id), gt(inventoryBalances.qtyBase, "0")))
    .orderBy(asc(locations.code));

  const sourceBatch = lot.sourceBatchId
    ? (await db.select({ id: batches.id, number: batches.batchNumber, status: batches.status }).from(batches).where(eq(batches.id, lot.sourceBatchId)).limit(1))[0] ?? null
    : null;
  const pending = await pendingBatchFor(db, lot);
  const receivers = await receiverIds(db, lot);
  const isReceiver = receivers.has(ctx.userId);
  const qf = await lotQualityFacts(db, lot.id);
  const releaseBlockers = [...(await lotReleaseBlockers(db, lot.id)), ...qf.blockers];
  const isTester = qf.testers.has(ctx.userId);
  const decisions = LOT_DECISIONS.map((d) => ({
    decision: d,
    label: LOT_TRANSITIONS[d].label,
    toStatus: LOT_TRANSITIONS[d].to,
    blocker: lotDecisionBlocker(d, lot, { isReceiver, isTester, pendingBatchNumber: pending?.number ?? null, releaseBlockers })?.message ?? null,
  }));

  return {
    lot,
    itemName: row.materialName ?? row.productName ?? "—",
    itemCode: row.materialCode ?? row.productSku ?? "",
    createdByName: row.createdByName,
    receipt: receipt ?? null,
    stock,
    sourceBatch,
    pendingBatch: pending,
    expired: isLotExpired(lot),
    releaseBlockers,
    isReceiver,
    canDecide: ctx.can("quality.disposition.approve"),
    decisions,
    history: await historyFor("lot", lot.id),
    inspections: lot.sourceBatchId ? [] : await inspectionsFor(db, { lotId: lot.id }),
    deviations: await deviationsFor(db, { lotIds: [lot.id] }),
    can: {
      startInspection: lot.itemKind === "material" && ["quarantine", "on_hold"].includes(lot.qualityStatus) && ctx.can("quality.inspection.create"),
      raiseDeviation: ctx.can("quality.deviation.create"),
    },
  };
}

export type DecideLotInput = { lotId: string; decision: LotDecision; reason: string };

async function siteLocation(tx: Tx, siteId: string, kind: "rejected" | "fg") {
  const where =
    kind === "rejected"
      ? and(eq(locations.siteId, siteId), eq(locations.kind, "rejected"), eq(locations.isActive, true))
      : and(eq(locations.siteId, siteId), eq(locations.kind, "storage"), like(locations.code, "FG%"), eq(locations.isActive, true));
  const [l] = await tx.select().from(locations).where(where).orderBy(asc(locations.code)).limit(1);
  if (!l) {
    throw new DomainError(
      "conflict",
      kind === "rejected"
        ? "This site has no active rejected-goods location. Ask an administrator to set one up before rejecting."
        : "This site has no finished-goods storage location (code starting with FG). Ask an administrator to set one up before releasing.",
    );
  }
  return l;
}

/** Moves every positive balance of the lot (optionally only from some location kinds) into `to`. */
async function moveLotStock(
  tx: Tx,
  ctx: AuthContext,
  lot: { id: string; lotNumber: string },
  to: { id: string },
  doc: { id: string; number: string; reason: string },
  fromKinds?: string[],
) {
  const bals = await tx
    .select({ locationId: inventoryBalances.locationId, qty: inventoryBalances.qtyBase, kind: locations.kind })
    .from(inventoryBalances)
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .where(and(eq(inventoryBalances.lotId, lot.id), gt(inventoryBalances.qtyBase, "0"), ne(inventoryBalances.locationId, to.id)))
    .orderBy(asc(inventoryBalances.locationId));
  const moved: { locationId: string; qty: string }[] = [];
  for (const b of bals) {
    if (fromKinds && !fromKinds.includes(b.kind)) continue;
    await postMovement(tx, ctx, {
      movementType: "transfer",
      lotId: lot.id,
      fromLocationId: b.locationId,
      toLocationId: to.id,
      qtyBase: b.qty,
      sourceDocumentType: "disposition",
      sourceDocumentId: doc.id,
      sourceDocumentNumber: doc.number,
      reason: doc.reason,
      idempotencyKey: `disposition:${doc.id}:${b.locationId}`,
    });
    moved.push({ locationId: b.locationId, qty: b.qty });
  }
  return moved;
}

/**
 * Records a lot decision. `opts.statusLabel` queues the new status label afterwards (A-RPT-10); the bulk
 * disposition uses it, the single-lot screen leaves printing to the user's Print label action (W1E flow).
 */
export async function decideLot(ctx: AuthContext, input: DecideLotInput, opts: { statusLabel?: boolean } = {}) {
  const r = await decideLotTx(ctx, input);
  const label = opts.statusLabel ? await queueStatusLabel(ctx, { id: r.lotId, siteId: r.siteId, lotNumber: r.lotNumber }, r.dispositionId) : { queued: false, note: null };
  return { ...r, labelQueued: label.queued, labelNote: label.note };
}

async function decideLotTx(ctx: AuthContext, input: DecideLotInput) {
  ctx.require("quality.disposition.approve");
  const t = LOT_TRANSITIONS[input.decision];
  if (!t) throw new DomainError("validation", "Choose a decision.", { field: "decision" });
  assertUuid(input.lotId, "Lot");
  const reason = cleanReason(input.reason);

  return db.transaction(async (tx) => {
    // Lock the lot row: concurrent decisions on the same lot serialize here and re-check state.
    const [lot] = await tx
      .select()
      .from(inventoryLots)
      .where(and(eq(inventoryLots.id, input.lotId), eq(inventoryLots.organizationId, ctx.organizationId)))
      .for("update")
      .limit(1);
    if (!lot) throw new DomainError("not_found", "Lot not found.");
    ctx.requireSite(lot.siteId);

    const pending = await pendingBatchFor(tx, lot);
    const receivers = await receiverIds(tx, lot);
    const qf = t.to === "released" ? await lotQualityFacts(tx, lot.id) : { blockers: [], testers: new Set<string>() };
    const releaseBlockers = t.to === "released" ? [...(await lotReleaseBlockers(tx, lot.id)), ...qf.blockers] : [];
    const blocker = lotDecisionBlocker(input.decision, lot, { isReceiver: receivers.has(ctx.userId), isTester: qf.testers.has(ctx.userId), pendingBatchNumber: pending?.number ?? null, releaseBlockers });
    if (blocker) throw new DomainError(blocker.code, blocker.message);

    const dispositionId = uuidv7();
    let moved: { locationId: string; qty: string }[] = [];
    let toLocationCode: string | null = null;
    if (t.to === "rejected") {
      const rej = await siteLocation(tx, lot.siteId, "rejected");
      toLocationCode = rej.code;
      moved = await moveLotStock(tx, ctx, lot, rej, { id: dispositionId, number: lot.lotNumber, reason: `QA reject: ${reason}` });
    }

    await tx.insert(dispositions).values({
      id: dispositionId,
      organizationId: ctx.organizationId,
      siteId: lot.siteId,
      subjectType: "lot",
      subjectId: lot.id,
      decision: input.decision,
      fromStatus: lot.qualityStatus,
      toStatus: t.to,
      reason,
      decidedBy: ctx.userId,
    });
    await tx.update(inventoryLots).set({ qualityStatus: t.to }).where(eq(inventoryLots.id, lot.id));
    await audit(tx, ctx, {
      action: `quality.disposition.${t.event}`,
      entityType: "inventory_lot",
      entityId: lot.id,
      entityNumber: lot.lotNumber,
      siteId: lot.siteId,
      reason,
      before: { qualityStatus: lot.qualityStatus },
      after: { qualityStatus: t.to, decision: input.decision, dispositionId, movedTo: toLocationCode, moved },
    });
    return { dispositionId, lotId: lot.id, siteId: lot.siteId, lotNumber: lot.lotNumber, fromStatus: lot.qualityStatus, toStatus: t.to, movedTo: toLocationCode };
  });
}

/* -------------------------------------------------------- batch release */

type Snapshot = { steps?: { stepNo: number; name: string; routingStepId: string }[] };

/** Facts used for release blockers; works inside or outside a transaction. */
async function batchFacts(q: Tx | typeof db, ctx: AuthContext, batch: typeof batches.$inferSelect, lot: typeof inventoryLots.$inferSelect | null, opts: { conditional?: boolean } = {}) {
  const tests = liveResults(
    await q.select({ id: testResults.id, testName: testResults.testName, passed: testResults.passed, supersedesId: testResults.supersedesId, testedBy: testResults.testedBy }).from(testResults).where(eq(testResults.batchId, batch.id)),
  );
  const steps = (batch.formulaSnapshot as Snapshot).steps ?? [];
  const done = await q.select({ routingStepId: processStepRecords.routingStepId, conductedBy: processStepRecords.conductedBy, checkedBy: processStepRecords.checkedBy }).from(processStepRecords).where(eq(processStepRecords.batchId, batch.id));
  const doneIds = new Set(done.map((d) => d.routingStepId));
  const lines = await q
    .select({ lineNo: batchMaterials.lineNo, status: batchMaterials.status, name: materials.name })
    .from(batchMaterials)
    .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
    .where(eq(batchMaterials.batchId, batch.id));
  const people = await q
    .select({ operatorId: dispenseRecords.operatorId, checkerId: dispenseRecords.checkerId })
    .from(dispenseRecords)
    .innerJoin(batchMaterials, eq(batchMaterials.id, dispenseRecords.batchMaterialId))
    .where(eq(batchMaterials.batchId, batch.id));
  const involved = new Set<string>();
  for (const p of people) involved.add(p.operatorId).add(p.checkerId);
  for (const d of done) {
    involved.add(d.conductedBy);
    if (d.checkedBy) involved.add(d.checkedBy);
  }

  // W2C: inspection of the frozen plan, deviations, holds/receiving rules of the output lot, OOS closures.
  const dev = await deviationFacts(q, { batchId: batch.id, lotIds: lot ? [lot.id] : [] });
  const insp = await batchInspectionFacts(q, batch);
  const extra: string[] = [];
  const testers = new Set(tests.map((t) => t.testedBy));
  if (insp) {
    for (const id of insp.testerIds) testers.add(id);
    if (!insp.inspection) extra.push("The finished-product inspection has not been started. Start it from the QA queue and enter the plan's tests.");
    else if (insp.inspection.status === "rejected") extra.push(`Inspection ${insp.inspection.number} was rejected by QA review.`);
    // A conditional release (W06 exception path) is the one decision that may precede a complete, reviewed inspection.
    else if (insp.inspection.status !== "approved" && !opts.conditional) extra.push(`Inspection ${insp.inspection.number} is ${insp.inspection.status.replace(/_/g, " ")}; a second QA user must review and approve it before release.`);
    if (insp.inspection && insp.missing.length && !opts.conditional) extra.push(`Required test(s) without a result: ${insp.missing.join(", ")}.`);
  }
  extra.push(...deviationBlockerMessages(dev));
  if (lot) extra.push(...(await lotReleaseBlockers(q, lot.id)));
  const failed = (insp ? insp.failed : tests.filter((x) => !x.passed).map((x) => ({ resultId: x.id, testName: x.testName }))).filter((f) => !dev.permittedResultIds.has(f.resultId));

  return batchReleaseBlockers({
    status: batch.status,
    hasOutputLot: !!lot,
    outputLotStatus: lot?.qualityStatus ?? null,
    outputLotExpired: lot ? isLotExpired(lot) : false,
    testCount: insp ? insp.liveCount : opts.conditional ? Math.max(tests.length, 1) : tests.length,
    failedTests: failed.map((x) => x.testName),
    missingSteps: steps.filter((s) => !doneIds.has(s.routingStepId)).map((s) => `${s.stepNo}. ${s.name}`),
    pendingLines: lines.filter((l) => l.status === "pending").map((l) => `${l.lineNo}. ${l.name}`),
    isOperatorOrChecker: involved.has(ctx.userId),
    isTester: testers.has(ctx.userId),
    planDriven: !!insp,
    extraBlockers: extra,
  });
}

/** Blockers a conditional release would face for this batch (conditional-release.ts). */
export async function conditionalReleaseBlockers(q: Tx | typeof db, ctx: AuthContext, batch: typeof batches.$inferSelect) {
  const lot = batch.outputLotId ? ((await q.select().from(inventoryLots).where(eq(inventoryLots.id, batch.outputLotId)).limit(1))[0] ?? null) : null;
  return batchFacts(q, ctx, batch, lot, { conditional: true });
}

export async function getBatchRelease(ctx: AuthContext, batchId: string) {
  ctx.require("quality.disposition.view");
  assertUuid(batchId, "Batch");
  const [row] = await db
    .select({ batch: batches, productName: products.name, productSku: products.skuCode })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Batch not found.");
  ctx.requireSite(row.batch.siteId);
  const batch = row.batch;

  const lot = batch.outputLotId ? ((await db.select().from(inventoryLots).where(eq(inventoryLots.id, batch.outputLotId)).limit(1))[0] ?? null) : null;
  const lotStock = lot
    ? await db
        .select({ locationCode: locations.code, kind: locations.kind, qty: inventoryBalances.qtyBase })
        .from(inventoryBalances)
        .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
        .where(and(eq(inventoryBalances.lotId, lot.id), gt(inventoryBalances.qtyBase, "0")))
        .orderBy(asc(locations.code))
    : [];

  const lines = await db
    .select({
      id: batchMaterials.id,
      lineNo: batchMaterials.lineNo,
      materialName: materials.name,
      materialCode: materials.code,
      theoreticalQtyG: batchMaterials.theoreticalQtyG,
      tolerancePct: batchMaterials.tolerancePct,
      dispensedQtyG: batchMaterials.dispensedQtyG,
      status: batchMaterials.status,
    })
    .from(batchMaterials)
    .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
    .where(eq(batchMaterials.batchId, batch.id))
    .orderBy(asc(batchMaterials.lineNo));
  const dispenses = lines.length
    ? await db
        .select({
          batchMaterialId: dispenseRecords.batchMaterialId,
          lotId: inventoryLots.id,
          lotNumber: inventoryLots.lotNumber,
          actualQtyG: dispenseRecords.actualQtyG,
          isWithinTolerance: dispenseRecords.isWithinTolerance,
          exceptionReason: dispenseRecords.exceptionReason,
          operatorName: operator.displayName,
          checkerName: checker.displayName,
          recordedAt: dispenseRecords.recordedAt,
        })
        .from(dispenseRecords)
        .innerJoin(inventoryLots, eq(inventoryLots.id, dispenseRecords.lotId))
        .innerJoin(operator, eq(operator.id, dispenseRecords.operatorId))
        .innerJoin(checker, eq(checker.id, dispenseRecords.checkerId))
        .where(inArray(dispenseRecords.batchMaterialId, lines.map((l) => l.id)))
        .orderBy(asc(dispenseRecords.recordedAt))
    : [];

  const steps = (batch.formulaSnapshot as Snapshot).steps ?? [];
  const stepRecords = await db
    .select({ routingStepId: processStepRecords.routingStepId, conductedByName: operator.displayName, checkedByName: checker.displayName, completedAt: processStepRecords.completedAt })
    .from(processStepRecords)
    .innerJoin(operator, eq(operator.id, processStepRecords.conductedBy))
    .leftJoin(checker, eq(checker.id, processStepRecords.checkedBy))
    .where(eq(processStepRecords.batchId, batch.id));

  const tests = await db
    .select({
      id: testResults.id,
      testName: testResults.testName,
      specification: testResults.specification,
      result: testResults.result,
      passed: testResults.passed,
      testedAt: testResults.testedAt,
      testedByName: users.displayName,
      supersedesId: testResults.supersedesId,
      correctionReason: testResults.correctionReason,
      inspectionId: testResults.inspectionId,
    })
    .from(testResults)
    .innerJoin(users, eq(users.id, testResults.testedBy))
    .where(eq(testResults.batchId, batch.id))
    .orderBy(asc(testResults.testedAt), asc(testResults.id));
  const liveIds = new Set(liveResults(tests).map((t) => t.id));

  const blockers = await batchFacts(db, ctx, batch, lot);
  const inspection = await batchInspectionFacts(db, batch);
  const snap = batch.formulaSnapshot as { inspectionPlan?: { code: string; revisionNo: number; isPlaceholder: boolean } | null };
  return {
    batch,
    productName: row.productName,
    productSku: row.productSku,
    lot,
    lotStock,
    lines: lines.map((l) => ({ ...l, dispenses: dispenses.filter((d) => d.batchMaterialId === l.id) })),
    exceptionCount: lines.filter((l) => l.status === "exception").length + dispenses.filter((d) => !d.isWithinTolerance).length,
    steps: steps.map((s) => ({ ...s, record: stepRecords.find((r) => r.routingStepId === s.routingStepId) ?? null })),
    tests: tests.map((t) => ({ ...t, live: liveIds.has(t.id) })),
    blockers,
    canReject: BATCH_TRANSITIONS.reject.from.includes(batch.status),
    canDecide: ctx.can("quality.disposition.approve"),
    // Free-form MVP results only for batches without a frozen plan; planned batches use their inspection.
    canRecordTest: ctx.can("quality.test_result.create") && !batch.inspectionPlanId,
    planDriven: !!batch.inspectionPlanId,
    plan: snap.inspectionPlan ? { code: snap.inspectionPlan.code, revisionNo: snap.inspectionPlan.revisionNo, isPlaceholder: snap.inspectionPlan.isPlaceholder } : null,
    inspection: inspection?.inspection ?? null,
    inspections: await inspectionsFor(db, { batchId: batch.id }),
    deviations: await deviationsFor(db, { batchId: batch.id, lotIds: lot ? [lot.id] : [] }),
    can: {
      startInspection: !!batch.inspectionPlanId && !inspection?.inspection && ["in_process", "awaiting_qc"].includes(batch.status) && ctx.can("quality.inspection.create"),
      raiseDeviation: ctx.can("quality.deviation.create"),
    },
    history: await historyFor("batch", batch.id),
  };
}

export type DecideBatchInput = { batchId: string; decision: BatchDecision; reason: string };

export async function decideBatch(ctx: AuthContext, input: DecideBatchInput) {
  const r = await decideBatchTx(ctx, input);
  // US-3-15: the finished-goods label is reprinted with its new status (A-RPT-10) after the decision commits.
  const label = r.lotId ? await queueStatusLabel(ctx, { id: r.lotId, siteId: r.siteId, lotNumber: r.lotNumber! }, r.lotDispositionId) : { queued: false, note: null };
  return { ...r, labelQueued: label.queued, labelNote: label.note };
}

async function decideBatchTx(ctx: AuthContext, input: DecideBatchInput) {
  ctx.require("quality.disposition.approve");
  if (!BATCH_TRANSITIONS[input.decision]) throw new DomainError("validation", "Choose a decision.", { field: "decision" });
  assertUuid(input.batchId, "Batch");
  const reason = cleanReason(input.reason);
  return db.transaction((tx) => decideBatchInTx(tx, ctx, { batchId: input.batchId, decision: input.decision, reason }));
}

/** Conditional release (W06-05): the first qa_qc user requested it; the caller is the second approver. */
export type ConditionalBasis = { requestedBy: string; conditions: string; reviewDate: string };

/**
 * Batch decision inside the caller's transaction (release, reject, or a conditional release when
 * `conditional` is given). Locks the batch and its output lot, re-checks every blocker, moves stock and
 * writes dispositions, transitions and audit events. Callers check permissions.
 */
export async function decideBatchInTx(tx: Tx, ctx: AuthContext, input: { batchId: string; decision: BatchDecision; reason: string; conditional?: ConditionalBasis | null }) {
  const t = BATCH_TRANSITIONS[input.decision];
  const reason = input.reason;
  {
    const [batch] = await tx
      .select()
      .from(batches)
      .where(and(eq(batches.id, input.batchId), eq(batches.organizationId, ctx.organizationId)))
      .for("update")
      .limit(1);
    if (!batch) throw new DomainError("not_found", "Batch not found.");
    ctx.requireSite(batch.siteId);
    if (!t.from.includes(batch.status)) throw new DomainError("state", `The batch is ${batch.status.replace(/_/g, " ")}; it can only be decided while awaiting QC or quarantined.`);

    const lot = batch.outputLotId
      ? ((await tx.select().from(inventoryLots).where(eq(inventoryLots.id, batch.outputLotId)).for("update").limit(1))[0] ?? null)
      : null;

    if (input.decision === "release") {
      const blockers = await batchFacts(tx, ctx, batch, lot, { conditional: !!input.conditional });
      const sod = blockers.find((b) => b.code === "separation_of_duties");
      if (sod) throw new DomainError("separation_of_duties", sod.message);
      if (blockers.length) throw new DomainError("state", blockers.map((b) => b.message).join(" "));
    }

    const batchDispositionId = uuidv7();
    const lotDispositionId = uuidv7();
    const inspectionId = (await batchInspectionFacts(tx, batch))?.inspection?.id ?? null;
    let moved: { locationId: string; qty: string }[] = [];
    let toLocationCode: string | null = null;
    if (lot) {
      if (input.decision === "release") {
        const fg = await siteLocation(tx, batch.siteId, "fg");
        toLocationCode = fg.code;
        moved = await moveLotStock(tx, ctx, lot, fg, { id: lotDispositionId, number: batch.batchNumber, reason: `QA release of batch ${batch.batchNumber}` }, ["quarantine"]);
      } else {
        const rej = await siteLocation(tx, batch.siteId, "rejected");
        toLocationCode = rej.code;
        moved = await moveLotStock(tx, ctx, lot, rej, { id: lotDispositionId, number: batch.batchNumber, reason: `QA reject of batch ${batch.batchNumber}: ${reason}` });
      }
    }

    await tx.update(batches).set({ status: t.to }).where(eq(batches.id, batch.id));
    await tx.insert(batchStateTransitions).values({ batchId: batch.id, fromState: batch.status, toState: t.to, actorId: ctx.userId, reason });
    await tx.insert(dispositions).values({
      id: batchDispositionId,
      organizationId: ctx.organizationId,
      siteId: batch.siteId,
      subjectType: "batch",
      subjectId: batch.id,
      decision: input.conditional ? "conditional_release" : input.decision,
      fromStatus: batch.status,
      toStatus: t.to,
      reason,
      decidedBy: ctx.userId,
      inspectionId,
      requestedBy: input.conditional?.requestedBy ?? null,
      conditions: input.conditional?.conditions ?? null,
      reviewDate: input.conditional?.reviewDate ?? null,
    });
    await audit(tx, ctx, {
      action: `quality.disposition.${t.event}`,
      entityType: "batch",
      entityId: batch.id,
      entityNumber: batch.batchNumber,
      siteId: batch.siteId,
      reason,
      before: { status: batch.status },
      after: { status: t.to, dispositionId: batchDispositionId, outputLot: lot?.lotNumber ?? null },
    });

    if (lot) {
      const lotTo = input.decision === "release" ? "released" : "rejected";
      await tx.insert(dispositions).values({
        id: lotDispositionId,
        organizationId: ctx.organizationId,
        siteId: lot.siteId,
        subjectType: "lot",
        subjectId: lot.id,
        decision: input.conditional ? "conditional_release" : input.decision,
        fromStatus: lot.qualityStatus,
        toStatus: lotTo,
        reason,
        decidedBy: ctx.userId,
        inspectionId,
        requestedBy: input.conditional?.requestedBy ?? null,
        conditions: input.conditional?.conditions ?? null,
        reviewDate: input.conditional?.reviewDate ?? null,
      });
      await tx.update(inventoryLots).set({ qualityStatus: lotTo }).where(eq(inventoryLots.id, lot.id));
      await audit(tx, ctx, {
        action: `quality.disposition.${t.event}`,
        entityType: "inventory_lot",
        entityId: lot.id,
        entityNumber: lot.lotNumber,
        siteId: lot.siteId,
        reason,
        before: { qualityStatus: lot.qualityStatus },
        after: { qualityStatus: lotTo, dispositionId: lotDispositionId, batch: batch.batchNumber, movedTo: toLocationCode, moved },
      });
    }
    return { batchNumber: batch.batchNumber, toStatus: t.to, lotNumber: lot?.lotNumber ?? null, lotId: lot?.id ?? null, siteId: batch.siteId, lotDispositionId, movedTo: toLocationCode };
  }
}

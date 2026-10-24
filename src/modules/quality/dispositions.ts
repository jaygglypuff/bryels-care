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
import { assertPaperRecordsReviewed } from "@/modules/production";
import {
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
      testCount: sql<number>`(select count(*)::int from ${testResults} where ${testResults.batchId} = ${batches.id})`,
      failedCount: sql<number>`(select count(*)::int from ${testResults} where ${testResults.batchId} = ${batches.id} and not ${testResults.passed})`,
    })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .leftJoin(outLot, eq(outLot.id, batches.outputLotId))
    .where(and(eq(batches.siteId, siteId), eq(batches.organizationId, ctx.organizationId), eq(batches.status, "awaiting_qc")))
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
  const releaseBlockers = await lotReleaseBlockers(db, lot.id);
  const decisions = LOT_DECISIONS.map((d) => ({
    decision: d,
    label: LOT_TRANSITIONS[d].label,
    toStatus: LOT_TRANSITIONS[d].to,
    blocker: lotDecisionBlocker(d, lot, { isReceiver, pendingBatchNumber: pending?.number ?? null, releaseBlockers })?.message ?? null,
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

export async function decideLot(ctx: AuthContext, input: DecideLotInput) {
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
    const releaseBlockers = t.to === "released" ? await lotReleaseBlockers(tx, lot.id) : [];
    const blocker = lotDecisionBlocker(input.decision, lot, { isReceiver: receivers.has(ctx.userId), pendingBatchNumber: pending?.number ?? null, releaseBlockers });
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
    return { dispositionId, lotNumber: lot.lotNumber, fromStatus: lot.qualityStatus, toStatus: t.to, movedTo: toLocationCode };
  });
}

/* -------------------------------------------------------- batch release */

type Snapshot = { steps?: { stepNo: number; name: string; routingStepId: string }[] };

/** Facts used for release blockers; works inside or outside a transaction. */
async function batchFacts(q: Tx | typeof db, ctx: AuthContext, batch: typeof batches.$inferSelect, lot: typeof inventoryLots.$inferSelect | null) {
  const tests = await q.select({ testName: testResults.testName, passed: testResults.passed }).from(testResults).where(eq(testResults.batchId, batch.id));
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
  return batchReleaseBlockers({
    status: batch.status,
    hasOutputLot: !!lot,
    outputLotStatus: lot?.qualityStatus ?? null,
    outputLotExpired: lot ? isLotExpired(lot) : false,
    testCount: tests.length,
    failedTests: tests.filter((x) => !x.passed).map((x) => x.testName),
    missingSteps: steps.filter((s) => !doneIds.has(s.routingStepId)).map((s) => `${s.stepNo}. ${s.name}`),
    pendingLines: lines.filter((l) => l.status === "pending").map((l) => `${l.lineNo}. ${l.name}`),
    isOperatorOrChecker: involved.has(ctx.userId),
  });
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
    })
    .from(testResults)
    .innerJoin(users, eq(users.id, testResults.testedBy))
    .where(eq(testResults.batchId, batch.id))
    .orderBy(asc(testResults.testedAt), asc(testResults.id));

  const blockers = await batchFacts(db, ctx, batch, lot);
  return {
    batch,
    productName: row.productName,
    productSku: row.productSku,
    lot,
    lotStock,
    lines: lines.map((l) => ({ ...l, dispenses: dispenses.filter((d) => d.batchMaterialId === l.id) })),
    exceptionCount: lines.filter((l) => l.status === "exception").length + dispenses.filter((d) => !d.isWithinTolerance).length,
    steps: steps.map((s) => ({ ...s, record: stepRecords.find((r) => r.routingStepId === s.routingStepId) ?? null })),
    tests,
    blockers,
    canReject: BATCH_TRANSITIONS.reject.from.includes(batch.status),
    canDecide: ctx.can("quality.disposition.approve"),
    canRecordTest: ctx.can("quality.test_result.create"),
    history: await historyFor("batch", batch.id),
  };
}

export type DecideBatchInput = { batchId: string; decision: BatchDecision; reason: string };

export async function decideBatch(ctx: AuthContext, input: DecideBatchInput) {
  ctx.require("quality.disposition.approve");
  const t = BATCH_TRANSITIONS[input.decision];
  if (!t) throw new DomainError("validation", "Choose a decision.", { field: "decision" });
  assertUuid(input.batchId, "Batch");
  const reason = cleanReason(input.reason);

  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(batches)
      .where(and(eq(batches.id, input.batchId), eq(batches.organizationId, ctx.organizationId)))
      .for("update")
      .limit(1);
    if (!batch) throw new DomainError("not_found", "Batch not found.");
    ctx.requireSite(batch.siteId);
    if (!t.from.includes(batch.status)) throw new DomainError("state", `The batch is ${batch.status.replace("_", " ")}; it can only be decided while awaiting QC.`);
    // Wave 2 W2D (US-3-20, data-model §6.2): leaving awaiting_qc needs every paper page reviewed.
    await assertPaperRecordsReviewed(tx, batch.id, batch.batchNumber);

    const lot = batch.outputLotId
      ? ((await tx.select().from(inventoryLots).where(eq(inventoryLots.id, batch.outputLotId)).for("update").limit(1))[0] ?? null)
      : null;

    if (input.decision === "release") {
      const blockers = await batchFacts(tx, ctx, batch, lot);
      const sod = blockers.find((b) => b.code === "separation_of_duties");
      if (sod) throw new DomainError("separation_of_duties", sod.message);
      if (blockers.length) throw new DomainError("state", blockers.map((b) => b.message).join(" "));
    }

    const batchDispositionId = uuidv7();
    const lotDispositionId = uuidv7();
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
      decision: input.decision,
      fromStatus: batch.status,
      toStatus: t.to,
      reason,
      decidedBy: ctx.userId,
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
        decision: input.decision,
        fromStatus: lot.qualityStatus,
        toStatus: lotTo,
        reason,
        decidedBy: ctx.userId,
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
    return { batchNumber: batch.batchNumber, toStatus: t.to, lotNumber: lot?.lotNumber ?? null, movedTo: toLocationCode };
  });
}

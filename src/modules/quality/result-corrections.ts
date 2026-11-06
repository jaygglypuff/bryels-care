import "server-only";
import { and, asc, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db, type DbOrTx, type Tx } from "@/db/client";
import { batches, dispositions, inventoryLots, qaResultCorrections, stockMovements, stockReservations, testResults, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { lockLots, moveBoxesWithLot, postMovement } from "@/modules/inventory";
import { type ApprovalVerdict } from "@/modules/governance";
import { notifyUsers, usersHoldingPermissionAt } from "@/modules/platform/notifications";
import { reopenBatchForQaCorrection } from "@/modules/production";
import { appendInspectionCorrectionTx, lockInspectionForCorrection, reopenInspectionForCorrectionTx } from "./inspections";
import { isUuid, withIdempotency } from "./shared";

/**
 * Correcting a QA test result (ADR-104 §3, A-FD-04). Results are append-only: a correction is a new row superseding
 * the old one (test_results.supersedes_id + correction_reason); the old value stays visible struck through.
 *
 * | When                                   | Who                                        | What                                                       |
 * |----------------------------------------|--------------------------------------------|------------------------------------------------------------|
 * | Before the decision (batch in process, | the person who entered it or another QA    | `correctTestResult`: the superseding row now (a reviewed   |
 * | waiting for QA)                        | user (quality.test_result.create)          | inspection is opened again for the next review)            |
 * | After the decision (passed, failed,    | asks: quality.test_result.create;          | `requestResultCorrection` → `decideResultCorrection`:      |
 * | closed)                                | decides: a SECOND QA person by own roles   | superseding row + decision re-opened in one transaction:   |
 * |                                        | (quality.disposition.approve), never the   | decision's stock moves reversed, lot back to quarantine,   |
 * |                                        | requester; the owner override never applies | batch back to the quality check, inspection re-opened      |
 *
 * Refused (with the reason) when stock of the finished lot moved after the decision (sent out, moved, used, set aside
 * for a customer): re-opening here would not bring it back; that needs a problem report or a recall (GMP question
 * A-FD-04 for QA).
 */

const BEFORE = ["in_process", "awaiting_qc", "quarantined"];
const AFTER = ["released", "rejected", "closed"];
const MIN_REASON = 5;

export type CorrectionValue = { value: string; conforms?: boolean | null; uom?: string | null };

function reasonOf(v: string | null | undefined) {
  const r = (v ?? "").trim();
  if (r.length < MIN_REASON) throw new DomainError("validation", `Say why the result is corrected (at least ${MIN_REASON} characters).`, { field: "reason", fieldErrors: { reason: "Say why." } });
  if (r.length > 1000) throw new DomainError("validation", "Keep the reason under 1,000 characters.", { field: "reason", fieldErrors: { reason: "Too long." } });
  return r;
}

function valueOf(v: string | null | undefined) {
  const t = (v ?? "").trim();
  if (!t) throw new DomainError("validation", "Enter the new value.", { field: "value", fieldErrors: { value: "Enter the new value." } });
  if (t.length > 200) throw new DomainError("validation", "The value is too long.", { field: "value", fieldErrors: { value: "Too long." } });
  return t;
}

/** The result, its batch (locked) and the newest-row rule. */
async function loadResult(tx: Tx, ctx: AuthContext, resultId: string) {
  if (!isUuid(resultId)) throw new DomainError("not_found", "Result not found in your sites.");
  const [orig] = await tx.select().from(testResults).where(eq(testResults.id, resultId)).limit(1);
  if (!orig?.batchId) throw new DomainError("not_found", "Result not found in your sites.");
  const [b] = await tx.select().from(batches).where(and(eq(batches.id, orig.batchId), eq(batches.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!b || !ctx.allowedSiteIds.includes(b.siteId)) throw new DomainError("not_found", "Result not found in your sites.");
  ctx.requireSite(b.siteId);
  return { orig, batch: b };
}

/** Only the newest entry is corrected (checked inside the idempotent part, so a repeat replays). */
async function assertNewest(tx: Tx, orig: { id: string }) {
  const [newer] = await tx.select({ id: testResults.id }).from(testResults).where(eq(testResults.supersedesId, orig.id)).limit(1);
  if (newer) throw new DomainError("conflict", "This result was already corrected. Correct the newest entry instead.");
}

/** Writes the superseding row (inspection result through the inspection; free-form result directly). */
async function appendCorrection(tx: Tx, ctx: AuthContext, orig: typeof testResults.$inferSelect, v: CorrectionValue, reason: string, reopenReviewed: boolean) {
  if (orig.inspectionId) {
    let ins = await lockInspectionForCorrection(tx, ctx, orig.inspectionId);
    if (ins.status === "approved" || ins.status === "rejected") {
      if (!reopenReviewed) throw new DomainError("state", "This test list is already reviewed and decided. Ask for a correction instead.");
      ins = await reopenInspectionForCorrectionTx(tx, ctx, ins.id, `Result corrected: ${reason}`);
    }
    if (ins.status === "cancelled") throw new DomainError("state", "This test list was cancelled.");
    const r = await appendInspectionCorrectionTx(tx, ctx, ins, orig, { value: v.value, uom: v.uom ?? orig.uom ?? null, conforms: v.conforms ?? null }, reason);
    return r.resultId;
  }
  if (typeof v.conforms !== "boolean") throw new DomainError("validation", "Choose pass or fail for the new value.", { field: "conforms", fieldErrors: { conforms: "Pass or fail." } });
  try {
    const [row] = await tx
      .insert(testResults)
      .values({ batchId: orig.batchId, testName: orig.testName, specification: orig.specification, result: v.value, passed: v.conforms, testedBy: ctx.userId, supersedesId: orig.id, correctionReason: reason })
      .returning();
    await audit(tx, ctx, {
      action: "quality.test_result.corrected",
      entityType: "test_result",
      entityId: row.id,
      siteId: (await tx.select({ s: batches.siteId }).from(batches).where(eq(batches.id, orig.batchId!)).limit(1))[0]?.s ?? null,
      reason,
      before: { resultId: orig.id, result: orig.result, passed: orig.passed },
      after: { resultId: row.id, result: row.result, passed: row.passed, supersedes: orig.id },
    });
    return row.id;
  } catch (e) {
    if (String((e as { code?: string })?.code) === "23505") throw new DomainError("conflict", "This result was already corrected. Correct the newest entry instead.");
    throw e;
  }
}

/** ADR-104 §3: "the person who entered it, or another QA user" (own roles; the owner override does not make a QA user). */
function assertMayCorrect(ctx: AuthContext, orig: { testedBy: string }, siteId: string) {
  const qa = ctx.canGenuinelyAt("quality.disposition.approve", siteId) || (ctx.roleCodes.includes("qa_qc") && ctx.allowedSiteIds.includes(siteId));
  if (orig.testedBy !== ctx.userId && !qa) throw new DomainError("forbidden", "Only the person who entered this result or another QA person can correct it.", { permission: "quality.test_result.create", siteId });
}

/* ------------------------------------------------------------------ before the decision */

export type CorrectTestResultInput = CorrectionValue & { resultId: string; reason: string; idempotencyKey?: string | null };

/** "Correct this result" before the QA decision: the superseding row now (the person who entered it or another QA user). */
export async function correctTestResult(ctx: AuthContext, input: CorrectTestResultInput) {
  ctx.require("quality.test_result.create");
  const reason = reasonOf(input.reason);
  const value = valueOf(input.value);
  return db.transaction(async (tx) => {
    const { orig, batch } = await loadResult(tx, ctx, input.resultId);
    ctx.requireAt("quality.test_result.create", batch.siteId);
    assertMayCorrect(ctx, orig, batch.siteId);
    return withIdempotency(tx, ctx, input.idempotencyKey ? `qa-correct:${input.idempotencyKey}` : null, "quality.test_result.correct", async () => {
      await assertNewest(tx, orig);
      if (AFTER.includes(batch.status)) throw new DomainError("state", `Batch ${batch.batchNumber} is already decided. Ask for a correction: a second QA person must approve it.`, { rule: "A-FD-04" });
      if (!BEFORE.includes(batch.status)) throw new DomainError("state", `Batch ${batch.batchNumber} is ${batch.status.replace(/_/g, " ")}; its results cannot be corrected now.`);
      const newResultId = await appendCorrection(tx, ctx, orig, { value, conforms: input.conforms, uom: input.uom }, reason, true);
      return { newResultId, batchNumber: batch.batchNumber };
    });
  });
}

/* ------------------------------------------------------------------ after the decision */

/** Why the decision of this batch cannot be re-opened here (stock moved on), or null. */
export async function reopenBlocker(q: DbOrTx, batch: { id: string; batchNumber: string; outputLotId: string | null; status: string }): Promise<string | null> {
  if (!AFTER.includes(batch.status)) return `Batch ${batch.batchNumber} is not decided yet; correct the result directly.`;
  if (!batch.outputLotId) return null;
  const [lot] = await q.select().from(inventoryLots).where(eq(inventoryLots.id, batch.outputLotId)).limit(1);
  if (!lot) return null;
  const [disp] = await q
    .select()
    .from(dispositions)
    .where(and(eq(dispositions.subjectType, "lot"), eq(dispositions.subjectId, lot.id), inArray(dispositions.decision, ["release", "reject", "conditional_release"])))
    .orderBy(desc(dispositions.decidedAt))
    .limit(1);
  if (!disp) return null;
  const later = await q
    .select({ id: stockMovements.id, type: stockMovements.movementType, doc: stockMovements.sourceDocumentType, docId: stockMovements.sourceDocumentId })
    .from(stockMovements)
    .where(and(eq(stockMovements.lotId, lot.id), gt(stockMovements.postedAt, disp.decidedAt)));
  const moved = later.filter((m) => !(m.doc === "disposition" && m.docId === disp.id));
  if (moved.length) {
    const what = moved.some((m) => m.type === "shipment") ? "sent out to a customer" : moved.some((m) => m.type === "consumption" || m.type === "issue") ? "used" : "moved";
    return `Some of lot ${lot.lotNumber} was already ${what} after the decision. Re-opening here would not bring it back. Open a problem report (or a recall) with QA instead.`;
  }
  const [rsv] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(stockReservations)
    .where(and(eq(stockReservations.lotId, lot.id), eq(stockReservations.status, "active"), sql`(${stockReservations.expiresAt} is null or ${stockReservations.expiresAt} > now())`));
  if ((rsv?.n ?? 0) > 0) return `Lot ${lot.lotNumber} is already set aside for a customer order. Take it off the order first, or open a problem report with QA.`;
  return null;
}

export type RequestCorrectionInput = CorrectionValue & { resultId: string; reason: string; idempotencyKey?: string | null };

/** After the decision: asks a second QA person to approve the correction (and so re-open the decision). */
export async function requestResultCorrection(ctx: AuthContext, input: RequestCorrectionInput) {
  ctx.require("quality.test_result.create");
  const reason = reasonOf(input.reason);
  const value = valueOf(input.value);
  return db.transaction(async (tx) => {
    const { orig, batch } = await loadResult(tx, ctx, input.resultId);
    ctx.requireAt("quality.test_result.create", batch.siteId);
    assertMayCorrect(ctx, orig, batch.siteId);
    return withIdempotency(tx, ctx, input.idempotencyKey ? `qa-correct-req:${input.idempotencyKey}` : null, "quality.test_result.correction_request", async () => {
      await assertNewest(tx, orig);
      if (BEFORE.includes(batch.status)) throw new DomainError("state", `Batch ${batch.batchNumber} is not decided yet: correct the result directly.`);
      const blocked = await reopenBlocker(tx, batch);
      if (blocked) throw new DomainError("state", blocked, { rule: "A-FD-04" });
      if (!orig.inspectionId && typeof input.conforms !== "boolean") throw new DomainError("validation", "Choose pass or fail for the new value.", { field: "conforms", fieldErrors: { conforms: "Pass or fail." } });
      const [pending] = await tx.select({ id: qaResultCorrections.id }).from(qaResultCorrections).where(and(eq(qaResultCorrections.testResultId, orig.id), eq(qaResultCorrections.status, "pending"))).limit(1);
      if (pending) throw new DomainError("conflict", "A correction of this result already waits for a second QA person.");
      const [req] = await tx
        .insert(qaResultCorrections)
        .values({ organizationId: ctx.organizationId, siteId: batch.siteId, batchId: batch.id, testResultId: orig.id, value, conforms: input.conforms ?? null, uom: input.uom ?? null, reason, requestedBy: ctx.userId, idempotencyKey: input.idempotencyKey ?? null })
        .returning();
      await audit(tx, ctx, {
        action: "quality.test_result.correction_requested",
        entityType: "qa_result_correction",
        entityId: req.id,
        entityNumber: batch.batchNumber,
        siteId: batch.siteId,
        reason,
        before: { resultId: orig.id, test: orig.testName, result: orig.result, passed: orig.passed },
        after: { value, conforms: input.conforms ?? null, batchStatus: batch.status },
      });
      const to = (await usersHoldingPermissionAt(tx, ctx.organizationId, "quality.disposition.approve", batch.siteId)).filter((u) => u !== ctx.userId);
      await notifyUsers(tx, to, {
        organizationId: ctx.organizationId,
        siteId: batch.siteId,
        kind: "quality.result_correction.to_approve",
        severity: "warning",
        title: `${ctx.displayName} asks to correct ${orig.testName} of batch ${batch.batchNumber}`,
        body: `${orig.result} → ${value}. Why: ${reason}. Saying yes re-opens the QA decision.`,
        entityType: "batch",
        entityId: batch.id,
        link: `/quality/check/${batch.id}`,
        dedupeKey: `qa-correction:${req.id}`,
      });
      return { requestId: req.id, batchNumber: batch.batchNumber, siteId: batch.siteId };
    });
  });
}

export type DecideCorrectionInput = { requestId: string; decision: "approve" | "refuse"; note?: string | null; idempotencyKey?: string | null };

/**
 * The second QA person decides. Never the requester; the owner override and the top-role self-approval do not apply
 * (own roles only: quality.disposition.approve at the batch site). Approval: the decision is re-opened (stock moves of
 * the decision reversed, lot → quarantine, batch → quality check, inspection re-opened) and the superseding row added.
 */
export async function decideResultCorrection(ctx: AuthContext, input: DecideCorrectionInput) {
  if (!["approve", "refuse"].includes(input.decision)) throw new DomainError("validation", "Choose yes or no.", { field: "decision" });
  if (!isUuid(input.requestId)) throw new DomainError("not_found", "Request not found in your sites.");
  const note = (input.note ?? "").trim() || null;
  if (input.decision === "refuse" && (!note || note.length < 3)) throw new DomainError("validation", "Say why not (at least 3 characters).", { field: "note", fieldErrors: { note: "Say why not." } });
  return db.transaction(async (tx) => {
    const [head] = await tx.select().from(qaResultCorrections).where(and(eq(qaResultCorrections.id, input.requestId), eq(qaResultCorrections.organizationId, ctx.organizationId))).limit(1);
    if (!head || !ctx.allowedSiteIds.includes(head.siteId)) throw new DomainError("not_found", "Request not found in your sites.");
    if (!ctx.canGenuinelyAt("quality.disposition.approve", head.siteId)) {
      throw new DomainError("forbidden", "Only a second QA person can approve a corrected QA result. The owner override does not apply to QA results.", { permission: "quality.disposition.approve", siteId: head.siteId });
    }
    if (head.requestedBy === ctx.userId) throw new DomainError("separation_of_duties", "You asked for this correction, so a second QA person must decide it.", { permission: "quality.disposition.approve", siteId: head.siteId });
    return withIdempotency(tx, ctx, input.idempotencyKey ? `qa-correct-decide:${input.idempotencyKey}` : null, "quality.test_result.correction_decide", async () => {
      const [batch] = await tx.select().from(batches).where(eq(batches.id, head.batchId)).for("update").limit(1);
      const [req] = await tx.select().from(qaResultCorrections).where(eq(qaResultCorrections.id, head.id)).for("update").limit(1);
      if (req.status !== "pending") throw new DomainError("state", `This request is already ${req.status}.`);
      const now = new Date();
      if (input.decision === "refuse") {
        await tx.update(qaResultCorrections).set({ status: "refused", decidedBy: ctx.userId, decidedAt: now, decisionNote: note }).where(eq(qaResultCorrections.id, req.id));
        await audit(tx, ctx, { action: "quality.test_result.correction_refused", entityType: "qa_result_correction", entityId: req.id, entityNumber: batch.batchNumber, siteId: batch.siteId, reason: note, before: { status: "pending" }, after: { status: "refused" } });
        await notifyUsers(tx, [req.requestedBy], { organizationId: ctx.organizationId, siteId: batch.siteId, kind: "quality.result_correction.decided", severity: "info", title: `Correction of batch ${batch.batchNumber} refused`, body: `${ctx.displayName}: ${note}`, entityType: "batch", entityId: batch.id, link: `/quality/check/${batch.id}` });
        return { status: "refused" as const, batchNumber: batch.batchNumber, newResultId: null as string | null, reopened: null as Record<string, unknown> | null };
      }
      const blocked = await reopenBlocker(tx, batch);
      if (blocked) throw new DomainError("state", blocked, { rule: "A-FD-04" });
      const [orig] = await tx.select().from(testResults).where(eq(testResults.id, req.testResultId)).limit(1);
      const [newer] = await tx.select({ id: testResults.id }).from(testResults).where(eq(testResults.supersedesId, orig.id)).limit(1);
      if (newer) throw new DomainError("conflict", "This result was corrected in the meantime. Ask again on the newest entry.");
      const why = `${orig.testName}: ${orig.result} → ${req.value}. ${req.reason}`;
      // 1. The finished lot: the decision's stock moves reversed (append-only), status back to quarantine.
      const reopened: Record<string, unknown> = { batchFrom: batch.status };
      if (batch.outputLotId) {
        const [lot] = await lockLots(tx, [batch.outputLotId]);
        const [disp] = await tx
          .select()
          .from(dispositions)
          .where(and(eq(dispositions.subjectType, "lot"), eq(dispositions.subjectId, lot.id), inArray(dispositions.decision, ["release", "reject", "conditional_release"])))
          .orderBy(desc(dispositions.decidedAt))
          .limit(1);
        const moves = disp
          ? await tx
              .select()
              .from(stockMovements)
              .where(and(eq(stockMovements.lotId, lot.id), eq(stockMovements.sourceDocumentType, "disposition"), eq(stockMovements.sourceDocumentId, disp.id), ne(stockMovements.movementType, "reversal")))
              .orderBy(asc(stockMovements.postedAt))
          : [];
        if (lot.qualityStatus !== "quarantine") {
          const dispositionId = uuidv7();
          await tx.insert(dispositions).values({ id: dispositionId, organizationId: ctx.organizationId, siteId: lot.siteId, subjectType: "lot", subjectId: lot.id, decision: "reopened", fromStatus: lot.qualityStatus, toStatus: "quarantine", reason: `Decision re-opened: ${why}`, decidedBy: ctx.userId });
          await tx.update(inventoryLots).set({ qualityStatus: "quarantine" }).where(eq(inventoryLots.id, lot.id));
          await audit(tx, ctx, { action: "quality.disposition.reopened", entityType: "inventory_lot", entityId: lot.id, entityNumber: lot.lotNumber, siteId: lot.siteId, reason: why, before: { qualityStatus: lot.qualityStatus }, after: { qualityStatus: "quarantine", dispositionId, batch: batch.batchNumber } });
          reopened.lotFrom = lot.qualityStatus;
        }
        const reversed: string[] = [];
        for (const m of moves) {
          await postMovement(tx, ctx, {
            movementType: "reversal",
            lotId: lot.id,
            fromLocationId: m.toLocationId,
            toLocationId: m.fromLocationId,
            qtyBase: m.qtyBase,
            sourceDocumentType: "qa_result_correction",
            sourceDocumentId: req.id,
            sourceDocumentNumber: batch.batchNumber,
            reason: `QA decision re-opened: ${why}`,
            reversalOfId: m.id,
            idempotencyKey: `qa-correction:${req.id}:${m.id}`,
          });
          // ADR-110 C3: the boxes that followed the lot go back with it.
          if (m.fromLocationId && m.toLocationId) await moveBoxesWithLot(tx, ctx, { lotId: lot.id, fromLocationId: m.toLocationId, toLocationId: m.fromLocationId, reason: `QA decision re-opened: ${why}` });
          reversed.push(m.id);
        }
        reopened.lot = lot.lotNumber;
        reopened.movementsReversed = reversed.length;
      }
      // 2. The batch back to the quality check (controlled transition in production; closed → CX-REOPEN record).
      const b = await reopenBatchForQaCorrection(tx, ctx, batch.id, { reason: why, requestedBy: req.requestedBy, correctionId: req.id });
      await tx.insert(dispositions).values({ organizationId: ctx.organizationId, siteId: batch.siteId, subjectType: "batch", subjectId: batch.id, decision: "reopened", fromStatus: b.from, toStatus: "quarantined", reason: `Decision re-opened: ${why}`, decidedBy: ctx.userId });
      reopened.batchTo = "quarantined";
      reopened.reopenNo = b.reopenNo;
      // 3. The superseding result (re-opens the reviewed inspection), written by the approver on the requester's value.
      const newResultId = await appendCorrection(tx, ctx, orig, { value: req.value, conforms: req.conforms, uom: req.uom }, `${req.reason} (asked by a QA colleague, approved by ${ctx.displayName})`, true);
      await tx.update(qaResultCorrections).set({ status: "approved", decidedBy: ctx.userId, decidedAt: now, decisionNote: note, newResultId, reopened }).where(eq(qaResultCorrections.id, req.id));
      await audit(tx, ctx, { action: "quality.test_result.correction_approved", entityType: "qa_result_correction", entityId: req.id, entityNumber: batch.batchNumber, siteId: batch.siteId, reason: note ?? req.reason, before: { status: "pending", batchStatus: b.from }, after: { status: "approved", newResultId, ...reopened } });
      await notifyUsers(tx, [req.requestedBy], { organizationId: ctx.organizationId, siteId: batch.siteId, kind: "quality.result_correction.decided", severity: "warning", title: `Batch ${batch.batchNumber} is back for the QA check`, body: `${ctx.displayName} approved the corrected result. Decide the batch again on Check quality.`, entityType: "batch", entityId: batch.id, link: `/quality/check/${batch.id}` });
      return { status: "approved" as const, batchNumber: batch.batchNumber, newResultId: newResultId as string | null, reopened: reopened as Record<string, unknown> | null };
    });
  });
}

/* ------------------------------------------------------------------ read models */

export type ResultHistoryRow = { id: string; testName: string; result: string; passed: boolean; by: string; at: Date; supersedesId: string | null; correctionReason: string | null; supersededBy: string | null; live: boolean };

/** Every result of the batch with what superseded it (old values shown struck through with who/when). */
export async function resultHistory(q: DbOrTx, batchId: string): Promise<ResultHistoryRow[]> {
  const rows = await q
    .select({ r: testResults, by: users.displayName })
    .from(testResults)
    .innerJoin(users, eq(users.id, testResults.testedBy))
    .where(eq(testResults.batchId, batchId))
    .orderBy(asc(testResults.testedAt), asc(testResults.id));
  const next = new Map(rows.filter((x) => x.r.supersedesId).map((x) => [x.r.supersedesId!, x.r.id]));
  return rows.map(({ r, by }) => ({ id: r.id, testName: r.testName, result: r.result, passed: r.passed, by, at: r.testedAt, supersedesId: r.supersedesId, correctionReason: r.correctionReason, supersededBy: next.get(r.id) ?? null, live: !next.has(r.id) }));
}

/** Correction requests of a batch with names (Check quality). */
export async function correctionRequestsOf(q: DbOrTx, batchId: string) {
  return q
    .select({ c: qaResultCorrections, by: users.displayName, test: testResults.testName, oldResult: testResults.result })
    .from(qaResultCorrections)
    .innerJoin(users, eq(users.id, qaResultCorrections.requestedBy))
    .innerJoin(testResults, eq(testResults.id, qaResultCorrections.testResultId))
    .where(eq(qaResultCorrections.batchId, batchId))
    .orderBy(desc(qaResultCorrections.requestedAt));
}

export const RESULT_CORRECTION_APPROVAL_KIND = "approval.result_correction";

/** Action-centre source: corrections waiting for a second QA person. */
export async function resultCorrectionCandidates(organizationId: string) {
  const rows = await db
    .select({ c: qaResultCorrections, batchNumber: batches.batchNumber, test: testResults.testName })
    .from(qaResultCorrections)
    .innerJoin(batches, eq(batches.id, qaResultCorrections.batchId))
    .innerJoin(testResults, eq(testResults.id, qaResultCorrections.testResultId))
    .where(and(eq(qaResultCorrections.organizationId, organizationId), eq(qaResultCorrections.status, "pending")));
  return rows.map((x) => ({
    kind: RESULT_CORRECTION_APPROVAL_KIND,
    siteId: x.c.siteId,
    entityType: "qa_result_correction",
    entityId: x.c.id,
    recordNumber: x.batchNumber,
    title: `Corrected ${x.test} of batch ${x.batchNumber} waits for a second QA person`,
    detail: `Why: ${x.c.reason}`,
    link: `/quality/check/${x.c.batchId}`,
    openedAt: x.c.requestedAt,
  }));
}

export async function resultCorrectionApprovalVerdicts(ctx: AuthContext, ids: string[]): Promise<Map<string, ApprovalVerdict>> {
  const out = new Map<string, ApprovalVerdict>();
  if (!ids.length || !ctx.allowedSiteIds.length) return out;
  const rows = await db
    .select({ c: qaResultCorrections, by: users.displayName, batchNumber: batches.batchNumber, test: testResults.testName, old: testResults.result })
    .from(qaResultCorrections)
    .innerJoin(users, eq(users.id, qaResultCorrections.requestedBy))
    .innerJoin(batches, eq(batches.id, qaResultCorrections.batchId))
    .innerJoin(testResults, eq(testResults.id, qaResultCorrections.testResultId))
    .where(and(eq(qaResultCorrections.organizationId, ctx.organizationId), inArray(qaResultCorrections.id, ids), inArray(qaResultCorrections.siteId, ctx.allowedSiteIds), eq(qaResultCorrections.status, "pending")));
  for (const x of rows) {
    const qa = ctx.canGenuinelyAt("quality.disposition.approve", x.c.siteId);
    const mine = x.c.requestedBy === ctx.userId;
    out.set(x.c.id, {
      canDecide: qa && !mine,
      waitingForRoles: ["qa_qc"],
      stepLabel: "Second QA person",
      blockedReason: qa && mine ? "You asked for this correction, so a second QA person must decide it." : null,
      requestedById: x.c.requestedBy,
      requestedByName: x.by,
      title: `Correct ${x.test} of batch ${x.batchNumber}: ${x.old} → ${x.c.value} (re-opens the QA decision)`,
      why: x.c.reason,
    });
  }
  return out;
}

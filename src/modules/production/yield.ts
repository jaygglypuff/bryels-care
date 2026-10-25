import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import Decimal from "decimal.js";
import { type DbOrTx, db } from "@/db/client";
import { products, scrapReworkRecords, yieldRecords } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { assertReasonCode } from "@/modules/masterdata";
import { DEVIATION_UNAVAILABLE, executionHooks } from "./execution-hooks";
import { type BatchRow, sortedSteps, stepRecords } from "./execution";
import { type FormulaSnapshot, idempotent, lockBatch } from "./shared";

/** Configured yield range (% of theoretical) for the batch's SKU (A-PROC-33). */
export async function yieldLimits(q: DbOrTx, organizationId: string, siteId: string, skuCode: string) {
  const s = await getSetting(q, organizationId, "production.yield.limits_pct", siteId);
  return s.bySku?.[skuCode] ?? { min: s.min, max: s.max };
}

/** Steps that must be complete before yield and output are recorded: every step except the transfer. */
async function openStepsBeforeTransfer(q: DbOrTx, batch: BatchRow) {
  const recs = await stepRecords(q, batch.id);
  return sortedSteps(batch.formulaSnapshot as FormulaSnapshot).filter((s) => s.stepKind !== "transfer" && recs.find((r) => r.stepNo === s.stepNo)?.status !== "completed");
}

export async function currentYield(q: DbOrTx, batchId: string) {
  const [y] = await q.select().from(yieldRecords).where(and(eq(yieldRecords.batchId, batchId), eq(yieldRecords.isCurrent, true))).limit(1);
  return y ?? null;
}

function parseUnits(v: string, label: string, field: string) {
  let d: Decimal;
  try {
    d = new Decimal((v ?? "").trim().replace(/,/g, ""));
  } catch {
    throw new DomainError("validation", `Enter ${label} as a whole number.`, { field });
  }
  if (!d.isFinite() || d.lte(0) || !d.isInteger()) throw new DomainError("validation", `${label} must be a whole number greater than zero.`, { field });
  return d;
}

/**
 * Records the actual output and yield (W05-16, US-3-13): good units counted, mass = units × product
 * net mass, yield % against the theoretical yield frozen on the batch, variance, and the configured
 * range at the time. Outside the range the record needs approval with a deviation before posting.
 * A correction supersedes the current record with a reason (one current record per batch).
 */
export async function recordYield(ctx: AuthContext, input: { batchId: string; actualUnits: string; notes?: string | null; correctionReason?: string | null; idempotencyKey?: string | null }) {
  ctx.require("production.yield_record.create");
  const units = parseUnits(input.actualUnits, "the finished units", "actualUnits");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.yield_record.create", async () => {
      if (batch.status !== "in_process") throw new DomainError("state", `Batch ${batch.batchNumber} is ${batch.status.replace(/_/g, " ")}; yield is recorded while it is in process.`);
      const open = await openStepsBeforeTransfer(tx, batch);
      if (open.length) throw new DomainError("state", `Complete step ${open[0].stepNo} (${open[0].name}) before recording the yield.`, { rule: "V-STATE" });
      const [product] = await tx.select().from(products).where(eq(products.id, batch.productId)).limit(1);
      const theo = new Decimal(batch.theoreticalYieldG ?? 0);
      if (theo.lte(0)) throw new DomainError("state", "This batch has no theoretical yield; ask the planner to check the formula revision.");
      const actual = units.mul(product.unitNetMassG);
      const yieldPct = actual.div(theo).mul(100).toDecimalPlaces(2);
      const variance = actual.minus(theo);
      const limits = await yieldLimits(tx, ctx.organizationId, batch.siteId, product.skuCode);
      const within = yieldPct.gte(limits.min) && yieldPct.lte(limits.max);
      const prev = await currentYield(tx, batch.id);
      const correction = input.correctionReason?.trim() ?? "";
      if (prev && correction.length < 5) throw new DomainError("validation", "A yield is already recorded. Give the reason for the correction (at least 5 characters).", { field: "correctionReason" });
      if (prev) await tx.update(yieldRecords).set({ isCurrent: false }).where(eq(yieldRecords.id, prev.id));
      const [y] = await tx
        .insert(yieldRecords)
        .values({
          organizationId: ctx.organizationId,
          siteId: batch.siteId,
          batchId: batch.id,
          theoreticalBase: theo.toString(),
          actualBase: actual.toString(),
          actualUnits: units.toString(),
          varianceBase: variance.toString(),
          yieldPct: yieldPct.toString(),
          variancePct: yieldPct.minus(100).toString(),
          minPct: String(limits.min),
          maxPct: String(limits.max),
          isWithinLimits: within,
          notes: input.notes?.trim() || null,
          recordedBy: ctx.userId,
          supersedesId: prev?.id ?? null,
          correctionReason: prev ? correction : null,
        })
        .returning();
      await audit(tx, ctx, {
        action: prev ? "production.yield_record.corrected" : "production.yield_record.recorded",
        entityType: "yield_record",
        entityId: y.id,
        entityNumber: batch.batchNumber,
        siteId: batch.siteId,
        reason: prev ? correction : null,
        before: prev ? { actualUnits: prev.actualUnits, yieldPct: prev.yieldPct } : null,
        after: { actualUnits: units.toString(), actualG: actual.toString(), theoreticalG: theo.toString(), yieldPct: yieldPct.toString(), range: `${limits.min}–${limits.max} %`, within },
      });
      return { yieldRecordId: y.id, yieldPct: yieldPct.toString(), within, range: limits };
    });
    return result;
  });
}

/**
 * Approves a yield outside the configured range (production.yield_record.approve, a person other
 * than the recorder) with a reason; a deviation (yield_out_of_range) is opened through the quality
 * module. Without the deviations module the approval is refused and posting stays blocked.
 */
export async function approveYield(approver: AuthContext, input: { yieldRecordId: string; reason: string }) {
  approver.require("production.yield_record.approve");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) throw new DomainError("validation", "Explain the decision (at least 10 characters).", { field: "reason" });
  const [head] = await db.select({ batchId: yieldRecords.batchId }).from(yieldRecords).where(eq(yieldRecords.id, input.yieldRecordId)).limit(1);
  if (!head) throw new DomainError("not_found", "Yield record not found.");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, approver, head.batchId);
    const [y] = await tx.select().from(yieldRecords).where(eq(yieldRecords.id, input.yieldRecordId)).for("update").limit(1);
    if (!y.isCurrent) throw new DomainError("state", "This yield record was corrected; approve the current one.");
    if (y.isWithinLimits) throw new DomainError("state", "This yield is within the configured range and needs no approval.");
    if (y.approvedBy) throw new DomainError("state", "This yield is already approved.");
    approver.assertSeparation(y.recordedBy === approver.userId, "You recorded this yield; another person must approve it.");
    const opener = executionHooks().openDeviation;
    if (!opener) throw new DomainError("state", DEVIATION_UNAVAILABLE, { rule: "A-PROC-33" });
    const { deviationId } = await opener(tx, approver, {
      kind: "yield_out_of_range",
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      siteId: batch.siteId,
      description: `Yield ${y.yieldPct} % outside ${y.minPct}–${y.maxPct} %. ${reason}`,
      approvedBy: approver.userId,
    });
    await tx.update(yieldRecords).set({ approvedBy: approver.userId, approvedAt: new Date(), approvalReason: reason, deviationId }).where(eq(yieldRecords.id, y.id));
    await audit(tx, approver, {
      action: "production.yield_record.approved",
      entityType: "yield_record",
      entityId: y.id,
      entityNumber: batch.batchNumber,
      siteId: batch.siteId,
      reason,
      after: { yieldPct: y.yieldPct, range: `${y.minPct}–${y.maxPct} %`, deviationId },
    });
    return { deviationId };
  });
}

/**
 * Records scrap or rework units of the batch (W05-16) with a configured reason code. Above the
 * threshold (% of the theoretical unit count, setting production.scrap.approval_threshold_pct) the
 * record needs approval by a different person before posting to quarantine.
 */
export async function recordScrapRework(ctx: AuthContext, input: { batchId: string; kind: "scrap" | "rework"; reasonCode: string; qty: string; note?: string | null; idempotencyKey?: string | null }) {
  ctx.require("production.scrap_rework_record.create");
  if (input.kind !== "scrap" && input.kind !== "rework") throw new DomainError("validation", "Choose scrap or rework.", { field: "kind" });
  const qty = parseUnits(input.qty, "the quantity", "qty");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.scrap_rework_record.create", async () => {
      if (batch.status !== "in_process") throw new DomainError("state", `Batch ${batch.batchNumber} is ${batch.status.replace(/_/g, " ")}.`);
      // Shared reason codes, category `scrap` or `rework` (US-1-24; formerly a setting, A-W2B-05).
      let code: { code: string; name: string };
      try {
        code = await assertReasonCode(tx, ctx.organizationId, input.kind, input.reasonCode, input.note);
      } catch (e) {
        if (e instanceof DomainError && e.details?.field === "reasonNote") throw new DomainError("validation", "Explain the reason in the note.", { field: "note" });
        throw e;
      }
      const [product] = await tx.select().from(products).where(eq(products.id, batch.productId)).limit(1);
      const theoUnits = new Decimal(batch.theoreticalYieldG ?? 0).div(product.unitNetMassG);
      const pct = await getSetting(tx, ctx.organizationId, "production.scrap.approval_threshold_pct", batch.siteId);
      const existing = await tx
        .select({ qty: scrapReworkRecords.qty })
        .from(scrapReworkRecords)
        .where(and(eq(scrapReworkRecords.batchId, batch.id), eq(scrapReworkRecords.recordKind, input.kind), isNull(scrapReworkRecords.voidedAt)));
      const cumulative = existing.reduce((s, r) => s.plus(r.qty), new Decimal(0)).plus(qty);
      const requiresApproval = cumulative.gt(theoUnits.mul(pct).div(100));
      const [r] = await tx
        .insert(scrapReworkRecords)
        .values({
          organizationId: ctx.organizationId,
          siteId: batch.siteId,
          batchId: batch.id,
          recordKind: input.kind,
          reasonCode: code.code,
          qty: qty.toString(),
          uom: product.baseUom,
          note: input.note?.trim() || null,
          requiresApproval,
          recordedBy: ctx.userId,
        })
        .returning();
      await audit(tx, ctx, {
        action: "production.scrap_rework_record.recorded",
        entityType: "scrap_rework_record",
        entityId: r.id,
        entityNumber: batch.batchNumber,
        siteId: batch.siteId,
        after: { kind: input.kind, reason: code.name, qty: qty.toString(), uom: product.baseUom, requiresApproval, thresholdPct: pct },
      });
      return { scrapReworkRecordId: r.id, requiresApproval };
    });
    return result;
  });
}

/** Approves or rejects a scrap/rework record above the threshold (decider ≠ recorder). */
export async function decideScrapRework(approver: AuthContext, input: { scrapReworkRecordId: string; decision: "approve" | "reject"; note: string }) {
  approver.require("production.scrap_rework_record.approve");
  const note = input.note?.trim() ?? "";
  if (note.length < 5) throw new DomainError("validation", "Give a reason for the decision (at least 5 characters).", { field: "note" });
  const [head] = await db.select({ batchId: scrapReworkRecords.batchId }).from(scrapReworkRecords).where(eq(scrapReworkRecords.id, input.scrapReworkRecordId)).limit(1);
  if (!head) throw new DomainError("not_found", "Scrap or rework record not found.");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, approver, head.batchId);
    const [r] = await tx.select().from(scrapReworkRecords).where(eq(scrapReworkRecords.id, input.scrapReworkRecordId)).for("update").limit(1);
    if (r.status !== "recorded") throw new DomainError("state", `This record is already ${r.status}.`);
    approver.assertSeparation(r.recordedBy === approver.userId, "You recorded this; another person must decide.");
    const status = input.decision === "approve" ? "approved" : "rejected";
    await tx
      .update(scrapReworkRecords)
      .set({ status, decidedBy: approver.userId, decidedAt: new Date(), decisionNote: note, ...(status === "rejected" ? { voidedAt: new Date() } : {}) })
      .where(eq(scrapReworkRecords.id, r.id));
    await audit(tx, approver, {
      action: status === "approved" ? "production.scrap_rework_record.approved" : "production.scrap_rework_record.rejected",
      entityType: "scrap_rework_record",
      entityId: r.id,
      entityNumber: batch.batchNumber,
      siteId: batch.siteId,
      reason: note,
      after: { kind: r.recordKind, qty: r.qty, status },
    });
    return { status };
  });
}

/** Messages that block posting to quarantine on the yield/scrap side. */
export async function yieldBlockers(q: DbOrTx, batch: BatchRow): Promise<string[]> {
  const out: string[] = [];
  const y = await currentYield(q, batch.id);
  if (!y) out.push("Record the actual output (finished units) first.");
  else if (!y.isWithinLimits && !(y.approvedBy && y.deviationId)) out.push(`Yield ${new Decimal(y.yieldPct).toString()} % is outside ${new Decimal(y.minPct).toString()}–${new Decimal(y.maxPct).toString()} %: it needs approval with a deviation first.`);
  const pending = await q
    .select({ id: scrapReworkRecords.id, kind: scrapReworkRecords.recordKind, qty: scrapReworkRecords.qty })
    .from(scrapReworkRecords)
    .where(and(eq(scrapReworkRecords.batchId, batch.id), eq(scrapReworkRecords.status, "recorded"), eq(scrapReworkRecords.requiresApproval, true), isNull(scrapReworkRecords.voidedAt)));
  for (const p of pending) out.push(`${p.kind === "scrap" ? "Scrap" : "Rework"} of ${new Decimal(p.qty).toString()} needs approval.`);
  return out;
}

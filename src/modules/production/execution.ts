import "server-only";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { type DbOrTx, type Tx, db } from "@/db/client";
import { batches, equipment, equipmentUses, processStepRecords, rolePermissions, routingSteps, userSiteAssignments, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
import { executionHooks } from "./execution-hooks";
import { type FormulaSnapshot, idempotent, isWeighingStep, lockBatch } from "./shared";
import { transitionBatch } from "./state";
import { syncWorkOrderProgress } from "./work-orders";

/**
 * Process step records (W05-06..17, US-3-09..13): the step state machine, prerequisites, start and
 * finish of a step, checker sign-off and the batch transition on the first signed clearance.
 *
 *   pending ──start──▶ in_progress ──finish──▶ completed                (step needs no checker)
 *                          │      └──finish──▶ awaiting_check ──check──▶ completed
 *                          ▲                          │
 *                          └──── checker returns ─────┘ (reason)
 *
 * `pending` is implicit (no row yet); `skipped` is reserved for an approved skip (not offered).
 * Every transition writes an audit event in the same transaction. The batch row lock (lockBatch)
 * serialises all writes to one batch, so two operators posting the same step get one success and
 * one 409 (concurrency.batch_step_posted_once).
 */
export const STEP_STATUSES = ["pending", "in_progress", "awaiting_check", "completed", "skipped"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
export const STEP_TRANSITIONS: Record<StepStatus, readonly StepStatus[]> = {
  pending: ["in_progress"],
  in_progress: ["awaiting_check", "completed"],
  awaiting_check: ["completed", "in_progress"],
  completed: [],
  skipped: [],
};
export function canStepTransition(from: string, to: StepStatus) {
  return (STEP_STATUSES as readonly string[]).includes(from) && STEP_TRANSITIONS[from as StepStatus].includes(to);
}

export type SnapshotStep = FormulaSnapshot["steps"][number];
export type StepRecord = typeof processStepRecords.$inferSelect;
export type BatchRow = typeof batches.$inferSelect;

/** Step kinds recorded as readings against routing parameters (process screen). */
export const PROCESS_STEP_KINDS = ["process", "in_process_qc", "filling", "cutting", "curing", "hold", "checklist", "reconciliation"] as const;
export const PACKAGING_STEP_KINDS = ["packaging"] as const;
export const HOLD_STEP_KINDS = ["hold", "curing"] as const;

/** Permission to perform (conduct) and to check a step of a kind. */
export function performPermission(kind: string): Permission {
  if (kind === "line_clearance") return "production.line_clearance.create";
  if (isWeighingStep(kind)) return "production.dispense_record.create";
  return "production.process_step_record.create";
}
export function checkPermission(kind: string): Permission {
  return kind === "line_clearance" ? "production.line_clearance.approve" : "production.process_step_record.approve";
}

export const stepLabel = (s: { stepNo: number; name: string }) => `step ${s.stepNo} (${s.name})`;

export function sortedSteps(snapshot: FormulaSnapshot): SnapshotStep[] {
  return [...snapshot.steps].sort((a, z) => a.stepNo - z.stepNo);
}

export function findStep(batch: BatchRow, stepNo: number): SnapshotStep {
  const step = (batch.formulaSnapshot as FormulaSnapshot).steps.find((s) => s.stepNo === stepNo);
  if (!step) throw new DomainError("not_found", "Step not found in this batch's routing.");
  return step;
}

export function findStepOfKind(batch: BatchRow, kinds: readonly string[]): SnapshotStep | null {
  return sortedSteps(batch.formulaSnapshot as FormulaSnapshot).find((s) => kinds.includes(s.stepKind)) ?? null;
}

/**
 * Routing-step fields that the batch snapshot does not copy (minimum duration, prerequisite flag,
 * in-process inspection plan). Safe to read live: steps of an approved routing revision are
 * immutable (trigger tg_routing_steps_parent_draft, W1D).
 */
export async function routingStepDetails(q: DbOrTx, routingStepId: string) {
  const [r] = await q
    .select({
      minDurationMinutes: routingSteps.minDurationMinutes,
      blocksUntilComplete: routingSteps.blocksUntilComplete,
      inspectionPlanId: routingSteps.inspectionPlanId,
      recordMode: routingSteps.recordMode,
    })
    .from(routingSteps)
    .where(eq(routingSteps.id, routingStepId))
    .limit(1);
  return r ?? { minDurationMinutes: null, blocksUntilComplete: true, inspectionPlanId: null, recordMode: "electronic" };
}

export async function stepRecords(q: DbOrTx, batchId: string): Promise<StepRecord[]> {
  return q.select().from(processStepRecords).where(eq(processStepRecords.batchId, batchId)).orderBy(asc(processStepRecords.stepNo));
}

export async function stepRecord(q: DbOrTx, batchId: string, stepNo: number): Promise<StepRecord | null> {
  const [r] = await q
    .select()
    .from(processStepRecords)
    .where(and(eq(processStepRecords.batchId, batchId), eq(processStepRecords.stepNo, stepNo)))
    .limit(1);
  return r ?? null;
}

/**
 * Earlier steps that must be complete first (V-STATE). A step blocks the following ones unless the
 * routing marks it `blocks_until_complete = false`.
 */
export async function missingPrerequisites(q: DbOrTx, batch: BatchRow, step: SnapshotStep, records?: StepRecord[]) {
  const recs = records ?? (await stepRecords(q, batch.id));
  const earlier = sortedSteps(batch.formulaSnapshot as FormulaSnapshot).filter((s) => s.stepNo < step.stepNo);
  const missing: SnapshotStep[] = [];
  for (const s of earlier) {
    const r = recs.find((x) => x.stepNo === s.stepNo);
    if (r?.status === "completed" || r?.status === "skipped") continue;
    const d = await routingStepDetails(q, s.routingStepId);
    if (d.blocksUntilComplete) missing.push(s);
  }
  return missing;
}

/** Batch states in which a step may be worked on. The weighing clearance may start on a staged batch. */
function assertBatchExecutable(batch: BatchRow, step: SnapshotStep) {
  if (batch.status === "in_process") return;
  if (batch.status === "materials_staged" && step.stepKind === "line_clearance") return;
  const hint = batch.status === "planned" ? (batch.workOrderId ? " Stage the materials first." : " Confirm the materials at the line first.") : "";
  throw new DomainError("state", `Batch ${batch.batchNumber} is ${batch.status.replace(/_/g, " ")}; ${stepLabel(step)} cannot be worked on now.${hint}`);
}

/**
 * Returns the in_progress record of a step, starting it (row insert, audit) when it has not
 * started. Refuses a completed step, a step waiting for its checker and a step whose earlier steps
 * are open. Caller holds the batch lock.
 */
export async function openStep(tx: Tx, ctx: AuthContext, batch: BatchRow, step: SnapshotStep): Promise<StepRecord> {
  assertBatchExecutable(batch, step);
  const existing = await stepRecord(tx, batch.id, step.stepNo);
  if (existing) {
    if (existing.status === "in_progress") return existing;
    if (existing.status === "awaiting_check") throw new DomainError("state", `${capital(stepLabel(step))} is waiting for the checker. Ask the checker to sign, or to return it with a reason.`);
    throw new DomainError("state", `${capital(stepLabel(step))} is already complete.`);
  }
  const missing = await missingPrerequisites(tx, batch, step);
  if (missing.length) {
    throw new DomainError("state", `Complete ${stepLabel(missing[0])} first. Steps are completed in order.`, { rule: "V-STATE", stepNo: missing[0].stepNo });
  }
  const details = await routingStepDetails(tx, step.routingStepId);
  const now = new Date();
  const earliest = (HOLD_STEP_KINDS as readonly string[]).includes(step.stepKind) && details.minDurationMinutes ? new Date(now.getTime() + details.minDurationMinutes * 60_000) : null;
  const [rec] = await tx
    .insert(processStepRecords)
    .values({
      batchId: batch.id,
      routingStepId: step.routingStepId,
      stepNo: step.stepNo,
      name: step.name,
      stepKind: step.stepKind,
      area: step.area ?? null,
      status: "in_progress",
      conductedBy: ctx.userId,
      startedAt: now,
      earliestCompletionAt: earliest,
      completedAt: null,
    })
    .returning();
  await audit(tx, ctx, {
    action: "production.process_step_record.started",
    entityType: "process_step_record",
    entityId: rec.id,
    entityNumber: batch.batchNumber,
    siteId: batch.siteId,
    after: { batchId: batch.id, stepNo: step.stepNo, name: step.name, status: "in_progress", earliestCompletionAt: earliest },
  });
  return rec;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A co-signed checker must hold the check permission at the batch site and not be the conductor. */
export function assertCheckerFor(checker: AuthContext, conductorId: string, kind: string, siteId: string) {
  if (checker.sodBlocks(checker.userId === conductorId, "The checker must be a different person from the one who conducted the step.")) {
    throw new DomainError("separation_of_duties", "The checker must be a different person from the one who conducted the step.", { ...checker.refusalDetails(), rule: "V-SOD" });
  }
  checker.require(checkPermission(kind));
  checker.requireSite(siteId);
}

/** Ends the open equipment uses of a step; per-batch-cleaned equipment becomes dirty (W13-02). */
export async function endEquipmentUses(tx: Tx, ctx: AuthContext, batch: BatchRow, rec: StepRecord) {
  const open = await tx
    .select({ use: equipmentUses, e: equipment })
    .from(equipmentUses)
    .innerJoin(equipment, eq(equipment.id, equipmentUses.equipmentId))
    .where(and(eq(equipmentUses.processStepRecordId, rec.id), isNull(equipmentUses.endedAt)));
  if (!open.length) return;
  const now = new Date();
  await tx.update(equipmentUses).set({ endedAt: now }).where(inArray(equipmentUses.id, open.map((o) => o.use.id)));
  const markDirty = await getSetting(tx, ctx.organizationId, "production.equipment.mark_dirty_after_batch_use", batch.siteId);
  for (const { use, e } of open) {
    if (markDirty && e.cleaningRule === "per_batch" && e.cleaningStatus === "clean") {
      await tx.update(equipment).set({ cleaningStatus: "dirty" }).where(eq(equipment.id, e.id));
    }
    await audit(tx, ctx, {
      action: "production.equipment_use.ended",
      entityType: "equipment_use",
      entityId: use.id,
      entityNumber: batch.batchNumber,
      siteId: batch.siteId,
      after: { equipment: e.code, stepNo: rec.stepNo, cleaningStatus: markDirty && e.cleaningRule === "per_batch" ? "dirty" : e.cleaningStatus },
    });
  }
}

/**
 * Finishes an in_progress step after the caller checked the kind-specific blockers: completed when
 * the step needs no checker or a checker co-signed, otherwise awaiting_check. Ends equipment uses
 * and applies the batch transition of the first signed clearance.
 */
export async function finishStep(
  tx: Tx,
  ctx: AuthContext,
  batch: BatchRow,
  step: SnapshotStep,
  rec: StepRecord,
  opts: { checker?: AuthContext | null; notes?: string | null } = {},
): Promise<{ status: StepStatus }> {
  if (rec.status !== "in_progress") throw new DomainError("state", `${capital(stepLabel(step))} is ${rec.status.replace(/_/g, " ")}.`);
  const checker = opts.checker ?? null;
  if (checker) assertCheckerFor(checker, ctx.userId, step.stepKind, batch.siteId);
  const now = new Date();
  const to: StepStatus = !step.requiresChecker || checker ? "completed" : "awaiting_check";
  await tx
    .update(processStepRecords)
    .set({
      status: to,
      conductedBy: ctx.userId,
      performedAt: now,
      blockedReason: null,
      notes: opts.notes?.trim() || rec.notes,
      ...(to === "completed" ? { completedAt: now } : {}),
      ...(checker ? { checkedBy: checker.userId, checkedAt: now } : {}),
    })
    .where(eq(processStepRecords.id, rec.id));
  await endEquipmentUses(tx, ctx, batch, rec);
  await audit(tx, ctx, {
    action: "production.process_step_record.completed",
    entityType: "process_step_record",
    entityId: rec.id,
    entityNumber: batch.batchNumber,
    siteId: batch.siteId,
    before: { status: rec.status },
    after: { batchId: batch.id, stepNo: step.stepNo, name: step.name, status: to, checker: checker?.displayName ?? null, notes: opts.notes ?? null },
  });
  if (checker) {
    await audit(tx, checker, {
      action: "production.process_step_record.checked",
      entityType: "process_step_record",
      entityId: rec.id,
      entityNumber: batch.batchNumber,
      siteId: batch.siteId,
      after: { batchId: batch.id, stepNo: step.stepNo, name: step.name, conductedBy: ctx.displayName, signedOn: "operator_device" },
    });
  }
  if (to === "completed") await afterStepCompleted(tx, ctx, batch, step);
  return { status: to };
}

/** materials_staged → in_process on the first completed (signed) line clearance (W05-06, §6.2). */
async function afterStepCompleted(tx: Tx, ctx: AuthContext, batch: BatchRow, step: SnapshotStep) {
  if (step.stepKind === "line_clearance" && batch.status === "materials_staged") {
    await transitionBatch(tx, ctx, batch, "in_process", { reason: `First line clearance signed (${step.name})`, set: { startedAt: batch.startedAt ?? new Date() } });
    await audit(tx, ctx, {
      action: "production.batch.started",
      entityType: "batch",
      entityId: batch.id,
      entityNumber: batch.batchNumber,
      siteId: batch.siteId,
      before: { status: "materials_staged" },
      after: { status: "in_process", trigger: `step ${step.stepNo} ${step.name}` },
    });
    // W2A: the work order follows its batches (released → in_progress), same transaction.
    await syncWorkOrderProgress(tx, ctx, batch.workOrderId);
    await executionHooks().onBatchInProcess?.(tx, ctx, { id: batch.id, batchNumber: batch.batchNumber, siteId: batch.siteId });
  }
}

/**
 * The checker signs a step from their own session (or device): awaiting_check → completed.
 * The conductor can never check their own step (V-SOD, CHECK process_step_records_sod_ck).
 */
export async function checkStep(checker: AuthContext, input: { batchId: string; stepNo: number; idempotencyKey?: string | null }) {
  checker.require("production.batch.view");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, checker, input.batchId);
    const { result } = await idempotent(tx, checker, input.idempotencyKey, "production.process_step_record.check", async () => {
      const step = findStep(batch, input.stepNo);
      checker.require(checkPermission(step.stepKind));
      const rec = await stepRecord(tx, batch.id, step.stepNo);
      if (!rec || rec.status !== "awaiting_check") {
        throw new DomainError("state", `${capital(stepLabel(step))} is ${rec ? rec.status.replace(/_/g, " ") : "not started"}; only a step waiting for its checker can be checked.`);
      }
      assertCheckerFor(checker, rec.conductedBy, step.stepKind, batch.siteId);
      const now = new Date();
      await tx.update(processStepRecords).set({ status: "completed", checkedBy: checker.userId, checkedAt: now, completedAt: now }).where(eq(processStepRecords.id, rec.id));
      await audit(tx, checker, {
        action: "production.process_step_record.checked",
        entityType: "process_step_record",
        entityId: rec.id,
        entityNumber: batch.batchNumber,
        siteId: batch.siteId,
        before: { status: rec.status },
        after: { batchId: batch.id, stepNo: step.stepNo, name: step.name, status: "completed", signedOn: "own_session" },
      });
      await afterStepCompleted(tx, checker, batch, step);
      return { stepNo: step.stepNo, name: step.name, status: "completed" as const };
    });
    return result;
  });
}

/** The checker returns a step to the conductor with a reason: awaiting_check → in_progress. */
export async function returnStep(checker: AuthContext, input: { batchId: string; stepNo: number; reason: string }) {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) throw new DomainError("validation", "Say what must be corrected (at least 5 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, checker, input.batchId);
    const step = findStep(batch, input.stepNo);
    checker.require(checkPermission(step.stepKind));
    const rec = await stepRecord(tx, batch.id, step.stepNo);
    if (!rec || rec.status !== "awaiting_check") throw new DomainError("state", `${capital(stepLabel(step))} is not waiting for a checker.`);
    checker.assertSeparation(rec.conductedBy === checker.userId, "You conducted this step; another person must check it.");
    await tx.update(processStepRecords).set({ status: "in_progress", performedAt: null, blockedReason: `Returned by the checker: ${reason}` }).where(eq(processStepRecords.id, rec.id));
    await audit(tx, checker, {
      action: "production.process_step_record.returned",
      entityType: "process_step_record",
      entityId: rec.id,
      entityNumber: batch.batchNumber,
      siteId: batch.siteId,
      reason,
      before: { status: "awaiting_check" },
      after: { status: "in_progress", stepNo: step.stepNo },
    });
    return { stepNo: step.stepNo };
  });
}

/**
 * Users who may sign at a site with a permission (checker, exception approver): active, holding the
 * permission through an assignment at the site or organization-wide.
 */
export async function eligibleSigners(q: DbOrTx, organizationId: string, siteId: string, permission: Permission) {
  return q
    .selectDistinct({ id: users.id, displayName: users.displayName })
    .from(users)
    .innerJoin(userSiteAssignments, eq(userSiteAssignments.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userSiteAssignments.roleId))
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
        eq(rolePermissions.permissionCode, permission),
        or(eq(userSiteAssignments.siteId, siteId), eq(userSiteAssignments.isOrganizationWide, true)),
      ),
    )
    .orderBy(users.displayName);
}

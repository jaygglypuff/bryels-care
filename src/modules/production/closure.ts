import "server-only";
import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  AMENDMENT_SECTIONS,
  REOPEN_TARGET_STATES,
  approvalDecisions,
  batchAmendments,
  batchClosures,
  batchMaterials,
  batchOutputs,
  batchReopenRequests,
  batchStateTransitions,
  batches,
  dispositions,
  processStepRecords,
  users,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { releaseReservationsForDemand } from "@/modules/inventory";
import { notifyRoles } from "@/modules/platform";
import { bmrTemplateFor, bmrWatermark, closureCounters, generateBmrInTx, visibleBatch } from "./bmr";
import { openDeviationNumbers, bmrYieldRecord } from "./bmr-sources";
import { paperRecordBlockers } from "./bmr-paper";
import { type FormulaSnapshot, idempotent, lockBatch } from "./shared";
import { transitionBatch } from "./state";
import { syncWorkOrderProgress } from "./work-orders";

/**
 * Batch closure and controlled reopen / amendment (US-3-19; W05-20..21, CX-REOPEN,
 * docs/data-model.md §6.2, docs/permissions-matrix.md §5.2 `batch_reopen`, §5.3, A-PM-07).
 *
 * Closure (production.batch.approve): released | rejected → closed once every completeness check
 * passes; generates the final BMR (CONTROLLED COPY, or AMENDED rev n after a reopen), releases
 * reservations still held for the batch and records a batch_closures row.
 *
 * Reopen: requested by a holder of production.batch.admin with a reason and the scope of the
 * amendment; approved in two steps by different people (site manager, then QA co-approval) through
 * approval_decisions (record type `batch_reopen`). The last approval executes the reopen:
 * closed → the decided state (record-only amendment) or quarantined (QA must decide again). The
 * snapshot and revision ids never change. Amendments are append-only rows with the previous and
 * corrected value and a reason; closing again regenerates the BMR as AMENDED rev n and supersedes
 * the previous document.
 */

/* ------------------------------------------------------------------ reopen state machine */

export type ReopenTarget = (typeof REOPEN_TARGET_STATES)[number];

/** Controlled transitions out of `closed` (not in BATCH_TRANSITIONS: only the reopen service may use them). */
export const REOPEN_TRANSITIONS: Record<"closed", readonly ReopenTarget[]> = { closed: ["released", "rejected", "quarantined"] };

/**
 * Approval policy for `batch_reopen` (docs/permissions-matrix.md §5.2: step 1 site_manager, step 2
 * qa_qc). Typed data until the approval_rules table exists (A-W2D-02). The requester's request is
 * their step-1 approval when they hold a step-1 role; QA co-approval is always a different person.
 */
export type ReopenStep = { step: number; label: string; roles: string[]; permission: Permission; requesterMayDecide: boolean };
export const BATCH_REOPEN_POLICY: ReopenStep[] = [
  { step: 1, label: "Site manager approval", roles: ["site_manager"], permission: "production.batch.admin", requesterMayDecide: true },
  { step: 2, label: "QA co-approval", roles: ["qa_qc"], permission: "quality.disposition.approve", requesterMayDecide: false },
];

async function reopenTransition(tx: Tx, ctx: AuthContext, b: { id: string; status: string; batchNumber: string }, to: ReopenTarget, reason: string) {
  if (b.status !== "closed" || !REOPEN_TRANSITIONS.closed.includes(to)) {
    throw new DomainError("state", `Batch ${b.batchNumber} cannot be reopened from ${b.status.replace(/_/g, " ")} to ${to}.`);
  }
  await tx.update(batches).set({ status: to }).where(eq(batches.id, b.id));
  const [t] = await tx.insert(batchStateTransitions).values({ batchId: b.id, fromState: "closed", toState: to, actorId: ctx.userId, reason }).returning({ id: batchStateTransitions.id });
  b.status = to;
  return t.id;
}

/* ------------------------------------------------------------------ readiness */

export type ClosureCheck = { code: string; label: string; ok: boolean; blocking: boolean; detail: string };

/** Completeness checks for closure (docs/data-model.md §6.2 released / rejected → closed). */
export async function closureChecks(q: DbOrTx, ctx: AuthContext, b: typeof batches.$inferSelect): Promise<ClosureCheck[]> {
  const checks: ClosureCheck[] = [];
  const decided = b.status === "released" || b.status === "rejected";
  checks.push({
    code: "state",
    label: "Batch has a QA decision",
    ok: decided,
    blocking: true,
    detail: decided
      ? `Batch is ${b.status}.`
      : b.status === "closed"
        ? "Batch is already closed."
        : b.status === "rework_approved"
          ? "Rework was approved; the batch closes when the rework batch is linked (not available in this version)."
          : `Batch is ${b.status.replace(/_/g, " ")}; only a released or rejected batch can be closed.`,
  });
  const [disp] = decided
    ? await q
        .select({ id: dispositions.id })
        .from(dispositions)
        .where(and(eq(dispositions.subjectType, "batch"), eq(dispositions.subjectId, b.id), eq(dispositions.toStatus, b.status)))
        .limit(1)
    : [];
  checks.push({ code: "disposition", label: "Disposition recorded", ok: !!disp, blocking: true, detail: disp ? "QA disposition is on record." : "No QA disposition matching the batch state is on record." });

  if (b.status === "released") {
    const pending = await q.select({ id: batchMaterials.id }).from(batchMaterials).where(and(eq(batchMaterials.batchId, b.id), eq(batchMaterials.status, "pending")));
    checks.push({ code: "weighing", label: "Every ingredient weighed", ok: pending.length === 0, blocking: true, detail: pending.length ? `${pending.length} ingredient line(s) not weighed.` : "All ingredient lines weighed or recorded as exceptions." });
    const snap = b.formulaSnapshot as FormulaSnapshot;
    const done = new Set((await q.select({ n: processStepRecords.stepNo }).from(processStepRecords).where(eq(processStepRecords.batchId, b.id))).map((r) => r.n));
    const open = snap.steps.filter((s) => !done.has(s.stepNo));
    checks.push({ code: "steps", label: "Every routing step recorded", ok: open.length === 0, blocking: true, detail: open.length ? `Not recorded: ${open.map((s) => `${s.stepNo}. ${s.name}`).join(", ")}.` : `${snap.steps.length} of ${snap.steps.length} steps recorded.` });
    checks.push({ code: "output", label: "Output posted", ok: !!b.outputLotId && !!b.actualOutputG, blocking: true, detail: b.outputLotId ? "Output lot and actual yield recorded." : "No output lot / actual yield recorded." });
  }

  const openDevs = await openDeviationNumbers(q, b.id);
  checks.push({
    code: "deviations",
    label: "Deviations closed",
    ok: openDevs === null || openDevs.length === 0,
    blocking: true,
    detail: openDevs === null ? "Deviations are not tracked electronically in this version (check the paper deviation log)." : openDevs.length ? `Open: ${openDevs.join(", ")}.` : "No open deviations.",
  });

  const paper = await paperRecordBlockers(q, b.id);
  checks.push({ code: "paper_records", label: "Paper pages reviewed", ok: paper.length === 0, blocking: true, detail: paper.length ? paper.map((p) => p.message).join(" ") : "No paper page is waiting for review." });

  const y = await bmrYieldRecord(q, b.id);
  // A batch posted before electronic execution (MVP/legacy: no batch_outputs row, output on the batch
  // itself) has no yield record to check; the BMR prints its actual yield from the batch.
  const [posted] = await q.select({ id: batchOutputs.id }).from(batchOutputs).where(eq(batchOutputs.batchId, b.id)).limit(1);
  if (y.available && b.status === "released" && !posted && !y.rows.length) {
    checks.push({ code: "yield_record", label: "Yield reconciliation checked", ok: true, blocking: false, detail: "Recorded before electronic execution records; the BMR prints the actual yield from the batch." });
  } else if (y.available && b.status === "released") {
    const rec = y.rows[0];
    checks.push({ code: "yield_record", label: "Yield reconciliation checked", ok: !!rec?.checkedBy, blocking: true, detail: !rec ? "No yield record." : rec.checkedBy ? `Checked by ${rec.checkedBy} (co-signed the transfer to quarantine).` : "The yield record has not been checked by a second person." });
  } else {
    checks.push({ code: "yield_record", label: "Yield reconciliation checked", ok: true, blocking: false, detail: y.available ? "Not required for a rejected batch." : "Yield reconciliation records are not captured electronically in this version; the BMR prints the actual yield." });
  }

  const tpl = await bmrTemplateFor(q, ctx, { id: b.id, siteId: b.siteId, createdAt: b.createdAt });
  checks.push({ code: "bmr_template", label: "Approved BMR template", ok: !!tpl, blocking: true, detail: tpl ? `${tpl.template.code} v${tpl.version.versionNo}` : "No approved BMR template is available; QA must approve one first." });
  return checks;
}

/* ------------------------------------------------------------------ closure */

export async function closeBatch(ctx: AuthContext, input: { batchId: string; note?: string | null; idempotencyKey: string }) {
  ctx.require("production.batch.approve");
  ctx.require("documents.generated_document.create");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  const note = input.note?.trim() || null;
  if (note && note.length > 1000) throw new DomainError("validation", "The note is too long (max 1000).", { field: "note" });
  return db.transaction(async (tx) => {
    await visibleBatch(tx, ctx, input.batchId);
    const b = await lockBatch(tx, ctx, input.batchId);
    const { result } = await idempotent(tx, ctx, `close:${input.idempotencyKey}`, "production.batch.close", async () => {
      const checks = await closureChecks(tx, ctx, b);
      const blockers = checks.filter((c) => c.blocking && !c.ok);
      if (blockers.length) {
        throw new DomainError("state", `Batch ${b.batchNumber} cannot be closed yet: ${blockers.map((c) => `${c.label} — ${c.detail}`).join(" ")}`, {
          blockers: blockers.map((c) => ({ code: c.code, label: c.label, detail: c.detail })),
        });
      }
      const fromState = b.status as "released" | "rejected";
      const { closures, reopenCount } = await closureCounters(tx, b.id);
      await transitionBatch(tx, ctx, b, "closed", { reason: note ?? "Batch record closed" });
      const [t] = await tx.select({ id: batchStateTransitions.id }).from(batchStateTransitions).where(eq(batchStateTransitions.batchId, b.id)).orderBy(desc(batchStateTransitions.at), desc(batchStateTransitions.id)).limit(1);
      const released = await releaseReservationsForDemand(tx, ctx, "batch", b.id, `Batch ${b.batchNumber} closed`);
      await syncWorkOrderProgress(tx, ctx, b.workOrderId); // W2A: completed → closed with its last batch
      const watermark = bmrWatermark("closed", reopenCount);
      const { doc } = await generateBmrInTx(tx, ctx, b.id, { force: true, watermark, idempotencyKey: `close:${input.idempotencyKey}` });
      const closureNo = closures.length + 1;
      await tx.insert(batchClosures).values({
        organizationId: ctx.organizationId,
        siteId: b.siteId,
        batchId: b.id,
        closureNo,
        fromState,
        batchStateTransitionId: t?.id ?? null,
        generatedDocumentId: doc.id,
        checks: checks.map((c) => ({ code: c.code, ok: c.ok, detail: c.detail })),
        reservationsReleased: released,
        note,
        closedBy: ctx.userId,
      });
      await audit(tx, ctx, {
        action: "production.batch.closed",
        entityType: "batch",
        entityId: b.id,
        entityNumber: b.batchNumber,
        siteId: b.siteId,
        reason: note,
        before: { status: fromState },
        after: { status: "closed", closureNo, reopenCount, bmrDocument: doc.documentNumber, watermark, reservationsReleased: released },
      });
      return { closureNo, documentId: doc.id, documentNumber: doc.documentNumber, watermark, reservationsReleased: released };
    });
    return result;
  });
}

/* ------------------------------------------------------------------ reopen */

const reopenInput = z.object({
  batchId: z.string().uuid("Batch not found."),
  targetState: z.enum(REOPEN_TARGET_STATES, { message: "Choose where the batch goes while it is amended." }),
  reason: z.string().trim().min(10, "Explain why the closed record must be reopened (at least 10 characters).").max(1000),
  amendmentScope: z.string().trim().min(5, "Say what will be amended (at least 5 characters).").max(1000),
  idempotencyKey: z.string().min(8).max(200),
});
export type ReopenInput = z.input<typeof reopenInput>;

function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: String(i.path[0] ?? "form"), message: i.message }));
    throw new DomainError("validation", issues[0]?.message ?? "Check the form.", { issues });
  }
  return r.data;
}

async function reopenState(q: DbOrTx, organizationId: string, requestId: string) {
  const decisions = await q
    .select()
    .from(approvalDecisions)
    .where(and(eq(approvalDecisions.organizationId, organizationId), eq(approvalDecisions.recordType, "batch_reopen"), eq(approvalDecisions.recordId, requestId)))
    .orderBy(asc(approvalDecisions.step), asc(approvalDecisions.decidedAt));
  const rejected = decisions.some((d) => d.decision === "rejected");
  const approvedSteps = new Set(decisions.filter((d) => d.decision === "approved").map((d) => d.step));
  const nextStep = rejected ? null : (BATCH_REOPEN_POLICY.find((p) => !approvedSteps.has(p.step)) ?? null);
  return { decisions, nextStep };
}

/** Requests a controlled reopen of a closed batch (CX-REOPEN). */
export async function requestReopen(ctx: AuthContext, raw: ReopenInput) {
  ctx.require("production.batch.admin");
  const input = parse(reopenInput, raw);
  return db.transaction(async (tx) => {
    const [replay] = await tx
      .select()
      .from(batchReopenRequests)
      .where(and(eq(batchReopenRequests.organizationId, ctx.organizationId), eq(batchReopenRequests.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (replay) return { requestId: replay.id, nextStep: null, replayed: true };
    await visibleBatch(tx, ctx, input.batchId);
    const b = await lockBatch(tx, ctx, input.batchId);
    if (b.status !== "closed") throw new DomainError("state", `Batch ${b.batchNumber} is ${b.status.replace(/_/g, " ")}; only a closed batch can be reopened.`);
    const { lastClosure, reopens } = await closureCounters(tx, b.id);
    if (!lastClosure) throw new DomainError("state", `Batch ${b.batchNumber} has no closure record; it was closed before closures were recorded and cannot be reopened here.`);
    if (reopens.some((r) => r.status === "pending")) throw new DomainError("conflict", "A reopen request for this batch is already waiting for approval.");
    if ((input.targetState === "released" || input.targetState === "rejected") && input.targetState !== lastClosure.fromState) {
      throw new DomainError("validation", `The batch was closed as ${lastClosure.fromState}; it can return to ${lastClosure.fromState} or go to QA review (quarantined).`, { field: "targetState" });
    }
    const [req] = await tx
      .insert(batchReopenRequests)
      .values({
        organizationId: ctx.organizationId,
        siteId: b.siteId,
        batchId: b.id,
        closureNo: lastClosure.closureNo,
        status: "pending",
        targetState: input.targetState,
        reason: input.reason,
        amendmentScope: input.amendmentScope,
        requestedBy: ctx.userId,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    await audit(tx, ctx, {
      action: "production.batch.reopen_requested",
      entityType: "batch",
      entityId: b.id,
      entityNumber: b.batchNumber,
      siteId: b.siteId,
      reason: input.reason,
      after: { requestId: req.id, targetState: input.targetState, scope: input.amendmentScope, closureNo: lastClosure.closureNo },
    });
    // The request is the requester's step-1 approval when they hold a step-1 role.
    const step1 = BATCH_REOPEN_POLICY[0];
    if (step1.requesterMayDecide && ctx.can(step1.permission) && step1.roles.some((r) => ctx.roleCodes.includes(r))) {
      await tx.insert(approvalDecisions).values({ organizationId: ctx.organizationId, siteId: b.siteId, recordType: "batch_reopen", recordId: req.id, step: 1, decision: "approved", decidedBy: ctx.userId, note: "Requested by the site manager (step 1)." });
    }
    const { nextStep } = await reopenState(tx, ctx.organizationId, req.id);
    if (nextStep) {
      await notifyRoles(tx, { roleCodes: nextStep.roles, siteId: b.siteId }, {
        organizationId: ctx.organizationId,
        siteId: b.siteId,
        kind: "production.batch_reopen",
        severity: "warning",
        title: `Reopen of batch ${b.batchNumber} needs ${nextStep.label.toLowerCase()}`,
        body: `${ctx.displayName} asks to reopen closed batch ${b.batchNumber}: ${input.reason}`,
        entityType: "batch",
        entityId: b.id,
        link: `/production/${b.id}/closure`,
      });
    }
    return { requestId: req.id, nextStep: nextStep ? { step: nextStep.step, label: nextStep.label } : null, replayed: false };
  });
}

const decideInput = z.object({
  requestId: z.string().uuid("Request not found."),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(1000).optional().nullable(),
});

/** Records one approval step of a reopen request; the last approval executes the reopen. */
export async function decideReopen(ctx: AuthContext, raw: z.input<typeof decideInput>) {
  const input = parse(decideInput, raw);
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(batchReopenRequests).where(and(eq(batchReopenRequests.id, input.requestId), eq(batchReopenRequests.organizationId, ctx.organizationId))).limit(1).for("update");
    if (!req || !ctx.allowedSiteIds.includes(req.siteId)) throw new DomainError("not_found", "Reopen request not found in your sites.");
    ctx.requireSite(req.siteId);
    if (req.status !== "pending") throw new DomainError("state", `This request is already ${req.status}.`);
    const { decisions, nextStep } = await reopenState(tx, ctx.organizationId, req.id);
    if (!nextStep) throw new DomainError("state", "This request has no approval step waiting.");
    ctx.require(nextStep.permission);
    if (!nextStep.roles.some((r) => ctx.roleCodes.includes(r))) {
      throw new DomainError("forbidden", `Step ${nextStep.step} (${nextStep.label}) must be decided by ${nextStep.roles.map((r) => r.replace(/_/g, " ")).join(" or ")}.`);
    }
    if (!nextStep.requesterMayDecide && req.requestedBy === ctx.userId) throw new DomainError("separation_of_duties", "You requested this reopen, so another person must approve it.");
    if (decisions.some((d) => d.decidedBy === ctx.userId)) throw new DomainError("separation_of_duties", "You already approved an earlier step. A different person must decide this step.");
    const note = input.note?.trim() || null;
    if (input.decision === "rejected" && (!note || note.length < 5)) throw new DomainError("validation", "Enter the reason for rejecting (at least 5 characters).", { field: "note" });
    await tx.insert(approvalDecisions).values({ organizationId: ctx.organizationId, siteId: req.siteId, recordType: "batch_reopen", recordId: req.id, step: nextStep.step, decision: input.decision, decidedBy: ctx.userId, note });
    const b = await lockBatch(tx, ctx, req.batchId);
    const base = { entityType: "batch", entityId: b.id, entityNumber: b.batchNumber, siteId: b.siteId } as const;
    const now = new Date();
    if (input.decision === "rejected") {
      await tx.update(batchReopenRequests).set({ status: "rejected", decidedAt: now, decisionNote: note, updatedAt: now }).where(eq(batchReopenRequests.id, req.id));
      await audit(tx, ctx, { ...base, action: "production.batch.reopen_rejected", reason: note, after: { requestId: req.id, step: nextStep.step } });
      return { status: "rejected" as const };
    }
    const lastStep = Math.max(...BATCH_REOPEN_POLICY.map((p) => p.step));
    if (nextStep.step < lastStep) {
      await audit(tx, ctx, { ...base, action: "production.batch.reopen_step_approved", reason: note, after: { requestId: req.id, step: nextStep.step, label: nextStep.label } });
      return { status: "pending" as const };
    }
    // Final approval: execute the reopen. Snapshot and revision ids are untouched (batch.snapshot.reopen_keeps_revisions).
    const { reopenCount } = await closureCounters(tx, b.id);
    const reopenNo = reopenCount + 1;
    const transitionId = await reopenTransition(tx, ctx, b, req.targetState as ReopenTarget, `Reopen ${reopenNo}: ${req.reason}`);
    await tx
      .update(batchReopenRequests)
      .set({ status: "reopened", reopenNo, reopenedAt: now, decidedAt: now, decisionNote: note, batchStateTransitionId: transitionId, updatedAt: now })
      .where(eq(batchReopenRequests.id, req.id));
    const approvers = [...decisions.map((d) => d.decidedBy), ctx.userId];
    await audit(tx, ctx, {
      ...base,
      action: "production.batch.reopened",
      reason: req.reason,
      before: { status: "closed" },
      after: { status: req.targetState, reopenNo, requestId: req.id, scope: req.amendmentScope, approvers: approvers.length },
    });
    await notifyRoles(tx, { roleCodes: ["site_manager", "qa_qc"], siteId: b.siteId }, {
      organizationId: ctx.organizationId,
      siteId: b.siteId,
      kind: "production.batch_reopened",
      severity: "info",
      title: `Batch ${b.batchNumber} reopened (rev ${reopenNo})`,
      body: `Reopened to ${req.targetState} for: ${req.amendmentScope}. Record the amendments, then close the batch again.`,
      entityType: "batch",
      entityId: b.id,
      link: `/production/${b.id}/closure`,
    });
    return { status: "reopened" as const, reopenNo, targetState: req.targetState };
  });
}

/** The requester (or another batch admin) withdraws a pending request. */
export async function withdrawReopen(ctx: AuthContext, input: { requestId: string; reason: string }) {
  ctx.require("production.batch.admin");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) throw new DomainError("validation", "Give a reason (at least 5 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(batchReopenRequests).where(and(eq(batchReopenRequests.id, input.requestId), eq(batchReopenRequests.organizationId, ctx.organizationId))).limit(1).for("update");
    if (!req || !ctx.allowedSiteIds.includes(req.siteId)) throw new DomainError("not_found", "Reopen request not found in your sites.");
    if (req.status !== "pending") throw new DomainError("state", `This request is already ${req.status}.`);
    const now = new Date();
    await tx.update(batchReopenRequests).set({ status: "withdrawn", decidedAt: now, decisionNote: reason, updatedAt: now }).where(eq(batchReopenRequests.id, req.id));
    const [b] = await tx.select({ number: batches.batchNumber }).from(batches).where(eq(batches.id, req.batchId)).limit(1);
    await audit(tx, ctx, { action: "production.batch.reopen_withdrawn", entityType: "batch", entityId: req.batchId, entityNumber: b.number, siteId: req.siteId, reason, after: { requestId: req.id } });
  });
}

/* ------------------------------------------------------------------ amendments */

const amendmentInput = z.object({
  batchId: z.string().uuid("Batch not found."),
  section: z.enum(AMENDMENT_SECTIONS, { message: "Choose the BMR section." }),
  reference: z.string().trim().min(2, "Say what is corrected (step, line, field).").max(200),
  previousValue: z.string().trim().min(1, "Enter the value as recorded.").max(1000),
  correctedValue: z.string().trim().min(1, "Enter the corrected value.").max(1000),
  reason: z.string().trim().min(5, "Give the reason for the correction (at least 5 characters).").max(1000),
  supersedesId: z.string().uuid().optional().nullable(),
  idempotencyKey: z.string().min(8).max(200),
});
export type AmendmentInput = z.input<typeof amendmentInput>;

/** The executed reopen the batch is currently in, or null when it is not reopened. */
async function activeReopen(q: DbOrTx, batchId: string, status: string) {
  if (status === "closed") return null;
  const [r] = await q
    .select()
    .from(batchReopenRequests)
    .where(and(eq(batchReopenRequests.batchId, batchId), eq(batchReopenRequests.status, "reopened")))
    .orderBy(desc(batchReopenRequests.reopenNo))
    .limit(1);
  if (!r) return null;
  const [c] = await q.select({ n: max(batchClosures.closureNo) }).from(batchClosures).where(eq(batchClosures.batchId, batchId));
  // Reopen n follows closure n; a later closure ends it.
  return (c?.n ?? 0) <= (r.reopenNo ?? 0) ? r : null;
}

/** Appends an amendment while the batch is reopened (previous value kept, reason mandatory). */
export async function recordAmendment(ctx: AuthContext, raw: AmendmentInput) {
  if (!["production.batch.edit", "production.batch.admin", "quality.disposition.approve"].some((p) => ctx.can(p as Permission))) ctx.require("production.batch.edit");
  const input = parse(amendmentInput, raw);
  return db.transaction(async (tx) => {
    const [replay] = await tx.select().from(batchAmendments).where(and(eq(batchAmendments.organizationId, ctx.organizationId), eq(batchAmendments.idempotencyKey, input.idempotencyKey))).limit(1);
    if (replay) return { amendmentId: replay.id, amendmentNo: replay.amendmentNo, replayed: true };
    await visibleBatch(tx, ctx, input.batchId);
    const b = await lockBatch(tx, ctx, input.batchId);
    const reopen = await activeReopen(tx, b.id, b.status);
    if (!reopen) throw new DomainError("state", `Batch ${b.batchNumber} is not reopened. Amendments are recorded only after an approved reopen.`);
    if (input.supersedesId) {
      const [prev] = await tx.select().from(batchAmendments).where(and(eq(batchAmendments.id, input.supersedesId), eq(batchAmendments.batchId, b.id))).limit(1);
      if (!prev) throw new DomainError("validation", "The amendment to correct is not part of this batch.", { field: "supersedesId" });
      const [already] = await tx.select({ id: batchAmendments.id }).from(batchAmendments).where(eq(batchAmendments.supersedesId, prev.id)).limit(1);
      if (already) throw new DomainError("conflict", `Amendment A${prev.amendmentNo} was already corrected.`);
    }
    const [m] = await tx.select({ n: max(batchAmendments.amendmentNo) }).from(batchAmendments).where(eq(batchAmendments.batchId, b.id));
    const amendmentNo = (m?.n ?? 0) + 1;
    const [row] = await tx
      .insert(batchAmendments)
      .values({
        organizationId: ctx.organizationId,
        siteId: b.siteId,
        batchId: b.id,
        reopenRequestId: reopen.id,
        amendmentNo,
        section: input.section,
        reference: input.reference,
        previousValue: input.previousValue,
        correctedValue: input.correctedValue,
        reason: input.reason,
        supersedesId: input.supersedesId ?? null,
        idempotencyKey: input.idempotencyKey,
        recordedBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, {
      action: "production.batch.amended",
      entityType: "batch",
      entityId: b.id,
      entityNumber: b.batchNumber,
      siteId: b.siteId,
      reason: input.reason,
      before: { [input.reference]: input.previousValue },
      after: { amendmentNo, section: input.section, reference: input.reference, corrected: input.correctedValue, reopenNo: reopen.reopenNo },
    });
    return { amendmentId: row.id, amendmentNo, replayed: false };
  });
}

/* ------------------------------------------------------------------ view */

/** Everything the closure page shows, scoped to the caller. */
export async function getClosureView(ctx: AuthContext, batchId: string) {
  const { batch, product, siteCode } = await visibleBatch(db, ctx, batchId);
  const checks = await closureChecks(db, ctx, batch);
  const { closures, reopens, reopenCount } = await closureCounters(db, batch.id);
  const amendments = await db.select().from(batchAmendments).where(eq(batchAmendments.batchId, batch.id)).orderBy(asc(batchAmendments.amendmentNo));
  const decisions = reopens.length
    ? await db
        .select({ d: approvalDecisions, name: users.displayName })
        .from(approvalDecisions)
        .innerJoin(users, eq(users.id, approvalDecisions.decidedBy))
        .where(and(eq(approvalDecisions.recordType, "batch_reopen"), inArray(approvalDecisions.recordId, reopens.map((r) => r.id))))
        .orderBy(asc(approvalDecisions.step))
    : [];
  const ids = [...new Set([...closures.map((c) => c.closedBy), ...reopens.map((r) => r.requestedBy), ...amendments.map((a) => a.recordedBy)])];
  const people = ids.length ? await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, ids)) : [];
  const nm = (id: string) => people.find((p) => p.id === id)?.name ?? "Unknown user";
  const pending = reopens.find((r) => r.status === "pending") ?? null;
  const pendingState = pending ? await reopenState(db, ctx.organizationId, pending.id) : null;
  const next = pendingState?.nextStep ?? null;
  const reopen = await activeReopen(db, batch.id, batch.status);
  const canDecide =
    !!pending &&
    !!next &&
    ctx.can(next.permission) &&
    next.roles.some((r) => ctx.roleCodes.includes(r)) &&
    !(pendingState?.decisions ?? []).some((d) => d.decidedBy === ctx.userId) &&
    (next.requesterMayDecide || pending.requestedBy !== ctx.userId);
  const lastClosure = closures[closures.length - 1] ?? null;
  return {
    batch: { id: batch.id, number: batch.batchNumber, status: batch.status, siteId: batch.siteId, siteCode, productName: product.name, formulaRevisionId: batch.formulaRevisionId, routingRevisionId: batch.routingRevisionId },
    checks,
    canClose: checks.every((c) => !c.blocking || c.ok),
    closures: closures.map((c) => ({ ...c, closedByName: nm(c.closedBy) })),
    reopens: reopens.map((r) => ({
      ...r,
      requestedByName: nm(r.requestedBy),
      decisions: decisions.filter((d) => d.d.recordId === r.id).map((d) => ({ step: d.d.step, decision: d.d.decision, by: d.name, at: d.d.decidedAt, note: d.d.note })),
    })),
    pending: pending ? { id: pending.id, nextStep: next ? { step: next.step, label: next.label } : null, canDecide, isRequester: pending.requestedBy === ctx.userId } : null,
    reopenCount,
    activeReopenNo: reopen?.reopenNo ?? null,
    amendments: amendments.map((a) => ({ ...a, recordedByName: nm(a.recordedBy), superseded: amendments.some((x) => x.supersedesId === a.id) })),
    lastClosureFromState: lastClosure?.fromState ?? null,
    can: {
      close: ctx.can("production.batch.approve") && ctx.can("documents.generated_document.create"),
      requestReopen: ctx.can("production.batch.admin"),
      amend: ["production.batch.edit", "production.batch.admin", "quality.disposition.approve"].some((p) => ctx.can(p as Permission)),
      issuePaper: ctx.can("production.batch.edit") && ctx.can("documents.generated_document.create"),
      attachPaper: ctx.can("production.batch.edit") && ctx.can("documents.file_attachment.create"),
      reviewPaper: ctx.can("production.process_step_record.approve"),
    },
    steps: [...(batch.formulaSnapshot as FormulaSnapshot).steps].sort((a, z) => a.stepNo - z.stepNo).map((s) => ({ stepNo: s.stepNo, name: s.name, kind: s.stepKind })),
  };
}
export type ClosureView = Awaited<ReturnType<typeof getClosureView>>;

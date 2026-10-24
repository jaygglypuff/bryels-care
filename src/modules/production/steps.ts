import "server-only";
import { type DbOrTx, db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { dispensingBlockers } from "./dispensing";
import { type BatchRow, type SnapshotStep, type StepRecord, assertCheckerFor, findStep, finishStep, missingPrerequisites, openStep, performPermission, stepLabel, stepRecord } from "./execution";
import { checklistBlockers } from "./line-clearance";
import { postPackagingConsumption } from "./execution-postings";
import { currentPackaging, packagingBlockers } from "./packaging";
import { type Blocker, processBlockers } from "./process";
import { getSetting } from "@/lib/settings";
import { idempotent, isWeighingStep, lockBatch } from "./shared";

export type CompleteStepInput = {
  batchId: string;
  stepNo: number;
  notes?: string | null;
  idempotencyKey?: string | null;
};

/**
 * Everything that keeps a step from being finished now, as plain-language messages
 * (shown on the step screen and returned with the 409). `exceptionable` blockers can be
 * cleared by a controlled exception with a deviation (CX-TOL); the others must be resolved.
 */
export async function stepBlockers(q: DbOrTx, ctx: AuthContext, batch: BatchRow, step: SnapshotStep, rec: StepRecord | null): Promise<Blocker[]> {
  const out: Blocker[] = [];
  const missing = await missingPrerequisites(q, batch, step);
  if (missing.length) out.push({ message: `Complete ${stepLabel(missing[0])} first.`, exceptionable: false });
  if (step.stepKind === "transfer") return out;
  for (const m of await checklistBlockers(q, step, rec)) out.push({ message: m, exceptionable: false });
  if (isWeighingStep(step.stepKind)) {
    for (const m of await dispensingBlockers(q, batch)) out.push({ message: m, exceptionable: false });
    return out;
  }
  out.push(...(await processBlockers(q, ctx, batch, step, rec)));
  out.push(...(await packagingBlockers(q, batch, step, rec)));
  return out;
}

/** Starts a step explicitly (e.g. to start the curing timer before any reading). */
export async function startStep(ctx: AuthContext, input: { batchId: string; stepNo: number }) {
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    const step = findStep(batch, input.stepNo);
    ctx.require(performPermission(step.stepKind));
    if (step.stepKind === "transfer") throw new DomainError("validation", "Transfer to quarantine is posted from the yield and transfer screen.");
    const rec = await openStep(tx, ctx, batch, step);
    return { stepNo: step.stepNo, status: rec.status, earliestCompletionAt: rec.earliestCompletionAt };
  });
}

/**
 * Completes (signs off) the current step after its kind-specific checks (US-3-11 AC1): prerequisite
 * steps complete (409 V-STATE), weighing lines weighed and checked, required readings recorded and
 * within limits (or a CX-TOL exception with a deviation), equipment recorded, in-process inspection
 * passed, hold minimum elapsed, packaging reconciled. With a co-signed checker the step completes;
 * otherwise it waits for the checker's own signature (checkStep). Concurrent completions of the same
 * step serialise on the batch lock: one succeeds, the other gets 409.
 */
export async function completeStep(ctx: AuthContext, input: CompleteStepInput, signers: { checker?: AuthContext | null } = {}) {
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.process_step_record.complete", async () => {
      const step = findStep(batch, input.stepNo);
      ctx.require(performPermission(step.stepKind) === "production.dispense_record.create" ? "production.process_step_record.create" : performPermission(step.stepKind));
      if (step.stepKind === "transfer") throw new DomainError("validation", "Transfer to quarantine is posted from the yield and transfer screen (it posts consumption and output).");
      if (step.stepKind === "line_clearance" && (step.checklistItems ?? []).length) {
        const existing = await stepRecord(tx, batch.id, step.stepNo);
        if (!existing) throw new DomainError("validation", `Answer the checklist of ${stepLabel(step)}.`);
      }
      if (signers.checker) assertCheckerFor(signers.checker, ctx.userId, step.stepKind, batch.siteId);
      const rec = await openStep(tx, ctx, batch, step);
      const blockers = await stepBlockers(tx, ctx, batch, step, rec);
      if (blockers.length) {
        throw new DomainError("state", `${stepLabel(step).replace(/^s/, "S")} cannot be completed yet: ${blockers.map((b) => b.message).join(" ")}`, {
          rule: "V-STATE",
          blockers,
        });
      }
      const fin = await finishStep(tx, ctx, batch, step, rec, { checker: signers.checker ?? null, notes: input.notes });
      // Packaging consumption at the end of packaging when the site posts per event (A-PROC-31).
      if (await getSetting(tx, ctx.organizationId, "production.post_consumption_at_dispense", batch.siteId)) {
        for (const row of await currentPackaging(tx, batch.id)) {
          if (row.r.processStepRecordId === rec.id) await postPackagingConsumption(tx, ctx, batch, row.r, row.materialName);
        }
      }
      const total = batch.formulaSnapshot && (batch.formulaSnapshot as { steps: unknown[] }).steps.length;
      return { stepNo: step.stepNo, name: step.name, status: fin.status, total };
    });
    return result;
  });
}

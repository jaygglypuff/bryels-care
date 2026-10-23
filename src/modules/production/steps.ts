import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { batchMaterials, processStepRecords } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { type FormulaSnapshot, assertChecker, isWeighingStep, lockBatch } from "./shared";

export type CompleteStepInput = {
  batchId: string;
  stepNo: number;
  checkerId?: string | null;
  readings?: string | null;
};

/**
 * Completes the next checklist step of a batch (routing snapshot order). Rules:
 * - the batch is in process;
 * - steps complete strictly in order (step n requires steps 1..n-1);
 * - the weighing step requires every ingredient dispensed or recorded as exception;
 * - the checker is another eligible person (separation of duties) when the step requires one.
 */
export async function completeStep(ctx: AuthContext, input: CompleteStepInput) {
  ctx.require("production.batch.edit");
  return db.transaction(async (tx) => {
    const b = await lockBatch(tx, ctx, input.batchId);
    if (b.status !== "in_process") {
      throw new DomainError("state", `Batch ${b.batchNumber} is ${b.status.replace(/_/g, " ")}. Steps can only be completed while the batch is in process.`);
    }
    const snapshot = b.formulaSnapshot as FormulaSnapshot;
    const steps = [...snapshot.steps].sort((a, z) => a.stepNo - z.stepNo);
    const step = steps.find((s) => s.stepNo === input.stepNo);
    if (!step) throw new DomainError("not_found", "Step not found in this batch's routing.");

    const done = await tx.select({ stepNo: processStepRecords.stepNo }).from(processStepRecords).where(eq(processStepRecords.batchId, b.id));
    const doneSet = new Set(done.map((d) => d.stepNo));
    if (doneSet.has(step.stepNo)) throw new DomainError("state", `Step ${step.stepNo} (${step.name}) is already complete.`);
    const missing = steps.filter((s) => s.stepNo < step.stepNo && !doneSet.has(s.stepNo));
    if (missing.length) {
      throw new DomainError("state", `Complete step ${missing[0].stepNo} (${missing[0].name}) first. Steps are completed in order.`);
    }

    if (isWeighingStep(step.stepKind)) {
      const pending = await tx
        .select({ id: batchMaterials.id })
        .from(batchMaterials)
        .where(and(eq(batchMaterials.batchId, b.id), eq(batchMaterials.status, "pending")));
      if (pending.length) {
        throw new DomainError("state", `${pending.length} ingredient(s) still need to be weighed before the Weighing step can be completed.`);
      }
    }

    let checker: { id: string; displayName: string } | null = null;
    if (step.requiresChecker || input.checkerId) checker = await assertChecker(tx, ctx, b.siteId, input.checkerId);

    const readings = input.readings?.trim() || null;
    const [rec] = await tx
      .insert(processStepRecords)
      .values({
        batchId: b.id,
        routingStepId: step.routingStepId,
        stepNo: step.stepNo,
        name: step.name,
        conductedBy: ctx.userId,
        checkedBy: checker?.id ?? null,
        readings,
      })
      .returning();

    await audit(tx, ctx, {
      action: "production.process_step.completed",
      entityType: "process_step_record",
      entityId: rec.id,
      entityNumber: b.batchNumber,
      siteId: b.siteId,
      after: { batchId: b.id, stepNo: step.stepNo, name: step.name, checker: checker?.displayName ?? null, readings },
    });
    return { stepNo: step.stepNo, name: step.name, total: steps.length };
  });
}

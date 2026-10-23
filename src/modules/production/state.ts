import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batchStateTransitions, batches } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";

/**
 * Batch state machine (docs/data-model.md §6.2, manufacturing-process-engineer rules).
 * Every change goes through transitionBatch, which validates against this table and writes a
 * batch_state_transitions row in the caller's transaction. Free-form status updates are not allowed.
 */
export const BATCH_STATUSES = [
  "draft",
  "planned",
  "materials_staged",
  "in_process",
  "awaiting_qc",
  "quarantined",
  "released",
  "rejected",
  "rework_approved",
  "closed",
] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const BATCH_TRANSITIONS: Record<BatchStatus, readonly BatchStatus[]> = {
  draft: ["planned"],
  planned: ["materials_staged"],
  materials_staged: ["in_process"],
  in_process: ["awaiting_qc"],
  awaiting_qc: ["quarantined", "released", "rejected"],
  quarantined: ["released", "rejected", "rework_approved"],
  rework_approved: ["in_process"],
  released: ["closed"],
  rejected: ["closed"],
  closed: [],
};

export function isBatchStatus(s: string): s is BatchStatus {
  return (BATCH_STATUSES as readonly string[]).includes(s);
}

export function canTransition(from: string, to: BatchStatus): boolean {
  return isBatchStatus(from) && BATCH_TRANSITIONS[from].includes(to);
}

/**
 * Moves a batch to `to` (caller must hold the batch row lock and have checked permissions).
 * Returns the new status. Throws DomainError("state") for a transition not in the table.
 */
export async function transitionBatch(
  tx: Tx,
  ctx: AuthContext,
  batch: { id: string; status: string; batchNumber: string },
  to: BatchStatus,
  opts: { reason?: string | null; set?: Partial<typeof batches.$inferInsert> } = {},
): Promise<BatchStatus> {
  if (!canTransition(batch.status, to)) {
    throw new DomainError("state", `Batch ${batch.batchNumber} cannot move from ${batch.status.replace(/_/g, " ")} to ${to.replace(/_/g, " ")}.`);
  }
  await tx
    .update(batches)
    .set({ ...(opts.set ?? {}), status: to })
    .where(eq(batches.id, batch.id));
  await tx.insert(batchStateTransitions).values({
    batchId: batch.id,
    fromState: batch.status,
    toState: to,
    actorId: ctx.userId,
    reason: opts.reason ?? null,
  });
  batch.status = to;
  return to;
}

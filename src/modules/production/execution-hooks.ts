import "server-only";
import type { Tx } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";

/**
 * Integration points of batch execution (W2B) with modules built by other Wave 2 streams.
 *
 * Execution never imports those modules directly: each stream (or the integrator) registers its
 * implementation here once, from a server module that is always loaded (for example the module's
 * own index.ts: `registerExecutionHooks({ openDeviation })`). Until a hook is registered the
 * default keeps the batch safe: an exception that needs a deviation is refused with a clear
 * message, a work-order transition is simply not made (there are no work orders yet), and an
 * in-process inspection required by the routing blocks the step.
 *
 * Every hook runs inside the caller's transaction (`tx`) so the deviation, the work-order change
 * and the execution record commit or roll back together.
 */

export type DeviationKind =
  | "out_of_tolerance"
  | "equipment_override"
  | "failed_check"
  | "yield_out_of_range"
  | "reconciliation_mismatch"
  | "skipped_step"
  | "other";

export type OpenDeviationInput = {
  kind: DeviationKind;
  severity?: "minor" | "major" | "critical";
  batchId: string;
  batchNumber: string;
  siteId: string;
  lotId?: string | null;
  dispenseRecordId?: string | null;
  processStepRecordId?: string | null;
  description: string;
  /** The qa_qc / site_manager who approved the controlled exception (raiser of the deviation). */
  approvedBy: string;
};

export type InProcessQcStatus = { status: "not_required" | "pending" | "passed" | "failed"; message?: string };

export type ExecutionHooks = {
  /** W2C: open a deviation (rule DEV) for a controlled exception; returns its id. */
  openDeviation?: (tx: Tx, ctx: AuthContext, input: OpenDeviationInput) => Promise<{ deviationId: string; deviationNumber?: string }>;
  /** W2A: the batch entered in_process (first signed clearance) → work order released → in_progress. */
  onBatchInProcess?: (tx: Tx, ctx: AuthContext, batch: { id: string; batchNumber: string; siteId: string }) => Promise<void>;
  /** W2A: the batch was posted to quarantine (awaiting_qc) → work order completed when it was the last batch. */
  onBatchSubmitted?: (tx: Tx, ctx: AuthContext, batch: { id: string; batchNumber: string; siteId: string }) => Promise<void>;
  /** W2C: status of the in-process inspection a routing step requires (W05-12). */
  inProcessQcStatus?: (tx: Tx, ctx: AuthContext, input: { batchId: string; processStepRecordId: string; inspectionPlanId: string }) => Promise<InProcessQcStatus>;
  /** W2C: create the finished-product inspection from the batch's frozen plan at transfer to quarantine (W05-17). */
  createFinishedProductInspection?: (tx: Tx, ctx: AuthContext, input: { batchId: string; lotId: string; inspectionPlanId: string | null; siteId: string }) => Promise<{ inspectionId: string } | null>;
};

const hooks: ExecutionHooks = {};

/** Registers hook implementations (later registrations replace earlier ones per key). */
export function registerExecutionHooks(h: ExecutionHooks) {
  Object.assign(hooks, h);
}

/** Test support: removes every registered hook. */
export function resetExecutionHooks() {
  for (const k of Object.keys(hooks) as (keyof ExecutionHooks)[]) delete hooks[k];
}

export function executionHooks(): Readonly<ExecutionHooks> {
  return hooks;
}

/** Message shown while the deviations module is not connected. */
export const DEVIATION_UNAVAILABLE =
  "This needs a deviation, and deviations cannot be raised in the system yet (the QA deviations module is not connected). The step stays blocked: ask QA.";

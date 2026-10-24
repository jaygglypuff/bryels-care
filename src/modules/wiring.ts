import "server-only";
import type { Tx } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { type DeviationKind, type OpenDeviationInput, registerExecutionHooks } from "@/modules/production";
import { type DeviationSource, ensureBatchInspection, inProcessQcStatus, openDeviation } from "@/modules/quality";

/**
 * Cross-module wiring (Wave 2 integration). Batch execution (production) must not import the quality
 * module (quality imports production), so quality's services are plugged into the execution hooks
 * here. `registerAppHooks()` is idempotent and is called:
 *
 * - at web server start (src/instrumentation.ts `register`),
 * - at worker start (src/worker.ts),
 * - by the batch-execution server actions and API routes (cheap; covers a cold route bundle),
 * - by integration tests that exercise the connected behaviour.
 *
 * The hook registry lives on globalThis (one per process), so every Next bundle sees it.
 */

/** Execution exception kinds → deviation source (docs/data-model.md §3.6 `deviations.source`). */
const SOURCE: Record<DeviationKind, DeviationSource> = {
  out_of_tolerance: "cx_tol",
  equipment_override: "cx_cal",
  failed_check: "in_process_check",
  yield_out_of_range: "yield",
  reconciliation_mismatch: "reconciliation",
  skipped_step: "other",
  other: "other",
};

async function openExecutionDeviation(tx: Tx, ctx: AuthContext, input: OpenDeviationInput) {
  // The deviation is about the batch; the weighed material lot is named in the description only, so a
  // deviation on a batch never blocks decisions on a shared raw-material lot.
  const r = await openDeviation(
    ctx,
    {
      batchId: input.batchId,
      processStepRecordId: input.processStepRecordId ?? null,
      dispenseRecordId: input.dispenseRecordId ?? null,
      source: SOURCE[input.kind],
      description: input.description,
    },
    { tx },
  );
  return { deviationId: r.deviationId, deviationNumber: r.deviationNumber };
}

/** Registers (again) every cross-module hook; repeated calls replace the same entries. */
export function registerAppHooks() {
  registerExecutionHooks({
    openDeviation: openExecutionDeviation,
    inProcessQcStatus: (tx, ctx, input) => inProcessQcStatus(tx, ctx, input),
    createFinishedProductInspection: async (tx, ctx, input) => {
      const r = await ensureBatchInspection(tx, ctx, input.batchId);
      return r ? { inspectionId: r.inspectionId } : null;
    },
  });
}

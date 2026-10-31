/**
 * ONE path for production work (owner complaint 2026-10-31, "the original layout and features are
 * not overridden"): every "do work" link is built here and opens a production flow v2 screen. Pure
 * (no server-only import) so the next-action tables, the floor tasks, notifications and pages share it.
 *
 * | Work                                         | Screen                                                        |
 * |----------------------------------------------|---------------------------------------------------------------|
 * | Get materials (also "Materials by scan")     | /production/orders/<order>/materials?batch=<batch>            |
 * | Start check (clean area) and Start           | /production/orders/<order>/step/<first step>?batch=<batch>    |
 * | Weigh, check a weighing, other ways to weigh | /production/orders/<order>/weigh[/more]?batch=<batch>         |
 * | A step, its second-person check, curing      | /production/orders/<order>/step/<n>?batch=<batch>             |
 * | Packaging and labels                         | the packaging step's screen (step/<n>)                        |
 * | Finish                                       | /production/<batch>/finish                                    |
 * | Check quality (QA)                           | /quality/check/<batch>                                        |
 * | See what happened (read-only)                | /production/<batch> ("Batch record")                          |
 *
 * A batch made without a production order (older batches, `production.batch.allow_without_work_order`)
 * uses the same screens with the order segment `without-order`: the batch is then named by `?batch=`.
 */

/** The order segment of the flow screens for a batch that has no production order. */
export const NO_ORDER_SEGMENT = "without-order";

export type FlowScreen = "materials" | "weigh" | "weigh/more" | `step/${number}`;

type BatchRef = { batchId: string; workOrderId: string | null | undefined };

/** A production flow v2 screen of a batch (with or without an order). */
export function flowHref(b: BatchRef, screen: FlowScreen): string {
  return `/production/orders/${b.workOrderId || NO_ORDER_SEGMENT}/${screen}?batch=${b.batchId}`;
}

/** The Finish screen (ADR-080 §6) of a batch. */
export const finishHref = (batchId: string) => `/production/${batchId}/finish`;

/** The QA "Check quality" screen (ADR-080 §8) of a batch. */
export const qualityCheckHref = (batchId: string) => `/quality/check/${batchId}`;

/** The read-only batch record (what happened): steps, who, readings, materials, packaging, output, checks. */
export const batchRecordHref = (batchId: string) => `/production/${batchId}`;

/** Where the order of a flow screen is: the order hub, or the batch record for a batch without an order. */
export function flowBackHref(b: BatchRef): string {
  return b.workOrderId ? `/production/orders/${b.workOrderId}` : batchRecordHref(b.batchId);
}

/** The first step of a batch (the Start check in the example setups), from its frozen step list. */
export function firstStepNo(steps: { stepNo: number }[] | null | undefined): number {
  const nos = (steps ?? []).map((s) => s.stepNo);
  return nos.length ? Math.min(...nos) : 1;
}

/**
 * True when `href` is a "do work" link that opens the OLD batch workspace instead of a flow screen:
 * `/production/<uuid>` with nothing after it (the read-only batch record). Finish, closure and the
 * flow screens are fine. Used by the guard test and by callers that must never send work there.
 */
export function isOldWorkspaceHref(href: string): boolean {
  return /^\/production\/[0-9a-f-]{36}(\?.*)?$/i.test(href);
}

/**
 * "Continue this batch": a server redirect to the batch's next flow screen (nextBatchScreen), for
 * callers that only know the batch (board, scan, notifications, the batch record's NextStep).
 */
export function continueHref(b: BatchRef): string {
  return `/production/orders/${b.workOrderId || NO_ORDER_SEGMENT}/continue?batch=${b.batchId}`;
}

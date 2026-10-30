/**
 * Production order status (ADR-074). A production order is a work order with its batches, shown to
 * owners and operators with five plain statuses instead of the work-order and batch state machines.
 * The mapping is a pure read model: the underlying state machines (work-orders-state.ts, state.ts)
 * are unchanged and remain the only way states move.
 *
 * | Work order status      | Batches                          | Production order |
 * |------------------------|----------------------------------|------------------|
 * | draft, planned         | any                              | Draft            |
 * | released               | none started                     | Approved         |
 * | released               | at least one started             | In progress      |
 * | in_progress            | any                              | In progress      |
 * | completed, closed      | any                              | Done             |
 * | cancelled              | any                              | Cancelled        |
 *
 * "Started" means the batch has a start time (its first line clearance was signed) — the same rule
 * syncWorkOrderProgress uses to move a released work order to in_progress.
 *
 * No server-only import: client components and unit tests may use it.
 */
export const PRODUCTION_ORDER_STATUSES = ["draft", "approved", "in_progress", "done", "cancelled"] as const;
export type ProductionOrderStatus = (typeof PRODUCTION_ORDER_STATUSES)[number];

export const PRODUCTION_ORDER_LABEL: Record<ProductionOrderStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

/** Status chip key (src/ui/status.tsx) per production order status. */
export const PRODUCTION_ORDER_CHIP: Record<ProductionOrderStatus, string> = {
  draft: "draft",
  approved: "confirmed",
  in_progress: "in_progress",
  done: "completed",
  cancelled: "cancelled",
};

/** The four steps of the progress strip (Cancelled is shown instead of the strip). */
export const PRODUCTION_ORDER_STEPS: readonly ProductionOrderStatus[] = ["draft", "approved", "in_progress", "done"];

export function productionOrderStatus(workOrderStatus: string, anyBatchStarted: boolean): ProductionOrderStatus {
  switch (workOrderStatus) {
    case "draft":
    case "planned":
      return "draft";
    case "released":
      return anyBatchStarted ? "in_progress" : "approved";
    case "in_progress":
      return "in_progress";
    case "completed":
    case "closed":
      return "done";
    case "cancelled":
      return "cancelled";
    default:
      throw new Error(`Unknown work order status: ${workOrderStatus}`);
  }
}

/** Work order statuses that belong to a production order status (list filters). */
export function workOrderStatusesFor(s: ProductionOrderStatus): string[] {
  return { draft: ["draft", "planned"], approved: ["released"], in_progress: ["released", "in_progress"], done: ["completed", "closed"], cancelled: ["cancelled"] }[s];
}

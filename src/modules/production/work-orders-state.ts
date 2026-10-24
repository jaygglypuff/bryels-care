import "server-only";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { Tx } from "@/db/client";
import { workOrderStateTransitions, workOrders } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";

/**
 * Work order state machine (docs/data-model.md §6.3):
 *   draft → planned → released → in_progress → completed → closed;
 *   draft | planned | released → cancelled (reason required).
 * in_progress, completed and closed follow the batches (syncWorkOrderProgress). Every change goes
 * through transitionWorkOrder, which validates against this table and writes a
 * work_order_state_transitions row in the caller's transaction.
 */
export const WORK_ORDER_STATUSES = ["draft", "planned", "released", "in_progress", "completed", "closed", "cancelled"] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  draft: ["planned", "cancelled"],
  planned: ["released", "cancelled"],
  released: ["in_progress", "cancelled"],
  in_progress: ["completed"],
  completed: ["closed"],
  closed: [],
  cancelled: [],
};

/** Transitions that must carry a reason (§6.1: backward, cancel, exception). */
const REASON_REQUIRED: readonly WorkOrderStatus[] = ["cancelled"];

export const WORK_ORDER_STATUS_WORD: Record<WorkOrderStatus, string> = {
  draft: "draft",
  planned: "planned",
  released: "released",
  in_progress: "in progress",
  completed: "completed",
  closed: "closed",
  cancelled: "cancelled",
};

export function isWorkOrderStatus(s: string): s is WorkOrderStatus {
  return (WORK_ORDER_STATUSES as readonly string[]).includes(s);
}

export function canWorkOrderTransition(from: string, to: WorkOrderStatus): boolean {
  return isWorkOrderStatus(from) && WORK_ORDER_TRANSITIONS[from].includes(to);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type WoRow = { id: string; status: string; workOrderNumber: string; siteId: string; organizationId: string };

/**
 * Moves a work order to `to` (caller holds the row lock and checked permissions). Illegal
 * transitions are 409 and write nothing; legal ones write exactly one transition row.
 */
export async function transitionWorkOrder(
  tx: Tx,
  ctx: AuthContext,
  wo: WoRow,
  to: WorkOrderStatus,
  opts: { reason?: string | null; set?: Partial<typeof workOrders.$inferInsert> } = {},
): Promise<WorkOrderStatus> {
  if (!canWorkOrderTransition(wo.status, to)) {
    throw new DomainError("state", `Work order ${wo.workOrderNumber} is ${WORK_ORDER_STATUS_WORD[wo.status as WorkOrderStatus] ?? wo.status}; it cannot become ${WORK_ORDER_STATUS_WORD[to]}.`, {
      machine: "work_order",
      from: wo.status,
      to,
    });
  }
  const reason = opts.reason?.trim() || null;
  if (REASON_REQUIRED.includes(to) && (!reason || reason.length < 5)) {
    throw new DomainError("validation", "Give a reason (at least 5 characters).", { field: "reason" });
  }
  const now = new Date();
  await tx
    .update(workOrders)
    .set({ ...(opts.set ?? {}), status: to, statusChangedAt: now, statusChangedBy: ctx.userId, updatedAt: now, updatedBy: ctx.userId })
    .where(eq(workOrders.id, wo.id));
  await tx.insert(workOrderStateTransitions).values({
    organizationId: wo.organizationId,
    siteId: wo.siteId,
    workOrderId: wo.id,
    fromState: wo.status,
    toState: to,
    actorId: ctx.userId,
    reason,
    occurredAt: now,
    correlationId: ctx.correlationId && UUID_RE.test(ctx.correlationId) ? ctx.correlationId : uuidv7(),
  });
  wo.status = to;
  return to;
}

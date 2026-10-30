import "server-only";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { Tx } from "@/db/client";
import {
  PURCHASE_ORDER_STATUSES,
  PURCHASE_REQUEST_STATUSES,
  SUPPLIER_RETURN_STATUSES,
  purchaseOrderStateTransitions,
  purchaseOrders,
  purchaseRequestStateTransitions,
  purchaseRequests,
  supplierReturnStateTransitions,
  supplierReturns,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { isUuid } from "./shared";

/**
 * Procurement state machines (docs/data-model.md §6.4, docs/process-maps.md W04). Each record changes
 * status only through `transition*`, which checks the transition table, requires a reason where §6.1
 * asks for one (backward, cancel, exception), updates the `+status` columns and writes one row to the
 * append-only `*_state_transitions` log in the caller's transaction.
 */

export type PrStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];
export type PoStatus = (typeof PURCHASE_ORDER_STATUSES)[number];
export type SrStatus = (typeof SUPPLIER_RETURN_STATUSES)[number];

/** Purchase request: draft → submitted → approved → converted; submitted → rejected | draft (returned); draft|submitted|approved → cancelled. */
export const PR_TRANSITIONS: Record<PrStatus, readonly PrStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "rejected", "draft", "cancelled"],
  approved: ["converted", "cancelled"],
  rejected: [],
  converted: [],
  cancelled: [],
};

/**
 * Purchase order (§6.4): draft → submitted → approved → sent → partially_received → received → closed;
 * submitted → draft (returned); draft|submitted|approved|sent → cancelled (reason). As built (W4A):
 * sent|partially_received → closed when every line is received or short-closed with a reason (A-W4A-01);
 * a reversed goods receipt moves partially_received → sent and received → partially_received | sent
 * (reason = the reversal reason). S6 (ADR-077): approved → received only for an after-the-fact PO
 * (made from a posted unplanned receipt; its goods are already in), on its final approval.
 */
export const PO_TRANSITIONS: Record<PoStatus, readonly PoStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "draft", "cancelled"],
  approved: ["sent", "received", "cancelled"],
  sent: ["partially_received", "received", "closed", "cancelled"],
  partially_received: ["partially_received", "received", "closed", "sent"],
  received: ["closed", "partially_received", "sent"],
  closed: [],
  cancelled: [],
};

/** Supplier return: draft → submitted → approved → posted; submitted → draft (returned); draft|submitted|approved → cancelled. */
export const SR_TRANSITIONS: Record<SrStatus, readonly SrStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "draft", "cancelled"],
  approved: ["posted", "cancelled"],
  posted: [],
  cancelled: [],
};

export const PR_STATUS_LABEL: Record<PrStatus, string> = {
  draft: "Draft",
  submitted: "Waiting for approval",
  approved: "Approved",
  rejected: "Rejected",
  converted: "Converted to PO",
  cancelled: "Cancelled",
};
export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  draft: "Draft",
  submitted: "Waiting for approval",
  approved: "Approved (not sent)",
  sent: "Sent to supplier",
  partially_received: "Partially received",
  received: "Received",
  closed: "Closed",
  cancelled: "Cancelled",
};
export const SR_STATUS_LABEL: Record<SrStatus, string> = {
  draft: "Draft",
  submitted: "Waiting for approval",
  approved: "Approved (not posted)",
  posted: "Posted (stock issued)",
  cancelled: "Cancelled",
};

const REASON_REQUIRED = new Set([
  "submitted>draft",
  "submitted>rejected",
  "partially_received>sent",
  "received>partially_received",
  "received>sent",
  "sent>closed",
  "partially_received>closed",
]);

function needsReason(from: string, to: string) {
  return to === "cancelled" || REASON_REQUIRED.has(`${from}>${to}`);
}

export function canMove<S extends string>(table: Record<S, readonly S[]>, from: string, to: S): boolean {
  return Object.prototype.hasOwnProperty.call(table, from) && table[from as S].includes(to);
}

function assertMove<S extends string>(machine: string, table: Record<S, readonly S[]>, labels: Record<S, string>, from: string, to: S, what: string) {
  if (!canMove(table, from, to)) {
    throw new DomainError("state", `${what} is ${(labels[from as S] ?? from).toLowerCase()} and cannot be moved to ${labels[to].toLowerCase()}.`, { machine, from, to });
  }
}

function reasonFor(from: string, to: string, reason: string | null | undefined) {
  const r = reason?.trim() || null;
  if (needsReason(from, to) && (!r || r.length < 3)) throw new DomainError("validation", "Give a reason (at least 3 characters).", { field: "reason" });
  return r;
}

const corr = (ctx: AuthContext) => (ctx.correlationId && isUuid(ctx.correlationId) ? ctx.correlationId : uuidv7());

type Rec<S> = { id: string; status: string; siteId: string; organizationId: string } & { status: S | string };

export async function transitionPr(tx: Tx, ctx: AuthContext, r: Rec<PrStatus> & { requestNumber: string }, to: PrStatus, opts: { reason?: string | null; set?: Partial<typeof purchaseRequests.$inferInsert> } = {}) {
  assertMove("purchase_request", PR_TRANSITIONS, PR_STATUS_LABEL, r.status, to, `Purchase request ${r.requestNumber}`);
  const reason = reasonFor(r.status, to, opts.reason);
  const now = new Date();
  await tx.update(purchaseRequests).set({ ...(opts.set ?? {}), status: to, statusChangedAt: now, statusChangedBy: ctx.userId, updatedAt: now }).where(eq(purchaseRequests.id, r.id));
  await tx.insert(purchaseRequestStateTransitions).values({ organizationId: r.organizationId, siteId: r.siteId, purchaseRequestId: r.id, fromState: r.status, toState: to, actorId: ctx.userId, reason, occurredAt: now, correlationId: corr(ctx) });
  const from = r.status;
  r.status = to;
  return { from, to };
}

export async function transitionPo(tx: Tx, ctx: AuthContext, r: Rec<PoStatus> & { poNumber: string; afterTheFact?: boolean }, to: PoStatus, opts: { reason?: string | null; set?: Partial<typeof purchaseOrders.$inferInsert> } = {}) {
  assertMove("purchase_order", PO_TRANSITIONS, PO_STATUS_LABEL, r.status, to, `Purchase order ${r.poNumber}`);
  if (r.status === "approved" && to === "received" && !r.afterTheFact) throw new DomainError("state", `Purchase order ${r.poNumber} must be sent to the supplier before goods are received.`);
  const reason = reasonFor(r.status, to, opts.reason);
  const now = new Date();
  await tx.update(purchaseOrders).set({ ...(opts.set ?? {}), status: to, statusChangedAt: now, statusChangedBy: ctx.userId, updatedAt: now }).where(eq(purchaseOrders.id, r.id));
  await tx.insert(purchaseOrderStateTransitions).values({ organizationId: r.organizationId, siteId: r.siteId, purchaseOrderId: r.id, fromState: r.status, toState: to, actorId: ctx.userId, reason, occurredAt: now, correlationId: corr(ctx) });
  const from = r.status;
  r.status = to;
  return { from, to };
}

export async function transitionSr(tx: Tx, ctx: AuthContext, r: Rec<SrStatus> & { returnNumber: string }, to: SrStatus, opts: { reason?: string | null; set?: Partial<typeof supplierReturns.$inferInsert> } = {}) {
  assertMove("supplier_return", SR_TRANSITIONS, SR_STATUS_LABEL, r.status, to, `Supplier return ${r.returnNumber}`);
  const reason = reasonFor(r.status, to, opts.reason);
  const now = new Date();
  await tx.update(supplierReturns).set({ ...(opts.set ?? {}), status: to, statusChangedAt: now, statusChangedBy: ctx.userId, updatedAt: now }).where(eq(supplierReturns.id, r.id));
  await tx.insert(supplierReturnStateTransitions).values({ organizationId: r.organizationId, siteId: r.siteId, supplierReturnId: r.id, fromState: r.status, toState: to, actorId: ctx.userId, reason, occurredAt: now, correlationId: corr(ctx) });
  const from = r.status;
  r.status = to;
  return { from, to };
}

/** Insert the creation row (from_state null) of a new record's log. */
export async function logCreation(tx: Tx, ctx: AuthContext, kind: "pr" | "po" | "sr", r: { id: string; siteId: string; organizationId: string }) {
  const base = { organizationId: r.organizationId, siteId: r.siteId, fromState: null, toState: "draft", actorId: ctx.userId, occurredAt: new Date(), correlationId: corr(ctx) };
  if (kind === "pr") await tx.insert(purchaseRequestStateTransitions).values({ ...base, purchaseRequestId: r.id });
  else if (kind === "po") await tx.insert(purchaseOrderStateTransitions).values({ ...base, purchaseOrderId: r.id });
  else await tx.insert(supplierReturnStateTransitions).values({ ...base, supplierReturnId: r.id });
}

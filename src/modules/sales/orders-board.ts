import "server-only";
import { and, asc, eq, gte, inArray, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { customers, salesOrderLines, salesOrders } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { sodRequired } from "@/modules/governance";
import { allocateOrder } from "./allocation";
import { approvalProgress, canDecide } from "./crm-approvals";
import { businessDate, canSeePrices, isUuid } from "./crm-support";
import { ORDER_STATUS_LABEL, type OrderStatus, approveOrder, submitOrder } from "./orders";

/**
 * Order status board (US-4-06 AC1): one column per resting sales order state (`submitted` is passed
 * through within one transaction, so it never holds a card). Cards move only where the caller may
 * perform the step behind the move, and the server re-checks everything:
 *   draft → confirmed / pending_approval   submit (credit and approval check decides which)
 *   pending_approval → confirmed            approve (approval rules, separation of duties)
 *   confirmed → allocated                   FEFO allocation (warehouse)
 * Everything else (return with reason, cancel with reason, pick, pack, dispatch) is done on the order
 * page; the board explains why instead of moving.
 */

export const BOARD_COLUMNS: { key: OrderStatus; title: string }[] = [
  { key: "draft", title: "Draft" },
  { key: "pending_approval", title: "Pending approval" },
  { key: "confirmed", title: "Confirmed" },
  { key: "allocated", title: "Allocated" },
  { key: "picking", title: "Picking" },
  { key: "packed", title: "Packed" },
  { key: "partially_shipped", title: "Partially shipped" },
  { key: "shipped", title: "Shipped" },
  { key: "invoiced", title: "Invoiced" },
  { key: "closed", title: "Closed" },
  { key: "cancelled", title: "Cancelled" },
];

/** Finished columns show the last 30 days only. */
const FINISHED: OrderStatus[] = ["shipped", "invoiced", "closed", "cancelled"];

export type MoveVerdict = { allowed: true; label: string } | { allowed: false; reason: string };
export type OrderCard = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  customerName: string;
  requestedDeliveryOn: string | null;
  lineCount: number;
  units: string;
  value?: string;
  reasons: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
  overdue: boolean;
  moves: Record<string, MoveVerdict>;
};

export async function orderBoard(ctx: AuthContext) {
  ctx.require("sales.sales_order.view");
  ctx.requireSite(ctx.currentSiteId);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await db
    .select({ o: salesOrders, customerName: customers.name })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(salesOrders.siteId, ctx.currentSiteId), or(sql`${salesOrders.status} not in ('shipped', 'invoiced', 'closed', 'cancelled')`, gte(salesOrders.statusChangedAt, since))))
    .orderBy(asc(salesOrders.requestedDeliveryOn), asc(salesOrders.orderNumber));
  const lines = rows.length
    ? await db
        .select({ orderId: salesOrderLines.salesOrderId, qty: salesOrderLines.qtyUnits, price: salesOrderLines.unitPrice })
        .from(salesOrderLines)
        .where(inArray(salesOrderLines.salesOrderId, rows.map((r) => r.o.id)))
    : [];
  const prices = canSeePrices(ctx);
  const sod = await sodRequired(db, ctx.organizationId, "sales_order");
  const today = businessDate();
  const cards: OrderCard[] = [];
  for (const { o, customerName } of rows) {
    const ls = lines.filter((l) => l.orderId === o.id);
    const status = o.status as OrderStatus;
    const moves: Record<string, MoveVerdict> = {};
    const approval = status === "pending_approval" ? await approvalProgress(db, ctx.organizationId, { recordType: "sales_order", recordId: o.id, siteId: o.siteId, basis: (o.approvalBasis ?? {}) as Record<string, string | boolean> }) : null;
    for (const col of BOARD_COLUMNS) moves[col.key] = verdict(ctx, o, status, col.key, approval ? canDecide(ctx, "sales_order", approval.next, o.submittedAt, [o.createdBy, o.submittedBy], sod) : false);
    cards.push({
      id: o.id,
      orderNumber: o.orderNumber,
      status,
      customerName,
      requestedDeliveryOn: o.requestedDeliveryOn,
      lineCount: ls.length,
      units: ls.reduce((s, l) => s.plus(l.qty), new Decimal(0)).toString(),
      ...(prices ? { value: ls.reduce((s, l) => s.plus(new Decimal(l.qty).times(l.price)), new Decimal(0)).toFixed(2) } : {}),
      reasons: o.approvalReasons ?? [],
      warnings: o.warnings ?? [],
      overdue: !!o.requestedDeliveryOn && o.requestedDeliveryOn < today && !FINISHED.includes(status),
      moves,
    });
  }
  return {
    columns: BOARD_COLUMNS.map((c) => ({ ...c, cards: cards.filter((x) => x.status === c.key) })),
    pricesVisible: prices,
  };
}
export type OrderBoard = Awaited<ReturnType<typeof orderBoard>>;

function verdict(ctx: AuthContext, o: typeof salesOrders.$inferSelect, from: OrderStatus, to: OrderStatus, canApprove: boolean): MoveVerdict {
  if (from === to) return { allowed: false, reason: "The card is already in this column." };
  if (from === "draft" && (to === "confirmed" || to === "pending_approval")) {
    if (!ctx.canAt("sales.sales_order.submit", o.siteId)) return { allowed: false, reason: "Submitting orders needs sales permission (sales.sales_order.submit)." };
    return { allowed: true, label: "Submit: credit and approval check" };
  }
  if (from === "pending_approval" && to === "confirmed") {
    if (!canApprove) return { allowed: false, reason: "Only the approver named by the approval rule may confirm this order, and never the person who entered or submitted it." };
    return { allowed: true, label: "Approve and confirm" };
  }
  if (from === "confirmed" && to === "allocated") {
    if (!ctx.canAt("sales.allocation.post", o.siteId)) return { allowed: false, reason: "Allocation is done by the warehouse (sales.allocation.post)." };
    return { allowed: true, label: "Allocate stock (FEFO)" };
  }
  if (to === "cancelled") return { allowed: false, reason: "Cancel from the order page: a reason is required." };
  if (from === "pending_approval" && to === "draft") return { allowed: false, reason: "Return the order from its page: a reason is required." };
  return { allowed: false, reason: `${ORDER_STATUS_LABEL[from]} → ${ORDER_STATUS_LABEL[to]} is not a step you can take from the board. Picking, packing and dispatch are recorded on the order page by the warehouse.` };
}

/** Executes an allowed board move by calling the real service; returns a plain-words outcome. */
export async function moveOrderCard(ctx: AuthContext, input: { orderId: string; toColumn: string; idempotencyKey?: string | null }): Promise<{ ok: boolean; message: string }> {
  if (!isUuid(input.orderId)) throw new DomainError("not_found", "Sales order not found in your sites.");
  const [o] = await db
    .select({ status: salesOrders.status, orderNumber: salesOrders.orderNumber })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, input.orderId), eq(salesOrders.organizationId, ctx.organizationId), inArray(salesOrders.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!o) throw new DomainError("not_found", "Sales order not found in your sites.");
  const to = input.toColumn as OrderStatus;
  if (o.status === "draft" && (to === "confirmed" || to === "pending_approval")) {
    const r = await submitOrder(ctx, input.orderId, { idempotencyKey: input.idempotencyKey });
    return r.status === "confirmed"
      ? { ok: true, message: `${r.orderNumber} is confirmed (within limits).${r.warnings.length ? ` Note: ${r.warnings.map((w) => w.message).join("; ")}.` : ""}` }
      : { ok: true, message: `${r.orderNumber} needs approval: ${r.reasons.map((x) => x.message.toLowerCase()).join("; ")}.` };
  }
  if (o.status === "pending_approval" && to === "confirmed") {
    const r = await approveOrder(ctx, input.orderId, { idempotencyKey: input.idempotencyKey });
    return { ok: true, message: r.confirmed ? `${r.orderNumber} approved and confirmed.` : `Your approval of ${r.orderNumber} is recorded; the next approval step is still open.` };
  }
  if (o.status === "confirmed" && to === "allocated") {
    const r = await allocateOrder(ctx, input.orderId);
    return r.fullyAllocated ? { ok: true, message: `${r.orderNumber} fully allocated by FEFO.` } : { ok: false, message: `${r.orderNumber} partly allocated; the shortfall stays open. ${r.shortfalls.map((s) => `${s.sku}: ${s.short} pcs short`).join("; ")}.` };
  }
  throw new DomainError("state", `${o.orderNumber} cannot be moved there from the board.`);
}

import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { customers, salesOrders, shipmentStateTransitions, shipments } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { stateMachine } from "@/modules/inventory/command-kit"; // leaf module: no import cycle through the job registry
import { transitionOrder, type OrderStatus } from "./orders";

/**
 * State machines of the W3E fulfilment entities (docs/data-model.md §4, CLAUDE.md: explicit
 * machines, never free-form strings). The sales order machine itself lives in orders.ts.
 */
export const SHIPMENT_STATUSES = ["draft", "picked", "packed", "dispatched", "delivered", "returned", "cancelled", "reversed"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const shipmentMachine = stateMachine<ShipmentStatus>("shipment", {
  draft: ["picked", "cancelled"],
  picked: ["packed", "cancelled"],
  packed: ["dispatched", "cancelled"],
  dispatched: ["delivered", "reversed", "returned"],
  delivered: ["returned"],
  returned: [],
  cancelled: [],
  reversed: [],
});

export type PickStatus = "draft" | "in_progress" | "completed" | "cancelled";
export const pickMachine = stateMachine<PickStatus>("pick", {
  draft: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
});

export type PackStatus = "open" | "verified" | "closed" | "cancelled";
export const packMachine = stateMachine<PackStatus>("pack", {
  open: ["verified", "cancelled"],
  verified: ["closed", "cancelled"],
  closed: [],
  cancelled: [],
});

export type DeliveryReceiptStatus = "draft" | "issued" | "acknowledged" | "voided";
export const deliveryReceiptMachine = stateMachine<DeliveryReceiptStatus>("delivery_receipt", {
  draft: ["issued", "voided"],
  issued: ["acknowledged", "voided"],
  acknowledged: [],
  voided: [],
});

/**
 * Order and customer columns the fulfilment screens (pick, packing, shipment, DR) may read. Explicit
 * on purpose: the full rows carry money (order totals, unit prices) and credit terms, which the
 * warehouse never sees (docs/permissions-matrix.md §6, W3D masking).
 */
export const ORDER_HEADER_COLUMNS = {
  id: salesOrders.id,
  organizationId: salesOrders.organizationId,
  siteId: salesOrders.siteId,
  orderNumber: salesOrders.orderNumber,
  status: salesOrders.status,
  customerId: salesOrders.customerId,
  customerPoNumber: salesOrders.customerPoNumber,
  requestedDeliveryOn: salesOrders.requestedDeliveryOn,
  shipToText: salesOrders.shipToText,
  createdBy: salesOrders.createdBy,
};
export const CUSTOMER_HEADER_COLUMNS = {
  id: customers.id,
  code: customers.code,
  name: customers.name,
  shipToAddress: customers.shipToAddress,
  contactName: customers.contactName,
  phone: customers.phone,
};

export type ShipmentRow = typeof shipments.$inferSelect;
export type OrderRow = typeof salesOrders.$inferSelect;

/** Loads and row-locks a shipment in the caller's sites (not found otherwise: no existence leak). */
export async function lockShipment(tx: Tx, ctx: AuthContext, shipmentId: string): Promise<ShipmentRow> {
  if (!/^[0-9a-f-]{36}$/i.test(shipmentId ?? "")) throw new DomainError("not_found", "Shipment not found in your sites.");
  const [s] = await tx
    .select()
    .from(shipments)
    .where(and(eq(shipments.id, shipmentId), eq(shipments.organizationId, ctx.organizationId), inArray(shipments.siteId, ctx.allowedSiteIds)))
    .for("update")
    .limit(1);
  if (!s) throw new DomainError("not_found", "Shipment not found in your sites.");
  ctx.requireSite(s.siteId);
  return s;
}

/** Reads a shipment in the caller's sites without locking it (to find its order, which is locked first). */
export async function peekShipment(q: Tx, ctx: AuthContext, shipmentId: string): Promise<ShipmentRow> {
  if (!/^[0-9a-f-]{36}$/i.test(shipmentId ?? "")) throw new DomainError("not_found", "Shipment not found in your sites.");
  const [s] = await q
    .select()
    .from(shipments)
    .where(and(eq(shipments.id, shipmentId), eq(shipments.organizationId, ctx.organizationId), inArray(shipments.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!s) throw new DomainError("not_found", "Shipment not found in your sites.");
  ctx.requireSite(s.siteId);
  return s;
}

/** Moves a shipment through its machine and records the transition row. */
export async function transitionShipment(tx: Tx, ctx: AuthContext, s: ShipmentRow, to: ShipmentStatus, extra: Partial<typeof shipments.$inferInsert> = {}, reason?: string | null) {
  shipmentMachine.assert(s.status, to, `Shipment ${s.shipmentNumber ?? s.deliveryReceiptNumber ?? ""}`.trim());
  await tx.update(shipments).set({ ...extra, status: to }).where(eq(shipments.id, s.id));
  await tx.insert(shipmentStateTransitions).values({
    organizationId: s.organizationId,
    shipmentId: s.id,
    fromState: s.status,
    toState: to,
    actorId: ctx.userId,
    reason: reason ?? null,
    correlationId: ctx.correlationId && /^[0-9a-f-]{36}$/i.test(ctx.correlationId) ? ctx.correlationId : null,
  });
}

/**
 * Moves an order through the one sales order machine (orders.ts `ORDER_TRANSITIONS`) for the
 * fulfilment services: delegates to W3D's `transitionOrder`, which validates the move, enforces the
 * reason on undo paths and writes the `sales_order_state_transitions` row, then audits the change.
 * A move to the current state is a no-op, except a repeated partially_shipped (another partial
 * shipment), which is recorded as its own transition.
 */
export async function advanceOrder(tx: Tx, ctx: AuthContext, o: OrderRow, to: OrderStatus, reason?: string | null) {
  if (o.status === to && to !== "partially_shipped") return;
  const from = o.status;
  await transitionOrder(tx, ctx, o, to, { reason });
  await audit(tx, ctx, {
    action: "sales.sales_order.status_changed",
    entityType: "sales_order",
    entityId: o.id,
    entityNumber: o.orderNumber,
    siteId: o.siteId,
    reason: reason ?? null,
    before: { status: from },
    after: { status: to },
  });
}

/** Plain-language words for chips and messages. */
export const SHIPMENT_STATUS_WORD: Record<ShipmentStatus, string> = {
  draft: "Picking",
  picked: "Picked",
  packed: "Packed",
  dispatched: "Dispatched",
  delivered: "Delivered",
  returned: "Returned",
  cancelled: "Cancelled",
  reversed: "Reversed",
};

export const isUuid = (v: string | null | undefined) => !!v && /^[0-9a-f-]{36}$/i.test(v);

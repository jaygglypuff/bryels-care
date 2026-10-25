import "server-only";
import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { db } from "@/db/client";
import {
  customerAddresses,
  customerPortalTenants,
  deliveryReceipts,
  idempotencyKeys,
  products,
  salesOrderLines,
  salesOrderStateTransitions,
  salesOrders,
  shipments,
} from "@/db/schema";
import { systemContext } from "@/lib/auth/system";
import { DomainError } from "@/lib/errors";
import { READ_ONLY_MESSAGE, getMaintenanceState, isReadOnlyFor } from "@/lib/maintenance";
import { getSetting } from "@/lib/settings";
import { createOrderInTx, formatAddress, submitOrderInTx } from "@/modules/sales";
import { portalCatalogueInTx, unitPriceFor, type PortalCatalogItem } from "./catalog";
import type { PortalAuthContext } from "./context";
import { portalDocumentHref } from "./documents";
import { isUuid, limitPortalUser, manilaDate, portalAudit, UUID_RE } from "./support";

/**
 * Portal orders (US-8-02; docs/permissions-matrix.md §7 "Orders from the portal").
 *
 * A portal order enters the ONE internal sales-order state machine through the W3D services, in one
 * transaction: `createOrderInTx` (draft, prices from the approved price lists, never a price sent by
 * the browser) and `submitOrderInTx` (requirements snapshot, MOQ policy, credit check and the
 * `approval_rules`). It therefore ends `confirmed` only when the internal rules would confirm an
 * order entered by staff, and `pending_approval` otherwise — portal orders never bypass credit or
 * approval checks. The services run as the system actor `system:portal.order_intake` holding only
 * `sales.sales_order.create` and `.submit`; the order carries `source = 'portal'` and the portal user,
 * and `sales.sales_order.placed_in_portal` records the portal user as the actor
 * (actor_label `portal_user:<id>`, same correlation id as the W3D events).
 *
 * Reads filter on the context's customer id only. A foreign or unknown id is "not found" (404).
 * Customer-facing DTOs never carry internal notes, approval reasons, credit status, sites,
 * warehouses, lots beyond the DR, costs or staff names.
 */

/** Customer-facing status words (the internal machine has more states than a customer needs). */
export const PORTAL_ORDER_STATUS_LABEL: Record<string, string> = {
  draft: "Under review",
  submitted: "Under review",
  pending_approval: "Under review",
  confirmed: "Confirmed",
  allocated: "Being prepared",
  picking: "Being prepared",
  packed: "Being prepared",
  partially_shipped: "Partly shipped",
  shipped: "Shipped",
  invoiced: "Invoiced",
  closed: "Completed",
  cancelled: "Cancelled",
};
export const portalStatusLabel = (s: string) => PORTAL_ORDER_STATUS_LABEL[s] ?? "Under review";
/** Tone for the status chip (ok / info / warn / neu / bad). */
export function portalStatusTone(s: string): "ok" | "info" | "warn" | "neu" | "bad" {
  if (["confirmed", "shipped", "invoiced", "closed"].includes(s)) return "ok";
  if (["allocated", "picking", "packed", "partially_shipped"].includes(s)) return "info";
  if (s === "cancelled") return "bad";
  return "warn";
}

const Line = z.object({ productId: z.string().regex(UUID_RE, "Choose a product from your catalogue."), qty: z.string().trim().min(1, "Enter a quantity.") }).strict();
const PlaceSchema = z
  .object({
    lines: z.array(Line).min(1, "Add at least one product."),
    requestedDeliveryOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the delivery date you need."),
    customerPoNumber: z.string().trim().max(60, "Keep the PO number under 60 characters.").optional().nullable(),
    shipToAddressId: z.string().regex(UUID_RE).optional().nullable(),
    note: z.string().trim().max(500, "Keep the note under 500 characters.").optional().nullable(),
  })
  .strict();
export type PortalOrderInput = z.input<typeof PlaceSchema>;

export type PlacedPortalOrder = { orderId: string; orderNumber: string; status: string; statusLabel: string; replayed?: boolean };

const IDEM_COMMAND = "portal.sales_order.place";

function parseInput(raw: PortalOrderInput) {
  const r = PlaceSchema.safeParse(raw);
  if (!r.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of r.error.issues) fieldErrors[i.path.join(".") || "form"] ??= i.message;
    throw new DomainError("validation", Object.values(fieldErrors)[0] ?? "Check the order.", { fieldErrors });
  }
  return r.data;
}

/** Checks quantities and the catalogue; returns the lines W3D will price (no browser price ever travels). */
async function checkLines(ctx: PortalAuthContext, lines: { productId: string; qty: string }[], catalogue: PortalCatalogItem[]) {
  const [maxLines, maxQty] = await Promise.all([getSetting(db, ctx.organizationId, "portal.order.max_lines"), getSetting(db, ctx.organizationId, "portal.order.max_qty_per_line")]);
  if (lines.length > maxLines) throw new DomainError("validation", `An order from the portal can have at most ${maxLines} lines. Split it, or ask your sales representative.`, { field: "lines" });
  const byId = new Map(catalogue.map((c) => [c.productId, c]));
  const seen = new Set<string>();
  const fieldErrors: Record<string, string> = {};
  for (const [i, l] of lines.entries()) {
    if (seen.has(l.productId)) fieldErrors[`lines.${i}.productId`] = "This product is already in the order; change that line's quantity instead.";
    seen.add(l.productId);
    if (!byId.has(l.productId)) fieldErrors[`lines.${i}.productId`] = "This product is not in your approved catalogue.";
    let q: Decimal | null = null;
    try {
      q = new Decimal(l.qty);
    } catch {
      q = null;
    }
    if (!q || !q.isInteger() || q.lte(0)) fieldErrors[`lines.${i}.qty`] = "Whole pieces, at least 1.";
    else if (q.gt(maxQty)) fieldErrors[`lines.${i}.qty`] = `At most ${maxQty.toLocaleString("en-PH")} pieces per line from the portal.`;
  }
  if (Object.keys(fieldErrors).length) throw new DomainError("validation", Object.values(fieldErrors)[0], { fieldErrors });
  return lines.map((l) => ({ productId: l.productId, qtyUnits: new Decimal(l.qty).toString(), unitPrice: null }));
}

/**
 * Places an order for the signed-in customer (portal.order.create). Retries with the same
 * idempotency key return the first result; the key is namespaced by portal user, so no other
 * tenant's stored result can ever be returned.
 */
export async function placePortalOrder(ctx: PortalAuthContext, raw: PortalOrderInput, opts: { idempotencyKey?: string | null; now?: Date } = {}): Promise<PlacedPortalOrder> {
  ctx.require("portal.order.create");
  await limitPortalUser(ctx, opts.now);
  const input = parseInput(raw);
  const today = manilaDate(opts.now);
  if (input.requestedDeliveryOn < today) throw new DomainError("validation", "Choose today or a later date.", { field: "requestedDeliveryOn" });
  // Read-only maintenance applies to the portal too (US-2-30): the system actor holds no exempt role.
  if (isReadOnlyFor(await getMaintenanceState(db, ctx.organizationId), [])) throw new DomainError("read_only", READ_ONLY_MESSAGE, { code: "READ_ONLY_MODE" });
  const key = opts.idempotencyKey ? `portal:${ctx.portalUserId}:${String(opts.idempotencyKey).slice(0, 100)}` : null;
  const correlationId = ctx.correlationId && isUuid(ctx.correlationId) ? ctx.correlationId : uuidv7();
  const sys = await systemContext(ctx.organizationId, { code: "portal.order_intake", systemPermissions: ["sales.sales_order.create", "sales.sales_order.submit"] }, { correlationId });

  return db.transaction(async (tx) => {
    if (key) {
      const inserted = await tx.insert(idempotencyKeys).values({ organizationId: ctx.organizationId, key, command: IDEM_COMMAND }).onConflictDoNothing().returning({ id: idempotencyKeys.id });
      if (inserted.length === 0) {
        const [row] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.organizationId, ctx.organizationId), eq(idempotencyKeys.key, key))).limit(1);
        if (!row || row.command !== IDEM_COMMAND || !row.result) throw new DomainError("conflict", "This order is still being sent. Open your orders in a moment.");
        return { ...(row.result as PlacedPortalOrder), replayed: true };
      }
    }
    const [tenant] = await tx.select().from(customerPortalTenants).where(eq(customerPortalTenants.id, ctx.tenantId)).for("share").limit(1);
    if (!tenant || tenant.status !== "active" || tenant.customerId !== ctx.customerId) throw new DomainError("unauthenticated", "Portal access for your company is paused. Sign in again or contact Bryel's Care.");
    if (input.shipToAddressId) {
      const [a] = await tx.select({ id: customerAddresses.id }).from(customerAddresses).where(and(eq(customerAddresses.id, input.shipToAddressId), eq(customerAddresses.customerId, ctx.customerId), sql`${customerAddresses.deletedAt} is null`)).limit(1);
      if (!a) throw new DomainError("validation", "Choose one of your delivery addresses.", { field: "shipToAddressId" });
    }
    const catalogue = await portalCatalogueInTx(tx, ctx, today);
    const lines = await checkLines(ctx, input.lines, catalogue);
    const note = input.note?.trim();
    const order = await createOrderInTx(tx, sys, {
      customerId: ctx.customerId,
      customerPoNumber: input.customerPoNumber?.trim() || null,
      requestedDeliveryOn: input.requestedDeliveryOn,
      notes: note ? `Placed in the customer portal by ${ctx.displayName}. Customer note: ${note}` : `Placed in the customer portal by ${ctx.displayName}.`,
      shipToAddressId: input.shipToAddressId ?? null,
      lines,
      siteId: tenant.siteId,
    });
    await tx.update(salesOrders).set({ source: "portal", portalUserId: ctx.portalUserId }).where(eq(salesOrders.id, order.id));
    await portalAudit(tx, {
      organizationId: ctx.organizationId,
      actorLabel: ctx.actorLabel,
      action: "sales.sales_order.placed_in_portal",
      entityType: "sales_order",
      entityId: order.id,
      entityNumber: order.orderNumber,
      siteId: order.siteId,
      after: { source: "portal", tenantId: ctx.tenantId, lines: lines.length, requestedDeliveryOn: input.requestedDeliveryOn, customerPoNumber: order.customerPoNumber },
      correlationId,
    });
    const submitted = await submitOrderInTx(tx, sys, order.id);
    const result: PlacedPortalOrder = { orderId: order.id, orderNumber: order.orderNumber, status: submitted.status, statusLabel: portalStatusLabel(submitted.status) };
    if (key) await tx.update(idempotencyKeys).set({ result: sql`${JSON.stringify(result)}::jsonb` }).where(and(eq(idempotencyKeys.organizationId, ctx.organizationId), eq(idempotencyKeys.key, key)));
    return result;
  });
}

/* ------------------------------------------------------------------ reads */

/** Orders a customer may see: everything except internal drafts nobody submitted yet. */
const visibleToCustomer = (customerId: string, organizationId: string) =>
  and(eq(salesOrders.customerId, customerId), eq(salesOrders.organizationId, organizationId), or(ne(salesOrders.status, "draft"), eq(salesOrders.source, "portal")));

export type PortalOrderRow = {
  id: string;
  orderNumber: string;
  status: string;
  statusLabel: string;
  placedAt: Date;
  requestedDeliveryOn: string | null;
  customerPoNumber: string | null;
  totalAmount: string;
  currency: string;
  lineCount: number;
  fromPortal: boolean;
};

export async function listPortalOrders(ctx: PortalAuthContext, opts: { limit?: number } = {}): Promise<PortalOrderRow[]> {
  ctx.require("portal.order.view");
  const rows = await db
    .select({
      id: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      status: salesOrders.status,
      createdAt: salesOrders.createdAt,
      submittedAt: salesOrders.submittedAt,
      requestedDeliveryOn: salesOrders.requestedDeliveryOn,
      customerPoNumber: salesOrders.customerPoNumber,
      totalAmount: salesOrders.totalAmount,
      currency: salesOrders.currency,
      source: salesOrders.source,
      lineCount: sql<number>`(select count(*)::int from sales_order_lines l where l.sales_order_id = sales_orders.id)`,
    })
    .from(salesOrders)
    .where(visibleToCustomer(ctx.customerId, ctx.organizationId))
    .orderBy(desc(salesOrders.createdAt))
    .limit(Math.min(opts.limit ?? 200, 500));
  return rows.map((r) => ({
    id: r.id,
    orderNumber: r.orderNumber,
    status: r.status,
    statusLabel: portalStatusLabel(r.status),
    placedAt: r.submittedAt ?? r.createdAt,
    requestedDeliveryOn: r.requestedDeliveryOn,
    customerPoNumber: r.customerPoNumber,
    totalAmount: new Decimal(r.totalAmount).toFixed(2),
    currency: r.currency,
    lineCount: Number(r.lineCount),
    fromPortal: r.source === "portal",
  }));
}

export type PortalOrderDetail = Awaited<ReturnType<typeof getPortalOrder>>;

/** One order of the signed-in customer, as an allow-listed DTO; foreign ids are 404. */
export async function getPortalOrder(ctx: PortalAuthContext, orderId: string) {
  ctx.require("portal.order.view");
  if (!isUuid(orderId)) throw new DomainError("not_found", "Order not found.");
  const [o] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, orderId), visibleToCustomer(ctx.customerId, ctx.organizationId))).limit(1);
  if (!o) throw new DomainError("not_found", "Order not found.");
  const lines = await db
    .select({ lineNo: salesOrderLines.lineNo, productId: salesOrderLines.productId, sku: products.skuCode, name: products.name, qty: salesOrderLines.qtyUnits, unitPrice: salesOrderLines.unitPrice, customerItemCode: salesOrderLines.customerItemCode, uom: products.baseUom })
    .from(salesOrderLines)
    .innerJoin(products, eq(products.id, salesOrderLines.productId))
    .where(eq(salesOrderLines.salesOrderId, o.id))
    .orderBy(asc(salesOrderLines.lineNo));
  const transitions = await db
    .select({ to: salesOrderStateTransitions.toState, at: salesOrderStateTransitions.occurredAt })
    .from(salesOrderStateTransitions)
    .where(eq(salesOrderStateTransitions.salesOrderId, o.id))
    .orderBy(asc(salesOrderStateTransitions.occurredAt));
  const timeline: { label: string; at: Date }[] = [];
  for (const t of transitions) {
    const label = t.to === "draft" && timeline.length === 0 ? "Received" : portalStatusLabel(t.to);
    if (timeline[timeline.length - 1]?.label !== label) timeline.push({ label, at: t.at });
  }
  const ships = await db
    .select({ s: shipments, drId: deliveryReceipts.id, drStatus: deliveryReceipts.status })
    .from(shipments)
    .leftJoin(deliveryReceipts, and(eq(deliveryReceipts.shipmentId, shipments.id), inArray(deliveryReceipts.status, ["issued", "acknowledged"])))
    .where(and(eq(shipments.salesOrderId, o.id), inArray(shipments.status, ["dispatched", "delivered", "returned"])))
    .orderBy(asc(shipments.dispatchedAt));
  let shipTo = o.shipToText;
  if (!shipTo && o.shipToAddressId) {
    const [a] = await db.select().from(customerAddresses).where(eq(customerAddresses.id, o.shipToAddressId)).limit(1);
    shipTo = a ? formatAddress(a) : null;
  }
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    statusLabel: portalStatusLabel(o.status),
    placedAt: o.submittedAt ?? o.createdAt,
    requestedDeliveryOn: o.requestedDeliveryOn,
    customerPoNumber: o.customerPoNumber,
    shipTo,
    fromPortal: o.source === "portal",
    placedByMe: o.portalUserId === ctx.portalUserId,
    currency: o.currency,
    subtotalAmount: new Decimal(o.subtotalAmount).toFixed(2),
    taxAmount: new Decimal(o.taxAmount).toFixed(2),
    totalAmount: new Decimal(o.totalAmount).toFixed(2),
    lines: lines.map((l) => ({
      lineNo: l.lineNo,
      productId: l.productId,
      sku: l.sku,
      name: l.name,
      customerItemCode: l.customerItemCode,
      uom: l.uom,
      qty: new Decimal(l.qty).toString(),
      unitPrice: new Decimal(l.unitPrice).toFixed(2),
      lineTotal: new Decimal(l.qty).times(l.unitPrice).toFixed(2),
    })),
    timeline,
    shipments: ships.map((r) => ({
      shipmentNumber: r.s.shipmentNumber,
      deliveryReceiptNumber: r.s.deliveryReceiptNumber,
      status: r.s.status,
      dispatchedAt: r.s.dispatchedAt,
      deliveredAt: r.s.deliveredAt,
      carrier: r.s.carrier,
      trackingNumber: r.s.trackingNumber,
      documentHref: r.drId ? portalDocumentHref("delivery_receipt", r.drId) : null,
    })),
    canReorder: ctx.can("portal.order.create") && lines.length > 0,
  };
}

/**
 * "Reorder from history": the lines of an earlier order that are still in the catalogue, at today's
 * prices, to prefill a new order (nothing is created until the customer places it). Products no
 * longer offered are listed so the customer knows why they are missing.
 */
export async function reorderCart(ctx: PortalAuthContext, orderId: string, on = manilaDate()) {
  ctx.require("portal.order.create");
  const o = await getPortalOrder(ctx, orderId);
  const catalogue = await portalCatalogueInTx(db, ctx, on);
  const byId = new Map(catalogue.map((c) => [c.productId, c]));
  const lines: { productId: string; sku: string; name: string; qty: string; unitPrice: string | null }[] = [];
  const unavailable: { sku: string; name: string }[] = [];
  for (const l of o.lines) {
    const item = byId.get(l.productId);
    if (!item) unavailable.push({ sku: l.sku, name: l.name });
    else lines.push({ productId: l.productId, sku: l.sku, name: l.name, qty: l.qty, unitPrice: unitPriceFor(item, l.qty) });
  }
  return { fromOrderNumber: o.orderNumber, customerPoNumber: null as string | null, lines, unavailable };
}

/** The customer's delivery addresses (for the order form). */
export async function portalAddresses(ctx: PortalAuthContext) {
  ctx.require("portal.order.view");
  const rows = await db
    .select()
    .from(customerAddresses)
    .where(and(eq(customerAddresses.customerId, ctx.customerId), eq(customerAddresses.organizationId, ctx.organizationId), sql`${customerAddresses.deletedAt} is null`))
    .orderBy(desc(customerAddresses.isDefaultShipTo), asc(customerAddresses.label));
  return rows.map((a) => ({ id: a.id, label: a.label, text: formatAddress(a), isDefault: a.isDefaultShipTo }));
}

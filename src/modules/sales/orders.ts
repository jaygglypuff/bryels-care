import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type Tx } from "@/db/client";
import { customers, inventoryLots, locations, products, salesOrderLines, salesOrders, shipments, stockAllocations } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { D } from "@/lib/qty";

/** Sales order state machine (data-model; W09). Only these transitions are allowed. */
export const ORDER_STATUSES = ["draft", "confirmed", "allocated", "shipped", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["allocated", "cancelled"],
  allocated: ["shipped"],
  shipped: [],
  cancelled: [],
};

export function assertTransition(from: string, to: OrderStatus, orderNumber: string) {
  const allowed = TRANSITIONS[from as OrderStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new DomainError("state", `Order ${orderNumber} is ${from} and cannot be moved to ${to}.`);
  }
}

/** Loads and row-locks an order inside a transaction, enforcing site scope. */
export async function lockOrder(tx: Tx, ctx: AuthContext, orderId: string) {
  const [o] = await tx
    .select()
    .from(salesOrders)
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.organizationId, ctx.organizationId), inArray(salesOrders.siteId, ctx.allowedSiteIds)))
    .for("update")
    .limit(1);
  if (!o) throw new DomainError("not_found", "Sales order not found in your sites.");
  ctx.requireSite(o.siteId);
  return o;
}

export async function listOrders(ctx: AuthContext, status?: string) {
  ctx.require("sales.sales_order.view");
  ctx.requireSite(ctx.currentSiteId);
  const where = [eq(salesOrders.siteId, ctx.currentSiteId)];
  if (status && (ORDER_STATUSES as readonly string[]).includes(status)) where.push(eq(salesOrders.status, status));
  const orders = await db
    .select({
      id: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      status: salesOrders.status,
      customerPoNumber: salesOrders.customerPoNumber,
      requestedDeliveryOn: salesOrders.requestedDeliveryOn,
      createdAt: salesOrders.createdAt,
      customerName: customers.name,
      customerId: customers.id,
    })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(...where))
    .orderBy(desc(salesOrders.orderNumber));
  const lines = orders.length
    ? await db
        .select({ orderId: salesOrderLines.salesOrderId, sku: products.skuCode, qty: salesOrderLines.qtyUnits, price: salesOrderLines.unitPrice })
        .from(salesOrderLines)
        .innerJoin(products, eq(products.id, salesOrderLines.productId))
        .where(inArray(salesOrderLines.salesOrderId, orders.map((o) => o.id)))
        .orderBy(asc(salesOrderLines.lineNo))
    : [];
  return orders.map((o) => {
    const ls = lines.filter((l) => l.orderId === o.id);
    return {
      ...o,
      lines: ls.map((l) => ({ sku: l.sku, qty: l.qty })),
      value: ls.reduce((s, l) => s.plus(D(l.qty).times(l.price)), new Decimal(0)).toString(),
    };
  });
}

export async function orderCounts(ctx: AuthContext) {
  ctx.require("sales.sales_order.view");
  const rows = await db
    .select({ status: salesOrders.status, n: sql<number>`count(*)::int` })
    .from(salesOrders)
    .where(eq(salesOrders.siteId, ctx.currentSiteId))
    .groupBy(salesOrders.status);
  const out: Record<string, number> = { all: 0 };
  for (const r of rows) {
    out[r.status] = r.n;
    out.all += r.n;
  }
  return out;
}

export async function getOrder(ctx: AuthContext, orderId: string) {
  ctx.require("sales.sales_order.view");
  const [o] = await db
    .select({ order: salesOrders, customer: customers })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.organizationId, ctx.organizationId), inArray(salesOrders.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!o) throw new DomainError("not_found", "Sales order not found in your sites.");
  const lines = await db
    .select({ line: salesOrderLines, product: products })
    .from(salesOrderLines)
    .innerJoin(products, eq(products.id, salesOrderLines.productId))
    .where(eq(salesOrderLines.salesOrderId, o.order.id))
    .orderBy(asc(salesOrderLines.lineNo));
  const allocations = lines.length
    ? await db
        .select({
          id: stockAllocations.id,
          lineId: stockAllocations.salesOrderLineId,
          qtyUnits: stockAllocations.qtyUnits,
          lotId: inventoryLots.id,
          lotNumber: inventoryLots.lotNumber,
          expiresOn: inventoryLots.expiresOn,
          qualityStatus: inventoryLots.qualityStatus,
          locationCode: locations.code,
          locationName: locations.name,
        })
        .from(stockAllocations)
        .innerJoin(inventoryLots, eq(inventoryLots.id, stockAllocations.lotId))
        .innerJoin(locations, eq(locations.id, stockAllocations.locationId))
        .where(inArray(stockAllocations.salesOrderLineId, lines.map((l) => l.line.id)))
        .orderBy(asc(inventoryLots.expiresOn), asc(inventoryLots.lotNumber))
    : [];
  const shipmentRows = await db.select().from(shipments).where(eq(shipments.salesOrderId, o.order.id)).orderBy(desc(shipments.dispatchedAt));
  const lineViews = lines.map(({ line, product }) => {
    const allocated = allocations.filter((a) => a.lineId === line.id).reduce((s, a) => s.plus(a.qtyUnits), new Decimal(0));
    return {
      ...line,
      sku: product.skuCode,
      productName: product.name,
      unitsPerBox: product.unitsPerBox,
      value: D(line.qtyUnits).times(line.unitPrice).toString(),
      allocated: allocated.toString(),
      shortfall: Decimal.max(D(line.qtyUnits).minus(allocated), 0).toString(),
    };
  });
  return {
    order: o.order,
    customer: o.customer,
    lines: lineViews,
    allocations: allocations.map((a) => ({ ...a, sku: lineViews.find((l) => l.id === a.lineId)?.sku ?? "" })),
    shipments: shipmentRows,
    total: lineViews.reduce((s, l) => s.plus(l.value), new Decimal(0)).toString(),
  };
}

export type NewOrderInput = {
  customerId: string;
  customerPoNumber?: string | null;
  requestedDeliveryOn: string;
  notes?: string | null;
  lines: { productId: string; qtyUnits: string; unitPrice: string }[];
};

export async function createOrder(ctx: AuthContext, input: NewOrderInput) {
  ctx.require("sales.sales_order.create");
  ctx.requireSite(ctx.currentSiteId);
  if (input.lines.length === 0) throw new DomainError("validation", "Add at least one line.");
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  if (productIds.length !== input.lines.length) throw new DomainError("validation", "Each product may appear only once; combine the quantities into one line.");
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.organizationId, ctx.organizationId)))
      .limit(1);
    if (!c) throw new DomainError("validation", "Choose a customer.");
    const prods = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(inArray(products.id, productIds), eq(products.organizationId, ctx.organizationId)));
    if (prods.length !== productIds.length) throw new DomainError("validation", "One of the products was not found.");
    const orderNumber = await nextNumber(tx, ctx.organizationId, "SO");
    const [order] = await tx
      .insert(salesOrders)
      .values({
        organizationId: ctx.organizationId,
        siteId: ctx.currentSiteId,
        orderNumber,
        customerId: c.id,
        customerPoNumber: input.customerPoNumber || null,
        requestedDeliveryOn: input.requestedDeliveryOn,
        status: "draft",
        notes: input.notes || null,
        createdBy: ctx.userId,
      })
      .returning();
    const lineRows = await tx
      .insert(salesOrderLines)
      .values(
        input.lines.map((l, i) => ({
          salesOrderId: order.id,
          lineNo: i + 1,
          productId: l.productId,
          qtyUnits: D(l.qtyUnits).toString(),
          unitPrice: D(l.unitPrice).toString(),
        })),
      )
      .returning();
    await audit(tx, ctx, {
      action: "sales.sales_order.created",
      entityType: "sales_order",
      entityId: order.id,
      entityNumber: orderNumber,
      siteId: order.siteId,
      after: { ...order, lines: lineRows },
    });
    return order;
  });
}

export async function confirmOrder(ctx: AuthContext, orderId: string) {
  ctx.require("sales.sales_order.approve");
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, orderId);
    assertTransition(o.status, "confirmed", o.orderNumber);
    const [lineCount] = await tx.select({ n: sql<number>`count(*)::int` }).from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, o.id));
    if (!lineCount || lineCount.n === 0) throw new DomainError("validation", "The order has no lines.");
    await tx.update(salesOrders).set({ status: "confirmed", confirmedBy: ctx.userId }).where(eq(salesOrders.id, o.id));
    await audit(tx, ctx, {
      action: "sales.sales_order.confirmed",
      entityType: "sales_order",
      entityId: o.id,
      entityNumber: o.orderNumber,
      siteId: o.siteId,
      before: { status: o.status },
      after: { status: "confirmed" },
    });
  });
}

/** Cancels a draft or confirmed order; any allocations (reservations, not stock postings) are released. */
export async function cancelOrder(ctx: AuthContext, orderId: string, reason: string) {
  ctx.require("sales.sales_order.approve");
  if (!reason.trim()) throw new DomainError("validation", "Give a reason for cancelling.");
  return db.transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, orderId);
    assertTransition(o.status, "cancelled", o.orderNumber);
    const lineIds = (await tx.select({ id: salesOrderLines.id }).from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, o.id))).map((l) => l.id);
    const released = lineIds.length ? await tx.delete(stockAllocations).where(inArray(stockAllocations.salesOrderLineId, lineIds)).returning() : [];
    await tx.update(salesOrders).set({ status: "cancelled" }).where(eq(salesOrders.id, o.id));
    await audit(tx, ctx, {
      action: "sales.sales_order.cancelled",
      entityType: "sales_order",
      entityId: o.id,
      entityNumber: o.orderNumber,
      siteId: o.siteId,
      reason,
      before: { status: o.status, allocations: released },
      after: { status: "cancelled" },
    });
  });
}

/** Order history of one customer across the user's sites. */
export async function listCustomerOrders(ctx: AuthContext, customerId: string) {
  ctx.require("sales.sales_order.view");
  const orders = await db
    .select({
      id: salesOrders.id,
      orderNumber: salesOrders.orderNumber,
      status: salesOrders.status,
      customerPoNumber: salesOrders.customerPoNumber,
      requestedDeliveryOn: salesOrders.requestedDeliveryOn,
      createdAt: salesOrders.createdAt,
      siteId: salesOrders.siteId,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.customerId, customerId), eq(salesOrders.organizationId, ctx.organizationId), inArray(salesOrders.siteId, ctx.allowedSiteIds)))
    .orderBy(desc(salesOrders.orderNumber));
  const lines = orders.length
    ? await db
        .select({ orderId: salesOrderLines.salesOrderId, qty: salesOrderLines.qtyUnits, price: salesOrderLines.unitPrice })
        .from(salesOrderLines)
        .where(inArray(salesOrderLines.salesOrderId, orders.map((o) => o.id)))
    : [];
  return orders.map((o) => ({
    ...o,
    value: lines.filter((l) => l.orderId === o.id).reduce((s, l) => s.plus(D(l.qty).times(l.price)), new Decimal(0)).toString(),
  }));
}

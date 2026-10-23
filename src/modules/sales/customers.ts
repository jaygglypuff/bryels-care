import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { customers, salesOrders, shipments } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";

export type CustomerInput = {
  code: string;
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  shipToAddress: string;
  minShelfLifeDays: number;
};

/** Customers are organization-level; order counts only include orders in the user's sites. */
export async function listCustomers(ctx: AuthContext) {
  ctx.require("masterdata.customer.view");
  const stats = db
    .select({
      customerId: salesOrders.customerId,
      orders: sql<number>`count(*)::int`.as("orders"),
      lastOrderAt: sql<Date | null>`max(${salesOrders.createdAt})`.as("last_order_at"),
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.organizationId, ctx.organizationId), inArray(salesOrders.siteId, ctx.allowedSiteIds)))
    .groupBy(salesOrders.customerId)
    .as("stats");
  return db
    .select({
      id: customers.id,
      code: customers.code,
      name: customers.name,
      contactName: customers.contactName,
      phone: customers.phone,
      email: customers.email,
      shipToAddress: customers.shipToAddress,
      minShelfLifeDays: customers.minShelfLifeDays,
      orders: sql<number>`coalesce(${stats.orders}, 0)`,
      lastOrderAt: stats.lastOrderAt,
    })
    .from(customers)
    .leftJoin(stats, eq(stats.customerId, customers.id))
    .where(eq(customers.organizationId, ctx.organizationId))
    .orderBy(customers.code);
}

/** Minimal customer list for order entry (requires order-create, not customer-view). */
export async function customerOptions(ctx: AuthContext) {
  ctx.require("sales.sales_order.create");
  return db
    .select({ id: customers.id, code: customers.code, name: customers.name, shipToAddress: customers.shipToAddress, minShelfLifeDays: customers.minShelfLifeDays })
    .from(customers)
    .where(eq(customers.organizationId, ctx.organizationId))
    .orderBy(customers.name);
}

export async function getCustomer(ctx: AuthContext, id: string) {
  ctx.require("masterdata.customer.view");
  const [c] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.organizationId, ctx.organizationId)))
    .limit(1);
  if (!c) throw new DomainError("not_found", "Customer not found.");
  const shipmentRows = ctx.can("sales.shipment.view")
    ? await db
        .select({
          id: shipments.id,
          deliveryReceiptNumber: shipments.deliveryReceiptNumber,
          orderId: salesOrders.id,
          orderNumber: salesOrders.orderNumber,
          carrier: shipments.carrier,
          dispatchedAt: shipments.dispatchedAt,
          deliveredAt: shipments.deliveredAt,
          receivedByName: shipments.receivedByName,
        })
        .from(shipments)
        .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
        .where(and(eq(salesOrders.customerId, c.id), inArray(shipments.siteId, ctx.allowedSiteIds)))
        .orderBy(desc(shipments.dispatchedAt))
    : [];
  return { customer: c, shipments: shipmentRows };
}

/** Suggests the next free CUS-nnn code (the user may change it). */
export async function suggestCustomerCode(ctx: AuthContext): Promise<string> {
  const rows = await db.select({ code: customers.code }).from(customers).where(eq(customers.organizationId, ctx.organizationId));
  let max = 0;
  for (const r of rows) {
    const m = /^CUS-(\d+)$/.exec(r.code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `CUS-${String(max + 1).padStart(3, "0")}`;
}

export async function createCustomer(ctx: AuthContext, input: CustomerInput) {
  ctx.require("masterdata.customer.create");
  return db.transaction(async (tx) => {
    const [dup] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.organizationId, ctx.organizationId), eq(customers.code, input.code)))
      .limit(1);
    if (dup) throw new DomainError("conflict", `Customer code ${input.code} is already used.`);
    const [row] = await tx
      .insert(customers)
      .values({
        organizationId: ctx.organizationId,
        code: input.code,
        name: input.name,
        contactName: input.contactName || null,
        phone: input.phone || null,
        email: input.email || null,
        shipToAddress: input.shipToAddress,
        minShelfLifeDays: input.minShelfLifeDays,
      })
      .returning();
    await audit(tx, ctx, { action: "masterdata.customer.created", entityType: "customer", entityId: row.id, entityNumber: row.code, after: row });
    return row;
  });
}

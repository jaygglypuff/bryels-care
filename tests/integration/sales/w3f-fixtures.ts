import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { customers, products, settings } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { allocateOrder, confirmOrder, createOrder, manilaToday, shippedLotsOf } from "@/modules/sales";
import { asUser, type Kit } from "../../support/kit";
import { shipOrder } from "../../support/w3e";

/** W3F fixtures (fictional data): real orders shipped through the sales services, so the ledger carries the shipment. */
export async function customerByCode(code: string) {
  const [c] = await db.select().from(customers).where(eq(customers.code, code));
  return c;
}

export async function productBySku(sku: string) {
  const [p] = await db.select().from(products).where(eq(products.skuCode, sku));
  return p;
}

export async function salesAndWarehouse(kit: Kit) {
  const sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd, kit.rvs]);
  const warehouse = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  // W3E: the pack checker must not be the picker.
  const checker = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  return { sales, warehouse, checker };
}

/**
 * Creates, confirms and allocates an order of `qty` units of `sku` to the customer from NFD and ships
 * it through W3E's pick → pack verification → dispatch (the checker is a site manager, ≠ picker).
 */
export async function shipToCustomer(sales: AuthContext, warehouse: AuthContext, customerCode: string, lines: { sku: string; qty: string }[], checker?: AuthContext) {
  const c = await customerByCode(customerCode);
  const ls = [];
  for (const l of lines) ls.push({ productId: (await productBySku(l.sku)).id, qtyUnits: l.qty, unitPrice: "70" });
  const d = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const o = await createOrder(sales, { customerId: c.id, requestedDeliveryOn: d < manilaToday() ? manilaToday() : d, lines: ls });
  await confirmOrder(sales, o.id);
  await allocateOrder(warehouse, o.id);
  const check = checker ?? (await asUser({ orgId: sales.organizationId, nfd: warehouse.allowedSites[0] } as unknown as Kit, "manager.nfd@bryels-care.test", "site_manager", [warehouse.allowedSites[0]]));
  const shipment = await shipOrder({ picker: warehouse, checker: check, dispatcher: warehouse }, o.id);
  const lots = await shippedLotsOf(db, shipment.id);
  return { orderId: o.id, shipment, lots, customer: c };
}

export async function setOrgSetting(orgId: string, key: string, value: unknown) {
  await db.delete(settings).where(and(eq(settings.organizationId, orgId), eq(settings.key, key)));
  await db.insert(settings).values({ organizationId: orgId, scope: "organization", key, value: value as object });
}

export async function clearOrgSetting(orgId: string, key: string) {
  await db.delete(settings).where(and(eq(settings.organizationId, orgId), eq(settings.key, key)));
}

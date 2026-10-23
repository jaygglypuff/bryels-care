import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditEvents,
  customers,
  inventoryBalances,
  inventoryLots,
  locations,
  organizations,
  products,
  salesOrders,
  shipments,
  sites,
  stockAllocations,
  stockMovements,
  users,
} from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { allocateOrder, cancelOrder, confirmOrder, createOrder, dispatchOrder, getOrder, manilaToday, recordDelivery } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";

let orgId: string;
let nfd: SiteRef;
let rvs: SiteRef;
let sales: AuthContext;
let warehouse: AuthContext;
let warehouseRvs: AuthContext;

async function ctxFor(email: string, perms: readonly string[], siteList: SiteRef[]) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return new AuthContext(u.id, orgId, u.displayName, u.email, ["test"], new Set(perms), siteList, siteList[0].id);
}
async function product(sku: string) {
  const [p] = await db.select().from(products).where(eq(products.skuCode, sku));
  return p;
}
async function customer(code: string) {
  const [c] = await db.select().from(customers).where(eq(customers.code, code));
  return c;
}
async function releasedLot(sku: string) {
  const p = await product(sku);
  const [l] = await db
    .select()
    .from(inventoryLots)
    .where(and(eq(inventoryLots.productId, p.id), eq(inventoryLots.siteId, nfd.id), eq(inventoryLots.qualityStatus, "released")));
  return l;
}
async function fg01() {
  const [l] = await db.select().from(locations).where(and(eq(locations.siteId, nfd.id), eq(locations.code, "FG-01")));
  return l;
}
async function onHand(lotId: string, locationId: string) {
  const [b] = await db.select().from(inventoryBalances).where(and(eq(inventoryBalances.lotId, lotId), eq(inventoryBalances.locationId, locationId)));
  return Number(b?.qtyBase ?? 0);
}
async function orderByNumberSuffix(suffix: string) {
  const rows = await db.select().from(salesOrders);
  return rows.find((o) => o.orderNumber.endsWith(suffix))!;
}
const deliveryDate = () => {
  const d = new Date(Date.now() + 7 * 86_400_000);
  return d.toISOString().slice(0, 10) < manilaToday() ? manilaToday() : d.toISOString().slice(0, 10);
};
async function newConfirmedOrder(customerCode: string, sku: string, qty: string) {
  const c = await customer(customerCode);
  const p = await product(sku);
  const o = await createOrder(sales, { customerId: c.id, requestedDeliveryOn: deliveryDate(), lines: [{ productId: p.id, qtyUnits: qty, unitPrice: "70" }] });
  await confirmOrder(sales, o.id);
  return o;
}

beforeAll(async () => {
  await resetTestDatabase();
  const [org] = await db.select().from(organizations);
  orgId = org.id;
  const all = await db.select({ id: sites.id, code: sites.code, name: sites.name }).from(sites);
  nfd = all.find((s) => s.code === "NFD")!;
  rvs = all.find((s) => s.code === "RVS")!;
  sales = await ctxFor("sales@bryels-care.test", ROLE_BUNDLES.sales_cs.permissions, [nfd, rvs]);
  warehouse = await ctxFor("warehouse.nfd@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [nfd]);
  warehouseRvs = await ctxFor("warehouse.rvs@bryels-care.test", ROLE_BUNDLES.warehouse_operator.permissions, [rvs]);
});

describe("sales order → FEFO allocation → dispatch (W09)", () => {
  it("creates a draft order with an SO number and an audit event", async () => {
    const c = await customer("CUS-003");
    const p = await product("ACS-135");
    const o = await createOrder(sales, { customerId: c.id, requestedDeliveryOn: deliveryDate(), lines: [{ productId: p.id, qtyUnits: "24", unitPrice: "72.50" }] });
    expect(o.orderNumber).toMatch(/^SO-\d{2}-\d{5}$/);
    expect(o.status).toBe("draft");
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, o.id), eq(auditEvents.action, "sales.sales_order.created")));
    expect(ev).toHaveLength(1);
    const view = await getOrder(sales, o.id);
    expect(view.total).toBe("1740");
  });

  it("refuses allocation without sales.allocation.post (role escalation)", async () => {
    const so2 = await orderByNumberSuffix("00002");
    await expect(allocateOrder(sales, so2.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("hides another site's order from a user without that site (cross-site)", async () => {
    const so2 = await orderByNumberSuffix("00002");
    await expect(getOrder(warehouseRvs, so2.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(allocateOrder(warehouseRvs, so2.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(dispatchOrder(warehouseRvs, so2.id, { carrier: "x", driverName: "x", vehiclePlate: "XX 1", packageCount: 1 })).rejects.toMatchObject({ code: "not_found" });
  });

  it("allocates SO-…-00002 by FEFO from released stock only and moves it to allocated", async () => {
    const so2 = await orderByNumberSuffix("00002");
    const r = await allocateOrder(warehouse, so2.id);
    expect(r.fullyAllocated).toBe(true);
    const acs = await releasedLot("ACS-135");
    const gbs = await releasedLot("GBS-135");
    const view = await getOrder(warehouse, so2.id);
    expect(view.order.status).toBe("allocated");
    expect(view.allocations.map((a) => [a.lotNumber, Number(a.qtyUnits)]).sort()).toEqual([[acs.lotNumber, 48], [gbs.lotNumber, 48]].sort());
    // quarantined lots are never allocated
    for (const a of view.allocations) expect(a.qualityStatus).toBe("released");
  });

  it("does not allocate stock already reserved by another open order; partial allocation keeps the order confirmed", async () => {
    const acs = await releasedLot("ACS-135");
    const loc = await fg01();
    const free = (await onHand(acs.id, loc.id)) - 48; // SO-2 holds 48
    const o = await newConfirmedOrder("CUS-002", "ACS-135", String(free + 10));
    const r = await allocateOrder(warehouse, o.id);
    expect(r.fullyAllocated).toBe(false);
    expect(r.shortfalls).toEqual([{ sku: "ACS-135", ordered: String(free + 10), short: "10" }]);
    const view = await getOrder(warehouse, o.id);
    expect(view.order.status).toBe("confirmed");
    expect(view.allocations.reduce((s, a) => s + Number(a.qtyUnits), 0)).toBe(free);
    // nothing left: a second attempt allocates nothing and fails with a clear message, writing nothing
    await expect(allocateOrder(warehouse, o.id)).rejects.toMatchObject({ code: "insufficient_stock" });
    // cancelling releases the reservation
    await cancelOrder(sales, o.id, "test");
    expect((await getOrder(sales, o.id)).allocations).toHaveLength(0);
  });

  it("skips lots below the customer's minimum remaining shelf life", async () => {
    const [c] = await db
      .insert(customers)
      .values({ organizationId: orgId, code: "CUS-T01", name: "Fussy Test Buyer", shipToAddress: "Test address", minShelfLifeDays: 3000 })
      .returning();
    const o = await newConfirmedOrder(c.code, "GBS-135", "5");
    const err = await allocateOrder(warehouse, o.id).catch((e) => e);
    expect(err).toMatchObject({ code: "insufficient_stock" });
    expect(String(err.message)).toMatch(/minimum shelf life of 3000 days/);
    expect(await db.select().from(stockAllocations).where(eq(stockAllocations.salesOrderLineId, (await getOrder(sales, o.id)).lines[0].id))).toHaveLength(0);
  });

  it("blocks dispatch when an allocated lot was put on hold, posting nothing", async () => {
    const so2 = await orderByNumberSuffix("00002");
    const gbs = await releasedLot("GBS-135");
    const loc = await fg01();
    const before = await onHand(gbs.id, loc.id);
    await db.update(inventoryLots).set({ qualityStatus: "on_hold" }).where(eq(inventoryLots.id, gbs.id));
    await expect(dispatchOrder(warehouse, so2.id, { carrier: "Own truck", driverName: "T", vehiclePlate: "ABC 123", packageCount: 2 })).rejects.toMatchObject({ code: "blocked_lot" });
    expect(await onHand(gbs.id, loc.id)).toBe(before);
    expect(await db.select().from(shipments).where(eq(shipments.salesOrderId, so2.id))).toHaveLength(0);
    await db.update(inventoryLots).set({ qualityStatus: "released" }).where(eq(inventoryLots.id, gbs.id));
  });

  it("dispatch issues exactly the allocated quantities, numbers a DR and ships the order once", async () => {
    const so2 = await orderByNumberSuffix("00002");
    const acs = await releasedLot("ACS-135");
    const gbs = await releasedLot("GBS-135");
    const loc = await fg01();
    const [a0, g0] = [await onHand(acs.id, loc.id), await onHand(gbs.id, loc.id)];
    const s = await dispatchOrder(warehouse, so2.id, { carrier: "Own truck", driverName: "Jun", vehiclePlate: "NFD 2468", packageCount: 2 });
    expect(s.deliveryReceiptNumber).toMatch(/^DR-\d{2}-\d{5}$/);
    expect(await onHand(acs.id, loc.id)).toBe(a0 - 48);
    expect(await onHand(gbs.id, loc.id)).toBe(g0 - 48);
    const mv = await db.select().from(stockMovements).where(eq(stockMovements.sourceDocumentId, s.id));
    expect(mv.map((m) => [m.movementType, Number(m.qtyBase), m.toLocationId])).toEqual([
      ["shipment", 48, null],
      ["shipment", 48, null],
    ]);
    expect((await getOrder(warehouse, so2.id)).order.status).toBe("shipped");
    await expect(dispatchOrder(warehouse, so2.id, { carrier: "Own truck", driverName: "Jun", vehiclePlate: "NFD 2468", packageCount: 2 })).rejects.toMatchObject({ code: "state" });
    expect(await onHand(acs.id, loc.id)).toBe(a0 - 48);

    await recordDelivery(warehouse, s.id, { receivedByName: "Marco Tan", deliveredAt: new Date() });
    await expect(recordDelivery(warehouse, s.id, { receivedByName: "Again", deliveredAt: new Date() })).rejects.toMatchObject({ code: "state" });
  });

  it("serializes concurrent allocations so the same stock is never reserved twice", async () => {
    const acs = await releasedLot("ACS-135");
    const free = await onHand(acs.id, (await fg01()).id);
    const a = await newConfirmedOrder("CUS-002", "ACS-135", String(free));
    const b = await newConfirmedOrder("CUS-003", "ACS-135", String(free));
    await Promise.allSettled([allocateOrder(warehouse, a.id), allocateOrder(warehouse, b.id)]);
    const total = [...(await getOrder(warehouse, a.id)).allocations, ...(await getOrder(warehouse, b.id)).allocations].reduce((s, x) => s + Number(x.qtyUnits), 0);
    expect(total).toBe(free);
  });

  it("only draft or confirmed orders can be confirmed/cancelled (state machine)", async () => {
    const so2 = await orderByNumberSuffix("00002");
    await expect(confirmOrder(sales, so2.id)).rejects.toMatchObject({ code: "state" });
    await expect(cancelOrder(sales, so2.id, "too late")).rejects.toMatchObject({ code: "state" });
  });
});

/**
 * ADR-110 C2 + C4 (end-to-end walk P7): one definition of free stock and "Make for this order" visible to sales.
 * - C2: released stock in the shipping area (or the QA cage) is NOT free; the shortage card and set-aside agree.
 * - C4: sales sees the shortage and can only ask ("Ask the planner to make N": one message per planner, deduped);
 *   the planner sees "Customer orders short" and makes the production order pre-filled and linked to the order.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { customers, inventoryLots, notifications, workOrders } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { postMovement } from "@/modules/inventory";
import { askPlannerToMake, createProductionOrder, customerOrdersShort, getProductionOrder, makeForSalesLine, salesOrderShortfalls } from "@/modules/production";
import { allocateOrder, confirmOrder, createOrder, manilaToday } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, type Kit } from "../../support/kit";
import { makeExecutionFixture } from "../../support/w2b";

let kit: Kit;
let sales: AuthContext;
let salesRvs: AuthContext;
let planner: AuthContext;
let wh: AuthContext;
let mgr: AuthContext;
let productId: string;
let orderId: string;
let lineId: string;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd]);
  salesRvs = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.rvs]);
  planner = await asUser(kit, "planner.nfd@bryels-care.test", "production_planner", [kit.nfd]);
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  mgr = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  const fx = await makeExecutionFixture(kit, [{ name: "Mix", kind: "process" }, { name: "Wrap and box", kind: "packaging" }]);
  productId = fx.product.id;
  // 122 released on the shelf, 6,000 released in the sending-out bay (as the old demo month left it), 100 in the QA cage.
  for (const [code, qty, status] of [["FG-01", "122", "released"], ["SHP", "6000", "released"], ["QUA-01", "100", "quarantine"]] as const) {
    const [l] = await db.insert(inventoryLots).values({ organizationId: kit.orgId, siteId: kit.nfd.id, lotNumber: `L-C2-${code}-${Date.now().toString(36).toUpperCase()}`, itemKind: "product", productId, expiresOn: "2029-12-31", manufacturedOn: manilaToday(), qualityStatus: status, baseUom: "pcs" }).returning();
    await db.transaction(async (tx) => postMovement(tx, mgr, { movementType: "receipt", lotId: l.id, toLocationId: (await loc(kit.nfd.id, code)).id, qtyBase: qty, sourceDocumentType: "test_fixture" }));
  }
  const [c] = await db.select().from(customers).where(eq(customers.code, "CUS-002"));
  const o = await createOrder(sales, { customerId: c.id, requestedDeliveryOn: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10), lines: [{ productId, qtyUnits: "500", unitPrice: "70" }] });
  await confirmOrder(sales, o.id);
  orderId = o.id;
}, 180_000);

describe("C2 one definition of free stock", () => {
  it("free stock counts only released stock on storage shelves (not the sending-out bay or the QA cage)", async () => {
    const [l] = await salesOrderShortfalls(planner, orderId);
    lineId = l.salesOrderLineId;
    expect(l.freeStock).toBe("122");
    expect(l.missing).toBe("378");
  });

  it("set-aside agrees: after setting aside 122 the order is 378 short and the card still says 378", async () => {
    const r = await allocateOrder(wh, orderId);
    expect(r.fullyAllocated).toBe(false);
    expect(r.shortfalls[0].short).toBe("378");
    const [l] = await salesOrderShortfalls(sales, orderId);
    expect(l.allocated).toBe("122");
    expect(l.freeStock).toBe("0");
    expect(l.missing).toBe("378");
  });
});

describe("C4 Make for this order, visible to sales", () => {
  it("sales sees the shortage card but cannot make the production order", async () => {
    expect((await salesOrderShortfalls(sales, orderId))[0].missing).toBe("378");
    await expectCode(makeForSalesLine(sales, lineId), "forbidden");
    await expectCode(createProductionOrder(sales, { productId, plannedStart: manilaToday(), quantityUnits: "378", salesOrderId: orderId }), "forbidden");
    await expectCode(salesOrderShortfalls(salesRvs, orderId), "not_found");
  });

  it("Ask the planner to make 378: one message per planner (deduped), audited; other sites and roles refused", async () => {
    await expectCode(askPlannerToMake(salesRvs, lineId), "not_found");
    await expectCode(askPlannerToMake(wh, lineId), "forbidden");
    const r = await askPlannerToMake(sales, lineId);
    expect(r.told).toBeGreaterThan(0);
    const msgs = await db.select().from(notifications).where(and(eq(notifications.recipientUserId, planner.userId), like(notifications.dedupeKey, `make-for:${lineId}:%`)));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].title).toMatch(/make 378/);
    expect(msgs[0].link).toBe(`/production/orders/new?salesOrderLine=${lineId}`);
    const again = await askPlannerToMake(sales, lineId);
    expect(again.told).toBe(0);
    expect(again.alreadyAsked).toBe(true);
  });

  it("the planner's Home lists the order as short (asked), and the new production order keeps the link", async () => {
    const short = await customerOrdersShort(planner);
    const line = short.find((x) => x.salesOrderLineId === lineId)!;
    expect(line.missing).toBe("378");
    expect(line.asked).toBe(true);
    expect(line.customerName).toBeTruthy();
    await expectCode(customerOrdersShort(sales), "forbidden");
    const pre = await makeForSalesLine(planner, lineId);
    expect(pre).toMatchObject({ salesOrderId: orderId, missing: "378", productId });
    const wo = await createProductionOrder(planner, { productId: pre.productId, plannedStart: manilaToday(), quantityUnits: pre.missing, salesOrderId: pre.salesOrderId });
    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, wo.workOrderId));
    expect(row.salesOrderId).toBe(orderId);
    const view = await getProductionOrder(planner, wo.workOrderId);
    expect(JSON.stringify(view)).toContain("customerName");
    // Once a production order covers it, the order is no longer short.
    expect((await customerOrdersShort(planner)).some((x) => x.salesOrderLineId === lineId)).toBe(false);
  });
});

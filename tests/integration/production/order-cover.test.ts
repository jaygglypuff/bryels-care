/**
 * Live check 2026-11-06 finding 1: no false "needs making". The one order-cover rule (production
 * order-cover-rule.ts) counts stock that is coming — batches waiting for the QA check and batches of approved
 * production orders not promised to another order — and the three screens agree: How work flows (stages 7 and 8),
 * the planner's Home (customerOrdersShort) and the order's shortage card (salesOrderShortfalls).
 * Cross-site and role negatives.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { batches, customers, inventoryLots } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { getWorkFlowItems } from "@/modules/analytics";
import { postMovement } from "@/modules/inventory";
import { approveProductionOrder, createProductionOrder, customerOrdersShort, salesOrderShortfalls } from "@/modules/production";
import { confirmOrder, createOrder, manilaToday } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, type Kit } from "../../support/kit";
import { makeExecutionFixture } from "../../support/w2b";

let kit: Kit;
let sales: AuthContext;
let salesRvs: AuthContext;
let planner: AuthContext;
let plannerRvs: AuthContext;
let mgr: AuthContext;
let owner: AuthContext;
let finance: AuthContext;
let productId: string;
let orderA: string;
let orderB: string;

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const line = async (ctx: AuthContext, orderId: string) => (await salesOrderShortfalls(ctx, orderId))[0];
const ids = async (ctx: AuthContext, key: "so_short" | "so_coming" | "short_no_wo") => (await getWorkFlowItems(ctx, key)).items.map((i) => i.id);

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd]);
  salesRvs = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.rvs]);
  planner = await asUser(kit, "planner.nfd@bryels-care.test", "production_planner", [kit.nfd]);
  plannerRvs = await asUser(kit, "planner.nfd@bryels-care.test", "production_planner", [kit.rvs]);
  mgr = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  finance = await asUser(kit, "finance@bryels-care.test", "finance", [kit.nfd]);
  // 100 g a piece, 1,500 g a batch at 100 % → 15 pieces a batch. No stock of it anywhere.
  productId = (await makeExecutionFixture(kit, [{ name: "Mix", kind: "process" }, { name: "Wrap and box", kind: "packaging" }])).product.id;
  const [c] = await db.select().from(customers).where(eq(customers.code, "CUS-002"));
  const mk = async (qty: string, inDays: number) => {
    const o = await createOrder(sales, { customerId: c.id, requestedDeliveryOn: day(inDays), lines: [{ productId, qtyUnits: qty, unitPrice: "70" }] });
    await confirmOrder(sales, o.id);
    return o.id;
  };
  orderA = await mk("48", 10);
  orderB = await mk("20", 20);
}, 240_000);

describe("finding 1: stock coming is not 'needs making'", () => {
  it("with nothing free and nothing coming, the order is short everywhere", async () => {
    expect((await line(planner, orderA)).missing).toBe("48");
    expect((await customerOrdersShort(planner, { limit: 50 })).some((l) => l.salesOrderId === orderA)).toBe(true);
    expect(await ids(owner, "so_short")).toContain(orderA);
    expect(await ids(owner, "short_no_wo")).toContain(orderA);
  });

  it("an approved production order for stock (30 being made) and a batch waiting for QA (14 in the QA area) count as coming", async () => {
    const wo = await createProductionOrder(planner, { productId, plannedStart: manilaToday(), quantityUnits: "30", idempotencyKey: `oc-wo1-${Date.now()}` });
    await approveProductionOrder(mgr, wo.workOrderId, { idempotencyKey: `oc-ap1-${Date.now()}` });
    let l = await line(sales, orderA);
    expect(l.alreadyInProduction).toBe("30");
    expect(l.comingText).toBe("coming: 30 being made");
    expect(l.missing).toBe("18");
    // Fixture: one batch of it finished and waits for the QA check with 14 pieces in the QA waiting area.
    const [b] = await db.select().from(batches).where(eq(batches.workOrderId, wo.workOrderId)).limit(1);
    const [lot] = await db.insert(inventoryLots).values({ organizationId: kit.orgId, siteId: kit.nfd.id, lotNumber: `L-OC-${Date.now().toString(36).toUpperCase()}`, itemKind: "product", productId, expiresOn: "2029-12-31", manufacturedOn: manilaToday(), qualityStatus: "quarantine", baseUom: "pcs" }).returning();
    await db.transaction(async (tx) => postMovement(tx, mgr, { movementType: "receipt", lotId: lot.id, toLocationId: (await loc(kit.nfd.id, "QUA-01")).id, qtyBase: "14", sourceDocumentType: "test_fixture" }));
    await db.update(batches).set({ status: "awaiting_qc", outputLotId: lot.id, actualUnits: "15" }).where(eq(batches.id, b.id));
    l = await line(sales, orderA);
    expect(l.comingText).toBe("coming: 14 waiting for QA, 15 being made");
    expect(l.missing).toBe("19");
  });

  it("a production order made for another order is never counted for this one; the other order is 'coming', not short", async () => {
    const wo = await createProductionOrder(planner, { productId, plannedStart: manilaToday(), quantityUnits: "20", salesOrderId: orderB, idempotencyKey: `oc-wo2-${Date.now()}` });
    await approveProductionOrder(mgr, wo.workOrderId, { idempotencyKey: `oc-ap2-${Date.now()}` });
    expect((await line(planner, orderA)).missing).toBe("19");
    const b = await line(planner, orderB);
    expect(b.missing).toBe("0");
    expect(b.comingText).toMatch(/^coming: /);
    expect(await ids(owner, "so_coming")).toContain(orderB);
    expect(await ids(owner, "so_short")).not.toContain(orderB);
    expect((await customerOrdersShort(planner, { limit: 50 })).some((x) => x.salesOrderId === orderB)).toBe(false);
  });

  it("a production order made for the order covers the rest: all three screens say coming, none says short", async () => {
    const wo = await createProductionOrder(planner, { productId, plannedStart: manilaToday(), quantityUnits: "19", salesOrderId: orderA, idempotencyKey: `oc-wo3-${Date.now()}` });
    expect(wo.workOrderId).toBeTruthy();
    const l = await line(sales, orderA);
    expect(l.missing).toBe("0");
    expect(l.comingText).toBe("coming: 14 waiting for QA, 15 being made, 19 in a production order waiting for approval");
    expect((await customerOrdersShort(planner, { limit: 50 })).some((x) => x.salesOrderId === orderA)).toBe(false);
    expect(await ids(owner, "so_short")).not.toContain(orderA);
    expect(await ids(owner, "short_no_wo")).not.toContain(orderA);
    const item = (await getWorkFlowItems(owner, "so_coming")).items.find((i) => i.id === orderA)!;
    expect(item.label).toContain("coming: 14 waiting for QA");
    expect(item.told).toBe(true); // never red: nobody has to act
  });
});

describe("finding 1: negatives (site and role)", () => {
  it("another site's people see nothing of these orders", async () => {
    await expectCode(salesOrderShortfalls(salesRvs, orderA), "not_found");
    expect((await customerOrdersShort(plannerRvs, { limit: 50 })).some((x) => x.salesOrderId === orderA)).toBe(false);
    const ownerAtRvs = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.rvs, kit.nfd]);
    expect(await ids(ownerAtRvs, "so_coming")).not.toContain(orderA);
  });

  it("roles: sales may not open the planner list; finance (no production view) may not see the 'coming' list", async () => {
    await expectCode(customerOrdersShort(sales), "forbidden");
    await expectCode(getWorkFlowItems(finance, "so_coming"), "forbidden");
  });
});

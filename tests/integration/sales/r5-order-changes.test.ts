/**
 * Round 5 office fixes, customer orders (docs/ux-audit/round5/C-office.md problems 1 and 3; owner decision on credit
 * for customers with no limit). ADR-131.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, customers, inventoryLots, products, salesOrderLines, salesOrders, stockAllocations } from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import { postMovement } from "@/modules/inventory";
import { orderCanShipFrom } from "@/modules/production";
import { allocateOrder, cancelOrderLine, changeOrderLine, confirmOrder, createCustomer, createOrder, manilaToday, submitOrder } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, type Kit } from "../../support/kit";
import { key, shipOrder } from "../../support/w3e";
import { setOrgSetting } from "../production/w2a-fixtures";

let kit: Kit;
let sales: AuthContext;
let salesRvs: AuthContext;
let wh: AuthContext;
let mgr: AuthContext;
let qa: AuthContext;
let productId: string;
let product2: string;

const deliveryDate = () => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const customerId = async (code: string) => (await db.select().from(customers).where(eq(customers.code, code)))[0].id;
const orderRow = async (id: string) => (await db.select().from(salesOrders).where(eq(salesOrders.id, id)))[0];
const linesOf = async (id: string) => db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id)).orderBy(salesOrderLines.lineNo);

async function twoLineOrder(q1 = "40", q2 = "10") {
  const o = await createOrder(sales, { customerId: await customerId("CUS-002"), requestedDeliveryOn: deliveryDate(), lines: [{ productId, qtyUnits: q1, unitPrice: "70" }, { productId: product2, qtyUnits: q2, unitPrice: "50" }] });
  await confirmOrder(sales, o.id);
  return o.id;
}

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd, kit.rvs]);
  salesRvs = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.rvs]);
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  mgr = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd]);
  const [p] = await db.insert(products).values({ organizationId: kit.orgId, skuCode: "TST-R5-01", name: "Test Guava Bar 100 g (fictional)", family: "Soap", unitNetMassG: "100", unitsPerBox: 24 }).returning();
  const [p2] = await db.insert(products).values({ organizationId: kit.orgId, skuCode: "TST-R5-02", name: "Test Ylang Lotion 100 mL (fictional)", family: "Lotion", unitNetMassG: "100", unitsPerBox: 12 }).returning();
  productId = p.id;
  product2 = p2.id;
  const fg01 = (await loc(kit.nfd.id, "FG-01")).id;
  const expires = new Date(Date.now() + 600 * 86_400_000).toISOString().slice(0, 10);
  for (const pid of [productId, product2]) {
    const [lot] = await db.insert(inventoryLots).values({ organizationId: kit.orgId, siteId: kit.nfd.id, lotNumber: `L-R5-${pid.slice(-6).toUpperCase()}`, itemKind: "product", productId: pid, expiresOn: expires, manufacturedOn: manilaToday(), qualityStatus: "released", baseUom: "pcs" }).returning();
    await db.transaction((tx) => postMovement(tx, mgr, { movementType: "receipt", lotId: lot.id, toLocationId: fg01, qtyBase: "200", sourceDocumentType: "test_fixture" }));
  }
}, 180_000);

describe("change how many / cancel one line on a confirmed order (C-office problem 1)", () => {
  it("lowers a set-aside line: frees the extra stock, keeps the order, re-totals, audited with the reason", async () => {
    const id = await twoLineOrder("40", "10");
    await allocateOrder(wh, id);
    expect((await orderRow(id)).status).toBe("allocated");
    const [l1] = await linesOf(id);
    const r = await changeOrderLine(sales, { lineId: l1.id, qty: "25", reason: "Customer phoned: only 25 bars", idempotencyKey: key() });
    expect(r).toMatchObject({ before: "40", after: "25", released: "15" });
    const [after] = await linesOf(id);
    expect(Number(after.qtyUnits)).toBe(25);
    const open = await db.select().from(stockAllocations).where(and(eq(stockAllocations.salesOrderLineId, l1.id), eq(stockAllocations.status, "open")));
    expect(open.reduce((s, a) => s + Number(a.qtyUnits), 0)).toBe(25);
    const o = await orderRow(id);
    expect(o.status).toBe("allocated");
    expect(Number(o.subtotalAmount)).toBe(25 * 70 + 10 * 50);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, "sales.sales_order.line_changed")));
    expect(ev.reason).toBe("Customer phoned: only 25 bars");
  });

  it("cancels one line (amount 0); refuses to cancel the last line; the order stays", async () => {
    const id = await twoLineOrder("12", "6");
    const [, l2] = await linesOf(id);
    const r = await cancelOrderLine(sales, { lineId: l2.id, reason: "Customer dropped the lotion" });
    expect(r.after).toBe("0");
    const [l1] = await linesOf(id);
    await expectCode(cancelOrderLine(sales, { lineId: l1.id, reason: "Dropping the last line" }), "state");
    expect((await orderRow(id)).status).toBe("confirmed");
  });

  it("raises a line before anything is set aside; refuses raising once set aside", async () => {
    const id = await twoLineOrder("10", "5");
    const [l1] = await linesOf(id);
    expect((await changeOrderLine(sales, { lineId: l1.id, qty: "14", reason: "Customer wants 4 more" })).after).toBe("14");
    await allocateOrder(wh, id);
    await expectCode(changeOrderLine(sales, { lineId: l1.id, qty: "20", reason: "Customer wants even more" }), "state");
  });

  it("refuses to go below what was already sent", async () => {
    const id = await twoLineOrder("8", "4");
    await allocateOrder(wh, id);
    const wh2 = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.nfd]);
    await shipOrder({ picker: wh, checker: wh2, dispatcher: wh }, id);
    const [l1] = await linesOf(id);
    const e = await changeOrderLine(sales, { lineId: l1.id, qty: "3", reason: "Too late to change" }).catch((x) => x);
    expect(["validation", "state"]).toContain(e.code);
  });

  it("negatives: another site's sales person, QA and the warehouse cannot change lines; a draft is changed as a draft", async () => {
    const id = await twoLineOrder("9", "3");
    const [l1] = await linesOf(id);
    await expectCode(changeOrderLine(salesRvs, { lineId: l1.id, qty: "5", reason: "Other site tries" }), "not_found");
    await expectCode(changeOrderLine(qa, { lineId: l1.id, qty: "5", reason: "QA tries" }), "forbidden");
    await expectCode(changeOrderLine(wh, { lineId: l1.id, qty: "5", reason: "Warehouse tries" }), "forbidden");
    const d = await createOrder(sales, { customerId: await customerId("CUS-002"), requestedDeliveryOn: deliveryDate(), lines: [{ productId, qtyUnits: "5", unitPrice: "70" }] });
    const [dl] = await linesOf(d.id);
    await expectCode(changeOrderLine(sales, { lineId: dl.id, qty: "4", reason: "Draft change" }), "state");
  });
});

describe("Can ship from (C-office problem 3)", () => {
  it("is today when the stock is on the shelf; not known when it needs making", async () => {
    const id = await twoLineOrder("5", "5");
    expect((await orderCanShipFrom(sales, id)).date).toBe(manilaToday());
    const big = await createOrder(sales, { customerId: await customerId("CUS-002"), requestedDeliveryOn: deliveryDate(), lines: [{ productId, qtyUnits: "5000", unitPrice: "1" }] });
    await setOrgSetting(kit.orgId, "sales.credit.no_limit_check_above", 100_000_000);
    await submitOrder(sales, big.id);
    const r = await orderCanShipFrom(sales, big.id);
    expect(r).toMatchObject({ date: null, why: "not_known" });
    await expectCode(orderCanShipFrom(salesRvs, big.id), "not_found");
  });
});

describe("credit: a customer with no credit limit (owner decision 2026-11-08)", () => {
  it("orders up to the amount in Settings are confirmed; above it they wait for an OK", async () => {
    await setOrgSetting(kit.orgId, "sales.credit.no_limit_check_above", 1000);
    const c = await createCustomer(sales, { code: `T5-${Date.now().toString(36).toUpperCase()}`, name: "Fictional No-Limit Shop", minShelfLifeDays: 0, shipToAddress: "2 Sampaguita St., Calamba, Laguna" });
    const small = await createOrder(sales, { customerId: c.id, requestedDeliveryOn: deliveryDate(), lines: [{ productId, qtyUnits: "10", unitPrice: "50" }] });
    expect((await submitOrder(sales, small.id)).status).toBe("confirmed");
    const bigger = await createOrder(sales, { customerId: c.id, requestedDeliveryOn: deliveryDate(), lines: [{ productId, qtyUnits: "20", unitPrice: "50" }] });
    const r = await submitOrder(sales, bigger.id);
    expect(r.status).toBe("pending_approval");
    expect(r.reasons.map((x) => x.code)).toContain("no_credit_limit");
    await setOrgSetting(kit.orgId, "sales.credit.no_limit_check_above", 50_000);
  });
});

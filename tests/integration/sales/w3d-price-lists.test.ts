/**
 * US-4-03 price lists with approval and masking (W3D). Tests: authz.sensitive_fields.masked (pricing),
 * sales.pricing_masked_on_pick_pack_dr, separation of duties (approver ≠ editor), effective dating.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, salesOrderLines, salesOrders, shipments } from "@/db/schema";
import {
  allocateOrder,
  approvePriceList,
  createOrder,
  createPriceList,
  deliveryReceiptData,
  dispatchShipment,
  getPackingView,
  getPick,
  getShipment,
  submitOrder,
  getOrder,
  getPriceList,
  listOrders,
  listPriceLists,
  newPriceListVersion,
  rejectPriceList,
  resolvePrice,
  submitPriceList,
  updatePriceListDraft,
} from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { key, pickAll, verifyAll } from "../../support/w3e";
import { auditCount, bundle, inDays, loadW3d, newCustomer, productId, withPermissions, type W3d } from "../../support/w3d";

let w: W3d;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
let n = 0;
const code = () => `PL-T3D-${Date.now().toString(36).slice(-4).toUpperCase()}${++n}`;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW3d();
});

describe("US-4-03 price lists", () => {
  it("draft → submit → approved by finance (≠ editor) becomes effective and writes sales.price_list.approved", async () => {
    const c = await newCustomer(w);
    const acs = await productId("ACS-135");
    const pl = await createPriceList(w.sales, { code: code(), name: "Test customer list", partyKind: "customer", customerId: c.id, effectiveFrom: today(), lines: [{ productId: acs, unitAmount: "71.25" }, { productId: acs, minQtyUnits: "480", unitAmount: "68" }] });
    expect(pl.status).toBe("draft");
    expect(await auditCount(pl.id, "sales.price_list.changed")).toBe(1);
    expect((await resolvePrice(db, w.orgId, c.id, acs, 48))?.partyKind).toBe("general"); // the draft does not apply until approved
    await expectCode(approvePriceList(w.finance, pl.id), "state"); // not submitted yet
    await submitPriceList(w.sales, pl.id);
    await expectCode(approvePriceList(w.sales, pl.id), "forbidden"); // sales_cs has no approve
    await expectCode(approvePriceList(w.manager, pl.id), "forbidden");
    await approvePriceList(w.finance, pl.id, "Agreed with the customer (fictional)");
    expect(await auditCount(pl.id, "sales.price_list.approved")).toBe(1);
    expect(await auditCount(pl.id, "platform.approval_rule.evaluated")).toBeGreaterThan(0);
    expect((await resolvePrice(db, w.orgId, c.id, acs, 48))?.unitAmount).toBe("71.25");
    expect((await resolvePrice(db, w.orgId, c.id, acs, 480))?.unitAmount).toBe("68.00");
  });

  it("separation of duties: the person who edited or submitted a version cannot approve it", async () => {
    const editorApprover = withPermissions(w.finance, [...bundle("finance"), "sales.price_list.edit"], ["finance"]);
    const pl = await createPriceList(editorApprover, { code: code(), name: "Self-approval attempt", partyKind: "general", effectiveFrom: today(), lines: [{ productId: await productId("GBS-135"), unitAmount: "65" }] });
    await submitPriceList(w.sales, pl.id);
    await expectCode(approvePriceList(editorApprover, pl.id), "separation_of_duties");
    const evts = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, pl.id), eq(auditEvents.action, "sales.price_list.approved")));
    expect(evts).toHaveLength(0);
    // The CHECK constraint backs the rule.
    const { priceLists } = await import("@/db/schema");
    await expect(db.update(priceLists).set({ approvedBy: w.sales.userId }).where(eq(priceLists.id, pl.id))).rejects.toThrow();
  });

  it("a new version supersedes the old one on its effective date; edits only while draft; rejection needs a reason", async () => {
    const c = await newCustomer(w);
    const gbs = await productId("GBS-135");
    const v1 = await createPriceList(w.sales, { code: code(), name: "Versioned", partyKind: "customer", customerId: c.id, effectiveFrom: today(), lines: [{ productId: gbs, unitAmount: "60" }] });
    await submitPriceList(w.sales, v1.id);
    await approvePriceList(w.finance, v1.id);
    await expectCode(updatePriceListDraft(w.sales, v1.id, { name: "x", effectiveFrom: today(), lines: [{ productId: gbs, unitAmount: "1" }] }), "state");
    const v2 = await newPriceListVersion(w.sales, v1.id, inDays(5));
    expect(v2.versionNo).toBe(2);
    await updatePriceListDraft(w.sales, v2.id, { name: "Versioned", effectiveFrom: inDays(5), lines: [{ productId: gbs, unitAmount: "62.50" }] });
    await submitPriceList(w.sales, v2.id);
    await expectCode(rejectPriceList(w.finance, v2.id, ""), "validation");
    await approvePriceList(w.finance, v2.id);
    const old = await getPriceList(w.sales, v1.id);
    expect(old.priceList.effectiveTo).toBe(inDays(5));
    expect((await resolvePrice(db, w.orgId, c.id, gbs, 10))?.unitAmount).toBe("60.00");
    expect((await resolvePrice(db, w.orgId, c.id, gbs, 10, inDays(6)))?.unitAmount).toBe("62.50");
  });

  it("the customer's own list beats the general list; order entry takes the list price", async () => {
    const c = await newCustomer(w);
    const ahl = await productId("AHL-250");
    const general = await createPriceList(w.sales, { code: code(), name: "General", partyKind: "general", effectiveFrom: today(), lines: [{ productId: ahl, unitAmount: "150" }] });
    await submitPriceList(w.sales, general.id);
    await approvePriceList(w.finance, general.id);
    expect((await resolvePrice(db, w.orgId, c.id, ahl, 1))?.partyKind).toBe("general");
    const own = await createPriceList(w.sales, { code: code(), name: "Own", partyKind: "customer", customerId: c.id, effectiveFrom: today(), lines: [{ productId: ahl, unitAmount: "140" }] });
    await submitPriceList(w.sales, own.id);
    await approvePriceList(w.owner, own.id);
    const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(7), lines: [{ productId: ahl, qtyUnits: "10" }] });
    const [line] = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, o.id));
    expect(line).toMatchObject({ unitPrice: "140.0000", priceSource: "price_list", priceListId: own.id });
    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, o.id));
    expect(order.subtotalAmount).toBe("1400.0000");
    // A manual price below the list is recorded with its discount
    const o2 = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(7), lines: [{ productId: ahl, qtyUnits: "10", unitPrice: "126" }] });
    const [l2] = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, o2.id));
    expect(l2).toMatchObject({ priceSource: "manual", listUnitPrice: "140.0000", discountPct: "10.0000" });
  });

  it("authz.sensitive_fields.masked (pricing): warehouse and production never receive price fields", async () => {
    await expectCode(listPriceLists(w.warehouse), "forbidden");
    const so2 = (await db.select().from(salesOrders)).find((o) => o.orderNumber.endsWith("00002"))!;
    const view = await getOrder(w.warehouse, so2.id);
    for (const l of view.lines) {
      expect("unitPrice" in l).toBe(false);
      expect("value" in l).toBe(false);
    }
    expect("totalAmount" in view.order).toBe(false);
    expect(view.total).toBeUndefined();
    expect(view._masked).toEqual(["total"]);
    expect(JSON.stringify(view, (k, v) => (k === "_masked" ? undefined : v))).not.toMatch(/"unitPrice"|"totalAmount"|"subtotalAmount"/);
    const list = await listOrders(w.warehouse);
    expect(list.every((o) => o.value === undefined)).toBe(true);
    // The list shows product names next to the SKU code (owner usability fix), never prices.
    expect(list.flatMap((o) => o.lines).every((l) => typeof l.productName === "string" && l.productName.length > 0)).toBe(true);
    // A warehouse operator cannot slip a price in on an order either.
    const noPrice = withPermissions(w.sales, bundle("sales_cs").filter((p) => p !== "sales.price_list.view"));
    const c = await newCustomer(w);
    await expectCode(createOrder(noPrice, { customerId: c.id, requestedDeliveryOn: inDays(7), lines: [{ productId: await productId("ACS-135"), qtyUnits: "1", unitPrice: "1" }] }), "forbidden");
  });

  it("sales.pricing_masked_on_pick_pack_dr: the pick list, packing view and delivery receipt carry no price", async () => {
    // Drive a real order through W3E's pick → pack verification → dispatch (picker ≠ checker).
    const c = await newCustomer(w, { creditLimit: "1000000", minShelfLifeDays: 0 });
    const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(7), lines: [{ productId: await productId("ACS-135"), qtyUnits: "6", unitPrice: "70" }] });
    await submitOrder(w.sales, o.id);
    await allocateOrder(w.warehouse, o.id);
    const { pickId, shipmentId } = await pickAll(w.warehouse, o.id);
    const noMoney = /unitPrice|unit_price|unitAmount|totalAmount|subtotal|price/i;
    expect(JSON.stringify(await getPick(w.warehouse, pickId))).not.toMatch(noMoney);
    await verifyAll(w.manager, w.warehouse, pickId, shipmentId);
    expect(JSON.stringify(await getPackingView(w.manager, shipmentId))).not.toMatch(noMoney);
    await dispatchShipment(w.warehouse, shipmentId, { driverName: "Jun Dela Cruz", vehiclePlate: "NFD 2468", idempotencyKey: key() });
    const [sh] = await db.select().from(shipments).where(eq(shipments.id, shipmentId));
    const dr = await deliveryReceiptData(db, sh.id, { drNumber: sh.deliveryReceiptNumber });
    expect(JSON.stringify(dr)).not.toMatch(noMoney);
    expect(dr.lines.length).toBeGreaterThan(0);
    expect(JSON.stringify(await getShipment(w.warehouse, sh.id))).not.toMatch(noMoney);
  });
});

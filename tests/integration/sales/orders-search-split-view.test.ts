/**
 * Customer orders search and the customers split view (owner mockup review, panel 6): the search is
 * server-side in the sales module (case-insensitive words over customer, product and order number) and
 * stays in the caller's site; what a customer owes needs finance.invoice.view (no figure otherwise); the
 * order page's history falls back to who entered the order. Cross-site and role negatives included.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invoices } from "@/db/schema";
import { createOrder, customerOutstanding, getOrder, listCustomers, listOrders, orderSearchWords } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { bundle, inDays, loadW3d, newCustomer, productId, withPermissions, type W3d } from "../../support/w3d";

let w: W3d;
let orderNumber: string;
let orderId: string;
let customerName: string;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW3d();
  const c = await newCustomer(w, { creditLimit: "1000000", name: "Zamboanga Bloom Traders (fictional)" });
  customerName = c.name;
  const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(10), customerPoNumber: "ZBT-PO-7781", lines: [{ productId: await productId("ACS-135"), qtyUnits: "6", unitPrice: "70" }] });
  orderId = o.id;
  orderNumber = (await getOrder(w.sales, o.id)).order.orderNumber;
}, 180_000);

describe("order search (server-side words)", () => {
  it("splits into at most 8 words and ignores extra spaces", () => {
    expect(orderSearchWords("  zamboanga   bloom ")).toEqual(["zamboanga", "bloom"]);
    expect(orderSearchWords("a b c d e f g h i j").length).toBe(8);
    expect(orderSearchWords(undefined)).toEqual([]);
  });

  it("finds by customer words in any case, by product name, by order number and by the customer's order no.", async () => {
    for (const q of ["zamboanga BLOOM", "bloom zamboanga", orderNumber.toLowerCase(), "zbt-po-7781"]) {
      const rows = await listOrders(w.sales, undefined, 200, { q });
      expect(rows.map((r) => r.id), q).toContain(orderId);
    }
    const [p] = await listOrders(w.sales, undefined, 200, { q: "zamboanga" });
    const productWord = p.lines[0].productName.split(" ")[0];
    const byProduct = await listOrders(w.sales, undefined, 200, { q: `${productWord} zamboanga` });
    expect(byProduct.map((r) => r.id)).toContain(orderId);
  });

  it("every word must match; LIKE wildcards are literal", async () => {
    expect((await listOrders(w.sales, undefined, 200, { q: "zamboanga nosuchword" })).map((r) => r.id)).not.toContain(orderId);
    expect(await listOrders(w.sales, undefined, 200, { q: "%" })).toEqual([]);
    expect(await listOrders(w.sales, undefined, 200, { q: "_" })).toEqual([]);
  });

  it("stays in the caller's current site (cross-site negative)", async () => {
    const rvsOnly = withPermissions(w.sales, bundle("sales_cs"), ["sales_cs"], [w.rvs]);
    expect((await listOrders(rvsOnly, undefined, 200, { q: "zamboanga" })).map((r) => r.id)).not.toContain(orderId);
  });

  it("needs sales.sales_order.view (role negative)", async () => {
    await expectCode(listOrders(withPermissions(w.sales, ["masterdata.customer.view"]), undefined, 10, { q: "zamboanga" }), "forbidden");
  });
});

describe("customers split view", () => {
  it("searches name, e-mail or phone words and sorts by name", async () => {
    const rows = await listCustomers(w.sales, { q: "bloom ZAMBOANGA", sort: "name" });
    expect(rows.map((r) => r.name)).toEqual([customerName]);
    expect(rows[0].openOrders).toBe(1);
    const byPhone = await listCustomers(w.sales, { q: "+63 900" });
    expect(byPhone.some((r) => r.name === customerName)).toBe(true);
    const all = await listCustomers(w.sales, { sort: "name" });
    const names = all.map((r) => r.name.toLowerCase());
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it("what a customer owes needs finance.invoice.view (masked in the DTO, never a fake zero)", async () => {
    // Warehouse staff see customers but not invoices.
    expect(w.warehouse.can("masterdata.customer.view") && !w.warehouse.can("finance.invoice.view")).toBe(true);
    const wh = await listCustomers(w.warehouse, { sort: "name" });
    expect(wh.length).toBeGreaterThan(0);
    expect(wh.every((r) => r.outstanding === undefined)).toBe(true);
    expect(await customerOutstanding(w.warehouse)).toBeNull();
    const fin = await listCustomers(w.finance, { sort: "name" });
    expect(fin.every((r) => typeof r.outstanding === "string")).toBe(true);
    const owed = (await customerOutstanding(w.finance))!;
    const open = await db.select().from(invoices).where(eq(invoices.organizationId, w.orgId));
    for (const [customerId, amount] of owed) {
      const expected = open
        .filter((i) => i.customerId === customerId && ["issued", "partially_paid"].includes(i.status) && [w.nfd.id, w.rvs.id].includes(i.siteId))
        .reduce((s, i) => s + Number(i.totalAmount) - Number(i.paidAmount) - Number(i.creditedAmount), 0);
      expect(Number(amount)).toBeCloseTo(expected, 2);
    }
  });

  it("outstanding only counts invoices at the caller's sites (cross-site negative)", async () => {
    const nfdFinance = withPermissions(w.finance, bundle("finance"), ["finance"], [w.nfd]);
    const owed = (await customerOutstanding(nfdFinance))!;
    const rvsInvoices = await db.select().from(invoices).where(eq(invoices.siteId, w.rvs.id));
    for (const i of rvsInvoices.filter((x) => ["issued", "partially_paid"].includes(x.status))) {
      const nfdOnly = (await db.select().from(invoices).where(eq(invoices.customerId, i.customerId))).filter((x) => x.siteId === w.nfd.id && ["issued", "partially_paid"].includes(x.status));
      const expected = nfdOnly.reduce((s, x) => s + Number(x.totalAmount) - Number(x.paidAmount) - Number(x.creditedAmount), 0);
      expect(Number(owed.get(i.customerId) ?? 0)).toBeCloseTo(expected, 2);
    }
  });
});

describe("order history fallback", () => {
  it("the order carries the name of the person who entered it", async () => {
    const o = await getOrder(w.owner, orderId);
    expect(o.createdByName).toBe(w.sales.displayName);
    expect(o.transitions.length).toBeGreaterThanOrEqual(1);
  });
});

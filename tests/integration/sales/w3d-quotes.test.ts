/**
 * US-4-04 quotations convertible to orders (W3D). Tests: authz.sod.approve_own (quote), discount
 * threshold via approval_rules, conversion, reorder from history, expiry job, cross-site.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { quotes, salesOrderLines, salesOrders } from "@/db/schema";
import { runJob } from "@/modules/platform";
import {
  approvePriceList,
  approveQuote,
  convertQuote,
  createPriceList,
  createQuote,
  getQuote,
  recordQuoteDecision,
  reorderFromOrder,
  returnQuoteToDraft,
  salesQuoteExpiryJob,
  submitPriceList,
  submitQuote,
  voidQuote,
} from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { auditCount, bundle, inDays, loadW3d, newCustomer, productId, withPermissions, type W3d } from "../../support/w3d";

let w: W3d;
let customerId: string;
let acs: string;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW3d();
  acs = await productId("ACS-135");
  const c = await newCustomer(w, { creditLimit: "1000000" });
  customerId = c.id;
  const pl = await createPriceList(w.sales, { code: "PL-T3D-Q", name: "Quote test list", partyKind: "customer", customerId, effectiveFrom: today(), lines: [{ productId: acs, unitAmount: "80" }] });
  await submitPriceList(w.sales, pl.id);
  await approvePriceList(w.finance, pl.id);
});

describe("US-4-04 quotations", () => {
  it("within the discount threshold a submitted quote is sent; acceptance converts it into a linked draft order at the quoted price", async () => {
    const q = await createQuote(w.sales, { customerId, lines: [{ productId: acs, qtyUnits: "96" }] });
    expect(q.quoteNumber).toMatch(/^QT-\d{2}-\d{5}$/);
    const r = await submitQuote(w.sales, q.id);
    expect(r.status).toBe("sent");
    expect(await auditCount(q.id, "sales.quote.sent")).toBe(1);
    await expectCode(submitQuote(w.sales, q.id), "state");
    const conv = await convertQuote(w.sales, q.id, { requestedDeliveryOn: inDays(10), customerPoNumber: "PO-T3D-1" });
    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, conv.orderId));
    expect(order).toMatchObject({ status: "draft", quoteId: q.id, siteId: w.nfd.id, customerPoNumber: "PO-T3D-1" });
    const [line] = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, order.id));
    expect(line).toMatchObject({ priceSource: "quote", unitPrice: "80.0000", qtyUnits: "96.000000" });
    const d = await getQuote(w.sales, q.id);
    expect(d.quote.status).toBe("converted");
    expect(d.order?.orderNumber).toBe(order.orderNumber);
    expect(await auditCount(q.id, "sales.quote.converted")).toBe(1);
    await expectCode(convertQuote(w.sales, q.id, { requestedDeliveryOn: inDays(10) }), "state");
  });

  it("authz.sod.approve_own (quote): above 10 % discount the quote waits for site manager then finance; the creator cannot approve", async () => {
    const q = await createQuote(w.sales, { customerId, lines: [{ productId: acs, qtyUnits: "48", unitPrice: "68" }] }); // 15 % below list
    const r = await submitQuote(w.sales, q.id);
    expect(r.status).toBe("pending_approval");
    await expectCode(approveQuote(w.sales, q.id), "forbidden");
    const salesApprover = withPermissions(w.sales, [...bundle("sales_cs"), "sales.quote.approve"], ["sales_cs", "site_manager"]);
    await expectCode(approveQuote(salesApprover, q.id), "separation_of_duties");
    await expectCode(approveQuote(w.finance, q.id), "forbidden"); // step 1 is the site manager's
    await approveQuote(w.manager, q.id);
    expect((await getQuote(w.sales, q.id)).quote.status).toBe("pending_approval");
    await expectCode(approveQuote(w.manager, q.id), "forbidden"); // step 2 is finance's
    await approveQuote(w.finance, q.id);
    const d = await getQuote(w.sales, q.id);
    expect(d.quote.status).toBe("sent");
    expect(d.decisions.filter((x) => x.decision === "approved").map((x) => x.step)).toEqual([1, 2]);
  });

  it("a returned quote starts a new approval cycle; customer rejection needs a reason; void needs a reason", async () => {
    const q = await createQuote(w.sales, { customerId, lines: [{ productId: acs, qtyUnits: "48", unitPrice: "60" }] });
    await submitQuote(w.sales, q.id);
    await approveQuote(w.manager, q.id);
    await returnQuoteToDraft(w.finance, q.id, "Discount too deep for this volume");
    expect((await getQuote(w.sales, q.id)).quote.status).toBe("draft");
    await submitQuote(w.sales, q.id);
    // The earlier step-1 approval belongs to the closed cycle: finance still cannot jump ahead.
    await expectCode(approveQuote(w.finance, q.id), "forbidden");
    await approveQuote(w.manager, q.id);
    await approveQuote(w.finance, q.id);
    await expectCode(recordQuoteDecision(w.sales, q.id, "rejected", ""), "validation");
    await recordQuoteDecision(w.sales, q.id, "rejected", "Customer chose another supplier");
    await expectCode(voidQuote(w.sales, q.id, "late"), "state");
    const q2 = await createQuote(w.sales, { customerId, lines: [{ productId: acs, qtyUnits: "1" }] });
    await expectCode(voidQuote(w.sales, q2.id, ""), "validation");
    await voidQuote(w.sales, q2.id, "Entered twice");
  });

  it("the daily expiry job expires sent quotes past their validity; an expired quote cannot be converted", async () => {
    const q = await createQuote(w.sales, { customerId, validUntil: today(), lines: [{ productId: acs, qtyUnits: "10" }] });
    await submitQuote(w.sales, q.id);
    await db.update(quotes).set({ validUntil: "2026-01-01" }).where(eq(quotes.id, q.id));
    await expectCode(convertQuote(w.sales, q.id, { requestedDeliveryOn: inDays(3) }), "state");
    const { systemContext } = await import("@/modules/platform");
    const sys = await systemContext(w.orgId, salesQuoteExpiryJob);
    const job = { id: "00000000-0000-7000-8000-000000000000", requestedBy: null } as never;
    const r = await salesQuoteExpiryJob.run({ ctx: sys, job, attempt: 1, idempotencyKey: "k", correlationId: "c", asOf: new Date() }, { asOf: today(), trigger: "manual" });
    expect((r as { quotes: string[] }).quotes).toContain(q.quoteNumber);
    expect((await getQuote(w.sales, q.id)).quote.status).toBe("expired");
    void runJob;
  });

  it("reorder from history copies the lines at today's prices into a new draft", async () => {
    const q = await createQuote(w.sales, { customerId, lines: [{ productId: acs, qtyUnits: "24", unitPrice: "79" }] });
    await submitQuote(w.sales, q.id);
    const conv = await convertQuote(w.sales, q.id, { requestedDeliveryOn: inDays(5) });
    const again = await reorderFromOrder(w.sales, conv.orderId, { requestedDeliveryOn: inDays(20) });
    const [line] = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, again.id));
    expect(line).toMatchObject({ priceSource: "price_list", unitPrice: "80.0000", qtyUnits: "24.000000" });
  });

  it("cross-site: a user of another site cannot see or act on the quote; prices are masked without price permission", async () => {
    const q = await createQuote(w.sales, { customerId, lines: [{ productId: acs, qtyUnits: "5" }] });
    const rvsOnly = withPermissions(w.sales, bundle("sales_cs"), ["sales_cs"], [w.rvs]);
    await expectCode(getQuote(rvsOnly, q.id), "not_found");
    await expectCode(submitQuote(rvsOnly, q.id), "not_found");
    const noPrice = withPermissions(w.sales, bundle("sales_cs").filter((p) => p !== "sales.price_list.view"));
    const d = await getQuote(noPrice, q.id);
    expect("totalAmount" in d.quote).toBe(false);
    expect(d.lines[0].unitAmount).toBeUndefined();
  });
});

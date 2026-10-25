import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { financialPostings, invoiceLines, invoices, salesOrderStateTransitions, salesOrders, shipments } from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import {
  approveInvoice,
  cancelInvoice,
  createInvoiceFromShipment,
  customerStatement,
  editInvoiceDraft,
  getInvoice,
  issueInvoice,
  listInvoices,
  lockPeriod,
  approvePeriodUnlock,
  requestPeriodUnlock,
  returnInvoice,
  shipmentsAwaitingInvoice,
  submitInvoice,
  voidInvoice,
  invoicesToApprove,
  overdueInvoices,
} from "@/modules/finance";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { PW, approvedTax, auditCount, bundle, clearOrgSetting, loadW4b, setOrgSetting, shipNfdOrder, stockUp, thisPeriod, withPermissions, type W4b } from "../../support/w4b";

let w: W4b;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW4b();
  await stockUp(w);
});

async function orderStatus(orderId: string) {
  const [o] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId));
  return o.status;
}

/** draft → submitted (sales) → approved (finance) */
async function approvedInvoice(shipmentId: string) {
  const { invoiceId } = await createInvoiceFromShipment(w.sales, { shipmentId });
  await submitInvoice(w.sales, invoiceId);
  await approveInvoice(w.finance, invoiceId);
  return invoiceId;
}

describe("US-6-10 invoices from dispatched shipments", () => {
  it("invoice.only_from_dispatched_shipment: a shipment that is not dispatched is refused with 422", async () => {
    const [s] = await db.select().from(shipments).where(eq(shipments.status, "dispatched")).limit(1);
    await db.execute(sql`update shipments set status = 'packed' where id = ${s.id}`);
    try {
      const e = await expectCode(createInvoiceFromShipment(w.finance, { shipmentId: s.id }), "validation");
      expect(e.details?.code).toBe("SOURCE_NOT_POSTABLE");
    } finally {
      await db.execute(sql`update shipments set status = 'dispatched' where id = ${s.id}`);
    }
  });

  it("creates a draft from the shipped quantities × the order's prices, once per shipment (V-FIN-DUP)", async () => {
    const shipped = await shipNfdOrder(w, "CUS-002", [{ sku: "ACS-135", qty: "24", price: "70.50" }]);
    const awaiting = await shipmentsAwaitingInvoice(w.finance);
    expect(awaiting.map((a) => a.id)).toContain(shipped.shipment.id);
    const r = await createInvoiceFromShipment(w.sales, { shipmentId: shipped.shipment.id, idempotencyKey: "w4b-inv-create-1" });
    const again = await createInvoiceFromShipment(w.sales, { shipmentId: shipped.shipment.id, idempotencyKey: "w4b-inv-create-1" });
    expect(again.invoiceId).toBe(r.invoiceId);
    const e = await expectCode(createInvoiceFromShipment(w.sales, { shipmentId: shipped.shipment.id }), "conflict");
    expect(e.details?.code).toBe("DUPLICATE_DOCUMENT");
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, r.invoiceId));
    expect(inv).toMatchObject({ status: "draft", invoiceNumber: null, totalAmount: "1692.0000", taxAmount: "0.0000" });
    const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ qty: "24.000000", unitAmount: "70.5000", lineAmount: "1692.0000" });
    expect((await shipmentsAwaitingInvoice(w.finance)).map((a) => a.id)).not.toContain(shipped.shipment.id);
  });

  it("legacy shipments without shipment lines are invoiced from the ledger", async () => {
    const [legacy] = (await db.execute(sql`select s.id from shipments s where s.shipment_number is null and s.status = 'dispatched' and not exists (select 1 from shipment_lines l where l.shipment_id = s.id) limit 1`)) as unknown as { id: string }[];
    const r = await createInvoiceFromShipment(w.finance, { shipmentId: legacy.id });
    const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, r.invoiceId));
    expect(lines.length).toBeGreaterThan(0);
    await cancelInvoice(w.finance, r.invoiceId, "Test cleanup");
  });

  it("sod.approve_own: the submitter cannot approve; approval and issue move the order shipped → invoiced", async () => {
    const shipped = await shipNfdOrder(w, "CUS-001", [{ sku: "ACS-135", qty: "48", price: "68" }]);
    const { invoiceId } = await createInvoiceFromShipment(w.finance, { shipmentId: shipped.shipment.id });
    await submitInvoice(w.finance, invoiceId);
    const sod = await expectCode(approveInvoice(w.finance, invoiceId), "separation_of_duties");
    expect(sod.details?.code).toBe("SEPARATION_OF_DUTIES");
    // Step 1 is a finance role: the owner cannot take it below the threshold.
    await expectCode(approveInvoice(w.owner, invoiceId), "forbidden");
    expect((await invoicesToApprove(w.orgId)).map((c) => c.entityId)).toContain(invoiceId);
    await approveInvoice(w.finance2, invoiceId, "Prices checked against the order");
    expect(await orderStatus(shipped.orderId)).toBe("shipped");
    // Below PHP 100,000 the approver may also post (A-PM-10).
    const r = await issueInvoice(w.finance2, invoiceId, { password: PW, idempotencyKey: "w4b-issue-1" });
    expect(r.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    const replay = await issueInvoice(w.finance2, invoiceId, { password: PW, idempotencyKey: "w4b-issue-1" });
    expect(replay.invoiceNumber).toBe(r.invoiceNumber);
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(inv.status).toBe("issued");
    expect(inv.dueDate).toBeTruthy();
    expect(await orderStatus(shipped.orderId)).toBe("invoiced");
    const posts = await db.select().from(financialPostings).where(eq(financialPostings.documentId, invoiceId));
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ postingType: "invoice_issue", amount: inv.totalAmount, documentNumber: r.invoiceNumber });
    expect(await auditCount(invoiceId, "finance.invoice.posted")).toBe(1);
    expect((await invoicesToApprove(w.orgId)).map((c) => c.entityId)).not.toContain(invoiceId);
  });

  it("sod.poster_equals_approver_above_threshold: above PHP 100,000 the owner approves step 2 and another person posts", async () => {
    const shipped = await shipNfdOrder(w, "CUS-003", [{ sku: "GBS-135", qty: "48", price: "2200" }]);
    const id = await approvedInvoice(shipped.shipment.id).catch(async () => {
      throw new Error("unexpected");
    });
    // 105,600 > 100,000: finance approved step 1, the invoice still waits for the owner.
    const [mid] = await db.select().from(invoices).where(eq(invoices.id, id));
    expect(mid.status).toBe("submitted");
    await approveInvoice(w.owner, id, "Large order confirmed");
    const e = await expectCode(issueInvoice(w.finance, id, { password: PW }), "separation_of_duties");
    expect(e.message).toMatch(/poster/);
    await issueInvoice(w.finance2, id, { password: PW });
  });

  it("returns to draft with a reason and edits the draft's tax code from the reviewed configuration", async () => {
    await approvedTax(w, "TST-S12", "12");
    const shipped = await shipNfdOrder(w, "CUS-002", [{ sku: "ACS-135", qty: "24", price: "50" }]);
    const { invoiceId } = await createInvoiceFromShipment(w.sales, { shipmentId: shipped.shipment.id });
    await submitInvoice(w.sales, invoiceId);
    await expectCode(returnInvoice(w.finance, invoiceId, ""), "validation");
    await returnInvoice(w.finance, invoiceId, "Add the tax line");
    await expectCode(editInvoiceDraft(w.sales, invoiceId, { taxCode: "TST-S12" }), "forbidden");
    await expectCode(editInvoiceDraft(w.finance, invoiceId, { taxCode: "UNKNOWN" }), "validation");
    await editInvoiceDraft(w.finance, invoiceId, { taxCode: "TST-S12" });
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(inv).toMatchObject({ subtotalAmount: "1200.0000", taxAmount: "144.0000", totalAmount: "1344.0000" });
    await submitInvoice(w.sales, invoiceId);
    await approveInvoice(w.finance, invoiceId);
    await issueInvoice(w.finance, invoiceId, { password: PW });
    const [posted] = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
    expect(posted.taxRatePct).toBe("12.0000");
    expect((await db.select().from(invoices).where(eq(invoices.id, invoiceId)))[0].taxConfigurationRef).toMatch(/TST-S12 v1 12%/);
  });

  it("the configured sales tax code applies to new invoices (and refuses when it has no reviewed rate)", async () => {
    const shipped = await shipNfdOrder(w, "CUS-002", [{ sku: "ACS-135", qty: "24", price: "10" }]);
    const shipped2 = await shipNfdOrder(w, "CUS-002", [{ sku: "ACS-135", qty: "24", price: "10" }]);
    try {
      await setOrgSetting(w.orgId, "finance.tax.default_sales_code", "TST-S12");
      const { invoiceId } = await createInvoiceFromShipment(w.finance, { shipmentId: shipped.shipment.id });
      const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
      expect(inv.taxAmount).toBe("28.8000");
      // A configured code without a reviewed rate refuses (V-FIN-TAX) instead of dropping the tax.
      await setOrgSetting(w.orgId, "finance.tax.default_sales_code", "NO-SUCH");
      const e = await expectCode(createInvoiceFromShipment(w.finance, { shipmentId: shipped2.shipment.id }), "validation");
      expect(e.details?.code).toBe("TAX_CONFIG_MISSING");
    } finally {
      await clearOrgSetting(w.orgId, "finance.tax.default_sales_code");
    }
  });

  it("numbering.rollback_no_consume_gapless: a failed issue consumes no INV number", async () => {
    const a = await shipNfdOrder(w, "CUS-001", [{ sku: "ACS-135", qty: "24", price: "60" }]);
    const b = await shipNfdOrder(w, "CUS-001", [{ sku: "GBS-135", qty: "24", price: "60" }]);
    const ia = await approvedInvoice(a.shipment.id);
    const ib = await approvedInvoice(b.shipment.id);
    // The issue fails after the number was allocated (the outer transaction rolls back).
    await expect(
      db.transaction(async (tx) => {
        await issueInvoice(w.finance, ia, { password: PW }, { tx });
        throw new Error("simulated crash after the posting");
      }),
    ).rejects.toThrow(/simulated/);
    const [still] = await db.select().from(invoices).where(eq(invoices.id, ia));
    expect(still).toMatchObject({ status: "approved", invoiceNumber: null });
    const first = await issueInvoice(w.finance, ib, { password: PW });
    const second = await issueInvoice(w.finance, ia, { password: PW });
    const seq = (n: string) => Number(n.split("-").pop());
    expect(seq(second.invoiceNumber)).toBe(seq(first.invoiceNumber) + 1);
    const all = (await db.select({ n: invoices.invoiceNumber }).from(invoices).where(sql`${invoices.invoiceNumber} is not null`)).map((r) => seq(r.n!)).sort((x, y) => x - y);
    expect(all).toEqual(all.map((_, i) => all[0] + i));
  });

  it("period.locked_posting_rejected: issuing into a locked period is 409 PERIOD_LOCKED and allocates no number", async () => {
    const s = await shipNfdOrder(w, "CUS-001", [{ sku: "ACS-135", qty: "24", price: "61" }]);
    const id = await approvedInvoice(s.shipment.id);
    await lockPeriod(w.finance, thisPeriod(), { reason: "Test lock of the current month", acknowledge: true, acknowledgementNote: "Test", password: PW });
    try {
      const e = await expectCode(issueInvoice(w.finance, id, { password: PW }), "conflict");
      expect(e.details?.code).toBe("PERIOD_LOCKED");
      const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
      expect(inv.invoiceNumber).toBeNull();
    } finally {
      const req = await requestPeriodUnlock(w.finance, thisPeriod(), { reason: "Test unlock", password: PW });
      await approvePeriodUnlock(w.owner, req.id, { password: PW });
    }
    await issueInvoice(w.finance, id, { password: PW });
  });

  it("void (reversal): only while nothing is applied; reason required; the order goes back to shipped", async () => {
    const s = await shipNfdOrder(w, "CUS-001", [{ sku: "ACS-135", qty: "24", price: "62" }]);
    const id = await approvedInvoice(s.shipment.id);
    await issueInvoice(w.finance, id, { password: PW });
    expect(await orderStatus(s.orderId)).toBe("invoiced");
    await expectCode(voidInvoice(w.finance, id, { reason: "", password: PW }), "validation");
    await expectCode(voidInvoice(w.sales, id, { reason: "Wrong price", password: PW }), "forbidden");
    await voidInvoice(w.finance, id, { reason: "Issued with the wrong price", password: PW });
    const posts = await db.select().from(financialPostings).where(eq(financialPostings.documentId, id));
    expect(posts.map((p) => p.postingType).sort()).toEqual(["invoice_issue", "reversal"]);
    const rev = posts.find((p) => p.postingType === "reversal")!;
    expect(rev.reversalOfId).toBe(posts.find((p) => p.postingType === "invoice_issue")!.id);
    expect(rev.direction).toBe("credit");
    expect(await orderStatus(s.orderId)).toBe("shipped");
    const tr = await db.select().from(salesOrderStateTransitions).where(and(eq(salesOrderStateTransitions.salesOrderId, s.orderId), eq(salesOrderStateTransitions.toState, "shipped"), eq(salesOrderStateTransitions.fromState, "invoiced")));
    expect(tr[0]?.reason).toMatch(/voided/);
    // The shipment can be invoiced again (replacement).
    const again = await createInvoiceFromShipment(w.finance, { shipmentId: s.shipment.id });
    expect(again.invoiceId).not.toBe(id);
    await expectCode(voidInvoice(w.finance, id, { reason: "twice", password: PW }), "state");
  });

  it("customer statement: open items with aging buckets as of a date; overdue invoices reach the action centre", async () => {
    const s = await shipNfdOrder(w, "CUS-001", [{ sku: "ACS-135", qty: "24", price: "63" }]);
    const id = await approvedInvoice(s.shipment.id);
    await issueInvoice(w.finance, id, { password: PW });
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
    const st = await customerStatement(w.finance, inv.customerId, { asOf: inv.dueDate! });
    expect(st.items.find((i) => i.id === id)?.bucket).toBe("current");
    const late = new Date(Date.parse(inv.dueDate! + "T00:00:00Z") + 40 * 86_400_000).toISOString().slice(0, 10);
    const st2 = await customerStatement(w.finance, inv.customerId, { asOf: late });
    expect(st2.items.find((i) => i.id === id)?.bucket).toBe("31_60");
    expect(Number(st2.buckets["31_60"])).toBeGreaterThan(0);
    expect((await overdueInvoices(w.orgId, new Date(late + "T04:00:00Z"))).map((c) => c.entityId)).toContain(id);
    expect((await listInvoices(w.finance, { overdue: true })).length).toBeGreaterThanOrEqual(0);
  });
});

describe("US-6-10 authorization", () => {
  it("authz.cross_site: an invoice of another site is not found; lists are scoped", async () => {
    const [nfdInv] = await db.select().from(invoices).where(eq(invoices.siteId, w.nfd.id)).limit(1);
    const salesRvs = withPermissions(w.sales, bundle("sales_cs"), ["sales_cs"], [w.rvs]);
    await expectCode(getInvoice(salesRvs, nfdInv.id), "not_found");
    await expectCode(submitInvoice(salesRvs, nfdInv.id), "not_found");
    expect((await listInvoices(salesRvs)).every((i) => i.siteId === w.rvs.id)).toBe(true);
    await expectCode(getInvoice(w.managerRvs, nfdInv.id), "not_found");
    expect((await getInvoice(w.manager, nfdInv.id)).invoice.id).toBe(nfdInv.id);
  });

  it("authz.role_escalation: warehouse, QA and system admin see no invoices; sales cannot approve or post; the auditor only reads", async () => {
    const [inv] = await db.select().from(invoices).limit(1);
    for (const ctx of [w.warehouse, w.qa, w.admin]) await expectCode(listInvoices(ctx), "forbidden");
    await expectCode(approveInvoice(w.sales, inv.id), "forbidden");
    await expectCode(issueInvoice(w.sales, inv.id, { password: PW }), "forbidden");
    await expectCode(issueInvoice(w.owner, inv.id, { password: PW }), "forbidden");
    await expectCode(issueInvoice(w.auditor, inv.id, { password: PW }), "forbidden");
    expect((await listInvoices(w.auditor)).length).toBeGreaterThan(0);
    // Restricted posting needs the password (re-authentication).
    const s = await shipNfdOrder(w, "CUS-001", [{ sku: "ACS-135", qty: "24", price: "64" }]);
    const id = await approvedInvoice(s.shipment.id);
    await expectCode(issueInvoice(w.finance, id, { password: "not-my-password" }), "reauth_required");
    const job = new AuthContext(w.finance.userId, w.orgId, "job", "job", [], w.finance.permissions, w.finance.allowedSites, w.nfd.id, { actor: { kind: "system", code: "test.job", onBehalfOf: null } });
    await expectCode(issueInvoice(job, id, { password: PW }), "forbidden");
  });
});

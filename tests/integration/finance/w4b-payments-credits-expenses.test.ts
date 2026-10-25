import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { creditNotes, customerReturns, expenseClaims, financialPostings, invoices, paymentApplications, paymentRecords } from "@/db/schema";
import {
  approveInvoice,
  cancelPayment,
  createCreditNote,
  createExpenseClaim,
  createInvoiceFromShipment,
  createPayment,
  decideCreditNote,
  decideExpenseClaim,
  decidePayment,
  expenseClaimsToApprove,
  getExpenseClaim,
  getPayment,
  issueCreditNote,
  issueInvoice,
  listExpenseClaims,
  listPayments,
  postExpenseClaim,
  recordPayment,
  submitCreditNote,
  submitExpenseClaim,
  submitInvoice,
  submitPayment,
  voidCreditNote,
  voidExpenseClaim,
  voidPayment,
} from "@/modules/finance";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { PW, bundle, clearOrgSetting, loadW4b, setOrgSetting, shipNfdOrder, stockUp, today, withPermissions, type W4b } from "../../support/w4b";

let w: W4b;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW4b();
  await stockUp(w);
});

async function issuedInvoice(customer: string, qty: string, price: string) {
  const s = await shipNfdOrder(w, customer, [{ sku: "ACS-135", qty, price }]);
  const { invoiceId } = await createInvoiceFromShipment(w.sales, { shipmentId: s.shipment.id });
  await submitInvoice(w.sales, invoiceId);
  await approveInvoice(w.finance, invoiceId);
  await issueInvoice(w.finance, invoiceId, { password: PW });
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  return { inv, shipment: s.shipment };
}

const inv = async (id: string) => (await db.select().from(invoices).where(eq(invoices.id, id)))[0];

/** draft (finance) → submitted → approved (finance2) → recorded (finance). */
async function recorded(input: Parameters<typeof createPayment>[1]) {
  const p = await createPayment(w.finance, input);
  await submitPayment(w.finance, p.paymentId);
  await decidePayment(w.finance2, p.paymentId, { decision: "approved" });
  const r = await recordPayment(w.finance, p.paymentId, { password: PW });
  return { ...p, ...r };
}

describe("US-6-12 payments with applications", () => {
  it("applies oldest due first by default; the remainder stays unapplied on account (A-FIN-07)", async () => {
    const a = await issuedInvoice("CUS-004", "24", "100"); // 2,400
    const b = await issuedInvoice("CUS-004", "24", "50"); // 1,200
    await db.execute(sql`update invoices set due_date = due_date - 10 where id = ${b.inv.id}`); // b is due first
    const p = await recorded({ direction: "inbound", customerId: a.inv.customerId, method: "bank_transfer", reference: "Deposit 1", paidOn: a.inv.issueDate!, amount: "2000" });
    expect(p).toMatchObject({ applied: "2000.0000", unapplied: "0.0000" });
    expect((await inv(b.inv.id)).status).toBe("paid");
    expect(await inv(a.inv.id)).toMatchObject({ status: "partially_paid", paidAmount: "800.0000" });
    const over = await recorded({ direction: "inbound", customerId: a.inv.customerId, method: "cash", paidOn: a.inv.issueDate!, amount: "2000" });
    expect(over).toMatchObject({ applied: "1600.0000", unapplied: "400.0000" });
    expect((await inv(a.inv.id)).status).toBe("paid");
    const postings = await db.select().from(financialPostings).where(eq(financialPostings.documentId, over.paymentId));
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({ postingType: "payment", amount: "2000.0000", direction: "debit" });
  });

  it("V-FIN-APPLY: manual applications never exceed the payment or a document's open amount (422 OVER_APPLICATION)", async () => {
    const a = await issuedInvoice("CUS-004", "24", "10"); // 240
    const tooMuch = await expectCode(createPayment(w.finance, { direction: "inbound", customerId: a.inv.customerId, method: "cash", paidOn: a.inv.issueDate!, amount: "500", applications: [{ documentType: "invoice", documentId: a.inv.id, amount: "300" }] }), "validation");
    expect(tooMuch.details?.code).toBe("OVER_APPLICATION");
    const overPay = await expectCode(createPayment(w.finance, { direction: "inbound", customerId: a.inv.customerId, method: "cash", paidOn: a.inv.issueDate!, amount: "100", applications: [{ documentType: "invoice", documentId: a.inv.id, amount: "200" }] }), "validation");
    expect(overPay.details?.code).toBe("OVER_APPLICATION");
    // Withholding: 230 received + 10 withheld settle the 240 invoice.
    const ok = await recorded({ direction: "inbound", customerId: a.inv.customerId, method: "bank_transfer", paidOn: a.inv.issueDate!, amount: "230", withheldAmount: "10", applications: [{ documentType: "invoice", documentId: a.inv.id, amount: "240" }] });
    expect(ok.applied).toBe("240.0000");
    expect((await inv(a.inv.id)).status).toBe("paid");
  });

  it("idempotency.duplicate_key: recording twice with one key posts once", async () => {
    const a = await issuedInvoice("CUS-004", "24", "11");
    const p = await createPayment(w.finance, { direction: "inbound", customerId: a.inv.customerId, method: "cash", paidOn: a.inv.issueDate!, amount: "264", idempotencyKey: "w4b-pay-create-1" });
    const again = await createPayment(w.finance, { direction: "inbound", customerId: a.inv.customerId, method: "cash", paidOn: a.inv.issueDate!, amount: "264", idempotencyKey: "w4b-pay-create-1" });
    expect(again.paymentId).toBe(p.paymentId);
    await submitPayment(w.finance, p.paymentId);
    await decidePayment(w.finance2, p.paymentId, { decision: "approved" });
    const r1 = await recordPayment(w.finance, p.paymentId, { password: PW, idempotencyKey: "w4b-pay-post-1" });
    const r2 = await recordPayment(w.finance, p.paymentId, { password: PW, idempotencyKey: "w4b-pay-post-1" });
    expect(r2).toEqual(r1);
    expect(await db.select().from(paymentApplications).where(eq(paymentApplications.paymentRecordId, p.paymentId))).toHaveLength(1);
  });

  it("reversal.cascade_payment_applications: voiding a payment reverses its applications and reopens the invoices", async () => {
    const a = await issuedInvoice("CUS-004", "24", "12"); // 288
    const p = await recorded({ direction: "inbound", customerId: a.inv.customerId, method: "cheque", reference: "CHK 0001", paidOn: a.inv.issueDate!, amount: "288" });
    expect((await inv(a.inv.id)).status).toBe("paid");
    await expectCode(voidPayment(w.finance, p.paymentId, { reason: "", password: PW }), "validation");
    await expectCode(voidPayment(w.sales, p.paymentId, { reason: "Bounced", password: PW }), "forbidden");
    await voidPayment(w.finance, p.paymentId, { reason: "Cheque bounced (fictional)", password: PW });
    expect(await inv(a.inv.id)).toMatchObject({ status: "issued", paidAmount: "0.0000" });
    const apps = await db.select().from(paymentApplications).where(eq(paymentApplications.paymentRecordId, p.paymentId));
    expect(apps.map((x) => x.appliedAmount).sort()).toEqual(["-288.0000", "288.0000"]);
    const posts = await db.select().from(financialPostings).where(eq(financialPostings.documentId, p.paymentId));
    expect(posts.map((x) => x.postingType).sort()).toEqual(["payment", "reversal"]);
    await expectCode(voidPayment(w.finance, p.paymentId, { reason: "again", password: PW }), "state");
  });

  it("separation of duties: the submitter does not approve; cancel needs a reason; others' sites are hidden", async () => {
    const a = await issuedInvoice("CUS-004", "24", "13");
    const p = await createPayment(w.finance, { direction: "inbound", customerId: a.inv.customerId, method: "cash", paidOn: a.inv.issueDate!, amount: "10" });
    await submitPayment(w.finance, p.paymentId);
    await expectCode(decidePayment(w.finance, p.paymentId, { decision: "approved" }), "separation_of_duties");
    await expectCode(recordPayment(w.finance, p.paymentId, { password: PW }), "state");
    await expectCode(cancelPayment(w.finance, p.paymentId, ""), "validation");
    await cancelPayment(w.finance, p.paymentId, "Entered twice");
    const salesRvs = withPermissions(w.sales, bundle("sales_cs"), ["sales_cs"], [w.rvs]);
    await expectCode(getPayment(salesRvs, p.paymentId), "not_found");
    expect((await listPayments(salesRvs)).every((x) => x.siteId === w.rvs.id)).toBe(true);
    for (const ctx of [w.warehouse, w.manager, w.admin, w.qa]) await expectCode(listPayments(ctx), "forbidden");
    await expectCode(createPayment(w.sales, { direction: "inbound", customerId: a.inv.customerId, method: "cash", paidOn: a.inv.issueDate!, amount: "1" }), "forbidden");
  });

  it("refuses a payment dated in the future, without a counterparty, or money out to a customer (refunds are Phase 8)", async () => {
    const a = await issuedInvoice("CUS-004", "24", "14");
    await expectCode(createPayment(w.finance, { direction: "inbound", customerId: a.inv.customerId, method: "cash", paidOn: "2999-01-01", amount: "1" }), "validation");
    await expectCode(createPayment(w.finance, { direction: "inbound", method: "cash", paidOn: a.inv.issueDate!, amount: "1" }), "validation");
    await expectCode(createPayment(w.finance, { direction: "outbound", customerId: a.inv.customerId, method: "cash", paidOn: a.inv.issueDate!, amount: "1" }), "validation");
  });
});

describe("US-6-12 credit notes", () => {
  it("credit note against an issued invoice: approved by a second person, issued (CN number) and applied", async () => {
    const a = await issuedInvoice("CUS-005", "24", "20"); // 480
    const over = await expectCode(createCreditNote(w.sales, { invoiceId: a.inv.id, amount: "500", reasonCode: "pricing_error", reason: "Too much" }), "validation");
    expect(over.details?.code).toBe("OVER_APPLICATION");
    await expectCode(createCreditNote(w.sales, { invoiceId: a.inv.id, amount: "10", reasonCode: "nonsense", reason: "x reason" }), "validation");
    const cn = await createCreditNote(w.sales, { invoiceId: a.inv.id, amount: "80", reasonCode: "pricing_error", reason: "Agreed discount not applied" });
    await submitCreditNote(w.sales, cn.creditNoteId);
    await expectCode(decideCreditNote(w.sales, cn.creditNoteId, { decision: "approved" }), "forbidden");
    await decideCreditNote(w.finance, cn.creditNoteId, { decision: "approved" });
    await expectCode(issueCreditNote(w.sales, cn.creditNoteId, { password: PW }), "forbidden");
    const r = await issueCreditNote(w.finance, cn.creditNoteId, { password: PW });
    expect(r.creditNoteNumber).toMatch(/^CN-\d{4}-\d{5}$/);
    const [row] = await db.select().from(creditNotes).where(eq(creditNotes.id, cn.creditNoteId));
    expect(row.status).toBe("applied");
    expect(await inv(a.inv.id)).toMatchObject({ status: "partially_paid", creditedAmount: "80.0000" });
    // Reversing the credit returns the open amount.
    await voidCreditNote(w.finance, cn.creditNoteId, { reason: "Discount was not agreed after all", password: PW });
    expect(await inv(a.inv.id)).toMatchObject({ status: "issued", creditedAmount: "0.0000" });
  });

  it("R-08: a full-void credit note voids the invoice and moves the order back to shipped", async () => {
    const s = await shipNfdOrder(w, "CUS-005", [{ sku: "ACS-135", qty: "24", price: "21" }]);
    const { invoiceId } = await createInvoiceFromShipment(w.sales, { shipmentId: s.shipment.id });
    await submitInvoice(w.sales, invoiceId);
    await approveInvoice(w.finance, invoiceId);
    await issueInvoice(w.finance, invoiceId, { password: PW });
    const cn = await createCreditNote(w.sales, { invoiceId, voidsInvoice: true, reasonCode: "invoice_void", reason: "Invoice issued in error" });
    await submitCreditNote(w.sales, cn.creditNoteId);
    await decideCreditNote(w.finance, cn.creditNoteId, { decision: "approved" });
    await issueCreditNote(w.finance, cn.creditNoteId, { password: PW });
    const i = await inv(invoiceId);
    expect(i).toMatchObject({ status: "voided", voidedByCreditNoteId: cn.creditNoteId });
    const [o] = (await db.execute(sql`select status from sales_orders where id = ${s.orderId}`)) as unknown as { status: string }[];
    expect(o.status).toBe("shipped");
    await expectCode(voidCreditNote(w.finance, cn.creditNoteId, { reason: "undo", password: PW }), "conflict");
  });

  it("from an approved W3F customer return: the amount defaults to the returned value; an unapproved return is refused", async () => {
    // The seeded W3F return (received into quarantine) is on the MVP shipment of CUS-001.
    const [ret] = await db.select().from(customerReturns).where(eq(customerReturns.status, "received")).limit(1);
    const { invoiceId } = await createInvoiceFromShipment(w.finance, { shipmentId: ret.shipmentId });
    await submitInvoice(w.finance, invoiceId);
    await approveInvoice(w.finance2, invoiceId);
    await issueInvoice(w.finance2, invoiceId, { password: PW });
    const cn = await createCreditNote(w.sales, { invoiceId, customerReturnId: ret.id, reasonCode: "goods_returned", reason: `Return ${ret.returnNumber}` });
    const [row] = await db.select().from(creditNotes).where(eq(creditNotes.id, cn.creditNoteId));
    expect(Number(row.amount)).toBeGreaterThan(0);
    expect(row.customerReturnId).toBe(ret.id);
    const dup = await expectCode(createCreditNote(w.sales, { invoiceId, customerReturnId: ret.id, reasonCode: "goods_returned", reason: "again" }), "conflict");
    expect(dup.details?.code).toBe("DUPLICATE_DOCUMENT");
    await db.execute(sql`update customer_returns set status = 'submitted' where id = ${ret.id}`);
    try {
      await db.execute(sql`update credit_notes set status = 'cancelled', cancel_reason = 'test' where id = ${cn.creditNoteId}`);
      const e = await expectCode(createCreditNote(w.sales, { invoiceId, customerReturnId: ret.id, reasonCode: "goods_returned", reason: "Return not approved" }), "validation");
      expect(e.details?.code).toBe("SOURCE_NOT_POSTABLE");
    } finally {
      await db.execute(sql`update customer_returns set status = 'received' where id = ${ret.id}`);
    }
  });
});

describe("US-6-12 expense claims with limits and separation of duties", () => {
  it("self-service: a claimant creates and submits; a receipt is required above the limit", async () => {
    const c = await createExpenseClaim(w.operator, { categoryCode: "travel", description: "Bus fare to the Laguna supplier (fictional)", expenseDate: today(), amount: "750" });
    const e = await expectCode(submitExpenseClaim(w.operator, c.claimId), "validation");
    expect(e.details?.field).toBe("receipt");
    await db.execute(sql`update expense_claims set amount = 400 where id = ${c.claimId}`);
    await submitExpenseClaim(w.operator, c.claimId);
    expect((await expenseClaimsToApprove(w.orgId)).map((x) => x.entityId)).toContain(c.claimId);
    // Others cannot see the claim without the view permission.
    await expectCode(getExpenseClaim(w.warehouse, c.claimId), "not_found");
    expect((await listExpenseClaims(w.warehouse)).find((x) => x.id === c.claimId)).toBeUndefined();
    expect((await getExpenseClaim(w.manager, c.claimId)).claim.id).toBe(c.claimId);
  });

  it("the claimant never approves their own claim (409)", async () => {
    const mgrOwn = await createExpenseClaim(w.manager, { categoryCode: "meals", description: "Supplier lunch (fictional)", expenseDate: today(), amount: "300" }).catch(async () => null);
    // site_manager has no create in the matrix (SM: v a); use a manager context that also claims.
    expect(mgrOwn).toBeNull();
    const both = withPermissions(w.manager, [...bundle("site_manager"), "finance.expense_claim.create", "finance.expense_claim.submit"], ["site_manager"]);
    const c = await createExpenseClaim(both, { categoryCode: "meals", description: "Supplier lunch (fictional)", expenseDate: today(), amount: "300" });
    await submitExpenseClaim(both, c.claimId);
    const e = await expectCode(decideExpenseClaim(both, c.claimId, { decision: "approved" }), "separation_of_duties");
    expect(e.details?.code).toBe("SEPARATION_OF_DUTIES");
  });

  it("over the threshold: site manager then finance, never one person for both steps (409); poster ≠ approver", async () => {
    const c = await createExpenseClaim(w.operator, { categoryCode: "supplies", description: "Emergency spare parts (fictional)", expenseDate: today(), amount: "6000" });
    await db.execute(sql`update expense_claims set receipt_attachment_id = null where id = ${c.claimId}`);
    await setOrgSetting(w.orgId, "finance.expense.receipt_required_above", 10000);
    try {
      await submitExpenseClaim(w.operator, c.claimId);
    } finally {
      await clearOrgSetting(w.orgId, "finance.expense.receipt_required_above");
    }
    // Finance cannot take step 1 (site manager).
    await expectCode(decideExpenseClaim(w.finance, c.claimId, { decision: "approved" }), "forbidden");
    const dual = withPermissions(w.manager, [...bundle("site_manager"), ...bundle("finance")], ["site_manager", "finance"]);
    await decideExpenseClaim(dual, c.claimId, { decision: "approved" });
    expect((await db.select().from(expenseClaims).where(eq(expenseClaims.id, c.claimId)))[0].status).toBe("submitted");
    const twice = await expectCode(decideExpenseClaim(dual, c.claimId, { decision: "approved" }), "separation_of_duties");
    expect(twice.details?.code).toBe("SEPARATION_OF_DUTIES");
    await decideExpenseClaim(w.finance, c.claimId, { decision: "approved", note: "Within budget" });
    const [approved] = await db.select().from(expenseClaims).where(eq(expenseClaims.id, c.claimId));
    expect(approved.status).toBe("approved");
    await expectCode(postExpenseClaim(w.finance, c.claimId, { password: PW }), "separation_of_duties");
    await expectCode(postExpenseClaim(w.manager, c.claimId, { password: PW }), "forbidden");
    await postExpenseClaim(w.finance2, c.claimId, { password: PW });
    const posts = await db.select().from(financialPostings).where(eq(financialPostings.documentId, c.claimId));
    expect(posts[0]).toMatchObject({ postingType: "expense", amount: "6000.0000" });
    // Paid by an outbound payment to the claimant.
    const p = await createPayment(w.finance, { direction: "outbound", claimantUserId: w.operator.userId, method: "cash", paidOn: today(), amount: "6000" });
    await submitPayment(w.finance, p.paymentId);
    await decidePayment(w.finance2, p.paymentId, { decision: "approved" });
    await recordPayment(w.finance, p.paymentId, { password: PW });
    expect((await db.select().from(expenseClaims).where(eq(expenseClaims.id, c.claimId)))[0].status).toBe("paid");
    await expectCode(voidExpenseClaim(w.finance, c.claimId, { reason: "Paid already", password: PW }), "state");
    const [pr] = await db.select().from(paymentRecords).where(and(eq(paymentRecords.id, p.paymentId)));
    expect(pr.direction).toBe("outbound");
  });

  it("rejection needs a reason; a rejected claim is final", async () => {
    const c = await createExpenseClaim(w.operator, { categoryCode: "other", description: "Personal item (fictional)", expenseDate: today(), amount: "100" });
    await submitExpenseClaim(w.operator, c.claimId);
    await expectCode(decideExpenseClaim(w.manager, c.claimId, { decision: "rejected" }), "validation");
    await decideExpenseClaim(w.manager, c.claimId, { decision: "rejected", note: "Not a business expense" });
    await expectCode(decideExpenseClaim(w.manager, c.claimId, { decision: "approved" }), "state");
    await expectCode(createExpenseClaim(w.admin, { categoryCode: "other", description: "x item", expenseDate: today(), amount: "1" }), "forbidden");
  });
});

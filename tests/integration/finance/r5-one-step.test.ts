/**
 * Round 5 office fixes: one person, one step below the owner's amount (C-office problem 9, A-FIN-1STEP-01), and
 * "Send really sends" for invoices (C-office problem 2). ADR-131.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, invoices, paymentRecords } from "@/db/schema";
import { bookInvoiceInOneStep, createPayment, emailInvoiceToCustomer, markInvoiceGiven, recordPaymentInOneStep, submitInvoice, submitPayment } from "@/modules/finance";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode } from "../../support/kit";
import { PW, loadW4b, setOrgSetting, shipNfdOrder, stockUp, type W4b } from "../../support/w4b";

let w: W4b;
const draftInvoice = async (qty: string, price: string) => {
  const s = await shipNfdOrder(w, "CUS-001", [{ sku: "ACS-135", qty, price }]);
  return (await db.select().from(invoices).where(eq(invoices.shipmentId, s.shipment.id)))[0];
};

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW4b({ draftAtDispatch: true, oneStepBelow: 50_000 });
  await stockUp(w);
}, 180_000);

describe("invoices: one step below the amount, approval at or above it", () => {
  it("below: one finance person saves the draft to the books; it is in the books but not given to the customer yet", async () => {
    await setOrgSetting(w.orgId, "finance.invoice.one_step_below", 50_000);
    const inv = await draftInvoice("12", "68");
    await expectCode(bookInvoiceInOneStep(w.warehouse, inv.id, { password: PW }), "forbidden");
    await expectCode(bookInvoiceInOneStep(w.sales, inv.id, { password: PW }), "forbidden");
    const r = await bookInvoiceInOneStep(w.finance, inv.id, { password: PW, idempotencyKey: randomUUID() });
    expect(r.invoiceNumber).toMatch(/^INV-/);
    const [row] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect(row).toMatchObject({ status: "issued", givenVia: null, postedBy: w.finance.userId, submittedBy: w.finance.userId });
    const [ev] = await db.select().from(auditEvents).where(eq(auditEvents.entityId, inv.id));
    expect(ev).toBeTruthy();
  });

  it("at or above the amount: refused in one step and sent for approval instead", async () => {
    await setOrgSetting(w.orgId, "finance.invoice.one_step_below", 100);
    const inv = await draftInvoice("12", "68");
    await expectCode(bookInvoiceInOneStep(w.finance, inv.id, { password: PW }), "state");
    expect((await submitInvoice(w.finance, inv.id)).status).toBe("submitted");
    await setOrgSetting(w.orgId, "finance.invoice.one_step_below", 50_000);
  });

  it("given to the customer: printed (recorded), or emailed only when email works", async () => {
    const inv = await draftInvoice("6", "68");
    await bookInvoiceInOneStep(w.finance, inv.id, { password: PW });
    await expectCode(markInvoiceGiven(w.sales, inv.id), "forbidden");
    const e = await emailInvoiceToCustomer(w.finance, inv.id, { idempotencyKey: randomUUID() }).catch((x) => x);
    if (e?.outcome) {
      // EMAIL_PROVIDER not set in tests: nothing went out, so the invoice is not "given".
      expect(e.given).toBe(e.outcome === "sent" || e.outcome === "captured");
    } else expect(e.code).toBe("validation"); // the customer has no email address
    await markInvoiceGiven(w.finance, inv.id);
    const [row] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect(row.givenVia).not.toBeNull();
  });
});

describe("payments: one step below the amount", () => {
  it("below: one person; another site's finance cannot; above: approval", async () => {
    const inv = await draftInvoice("10", "68");
    await bookInvoiceInOneStep(w.finance, inv.id, { password: PW });
    const [issued] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    const p = await createPayment(w.finance, { direction: "inbound", customerId: issued.customerId, method: "cash", paidOn: issued.issueDate!, amount: "300", applications: [{ documentType: "invoice", documentId: issued.id, amount: "300" }] });
    const rvsOnly = await asUser(w, "finance@bryels-care.test", "finance", [w.rvs]);
    await expectCode(recordPaymentInOneStep(rvsOnly, p.paymentId, { password: PW }), "not_found");
    const r = await recordPaymentInOneStep(w.finance, p.paymentId, { password: PW, idempotencyKey: randomUUID() });
    expect(Number(r.applied)).toBe(300);
    const [row] = await db.select().from(paymentRecords).where(eq(paymentRecords.id, p.paymentId));
    expect(row.status).toBe("recorded");
    await setOrgSetting(w.orgId, "finance.payment.one_step_below", 100);
    const p2 = await createPayment(w.finance, { direction: "inbound", customerId: issued.customerId, method: "cash", paidOn: issued.issueDate!, amount: "200", applications: [{ documentType: "invoice", documentId: issued.id, amount: "200" }] });
    await expectCode(recordPaymentInOneStep(w.finance, p2.paymentId, { password: PW }), "state");
    expect((await submitPayment(w.finance, p2.paymentId)).status).toBe("submitted");
    await setOrgSetting(w.orgId, "finance.payment.one_step_below", 50_000);
  });
});

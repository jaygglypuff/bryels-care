/** "Record a payment" from an invoice preselects that invoice and its open amount (consultant review 2026-10-30, flow C). */
import { describe, expect, it } from "vitest";
import { paymentPrefillFor } from "@/modules/finance/payment-prefill";

const open = {
  "cust-1": [
    { documentType: "invoice", documentId: "inv-old", number: "INV-2026-000001", open: "500.0000" },
    { documentType: "invoice", documentId: "inv-new", number: "INV-2026-000007", open: "1632.5000" },
  ],
  "supp-1": [{ documentType: "supplier_bill", documentId: "bill-1", number: "BILL-1 (X)", open: "99.0000" }],
};
const parties = ["customer:cust-1", "supplier:supp-1"];

describe("paymentPrefillFor", () => {
  it("picks the invoice, its customer and its open amount (two decimals)", () => {
    expect(paymentPrefillFor(open, parties, "inv-new")).toEqual({ counterparty: "customer:cust-1", documentType: "invoice", documentId: "inv-new", number: "INV-2026-000007", amount: "1632.50" });
  });
  it("no prefill without an invoice, for an invoice not open (or not visible), or for a supplier bill id", () => {
    expect(paymentPrefillFor(open, parties, null)).toBeNull();
    expect(paymentPrefillFor(open, parties, "inv-other-site")).toBeNull();
    expect(paymentPrefillFor(open, parties, "bill-1")).toBeNull();
    expect(paymentPrefillFor({ "cust-1": [{ ...open["cust-1"][0], open: "0.0000" }] }, parties, "inv-old")).toBeNull();
  });
});

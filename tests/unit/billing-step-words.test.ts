import { describe, expect, it } from "vitest";
import { type BillingStep, billingStageOf, billingStepWords, waitingWords } from "@/lib/billing-step-words";
import type { NextActors } from "@/lib/next-actors-words";

const next = (over: Partial<NextActors> = {}): NextActors => ({
  kind: "invoice",
  does: "approves the invoice",
  doBase: "approve the invoice",
  where: "in To approve",
  people: [{ userId: "u1", name: "Ana Villanueva", role: "owner" }],
  roleWords: "finance",
  viewer: { can: false, selfApproval: false, note: null },
  stepNo: null,
  stepsTotal: null,
  ...over,
});
const inv = (status: string, number: string | null = null) => ({ id: "00000000-0000-0000-0000-000000000001", number, status });

describe("billing step words (ADR-124 item 1)", () => {
  it("maps every invoice status to one stage", () => {
    expect(["draft", "submitted", "approved", "issued", "partially_paid", "paid", "closed", null, "voided"].map(billingStageOf)).toEqual(["draft", "submitted", "approved", "billed", "billed", "paid", "paid", "not_billed", "not_billed"]);
  });

  it("sent for approval names the approver, never 'finance bills it' or 'the draft'", () => {
    const w = billingStepWords({ stage: "submitted", invoice: inv("submitted"), next: next() });
    expect(w.text).toBe("Delivered. The invoice is sent for approval.");
    expect(w.waitingFor).toBe("Waiting for Ana (owner) to approve the invoice — they will see it in To approve.");
    expect(w.action?.label).toBe("Open the invoice");
  });

  it("the viewer who can approve is told so", () => {
    expect(waitingWords(next({ viewer: { can: true, selfApproval: false, note: null }, people: [] }))).toBe("You can approve the invoice now.");
  });

  it("draft, approved and billed read the next stage; no link without invoice access", () => {
    const draft: BillingStep = { stage: "draft", invoice: null, next: null };
    expect(billingStepWords(draft)).toEqual({ text: "Delivered. Next: finance bills it — the invoice draft is ready.", waitingFor: undefined, action: undefined });
    expect(billingStepWords({ stage: "approved", invoice: inv("approved"), next: null }).text).toBe("Delivered. The invoice is approved. Next: finance saves it to the books.");
    const billed = billingStepWords({ stage: "billed", invoice: inv("issued", "INV-2026-000001"), next: null }, "Sent out to the customer.");
    expect(billed.text).toBe("Sent out to the customer. Billed: invoice INV-2026-000001 is saved to the books. Next: get paid.");
    expect(billed.action?.label).toBe("Open the invoice INV-2026-000001");
  });

  it("no invoice yet: the person who can make it gets the button", () => {
    const w = billingStepWords({ stage: "not_billed", invoice: null, next: next({ doBase: "make the invoice", viewer: { can: true, selfApproval: false, note: null } }) });
    expect(w.action).toEqual({ label: "Make the invoice", href: "/finance/invoices" });
  });
});

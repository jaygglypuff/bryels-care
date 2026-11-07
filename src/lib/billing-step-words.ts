/**
 * The next step of a delivery or a customer order once it is sent out (ADR-124 item 1, demo rehearsal 2026-11-07): it
 * follows the invoice, so a delivery never reads "finance bills it" while the invoice waits for its approver. Pure and
 * client-safe; the server helper `billingStepOfShipment` / `billingStepOfOrder` (src/modules/finance/billing-step.ts)
 * finds the stage and the people. Unit-tested in tests/unit/billing-step-words.test.ts.
 *
 *   not_billed → draft → submitted → approved → billed → paid
 *   (no invoice) (draft) (sent for approval) (approved) (saved to the books, not paid) (paid)
 */
import { type NextActors, NOBODY_YET, peopleWords } from "./next-actors-words";

export type BillingStage = "not_billed" | "draft" | "submitted" | "approved" | "billed" | "paid";

/** Least advanced first: an order with several deliveries shows the one furthest behind. */
export const BILLING_STAGE_ORDER: readonly BillingStage[] = ["not_billed", "draft", "submitted", "approved", "billed", "paid"];

export type BillingStep = {
  /** `hidden` (ADR-126): the viewer may not open invoices and the setting hides the invoice stage from them. */
  stage: BillingStage | "hidden";
  /** Null when there is no invoice or the viewer may not open invoices at the site (they still see the stage). */
  invoice: { id: string; number: string | null; status: string } | null;
  /** Who does the next billing step (null once it is billed: the customer pays). */
  next: NextActors | null;
};

/** The invoice stage of an invoice status (null status: no live invoice). */
export function billingStageOf(status: string | null | undefined): BillingStage {
  switch (status) {
    case "draft":
      return "draft";
    case "submitted":
      return "submitted";
    case "approved":
      return "approved";
    case "issued":
    case "partially_paid":
      return "billed";
    case "paid":
    case "closed":
      return "paid";
    default:
      return "not_billed";
  }
}

/**
 * "Waiting for Ana (owner) to approve the invoice." / "You can approve the invoice now. So can Rosa (finance)." /
 * "Waiting for finance to approve the invoice. Nobody can do it yet: …". Null when there is no rule.
 */
export function waitingWords(n: NextActors | null): string | undefined {
  if (!n) return undefined;
  if ((n.viewer.selfApproval || n.viewer.ownerAlone) && n.viewer.note) return n.people.length ? `${n.viewer.note} So can ${peopleWords(n.people)}.` : n.viewer.note;
  if (n.viewer.can) return `You can ${n.doBase} now.${n.people.length ? ` So can ${peopleWords(n.people)}.` : ""}`;
  if (n.people.length) return `Waiting for ${peopleWords(n.people)} to ${n.doBase} — they will see it ${n.where}.`;
  return `Waiting for ${n.roleWords} to ${n.doBase}. ${NOBODY_YET}`;
}

export type BillingWords = { text: string; waitingFor?: string; action?: { label: string; href: string } };

/**
 * The words of the "What to do next" box. `lead` starts the sentence ("Delivered." on a delivery, "Sent out to the
 * customer." on an order). The button opens the invoice only when the viewer may open it.
 */
export function billingStepWords(step: BillingStep, lead = "Delivered."): BillingWords {
  const inv = step.invoice;
  const open = (label: string) => (inv ? { label, href: `/finance/invoices/${inv.id}` } : undefined);
  const named = inv?.number ? `Open the invoice ${inv.number}` : "Open the invoice";
  const waitingFor = waitingWords(step.next);
  switch (step.stage) {
    case "hidden":
      return { text: lead };
    case "not_billed":
      return { text: `${lead} Next: finance bills it.`, waitingFor: waitingFor ?? "Waiting for finance to make the invoice.", action: step.next?.viewer.can ? { label: "Make the invoice", href: "/finance/invoices" } : undefined };
    case "draft":
      return { text: `${lead} Next: finance bills it — the invoice draft is ready.`, waitingFor, action: open("Open the invoice draft") };
    case "submitted":
      return { text: `${lead} The invoice is sent for approval.`, waitingFor, action: open(named) };
    case "approved":
      return { text: `${lead} The invoice is approved. Next: finance saves it to the books.`, waitingFor, action: open(named) };
    case "billed":
      return { text: `${lead} Billed${inv?.number ? `: invoice ${inv.number} is saved to the books` : ""}. Next: get paid.`, waitingFor: "Waiting for the customer to pay.", action: open(named) };
    case "paid":
      return { text: `${lead} Billed and paid. Nothing more to do.`, action: open(named) };
  }
}

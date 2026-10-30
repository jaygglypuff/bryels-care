import Decimal from "decimal.js";

/**
 * "Record a payment" opened from an invoice (consultant review 2026-10-30, flow C): the form starts with
 * that invoice's customer, "Choose amounts" with the invoice preselected and its open amount as both the
 * payment amount and the amount applied to it, instead of "Oldest due first". Pure: it only picks from the
 * open documents the payment form already loaded for the caller's sites (`paymentFormOptions`), so an
 * invoice the caller may not see, or that is not open any more, gives no prefill. The server re-checks
 * every amount when the payment is saved (V-FIN-APPLY).
 */
export type PaymentPrefill = { counterparty: string; documentType: string; documentId: string; number: string; amount: string };

type OpenDoc = { documentType: string; documentId: string; number: string; open: string };

export function paymentPrefillFor(open: Record<string, OpenDoc[]>, parties: string[], invoiceId: string | null | undefined): PaymentPrefill | null {
  if (!invoiceId) return null;
  for (const party of parties) {
    if (!party.startsWith("customer:")) continue;
    const doc = (open[party.slice("customer:".length)] ?? []).find((d) => d.documentType === "invoice" && d.documentId === invoiceId);
    if (doc && new Decimal(doc.open).gt(0)) return { counterparty: party, documentType: doc.documentType, documentId: doc.documentId, number: doc.number, amount: trimAmount(doc.open) };
  }
  return null;
}

/** "1234.5000" → "1234.50" (two decimals for the money field; the open amount is stored with four). */
function trimAmount(v: string): string {
  return new Decimal(v).toFixed(2);
}

/**
 * ADR-131 (C-office bug B14): payment words a clerk reads without thinking "the payment did not pay the invoice".
 * Before the payment is in the books the figures are what it WILL pay; after, what it paid. Pure (unit-tested).
 */
const peso = (v: string | number) => `₱${Number(v).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The line under the list of invoices or bills a payment pays. */
export function paymentPlanWords(chosenByHand: boolean, inBooks: boolean): string {
  if (chosenByHand) return inBooks ? "It paid the invoices or bills you chose." : "It pays the invoices or bills you chose.";
  return inBooks ? "It paid the oldest open invoices or bills first." : "It pays the oldest open invoices or bills first (checked again when it is saved to the books).";
}

/** The two figures under a payment: what it pays and what is left over on the customer's or supplier's account. */
export function paymentFigureLabels(inBooks: boolean): { used: string; left: string } {
  return inBooks ? { used: "Paid on invoices or bills", left: "Left over (kept on their account)" } : { used: "Will pay on invoices or bills", left: "Left over (kept on their account)" };
}

/** The message after a payment is saved to the books. */
export function paymentSavedWords(applied: string | number, unapplied: string | number): string {
  const left = Number(unapplied);
  return left > 0 ? `Saved to the books. It paid ${peso(applied)}; ${peso(left)} is left over and kept on their account.` : `Saved to the books. It paid ${peso(applied)}.`;
}

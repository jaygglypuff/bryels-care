/**
 * ADR-131 (round 5 "Send really sends", C-office problem 2, B-owner bug B1): the words after something is sent to a
 * customer or a supplier. "Sent" / "Emailed" is said only when an email really went out (or was captured in
 * development); when email is not set up or failed the words say so and point to Print. Pure (unit-tested).
 */

/** Outcomes of src/lib/email `sendEmail`, plus "download" (no email address or email switched off) and "pending". */
export type SendOutcome = "captured" | "sent" | "failed" | "not_configured" | "download" | "pending" | string | null;

export const emailWentOut = (r: SendOutcome) => r === "sent" || r === "captured";

/** After "Send to the supplier": the order is sent in every case; the email part is a note. */
export function poSentWords(result: SendOutcome, to: string | null): string {
  if (emailWentOut(result) && to) return `Sent. The order was emailed to ${to}.`;
  if (result === "not_configured") return `Sent. Email is not set up, so nothing was emailed${to ? ` to ${to}` : ""}. Print the order and give it to the supplier, or call them.`;
  if (result === "failed") return `Sent. The email${to ? ` to ${to}` : ""} did not go out. Print the order and give it to the supplier, or call them.`;
  return "Sent. Print the order and give it to the supplier.";
}

/** After "Email to <customer>" on a price offer, an invoice or an order confirmation. */
export function customerEmailWords(what: string, result: SendOutcome, to: string): string {
  if (emailWentOut(result)) return `Emailed the ${what} to ${to}.`;
  if (result === "not_configured") return `Email is not set up, so the ${what} was not emailed. Print it and give it to the customer.`;
  return `The email to ${to} did not go out. Print the ${what} and give it to the customer.`;
}

/** Status words of a price offer that is ready (status `sent`): "Sent" only after it really reached the customer. */
export function quoteGivenWords(givenVia: string | null, givenAt: string | null): string {
  if (!givenVia) return "Ready to give the customer";
  return `Given to the customer${givenAt ? ` on ${givenAt}` : ""} (${givenVia === "email" ? "email" : "printed"})`;
}

/** Status words of a booked invoice that is not paid yet. */
export function invoiceGivenWords(givenVia: string | null, givenAt: string | null): string {
  if (!givenVia) return "In the books – not given to the customer yet";
  return `Given to the customer${givenAt ? ` on ${givenAt}` : ""} (${givenVia === "email" ? "email" : "printed"}) – not paid yet`;
}

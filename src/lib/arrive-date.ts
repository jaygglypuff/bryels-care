/**
 * ADR-131 (B-owner bugs B8/B16, C-office problem 8): the suggested "Arrives on" date of a new purchase order.
 *
 * - From a request to buy: the request's "Needed by" date, when it is after today.
 * - Otherwise: today + the longest supplier lead time of the items, at least tomorrow.
 * - Never today and never a Sunday (moved to the Monday). Saturdays are working days (A-PO-ARRIVE-01, owner to
 *   confirm). Pure; dates are business days as YYYY-MM-DD.
 */
export function plusDaysIso(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

export const isSunday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;

/** The next working day on or after `d` (a Sunday moves to Monday). */
export function workingDayOnOrAfter(d: string): string {
  return isSunday(d) ? plusDaysIso(d, 1) : d;
}

export function suggestArrival(input: { today: string; leadDays: number; neededBy?: string | null }): { date: string; why: "request" | "lead_time" | "tomorrow" } {
  const tomorrow = plusDaysIso(input.today, 1);
  if (input.neededBy && input.neededBy >= tomorrow) return { date: workingDayOnOrAfter(input.neededBy), why: "request" };
  const lead = Math.max(0, Math.floor(input.leadDays));
  if (lead >= 1) return { date: workingDayOnOrAfter(plusDaysIso(input.today, lead)), why: "lead_time" };
  return { date: workingDayOnOrAfter(tomorrow), why: "tomorrow" };
}

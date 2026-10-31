import { daysToWholeMonths } from "@/modules/masterdata";

/** "730 days" → "good for 24 months"; values that are not whole months stay in days. */
export function shelfText(days: number) {
  const m = daysToWholeMonths(days);
  return m ? `good for ${m} month${m === 1 ? "" : "s"}` : `good for ${days} days`;
}

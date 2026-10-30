/**
 * Late-order read model (owner usability fix): an order is late when its requested delivery date is
 * before today's business date (Asia/Manila) and it is not yet fully shipped or finished. Pure; no
 * database access, so list, board and order page agree on the same rule.
 */

/** States in which the goods have left (or the order ended): never late. Same set as the order board. */
export const ORDER_FINISHED_STATES: readonly string[] = ["shipped", "invoiced", "closed", "cancelled"];

/** Whole days between two ISO dates (YYYY-MM-DD), `to - from`. */
function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000);
}

/**
 * Days the order is past its requested delivery date, or 0 when it is on time, has no date, or is
 * already shipped/finished. `today` is the business date (YYYY-MM-DD).
 */
export function orderDaysLate(order: { status: string; requestedDeliveryOn: string | null | undefined }, today: string): number {
  if (!order.requestedDeliveryOn || ORDER_FINISHED_STATES.includes(order.status)) return 0;
  const d = dayDiff(order.requestedDeliveryOn.slice(0, 10), today);
  return d > 0 ? d : 0;
}

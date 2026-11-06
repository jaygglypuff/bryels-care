/**
 * Who does what next on the role Homes (live check 2026-11-06). Pure helpers, no I/O, unit-tested in
 * tests/unit/live-check-1106.test.ts:
 * - `firstActionable`: "What to do next" is only a step the viewer can do (the sales Home offered QA's batch check).
 * - `salesItems`: the sales person's own work in words (orders to confirm, short orders, orders ready to set aside).
 * - `putAwaySentence`: the warehouse's next put-away by name and shelf, not only a count.
 * - `floorQuickKeys`: the operator's quick actions without warehouse jobs (Put away, Move).
 * Pages and services still check every permission; these only choose and word what to show.
 */

/** One line of "Needs your attention": a plain sentence that opens the records behind it. */
export type AttentionItem = { key: string; text: string; href: string; urgent?: boolean };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-PH")} ${n === 1 ? one : many}`;

/** The sales person's own work, from the sales order counts and the "How work flows" counts. */
export function salesItems(c: { toConfirm: number; short: number; canSetAside: number }): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (c.toConfirm > 0) items.push({ key: "so_confirm", text: `${plural(c.toConfirm, "customer order waits", "customer orders wait")} to be confirmed`, href: "/sales?status=draft" });
  if (c.short > 0) items.push({ key: "so_short", text: `${plural(c.short, "customer order is", "customer orders are")} short of stock: ask the planner to make it`, href: "/operations/flow/so_short" });
  if (c.canSetAside > 0) items.push({ key: "so_set_aside", text: `${plural(c.canSetAside, "customer order", "customer orders")} can now get ${c.canSetAside === 1 ? "its" : "their"} stock set aside`, href: "/operations/flow/so_can_set_aside" });
  return items;
}

/**
 * Who can act on each attention line. A line is the viewer's next step only when they hold one of these permissions;
 * an empty list means "always" (the approvals count is already the viewer's own). Unknown keys are never the step.
 */
export const ATTENTION_ACT: Record<string, readonly string[]> = {
  approve: [],
  dispatch: ["sales.shipment.post", "sales.sales_order.create"],
  production: ["production.work_order.create", "production.work_order.approve"],
  low: ["procurement.purchase_request.create"],
  expected: ["procurement.purchase_order.create"],
  qc: ["quality.disposition.approve"],
  hold: ["quality.disposition.approve"],
  expiring: ["quality.disposition.approve", "inventory.movement.post"],
  invoice: ["finance.invoice.create"],
  so_confirm: ["sales.sales_order.submit"],
  so_short: ["sales.sales_order.create"],
  so_set_aside: ["inventory.allocation.create"],
};

/** The first attention line the viewer can act on (their "What to do next"), or null. */
export function firstActionable(items: readonly AttentionItem[], can: (permission: string) => boolean): AttentionItem | null {
  return (
    items.find((i) => {
      const perms = ATTENTION_ACT[i.key];
      return !!perms && (perms.length === 0 || perms.some((p) => can(p)));
    }) ?? null
  );
}

/** "Next: put away Coconut Oil lot L-2611-00017 on A-01 (Shelf A-01). It waits at QA waiting cage." */
export function putAwaySentence(t: { itemName: string; lotNumber: string; suggested: { code: string; name: string } | null; fromName: string; fromCode: string }): string {
  const shelf = t.suggested ? ` on ${t.suggested.code}${t.suggested.name && t.suggested.name !== t.suggested.code ? ` (${t.suggested.name})` : ""}` : "";
  return `Next: put away ${t.itemName} lot ${t.lotNumber}${shelf}. It waits at ${t.fromName || t.fromCode}.`;
}

/** Warehouse jobs never offered as an operator's quick action. */
export const NOT_FOR_FLOOR_QUICK: readonly string[] = ["putaway", "move"];

/** The operator's quick actions after Scan and Today's count: their tiles except batches and warehouse jobs. */
export function floorQuickKeys<K extends string>(tiles: readonly { key: K }[]): K[] {
  return tiles.map((t) => t.key).filter((k) => k !== "scan" && k !== "batches" && !NOT_FOR_FLOOR_QUICK.includes(k));
}

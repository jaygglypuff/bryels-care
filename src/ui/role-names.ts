// One source of role words (live check 2026-11-06 finding 7): src/lib/role-words.ts, shared with the printed batch record.
export { PLAIN_ROLE, PLAIN_ROLE_NAME, plainRole, plainRoleName } from "@/lib/role-words";

/** One sentence per role for its Home page ("This screen is for …"). Falls back to a general sentence. */
export function homeIntro(roleCodes: readonly string[]): string {
  const has = (r: string) => roleCodes.includes(r);
  if (has("owner_director")) return "This screen is for you, the owner: what needs you today, how sales and production are going, and what happened lately. Tap any number to see what is behind it.";
  if (has("site_manager")) return "This screen is for the site manager: what needs your decision, late orders and batches, and stock to look at. Start with “Needs your attention”.";
  if (has("qa_qc")) return "This screen is for QA: what waits for your check or your decision, and stock you stopped. Start with “Needs your attention”.";
  if (has("sales_cs")) return "This screen is for sales: today's orders, orders that are late, and what waits for you. Tap a number to see the orders.";
  if (has("finance")) return "This screen is for finance: shipments not billed yet, what waits for your OK, and sales this week.";
  if (has("production_planner")) return "This screen is for the planner: production orders to make or approve, orders approved but not started, and what QA is checking.";
  if (has("production_operator")) return "This screen is for the machine operator: the batches you can work on now. Press the green button on the top card to start.";
  if (has("warehouse_operator")) return "This screen is for the warehouse: deliveries to receive, stock to put away, and orders to pack and send.";
  if (has("system_admin")) return "This screen is for the IT person: what needs attention today. Settings, users and imports are under Management.";
  return "This screen is your start page: what needs you today. Tap a line to open it.";
}

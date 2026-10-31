/**
 * Role names as people at the plant say them (ADR-088 grade-5 words). The role code and the official
 * bundle name stay in the data and appear only under "More details" as the technical name.
 */
export const PLAIN_ROLE: Record<string, string> = {
  owner_director: "Owner",
  site_manager: "Site manager",
  production_operator: "Machine operator",
  warehouse_operator: "Warehouse",
  qa_qc: "QA",
  sales_cs: "Sales",
  finance: "Finance",
  procurement: "Buying",
  production_planner: "Planner",
  system_admin: "IT person",
  auditor: "Auditor (can only look)",
  floor_display: "Production TV",
};

/** The same, keyed by the official role name (lists that only carry the name). Custom roles keep their own name. */
export const PLAIN_ROLE_NAME: Record<string, string> = {
  "Owner/Director": "Owner",
  "Site Manager": "Site manager",
  "Production Operator": "Machine operator",
  "Warehouse Operator": "Warehouse",
  "QA/QC": "QA",
  "Sales/Customer Service": "Sales",
  Finance: "Finance",
  Procurement: "Buying",
  "Production Planner": "Planner",
  "System Administrator": "IT person",
  "Auditor (read-only)": "Auditor (can only look)",
  "Floor display": "Production TV",
};

export function plainRoleName(name: string): string {
  return PLAIN_ROLE_NAME[name] ?? name;
}

export function plainRole(code: string, fallback?: string): string {
  return PLAIN_ROLE[code] ?? fallback ?? code;
}

/** One sentence per role for its Home page ("This screen is for …"). Falls back to a general sentence. */
export function homeIntro(roleCodes: readonly string[]): string {
  const has = (r: string) => roleCodes.includes(r);
  if (has("owner_director")) return "This screen is for you, the owner: what needs you today, how sales and production are going, and what happened lately. Tap any number to see what is behind it.";
  if (has("site_manager")) return "This screen is for the site manager: what needs your decision, late orders and batches, and stock to look at. Start with “Needs your attention”.";
  if (has("qa_qc")) return "This screen is for QA: what waits for your check or your decision, and stock you stopped. Start with “Needs your attention”.";
  if (has("sales_cs")) return "This screen is for sales: today's orders, orders that are late, and what waits for you. Tap a number to see the orders.";
  if (has("finance")) return "This screen is for finance: shipments not billed yet, what waits for your OK, and sales this week.";
  if (has("production_operator")) return "This screen is for the machine operator: the batches you can work on now. Press the green button on the top card to start.";
  if (has("warehouse_operator")) return "This screen is for the warehouse: deliveries to receive, stock to put away, and orders to pack and send.";
  if (has("system_admin")) return "This screen is for the IT person: what needs attention today. Settings, users and imports are under Management.";
  return "This screen is your start page: what needs you today. Tap a line to open it.";
}

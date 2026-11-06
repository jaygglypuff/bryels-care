/**
 * Role names as people at the plant say them (ADR-088 grade-5 words). The role code and the official
 * bundle name stay in the data and appear only under "More details" as the technical name.
 *
 * ONE source of role words (live check 2026-11-06 finding 7): the screens (src/ui/role-names.ts re-exports these)
 * and the printed batch record (the signer's role under the name) use the same word, e.g. "Machine operator".
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

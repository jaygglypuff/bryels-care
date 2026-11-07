import type { Permission } from "@/lib/permissions";
import { ADVANCED, NAV, canSee, productionItems, type NavItem } from "./nav";

/**
 * Screens in the master search (owner request 2026-11-08: "search for a category, say Bills, or Lot, or Master Data").
 * Typing a screen word, or a word people use for it, lists the menu entries the person may open. Built from NAV, so
 * the words are the menu words (= the screen titles, ADR-101). Pure: used by the server action and unit tests
 * (tests/unit/search-screens.test.ts).
 *
 * Permission: an entry shows only when the person holds its permission (`canSee`, like the menu) and, for the
 * "IT and system" entries, one of its roles. Floor menus are shorter (ADR-083), but a floor person may still find a
 * screen they are allowed to open; the page checks again on the server (menus never grant access).
 */

export type ScreenHit = { label: string; href: string; /** Where it is in the menu: "Management › Finance". */ where: string };

/** One menu entry with where it sits. */
type Screen = NavItem & { group: string };

/** Every menu entry once (first place wins), production tabs included. */
export function allScreens(): Screen[] {
  const seen = new Set<string>();
  const out: Screen[] = [];
  const add = (i: NavItem, group: string) => {
    if (i.planned || seen.has(i.href)) return;
    seen.add(i.href);
    out.push({ ...i, group });
  };
  for (const g of NAV) {
    if (g.label === "Operations") for (const i of productionItems("planner")) add(i, g.label);
    for (const i of g.items) add(i, g.label);
  }
  return out;
}

/** A section token in SCREEN_SYNONYMS: every entry of that menu section. */
const SECTION = (name: string) => `section:${name}`;

/**
 * Words people use → screens (hrefs) or whole menu sections. One place; keep it short and plain. Keys are lower case,
 * singular where a plural only adds "s" (the look-up also tries the word without a trailing "s"/"es").
 */
export const SCREEN_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  // money
  bill: ["/finance/bills"],
  "supplier bill": ["/finance/bills"],
  "purchase invoice": ["/finance/bills"],
  "accounts payable": ["/finance/bills"],
  ap: ["/finance/bills"],
  invoice: ["/finance/invoices"],
  "sales invoice": ["/finance/invoices"],
  "accounts receivable": ["/finance/invoices", "/finance/statements"],
  ar: ["/finance/invoices"],
  payment: ["/finance/payments"],
  paid: ["/finance/payments"],
  credit: ["/finance/credit-notes"],
  "credit note": ["/finance/credit-notes"],
  cn: ["/finance/credit-notes"],
  refund: ["/finance/credit-notes"],
  expense: ["/finance/expenses"],
  claim: ["/finance/expenses"],
  reimbursement: ["/finance/expenses"],
  money: ["/finance", "/finance/bills", "/finance/invoices", "/finance/payments"],
  finance: ["/finance", "/finance/bills", "/finance/invoices", "/finance/payments"],
  accounting: ["/finance", "/finance/periods"],
  statement: ["/finance/statements"],
  "month end": ["/finance/periods"],
  period: ["/finance/periods"],
  tax: ["/finance/tax"],
  vat: ["/finance/tax"],
  // buying
  po: ["/procurement/orders"],
  "purchase order": ["/procurement/orders"],
  purchasing: ["/procurement", "/procurement/orders", "/procurement/requests"],
  buy: ["/procurement/requests", "/procurement/orders"],
  pr: ["/procurement/requests"],
  "purchase request": ["/procurement/requests"],
  requisition: ["/procurement/requests"],
  supplier: ["/procurement/suppliers"],
  vendor: ["/procurement/suppliers"],
  grn: ["/inventory/receipts"],
  gr: ["/inventory/receipts"],
  receipt: ["/inventory/receipts"],
  "goods receipt": ["/inventory/receipts"],
  received: ["/inventory/receipts"],
  receive: ["/inventory/receive", "/inventory/receipts", "/procurement/expected"],
  receiving: ["/inventory/receive", "/inventory/receipts", "/procurement/expected"],
  "put away": ["/inventory/receive/put-away"],
  reorder: ["/procurement/reorder"],
  "low stock": ["/procurement/reorder"],
  // sales and deliveries
  so: ["/sales"],
  order: ["/sales", "/procurement/orders", "/production/orders"],
  "sales order": ["/sales"],
  "customer order": ["/sales"],
  customer: ["/sales/customers"],
  client: ["/sales/customers"],
  quote: ["/sales/quotations"],
  quotation: ["/sales/quotations"],
  price: ["/sales/price-lists"],
  "price list": ["/sales/price-lists"],
  delivery: ["/sales/shipments", "/sales/dispatch"],
  shipment: ["/sales/shipments"],
  dr: ["/sales/shipments"],
  dispatch: ["/sales/dispatch"],
  pick: ["/sales/picking"],
  picking: ["/sales/picking"],
  pack: ["/warehouse/packs"],
  packing: ["/warehouse/packs"],
  return: ["/sales/returns", "/procurement/returns"],
  // production
  "work order": ["/production/orders"],
  wo: ["/production/orders"],
  "production order": ["/production/orders"],
  production: ["/production/orders", "/production/today", "/production/plan"],
  make: ["/production/orders"],
  manufacturing: ["/production/orders"],
  batch: ["/production", "/production/orders"],
  bmr: ["/production"],
  reject: ["/production/defects"],
  plan: ["/production/plan"],
  // stock
  lot: ["/inventory", "/inventory/lots/expiry", "/inventory/lots/reservations"],
  stock: ["/inventory", "/inventory/movements", "/inventory/availability"],
  inventory: ["/inventory", "/inventory/movements", "/inventory/availability"],
  movement: ["/inventory/movements"],
  mov: ["/inventory/movements"],
  "stock change": ["/inventory/movements"],
  move: ["/inventory/move"],
  transfer: ["/inventory/move"],
  shelf: ["/inventory/locations", "/masterdata/locations"],
  shelves: ["/inventory/locations", "/masterdata/locations"],
  location: ["/inventory/locations", "/masterdata/locations"],
  bin: ["/inventory/locations"],
  box: ["/inventory/containers", "/warehouse/packs"],
  container: ["/inventory/containers"],
  sack: ["/inventory/containers"],
  count: ["/inventory/counts"],
  "stock count": ["/inventory/counts"],
  adjustment: ["/inventory/adjustments"],
  adj: ["/inventory/adjustments"],
  "fix stock": ["/inventory/adjustments"],
  expiry: ["/inventory/lots/expiry"],
  expiring: ["/inventory/lots/expiry"],
  "set aside": ["/inventory/lots/reservations"],
  reservation: ["/inventory/lots/reservations"],
  label: ["/labels", "/admin/templates"],
  scan: ["/inventory/scan"],
  barcode: ["/inventory/scan"],
  qr: ["/inventory/scan"],
  // quality
  qa: ["/quality", "/quality/inspections", "/quality/holds"],
  qc: ["/quality", "/quality/inspections"],
  quality: ["/quality", "/quality/inspections", "/quality/holds"],
  release: ["/quality"],
  deviation: ["/quality/deviations"],
  dev: ["/quality/deviations"],
  ncr: ["/quality/deviations"],
  problem: ["/quality/deviations", "/action-centre"],
  "problem report": ["/quality/deviations"],
  capa: ["/quality/capa"],
  "corrective action": ["/quality/capa"],
  complaint: ["/quality/complaints"],
  recall: ["/quality/recalls", "/quality/recall"],
  "change control": ["/quality/changes"],
  "change request": ["/quality/changes"],
  cc: ["/quality/changes"],
  trace: ["/quality/trace"],
  traceability: ["/quality/trace"],
  genealogy: ["/quality/trace"],
  hold: ["/quality/holds"],
  quarantine: ["/quality/holds", "/quality"],
  inspection: ["/quality/inspections"],
  test: ["/quality/inspections"],
  coa: ["/quality/inspections"],
  // set-up and master data
  "master data": [SECTION("Master data"), SECTION("Production setup")],
  masterdata: [SECTION("Master data"), SECTION("Production setup")],
  setup: [SECTION("Master data"), SECTION("Production setup")],
  "set up": [SECTION("Master data"), SECTION("Production setup")],
  material: ["/masterdata/materials"],
  "raw material": ["/masterdata/materials"],
  ingredient: ["/masterdata/materials"],
  product: ["/masterdata/products"],
  sku: ["/masterdata/products"],
  item: ["/masterdata/materials", "/masterdata/products"],
  recipe: ["/masterdata/recipes", "/masterdata/formulas"],
  formula: ["/masterdata/recipes", "/masterdata/formulas"],
  formulation: ["/masterdata/recipes"],
  routing: ["/masterdata/routings"],
  step: ["/masterdata/routings"],
  "work instruction": ["/masterdata/work-instructions"],
  sop: ["/masterdata/work-instructions"],
  equipment: ["/masterdata/equipment"],
  machine: ["/masterdata/equipment", "/maintenance"],
  maintenance: ["/maintenance", "/maintenance/work-orders", "/maintenance/plans"],
  repair: ["/maintenance/work-orders"],
  unit: ["/masterdata/uom"],
  uom: ["/masterdata/uom"],
  site: ["/masterdata/sites"],
  warehouse: ["/masterdata/warehouses", "/warehouse"],
  line: ["/masterdata/lines"],
  reason: ["/masterdata/reason-codes"],
  // people, settings, reports
  user: ["/admin/users"],
  people: ["/admin/users"],
  staff: ["/admin/users"],
  employee: ["/admin/users"],
  role: ["/admin/roles"],
  permission: ["/admin/roles"],
  access: ["/admin/roles"],
  setting: ["/admin/settings"],
  approval: ["/approvals", "/admin/approval-rules"],
  approve: ["/approvals"],
  audit: ["/admin/audit"],
  history: ["/admin/audit"],
  numbering: ["/admin/numbering"],
  import: ["/admin/imports"],
  spreadsheet: ["/admin/imports"],
  excel: ["/admin/imports"],
  csv: ["/admin/imports"],
  report: ["/analytics", "/reports"],
  analytics: ["/analytics", "/analytics/overview"],
  kpi: ["/analytics", "/analytics/definitions"],
  dashboard: ["/dashboard", "/analytics/overview"],
  alert: ["/action-centre", "/notifications"],
  message: ["/notifications"],
  notification: ["/notifications"],
  help: ["/help"],
  offline: ["/sync"],
};

/** Lower case, single spaces, no punctuation but letters, digits, spaces and "&". */
export function normaliseWords(q: string): string {
  return String(q ?? "").toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The synonym keys a typed text hits: the whole text, or the whole text without a plural ending. */
export function synonymTargets(q: string): string[] {
  const t = normaliseWords(q);
  if (!t) return [];
  const forms = new Set([t, t.replace(/ies$/, "y"), t.replace(/es$/, ""), t.replace(/s$/, "")]);
  const out: string[] = [];
  for (const f of forms) for (const target of SCREEN_SYNONYMS[f] ?? []) if (!out.includes(target)) out.push(target);
  return out;
}

type Can = (p: Permission) => boolean;

/** May this person open the entry? Its permission (any of a list), and the IT entries' roles. */
export function mayOpen(can: Can, roles: readonly string[], i: NavItem): boolean {
  return canSee(can, i.permission) && (!i.roles || i.roles.some((r) => roles.includes(r)));
}

const whereOf = (s: Screen) => [s.group, s.section].filter(Boolean).join(" › ");
const toHit = (s: Screen): ScreenHit => ({ label: s.label, href: s.href, where: whereOf(s) });

export const SCREEN_LIMIT = 6;

/**
 * Screens for typed words, best first: synonyms ("bills" → Supplier bills, "master data" → the set-up entries), then
 * menu words that start with the text, then entries whose every typed word starts a word of the label or menu path.
 * Only entries the person may open. Fewer than 2 letters find nothing.
 */
export function searchScreens(q: string, can: Can, roles: readonly string[], limit = SCREEN_LIMIT): ScreenHit[] {
  const text = normaliseWords(q);
  if (text.replace(/[^a-z]/g, "").length < 2) return [];
  const screens = allScreens().filter((s) => mayOpen(can, roles, s));
  const scored = new Map<string, { s: Screen; score: number; order: number }>();
  const put = (s: Screen, score: number, order: number) => {
    const cur = scored.get(s.href);
    if (!cur || cur.score < score) scored.set(s.href, { s, score, order });
  };

  synonymTargets(text).forEach((target, n) => {
    if (target.startsWith("section:")) {
      const name = target.slice("section:".length);
      screens.filter((s) => s.section === name && !s.advanced).forEach((s, k) => put(s, 100 - n, k));
    } else {
      const s = screens.find((x) => x.href === target);
      if (s) put(s, 100 - n, 0);
    }
  });

  const words = text.split(" ");
  screens.forEach((s, k) => {
    const label = normaliseWords(s.label);
    const labelWords = label.split(" ");
    const pathWords = normaliseWords(`${s.group} ${s.section ?? ""}`).split(" ");
    if (label === text) put(s, 90, k);
    else if (label.startsWith(text)) put(s, 80, k);
    else if (words.every((w) => labelWords.some((lw) => lw.startsWith(w)))) put(s, 60, k);
    else if (words.every((w) => [...labelWords, ...pathWords].some((lw) => lw.startsWith(w)))) put(s, 40, k);
  });

  // A whole section ("master data") may show all its entries, up to 10.
  const synonymHits = [...scored.values()].filter((x) => x.score > 90).length;
  return [...scored.values()]
    .sort((a, b) => b.score - a.score || Number(!!a.s.advanced) - Number(!!b.s.advanced) || a.order - b.order)
    .slice(0, Math.max(limit, Math.min(synonymHits, 10)))
    .map((x) => toHit(x.s));
}

/** Common screens per role for an empty search box (first that the person may open, at most `limit`). */
const COMMON_BY_ROLE: Readonly<Record<string, readonly string[]>> = {
  owner_director: ["/approvals", "/operations", "/sales", "/finance", "/inventory", "/analytics"],
  site_manager: ["/approvals", "/operations", "/production/orders", "/inventory", "/sales", "/quality"],
  finance: ["/finance/bills", "/finance/invoices", "/finance/payments", "/finance/statements", "/finance/expenses", "/finance"],
  procurement: ["/procurement/requests", "/procurement/orders", "/procurement/expected", "/procurement/suppliers", "/procurement/reorder"],
  sales_cs: ["/sales", "/sales/customers", "/sales/shipments", "/sales/quotations", "/finance/invoices"],
  warehouse_operator: ["/inventory/receive", "/inventory/move", "/inventory", "/sales/picking", "/warehouse/packs", "/inventory/counts"],
  production_operator: ["/production/orders", "/production/today", "/inventory", "/inventory/scan"],
  qa_qc: ["/quality", "/quality/inspections", "/quality/deviations", "/quality/holds", "/quality/trace", "/quality/capa"],
  system_admin: ["/admin/users", "/admin/roles", "/admin/settings", "/admin/diagnostics", "/masterdata/materials", "/admin/imports"],
};
const COMMON_DEFAULT: readonly string[] = ["/inventory", "/sales", "/production/orders", "/quality", "/finance", "/help"];

export function commonScreens(can: Can, roles: readonly string[], limit = 5): ScreenHit[] {
  const wanted: string[] = [];
  for (const r of roles) for (const h of COMMON_BY_ROLE[r] ?? []) if (!wanted.includes(h)) wanted.push(h);
  for (const h of COMMON_DEFAULT) if (!wanted.includes(h)) wanted.push(h);
  const screens = allScreens();
  return wanted
    .map((h) => screens.find((s) => s.href === h))
    .filter((s): s is Screen => !!s && mayOpen(can, roles, s) && (s.section !== ADVANCED || roles.includes("owner_director")))
    .slice(0, limit)
    .map(toHit);
}

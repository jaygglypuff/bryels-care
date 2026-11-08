import type { Permission } from "@/lib/permissions";
import { NAV, canSee, type NavItem } from "./nav";

/**
 * Screens in the master search (owner request 2026-11-08: "search for a category, say Bills, or Lot, or Master Data").
 * Typing a screen word, or a word people use for it, lists the screens the person may open. Built from the catalogue
 * (NAV), so the words are the menu words (= the screen titles, ADR-101), and screens that are in no menu of the role
 * (round 5: Set-up, rare screens) are still found. Pure: used by the server action and unit tests
 * (tests/unit/search-screens.test.ts).
 *
 * Round 5 (ADR-129): plain questions ("who owes us", "this month's sales") and actions ("new customer", "record a
 * payment") open the screen that answers or does it; actions are listed first, then the screens.
 *
 * Permission: an entry shows only when the person holds its permission (`canSee`, like the menu) and, for the
 * "IT and system" entries, one of its roles. The page checks again on the server (menus never grant access).
 */

export type ScreenHit = { label: string; href: string; /** Where it is in the menu: "Money". */ where: string; /** Round 5: a thing to do ("New customer"), not a list. */ action?: boolean; /** Round 5: the typed words are exactly this action ("new customer"): Enter opens it. */ exact?: boolean };

/** One menu entry with where it sits. */
type Screen = NavItem & { group: string };

/** Every screen once, with its area ("Money", "Set-up"). */
export function allScreens(): Screen[] {
  const seen = new Set<string>();
  const out: Screen[] = [];
  for (const g of NAV)
    for (const i of g.items) {
      if (i.planned || seen.has(i.href)) continue;
      seen.add(i.href);
      out.push({ ...i, group: g.label });
    }
  return out;
}

/**
 * Things to do (round 5, C report #15: "new customer", "make order" found nothing). Each opens the screen that starts
 * it; `words` are what people type. The page checks the permission again.
 */
export type SearchAction = { label: string; href: string; permission: Permission | readonly Permission[]; words: readonly string[]; where: string };

export const SEARCH_ACTIONS: readonly SearchAction[] = [
  { label: "New customer order", href: "/sales/new", permission: "sales.sales_order.create", words: ["new order", "new customer order", "new sales order", "make order", "make an order", "take an order", "add order", "create order", "sell"], where: "Sell" },
  { label: "New customer", href: "/sales/customers/new", permission: "masterdata.customer.create", words: ["new customer", "add customer", "add a customer", "create customer", "new client"], where: "Sell" },
  { label: "New price offer", href: "/sales/quotations/new", permission: "sales.quote.create", words: ["new price offer", "new quote", "make a quote", "new quotation", "price offer"], where: "Sell" },
  { label: "Ask to buy something", href: "/procurement/requests/new", permission: "procurement.purchase_request.create", words: ["ask to buy", "buy something", "new request", "request to buy", "buy"], where: "Buy & stock" },
  { label: "New purchase order", href: "/procurement/orders/new", permission: "procurement.purchase_order.create", words: ["new purchase order", "new po", "order from supplier", "make a purchase order"], where: "Buy & stock" },
  { label: "New supplier", href: "/masterdata/suppliers/new", permission: "masterdata.supplier.create", words: ["new supplier", "add supplier", "add a supplier", "new vendor"], where: "Buy & stock" },
  { label: "Record a payment", href: "/finance/payments/new", permission: "finance.payment_record.create", words: ["record a payment", "new payment", "customer paid", "got paid", "payment received"], where: "Money" },
  { label: "Enter a supplier bill", href: "/finance/bills/new", permission: "finance.supplier_bill.create", words: ["enter a supplier bill", "new bill", "enter bill", "add bill", "supplier bill"], where: "Money" },
  { label: "New expense claim", href: "/finance/expenses/new", permission: "finance.expense_claim.create", words: ["new expense", "expense claim", "claim money back", "reimburse"], where: "Money" },
  { label: "New production order", href: "/production/orders/new", permission: "production.work_order.create", words: ["new production order", "make product", "make soap", "make more", "produce"], where: "Make" },
  { label: "Report a problem", href: "/quality/deviations/new", permission: "quality.deviation.create", words: ["report a problem", "new problem", "something is wrong", "problem report", "report problem"], where: "Make" },
  { label: "New material", href: "/masterdata/materials/new", permission: "masterdata.material.create", words: ["new material", "add material", "new ingredient", "add ingredient"], where: "Set-up" },
  { label: "New recipe", href: "/masterdata/recipes/new", permission: "masterdata.formula.create", words: ["new recipe", "new product", "add product", "make a recipe"], where: "Set-up" },
  { label: "Add a person", href: "/admin/users/invite", permission: "identity.user.create", words: ["add a person", "new user", "add user", "add worker", "new worker", "new employee", "invite"], where: "Set-up" },
];

/**
 * Plain questions → the screen that answers them (round 5, B report task 6: "who owes" found nothing). Matched when
 * the typed text contains the phrase (so "who owes us money?" works). Targets are catalogue screens.
 */
export const SEARCH_QUESTIONS: readonly { phrases: readonly string[]; hrefs: readonly string[] }[] = [
  { phrases: ["who owes", "owe us", "owes us", "money owed", "not paid", "unpaid", "late payers", "who has not paid"], hrefs: ["/finance/statements", "/finance"] },
  { phrases: ["we owe", "what we owe", "to pay suppliers", "bills to pay", "pay suppliers"], hrefs: ["/finance/bills", "/finance"] },
  { phrases: ["this month s sales", "this months sales", "sales this month", "month sales", "monthly sales", "how much did we sell", "how much we sold", "how are sales", "sales today", "todays sales"], hrefs: ["/analytics/overview", "/analytics", "/sales"] },
  { phrases: ["what to buy", "running low", "low stock", "need to buy", "almost out"], hrefs: ["/procurement/reorder"] },
  { phrases: ["what needs me", "needs me", "to approve", "waiting for me", "my approvals"], hrefs: ["/approvals", "/action-centre"] },
  { phrases: ["where is my order", "where is the order", "late orders", "orders late"], hrefs: ["/sales"] },
  { phrases: ["what is being made", "what are we making", "production today", "plan for today", "todays plan"], hrefs: ["/operations", "/production/plan"] },
  { phrases: ["expiring", "expires soon", "about to expire"], hrefs: ["/inventory/lots/expiry"] },
  { phrases: ["where did it go", "who received", "where it came from"], hrefs: ["/quality/trace"] },
];

/** Actions for typed words, best first (only those the person may start). */
export function searchActions(q: string, can: Can, limit = 3): ScreenHit[] {
  const text = normaliseWords(q);
  if (text.replace(/[^a-z]/g, "").length < 3) return [];
  const scored: { a: SearchAction; score: number; k: number }[] = [];
  SEARCH_ACTIONS.forEach((a, k) => {
    if (!canSee(can, a.permission)) return;
    const label = normaliseWords(a.label);
    let score = 0;
    for (const w of a.words) {
      if (w === text) score = Math.max(score, 100);
      else if (w.startsWith(text) && text.length >= 4) score = Math.max(score, 80);
      else if (text.includes(w) && w.includes(" ")) score = Math.max(score, 70);
    }
    if (label === text) score = Math.max(score, 100);
    else if (label.startsWith(text) && text.length >= 4) score = Math.max(score, 75);
    if (score) scored.push({ a, score, k });
  });
  return scored
    .sort((x, y) => y.score - x.score || x.k - y.k)
    .slice(0, limit)
    .map(({ a, score }) => ({ label: a.label, href: a.href, where: a.where, action: true, exact: score >= 100 }));
}

/** The screens that answer a plain question in the typed text (hrefs, best first). */
export function questionTargets(q: string): string[] {
  const text = ` ${normaliseWords(q.replace(/['’]/g, " "))} `;
  const out: string[] = [];
  for (const x of SEARCH_QUESTIONS) if (x.phrases.some((p) => text.includes(` ${p} `) || text.includes(` ${p}`))) for (const h of x.hrefs) if (!out.includes(h)) out.push(h);
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
  "master data": [SECTION("Products and recipes"), SECTION("Places and machines")],
  masterdata: [SECTION("Products and recipes"), SECTION("Places and machines")],
  setup: [SECTION("Products and recipes"), SECTION("Places and machines")],
  "set up": [SECTION("Products and recipes"), SECTION("Places and machines")],
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
  "set-up": ["/setup"],
  "set up page": ["/setup"],
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

  // Round 5: plain questions ("who owes us money?") open the screen that answers them, first.
  questionTargets(q).forEach((target, n) => {
    const s = screens.find((x) => x.href === target);
    if (s) put(s, 110 - n, 0);
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
    .filter((s): s is Screen => !!s && mayOpen(can, roles, s) && (!s.advanced || roles.includes("owner_director")))
    .slice(0, limit)
    .map(toHit);
}

import type { Permission } from "@/lib/permissions";

/**
 * Navigation (ADR-081, docs/NEW_NAVIGATION.md): five destinations — Home, Operations, Inventory,
 * Sales & Customers, Management — replace the fourteen module menus. Every screen keeps its URL; only
 * where it is listed changes. Items without a `section` are the destination's main tabs; items with a
 * `section` sit in a small menu of that name (the "Advanced" section holds the old detailed production
 * screens, ADR-080 §11). `hub` marks a destination's landing page: a destination whose only visible
 * item is its hub is hidden (nothing to land on).
 */
export type NavItem = {
  label: string;
  href: string;
  permission?: Permission;
  planned?: string;
  section?: string;
  hub?: boolean;
  /** ADR-082: only for people who approve something (or have something waiting for them). */
  approverOnly?: boolean;
};
export type NavGroup = { label: string; icon: string; /** One line under the label in the top bar (mockup board). */ description: string; items: NavItem[] };
export type QuickAction = { label: string; href: string; icon: string; permission?: Permission };

/** Live counts shown as a badge on the matching tab and menu entry (keyed by href). */
export type NavBadges = Partial<Record<string, number>>;

/** ADR-085: the former "Older screens" — planning tools for planners and the owner, in Management. */
export const ADVANCED = "Planning tools";

/** The most common actions, one tap away on the Operations Center ("Quick links" of the mockup board). */
export const QUICK_ACTIONS: QuickAction[] = [
  { label: "Scan or look up", href: "/inventory/scan", icon: "scan", permission: "inventory.lot.view" },
  { label: "Receive materials", href: "/inventory/receive", icon: "receive", permission: "procurement.goods_receipt.create" },
  // ADR-074: a production order creates its batch on approval; operators never "create a batch".
  { label: "New production order", href: "/production/orders/new", icon: "batch", permission: "production.work_order.create" },
  { label: "Quality check", href: "/quality/check", icon: "qa", permission: "quality.disposition.view" },
  { label: "New customer order", href: "/sales/new", icon: "order", permission: "sales.sales_order.create" },
  { label: "Trace a lot", href: "/quality/trace", icon: "trace", permission: "quality.genealogy.view" },
];

/** Product, step and instruction setup: Management → Production setup (owner and engineering). */
const SETUP_ITEMS: NavItem[] = [
  // ADR-089: the guided recipe wizard (ingredients and steps in five screens).
  { label: "New recipe (step by step)", href: "/masterdata/recipes/new", permission: "masterdata.formula.create" },
  { label: "Recipes (advanced)", href: "/masterdata/formulas", permission: "masterdata.formula.view" },
  { label: "Steps (advanced)", href: "/masterdata/routings", permission: "masterdata.routing.view" },
  { label: "How-to sheets", href: "/masterdata/work-instructions", permission: "masterdata.work_instruction.view" },
  { label: "Quality checks for items", href: "/masterdata/inspection-plans", permission: "quality.inspection_plan.view" },
  { label: "Equipment", href: "/masterdata/equipment", permission: "masterdata.equipment.view" },
];

/** The old detailed production screens, collapsed under "Advanced" (ADR-080 §11). */
const ADVANCED_ITEMS: NavItem[] = [
  { label: "Production plan (weeks ahead)", href: "/production/plan", permission: "production.production_plan.view", section: ADVANCED },
  { label: "All batches and their records", href: "/production", permission: "production.batch.view", section: ADVANCED },
  { label: "Production orders, full detail", href: "/production/work-orders", permission: "production.work_order.view", section: ADVANCED },
  { label: "Production board, full detail", href: "/production/board", permission: "production.work_order.view", section: ADVANCED },
  { label: "Get materials by scanning", href: "/production/staging", permission: "inventory.movement.post", section: ADVANCED },
  { label: "Make a batch without an order", href: "/production/new", permission: "production.batch.create", section: ADVANCED },
];

const inSection = (section: string, items: NavItem[]): NavItem[] => items.map((i) => ({ ...i, section }));

/** The full menu; the Operations production tabs are replaced per role by productionItems(). */
export const NAV: NavGroup[] = [
  {
    label: "Home",
    icon: "home",
    description: "Your day at a glance",
    items: [
      { label: "Overview", href: "/dashboard" },
      { label: "To approve", href: "/approvals", approverOnly: true },
      { label: "Messages", href: "/notifications" },
      { label: "Problems & alerts", href: "/action-centre" },
      ...inSection("Help & my account", [
        { label: "Help & guides", href: "/help" },
        { label: "My account", href: "/account" },
        { label: "Working without signal", href: "/sync" },
        { label: "My expense claims", href: "/finance/expenses", permission: "finance.expense_claim.create" },
      ]),
    ],
  },
  {
    // The connected work pipeline: receive → inspect → make → check → pack → dispatch.
    label: "Operations",
    icon: "factory",
    description: "Production and the daily work",
    items: [
      { label: "Operations Center", href: "/operations", hub: true },
      { label: "Production orders", href: "/production/orders", permission: "production.work_order.view" },
      { label: "Today's count", href: "/production/today", permission: "production.daily_log.view" },
      { label: "Rejects", href: "/production/defects", permission: "production.daily_log.view" },
      // ADR-080 G3: the one-page check of finished batches; lots waiting for QA are under Quality → QA queue.
      { label: "Quality check", href: "/quality/check", permission: "quality.disposition.view" },
      // ADR-084: the full-screen production TV (no menus); floor personas keep it out of their menu (FLOOR_MENU).
      { label: "Floor screen (TV)", href: "/floor", permission: "production.batch.view" },
      ...inSection("Receiving", [
        { label: "Deliveries coming", href: "/procurement/expected", permission: "procurement.purchase_order.view" },
        { label: "Receive materials", href: "/inventory/receive", permission: "procurement.goods_receipt.create" },
        { label: "Goods receipts", href: "/inventory/receipts", permission: "procurement.goods_receipt.view" },
        { label: "Put away", href: "/inventory/receive/put-away", permission: "inventory.movement.post" },
      ]),
      ...inSection("Quality", [
        { label: "QA queue", href: "/quality", permission: "quality.disposition.view" },
        { label: "Quality checks", href: "/quality/inspections", permission: "quality.inspection.view" },
        { label: "Problem reports", href: "/quality/deviations", permission: "quality.deviation.view" },
        { label: "Stopped by QA", href: "/quality/holds", permission: "quality.hold.view" },
        { label: "Decide many lots at once", href: "/quality/bulk", permission: "quality.disposition.approve" },
        { label: "Where it came from and went", href: "/quality/trace", permission: "quality.genealogy.view" },
        { label: "Customer complaints", href: "/quality/complaints", permission: "quality.complaint.view" },
        { label: "Who received it", href: "/quality/recall", permission: "quality.genealogy.view" },
        { label: "Product recalls", href: "/quality/recalls", permission: "quality.recall_case.view" },
        { label: "Fix-and-prevent plans", href: "/quality/capa", permission: "quality.capa.view" },
        { label: "Change requests", href: "/quality/changes", permission: "quality.change_control.view" },
      ]),
      ...inSection("Packing & dispatch", [
        { label: "Boxing", href: "/warehouse/packs", permission: "inventory.pack.view" },
        { label: "Repack for a customer", href: "/warehouse/repack", permission: "inventory.container.edit" },
        { label: "Check labels in an area", href: "/quality/label-verification", permission: "inventory.container.edit" },
        { label: "To get from shelf", href: "/sales/picking", permission: "sales.pick.view" },
        { label: "Send out", href: "/sales/dispatch", permission: "sales.shipment.view" },
        { label: "Deliveries", href: "/sales/shipments", permission: "sales.shipment.view" },
      ]),
      ...inSection("Maintenance", [
        { label: "Maintenance", href: "/maintenance", permission: "maintenance.work_order.view" },
        { label: "Regular maintenance", href: "/maintenance/plans", permission: "maintenance.plan.view" },
        { label: "Repair jobs", href: "/maintenance/work-orders", permission: "maintenance.work_order.view" },
        { label: "Spare parts", href: "/maintenance/spare-parts", permission: "maintenance.spare_part.view" },
      ]),
    ],
  },
  {
    // Raw materials, work in progress and finished goods; scanning is the main action.
    label: "Inventory",
    icon: "boxes",
    description: "Track stock and materials",
    items: [
      { label: "Stock", href: "/inventory", permission: "inventory.lot.view" },
      { label: "Scan", href: "/inventory/scan", permission: "inventory.lot.view" },
      { label: "Scan to move", href: "/inventory/move", permission: "inventory.movement.post" },
      { label: "Warehouse sections", href: "/warehouse", permission: "inventory.lot.view" }, // S6 (ADR-077)
      ...inSection("More stock lists", [
        { label: "Locations & stock", href: "/inventory/locations", permission: "masterdata.location.view" },
        { label: "Boxes", href: "/inventory/containers", permission: "inventory.container.view" },
        { label: "Availability", href: "/inventory/availability", permission: "inventory.balance.view" },
        { label: "Expiry alerts", href: "/inventory/lots/expiry", permission: "inventory.lot.view" },
        { label: "FEFO & reservations", href: "/inventory/lots/reservations", permission: "inventory.lot.view" },
        { label: "Stock movements", href: "/inventory/movements", permission: "inventory.movement.view" },
      ]),
      ...inSection("Counts & labels", [
        { label: "Stock counts", href: "/inventory/counts", permission: "inventory.stock_count.view" },
        { label: "Adjustments", href: "/inventory/adjustments", permission: "inventory.adjustment.view" },
        { label: "Label print station", href: "/labels", permission: "inventory.label_job.view" },
      ]),
    ],
  },
  {
    // One customer order from request to payment, without leaving this destination.
    label: "Sales & Customers",
    icon: "truck",
    description: "Orders, deliveries and payments",
    items: [
      { label: "Customer orders", href: "/sales", permission: "sales.sales_order.view" },
      { label: "Customers", href: "/sales/customers", permission: "masterdata.customer.view" },
      { label: "Orders as a board", href: "/sales/board", permission: "sales.sales_order.view" },
      ...inSection("Quotes, prices & returns", [
        { label: "Price offers", href: "/sales/quotations", permission: "sales.quote.view" },
        { label: "Prices", href: "/sales/price-lists", permission: "sales.price_list.view" },
        { label: "Customer returns", href: "/sales/returns", permission: "sales.customer_return.view" },
      ]),
      ...inSection("Billing & payments", [
        { label: "Invoices", href: "/finance/invoices", permission: "finance.invoice.view" },
        { label: "Payments", href: "/finance/payments", permission: "finance.payment_record.view" },
        { label: "Statements", href: "/finance/statements", permission: "finance.invoice.view" },
        { label: "Credits (money back)", href: "/finance/credit-notes", permission: "finance.credit_note.view" },
      ]),
    ],
  },
  {
    // Everything that is not daily floor work: people, money, buying, reports, setup and settings.
    label: "Management",
    icon: "settings",
    description: "HR, finance, reports and settings",
    items: [
      { label: "Management home", href: "/management", hub: true },
      ...inSection("Reports & analytics", [
        { label: "Business overview", href: "/analytics/overview", permission: "analytics.dashboard.view" },
        { label: "Reports", href: "/analytics", permission: "analytics.dashboard.view" },
        { label: "Compare over time", href: "/analytics/trends", permission: "analytics.dashboard.view" },
        { label: "Lists to download or print", href: "/reports", permission: "analytics.report.view" },
        { label: "Lists sent by email", href: "/reports/schedules", permission: "analytics.scheduled_report.view" },
      ]),
      ...inSection("Purchasing", [
        { label: "Purchasing", href: "/procurement", permission: "procurement.purchase_request.view" },
        { label: "Requests to buy", href: "/procurement/requests", permission: "procurement.purchase_request.view" },
        { label: "Purchase orders", href: "/procurement/orders", permission: "procurement.purchase_order.view" },
        { label: "Send back to supplier", href: "/procurement/returns", permission: "procurement.supplier_return.view" },
        { label: "Suppliers we may buy from", href: "/procurement/suppliers", permission: "masterdata.supplier.view" },
        { label: "Running low", href: "/procurement/reorder", permission: "procurement.reorder_suggestion.view" },
        { label: "How suppliers do", href: "/procurement/performance", permission: "procurement.supplier_performance.view" },
        { label: "Sales guess", href: "/procurement/forecast", permission: "analytics.forecast.view" },
      ]),
      ...inSection("Finance", [
        { label: "Money", href: "/finance", permission: "finance.invoice.view" },
        { label: "Supplier bills", href: "/finance/bills", permission: "finance.supplier_bill.view" },
        { label: "Expense approvals", href: "/finance/expenses?status=to_approve", permission: "finance.expense_claim.approve" },
        { label: "Close the month", href: "/finance/periods", permission: "finance.period_lock.view" },
        { label: "Tax rates", href: "/finance/tax", permission: "finance.tax_config.view" },
      ]),
      ...inSection("Production setup", SETUP_ITEMS),
      ...ADVANCED_ITEMS,
      ...inSection("Master data", [
        { label: "Materials", href: "/masterdata/materials", permission: "masterdata.material.view" },
        { label: "Products", href: "/masterdata/products", permission: "masterdata.product.view" },
        { label: "Suppliers", href: "/masterdata/suppliers", permission: "masterdata.supplier.view" },
        { label: "Locations", href: "/masterdata/locations", permission: "masterdata.location.view" },
        { label: "Sites", href: "/masterdata/sites", permission: "masterdata.site.view" },
        { label: "Warehouses", href: "/masterdata/warehouses", permission: "masterdata.warehouse.view" },
        { label: "Making areas / lines", href: "/masterdata/lines", permission: "masterdata.production_line.view" },
        { label: "Units", href: "/masterdata/uom", permission: "masterdata.uom.view" },
        { label: "Choice lists", href: "/masterdata/lists", permission: "masterdata.lookup_value.view" },
        { label: "Reasons", href: "/masterdata/reason-codes", permission: "masterdata.reason_code.view" },
      ]),
      ...inSection("People & access", [
        { label: "People", href: "/admin/users", permission: "identity.user.view" },
        { label: "Roles", href: "/admin/roles", permission: "identity.role.view" },
        { label: "Who is signed in", href: "/admin/sessions", permission: "identity.session.view" },
        { label: "Sign-in safety", href: "/admin/security", permission: "identity.user.admin" },
      ]),
      ...inSection("IT settings", [
        { label: "History of changes", href: "/admin/audit", permission: "platform.audit.view" },
        { label: "Settings", href: "/admin/settings", permission: "platform.settings.view" },
        { label: "Who says OK to what", href: "/admin/approval-rules", permission: "platform.approval_rule.view" },
        { label: "How record numbers look", href: "/admin/numbering", permission: "platform.numbering_rule.view" },
        { label: "Labels and printouts", href: "/admin/templates", permission: "masterdata.label_template.view" },
        { label: "Who gets which message", href: "/admin/notification-rules", permission: "platform.notification_rule.view" },
        { label: "Load data from a spreadsheet", href: "/admin/imports", permission: "platform.import_job.view" },
        { label: "Old paper documents", href: "/admin/imports/legacy-documents", permission: "documents.legacy_document.view" },
        { label: "Phones and tablets", href: "/admin/devices", permission: "platform.device.view" },
        { label: "Phone changes to check", href: "/sync/conflicts", permission: "platform.sync_conflict.view" },
        { label: "Keeping and deleting old records", href: "/admin/retention", permission: "platform.retention_policy.view" },
        { label: "Health of the system", href: "/admin/diagnostics", permission: "platform.job.view" },
        { label: "What each number means", href: "/analytics/definitions", permission: "analytics.kpi_definition.view" },
      ]),
    ],
  },
];

// ---------------------------------------------------------------- per role (ADR-080 §11, ADR-081)

type Can = (p: Permission) => boolean;

/** Who the screens are built for. Decided by permissions first (custom roles), roles second. */
export type ProductionPersona = "owner" | "planner" | "operator" | "warehouse" | "qa" | "viewer";

export function productionPersona(can: Can, roles: readonly string[]): ProductionPersona {
  if (roles.includes("owner_director")) return "owner";
  if (can("production.work_order.create") || can("production.work_order.approve")) return "planner";
  if (can("production.daily_log.create") || can("production.batch.edit") || roles.includes("production_operator")) return "operator";
  if (roles.includes("warehouse_operator") || (can("procurement.goods_receipt.create") && !can("procurement.purchase_order.create") && !can("quality.disposition.approve"))) return "warehouse";
  if (can("quality.disposition.approve")) return "qa";
  return "viewer";
}

/** ADR-084: roles that only drive a wall screen. An account holding nothing else lands on the screen, not on Home. */
export const DISPLAY_ROLES: readonly string[] = ["floor_display"];

/** Where "Home" is for this person: "/floor" for a display-only account (the production TV), else "/dashboard". */
export function homeHref(roles: readonly string[]): string {
  return roles.length > 0 && roles.every((r) => DISPLAY_ROLES.includes(r)) ? "/floor" : "/dashboard";
}

/** The production tabs of Operations for one person: operators "My work" and "Today"; everyone else the orders list. */
export function productionItems(persona: ProductionPersona): NavItem[] {
  if (persona === "operator")
    return [
      { label: "My work", href: "/production/orders", permission: "production.work_order.view" },
      { label: "Today's count", href: "/production/today", permission: "production.daily_log.view" },
    ];
  return [
    { label: "Production orders", href: "/production/orders", permission: "production.work_order.view" },
    { label: "Today's count", href: "/production/today", permission: "production.daily_log.view" },
    { label: "Rejects", href: "/production/defects", permission: "production.daily_log.view" },
  ];
}

const PRODUCTION_TAB_HREFS = new Set(["/production/orders", "/production/today", "/production/defects", "/production/orders/new"]);

/** Floor roles work from Home, Operations and Inventory; Management is not in their menu (the pages still check access). */
const FLOOR_PERSONAS: readonly ProductionPersona[] = ["operator", "warehouse"];

/**
 * ADR-083: what floor people keep in their menu (everything else still opens by link and is still
 * checked on the server). Operators: their work, the daily log, stock and scan. Warehouse: receiving,
 * packing and dispatch, and inventory. Keyed by destination; `true` = the whole destination.
 */
const FLOOR_MENU: Record<"operator" | "warehouse", Record<string, true | { main?: string[]; sections?: string[] }>> = {
  operator: {
    Home: { main: ["/dashboard", "/approvals", "/notifications"], sections: ["Help & my account"] },
    Operations: { main: ["/production/orders", "/production/today"] },
    Inventory: { main: ["/inventory", "/inventory/scan"] },
  },
  warehouse: {
    Home: { main: ["/dashboard", "/approvals", "/notifications"], sections: ["Help & my account"] },
    Operations: { main: [], sections: ["Receiving", "Packing & dispatch"] },
    Inventory: true,
  },
};

function trimForFloor(groups: NavGroup[], persona: ProductionPersona): NavGroup[] {
  if (persona !== "operator" && persona !== "warehouse") return groups;
  const keep = FLOOR_MENU[persona];
  return groups
    .filter((g) => keep[g.label])
    .map((g) => {
      const k = keep[g.label];
      if (k === true) return g;
      return { ...g, items: g.items.filter((i) => (i.section ? (k.sections ?? []).includes(i.section) : (k.main ?? []).includes(i.href))) };
    })
    .filter((g) => g.items.some((i) => !i.planned));
}

/** The menu of one person: the five destinations filtered by permission, production tabs per role. */
export function buildNav(can: Can, roles: readonly string[], opts: { approver?: boolean } = {}): NavGroup[] {
  const persona = productionPersona(can, roles);
  const approver = opts.approver ?? true;
  const displayOnly = roles.length > 0 && roles.every((r) => r === "floor_display"); // ADR-084: the TV account
  const groups = NAV.filter((g) => !(g.label === "Management" && (FLOOR_PERSONAS.includes(persona) || displayOnly))).map((g) => {
    if (g.label !== "Operations") return g;
    const hub = g.items.filter((i) => i.hub);
    const rest = g.items.filter((i) => !i.hub && !PRODUCTION_TAB_HREFS.has(i.href));
    return { ...g, items: [...hub, ...productionItems(persona), ...rest] };
  })
    .map((g) => ({ ...g, items: g.items.filter((i) => (i.planned || !i.permission || can(i.permission)) && (approver || !i.approverOnly)) }))
    .filter((g) => g.items.some((i) => !i.planned && !i.hub) || g.label === "Home");
  return trimForFloor(groups, persona);
}

/** The landing page of a destination: its hub, else its first live item. */
export function groupHref(g: NavGroup): string {
  return g.items.find((i) => i.hub)?.href ?? g.items.find((i) => !i.planned)?.href ?? "#";
}

/** Sections of a destination in menu order: main tabs first, then each named section, "Advanced" last. */
export function groupSections(g: NavGroup): { main: NavItem[]; sections: { name: string; items: NavItem[] }[] } {
  const live = g.items.filter((i) => !i.planned || i.section);
  const order: string[] = [];
  for (const i of live) if (i.section && !order.includes(i.section)) order.push(i.section);
  order.sort((a, b) => (a === ADVANCED ? 1 : 0) - (b === ADVANCED ? 1 : 0));
  return { main: live.filter((i) => !i.section), sections: order.map((name) => ({ name, items: live.filter((i) => i.section === name) })) };
}

/** One tab of the bottom bar (phone and iPad portrait). `href: null` = the Menu tab, which opens the drawer. */
export type Tab = {
  label: string;
  href: string | null;
  icon: "home" | "today" | "scan" | "help" | "factory" | "truck" | "approve" | "shield" | "boxes" | "receive" | "menu";
  permission?: Permission;
};

/**
 * Bottom tab bar per role (mockup board: Home · Tasks · Scan · More). At most five tabs; never
 * "Batches" and never a bare "Orders": production is "My work" or "Operations", sales is "Sales".
 */
export function tabsFor(can: Can, roles: readonly string[]): Tab[] {
  const persona = productionPersona(can, roles);
  const home: Tab = { label: "Home", href: "/dashboard", icon: "home" };
  const menu: Tab = { label: "Menu", href: null, icon: "menu" };
  const operations: Tab = { label: "Operations", href: "/operations", icon: "factory" };
  const inventory: Tab = { label: "Inventory", href: "/inventory", icon: "boxes", permission: "inventory.lot.view" };
  const sales: Tab = { label: "Sales", href: "/sales", icon: "truck", permission: "sales.sales_order.view" };
  const scan: Tab = { label: "Scan", href: "/inventory/scan", icon: "scan", permission: "inventory.lot.view" };
  const tabs: Tab[] =
    persona === "operator"
      ? [home, { label: "My work", href: "/production/orders", icon: "factory", permission: "production.work_order.view" }, { label: "Today's count", href: "/production/today", icon: "today", permission: "production.daily_log.view" }, scan, menu]
      : persona === "warehouse"
        ? [home, { label: "Receive", href: "/inventory/receive", icon: "receive", permission: "procurement.goods_receipt.create" }, scan, inventory, menu]
        : persona === "qa"
          ? [home, { label: "Quality check", href: "/quality/check", icon: "shield", permission: "quality.disposition.view" }, operations, scan, menu]
          : [home, operations, inventory, sales, menu];
  return tabs.filter((t) => !t.permission || can(t.permission));
}

/**
 * ADR-082: does this person get "To approve"? Always when something waits for them; otherwise only
 * office roles holding an `*.approve` permission. Floor roles' approvals (checker sign-off, pack check)
 * happen on the tablet at the step, not in the inbox.
 */
export function isApprover(can: Can, roles: readonly string[], permissions: Iterable<string>, waiting: number): boolean {
  if (waiting > 0) return true;
  if (FLOOR_PERSONAS.includes(productionPersona(can, roles))) return false;
  for (const p of permissions) if (p.endsWith(".approve")) return true;
  return false;
}

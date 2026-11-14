import type { Permission } from "@/lib/permissions";
import { PEOPLE_SETTINGS } from "@/lib/menu-paths";

/**
 * Navigation, round 5 (ADR-129, docs/NEW_NAVIGATION.md; owner 2026-11-08: "usable by people who are not
 * computer-literate, including navigation"). One source for every menu:
 *
 * 1. `NAV` is the catalogue: every screen once, in the area it belongs to (Home, Needs me, Sell, Make, Buy & stock,
 *    Money, Set-up). Search ("where": "Money › Supplier bills"), messages that quote a menu path, the Set-up page and
 *    the "which area is this page in" highlight read it. Menus never grant access: every page checks again.
 * 2. `AREAS_BY_PERSONA` says which areas a person sees, and in each area at most five tabs (`MAX_TABS`) plus one flat
 *    "More" list (no menus inside menus). Owner and site manager: Home · Needs me · Sell · Make · Buy & stock · Money;
 *    office roles get the areas of their job (C report); floor roles get no tab rows at all (A report): their
 *    bottom bar (`tabsFor`) holds their four doors, and "All screens" in the avatar menu opens the drawer.
 * 3. Set-up (products, recipes, materials, people, settings, labels, shelves, machines, numbering…) is in no area:
 *    the avatar menu opens the Set-up page (`/setup`), which lists the set-up screens the person may open.
 *
 * Pages that left a role's menu still open by URL and by search; permissions are unchanged (server-enforced).
 */
export type NavItem = {
  /** The menu word. Equals the H1 of the screen it opens (ADR-101; tests/unit/nav-titles.test.ts). */
  label: string;
  href: string;
  /** Needed to see the entry; a list means "any of these" (menus never grant access, pages check again). */
  permission?: Permission | readonly Permission[];
  planned?: string;
  /** Catalogue: the sub-heading on the Set-up page and in search ("Set-up › Products and recipes"). Menus: "More". */
  section?: string;
  hub?: boolean;
  /** ADR-082: only for people who approve something (or have something waiting for them). */
  approverOnly?: boolean;
  /** Folded on the Set-up page (rarely used); kept for search ranking. */
  advanced?: boolean;
  /** Only these roles see the entry (IT and system: system admin and owner). */
  roles?: readonly string[];
};
export type NavGroup = {
  label: string;
  icon: string;
  /** One line under the label (tooltip on the top-bar pill, second line in the drawer). */
  description: string;
  items: NavItem[];
  /** Where the area's pill goes (its first tab when absent). */
  href?: string;
};
export type QuickAction = { label: string; href: string; icon: string; permission?: Permission };

/** Live counts shown as a badge on the matching tab and menu entry (keyed by href). */
export type NavBadges = Partial<Record<string, number>>;

/** The flat list after an area's tabs (one level; never a menu inside a menu). */
export const MORE = "More";
/** The Set-up page's IT section (system admin and owner only). */
export const IT_SYSTEM = "IT and system";
/** Kept for messages that quote it (src/lib/menu-paths.ts). */
export { PEOPLE_SETTINGS };
/** At most this many tabs per area (round 5): the rest go into one flat "More" list. */
export const MAX_TABS = 5;
/** The Set-up page (the avatar menu's "Set-up"; was the Management hub). */
export const SETUP_HREF = "/setup";

const IT_ROLES: readonly string[] = ["system_admin", "owner_director"];

/** The most common actions, one tap away on the Operations Center ("Quick links" of the mockup board). */
export const QUICK_ACTIONS: QuickAction[] = [
  { label: "Scan or search", href: "/inventory/scan", icon: "scan", permission: "inventory.lot.view" },
  { label: "Receive a delivery", href: "/inventory/receive", icon: "receive", permission: "procurement.goods_receipt.create" },
  // ADR-074: a production order creates its batch on approval; operators never "create a batch".
  { label: "New production order", href: "/production/orders/new", icon: "batch", permission: "production.work_order.create" },
  { label: "Check a batch or delivery", href: "/quality", icon: "qa", permission: "quality.disposition.view" },
  { label: "New customer order", href: "/sales/new", icon: "order", permission: "sales.sales_order.create" },
  { label: "Where it came from and where it went", href: "/quality/trace", icon: "trace", permission: "quality.genealogy.view" },
];

/** "How work flows" (ADR-110 C0) shows a step's count only with that count's permission; any one of these shows the page. */
const FLOW_VIEW: readonly Permission[] = [
  "procurement.purchase_request.view",
  "procurement.purchase_order.view",
  "quality.disposition.view",
  "sales.sales_order.view",
  "production.work_order.view",
  "sales.shipment.view",
  "finance.invoice.view",
];

const inSection = (section: string, items: NavItem[]): NavItem[] => items.map((i) => ({ ...i, section }));

/** The catalogue: every screen once, in its area. Sections are sub-headings (Set-up page, search "where"). */
export const NAV: NavGroup[] = [
  {
    label: "Home",
    icon: "home",
    description: "Your day at a glance",
    items: [
      { label: "Home", href: "/dashboard" },
      { label: "Help", href: "/help" },
      { label: "My account", href: "/account" },
      { label: "Working without signal", href: "/sync" },
    ],
  },
  {
    label: "Needs me",
    icon: "approve",
    description: "Approvals, problems and messages for you",
    items: [
      { label: "To approve", href: "/approvals", approverOnly: true },
      { label: "Problems & alerts", href: "/action-centre" },
      { label: "Messages", href: "/notifications" },
    ],
  },
  {
    label: "Sell",
    icon: "truck",
    description: "Customers, orders and deliveries",
    items: [
      { label: "Customer orders", href: "/sales", permission: "sales.sales_order.view" },
      { label: "Customers", href: "/sales/customers", permission: "masterdata.customer.view" },
      { label: "Price offers", href: "/sales/quotations", permission: "sales.quote.view" },
      { label: "Deliveries", href: "/sales/shipments", permission: "sales.shipment.view" },
      { label: "Customer returns", href: "/sales/returns", permission: "sales.customer_return.view" },
      { label: "Orders as a board", href: "/sales/board", permission: "sales.sales_order.view" },
      ...inSection("Packing and sending", [
        { label: "To get from shelf", href: "/sales/picking", permission: "sales.pick.view" },
        { label: "Send out", href: "/sales/dispatch", permission: "sales.shipment.view" },
        { label: "Boxing", href: "/warehouse/packs", permission: "inventory.pack.view" },
        { label: "Repack for a customer", href: "/warehouse/repack", permission: "inventory.container.edit" },
        { label: "Check the labels in an area", href: "/quality/label-verification", permission: "inventory.container.edit" },
      ]),
    ],
  },
  {
    label: "Make",
    icon: "factory",
    description: "Production, quality and machines",
    items: [
      { label: "Operations Center", href: "/operations", hub: true },
      { label: "Production orders", href: "/production/orders", permission: "production.work_order.view" },
      { label: "Production plan", href: "/production/plan", permission: "production.production_plan.view" },
      // One QA door: finished batches and deliveries waiting for QA, on one screen (ADR-101).
      { label: "Check a batch or delivery", href: "/quality", permission: "quality.disposition.view" },
      { label: "Problem reports", href: "/quality/deviations", permission: "quality.deviation.view" },
      { label: "Batch records", href: "/production", permission: "production.batch.view" },
      { label: "Today", href: "/production/today", permission: "production.daily_log.view" },
      { label: "Rejects", href: "/production/defects", permission: "production.daily_log.view" },
      // ADR-110 C0: the 16 steps from "Ask to buy" to "Invoice", with today's counts.
      { label: "How work flows", href: "/operations/flow", permission: FLOW_VIEW },
      // ADR-084: the full-screen production TV (no menus).
      { label: "Floor screen (TV)", href: "/floor", permission: "production.batch.view" },
      ...inSection("Quality", [
        { label: "Quality tests", href: "/quality/inspections", permission: "quality.inspection.view" },
        { label: "Stopped by QA", href: "/quality/holds", permission: "quality.hold.view" },
        { label: "Decide many lots at once", href: "/quality/bulk", permission: "quality.disposition.approve" },
        { label: "Where it came from and where it went", href: "/quality/trace", permission: "quality.genealogy.view" },
        { label: "Customer complaints", href: "/quality/complaints", permission: "quality.complaint.view" },
        { label: "Who received it (recall check)", href: "/quality/recall", permission: "quality.genealogy.view" },
        { label: "Product recalls", href: "/quality/recalls", permission: "quality.recall_case.view" },
        { label: "Fix-and-prevent plans", href: "/quality/capa", permission: "quality.capa.view" },
        { label: "Change requests", href: "/quality/changes", permission: "quality.change_control.view" },
      ]),
      ...inSection("Machines", [
        { label: "Maintenance", href: "/maintenance", permission: "maintenance.work_order.view" },
        { label: "Regular maintenance", href: "/maintenance/plans", permission: "maintenance.plan.view" },
        { label: "Repair jobs", href: "/maintenance/work-orders", permission: "maintenance.work_order.view" },
        { label: "Spare parts", href: "/maintenance/spare-parts", permission: "maintenance.spare_part.view" },
      ]),
    ],
  },
  {
    label: "Buy & stock",
    icon: "boxes",
    description: "Buying, receiving and stock",
    items: [
      { label: "Stock", href: "/inventory", permission: "inventory.lot.view" },
      { label: "What to buy", href: "/procurement/reorder", permission: "procurement.reorder_suggestion.view" },
      { label: "Purchase orders", href: "/procurement/orders", permission: "procurement.purchase_order.view" },
      { label: "Deliveries coming", href: "/procurement/expected", permission: "procurement.purchase_order.view" },
      { label: "Suppliers we may buy from", href: "/procurement/suppliers", permission: "masterdata.supplier.view" },
      ...inSection("Buying", [
        { label: "Purchasing", href: "/procurement", permission: "procurement.purchase_request.view" },
        { label: "Requests to buy", href: "/procurement/requests", permission: "procurement.purchase_request.view" },
        { label: "Delivery problems", href: "/procurement/delivery-problems", permission: "procurement.purchase_order.view" },
        { label: "Send back to supplier", href: "/procurement/returns", permission: "procurement.supplier_return.view" },
        { label: "How suppliers do", href: "/procurement/performance", permission: "procurement.supplier_performance.view" },
        { label: "Sales guess", href: "/procurement/forecast", permission: "analytics.forecast.view" },
      ]),
      ...inSection("Receiving", [
        { label: "Receive a delivery", href: "/inventory/receive", permission: "procurement.goods_receipt.create" },
        { label: "Deliveries received", href: "/inventory/receipts", permission: "procurement.goods_receipt.view" },
        { label: "Put away", href: "/inventory/receive/put-away", permission: "inventory.movement.post" },
      ]),
      ...inSection("Stock", [
        { label: "Scan or search", href: "/inventory/scan", permission: "inventory.lot.view" },
        { label: "Move stock", href: "/inventory/move", permission: "inventory.movement.post" },
        { label: "Warehouse sections", href: "/warehouse", permission: "inventory.lot.view" },
        { label: "Shelves", href: "/inventory/locations", permission: "masterdata.location.view" },
        { label: "Boxes and sacks", href: "/inventory/containers", permission: "inventory.container.view" },
        { label: "Can we deliver?", href: "/inventory/availability", permission: "inventory.balance.view" },
        { label: "Expiring soon", href: "/inventory/lots/expiry", permission: "inventory.lot.view" },
        { label: "Which one to use first / set aside", href: "/inventory/lots/reservations", permission: "inventory.lot.view" },
        { label: "Stock changes", href: "/inventory/movements", permission: "inventory.movement.view" },
        { label: "Stock counts", href: "/inventory/counts", permission: "inventory.stock_count.view" },
        { label: "Fix stock", href: "/inventory/adjustments", permission: "inventory.adjustment.view" },
        { label: "Labels printed", href: "/labels", permission: "inventory.label_job.view" },
      ]),
    ],
  },
  {
    label: "Money",
    icon: "money",
    description: "Invoices, bills, payments and reports",
    items: [
      { label: "Money", href: "/finance", permission: ["finance.invoice.view", "finance.supplier_bill.view"] },
      { label: "Invoices", href: "/finance/invoices", permission: "finance.invoice.view" },
      { label: "Supplier bills", href: "/finance/bills", permission: "finance.supplier_bill.view" },
      { label: "Payments", href: "/finance/payments", permission: "finance.payment_record.view" },
      { label: "Reports", href: "/analytics", permission: "analytics.dashboard.view" },
      { label: "Customer statements", href: "/finance/statements", permission: "finance.invoice.view" },
      { label: "Credits (money back)", href: "/finance/credit-notes", permission: "finance.credit_note.view" },
      // One entry for your own claims and the ones you approve (same screen; approvals also wait in To approve).
      { label: "Expense claims", href: "/finance/expenses", permission: ["finance.expense_claim.create", "finance.expense_claim.approve"] },
      { label: "Close the month", href: "/finance/periods", permission: "finance.period_lock.view" },
      { label: "Tax rates", href: "/finance/tax", permission: "finance.tax_config.view" },
      ...inSection("Reports", [
        { label: "Business overview (detailed)", href: "/analytics/overview", permission: "analytics.dashboard.view" },
        { label: "Lists to download or print", href: "/reports", permission: "analytics.report.view" },
        { label: "Compare over time", href: "/analytics/trends", permission: "analytics.dashboard.view" },
        { label: "Lists sent by email", href: "/reports/schedules", permission: "analytics.scheduled_report.view" },
        { label: "What each number means", href: "/analytics/definitions", permission: "analytics.kpi_definition.view" },
      ]),
    ],
  },
  {
    // Not a top-bar area: the avatar menu's "Set-up" opens /setup, which lists these by section.
    label: "Set-up",
    icon: "settings",
    description: "Products, recipes, people, settings and places",
    href: SETUP_HREF,
    items: [
      { label: "Set-up", href: SETUP_HREF },
      ...inSection("Products and recipes", [
        { label: "Products", href: "/masterdata/products", permission: "masterdata.product.view" },
        // Round 4 (UX re-audit C #5): the plain recipe list (one row per product; "New recipe" and the wizard open from it).
        { label: "Recipes", href: "/masterdata/recipes", permission: "masterdata.formula.view" },
        { label: "Materials", href: "/masterdata/materials", permission: "masterdata.material.view" },
        { label: "Prices", href: "/sales/price-lists", permission: "sales.price_list.view" },
        { label: "How-to sheets", href: "/masterdata/work-instructions", permission: "masterdata.work_instruction.view" },
        { label: "Quality checks for each item", href: "/masterdata/inspection-plans", permission: "quality.inspection_plan.view" },
        // The engineers' editing screens (the wizard is the way in).
        { label: "Recipes (advanced)", href: "/masterdata/formulas", permission: "masterdata.formula.view", advanced: true },
        { label: "Steps (advanced)", href: "/masterdata/routings", permission: "masterdata.routing.view", advanced: true },
      ]),
      ...inSection("Places and machines", [
        { label: "Shelves and areas (set up)", href: "/masterdata/locations", permission: "masterdata.location.view" },
        { label: "Equipment", href: "/masterdata/equipment", permission: "masterdata.equipment.view" },
        { label: "Sites", href: "/masterdata/sites", permission: "masterdata.site.view" },
        { label: "Warehouses", href: "/masterdata/warehouses", permission: "masterdata.warehouse.view" },
        { label: "Making areas / lines", href: "/masterdata/lines", permission: "masterdata.production_line.view" },
      ]),
      ...inSection(PEOPLE_SETTINGS, [
        { label: "People who use the app", href: "/admin/users", permission: "identity.user.view" },
        { label: "Roles (what each job may do)", href: "/admin/roles", permission: "identity.role.view" },
        { label: "Settings", href: "/admin/settings", permission: "platform.settings.view" },
        { label: "Who says OK to what", href: "/admin/approval-rules", permission: "platform.approval_rule.view" },
        { label: "Who gets which message", href: "/admin/notification-rules", permission: "platform.notification_rule.view" },
        { label: "Labels and printouts", href: "/admin/templates", permission: "masterdata.label_template.view" },
        { label: "How record numbers look", href: "/admin/numbering", permission: "platform.numbering_rule.view" },
        { label: "History of changes", href: "/admin/audit", permission: "platform.audit.view" },
      ]),
      ...inSection("Lists", [
        { label: "Units", href: "/masterdata/uom", permission: "masterdata.uom.view", advanced: true },
        { label: "Choice lists", href: "/masterdata/lists", permission: "masterdata.lookup_value.view", advanced: true },
        { label: "Reasons", href: "/masterdata/reason-codes", permission: "masterdata.reason_code.view", advanced: true },
      ]),
      // Rarely used IT screens, last, for the system admin and the owner only.
      ...inSection(
        IT_SYSTEM,
        [
          { label: "Health of the system", href: "/admin/diagnostics", permission: "platform.job.view" },
          { label: "Load data from a spreadsheet", href: "/admin/imports", permission: "platform.import_job.view" },
          { label: "Who is signed in", href: "/admin/sessions", permission: "identity.session.view" },
          { label: "Sign-in safety", href: "/admin/security", permission: "identity.user.admin" },
          { label: "Phones and tablets", href: "/admin/devices", permission: "platform.device.view" },
          { label: "Phone changes to check", href: "/sync/conflicts", permission: "platform.sync_conflict.view" },
          { label: "Keeping and deleting old records", href: "/admin/retention", permission: "platform.retention_policy.view" },
          { label: "Old paper documents", href: "/admin/imports/legacy-documents", permission: "documents.legacy_document.view" },
        ].map((i): NavItem => ({ ...i, permission: i.permission as Permission, roles: IT_ROLES, advanced: true })),
      ),
    ],
  },
];

/** The catalogue area that holds Set-up (avatar menu, /setup page). */
export const SETUP_AREA = "Set-up";

// ---------------------------------------------------------------- per role

type Can = (p: Permission) => boolean;

/** May this person see an entry needing `permission` (one, or any of a list)? */
export function canSee(can: Can, permission: NavItem["permission"]): boolean {
  if (!permission) return true;
  return typeof permission === "string" ? can(permission) : permission.some((p) => can(p));
}

/** Who the production screens are built for. Decided by permissions first (custom roles), roles second. */
export type ProductionPersona = "owner" | "planner" | "operator" | "warehouse" | "qa" | "viewer";

export function productionPersona(can: Can, roles: readonly string[]): ProductionPersona {
  if (roles.includes("owner_director")) return "owner";
  if (can("production.work_order.create") || can("production.work_order.approve")) return "planner";
  if (can("production.daily_log.create") || can("production.batch.edit") || roles.includes("production_operator")) return "operator";
  if (roles.includes("warehouse_operator") || (can("procurement.goods_receipt.create") && !can("procurement.purchase_order.create") && !can("quality.disposition.approve"))) return "warehouse";
  if (can("quality.disposition.approve")) return "qa";
  return "viewer";
}

/**
 * Whose menu a person gets (round 5). Role codes first, in this order (a person with two jobs gets the first),
 * then permissions for custom roles.
 */
export type NavPersona = "owner" | "manager" | "planner" | "qa" | "finance" | "purchasing" | "sales" | "warehouse" | "operator" | "admin" | "display" | "viewer";

const ROLE_PERSONA: readonly [string, NavPersona][] = [
  ["owner_director", "owner"],
  ["site_manager", "manager"],
  ["production_planner", "planner"],
  ["qa_qc", "qa"],
  ["finance", "finance"],
  ["procurement", "purchasing"],
  ["sales_cs", "sales"],
  ["warehouse_operator", "warehouse"],
  ["production_operator", "operator"],
  ["system_admin", "admin"],
];

export function navPersona(can: Can, roles: readonly string[]): NavPersona {
  for (const [role, persona] of ROLE_PERSONA) if (roles.includes(role)) return persona;
  if (roles.length > 0 && roles.every((r) => DISPLAY_ROLES.includes(r))) return "display";
  if (roles.includes("auditor")) return "viewer";
  // Custom roles: by what they may do.
  if (can("production.work_order.approve")) return "manager";
  if (can("production.work_order.create")) return "planner";
  if (can("quality.disposition.approve")) return "qa";
  if (can("finance.invoice.create") || can("finance.supplier_bill.create")) return "finance";
  if (can("procurement.purchase_order.create")) return "purchasing";
  if (can("sales.sales_order.create")) return "sales";
  const p = productionPersona(can, roles);
  if (p === "warehouse" || p === "operator") return p;
  return "viewer";
}

/** Floor people (A report): no tab rows, no menu button; four doors in the bottom bar; "All screens" in the avatar menu. */
export const FLOOR_PERSONAS: readonly NavPersona[] = ["operator", "warehouse"];
export const isFloor = (p: NavPersona) => FLOOR_PERSONAS.includes(p);

/** ADR-084: roles that only drive a wall screen. An account holding nothing else lands on the screen, not on Home. */
export const DISPLAY_ROLES: readonly string[] = ["floor_display"];

/** Where "Home" is for this person: "/floor" for the production TV, "/finance" for finance (C report), else "/dashboard". */
export function homeHref(roles: readonly string[]): string {
  if (roles.length > 0 && roles.every((r) => DISPLAY_ROLES.includes(r))) return "/floor";
  // Finance's Home is the Money page (C report #4). Only for people whose first job is finance.
  const first = ROLE_PERSONA.find(([r]) => roles.includes(r));
  if (first?.[1] === "finance") return "/finance";
  return "/dashboard";
}

/** One area of a persona's menu: its words, up to five tabs, and the flat "More" list (hrefs from the catalogue). */
type AreaSpec = { label: string; icon: string; description?: string; tabs: readonly string[]; more?: readonly string[]; /** "Home" area: the pill goes to the person's Home. */ home?: boolean };

const HOME_AREA: AreaSpec = { label: "Home", icon: "home", tabs: ["/dashboard"], home: true };
const NEEDS_ME: AreaSpec = { label: "Needs me", icon: "approve", tabs: ["/approvals", "/action-centre", "/notifications"] };

/** Owner and site manager (B report §Navigation): six areas organised by the owner's questions. */
const OWNER_AREAS: readonly AreaSpec[] = [
  HOME_AREA,
  NEEDS_ME,
  { label: "Sell", icon: "truck", tabs: ["/sales", "/sales/customers", "/sales/quotations", "/sales/shipments", "/sales/returns"], more: ["/sales/board", "/sales/picking", "/sales/dispatch", "/warehouse/packs"] },
  {
    label: "Make",
    icon: "factory",
    tabs: ["/operations", "/production/orders", "/production/plan", "/quality", "/quality/deviations"],
    more: ["/production", "/production/today", "/production/defects", "/operations/flow", "/quality/inspections", "/quality/holds", "/quality/trace", "/quality/complaints", "/quality/capa", "/quality/recalls", "/maintenance", "/maintenance/work-orders", "/maintenance/plans"],
  },
  {
    label: "Buy & stock",
    icon: "boxes",
    tabs: ["/inventory", "/procurement/reorder", "/procurement/orders", "/procurement/expected", "/procurement/suppliers"],
    more: ["/procurement/requests", "/inventory/receive", "/inventory/receipts", "/inventory/receive/put-away", "/inventory/move", "/warehouse", "/inventory/counts", "/inventory/adjustments", "/inventory/lots/expiry", "/inventory/availability", "/inventory/locations"],
  },
  { label: "Money", icon: "money", tabs: ["/finance", "/finance/invoices", "/finance/bills", "/finance/payments", "/analytics"], more: ["/finance/statements", "/finance/credit-notes", "/finance/expenses", "/analytics/overview", "/reports"] },
];

/** Sales (C report): orders, customers, price offers, invoices to look at. */
const SALES_AREAS: readonly AreaSpec[] = [
  HOME_AREA,
  { label: "Orders", icon: "truck", tabs: ["/sales", "/sales/board", "/sales/shipments"] },
  { label: "Customers", icon: "customer", tabs: ["/sales/customers", "/sales/price-lists", "/sales/returns"] },
  { label: "Price offers", icon: "order", tabs: ["/sales/quotations"] },
  { label: "Invoices", icon: "money", tabs: ["/finance/invoices"] },
];

/** Purchasing (C report): buying appears once, for everyone who buys. */
const PURCHASING_AREAS: readonly AreaSpec[] = [
  HOME_AREA,
  { label: "Buying", icon: "boxes", tabs: ["/procurement/reorder", "/procurement/requests", "/procurement/orders", "/procurement/expected", "/inventory/receipts"], more: ["/procurement/returns", "/procurement", "/procurement/forecast", "/inventory"] },
  { label: "Suppliers", icon: "supplier", tabs: ["/procurement/suppliers", "/procurement/performance"] },
];

/** Finance (C report): Home is the Money page. */
const FINANCE_AREAS: readonly AreaSpec[] = [
  HOME_AREA,
  { label: "Money in", icon: "money", tabs: ["/finance/invoices", "/finance/payments", "/finance/statements", "/finance/credit-notes"] },
  { label: "Money out", icon: "money", tabs: ["/finance/bills", "/finance/expenses"] },
  { label: "Month end", icon: "clock", tabs: ["/finance/periods", "/finance/tax"] },
  { label: "Reports", icon: "chart", tabs: ["/analytics", "/analytics/overview", "/reports"], more: ["/analytics/trends", "/reports/schedules", "/analytics/definitions"] },
];

/** QA (C report): check, problems, trace; no sales or management menus. */
const QA_AREAS: readonly AreaSpec[] = [
  HOME_AREA,
  { label: "Check", icon: "shield", tabs: ["/quality", "/quality/inspections", "/quality/holds", "/quality/bulk"], more: ["/production", "/inventory", "/quality/label-verification"] },
  { label: "Problems", icon: "alert", tabs: ["/quality/deviations", "/quality/capa", "/quality/complaints", "/quality/recalls", "/quality/changes"] },
  { label: "Trace", icon: "trace", tabs: ["/quality/trace", "/quality/recall"] },
];

/** Planner: the owner's areas (permissions drop what is not theirs). */
const PLANNER_AREAS = OWNER_AREAS;

/** Floor menus (drawer only, "All screens"): the screens they use, by place. */
const OPERATOR_AREAS: readonly AreaSpec[] = [
  HOME_AREA,
  { label: "My work", icon: "factory", tabs: ["/production/orders", "/production/today", "/inventory", "/inventory/scan"] },
];
const WAREHOUSE_AREAS: readonly AreaSpec[] = [
  HOME_AREA,
  { label: "Receiving", icon: "receive", tabs: ["/inventory/receive", "/inventory/receive/put-away", "/inventory/receipts", "/procurement/expected"] },
  { label: "Packing and sending", icon: "truck", tabs: ["/sales/picking", "/sales/dispatch", "/sales/shipments", "/warehouse/packs"], more: ["/warehouse/repack", "/quality/label-verification"] },
  { label: "Stock", icon: "boxes", tabs: ["/inventory", "/inventory/move", "/inventory/counts", "/inventory/adjustments", "/inventory/scan"], more: ["/warehouse", "/inventory/locations", "/inventory/containers", "/inventory/lots/expiry", "/inventory/lots/reservations", "/inventory/movements", "/inventory/availability"] },
];
const DISPLAY_AREAS: readonly AreaSpec[] = [{ label: "Make", icon: "factory", tabs: ["/floor"] }];

export const AREAS_BY_PERSONA: Readonly<Record<NavPersona, readonly AreaSpec[]>> = {
  owner: OWNER_AREAS,
  manager: OWNER_AREAS,
  planner: PLANNER_AREAS,
  viewer: OWNER_AREAS,
  admin: OWNER_AREAS,
  sales: SALES_AREAS,
  purchasing: PURCHASING_AREAS,
  finance: FINANCE_AREAS,
  qa: QA_AREAS,
  operator: OPERATOR_AREAS,
  warehouse: WAREHOUSE_AREAS,
  display: DISPLAY_AREAS,
};

/** Every catalogue entry by href. */
const BY_HREF: ReadonlyMap<string, { item: NavItem; group: NavGroup }> = new Map(NAV.flatMap((g) => g.items.map((i) => [i.href, { item: i, group: g }] as const)));

/** The catalogue entry of a screen. */
export const screenOf = (href: string) => BY_HREF.get(href)?.item;

/** May this person open the entry? Its permission (any of a list), and the IT entries' roles. */
export function mayOpen(can: Can, roles: readonly string[], i: NavItem): boolean {
  return !i.planned && canSee(can, i.permission) && (!i.roles || i.roles.some((r) => roles.includes(r)));
}

/**
 * The menu of one person: their persona's areas, each with the tabs and "More" entries they may open. An area with
 * nothing left is dropped (Home stays). Entries keep their catalogue words, so menu word = screen title everywhere.
 */
export function buildNav(can: Can, roles: readonly string[], opts: { approver?: boolean } = {}): NavGroup[] {
  const persona = navPersona(can, roles);
  const approver = opts.approver ?? true;
  const home = homeHref(roles);
  const ok = (i: NavItem) => mayOpen(can, roles, i) && (approver || !i.approverOnly);
  const out: NavGroup[] = [];
  for (const a of AREAS_BY_PERSONA[persona]) {
    const pick = (hrefs: readonly string[] | undefined, section?: string): NavItem[] =>
      (hrefs ?? [])
        .map((h) => BY_HREF.get(h)?.item)
        .filter((i): i is NavItem => !!i && ok(i))
        .map((i) => ({ ...i, section }));
    let tabs: NavItem[] = pick(a.tabs);
    // Home: the person's own Home (finance: the Money page).
    if (a.home) tabs = [{ label: "Home", href: home }];
    const more = pick(a.more, MORE).filter((i) => !tabs.some((t) => t.href === i.href));
    if (!a.home && tabs.length === 0 && more.length === 0) continue;
    const cat = NAV.find((g) => g.label === a.label);
    out.push({ label: a.label, icon: a.icon, description: a.description ?? cat?.description ?? "", items: [...tabs.slice(0, MAX_TABS), ...tabs.slice(MAX_TABS).map((i) => ({ ...i, section: MORE })), ...more], href: a.home ? home : undefined });
  }
  // A finance person's Home is the Money page: it is not listed again in another area.
  return out;
}

/** The Set-up screens this person may open, by section (the avatar menu's Set-up page). */
export function setupSections(can: Can, roles: readonly string[]): { name: string; items: NavItem[] }[] {
  const g = NAV.find((x) => x.label === SETUP_AREA)!;
  const names: string[] = [];
  for (const i of g.items) if (i.section && !names.includes(i.section)) names.push(i.section);
  return names.map((name) => ({ name, items: g.items.filter((i) => i.section === name && mayOpen(can, roles, i)) })).filter((s) => s.items.length > 0);
}

/** The landing page of an area: its own href, its hub, else its first live item. */
export function groupHref(g: NavGroup): string {
  return g.href ?? g.items.find((i) => i.hub)?.href ?? g.items.find((i) => !i.planned)?.href ?? "#";
}

export type NavSection = { name: string; items: NavItem[] };

/** An area's tabs (no section) and its flat "More" list. */
export function groupSections(g: NavGroup): { main: NavItem[]; sections: NavSection[] } {
  const live = g.items.filter((i) => !i.planned || i.section);
  const order: string[] = [];
  for (const i of live) if (i.section && !order.includes(i.section)) order.push(i.section);
  return { main: live.filter((i) => !i.section), sections: order.map((name) => ({ name, items: live.filter((i) => i.section === name) })) };
}

/** How long a path matches a menu href (exact beats prefix); -1 = no match. */
export function matchLen(pathname: string, href: string): number {
  const path = href.split("?")[0];
  if (path === "#") return -1;
  if (pathname === path) return path.length + 1000;
  if (pathname.startsWith(path + "/")) return path.length;
  return -1;
}

/**
 * Which of the person's areas a page belongs to, and which entry lights up. The person's own menu first (the most
 * specific entry wins); a page that is not in their menu lights the area that holds it in the catalogue, if they have
 * that area (a batch record lights Make, never Management or Set-up).
 */
export function activeEntry(nav: readonly NavGroup[], pathname: string): { group: NavGroup | undefined; href: string } {
  let group: NavGroup | undefined;
  let href = "";
  let best = -1;
  for (const g of nav)
    for (const i of g.items) {
      const m = matchLen(pathname, i.href);
      if (m > best) {
        best = m;
        group = g;
        href = i.href;
      }
    }
  let cat: NavGroup | undefined;
  let catBest = -1;
  for (const g of NAV)
    for (const i of g.items) {
      const m = matchLen(pathname, i.href);
      if (m > catBest) {
        catBest = m;
        cat = g;
      }
    }
  // A more specific screen of its own (Scan or search under Stock) does not light the shorter tab it starts with.
  if (group && best >= catBest) return { group, href };
  return { group: cat ? nav.find((g) => g.label === cat!.label) : undefined, href: "" };
}

/** One tab of the bottom bar (phones and tablets). */
export type Tab = {
  label: string;
  href: string;
  icon: "home" | "today" | "scan" | "help" | "factory" | "truck" | "approve" | "shield" | "boxes" | "receive" | "money" | "customer" | "order" | "trace" | "alert" | "chart" | "clock" | "supplier";
  permission?: Permission;
  /** The "Needs me" / "To check/approve" tab: its badge counts approvals and unread messages. */
  needsMe?: boolean;
};

/**
 * Bottom bar per role (round 5). Floor roles: four doors and no menu button (A report §4). Owner: Home · Needs me ·
 * Sell · Make · Money (B report). Site manager on the floor: My jobs · Scan · To check/approve · Help (A report).
 * Office roles: Home and their areas. Everyone else opens the full menu with the one ☰ button in the top bar.
 */
export function tabsFor(can: Can, roles: readonly string[]): Tab[] {
  const persona = navPersona(can, roles);
  const home = homeHref(roles);
  const scan: Tab = { label: "Scan", href: "/inventory/scan", icon: "scan" };
  const help: Tab = { label: "Help", href: "/help", icon: "help" };
  const myJobs: Tab = { label: "My jobs", href: home, icon: "home" };
  const homeTab: Tab = { label: "Home", href: home, icon: "home" };
  const tabs: Tab[] =
    persona === "operator"
      ? [myJobs, scan, { label: "Batches", href: "/production/orders", icon: "factory", permission: "production.work_order.view" }, help]
      : persona === "warehouse"
        ? [myJobs, scan, { label: "Receive", href: "/inventory/receive", icon: "receive", permission: "procurement.goods_receipt.create" }, help]
        : persona === "manager"
          ? [myJobs, scan, { label: "To check/approve", href: "/approvals", icon: "approve", needsMe: true }, help]
          : persona === "owner" || persona === "planner" || persona === "viewer" || persona === "admin"
            ? [homeTab, { label: "Needs me", href: "/approvals", icon: "approve", needsMe: true }, { label: "Sell", href: "/sales", icon: "truck", permission: "sales.sales_order.view" }, { label: "Make", href: "/operations", icon: "factory" }, { label: "Money", href: "/finance", icon: "money", permission: "finance.invoice.view" }]
            : persona === "sales"
              ? [homeTab, { label: "Orders", href: "/sales", icon: "truck", permission: "sales.sales_order.view" }, { label: "Customers", href: "/sales/customers", icon: "customer", permission: "masterdata.customer.view" }, { label: "Price offers", href: "/sales/quotations", icon: "order", permission: "sales.quote.view" }]
              : persona === "purchasing"
                ? [homeTab, { label: "What to buy", href: "/procurement/reorder", icon: "boxes", permission: "procurement.reorder_suggestion.view" }, { label: "Purchase orders", href: "/procurement/orders", icon: "order", permission: "procurement.purchase_order.view" }, { label: "Suppliers", href: "/procurement/suppliers", icon: "supplier", permission: "masterdata.supplier.view" }]
                : persona === "finance"
                  ? [homeTab, { label: "Money in", href: "/finance/invoices", icon: "money", permission: "finance.invoice.view" }, { label: "Money out", href: "/finance/bills", icon: "money", permission: "finance.supplier_bill.view" }, { label: "Reports", href: "/analytics", icon: "chart", permission: "analytics.dashboard.view" }]
                  : persona === "qa"
                    ? [homeTab, { label: "Check", href: "/quality", icon: "shield", permission: "quality.disposition.view" }, { label: "Problems", href: "/quality/deviations", icon: "alert", permission: "quality.deviation.view" }, { label: "Trace", href: "/quality/trace", icon: "trace", permission: "quality.genealogy.view" }]
                    : [homeTab];
  return tabs.filter((t) => !t.permission || can(t.permission));
}

/**
 * ADR-082: does this person get "To approve"? Always when something waits for them; otherwise only
 * office roles holding an `*.approve` permission. Floor roles' approvals (checker sign-off, pack check)
 * happen on the tablet at the step, not in the inbox.
 */
export function isApprover(can: Can, roles: readonly string[], permissions: Iterable<string>, waiting: number): boolean {
  if (waiting > 0) return true;
  if (isFloor(navPersona(can, roles))) return false;
  for (const p of permissions) if (p.endsWith(".approve")) return true;
  return false;
}

/** The sidebar's entries of one area (ADR-136): its tabs, then its "More" entries, as one flat list (no dropdowns). */
export function groupEntries(g: NavGroup): NavItem[] {
  const { main, sections } = groupSections(g);
  return [...main, ...sections.flatMap((s) => s.items)];
}

export type Crumb = { label: string; href?: string };

/**
 * The breadcrumb of the top bar (ADR-136): Section / Page, from the person's own menu first, else from the catalogue
 * (a page outside their menu still says where it lives). `exact` is false on a page below the entry (a record, a
 * form): the shell then adds the record's number or the page's own title as the last crumb.
 */
export function crumbsFor(nav: readonly NavGroup[], pathname: string): { crumbs: Crumb[]; exact: boolean } {
  const { group, href } = activeEntry(nav, pathname);
  let item = href ? group?.items.find((i) => i.href === href) : undefined;
  let section = group?.label;
  if (!item) {
    let best = -1;
    for (const g of NAV)
      for (const i of g.items) {
        const m = matchLen(pathname, i.href);
        if (m > best) {
          best = m;
          item = i;
          section = group?.label ?? g.label;
        }
      }
  }
  if (!item) return { crumbs: section ? [{ label: section }] : [], exact: false };
  const path = item.href.split("?")[0];
  const exact = pathname === path;
  const crumbs: Crumb[] = [];
  // "Home / Home" says nothing: an area with the same word as its page shows once.
  if (section && section !== item.label) crumbs.push({ label: section });
  crumbs.push({ label: item.label, href: exact ? undefined : item.href });
  return { crumbs, exact };
}

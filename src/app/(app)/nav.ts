import type { Permission } from "@/lib/permissions";

/** `section`: items shown under a "Setup" heading, or in the collapsed "Advanced" group (ADR-080 §11). */
export type NavItem = { label: string; href: string; permission?: Permission; planned?: string; section?: "setup" | "advanced" };
export type NavGroup = { label: string; icon: string; items: NavItem[] };
export type QuickAction = { label: string; href: string; icon: string; permission?: Permission };

/** Live counts shown as a badge on the matching rail icon, phone tab and sub-tab (keyed by href). */
export type NavBadges = Partial<Record<string, number>>;

/** Round icon rail (Dribbble reference): the most common operator actions, one tap away. */
export const QUICK_ACTIONS: QuickAction[] = [
  { label: "To approve", href: "/approvals", icon: "approve" }, // ADR-075
  { label: "Scan or look up", href: "/inventory/scan", icon: "scan", permission: "inventory.lot.view" },
  { label: "Receive materials", href: "/inventory/receive", icon: "receive", permission: "procurement.goods_receipt.create" },
  // ADR-074: a production order creates its batch on approval; operators never "create a batch".
  { label: "New production order", href: "/production/orders/new", icon: "batch", permission: "production.work_order.create" },
  { label: "QA queue", href: "/quality", icon: "qa", permission: "quality.disposition.view" },
  { label: "New sales order", href: "/sales/new", icon: "order", permission: "sales.sales_order.create" },
  { label: "Traceability", href: "/quality/trace", icon: "trace", permission: "quality.genealogy.view" },
  { label: "Audit log", href: "/admin/audit", icon: "audit", permission: "platform.audit.view" },
];

/** Production setup (owner: "Setup" heading; other roles: inside Advanced). */
const SETUP_ITEMS: NavItem[] = [
  { label: "Products and formulas", href: "/masterdata/formulas", permission: "masterdata.formula.view" },
  { label: "Steps for each product", href: "/masterdata/routings", permission: "masterdata.routing.view" },
  { label: "Work instructions", href: "/masterdata/work-instructions", permission: "masterdata.work_instruction.view" },
  { label: "Equipment", href: "/masterdata/equipment", permission: "masterdata.equipment.view" },
];

/** The old detailed production screens, collapsed under "Advanced" (ADR-080 §11; V2-10 hides/redirects them later). */
const ADVANCED_ITEMS: NavItem[] = [
  { label: "Production plan", href: "/production/plan", permission: "production.production_plan.view", section: "advanced" },
  { label: "Work orders (detailed)", href: "/production/work-orders", permission: "production.work_order.view", section: "advanced" },
  { label: "Board (detailed)", href: "/production/board", permission: "production.work_order.view", section: "advanced" },
  { label: "Batches (full record)", href: "/production", permission: "production.batch.view", section: "advanced" },
  { label: "Materials by scan", href: "/production/staging", permission: "inventory.movement.post", section: "advanced" },
  { label: "New batch without an order", href: "/production/new", permission: "production.batch.create", section: "advanced" },
];

/** Left navigation (ux-system §3). Planned modules are shown disabled with their phase, never as fake links. */
export const NAV: NavGroup[] = [
  { label: "Home", icon: "home", items: [{ label: "Overview", href: "/dashboard" }, { label: "To approve", href: "/approvals" }, { label: "Action centre", href: "/action-centre" }, { label: "Dashboards", href: "/analytics", permission: "analytics.dashboard.view" }, { label: "Trends", href: "/analytics/trends", permission: "analytics.dashboard.view" }, { label: "KPI definitions", href: "/analytics/definitions", permission: "analytics.kpi_definition.view" }, { label: "Notifications", href: "/notifications" }, { label: "Help & guides", href: "/help" }, { label: "My account", href: "/account" }, { label: "Sync & offline", href: "/sync" }] },
  {
    // Stock visibility: what is where, in which status, and what is free to use.
    label: "Inventory",
    icon: "boxes",
    items: [
      { label: "Lots & stock", href: "/inventory", permission: "inventory.lot.view" },
      { label: "Locations & stock", href: "/inventory/locations", permission: "masterdata.location.view" },
      { label: "Boxes", href: "/inventory/containers", permission: "inventory.container.view" },
      { label: "Availability", href: "/inventory/availability", permission: "inventory.balance.view" },
      { label: "Expiry alerts", href: "/inventory/lots/expiry", permission: "inventory.lot.view" },
      { label: "FEFO & reservations", href: "/inventory/lots/reservations", permission: "inventory.lot.view" },
      { label: "Stock movements", href: "/inventory/movements", permission: "inventory.movement.view" },
    ],
  },
  {
    // Warehouse operations: the tasks that change stock, in the order goods flow through the site.
    label: "Warehouse",
    icon: "warehouse",
    items: [
      { label: "Warehouse sections", href: "/warehouse", permission: "inventory.lot.view" }, // S6 (ADR-077)
      { label: "Receive materials", href: "/inventory/receive", permission: "procurement.goods_receipt.create" },
      { label: "Expected receipts", href: "/procurement/expected", permission: "procurement.purchase_order.view" }, // W4A
      { label: "Goods receipts", href: "/inventory/receipts", permission: "procurement.goods_receipt.view" },
      { label: "Put away", href: "/inventory/receive/put-away", permission: "inventory.movement.post" },
      { label: "Scan to move", href: "/inventory/move", permission: "inventory.movement.post" },
      { label: "Scan / look up", href: "/inventory/scan", permission: "inventory.lot.view" },
      { label: "Stock counts", href: "/inventory/counts", permission: "inventory.stock_count.view" },
      { label: "Adjustments", href: "/inventory/adjustments", permission: "inventory.adjustment.view" },
      { label: "Label print station", href: "/labels", permission: "inventory.label_job.view" },
      { label: "Label verification", href: "/quality/label-verification", permission: "inventory.container.edit" },
      // Wave 3 W3E: boxing and fulfilment
      { label: "Boxing", href: "/warehouse/packs", permission: "inventory.pack.view" },
      { label: "Repack for a customer", href: "/warehouse/repack", permission: "inventory.container.edit" },
      { label: "Picking", href: "/sales/picking", permission: "sales.pick.view" },
      { label: "Dispatch", href: "/sales/dispatch", permission: "sales.shipment.view" },
    ],
  },
  {
    // ADR-080 §11: the Production group is built per role by productionItems(); this is the full list
    // (used by tests and as the source of every production entry). Maintenance has its own group.
    label: "Production",
    icon: "factory",
    items: [
      { label: "Orders", href: "/production/orders", permission: "production.work_order.view" },
      { label: "Today", href: "/production/today", permission: "production.daily_log.view" },
      { label: "Rejects", href: "/production/defects", permission: "production.daily_log.view" },
      { label: "New order", href: "/production/orders/new", permission: "production.work_order.create" },
      ...SETUP_ITEMS.map((i) => ({ ...i, section: "setup" as const })),
      ...ADVANCED_ITEMS,
    ],
  },
  {
    // ADR-080 §11: Maintenance leaves Production (UX review §5.1).
    label: "Maintenance",
    icon: "wrench",
    items: [
      // Wave 4 W4C: equipment maintenance (US-6-19)
      { label: "Maintenance", href: "/maintenance", permission: "maintenance.work_order.view" },
      { label: "PM plans", href: "/maintenance/plans", permission: "maintenance.plan.view" },
      { label: "Maintenance work orders", href: "/maintenance/work-orders", permission: "maintenance.work_order.view" },
      { label: "Spare parts", href: "/maintenance/spare-parts", permission: "maintenance.spare_part.view" },
    ],
  },
  {
    label: "Quality",
    icon: "shield",
    items: [
      // ADR-080 G3: the one-page check of finished batches comes first for QA.
      { label: "Waiting for check", href: "/quality/check", permission: "quality.disposition.view" },
      { label: "QA queue", href: "/quality", permission: "quality.disposition.view" },
      { label: "Inspections", href: "/quality/inspections", permission: "quality.inspection.view" },
      { label: "Deviations", href: "/quality/deviations", permission: "quality.deviation.view" },
      { label: "QA holds", href: "/quality/holds", permission: "quality.hold.view" },
      { label: "Bulk disposition", href: "/quality/bulk", permission: "quality.disposition.approve" },
      { label: "Traceability", href: "/quality/trace", permission: "quality.genealogy.view" },
      // Wave 3 W3F
      { label: "Complaints", href: "/quality/complaints", permission: "quality.complaint.view" },
      { label: "Recall explorer", href: "/quality/recall", permission: "quality.genealogy.view" },
      // Wave 4 W4C: CAPA, change control, recall cases (US-6-18)
      { label: "CAPA", href: "/quality/capa", permission: "quality.capa.view" },
      { label: "Change control", href: "/quality/changes", permission: "quality.change_control.view" },
      { label: "Recall cases", href: "/quality/recalls", permission: "quality.recall_case.view" },
      { label: "Inspection plans", href: "/masterdata/inspection-plans", permission: "quality.inspection_plan.view" },
    ],
  },
  {
    label: "Sales",
    icon: "truck",
    items: [
      { label: "Sales orders", href: "/sales", permission: "sales.sales_order.view" },
      { label: "New order", href: "/sales/new", permission: "sales.sales_order.create" },
      { label: "Customers", href: "/sales/customers", permission: "masterdata.customer.view" },
      // Wave 3 W3D: board, quotations, price lists
      { label: "Order board", href: "/sales/board", permission: "sales.sales_order.view" },
      { label: "Quotations", href: "/sales/quotations", permission: "sales.quote.view" },
      { label: "Price lists", href: "/sales/price-lists", permission: "sales.price_list.view" },
      { label: "Shipments", href: "/sales/shipments", permission: "sales.shipment.view" }, // W3E
      // Wave 3 W3F
      { label: "Customer returns", href: "/sales/returns", permission: "sales.customer_return.view" },
    ],
  },
  {
    // Wave 4 W4A: procurement (E-6-01)
    label: "Procurement",
    icon: "order",
    items: [
      { label: "Overview", href: "/procurement", permission: "procurement.purchase_request.view" },
      { label: "Purchase requests", href: "/procurement/requests", permission: "procurement.purchase_request.view" },
      { label: "Purchase orders", href: "/procurement/orders", permission: "procurement.purchase_order.view" },
      { label: "Supplier returns", href: "/procurement/returns", permission: "procurement.supplier_return.view" },
      { label: "Approved suppliers", href: "/procurement/suppliers", permission: "masterdata.supplier.view" },
      { label: "Reorder suggestions", href: "/procurement/reorder", permission: "procurement.reorder_suggestion.view" },
      { label: "Supplier performance", href: "/procurement/performance", permission: "procurement.supplier_performance.view" },
      { label: "Forecast assumptions", href: "/procurement/forecast", permission: "analytics.forecast.view" },
    ],
  },
  {
    // Wave 4 W4B: operational finance (ADR-020; US-6-10..14)
    label: "Finance",
    icon: "audit",
    items: [
      { label: "Finance overview", href: "/finance", permission: "finance.invoice.view" },
      { label: "Invoices", href: "/finance/invoices", permission: "finance.invoice.view" },
      { label: "Statements", href: "/finance/statements", permission: "finance.invoice.view" },
      { label: "Payments", href: "/finance/payments", permission: "finance.payment_record.view" },
      { label: "Credit notes", href: "/finance/credit-notes", permission: "finance.credit_note.view" },
      { label: "Supplier bills", href: "/finance/bills", permission: "finance.supplier_bill.view" },
      { label: "Expense claims", href: "/finance/expenses", permission: "finance.expense_claim.create" },
      { label: "Expense approvals", href: "/finance/expenses?status=to_approve", permission: "finance.expense_claim.approve" },
      { label: "Periods and locks", href: "/finance/periods", permission: "finance.period_lock.view" },
      { label: "Tax configuration", href: "/finance/tax", permission: "finance.tax_config.view" },
    ],
  },
  {
    // Wave 3 W3B: report library and scheduled delivery (US-5-04, US-5-05)
    label: "Reports",
    icon: "audit",
    items: [
      { label: "Report library", href: "/reports", permission: "analytics.report.view" },
      { label: "Scheduled reports", href: "/reports/schedules", permission: "analytics.scheduled_report.view" },
    ],
  },
  {
    label: "Master data",
    icon: "database",
    items: [
      { label: "Materials", href: "/masterdata/materials", permission: "masterdata.material.view" },
      { label: "Products", href: "/masterdata/products", permission: "masterdata.product.view" },
      { label: "Locations", href: "/masterdata/locations", permission: "masterdata.location.view" },
      { label: "Suppliers", href: "/masterdata/suppliers", permission: "masterdata.supplier.view" },
      // Wave 2 W2G: master data administration
      { label: "Sites", href: "/masterdata/sites", permission: "masterdata.site.view" },
      { label: "Warehouses", href: "/masterdata/warehouses", permission: "masterdata.warehouse.view" },
      { label: "Production lines", href: "/masterdata/lines", permission: "masterdata.production_line.view" },
      { label: "Units of measure", href: "/masterdata/uom", permission: "masterdata.uom.view" },
      { label: "Lists", href: "/masterdata/lists", permission: "masterdata.lookup_value.view" },
      { label: "Reason codes", href: "/masterdata/reason-codes", permission: "masterdata.reason_code.view" },
    ],
  },
  {
    label: "Admin",
    icon: "settings",
    items: [
      { label: "Users", href: "/admin/users", permission: "identity.user.view" },
      { label: "Roles", href: "/admin/roles", permission: "identity.role.view" },
      { label: "Sessions", href: "/admin/sessions", permission: "identity.session.view" },
      { label: "Security", href: "/admin/security", permission: "identity.user.admin" },
      { label: "Audit log", href: "/admin/audit", permission: "platform.audit.view" },
      { label: "Templates & labels", href: "/admin/templates", permission: "masterdata.label_template.view" },
      { label: "Diagnostics", href: "/admin/diagnostics", permission: "platform.job.view" },
      { label: "Settings", href: "/admin/settings", permission: "platform.settings.view" },
      { label: "Approval rules", href: "/admin/approval-rules", permission: "platform.approval_rule.view" },
      { label: "Numbering", href: "/admin/numbering", permission: "platform.numbering_rule.view" },
      // Wave 3 W3C: import wizard and legacy documents
      { label: "Imports", href: "/admin/imports", permission: "platform.import_job.view" },
      { label: "Legacy documents", href: "/admin/imports/legacy-documents", permission: "documents.legacy_document.view" },
      { label: "Notification rules", href: "/admin/notification-rules", permission: "platform.notification_rule.view" },
      // Wave 4 W4D: offline devices and the sync conflict queue
      { label: "Devices", href: "/admin/devices", permission: "platform.device.view" },
      { label: "Sync conflicts", href: "/sync/conflicts", permission: "platform.sync_conflict.view" },
      // Wave 4 W4F: retention, legal holds, purge runs, restore drills
      { label: "Retention & holds", href: "/admin/retention", permission: "platform.retention_policy.view" },
    ],
  },
  {
    label: "Coming next",
    icon: "clock",
    items: [
      { label: "HR & attendance", href: "#", planned: "Phase 5–6" },
    ],
  },
];

// ---------------------------------------------------------------- per role (ADR-080 §11, UX review §5)

type Can = (p: Permission) => boolean;

/** Who the production screens are built for. Decided by permissions first (custom roles), roles second. */
export type ProductionPersona = "owner" | "planner" | "operator" | "qa" | "viewer";

export function productionPersona(can: Can, roles: readonly string[]): ProductionPersona {
  if (roles.includes("owner_director")) return "owner";
  if (can("production.work_order.create") || can("production.work_order.approve")) return "planner";
  if (can("production.daily_log.create") || can("production.batch.edit") || roles.includes("production_operator") || roles.includes("warehouse_operator")) return "operator";
  if (can("quality.disposition.approve")) return "qa";
  return "viewer";
}

/** The Production menu of one person: operators "My work" and "Today"; owner/planner Orders, Today, Rejects, New order, Setup; old screens under Advanced. */
export function productionItems(persona: ProductionPersona): NavItem[] {
  const main: NavItem[] =
    persona === "operator"
      ? [
          { label: "My work", href: "/production/orders", permission: "production.work_order.view" },
          { label: "Today", href: "/production/today", permission: "production.daily_log.view" },
        ]
      : [
          { label: "Orders", href: "/production/orders", permission: "production.work_order.view" },
          { label: "Today", href: "/production/today", permission: "production.daily_log.view" },
          { label: "Rejects", href: "/production/defects", permission: "production.daily_log.view" },
          { label: "New order", href: "/production/orders/new", permission: "production.work_order.create" },
        ];
  const setup = SETUP_ITEMS.map((i) => ({ ...i, section: persona === "owner" ? ("setup" as const) : ("advanced" as const) }));
  return [...main, ...setup, ...ADVANCED_ITEMS];
}

/** The menu of one person: groups filtered by permission, with the Production group built per role. */
export function buildNav(can: Can, roles: readonly string[]): NavGroup[] {
  const persona = productionPersona(can, roles);
  return NAV.map((g) => (g.label === "Production" ? { ...g, items: productionItems(persona) } : g))
    .map((g) => ({ ...g, items: g.items.filter((i) => i.planned || !i.permission || can(i.permission)) }))
    .filter((g) => g.items.length > 0);
}

/** One tab of the bottom bar (phone and iPad portrait). `href: null` = the Menu tab, which opens the drawer. */
export type Tab = { label: string; href: string | null; icon: "home" | "today" | "scan" | "help" | "factory" | "truck" | "approve" | "shield" | "menu"; permission?: Permission };

/**
 * Bottom tab bar per role (UX review §5.2). Never "Batches", never a bare "Orders": production is
 * "Production" (the production orders), sales is "Sales".
 */
export function tabsFor(can: Can, roles: readonly string[]): Tab[] {
  const persona = productionPersona(can, roles);
  const home: Tab = { label: "Home", href: "/dashboard", icon: "home" };
  const menu: Tab = { label: "Menu", href: null, icon: "menu" };
  const production: Tab = { label: "Production", href: "/production/orders", icon: "factory", permission: "production.work_order.view" };
  const scan: Tab = { label: "Scan", href: "/inventory/scan", icon: "scan", permission: "inventory.lot.view" };
  const tabs: Tab[] =
    persona === "operator"
      ? [home, { label: "Today", href: "/production/today", icon: "today", permission: "production.daily_log.view" }, scan, { label: "Help", href: "/help", icon: "help" }]
      : persona === "qa"
        ? [home, { label: "Quality check", href: "/quality/check", icon: "shield", permission: "quality.disposition.view" }, production, scan, menu]
        : persona === "viewer"
          ? [home, production, { label: "Sales", href: "/sales", icon: "truck", permission: "sales.sales_order.view" }, scan, menu]
          : [home, production, { label: "Sales", href: "/sales", icon: "truck", permission: "sales.sales_order.view" }, { label: "To approve", href: "/approvals", icon: "approve" }, menu];
  return tabs.filter((t) => !t.permission || can(t.permission));
}

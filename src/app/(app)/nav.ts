import type { Permission } from "@/lib/permissions";

export type NavItem = { label: string; href: string; permission?: Permission; planned?: string };
export type NavGroup = { label: string; icon: string; items: NavItem[] };
export type QuickAction = { label: string; href: string; icon: string; permission?: Permission };

/** Live counts shown as a badge on the matching rail icon, phone tab and sub-tab (keyed by href). */
export type NavBadges = Partial<Record<string, number>>;

/** Round icon rail (Dribbble reference): the most common operator actions, one tap away. */
export const QUICK_ACTIONS: QuickAction[] = [
  { label: "Scan or look up", href: "/inventory/scan", icon: "scan", permission: "inventory.lot.view" },
  { label: "Receive materials", href: "/inventory/receive", icon: "receive", permission: "procurement.goods_receipt.create" },
  { label: "New batch", href: "/production/new", icon: "batch", permission: "production.batch.create" },
  { label: "QA queue", href: "/quality", icon: "qa", permission: "quality.disposition.view" },
  { label: "New sales order", href: "/sales/new", icon: "order", permission: "sales.sales_order.create" },
  { label: "Traceability", href: "/quality/trace", icon: "trace", permission: "quality.genealogy.view" },
  { label: "Audit log", href: "/admin/audit", icon: "audit", permission: "platform.audit.view" },
];

/** Left navigation (ux-system §3). Planned modules are shown disabled with their phase, never as fake links. */
export const NAV: NavGroup[] = [
  { label: "Home", icon: "home", items: [{ label: "Overview", href: "/dashboard" }, { label: "Notifications", href: "/notifications" }, { label: "Help & guides", href: "/help" }, { label: "My account", href: "/account" }] },
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
      { label: "Receive materials", href: "/inventory/receive", permission: "procurement.goods_receipt.create" },
      { label: "Goods receipts", href: "/inventory/receipts", permission: "procurement.goods_receipt.view" },
      { label: "Put away", href: "/inventory/receive/put-away", permission: "inventory.movement.post" },
      { label: "Scan to move", href: "/inventory/move", permission: "inventory.movement.post" },
      { label: "Scan / look up", href: "/inventory/scan", permission: "inventory.lot.view" },
      { label: "Stock counts", href: "/inventory/counts", permission: "inventory.stock_count.view" },
      { label: "Adjustments", href: "/inventory/adjustments", permission: "inventory.adjustment.view" },
      { label: "Label print station", href: "/labels", permission: "inventory.label_job.view" },
      { label: "Label verification", href: "/quality/label-verification", permission: "inventory.container.edit" },
    ],
  },
  {
    label: "Production",
    icon: "factory",
    items: [
      { label: "Board", href: "/production/board", permission: "production.work_order.view" },
      { label: "Work orders", href: "/production/work-orders", permission: "production.work_order.view" },
      { label: "Production plan", href: "/production/plan", permission: "production.production_plan.view" },
      { label: "Stage materials", href: "/production/staging", permission: "inventory.movement.post" },
      { label: "Batches", href: "/production", permission: "production.batch.view" },
      { label: "New batch", href: "/production/new", permission: "production.batch.create" },
      { label: "Formulas", href: "/masterdata/formulas", permission: "masterdata.formula.view" },
      { label: "Routings", href: "/masterdata/routings", permission: "masterdata.routing.view" },
      { label: "Work instructions", href: "/masterdata/work-instructions", permission: "masterdata.work_instruction.view" },
      { label: "Equipment", href: "/masterdata/equipment", permission: "masterdata.equipment.view" },
    ],
  },
  {
    label: "Quality",
    icon: "shield",
    items: [
      { label: "QA queue", href: "/quality", permission: "quality.disposition.view" },
      { label: "Inspections", href: "/quality/inspections", permission: "quality.inspection.view" },
      { label: "Deviations", href: "/quality/deviations", permission: "quality.deviation.view" },
      { label: "QA holds", href: "/quality/holds", permission: "quality.hold.view" },
      { label: "Bulk disposition", href: "/quality/bulk", permission: "quality.disposition.approve" },
      { label: "Traceability", href: "/quality/trace", permission: "quality.genealogy.view" },
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
    ],
  },
  {
    label: "Coming next",
    icon: "clock",
    items: [
      { label: "Procurement", href: "#", planned: "Phase 6" },
      { label: "HR & attendance", href: "#", planned: "Phase 5–6" },
      { label: "Finance", href: "#", planned: "Phase 6" },
      { label: "Offline mode", href: "#", planned: "Phase 7" },
      { label: "Customer portal", href: "#", planned: "Phase 8" },
    ],
  },
];

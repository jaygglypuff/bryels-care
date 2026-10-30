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
  // ADR-074: a production order creates its batch on approval; operators never "create a batch".
  { label: "New production order", href: "/production/orders/new", icon: "batch", permission: "production.work_order.create" },
  { label: "QA queue", href: "/quality", icon: "qa", permission: "quality.disposition.view" },
  { label: "New sales order", href: "/sales/new", icon: "order", permission: "sales.sales_order.create" },
  { label: "Traceability", href: "/quality/trace", icon: "trace", permission: "quality.genealogy.view" },
  { label: "Audit log", href: "/admin/audit", icon: "audit", permission: "platform.audit.view" },
];

/** Left navigation (ux-system §3). Planned modules are shown disabled with their phase, never as fake links. */
export const NAV: NavGroup[] = [
  { label: "Home", icon: "home", items: [{ label: "Overview", href: "/dashboard" }, { label: "Action centre", href: "/action-centre" }, { label: "Dashboards", href: "/analytics", permission: "analytics.dashboard.view" }, { label: "Trends", href: "/analytics/trends", permission: "analytics.dashboard.view" }, { label: "KPI definitions", href: "/analytics/definitions", permission: "analytics.kpi_definition.view" }, { label: "Notifications", href: "/notifications" }, { label: "Help & guides", href: "/help" }, { label: "My account", href: "/account" }, { label: "Sync & offline", href: "/sync" }] },
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
    label: "Production",
    icon: "factory",
    items: [
      // ADR-074: one production order from ordering to done comes first; the detailed screens follow.
      { label: "Production orders", href: "/production/orders", permission: "production.work_order.view" },
      { label: "Defects", href: "/production/defects", permission: "production.daily_log.view" },
      { label: "Stage materials", href: "/production/staging", permission: "inventory.movement.post" },
      { label: "Batches", href: "/production", permission: "production.batch.view" },
      { label: "Board (detailed)", href: "/production/board", permission: "production.work_order.view" },
      { label: "Work orders (detailed)", href: "/production/work-orders", permission: "production.work_order.view" },
      { label: "Production plan", href: "/production/plan", permission: "production.production_plan.view" },
      { label: "New batch (advanced)", href: "/production/new", permission: "production.batch.create" },
      { label: "Formulas", href: "/masterdata/formulas", permission: "masterdata.formula.view" },
      { label: "Routings", href: "/masterdata/routings", permission: "masterdata.routing.view" },
      { label: "Work instructions", href: "/masterdata/work-instructions", permission: "masterdata.work_instruction.view" },
      { label: "Equipment", href: "/masterdata/equipment", permission: "masterdata.equipment.view" },
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

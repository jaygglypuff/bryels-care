import type { Permission } from "@/lib/permissions";

export type NavItem = { label: string; href: string; permission?: Permission; planned?: string };
export type NavGroup = { label: string; icon: string; items: NavItem[] };
export type QuickAction = { label: string; href: string; icon: string; permission?: Permission };

/** Round icon rail (Dribbble reference): the most common operator actions, one tap away. */
export const QUICK_ACTIONS: QuickAction[] = [
  { label: "Scan or look up", href: "/inventory/scan", icon: "scan", permission: "inventory.lot.view" },
  { label: "Receive materials", href: "/inventory/receive", icon: "receive", permission: "inventory.receipt.post" },
  { label: "New batch", href: "/production/new", icon: "batch", permission: "production.batch.create" },
  { label: "QA queue", href: "/quality", icon: "qa", permission: "quality.disposition.view" },
  { label: "New sales order", href: "/sales/new", icon: "order", permission: "sales.sales_order.create" },
  { label: "Traceability", href: "/quality/trace", icon: "trace", permission: "quality.genealogy.view" },
  { label: "Audit log", href: "/admin/audit", icon: "audit", permission: "platform.audit.view" },
];

/** Left navigation (ux-system §3). Planned modules are shown disabled with their phase, never as fake links. */
export const NAV: NavGroup[] = [
  { label: "Home", icon: "home", items: [{ label: "Overview", href: "/dashboard" }, { label: "Notifications", href: "/notifications" }] },
  {
    label: "Inventory",
    icon: "boxes",
    items: [
      { label: "Lots & stock", href: "/inventory", permission: "inventory.lot.view" },
      { label: "Receive materials", href: "/inventory/receive", permission: "inventory.receipt.post" },
      { label: "Scan / look up", href: "/inventory/scan", permission: "inventory.lot.view" },
      { label: "Stock movements", href: "/inventory/movements", permission: "inventory.movement.view" },
      { label: "Availability", href: "/inventory/availability", permission: "inventory.balance.view" },
    ],
  },
  {
    label: "Production",
    icon: "factory",
    items: [
      { label: "Batches", href: "/production", permission: "production.batch.view" },
      { label: "New batch", href: "/production/new", permission: "production.batch.create" },
      { label: "Formulas", href: "/masterdata/formulas", permission: "masterdata.formula.view" },
    ],
  },
  {
    label: "Quality",
    icon: "shield",
    items: [
      { label: "QA queue", href: "/quality", permission: "quality.disposition.view" },
      { label: "Traceability", href: "/quality/trace", permission: "quality.genealogy.view" },
    ],
  },
  {
    label: "Sales",
    icon: "truck",
    items: [
      { label: "Sales orders", href: "/sales", permission: "sales.sales_order.view" },
      { label: "New order", href: "/sales/new", permission: "sales.sales_order.create" },
      { label: "Customers", href: "/sales/customers", permission: "masterdata.customer.view" },
    ],
  },
  {
    label: "Master data",
    icon: "database",
    items: [
      { label: "Materials", href: "/masterdata/materials", permission: "masterdata.material.view" },
      { label: "Products", href: "/masterdata/products", permission: "masterdata.product.view" },
      { label: "Locations", href: "/masterdata/locations", permission: "masterdata.location.view" },
    ],
  },
  {
    label: "Admin",
    icon: "settings",
    items: [
      { label: "Users & roles", href: "/admin/users", permission: "identity.user.view" },
      { label: "Audit log", href: "/admin/audit", permission: "platform.audit.view" },
      { label: "Diagnostics", href: "/admin/diagnostics", permission: "platform.job.view" },
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

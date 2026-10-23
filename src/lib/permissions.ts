/**
 * MVP subset of the permission catalogue (docs/permissions-matrix.md §2).
 * Strings follow module.entity.action.
 */
export const PERMISSIONS = [
  // identity / platform
  "identity.user.view",
  "identity.user.admin",
  "identity.role.view",
  "platform.audit.view",
  "masterdata.site.view",
  // master data
  "masterdata.material.view",
  "masterdata.material.create",
  "masterdata.product.view",
  "masterdata.product.create",
  "masterdata.formula.view",
  "masterdata.location.view",
  "masterdata.customer.view",
  "masterdata.customer.create",
  // inventory
  "inventory.lot.view",
  "inventory.receipt.post",
  "inventory.movement.view",
  "inventory.movement.post",
  "inventory.label.print",
  // production
  "production.batch.view",
  "production.batch.create",
  "production.batch.edit",
  "production.dispense_record.create",
  "production.dispense_record.approve",
  "production.batch.submit",
  // quality
  "quality.disposition.view",
  "quality.disposition.approve",
  "quality.test_result.create",
  "quality.genealogy.view",
  // sales
  "sales.sales_order.view",
  "sales.sales_order.create",
  "sales.sales_order.approve",
  "sales.allocation.post",
  "sales.shipment.post",
  "sales.shipment.view",
  // analytics
  "analytics.dashboard.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEW_ALL = PERMISSIONS.filter((p) => p.endsWith(".view"));

/** Seeded role bundles (read-only templates). */
export const ROLE_BUNDLES: Record<string, { name: string; orgWide: boolean; permissions: readonly Permission[] }> = {
  owner_director: { name: "Owner/Director", orgWide: true, permissions: PERMISSIONS },
  system_admin: {
    name: "System Administrator",
    orgWide: true,
    permissions: [
      ...VIEW_ALL,
      "identity.user.admin",
      "masterdata.material.create",
      "masterdata.product.create",
      "masterdata.customer.create",
    ],
  },
  site_manager: {
    name: "Site Manager",
    orgWide: false,
    permissions: [
      ...VIEW_ALL,
      "inventory.receipt.post",
      "inventory.movement.post",
      "inventory.label.print",
      "production.batch.create",
      "production.batch.edit",
      "production.batch.submit",
      "production.dispense_record.approve",
      "sales.sales_order.approve",
    ],
  },
  production_operator: {
    name: "Production Operator",
    orgWide: false,
    permissions: [
      "inventory.lot.view",
      "inventory.movement.view",
      "masterdata.formula.view",
      "masterdata.material.view",
      "masterdata.product.view",
      "masterdata.location.view",
      "production.batch.view",
      "production.batch.edit",
      "production.dispense_record.create",
      "production.dispense_record.approve",
      "production.batch.submit",
      "inventory.label.print",
    ],
  },
  warehouse_operator: {
    name: "Warehouse Operator",
    orgWide: false,
    permissions: [
      "inventory.lot.view",
      "inventory.movement.view",
      "inventory.receipt.post",
      "inventory.movement.post",
      "inventory.label.print",
      "masterdata.material.view",
      "masterdata.product.view",
      "masterdata.location.view",
      "sales.sales_order.view",
      "sales.shipment.view",
      "sales.allocation.post",
      "sales.shipment.post",
    ],
  },
  qa_qc: {
    name: "QA/QC",
    orgWide: false,
    permissions: [
      ...VIEW_ALL.filter((p) => !p.startsWith("identity.") && !p.startsWith("platform.")),
      "quality.disposition.approve",
      "quality.test_result.create",
    ],
  },
  sales_cs: {
    name: "Sales/Customer Service",
    orgWide: false,
    permissions: [
      "sales.sales_order.view",
      "sales.sales_order.create",
      "sales.sales_order.approve",
      "sales.shipment.view",
      "masterdata.customer.view",
      "masterdata.customer.create",
      "masterdata.product.view",
      "inventory.lot.view",
      "analytics.dashboard.view",
    ],
  },
  auditor: { name: "Auditor (read-only)", orgWide: true, permissions: VIEW_ALL },
};

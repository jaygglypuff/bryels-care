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
  "inventory.movement.view",
  "inventory.movement.post",
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
  // Wave 1 W1D: production engineering master data (US-3-01..04; docs/permissions-matrix.md §2.2, §2.5, §2.6)
  "masterdata.formula.create",
  "masterdata.formula.edit",
  "masterdata.formula.submit",
  "masterdata.formula.approve",
  "masterdata.formula.void",
  "masterdata.formula.export",
  "masterdata.routing.view",
  "masterdata.routing.create",
  "masterdata.routing.edit",
  "masterdata.routing.submit",
  "masterdata.routing.approve",
  "masterdata.work_instruction.view",
  "masterdata.work_instruction.create",
  "masterdata.work_instruction.submit",
  "masterdata.work_instruction.approve",
  "quality.inspection_plan.view",
  "quality.inspection_plan.create",
  "quality.inspection_plan.edit",
  "quality.inspection_plan.approve",
  "masterdata.equipment.view",
  "masterdata.equipment.edit",
  "masterdata.equipment.approve",
  "masterdata.equipment.admin",
  "production.equipment_use.create",
  "production.equipment_override.approve",
  // Wave 1 W1B: receiving, suppliers, supplier documents, file attachments, holds (US-2-06..US-2-10)
  "masterdata.supplier.view",
  "masterdata.supplier.create",
  "masterdata.supplier.edit",
  "masterdata.supplier.export",
  "procurement.goods_receipt.view",
  "procurement.goods_receipt.create",
  "procurement.goods_receipt.post",
  "procurement.goods_receipt.export",
  "procurement.goods_receipt.void",
  "procurement.receipt_discrepancy.approve",
  "procurement.supplier_lot_document.view",
  "procurement.supplier_lot_document.create",
  "documents.file_attachment.view",
  "documents.file_attachment.create",
  "documents.file_attachment.export",
  "documents.file_attachment.void",
  "quality.hold.view",
  "quality.hold.create",
  "quality.hold.approve",
  "inventory.held_stock_issue.approve",
  // Wave 1 W1C: scan-move, containers, counts, adjustments, reservations (E-2-04, E-2-05)
  "inventory.lot.edit",
  "inventory.lot.export",
  "inventory.lot.create",
  "inventory.intersite_transfer.post",
  "inventory.container.view",
  "inventory.container.create",
  "inventory.container.edit",
  "inventory.container.export",
  "inventory.stock_count.view",
  "inventory.stock_count.create",
  "inventory.stock_count.submit",
  "inventory.stock_count.approve",
  "inventory.stock_count.post",
  "inventory.stock_count.export",
  "inventory.adjustment.view",
  "inventory.adjustment.create",
  "inventory.adjustment.submit",
  "inventory.adjustment.approve",
  "inventory.adjustment.post",
  "inventory.adjustment.export",
  "inventory.reservation.view",
  "inventory.reservation.create",
  "inventory.reservation.void",
  // Wave 1 W1E: documents, labels and scanning (E-2-03; docs/permissions-matrix.md §3.2, §3.3, §3.7)
  "documents.template.view",
  "documents.template.create",
  "documents.template.edit",
  "documents.template.submit",
  "documents.template.approve",
  "documents.template.void",
  "documents.generated_document.view",
  "documents.generated_document.create",
  "documents.generated_document.export",
  "documents.generated_document.void",
  "documents.reprint.create",
  "documents.print_station.admin",
  "masterdata.label_template.view",
  "masterdata.label_template.create",
  "masterdata.label_template.edit",
  "masterdata.label_template.approve",
  "inventory.label_job.view",
  "inventory.label_job.create",
  // Wave 1 W1A: ledger core, jobs, exports (docs/permissions-matrix.md §2.3, §2.12)
  "inventory.balance.view",
  "inventory.balance.export",
  "inventory.balance.admin",
  "inventory.movement.export",
  "inventory.movement.void",
  "platform.job.view",
  "platform.job.admin",
  "platform.diagnostics.view",
  // Wave 2 W2G: master data administration (US-1-20..US-1-24; docs/permissions-matrix.md §2.2, §3.2)
  "masterdata.site.admin",
  "masterdata.department.view",
  "masterdata.department.admin",
  "masterdata.warehouse.view",
  "masterdata.warehouse.admin",
  "masterdata.production_line.view",
  "masterdata.production_line.admin",
  "masterdata.location.create",
  "masterdata.location.edit",
  "masterdata.location.admin",
  "masterdata.uom.view",
  "masterdata.uom.admin",
  "masterdata.uom_conversion.view",
  "masterdata.uom_conversion.admin",
  "masterdata.product.edit",
  "masterdata.product.export",
  "masterdata.sku.view",
  "masterdata.sku.create",
  "masterdata.sku.edit",
  "masterdata.sku.export",
  "masterdata.material.edit",
  "masterdata.material.export",
  "masterdata.reason_code.view",
  "masterdata.reason_code.admin",
  // Wave 2 W2B: batch execution (US-3-09..13; docs/permissions-matrix.md §2.5, §3.5)
  "production.line_clearance.create",
  "production.line_clearance.approve",
  "production.dispense_record.view",
  "production.dispense_record.void",
  "production.over_tolerance_dispense.approve",
  "production.process_step_record.view",
  "production.process_step_record.create",
  "production.process_step_record.approve",
  "production.batch_output.create",
  "production.yield_record.view",
  "production.yield_record.create",
  "production.yield_record.approve",
  "production.scrap_rework_record.view",
  "production.scrap_rework_record.create",
  "production.scrap_rework_record.approve",
  "production.batch.post",
  // Wave 2 W2C: inspections, results, review, conditional release, deviations, genealogy export (docs/permissions-matrix.md §2.6, §3.6)
  "quality.inspection.view",
  "quality.inspection.create",
  "quality.inspection.submit",
  "quality.inspection.approve",
  "quality.test_result.view",
  "quality.test_result.void",
  "quality.conditional_release.approve",
  "quality.deviation.view",
  "quality.deviation.create",
  "quality.deviation.submit",
  "quality.deviation.approve",
  "quality.deviation.export",
  "quality.genealogy.export",
  // Wave 2 W2D: BMR closure, controlled reopen/amend, hybrid paper pages (US-3-19, US-3-20; docs/permissions-matrix.md §2.5, §3.5, §5.3)
  "production.batch.approve",
  "production.batch.admin",
  // Wave 2 W2E: identity administration (US-1-11, US-1-12, US-1-16..18, US-1-28, US-1-29, US-2-29; docs/permissions-matrix.md §2.1)
  "identity.user.create",
  "identity.user.edit",
  "identity.user.export",
  "identity.invitation.create",
  "identity.role.admin",
  "identity.site_assignment.view",
  "identity.site_assignment.export",
  "identity.site_assignment.admin",
  "identity.session.view",
  "identity.session.void",
  "identity.mfa.admin",
  // Wave 2 W2F: settings, setting change requests, approval rules, numbering (docs/permissions-matrix.md §2.12)
  "platform.settings.view",
  "platform.settings.admin",
  "platform.settings.approve",
  "platform.approval_rule.view",
  "platform.approval_rule.admin",
  "platform.numbering_rule.view",
  "platform.numbering_rule.admin",
  // Wave 2 W2A: production planning, work orders, staging (E-3-03, E-5-07; docs/permissions-matrix.md §2.5, §3.5)
  "production.work_order.view",
  "production.work_order.create",
  "production.work_order.edit",
  "production.work_order.submit",
  "production.work_order.approve",
  "production.work_order.void",
  "production.work_order.export",
  "production.production_plan.view",
  "production.production_plan.create",
  "production.production_plan.edit",
  "production.production_plan.approve",
  "production.material_substitution.approve",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
{
  // Parallel streams append to this catalogue; a duplicate string would break the role_permissions seed.
  const dup = PERMISSIONS.filter((p, i) => PERMISSIONS.indexOf(p) !== i);
  if (dup.length) throw new Error(`Duplicate permission strings: ${dup.join(", ")}`);
}

const VIEW_ALL = PERMISSIONS.filter((p) => p.endsWith(".view"));

/** Decisions only qa_qc may take; the owner sees but cannot release or lift holds (A-PM-08, US-2-10 AC1). */
const QA_ONLY: readonly Permission[] = ["quality.disposition.approve", "quality.hold.approve"];

/** Seeded role bundles (read-only templates). */
export const ROLE_BUNDLES: Record<string, { name: string; orgWide: boolean; permissions: readonly Permission[] }> = {
  owner_director: { name: "Owner/Director", orgWide: true, permissions: PERMISSIONS.filter((p) => !QA_ONLY.includes(p)) },
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
      "inventory.movement.post",
      "production.batch.create",
      "production.batch.edit",
      "production.batch.submit",
      "production.dispense_record.approve",
      "sales.sales_order.approve",
      // Wave 1 W1B
      "procurement.goods_receipt.create",
      "procurement.goods_receipt.post",
      "procurement.goods_receipt.export",
      "procurement.goods_receipt.void",
      "procurement.receipt_discrepancy.approve",
      "procurement.supplier_lot_document.create",
      "documents.file_attachment.create",
      "documents.file_attachment.export",
      "documents.file_attachment.void",
      "quality.hold.create",
      // Wave 1 W1C (permissions-matrix §3.3, SM column)
      "inventory.lot.create",
      "inventory.lot.edit",
      "inventory.lot.export",
      "inventory.intersite_transfer.post",
      "inventory.container.create",
      "inventory.container.edit",
      "inventory.container.export",
      "inventory.stock_count.create",
      "inventory.stock_count.submit",
      "inventory.stock_count.approve",
      "inventory.stock_count.post",
      "inventory.stock_count.export",
      "inventory.adjustment.create",
      "inventory.adjustment.submit",
      "inventory.adjustment.approve",
      "inventory.adjustment.post",
      "inventory.reservation.create",
      "inventory.reservation.void",
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
      // Wave 1 W1C (permissions-matrix §3.3, PO column)
      "inventory.container.view",
      "inventory.container.create",
      "inventory.container.edit",
      "inventory.reservation.view",
    ],
  },
  warehouse_operator: {
    name: "Warehouse Operator",
    orgWide: false,
    permissions: [
      "inventory.lot.view",
      "inventory.movement.view",
      "inventory.movement.post",
      "masterdata.material.view",
      "masterdata.product.view",
      "masterdata.location.view",
      "sales.sales_order.view",
      "sales.shipment.view",
      "sales.allocation.post",
      "sales.shipment.post",
      // Wave 1 W1B
      "masterdata.supplier.view",
      "procurement.goods_receipt.view",
      "procurement.goods_receipt.create",
      "procurement.goods_receipt.post",
      "procurement.supplier_lot_document.view",
      "procurement.supplier_lot_document.create",
      "documents.file_attachment.view",
      "documents.file_attachment.create",
      "documents.file_attachment.export",
      "quality.hold.view",
      "quality.hold.create",
      // Wave 1 W1C (permissions-matrix §3.3, WO column)
      "inventory.lot.edit",
      "inventory.lot.export",
      "inventory.intersite_transfer.post",
      "inventory.container.view",
      "inventory.container.create",
      "inventory.container.edit",
      "inventory.container.export",
      "inventory.stock_count.view",
      "inventory.stock_count.create",
      "inventory.stock_count.submit",
      "inventory.adjustment.view",
      "inventory.adjustment.create",
      "inventory.adjustment.submit",
      "inventory.reservation.view",
    ],
  },
  qa_qc: {
    name: "QA/QC",
    orgWide: false,
    permissions: [
      ...VIEW_ALL.filter((p) => !p.startsWith("identity.") && !p.startsWith("platform.")),
      "quality.disposition.approve",
      "quality.test_result.create",
      // Wave 1 W1B
      "masterdata.supplier.edit",
      "procurement.supplier_lot_document.create",
      "documents.file_attachment.create",
      "documents.file_attachment.export",
      "documents.file_attachment.void",
      "quality.hold.create",
      "quality.hold.approve",
      "inventory.held_stock_issue.approve",
    ],
  },
  procurement: {
    name: "Procurement",
    orgWide: false,
    permissions: [
      "masterdata.supplier.view",
      "masterdata.supplier.create",
      "masterdata.supplier.edit",
      "masterdata.supplier.export",
      "masterdata.material.view",
      "masterdata.location.view",
      "inventory.lot.view",
      "procurement.goods_receipt.view",
      "procurement.goods_receipt.export",
      "procurement.receipt_discrepancy.approve",
      "procurement.supplier_lot_document.view",
      "procurement.supplier_lot_document.create",
      "documents.file_attachment.view",
      "documents.file_attachment.create",
      "documents.file_attachment.export",
      "quality.disposition.view",
      "quality.hold.view",
      // Wave 1 W1C (permissions-matrix §3.3, QA column)
      "inventory.lot.edit",
      "inventory.lot.export",
      "inventory.adjustment.create",
      "inventory.adjustment.submit",
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
      // Wave 1 W1C (permissions-matrix §3.3, SC column)
      "inventory.container.view",
      "inventory.reservation.view",
      "inventory.reservation.create",
      "inventory.reservation.void",
    ],
  },
  auditor: {
    name: "Auditor (read-only)",
    orgWide: true,
    permissions: [...VIEW_ALL, "masterdata.supplier.export", "procurement.goods_receipt.export", "documents.file_attachment.export"],
  },
};

// Wave 1 W1D: role grants for production engineering master data (docs/permissions-matrix.md §3.2,
// §3.5, §3.6). View strings reach VIEW_ALL roles automatically; owner_director holds every string.
const W1D_GRANTS: Record<string, readonly Permission[]> = {
  system_admin: ["masterdata.equipment.admin"],
  site_manager: [
    "masterdata.formula.create",
    "masterdata.formula.edit",
    "masterdata.formula.submit",
    "masterdata.formula.approve",
    "masterdata.formula.void",
    "masterdata.routing.create",
    "masterdata.routing.edit",
    "masterdata.routing.submit",
    "masterdata.routing.approve",
    "masterdata.work_instruction.create",
    "masterdata.work_instruction.submit",
    "masterdata.work_instruction.approve",
    "masterdata.equipment.edit",
    "masterdata.equipment.admin",
    "production.equipment_use.create",
    "production.equipment_override.approve",
  ],
  production_operator: [
    "masterdata.routing.view",
    "masterdata.work_instruction.view",
    "masterdata.equipment.view",
    "masterdata.equipment.edit",
    "quality.inspection_plan.view",
    "production.equipment_use.create",
  ],
  warehouse_operator: ["masterdata.work_instruction.view", "masterdata.equipment.view", "quality.inspection_plan.view"],
  qa_qc: [
    "masterdata.formula.approve",
    "masterdata.formula.void",
    "masterdata.formula.export",
    "masterdata.routing.approve",
    "masterdata.work_instruction.approve",
    "quality.inspection_plan.create",
    "quality.inspection_plan.edit",
    "quality.inspection_plan.approve",
    "masterdata.equipment.approve",
    "production.equipment_override.approve",
  ],
};
for (const [role, grants] of Object.entries(W1D_GRANTS)) {
  ROLE_BUNDLES[role].permissions = [...new Set([...ROLE_BUNDLES[role].permissions, ...grants])];
}
/** Production planner (docs/permissions-matrix.md §3): drafts and submits formulas, routings and instructions; never approves them. */
ROLE_BUNDLES.production_planner = {
  name: "Production Planner",
  orgWide: false,
  permissions: [
    "masterdata.material.view",
    "masterdata.product.view",
    "masterdata.location.view",
    "masterdata.formula.view",
    "masterdata.formula.create",
    "masterdata.formula.edit",
    "masterdata.formula.submit",
    "masterdata.routing.view",
    "masterdata.routing.create",
    "masterdata.routing.edit",
    "masterdata.routing.submit",
    "masterdata.work_instruction.view",
    "masterdata.work_instruction.create",
    "masterdata.work_instruction.submit",
    "masterdata.equipment.view",
    "quality.inspection_plan.view",
    "inventory.lot.view",
    "inventory.movement.view",
    "production.batch.view",
    "production.batch.create",
    "production.batch.edit",
    "quality.disposition.view",
  ],
};

// Wave 1 W1E: role grants for documents, labels and scanning (docs/permissions-matrix.md §3.2, §3.3, §3.7).
const W1E_DOC_USER = [
  "documents.template.view",
  "documents.generated_document.view",
  "documents.generated_document.create",
  "documents.generated_document.export",
  "documents.reprint.create",
  "masterdata.label_template.view",
] as const;
const W1E_GRANTS: Record<string, readonly Permission[]> = {
  system_admin: ["documents.template.create", "documents.template.edit", "masterdata.label_template.create", "masterdata.label_template.edit", "documents.print_station.admin"],
  site_manager: [
    "documents.template.create",
    "documents.template.edit",
    "documents.template.submit",
    "documents.generated_document.create",
    "documents.generated_document.export",
    "documents.generated_document.void",
    "documents.reprint.create",
    "masterdata.label_template.create",
    "masterdata.label_template.edit",
    "inventory.label_job.create",
    "documents.print_station.admin",
  ],
  production_operator: [...W1E_DOC_USER, "inventory.label_job.view", "inventory.label_job.create"],
  warehouse_operator: [...W1E_DOC_USER, "inventory.label_job.view", "inventory.label_job.create"],
  qa_qc: [
    "documents.template.approve",
    "documents.template.void",
    "documents.generated_document.create",
    "documents.generated_document.export",
    "documents.generated_document.void",
    "documents.reprint.create",
    "masterdata.label_template.approve",
    "inventory.label_job.create",
  ],
  sales_cs: [...W1E_DOC_USER],
  auditor: ["documents.generated_document.export"],
  procurement: ["inventory.label_job.view", "inventory.label_job.create"],
};
for (const [role, grants] of Object.entries(W1E_GRANTS)) {
  if (ROLE_BUNDLES[role]) ROLE_BUNDLES[role].permissions = [...new Set([...ROLE_BUNDLES[role].permissions, ...grants])];
}

// Wave 1 W1A: role grants for ledger core, jobs and exports (docs/permissions-matrix.md §2.3, §2.12).
const W1A_GRANTS: Record<string, readonly Permission[]> = {
  system_admin: ["platform.job.admin", "inventory.balance.admin"],
  site_manager: ["inventory.movement.void", "inventory.movement.export", "inventory.balance.export", "inventory.balance.admin"],
  // A-PM-06: posts only consumption/output/production-area transfers (setting inventory.role_movement_types)
  production_operator: ["inventory.movement.post", "inventory.balance.view"],
  warehouse_operator: ["inventory.balance.view", "inventory.balance.export", "inventory.movement.export"],
  sales_cs: ["inventory.balance.view"],
  auditor: ["inventory.balance.export", "inventory.movement.export"],
};
for (const [role, grants] of Object.entries(W1A_GRANTS)) {
  if (ROLE_BUNDLES[role]) ROLE_BUNDLES[role].permissions = [...new Set([...ROLE_BUNDLES[role].permissions, ...grants])];
}
// Diagnostics (worker, jobs, reconciliation) are for system administrators, not every view-all role.
for (const role of ["site_manager", "auditor"]) {
  ROLE_BUNDLES[role].permissions = ROLE_BUNDLES[role].permissions.filter((p) => p !== "platform.diagnostics.view");
}

// Wave 2 W2G: role grants for master data administration (docs/permissions-matrix.md §3.2).
// View strings reach VIEW_ALL roles (owner, system_admin, site_manager, qa_qc, auditor) automatically;
// owner_director holds every string. Organization structure and reference lists are readable by every role.
const W2G_ORG_VIEW: readonly Permission[] = [
  "masterdata.site.view",
  "masterdata.department.view",
  "masterdata.warehouse.view",
  "masterdata.production_line.view",
  "masterdata.uom.view",
  "masterdata.uom_conversion.view",
  "masterdata.reason_code.view",
];
const W2G_GRANTS: Record<string, readonly Permission[]> = {
  system_admin: [
    "masterdata.site.admin",
    "masterdata.department.admin",
    "masterdata.warehouse.admin",
    "masterdata.production_line.admin",
    "masterdata.uom.admin",
    "masterdata.uom_conversion.admin",
    "masterdata.reason_code.admin",
    "masterdata.location.create",
    "masterdata.location.edit",
    "masterdata.location.admin",
    "masterdata.product.edit",
    "masterdata.product.export",
    "masterdata.sku.create",
    "masterdata.sku.edit",
    "masterdata.sku.export",
    "masterdata.material.edit",
  ],
  site_manager: ["masterdata.location.create", "masterdata.location.edit"],
  production_planner: [...W2G_ORG_VIEW, "masterdata.product.create", "masterdata.product.edit", "masterdata.sku.view", "masterdata.sku.create", "masterdata.sku.edit", "masterdata.material.create", "masterdata.material.edit"],
  production_operator: [...W2G_ORG_VIEW, "masterdata.sku.view"],
  warehouse_operator: [...W2G_ORG_VIEW, "masterdata.sku.view", "masterdata.location.create"],
  qa_qc: ["masterdata.product.edit", "masterdata.sku.edit", "masterdata.material.edit"],
  procurement: [...W2G_ORG_VIEW, "masterdata.product.view", "masterdata.sku.view", "masterdata.material.create", "masterdata.material.edit", "masterdata.material.export"],
  sales_cs: [...W2G_ORG_VIEW, "masterdata.sku.view", "masterdata.product.export", "masterdata.sku.export"],
  auditor: ["masterdata.product.export", "masterdata.sku.export", "masterdata.material.export"],
};
for (const [role, grants] of Object.entries(W2G_GRANTS)) {
  if (ROLE_BUNDLES[role]) ROLE_BUNDLES[role].permissions = [...new Set([...ROLE_BUNDLES[role].permissions, ...grants])];
}

// Wave 2 W2B: role grants for batch execution (docs/permissions-matrix.md §3.5). A production_operator
// holds `production.line_clearance.approve` to act as checker for a colleague's clearance (§3.5 note;
// the service refuses checking one's own entry). View strings reach VIEW_ALL roles at definition.
const W2B_GRANTS: Record<string, readonly Permission[]> = {
  site_manager: [
    "production.line_clearance.approve",
    "production.dispense_record.view",
    "production.dispense_record.void",
    "production.over_tolerance_dispense.approve",
    "production.process_step_record.view",
    "production.process_step_record.approve",
    "production.batch_output.create",
    "production.yield_record.view",
    "production.yield_record.create",
    "production.yield_record.approve",
    "production.scrap_rework_record.view",
    "production.scrap_rework_record.create",
    "production.scrap_rework_record.approve",
    "production.batch.post",
  ],
  production_operator: [
    "production.line_clearance.create",
    "production.line_clearance.approve",
    "production.dispense_record.view",
    "production.process_step_record.view",
    "production.process_step_record.create",
    "production.process_step_record.approve",
    "production.batch_output.create",
    "production.yield_record.view",
    "production.yield_record.create",
    "production.scrap_rework_record.view",
    "production.scrap_rework_record.create",
    "production.batch.post",
  ],
  qa_qc: [
    "production.line_clearance.approve",
    "production.dispense_record.view",
    "production.dispense_record.approve",
    "production.over_tolerance_dispense.approve",
    "production.process_step_record.view",
    "production.process_step_record.approve",
    "production.yield_record.view",
    "production.yield_record.approve",
    "production.scrap_rework_record.view",
    "production.scrap_rework_record.approve",
  ],
  production_planner: ["production.dispense_record.view", "production.process_step_record.view", "production.yield_record.view", "production.scrap_rework_record.view"],
};
for (const [role, grants] of Object.entries(W2B_GRANTS)) {
  if (ROLE_BUNDLES[role]) ROLE_BUNDLES[role].permissions = [...new Set([...ROLE_BUNDLES[role].permissions, ...grants])];
}

// Wave 2 W2C: role grants for inspections, results, deviations and genealogy (docs/permissions-matrix.md §3.6).
// View strings reach VIEW_ALL roles automatically; the matrix keeps system_admin away from quality evidence
// and gives owner_director view/export plus the second approval of a conditional release only.
const W2C_GRANTS: Record<string, readonly Permission[]> = {
  site_manager: ["quality.deviation.create", "quality.deviation.submit"],
  // Matrix §3.6 also lists genealogy view for PP/PO/WO/PR/SC; not granted yet because a trace names
  // customers and suppliers (A-W2C-05, owner to confirm).
  production_planner: ["quality.deviation.view"],
  production_operator: ["quality.inspection.view", "quality.inspection.create", "quality.deviation.view", "quality.deviation.create"],
  warehouse_operator: ["quality.inspection.view", "quality.inspection.create", "quality.deviation.view", "quality.deviation.create"],
  qa_qc: [
    "quality.inspection.create",
    "quality.inspection.submit",
    "quality.inspection.approve",
    "quality.test_result.void",
    "quality.conditional_release.approve",
    "quality.deviation.create",
    "quality.deviation.submit",
    "quality.deviation.approve",
    "quality.deviation.export",
    "quality.genealogy.export",
  ],
  procurement: ["quality.inspection.view"],
  auditor: ["quality.deviation.export", "quality.genealogy.export"],
};
for (const [role, grants] of Object.entries(W2C_GRANTS)) {
  if (ROLE_BUNDLES[role]) ROLE_BUNDLES[role].permissions = [...new Set([...ROLE_BUNDLES[role].permissions, ...grants])];
}
const W2C_NOT_FOR_OWNER: readonly Permission[] = [
  "quality.inspection.create",
  "quality.inspection.submit",
  "quality.inspection.approve",
  "quality.test_result.void",
  "quality.deviation.create",
  "quality.deviation.submit",
  "quality.deviation.approve",
  "quality.deviation.export",
];
ROLE_BUNDLES.owner_director.permissions = ROLE_BUNDLES.owner_director.permissions.filter((p) => !W2C_NOT_FOR_OWNER.includes(p));
const W2C_NOT_FOR_ADMIN: readonly Permission[] = ["quality.inspection.view", "quality.test_result.view", "quality.deviation.view"];
ROLE_BUNDLES.system_admin.permissions = ROLE_BUNDLES.system_admin.permissions.filter((p) => !W2C_NOT_FOR_ADMIN.includes(p));

// Wave 2 W2D: closure (production.batch.approve, SM), reopen request (production.batch.admin, SM;
// QA co-approves with quality.disposition.approve, A-PM-07) and paper-page review
// (production.process_step_record.approve: SM, PO as checker, QA) per docs/permissions-matrix.md §3.5.
const W2D_GRANTS: Record<string, readonly Permission[]> = {
  site_manager: ["production.batch.approve", "production.batch.admin", "production.process_step_record.approve"],
  production_operator: ["production.process_step_record.approve", "documents.file_attachment.view", "documents.file_attachment.create"],
  qa_qc: ["production.process_step_record.approve"],
};
for (const [role, grants] of Object.entries(W2D_GRANTS)) {
  if (ROLE_BUNDLES[role]) ROLE_BUNDLES[role].permissions = [...new Set([...ROLE_BUNDLES[role].permissions, ...grants])];
}

// Wave 2 W2E: identity administration grants (docs/permissions-matrix.md §3.1). owner_director holds every
// string (break-glass, audited as identity.role.owner_break_glass); `.view` strings reach VIEW_ALL roles.
const W2E_GRANTS: Record<string, readonly Permission[]> = {
  system_admin: [
    "identity.user.create",
    "identity.user.edit",
    "identity.user.export",
    "identity.invitation.create",
    "identity.role.admin",
    "identity.site_assignment.admin",
    "identity.session.void",
    "identity.mfa.admin",
  ],
  auditor: ["identity.user.export", "identity.site_assignment.export"],
};
for (const [role, grants] of Object.entries(W2E_GRANTS)) {
  if (ROLE_BUNDLES[role]) ROLE_BUNDLES[role].permissions = [...new Set([...ROLE_BUNDLES[role].permissions, ...grants])];
}
// Other people's sessions are for administrators and auditors only (matrix §3.1: site_manager has no identity.session).
ROLE_BUNDLES.site_manager.permissions = ROLE_BUNDLES.site_manager.permissions.filter((p) => p !== "identity.session.view");

// Wave 2 W2F: governance grants (docs/permissions-matrix.md §3.12). View strings reach the VIEW_ALL
// roles automatically; owner_director holds every string, so the matrix's exclusions are removed here.
const W2F_GRANTS: Record<string, readonly Permission[]> = {
  system_admin: ["platform.settings.admin", "platform.settings.approve", "platform.numbering_rule.admin"],
};
for (const [role, grants] of Object.entries(W2F_GRANTS)) {
  if (ROLE_BUNDLES[role]) ROLE_BUNDLES[role].permissions = [...new Set([...ROLE_BUNDLES[role].permissions, ...grants])];
}
const W2F_EXCLUDE: Record<string, readonly Permission[]> = {
  // OD: settings v a, numbering_rule v (changes are system_admin work; the owner approves settings).
  owner_director: ["platform.settings.admin", "platform.numbering_rule.admin"],
  // SM: no settings access at all; approval rules and numbering view only.
  site_manager: ["platform.settings.view", "platform.settings.admin", "platform.settings.approve"],
};
for (const [role, drop] of Object.entries(W2F_EXCLUDE)) {
  if (ROLE_BUNDLES[role]) ROLE_BUNDLES[role].permissions = ROLE_BUNDLES[role].permissions.filter((p) => !drop.includes(p));
}

// Wave 2 W2A: role grants for production planning, work orders and staging (docs/permissions-matrix.md §3.5).
// View strings reach VIEW_ALL roles automatically; owner_director holds every string.
const W2A_GRANTS: Record<string, readonly Permission[]> = {
  site_manager: [
    "production.work_order.create",
    "production.work_order.edit",
    "production.work_order.submit",
    "production.work_order.approve",
    "production.work_order.void",
    "production.work_order.export",
    "production.production_plan.create",
    "production.production_plan.edit",
    "production.production_plan.approve",
  ],
  production_planner: [
    "production.work_order.view",
    "production.work_order.create",
    "production.work_order.edit",
    "production.work_order.submit",
    "production.work_order.export",
    "production.production_plan.view",
    "production.production_plan.create",
    "production.production_plan.edit",
    "inventory.reservation.view",
    "inventory.balance.view",
    "sales.sales_order.view",
    "documents.generated_document.view",
    "documents.generated_document.create",
  ],
  production_operator: ["production.work_order.view", "production.production_plan.view"],
  // Warehouse stages reserved lots by scan (W05-05) with inventory.movement.post; batch records stay hidden (no production.batch.view).
  warehouse_operator: ["production.work_order.view", "production.production_plan.view"],
  qa_qc: ["production.material_substitution.approve"],
  procurement: ["production.production_plan.view"],
  sales_cs: ["production.work_order.view", "production.production_plan.view"],
  auditor: ["production.work_order.export"],
};
for (const [role, grants] of Object.entries(W2A_GRANTS)) {
  if (ROLE_BUNDLES[role]) ROLE_BUNDLES[role].permissions = [...new Set([...ROLE_BUNDLES[role].permissions, ...grants])];
}

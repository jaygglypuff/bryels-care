import type { Permission } from "@/lib/permissions";

/**
 * Sensitivity of each permission string (docs/permissions-matrix.md §2, column "Sens."): N normal,
 * S sensitive (grant and use audited), R restricted (changes the control system, releases quality,
 * posts money or payroll, overrides a safety rule: holders need TOTP (US-1-28) and use needs
 * re-authentication within the window). Generated from the matrix; strings not listed are N.
 * Lists include strings of later phases so a bundle keeps its sensitivity when they arrive.
 */
export type Sensitivity = "N" | "S" | "R";

const RESTRICTED: ReadonlySet<string> = new Set([
  "finance.accountant_export.admin", "finance.accountant_export.export", "finance.costing_config.admin",
  "finance.credit_note.post", "finance.credit_note.void", "finance.expense_claim.post", "finance.expense_claim.void",
  "finance.invoice.post", "finance.invoice.void", "finance.journal_entry.create", "finance.journal_entry.export",
  "finance.journal_entry.post", "finance.journal_entry.view", "finance.journal_entry.void",
  "finance.payment_provider.admin", "finance.payment_record.post", "finance.payment_record.void",
  "finance.period_lock.post", "finance.period_lock.void", "finance.reconciliation.post", "finance.refund.approve",
  "finance.supplier_bill.post", "finance.supplier_bill.void", "finance.tax_config.admin",
  "hr.attendance_event.export", "hr.employee.export", "hr.employee_personal_data.edit",
  "hr.employee_personal_data.view", "hr.payment_export.export", "hr.payroll_line.edit", "hr.payroll_line.export",
  "hr.payroll_line.view", "hr.payroll_period.approve", "hr.payroll_period.create", "hr.payroll_period.post",
  "hr.payroll_period.submit", "hr.payroll_period.view", "hr.payroll_period.void", "hr.payroll_rule.admin",
  "hr.payroll_rule.view", "hr.payslip.create", "hr.payslip.export", "hr.payslip.view", "identity.role.admin",
  "identity.site_assignment.admin", "identity.user.admin", "inventory.held_stock_issue.approve",
  "masterdata.formula.approve", "masterdata.routing.approve", "masterdata.site.admin",
  "platform.approval_rule.admin", "platform.integration.admin", "platform.numbering_rule.admin",
  "platform.settings.admin", "platform.settings.approve", "production.batch.admin",
  "production.equipment_override.approve", "production.material_substitution.approve",
  "production.over_tolerance_dispense.approve", "quality.conditional_release.approve", "quality.disposition.approve",
  "quality.hold.approve", "quality.recall_case.admin", "quality.recall_case.approve", "sales.over_shipment.approve",
  "sales.portal_user.admin",
]);

const SENSITIVE: ReadonlySet<string> = new Set([
  "analytics.financial_kpi.view", "analytics.forecast.approve", "analytics.labor_kpi.view",
  "analytics.owner_dashboard.view", "analytics.report.admin", "analytics.report.export",
  "analytics.scheduled_report.admin", "analytics.scheduled_report.create", "analytics.scheduled_report.view",
  "documents.file_attachment.void", "documents.generated_document.void", "documents.reprint.create",
  "documents.template.approve", "documents.template.void", "finance.cost.view", "finance.costing_run.create",
  "finance.costing_run.export", "finance.costing_run.post", "finance.costing_run.view",
  "finance.credit_note.approve", "finance.credit_note.create", "finance.credit_note.export",
  "finance.credit_note.submit", "finance.credit_note.view", "finance.credit_terms.approve",
  "finance.credit_terms.view", "finance.expense_claim.approve", "finance.expense_claim.export",
  "finance.expense_claim.view", "finance.invoice.approve", "finance.invoice.create", "finance.invoice.edit",
  "finance.invoice.export", "finance.invoice.submit", "finance.invoice.view", "finance.payment_provider.view",
  "finance.payment_record.approve", "finance.payment_record.create", "finance.payment_record.export",
  "finance.payment_record.view", "finance.period_lock.view", "finance.reconciliation.create",
  "finance.reconciliation.view", "finance.refund.create", "finance.supplier_bill.approve",
  "finance.supplier_bill.create", "finance.supplier_bill.edit", "finance.supplier_bill.export",
  "finance.supplier_bill.submit", "finance.supplier_bill.view", "finance.tax_config.view",
  "hr.attendance_event.approve", "hr.attendance_event.edit", "hr.attendance_event.view",
  "hr.attendance_exception.approve", "hr.attendance_exception.edit", "hr.attendance_exception.view",
  "hr.attendance_import.approve", "hr.attendance_import.create", "hr.attendance_import.post",
  "hr.attendance_import.submit", "hr.attendance_import.view", "hr.attendance_import.void", "hr.calendar.admin",
  "hr.employee.create", "hr.employee.edit", "hr.leave_request.approve", "hr.leave_request.view",
  "hr.overtime.approve", "hr.overtime.void", "hr.shift.admin", "hr.shift_assignment.approve",
  "identity.invitation.create", "identity.mfa.admin", "identity.session.view", "identity.session.void",
  "identity.site_assignment.export", "identity.user.create", "identity.user.edit", "identity.user.export",
  "inventory.adjustment.approve", "inventory.adjustment.post", "inventory.balance.admin",
  "inventory.intersite_transfer.post", "inventory.lot.create", "inventory.lot.edit", "inventory.movement.void",
  "inventory.pack.approve", "inventory.stock_count.approve", "inventory.stock_count.post",
  "masterdata.customer.export", "masterdata.customer_requirement.approve", "masterdata.department.admin",
  "masterdata.equipment.admin", "masterdata.equipment.approve", "masterdata.formula.export",
  "masterdata.formula.void", "masterdata.label_template.approve", "masterdata.location.admin",
  "masterdata.production_line.admin", "masterdata.reason_code.admin", "masterdata.supplier.approve",
  "masterdata.supplier.export", "masterdata.supplier_price.edit", "masterdata.supplier_price.view",
  "masterdata.uom.admin", "masterdata.uom_conversion.admin", "masterdata.warehouse.admin",
  "masterdata.work_instruction.approve", "platform.audit.export", "platform.audit.view", "platform.diagnostics.view",
  "platform.file.admin", "platform.help_guide.admin", "platform.import_job.approve", "platform.import_job.post",
  "platform.import_job.void", "platform.integration.view", "platform.job.admin", "platform.notification_rule.admin",
  "platform.sync_command.view", "platform.sync_command.void", "platform.sync_conflict.approve",
  "procurement.goods_receipt.void", "procurement.purchase_order.approve", "procurement.purchase_order.export",
  "procurement.purchase_order.void", "procurement.purchase_request.approve", "procurement.purchase_request.export",
  "procurement.receipt_discrepancy.approve", "procurement.supplier_return.approve", "production.batch.approve",
  "production.batch.post", "production.batch.void", "production.dispense_record.approve",
  "production.dispense_record.void", "production.line_clearance.approve", "production.process_step_record.approve",
  "production.production_plan.approve", "production.scrap_rework_record.approve", "production.work_order.approve",
  "production.work_order.void", "production.yield_record.approve", "quality.capa.approve",
  "quality.change_control.approve", "quality.complaint.approve", "quality.deviation.approve",
  "quality.deviation.export", "quality.genealogy.export", "quality.hold.create", "quality.inspection.approve",
  "quality.inspection_plan.approve", "quality.recall_case.create", "quality.recall_case.view",
  "quality.test_result.approve", "quality.test_result.export", "quality.test_result.void",
  "sales.customer_return.approve", "sales.customer_return.post", "sales.portal_catalog.admin",
  "sales.portal_catalog.view", "sales.portal_user.view", "sales.price_list.approve", "sales.price_list.edit",
  "sales.price_list.view", "sales.quote.approve", "sales.quote.export", "sales.sales_order.approve",
  "sales.sales_order.export", "sales.sales_order.void", "sales.shipment.post", "sales.shipment.void",
]);

export function sensitivityOf(p: string): Sensitivity {
  return RESTRICTED.has(p) ? "R" : SENSITIVE.has(p) ? "S" : "N";
}

/** Roles whose holders are always privileged (docs/security.md §3.7: TOTP for system_admin and owner_director). */
export const ALWAYS_PRIVILEGED_ROLES: readonly string[] = ["owner_director", "system_admin"];

/** True when the user holds any R permission or an always-privileged role: shorter timeouts, MFA required. */
export function isPrivileged(permissions: Iterable<string>, roleCodes: Iterable<string>): boolean {
  for (const r of roleCodes) if (ALWAYS_PRIVILEGED_ROLES.includes(r)) return true;
  for (const p of permissions) if (RESTRICTED.has(p)) return true;
  return false;
}

/** The restricted strings among a set (for messages and audit payloads). */
export function restrictedAmong(permissions: Iterable<string>): string[] {
  return [...permissions].filter((p) => RESTRICTED.has(p)).sort();
}

/**
 * Permissions an access-administering role (one holding identity.role.admin or identity.site_assignment.admin)
 * may never carry: quality release, money and payroll posting, approval-rule changes (docs/security.md §2.11,
 * US-1-17 AC3). Whoever changes who-may-do-what must not also do the controlled things.
 */
export const ADMIN_INCOMPATIBLE: (p: string) => boolean = (p) =>
  p === "quality.disposition.approve" ||
  p === "quality.conditional_release.approve" ||
  p === "quality.hold.approve" ||
  p === "platform.approval_rule.admin" ||
  p.startsWith("hr.payroll") ||
  p.startsWith("hr.payslip") ||
  (p.startsWith("finance.") && (p.endsWith(".post") || p.endsWith(".void")));

export const ACCESS_ADMIN_PERMISSIONS: readonly Permission[] = ["identity.role.admin", "identity.site_assignment.admin"];

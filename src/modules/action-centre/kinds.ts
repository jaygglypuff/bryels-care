import type { Permission } from "@/lib/permissions";

/**
 * Action-centre item kinds (US-5-06, docs/ux-system.md 5.5 and §9.15 "Exceptions"). Each kind names
 * the tab, the default severity (a notification rule may change it), the permission needed to see
 * it at the item's site and the primary action. The list of kinds is code; who hears about them and
 * when they escalate is data (notification_rules, US-5-07).
 */
export type ActionTab = "approvals" | "exceptions";
export type Severity = "info" | "warning" | "critical";

export type ActionKind = {
  kind: string;
  tab: ActionTab;
  label: string;
  severity: Severity;
  permission: Permission;
  actionLabel: string;
};

export const ACTION_KINDS: readonly ActionKind[] = [
  // Approvals
  { kind: "approval.stock_adjustment", tab: "approvals", label: "Stock fix to approve", severity: "warning", permission: "inventory.adjustment.approve", actionLabel: "Open the stock fix" },
  { kind: "approval.stock_count", tab: "approvals", label: "Count difference to approve", severity: "warning", permission: "inventory.stock_count.approve", actionLabel: "Open the count" },
  // Consultant review 2026-10-30: replaces "approval.work_order_release" (planned only, opened the old work-order
  // screen). Draft and planned production orders, decided inline with approveProductionOrder (gate in wiring.ts).
  { kind: "approval.production_order", tab: "approvals", label: "Production order to approve", severity: "info", permission: "production.work_order.approve", actionLabel: "Open and approve" },
  { kind: "approval.batch_disposition", tab: "approvals", label: "Batch waiting for the QA check", severity: "warning", permission: "quality.disposition.approve", actionLabel: "Check the batch" },
  { kind: "approval.inspection_review", tab: "approvals", label: "Quality check to confirm", severity: "warning", permission: "quality.inspection.approve", actionLabel: "Open the quality check" },
  { kind: "approval.conditional_release", tab: "approvals", label: "“OK with conditions” to confirm", severity: "warning", permission: "quality.conditional_release.approve", actionLabel: "Open the batch" },
  // ADR-104 §1b / §3: QA-only decisions (no owner override, no self-approval; gates in wiring.ts).
  { kind: "approval.material_substitution", tab: "approvals", label: "Another ingredient to approve (QA)", severity: "warning", permission: "production.material_substitution.approve", actionLabel: "Decide" },
  { kind: "approval.result_correction", tab: "approvals", label: "Corrected QA result to approve", severity: "warning", permission: "quality.disposition.approve", actionLabel: "Open the quality check" },
  { kind: "approval.batch_reopen", tab: "approvals", label: "Reopening a batch to approve", severity: "warning", permission: "quality.disposition.approve", actionLabel: "Open the batch" },
  { kind: "approval.equipment_override", tab: "approvals", label: "Machine use to approve", severity: "warning", permission: "production.equipment_override.approve", actionLabel: "Open the machine" },
  { kind: "approval.setting_change", tab: "approvals", label: "Setting change to approve", severity: "info", permission: "platform.settings.approve", actionLabel: "Open the setting" },
  { kind: "approval.template_version", tab: "approvals", label: "Label or printout layout to approve", severity: "info", permission: "documents.template.approve", actionLabel: "Open the layout" },
  // Wave 3 integration: W3D commercial approvals, W3F return approval
  { kind: "approval.sales_order", tab: "approvals", label: "Customer order to approve", severity: "warning", permission: "sales.sales_order.approve", actionLabel: "Open the order" },
  { kind: "approval.quote", tab: "approvals", label: "Price offer to approve", severity: "info", permission: "sales.quote.approve", actionLabel: "Open the price offer" },
  { kind: "approval.price_list", tab: "approvals", label: "Prices to approve", severity: "info", permission: "sales.price_list.approve", actionLabel: "Open the prices" },
  { kind: "approval.customer_requirement", tab: "approvals", label: "Customer's special rule to approve", severity: "info", permission: "masterdata.customer_requirement.approve", actionLabel: "Open the customer" },
  { kind: "approval.import_job", tab: "approvals", label: "Spreadsheet data to approve", severity: "info", permission: "platform.import_job.approve", actionLabel: "Open the spreadsheet load" },
  { kind: "approval.customer_return", tab: "approvals", label: "Customer return to approve", severity: "warning", permission: "sales.customer_return.approve", actionLabel: "Open the return" },
  // Wave 4 W4A: procurement approvals (sources registered in src/modules/wiring.ts)
  { kind: "approval.purchase_order", tab: "approvals", label: "Purchase order to approve", severity: "warning", permission: "procurement.purchase_order.approve", actionLabel: "Open the purchase order" },
  { kind: "approval.purchase_request", tab: "approvals", label: "Request to buy to approve", severity: "info", permission: "procurement.purchase_request.approve", actionLabel: "Open the request" },
  { kind: "approval.supplier_return", tab: "approvals", label: "Return to supplier to approve", severity: "info", permission: "procurement.supplier_return.approve", actionLabel: "Open the return" },
  { kind: "approval.asl_change", tab: "approvals", label: "Supplier item for QA to decide", severity: "info", permission: "masterdata.supplier.approve", actionLabel: "Open the supplier" },
  // Wave 4 W4B: finance (sources registered in src/modules/wiring.ts)
  { kind: "approval.invoice", tab: "approvals", label: "Invoice to approve", severity: "info", permission: "finance.invoice.approve", actionLabel: "Open the invoice" },
  { kind: "approval.expense_claim", tab: "approvals", label: "Expense claim to approve", severity: "info", permission: "finance.expense_claim.approve", actionLabel: "Open the claim" },
  // Wave 4 W4C: recall case and change control approvals (US-6-18)
  { kind: "approval.recall_case", tab: "approvals", label: "Product recall to approve", severity: "critical", permission: "quality.recall_case.approve", actionLabel: "Open the recall" },
  { kind: "approval.change_control", tab: "approvals", label: "Change request to approve", severity: "info", permission: "quality.change_control.approve", actionLabel: "Open the change request" },
  // ADR-117: recipe, steps and how-to sheet versions waiting for an OK (sources and verdicts registered in src/modules/wiring.ts)
  { kind: "approval.formula_revision", tab: "approvals", label: "Recipe to approve", severity: "info", permission: "masterdata.formula.approve", actionLabel: "Open the recipe" },
  { kind: "approval.routing_revision", tab: "approvals", label: "Recipe steps to approve", severity: "info", permission: "masterdata.routing.approve", actionLabel: "Open the steps" },
  { kind: "approval.work_instruction_revision", tab: "approvals", label: "How-to sheet to approve", severity: "info", permission: "masterdata.work_instruction.approve", actionLabel: "Open the how-to sheet" },
  // Exceptions
  { kind: "late_work_order", tab: "exceptions", label: "Late production order", severity: "warning", permission: "production.work_order.view", actionLabel: "Open the production order" },
  { kind: "low_stock", tab: "exceptions", label: "Product running low", severity: "warning", permission: "inventory.balance.view", actionLabel: "See the stock" },
  { kind: "expiring_lot", tab: "exceptions", label: "Lot expiring soon", severity: "warning", permission: "inventory.lot.view", actionLabel: "Open the lot" },
  { kind: "expired_stock", tab: "exceptions", label: "Expired stock still on the shelf", severity: "critical", permission: "inventory.lot.view", actionLabel: "Open the lot" },
  { kind: "failed_job", tab: "exceptions", label: "Automatic task failed", severity: "critical", permission: "platform.job.view", actionLabel: "Open the system health page" },
  { kind: "failed_import", tab: "exceptions", label: "Spreadsheet load failed", severity: "critical", permission: "platform.import_job.view", actionLabel: "Open the spreadsheet load" },
  { kind: "reconciliation_difference", tab: "exceptions", label: "Stock numbers do not add up", severity: "critical", permission: "platform.job.view", actionLabel: "Open the system check" },
  { kind: "open_hold", tab: "exceptions", label: "Stock stopped by QA", severity: "warning", permission: "quality.hold.view", actionLabel: "Open it" },
  { kind: "open_deviation", tab: "exceptions", label: "Open problem report", severity: "warning", permission: "quality.deviation.view", actionLabel: "Open the problem report" },
  { kind: "unacknowledged_dr", tab: "exceptions", label: "Delivery without a signed receipt", severity: "warning", permission: "sales.shipment.view", actionLabel: "Record the delivery" },
  { kind: "unshipped_order", tab: "exceptions", label: "Customer order late to send out", severity: "warning", permission: "sales.sales_order.view", actionLabel: "Open the order" },
  { kind: "credit_hold", tab: "exceptions", label: "Customer stopped for unpaid bills", severity: "warning", permission: "finance.credit_terms.view", actionLabel: "Open the customer" },
  { kind: "open_complaint", tab: "exceptions", label: "Open customer complaint", severity: "warning", permission: "quality.complaint.view", actionLabel: "Open the complaint" },
  // Wave 4 W4A: procurement exceptions
  { kind: "late_purchase_order", tab: "exceptions", label: "Late delivery from a supplier", severity: "warning", permission: "procurement.purchase_order.view", actionLabel: "Open the purchase order" },
  { kind: "over_delivery", tab: "exceptions", label: "Delivery with more than ordered", severity: "warning", permission: "procurement.receipt_discrepancy.approve", actionLabel: "Open the delivery" },
  { kind: "return_awaiting_qa", tab: "exceptions", label: "Customer return waiting for the QA check", severity: "warning", permission: "quality.disposition.approve", actionLabel: "Open the return" },
  // Wave 4 W4B: finance
  { kind: "overdue_invoice", tab: "exceptions", label: "Invoice not paid on time", severity: "warning", permission: "finance.invoice.view", actionLabel: "Open the invoice" },
  { kind: "disputed_bill", tab: "exceptions", label: "Supplier bill we disagree with", severity: "warning", permission: "finance.supplier_bill.view", actionLabel: "Open the bill" },
  // Wave 4 W4C: CAPA actions, recall cases, preventive maintenance (US-6-18, US-6-19)
  { kind: "overdue_capa_action", tab: "exceptions", label: "Late task in a fix-and-prevent plan", severity: "warning", permission: "quality.capa.view", actionLabel: "Open the plan" },
  { kind: "open_recall_case", tab: "exceptions", label: "Open product recall", severity: "critical", permission: "quality.recall_case.view", actionLabel: "Open the recall" },
  { kind: "pm_due", tab: "exceptions", label: "Regular maintenance due", severity: "info", permission: "maintenance.plan.view", actionLabel: "Open the maintenance plan" },
  { kind: "pm_overdue", tab: "exceptions", label: "Regular maintenance late", severity: "warning", permission: "maintenance.plan.view", actionLabel: "Open the maintenance plan" },
];

export function actionKind(kind: string): ActionKind | undefined {
  return ACTION_KINDS.find((k) => k.kind === kind);
}

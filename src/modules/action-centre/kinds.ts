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
  { kind: "approval.stock_adjustment", tab: "approvals", label: "Stock adjustment to approve", severity: "warning", permission: "inventory.adjustment.approve", actionLabel: "Review adjustment" },
  { kind: "approval.stock_count", tab: "approvals", label: "Count variance to approve", severity: "warning", permission: "inventory.stock_count.approve", actionLabel: "Review count" },
  { kind: "approval.work_order_release", tab: "approvals", label: "Work order to release", severity: "info", permission: "production.work_order.approve", actionLabel: "Review and release" },
  { kind: "approval.batch_disposition", tab: "approvals", label: "Batch waiting for a QA decision", severity: "warning", permission: "quality.disposition.approve", actionLabel: "Decide batch" },
  { kind: "approval.inspection_review", tab: "approvals", label: "Inspection to review", severity: "warning", permission: "quality.inspection.approve", actionLabel: "Review inspection" },
  { kind: "approval.conditional_release", tab: "approvals", label: "Conditional release to approve", severity: "warning", permission: "quality.conditional_release.approve", actionLabel: "Review request" },
  { kind: "approval.batch_reopen", tab: "approvals", label: "Batch reopen to approve", severity: "warning", permission: "quality.disposition.approve", actionLabel: "Review reopen" },
  { kind: "approval.equipment_override", tab: "approvals", label: "Equipment override to approve", severity: "warning", permission: "production.equipment_override.approve", actionLabel: "Review override" },
  { kind: "approval.setting_change", tab: "approvals", label: "Setting change to approve", severity: "info", permission: "platform.settings.approve", actionLabel: "Review change" },
  { kind: "approval.template_version", tab: "approvals", label: "Document template to approve", severity: "info", permission: "documents.template.approve", actionLabel: "Review template" },
  // Exceptions
  { kind: "late_work_order", tab: "exceptions", label: "Late work order", severity: "warning", permission: "production.work_order.view", actionLabel: "Open work order" },
  { kind: "low_stock", tab: "exceptions", label: "Finished goods below minimum stock", severity: "warning", permission: "inventory.balance.view", actionLabel: "Plan production" },
  { kind: "expiring_lot", tab: "exceptions", label: "Lot expiring soon", severity: "warning", permission: "inventory.lot.view", actionLabel: "Open lot" },
  { kind: "expired_stock", tab: "exceptions", label: "Expired stock on hand", severity: "critical", permission: "inventory.lot.view", actionLabel: "Open lot" },
  { kind: "failed_job", tab: "exceptions", label: "Failed background job", severity: "critical", permission: "platform.job.view", actionLabel: "Open in diagnostics" },
  { kind: "failed_import", tab: "exceptions", label: "Failed import", severity: "critical", permission: "platform.job.view", actionLabel: "Open import" },
  { kind: "reconciliation_difference", tab: "exceptions", label: "Stock reconciliation difference", severity: "critical", permission: "platform.job.view", actionLabel: "Open report" },
  { kind: "open_hold", tab: "exceptions", label: "Open QA hold", severity: "warning", permission: "quality.hold.view", actionLabel: "Open hold" },
  { kind: "open_deviation", tab: "exceptions", label: "Open deviation", severity: "warning", permission: "quality.deviation.view", actionLabel: "Open deviation" },
  { kind: "unacknowledged_dr", tab: "exceptions", label: "Delivery receipt not acknowledged", severity: "warning", permission: "sales.shipment.view", actionLabel: "Record delivery" },
  { kind: "unshipped_order", tab: "exceptions", label: "Order unshipped past its date", severity: "warning", permission: "sales.sales_order.view", actionLabel: "Open order" },
];

export function actionKind(kind: string): ActionKind | undefined {
  return ACTION_KINDS.find((k) => k.kind === kind);
}

export const ACTION_TABS: { tab: ActionTab | "alerts" | "sync"; label: string }[] = [
  { tab: "approvals", label: "Approvals" },
  { tab: "exceptions", label: "Exceptions" },
  { tab: "alerts", label: "Alerts" },
  { tab: "sync", label: "Sync" },
];

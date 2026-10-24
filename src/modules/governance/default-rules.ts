import type { APPROVAL_DOCUMENT_TYPES, APPROVAL_THRESHOLD_BASES } from "@/db/schema";
import type { Permission } from "@/lib/permissions";

export type ApprovalDocumentType = (typeof APPROVAL_DOCUMENT_TYPES)[number];
export type ThresholdBasis = (typeof APPROVAL_THRESHOLD_BASES)[number];

/** Shape of one rule (stored row or built-in default). Values are strings (numeric(18,6)). */
export type ApprovalRuleSpec = {
  documentType: ApprovalDocumentType;
  label: string;
  thresholdBasis: ThresholdBasis;
  minValue: string | null;
  maxValue: string | null;
  currency: string | null;
  step: number;
  requiredCount: number;
  requiredRoleCodes: string[];
  requiredPermissionCode: string | null;
  posterMayEqualApprover: boolean;
  escalationRoleCodes: string[] | null;
  escalationAfterHours: number | null;
  source: string;
};

/**
 * The base `.approve` permission of each record type that exists in code today. A step whose rule
 * names no permission requires this one; no matching rule at all → this permission alone suffices
 * (docs/permissions-matrix.md §5.2).
 */
export const BASE_APPROVE_PERMISSION: Partial<Record<ApprovalDocumentType, Permission>> = {
  formula_revision: "masterdata.formula.approve",
  routing_revision: "masterdata.routing.approve",
  routing_revision_sequencing: "masterdata.routing.approve",
  work_instruction_revision: "masterdata.work_instruction.approve",
  inspection_plan: "quality.inspection_plan.approve",
  equipment_override: "production.equipment_override.approve",
  stock_adjustment: "inventory.adjustment.approve",
  stock_count_variance: "inventory.stock_count.approve",
  setting_change_request: "platform.settings.approve",
};

/** Record types whose separation of duties is configurable (A-PM-14); every other type is mandatory. */
export const CONFIGURABLE_SOD_TYPES = ["sales_order", "quote", "work_order_release", "production_plan", "customer_return"] as const;

const rule = (r: Partial<ApprovalRuleSpec> & Pick<ApprovalRuleSpec, "documentType" | "label" | "step">): ApprovalRuleSpec => ({
  thresholdBasis: "always",
  minValue: null,
  maxValue: null,
  currency: null,
  requiredCount: 1,
  requiredRoleCodes: [],
  requiredPermissionCode: null,
  posterMayEqualApprover: false,
  escalationRoleCodes: null,
  escalationAfterHours: null,
  source: "A-PM-15",
  ...r,
});

/**
 * Today's defaults (docs/permissions-matrix.md §5.2, A-PM-15; master-data steps A-PRD-37 /
 * A-PROC-41; inventory steps as built in Wave 1). All are assumptions that need owner
 * confirmation. The seed writes them as `approval_rules` rows; an organization with no rows at all
 * for a record type is evaluated against these (fail-safe for a fresh database).
 *
 * Stock adjustment and count step 1 keep the Wave 1 behaviour: any holder of the approve
 * permission at the site (the matrix names site_manager; A-W2F-02).
 */
export const DEFAULT_APPROVAL_RULES: ApprovalRuleSpec[] = [
  // Master data (W1D policies, unchanged)
  rule({ documentType: "formula_revision", step: 1, label: "QA approval", requiredRoleCodes: ["qa_qc"], requiredPermissionCode: "masterdata.formula.approve", source: "A-PRD-37" }),
  rule({ documentType: "formula_revision", step: 2, label: "Site manager or owner approval", requiredRoleCodes: ["site_manager", "owner_director"], requiredPermissionCode: "masterdata.formula.approve", source: "A-PRD-37" }),
  rule({ documentType: "routing_revision", step: 1, label: "QA approval", requiredRoleCodes: ["qa_qc"], requiredPermissionCode: "masterdata.routing.approve", source: "A-PRD-37" }),
  rule({ documentType: "routing_revision", step: 2, label: "Site manager or owner approval", requiredRoleCodes: ["site_manager", "owner_director"], requiredPermissionCode: "masterdata.routing.approve", source: "A-PRD-37" }),
  rule({ documentType: "routing_revision_sequencing", step: 1, label: "Site manager or owner approval (sequencing-only change)", requiredRoleCodes: ["site_manager", "owner_director"], requiredPermissionCode: "masterdata.routing.approve", source: "A-PROC-41" }),
  rule({ documentType: "work_instruction_revision", step: 1, label: "Approval", requiredRoleCodes: ["qa_qc", "site_manager", "owner_director"], requiredPermissionCode: "masterdata.work_instruction.approve", source: "A-PRD-37" }),
  rule({ documentType: "inspection_plan", step: 1, label: "Second QA approval", requiredRoleCodes: ["qa_qc"], requiredPermissionCode: "quality.inspection_plan.approve", source: "A-PRD-37" }),
  rule({ documentType: "equipment_override", step: 1, label: "Site manager approval", requiredRoleCodes: ["site_manager"], requiredPermissionCode: "production.equipment_override.approve" }),
  rule({ documentType: "equipment_override", step: 2, label: "QA co-approval", requiredRoleCodes: ["qa_qc"], requiredPermissionCode: "production.equipment_override.approve" }),
  // Inventory (W1C behaviour; thresholds formerly settings inventory.*.second_step_*)
  rule({ documentType: "stock_adjustment", step: 1, label: "Approval", requiredPermissionCode: "inventory.adjustment.approve", source: "A-PM-15, A-W2F-02" }),
  rule({ documentType: "stock_adjustment", step: 2, label: "Owner approval above PHP 20,000", thresholdBasis: "amount", minValue: "20000", currency: "PHP", requiredRoleCodes: ["owner_director"], requiredPermissionCode: "inventory.adjustment.approve", source: "A-PRD-21, A-PM-15" }),
  rule({ documentType: "stock_count_variance", step: 1, label: "Variance approval", requiredPermissionCode: "inventory.stock_count.approve", source: "A-PM-15, A-W2F-02" }),
  rule({ documentType: "stock_count_variance", step: 2, label: "Owner approval above 2 % variance", thresholdBasis: "variance_pct", minValue: "2", requiredRoleCodes: ["owner_director"], requiredPermissionCode: "inventory.stock_count.approve", source: "A-PM-15" }),
  // Setting change requests (S1-03): owner_director or a second system_admin (SoD in the service and CHECK).
  rule({ documentType: "setting_change_request", step: 1, label: "Second administrator or owner approval", requiredRoleCodes: ["owner_director", "system_admin"], requiredPermissionCode: "platform.settings.approve", source: "S1-03" }),
  // Later phases (§5.2 defaults, stored now so the owner can review them in one place)
  rule({ documentType: "purchase_request", step: 1, label: "Site manager approval", requiredRoleCodes: ["site_manager"], escalationRoleCodes: ["owner_director"], escalationAfterHours: 48 }),
  rule({ documentType: "purchase_order", step: 1, label: "Site manager approval", thresholdBasis: "amount", maxValue: "50000", currency: "PHP", requiredRoleCodes: ["site_manager"], escalationRoleCodes: ["owner_director"], escalationAfterHours: 48 }),
  rule({ documentType: "purchase_order", step: 1, label: "Site manager approval", thresholdBasis: "amount", minValue: "50000", currency: "PHP", requiredRoleCodes: ["site_manager"] }),
  rule({ documentType: "purchase_order", step: 2, label: "Owner approval above PHP 50,000", thresholdBasis: "amount", minValue: "50000", currency: "PHP", requiredRoleCodes: ["owner_director"] }),
  rule({ documentType: "supplier_return", step: 1, label: "Site manager approval", thresholdBasis: "amount", maxValue: "50000", currency: "PHP", requiredRoleCodes: ["site_manager"], escalationRoleCodes: ["owner_director"], escalationAfterHours: 48 }),
  rule({ documentType: "supplier_return", step: 1, label: "Site manager approval", thresholdBasis: "amount", minValue: "50000", currency: "PHP", requiredRoleCodes: ["site_manager"] }),
  rule({ documentType: "supplier_return", step: 2, label: "Owner approval above PHP 50,000", thresholdBasis: "amount", minValue: "50000", currency: "PHP", requiredRoleCodes: ["owner_director"] }),
  rule({ documentType: "expense_claim", step: 1, label: "Site manager approval", thresholdBasis: "amount", maxValue: "5000", currency: "PHP", requiredRoleCodes: ["site_manager"], escalationRoleCodes: ["finance"], escalationAfterHours: 72 }),
  rule({ documentType: "expense_claim", step: 1, label: "Site manager approval", thresholdBasis: "amount", minValue: "5000", currency: "PHP", requiredRoleCodes: ["site_manager"] }),
  rule({ documentType: "expense_claim", step: 2, label: "Finance approval above PHP 5,000", thresholdBasis: "amount", minValue: "5000", currency: "PHP", requiredRoleCodes: ["finance"], escalationRoleCodes: ["owner_director"], escalationAfterHours: 72 }),
  rule({ documentType: "disposition_conditional_release", step: 1, label: "QA approval", requiredRoleCodes: ["qa_qc"] }),
  rule({ documentType: "disposition_conditional_release", step: 2, label: "Second QA approval", requiredRoleCodes: ["qa_qc"], escalationRoleCodes: ["owner_director"], escalationAfterHours: 24 }),
  rule({ documentType: "recall_case", step: 1, label: "QA approval", requiredRoleCodes: ["qa_qc"] }),
  rule({ documentType: "recall_case", step: 2, label: "Owner approval", requiredRoleCodes: ["owner_director"] }),
  rule({ documentType: "batch_reopen", step: 1, label: "Site manager approval", requiredRoleCodes: ["site_manager"] }),
  rule({ documentType: "batch_reopen", step: 2, label: "QA approval", requiredRoleCodes: ["qa_qc"] }),
  rule({ documentType: "sales_order", step: 1, label: "Finance approval (credit check failed)", thresholdBasis: "credit_check_failed", requiredRoleCodes: ["finance"], escalationRoleCodes: ["owner_director"], escalationAfterHours: 24 }),
  rule({ documentType: "sales_order", step: 1, label: "Finance approval above PHP 200,000", thresholdBasis: "amount", minValue: "200000", currency: "PHP", requiredRoleCodes: ["finance"], escalationRoleCodes: ["owner_director"], escalationAfterHours: 24 }),
  rule({ documentType: "quote", step: 1, label: "Site manager approval above 10 % discount", thresholdBasis: "discount_pct", minValue: "10", requiredRoleCodes: ["site_manager"] }),
  rule({ documentType: "quote", step: 2, label: "Finance approval above 10 % discount", thresholdBasis: "discount_pct", minValue: "10", requiredRoleCodes: ["finance"] }),
  rule({ documentType: "over_shipment", step: 1, label: "Site manager approval", requiredRoleCodes: ["site_manager"] }),
  ...(["invoice", "supplier_bill", "credit_note", "payment_record"] as const).flatMap((t) => [
    rule({ documentType: t, step: 1, label: "Finance approval", thresholdBasis: "amount", maxValue: "100000", currency: "PHP", requiredRoleCodes: ["finance"] }),
    rule({ documentType: t, step: 1, label: "Finance approval", thresholdBasis: "amount", minValue: "100000", currency: "PHP", requiredRoleCodes: ["finance"] }),
    rule({ documentType: t, step: 2, label: "Owner approval above PHP 100,000", thresholdBasis: "amount", minValue: "100000", currency: "PHP", requiredRoleCodes: ["owner_director"] }),
  ]),
  rule({ documentType: "payroll_period", step: 1, label: "Finance approval", requiredRoleCodes: ["finance"] }),
  rule({ documentType: "payroll_period", step: 2, label: "Owner approval", requiredRoleCodes: ["owner_director"] }),
  rule({ documentType: "payroll_period_reopen", step: 1, label: "Finance approval", requiredRoleCodes: ["finance"] }),
  rule({ documentType: "payroll_period_reopen", step: 2, label: "Owner approval", requiredRoleCodes: ["owner_director"] }),
  rule({ documentType: "period_lock_unlock", step: 1, label: "Finance approval", requiredRoleCodes: ["finance"] }),
  rule({ documentType: "period_lock_unlock", step: 2, label: "Owner approval", requiredRoleCodes: ["owner_director"] }),
  rule({ documentType: "leave_request", step: 1, label: "Site manager approval", requiredRoleCodes: ["site_manager"], escalationRoleCodes: ["hr_payroll"], escalationAfterHours: 48 }),
  rule({ documentType: "overtime_request", step: 1, label: "Site manager approval", requiredRoleCodes: ["site_manager"], escalationRoleCodes: ["hr_payroll"], escalationAfterHours: 48 }),
  rule({ documentType: "work_order_release", step: 1, label: "Planner or site manager approval", requiredRoleCodes: ["production_planner", "site_manager"] }),
];

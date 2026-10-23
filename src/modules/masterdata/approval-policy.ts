import type { Permission } from "@/lib/permissions";

/**
 * Default approval steps per record type (docs/permissions-matrix.md §5.2 defaults, A-PM-05,
 * A-PM-15, A-PROC-23, A-PROC-41). These are assumptions that need owner confirmation.
 *
 * They are kept as typed data here until the `approval_rules` table (US-1-14) exists; the
 * evaluation in versioning.ts already records every decision in `approval_decisions`, so moving
 * the policy into `approval_rules` rows later changes no stored data.
 */
export type ApprovalRecordType = "formula_revision" | "routing_revision" | "work_instruction_revision" | "inspection_plan" | "equipment_override";

export type ApprovalStepPolicy = { step: number; label: string; roles: string[]; permission: Permission };

export const APPROVAL_POLICIES: Record<ApprovalRecordType, ApprovalStepPolicy[]> = {
  formula_revision: [
    { step: 1, label: "QA approval", roles: ["qa_qc"], permission: "masterdata.formula.approve" },
    { step: 2, label: "Site manager or owner approval", roles: ["site_manager", "owner_director"], permission: "masterdata.formula.approve" },
  ],
  routing_revision: [
    { step: 1, label: "QA approval", roles: ["qa_qc"], permission: "masterdata.routing.approve" },
    { step: 2, label: "Site manager or owner approval", roles: ["site_manager", "owner_director"], permission: "masterdata.routing.approve" },
  ],
  work_instruction_revision: [{ step: 1, label: "Approval", roles: ["qa_qc", "site_manager", "owner_director"], permission: "masterdata.work_instruction.approve" }],
  inspection_plan: [{ step: 1, label: "Second QA approval", roles: ["qa_qc"], permission: "quality.inspection_plan.approve" }],
  equipment_override: [
    { step: 1, label: "Site manager approval", roles: ["site_manager"], permission: "production.equipment_override.approve" },
    { step: 2, label: "QA co-approval", roles: ["qa_qc"], permission: "production.equipment_override.approve" },
  ],
};

/**
 * A routing revision whose steps equal the superseded revision except for their order is a
 * sequencing-only change: one approval by a site manager or owner suffices (A-PROC-41).
 */
export const ROUTING_SEQUENCING_ONLY_POLICY: ApprovalStepPolicy[] = [
  { step: 1, label: "Site manager or owner approval (sequencing-only change)", roles: ["site_manager", "owner_director"], permission: "masterdata.routing.approve" },
];

import type { DbOrTx } from "@/db/client";
import type { Permission } from "@/lib/permissions";
import { type ApprovalDocumentType, BASE_APPROVE_PERMISSION, DEFAULT_APPROVAL_RULES, type EvaluatedStep, evaluateApprovalRules } from "@/modules/governance";

/**
 * Approval steps per master-data record type. Since Wave 2 (US-1-14) they are read from the
 * shared `approval_rules` table through the governance evaluation (docs/permissions-matrix.md
 * §5.2); the seeded rows equal the former typed defaults (A-PM-05, A-PM-15, A-PROC-23,
 * A-PROC-41), which remain the fallback for an organization without rows. Every decision is still
 * recorded in `approval_decisions`, so stored data did not change.
 */
export type ApprovalRecordType = "formula_revision" | "routing_revision" | "work_instruction_revision" | "inspection_plan" | "equipment_override";

/** `roles` empty = any role holding the permission; `requiredCount` distinct approvers (default 1). */
export type ApprovalStepPolicy = { step: number; label: string; roles: string[]; permission: Permission; requiredCount?: number };

/** Rule document type for a record type (a sequencing-only routing change has its own rules, A-PROC-41). */
export type ApprovalRuleType = ApprovalRecordType | "routing_revision_sequencing";

export function toStepPolicy(steps: EvaluatedStep[], ruleType: ApprovalRuleType): ApprovalStepPolicy[] {
  const base = BASE_APPROVE_PERMISSION[ruleType as ApprovalDocumentType] as Permission;
  return steps.map((s) => ({ step: s.step, label: s.label, roles: s.roleCodes, permission: (s.permission as Permission | null) ?? base, requiredCount: s.requiredCount }));
}

/** No matching rule → one step: the base `.approve` permission, any role (permissions-matrix §5.2). */
function baseOnly(ruleType: ApprovalRuleType): ApprovalStepPolicy[] {
  return [{ step: 1, label: "Approval", roles: [], permission: BASE_APPROVE_PERMISSION[ruleType as ApprovalDocumentType] as Permission }];
}

/** The steps that apply now (organization-wide rules, or the record's site rules when `siteId` is given). */
export async function loadApprovalPolicy(q: DbOrTx, organizationId: string, ruleType: ApprovalRuleType, siteId?: string | null): Promise<ApprovalStepPolicy[]> {
  const ev = await evaluateApprovalRules(q, organizationId, { documentType: ruleType, siteId: siteId ?? null });
  return ev.steps.length ? toStepPolicy(ev.steps, ruleType) : baseOnly(ruleType);
}

function defaultsFor(ruleType: ApprovalRuleType): ApprovalStepPolicy[] {
  const base = BASE_APPROVE_PERMISSION[ruleType as ApprovalDocumentType] as Permission;
  return DEFAULT_APPROVAL_RULES.filter((r) => r.documentType === ruleType).map((r) => ({ step: r.step, label: r.label, roles: r.requiredRoleCodes, permission: (r.requiredPermissionCode as Permission | null) ?? base }));
}

/** The built-in defaults (what the seed writes); kept for display and backwards compatibility. */
export const APPROVAL_POLICIES: Record<ApprovalRecordType, ApprovalStepPolicy[]> = {
  formula_revision: defaultsFor("formula_revision"),
  routing_revision: defaultsFor("routing_revision"),
  work_instruction_revision: defaultsFor("work_instruction_revision"),
  inspection_plan: defaultsFor("inspection_plan"),
  equipment_override: defaultsFor("equipment_override"),
};

export const ROUTING_SEQUENCING_ONLY_POLICY: ApprovalStepPolicy[] = defaultsFor("routing_revision_sequencing");

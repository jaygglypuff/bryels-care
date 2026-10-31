import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { type DbOrTx, type Tx } from "@/db/client";
import { approvalDecisions, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { approverLabel } from "@/lib/auth/self-approval";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { type ApprovalBasis, type EvaluatedStep, evaluateApprovalRules, evaluateApprovalRulesAudited, rolesAllowedNow } from "@/modules/governance";

/**
 * Approval steps of purchase requests, purchase orders and supplier returns through the shared
 * `approval_rules` evaluation (US-1-14; docs/permissions-matrix.md §5.1, §5.2; defaults A-PM-15:
 * site_manager, plus owner_director above PHP 50,000 for POs and returns). Each decision is one
 * `approval_decisions` row (record type, record id, cycle, step, decided by). A return to draft or a
 * rejection closes the cycle; the next submission starts cycle + 1. Separation of duties is mandatory
 * for these types (§5.1): the creator and the submitter never approve, and one person approves at most
 * one step of a record. SoD compares user ids, not roles.
 */

export type ProcRecordType = "purchase_request" | "purchase_order" | "supplier_return";

export const BASE_APPROVE: Record<ProcRecordType, Permission> = {
  purchase_request: "procurement.purchase_request.approve",
  purchase_order: "procurement.purchase_order.approve",
  supplier_return: "procurement.supplier_return.approve",
};

export async function decisionsOf(q: DbOrTx, organizationId: string, recordType: ProcRecordType, recordId: string) {
  const rows = await q
    .select({ d: approvalDecisions, name: users.displayName })
    .from(approvalDecisions)
    .innerJoin(users, eq(users.id, approvalDecisions.decidedBy))
    .where(and(eq(approvalDecisions.organizationId, organizationId), eq(approvalDecisions.recordType, recordType), eq(approvalDecisions.recordId, recordId)))
    .orderBy(asc(approvalDecisions.decidedAt));
  return rows.map((r) => ({ ...r.d, decidedByName: r.name }));
}

export function currentCycle(decisions: { cycle: number; decision: string }[]): number {
  const closed = decisions.filter((d) => d.decision !== "approved").map((d) => d.cycle);
  return closed.length ? Math.max(...closed) + 1 : 1;
}

export type ApprovalProgress = {
  steps: (EvaluatedStep & { approvals: { by: string; name: string; at: Date }[]; done: boolean })[];
  next: EvaluatedStep | null;
  cycle: number;
};

export async function approvalProgress(q: DbOrTx, organizationId: string, args: { recordType: ProcRecordType; recordId: string; siteId: string; basis: ApprovalBasis; requesterIds?: (string | null | undefined)[] }): Promise<ApprovalProgress> {
  const ev = await evaluateApprovalRules(q, organizationId, { documentType: args.recordType, siteId: args.siteId, basis: args.basis });
  const decisions = await decisionsOf(q, organizationId, args.recordType, args.recordId);
  const cycle = currentCycle(decisions);
  const open = decisions.filter((d) => d.cycle === cycle && d.decision === "approved");
  // No matching rule → the base permission alone (one approver), still recorded (§5.2).
  const evSteps = ev.steps.length ? ev.steps : [{ step: 1, label: "Approval", ruleIds: [], roleCodes: [], permission: BASE_APPROVE[args.recordType], requiredCount: 1, posterMayEqualApprover: false, escalation: null } satisfies EvaluatedStep];
  const steps = evSteps.map((s) => {
    const approvals = open.filter((d) => d.step === s.step).map((d) => ({ by: d.decidedBy, name: approverLabel(d.decidedByName, d.decidedBy, args.requesterIds ?? []) ?? d.decidedByName, at: d.decidedAt }));
    return { ...s, permission: s.permission ?? BASE_APPROVE[args.recordType], approvals, done: approvals.length >= s.requiredCount };
  });
  return { steps, next: steps.find((s) => !s.done) ?? null, cycle };
}

/** UI hint: whether the caller could decide the next step now (the service re-checks everything). */
export function canDecide(ctx: AuthContext, recordType: ProcRecordType, progress: ApprovalProgress, siteId: string, pendingSince: Date | null, excludedUserIds: (string | null | undefined)[]) {
  const step = progress.next;
  if (!step) return false;
  if (!ctx.canAt(BASE_APPROVE[recordType], siteId)) return false;
  if (step.permission && !ctx.can(step.permission as Permission)) return false;
  const roles = rolesAllowedNow(step, pendingSince);
  if (roles.length > 0 && !ctx.hasAnyRoleAt(roles, siteId, excludedUserIds)) return false;
  if (excludedUserIds.some((u) => ctx.sodConflictAt(u, siteId))) return false;
  if (progress.steps.some((s) => s.approvals.some((a) => ctx.sodConflictAt(a.by, siteId)))) return false;
  return true;
}

/**
 * Records the caller's decision on the next open step (the caller holds the record's row lock and has
 * checked its state). Returns whether every step is now complete.
 */
export async function recordDecision(
  tx: Tx,
  ctx: AuthContext,
  args: {
    recordType: ProcRecordType;
    recordId: string;
    recordNumber: string;
    siteId: string;
    basis: ApprovalBasis;
    pendingSince: Date | null;
    excludedUserIds: (string | null | undefined)[];
    decision: "approved" | "rejected" | "returned";
    note?: string | null;
  },
): Promise<{ final: boolean; step: EvaluatedStep | null; nextStep: EvaluatedStep | null }> {
  ctx.requireAt(BASE_APPROVE[args.recordType], args.siteId);
  if (ctx.sodBlocksAt(args.excludedUserIds.some((u) => u && u === ctx.userId), "You created or submitted this record, so another person must decide on it (separation of duties).", args.siteId)) {
    throw new DomainError("separation_of_duties", "You created or submitted this record, so another person must decide on it (separation of duties).", { ...ctx.refusalDetails(), code: "SEPARATION_OF_DUTIES" });
  }
  await evaluateApprovalRulesAudited(tx, ctx, { documentType: args.recordType, siteId: args.siteId, basis: args.basis, recordId: args.recordId, recordNumber: args.recordNumber });
  const progress = await approvalProgress(tx, ctx.organizationId, args);
  const step = progress.next;
  if (step) {
    if (step.permission) ctx.require(step.permission as Permission);
    const roles = rolesAllowedNow(step, args.pendingSince);
    if (roles.length > 0 && !ctx.actsAsAnyRoleAt(roles, args.siteId, args.excludedUserIds)) {
      throw new DomainError("forbidden", `Step ${step.step} (${step.label}) must be decided by ${roles.map((r) => r.replace(/_/g, " ")).join(" or ")}.`);
    }
    if (ctx.sodBlocksAt(progress.steps.some((s) => s.approvals.some((a) => a.by === ctx.userId)), "You already approved a step of this record. A different person must decide this step.", args.siteId)) {
      throw new DomainError("separation_of_duties", "You already approved a step of this record. A different person must decide this step.", { ...ctx.refusalDetails(), code: "SEPARATION_OF_DUTIES" });
    }
  }
  if (args.decision !== "approved" && !args.note?.trim()) throw new DomainError("validation", "Give the reason.", { field: "reason" });
  await tx.insert(approvalDecisions).values({
    organizationId: ctx.organizationId,
    siteId: args.siteId,
    recordType: args.recordType,
    recordId: args.recordId,
    step: step?.step ?? 1,
    cycle: progress.cycle,
    decision: args.decision,
    decidedBy: ctx.userId,
    note: args.note?.trim() || null,
  });
  if (args.decision !== "approved") return { final: false, step, nextStep: null };
  const remaining = progress.steps.filter((s) => !s.done && !(s.step === step?.step && s.approvals.length + 1 >= s.requiredCount));
  return { final: remaining.length === 0, step, nextStep: remaining[0] ?? null };
}

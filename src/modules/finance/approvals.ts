import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/db/client";
import { approvalDecisions, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { type ApprovalBasis, type ApprovalDocumentType, type EvaluatedStep, evaluateApprovalRules, evaluateApprovalRulesAudited, rolesAllowedNow } from "@/modules/governance";
import { notifyRoles } from "@/modules/platform";

/**
 * Approval steps of the finance documents through the shared `approval_rules` evaluation (US-1-14;
 * docs/permissions-matrix.md §5.1, §5.2; defaults A-PM-15): invoice, supplier_bill, credit_note and
 * payment_record above/below PHP 100,000; expense_claim with the site-manager / finance split at 5,000.
 * Each decision is an `approval_decisions` row (record type, id, cycle, step, decided by); a return or a
 * rejection closes the cycle so earlier approvals never count again. Separation of duties compares user
 * ids: the creator/submitter/claimant never approves, one person never approves two steps, and the poster
 * may equal an approver only when every matched step allows it (`poster_may_equal_approver`, A-PM-10).
 */

export type FinanceRecordType = "invoice" | "supplier_bill" | "credit_note" | "payment_record" | "expense_claim";

export const BASE_APPROVE: Record<FinanceRecordType, Permission> = {
  invoice: "finance.invoice.approve",
  supplier_bill: "finance.supplier_bill.approve",
  credit_note: "finance.credit_note.approve",
  payment_record: "finance.payment_record.approve",
  expense_claim: "finance.expense_claim.approve",
};

const SOD_CODE = { code: "SEPARATION_OF_DUTIES" };

export async function decisionsOf(q: DbOrTx, organizationId: string, recordType: string, recordId: string) {
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

export type Progress = {
  steps: (EvaluatedStep & { approvals: { by: string; name: string; at: Date }[]; done: boolean })[];
  next: (EvaluatedStep & { approvals: { by: string; name: string; at: Date }[]; done: boolean }) | null;
  cycle: number;
  /** Everyone who approved a step of the open cycle. */
  approvers: string[];
  /** False when a matched step forbids the poster being one of its approvers. */
  posterMayEqualApprover: boolean;
};

export type ApprovalArgs = { recordType: FinanceRecordType; recordId: string; siteId: string | null; basis: ApprovalBasis; on?: Date };

/** The steps that apply (no audit) with the decisions of the open cycle. */
export async function approvalProgress(q: DbOrTx, organizationId: string, args: ApprovalArgs): Promise<Progress> {
  const ev = await evaluateApprovalRules(q, organizationId, { documentType: args.recordType as ApprovalDocumentType, siteId: args.siteId, basis: args.basis, on: args.on });
  const decisions = await decisionsOf(q, organizationId, args.recordType, args.recordId);
  const cycle = currentCycle(decisions);
  const open = decisions.filter((d) => d.cycle === cycle && d.decision === "approved");
  const steps = ev.steps.map((s) => {
    const approvals = open.filter((d) => d.step === s.step).map((d) => ({ by: d.decidedBy, name: d.decidedByName, at: d.decidedAt }));
    return { ...s, permission: s.permission ?? BASE_APPROVE[args.recordType], approvals, done: approvals.length >= s.requiredCount };
  });
  return {
    steps,
    next: steps.find((s) => !s.done) ?? null,
    cycle,
    approvers: [...new Set(open.map((d) => d.decidedBy))],
    posterMayEqualApprover: steps.every((s) => s.posterMayEqualApprover),
  };
}

/** Audited evaluation at submission: returns whether any step applies. */
export async function evaluateAtSubmit(tx: Tx, ctx: AuthContext, args: ApprovalArgs & { recordNumber: string }) {
  const ev = await evaluateApprovalRulesAudited(tx, ctx, { documentType: args.recordType as ApprovalDocumentType, siteId: args.siteId, basis: args.basis, recordId: args.recordId, recordNumber: args.recordNumber });
  return ev;
}

/** UI hint: whether the caller could decide the next step now (the service re-checks everything). */
export function canDecide(ctx: AuthContext, recordType: FinanceRecordType, progress: Progress | null, pendingSince: Date | null, excludedUserIds: (string | null | undefined)[]) {
  const step = progress?.next;
  if (!step) return false;
  if (!ctx.can(BASE_APPROVE[recordType])) return false;
  if (step.permission && !ctx.can(step.permission as Permission)) return false;
  const roles = rolesAllowedNow(step, pendingSince);
  if (roles.length > 0 && !ctx.hasAnyRole(roles)) return false;
  if (excludedUserIds.some((u) => ctx.sodConflict(u))) return false;
  if (progress.approvers.some((u) => ctx.sodConflict(u))) return false;
  return true;
}

/**
 * Records the caller's decision on the next open step (the caller holds the record row lock and checked
 * the record's state). Returns whether every step is now complete.
 */
export async function recordDecision(
  tx: Tx,
  ctx: AuthContext,
  args: ApprovalArgs & {
    recordNumber: string;
    pendingSince: Date | null;
    excludedUserIds: (string | null | undefined)[];
    decision: "approved" | "rejected" | "returned";
    note?: string | null;
    /** Extra role requirement for this record (e.g. bills without a PO always need a finance approver, A-FIN-09). */
    requireRole?: string | null;
  },
): Promise<{ final: boolean; step: EvaluatedStep | null; progress: Progress }> {
  const base = BASE_APPROVE[args.recordType];
  if (args.siteId) ctx.requireAt(base, args.siteId);
  else ctx.require(base);
  if (ctx.sodBlocks(args.excludedUserIds.some((u) => u && u === ctx.userId), "You created or submitted this record, so another person must decide on it.")) {
    throw new DomainError("separation_of_duties", "You created or submitted this record, so another person must decide on it.", { ...ctx.refusalDetails(), ...SOD_CODE });
  }
  await evaluateApprovalRulesAudited(tx, ctx, { documentType: args.recordType as ApprovalDocumentType, siteId: args.siteId, basis: args.basis, recordId: args.recordId, recordNumber: args.recordNumber });
  const progress = await approvalProgress(tx, ctx.organizationId, args);
  const step = progress.next;
  if (step) {
    if (step.permission) ctx.require(step.permission as Permission);
    const roles = rolesAllowedNow(step, args.pendingSince);
    if (roles.length > 0 && !ctx.actsAsAnyRole(roles)) {
      throw new DomainError("forbidden", `Step ${step.step} (${step.label}) must be decided by ${roles.map((r) => r.replace(/_/g, " ")).join(" or ")}.`);
    }
  }
  if (args.requireRole && args.decision === "approved" && !ctx.actsAsAnyRole([args.requireRole])) {
    throw new DomainError("forbidden", `This record must be approved by ${args.requireRole.replace(/_/g, " ")}.`);
  }
  if (ctx.sodBlocks(args.decision === "approved" && progress.approvers.includes(ctx.userId), "You already approved a step of this record. A different person must decide this step.")) {
    throw new DomainError("separation_of_duties", "You already approved a step of this record. A different person must decide this step.", { ...ctx.refusalDetails(), ...SOD_CODE });
  }
  if (args.decision !== "approved" && !(args.note ?? "").trim()) throw new DomainError("validation", "Give the reason.", { field: "reason" });
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
  if (args.decision !== "approved") return { final: false, step, progress };
  const remaining = progress.steps.filter((s) => !s.done && !(s.step === step?.step && s.approvals.length + 1 >= s.requiredCount));
  return { final: remaining.length === 0, step, progress };
}

/**
 * V-FIN-SOD at posting: the poster may not be one of the approvers of the open cycle unless every
 * matched step allows it (A-PM-10).
 */
export async function assertPosterAllowed(tx: Tx, ctx: AuthContext, args: ApprovalArgs) {
  const progress = await approvalProgress(tx, ctx.organizationId, args);
  if (ctx.sodBlocks(!progress.posterMayEqualApprover && progress.approvers.includes(ctx.userId), "You approved this record. Above the threshold another person must post it (poster ≠ approver).")) {
    throw new DomainError("separation_of_duties", "You approved this record. Above the threshold another person must post it (poster ≠ approver).", { ...ctx.refusalDetails(), ...SOD_CODE });
  }
  return progress;
}

/** Tells the next step's roles that a record waits for them (in-app notification). */
export async function notifyNextStep(tx: Tx, ctx: AuthContext, step: EvaluatedStep | null, n: { siteId: string | null; kind: string; title: string; body: string; entityType: string; entityId: string; link: string }) {
  if (!step?.roleCodes.length) return;
  await notifyRoles(tx, { roleCodes: step.roleCodes, siteId: n.siteId }, { organizationId: ctx.organizationId, siteId: n.siteId, kind: n.kind, severity: "info", title: n.title, body: n.body, entityType: n.entityType, entityId: n.entityId, link: n.link });
}

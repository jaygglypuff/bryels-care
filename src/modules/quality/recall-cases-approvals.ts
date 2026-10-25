import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/db/client";
import { approvalDecisions, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { type EvaluatedStep, evaluateApprovalRules, evaluateApprovalRulesAudited, rolesAllowedNow } from "@/modules/governance";

/**
 * Approval steps of recall cases and change controls through the shared `approval_rules` evaluation
 * (docs/permissions-matrix.md §5.1, §5.2; defaults: recall_case = qa_qc then owner_director,
 * change_control = qa_qc). Each decision is an `approval_decisions` row (record type, id, cycle, step).
 * A return or rejection closes the cycle; the next submission starts cycle + 1 so earlier approvals never
 * count twice. Separation of duties: the submitter and the opener never approve, and one person decides at
 * most one step of a cycle.
 */

export type QualityApprovalType = "recall_case" | "change_control";

const BASE: Record<QualityApprovalType, Permission> = {
  recall_case: "quality.recall_case.approve",
  change_control: "quality.change_control.approve",
};

async function decisionsOf(q: DbOrTx, organizationId: string, recordType: QualityApprovalType, recordId: string) {
  const rows = await q
    .select({ d: approvalDecisions, name: users.displayName })
    .from(approvalDecisions)
    .innerJoin(users, eq(users.id, approvalDecisions.decidedBy))
    .where(and(eq(approvalDecisions.organizationId, organizationId), eq(approvalDecisions.recordType, recordType), eq(approvalDecisions.recordId, recordId)))
    .orderBy(asc(approvalDecisions.decidedAt));
  return rows.map((r) => ({ ...r.d, decidedByName: r.name }));
}

function currentCycle(decisions: { cycle: number; decision: string }[]): number {
  const closed = decisions.filter((d) => d.decision !== "approved").map((d) => d.cycle);
  return closed.length ? Math.max(...closed) + 1 : 1;
}

export type QualityApprovalProgress = {
  steps: (EvaluatedStep & { approvals: { by: string; name: string; at: Date; note: string | null }[]; done: boolean })[];
  next: (EvaluatedStep & { done: boolean }) | null;
  cycle: number;
  history: { cycle: number; step: number; decision: string; by: string; name: string; at: Date; note: string | null }[];
};

/** Steps that apply now (no audit) with the decisions of the open cycle and the full history. */
export async function qualityApprovalProgress(q: DbOrTx, organizationId: string, args: { recordType: QualityApprovalType; recordId: string; siteId: string | null }): Promise<QualityApprovalProgress> {
  const ev = await evaluateApprovalRules(q, organizationId, { documentType: args.recordType, siteId: args.siteId });
  const decisions = await decisionsOf(q, organizationId, args.recordType, args.recordId);
  const cycle = currentCycle(decisions);
  const open = decisions.filter((d) => d.cycle === cycle && d.decision === "approved");
  const steps = (ev.steps.length ? ev.steps : [{ step: 1, label: "Approval", ruleIds: [], roleCodes: [], permission: BASE[args.recordType], requiredCount: 1, posterMayEqualApprover: false, escalation: null }]).map((s) => {
    const approvals = open.filter((d) => d.step === s.step).map((d) => ({ by: d.decidedBy, name: d.decidedByName, at: d.decidedAt, note: d.note }));
    return { ...s, permission: s.permission ?? BASE[args.recordType], approvals, done: approvals.length >= s.requiredCount };
  });
  return {
    steps,
    next: steps.find((s) => !s.done) ?? null,
    cycle,
    history: decisions.map((d) => ({ cycle: d.cycle, step: d.step, decision: d.decision, by: d.decidedBy, name: d.decidedByName, at: d.decidedAt, note: d.note })),
  };
}

/** Whether the caller could decide the next step now (UI hint; the service re-checks everything). */
export function canDecideQualityStep(ctx: AuthContext, recordType: QualityApprovalType, p: QualityApprovalProgress, pendingSince: Date | null, excludedUserIds: (string | null | undefined)[]) {
  const step = p.next;
  if (!step) return false;
  if (!ctx.can(BASE[recordType])) return false;
  if (step.permission && !ctx.can(step.permission as Permission)) return false;
  const roles = rolesAllowedNow(step, pendingSince);
  if (roles.length > 0 && !ctx.hasAnyRole(roles)) return false;
  if (excludedUserIds.some((u) => ctx.sodConflict(u))) return false;
  if (p.steps.some((s) => s.approvals.some((a) => ctx.sodConflict(a.by)))) return false;
  return true;
}

/**
 * Records the caller's decision on the next open step (caller holds the record row lock and has checked
 * the record's state). Returns whether every step is now complete.
 */
export async function recordQualityDecision(
  tx: Tx,
  ctx: AuthContext,
  args: {
    recordType: QualityApprovalType;
    recordId: string;
    recordNumber: string;
    siteId: string | null;
    pendingSince: Date | null;
    excludedUserIds: (string | null | undefined)[];
    decision: "approved" | "rejected" | "returned";
    note?: string | null;
  },
): Promise<{ final: boolean; step: EvaluatedStep | null }> {
  ctx.require(BASE[args.recordType]);
  if (args.siteId) ctx.requireAt(BASE[args.recordType], args.siteId);
  await evaluateApprovalRulesAudited(tx, ctx, { documentType: args.recordType, siteId: args.siteId, recordId: args.recordId, recordNumber: args.recordNumber });
  const progress = await qualityApprovalProgress(tx, ctx.organizationId, args);
  const step = progress.next;
  if (!step) throw new DomainError("state", "This record has no approval step waiting for a decision.");
  if (ctx.sodBlocks(args.excludedUserIds.some((u) => u && u === ctx.userId), "You opened or submitted this record, so another person must decide on it (separation of duties).")) {
    throw new DomainError("separation_of_duties", "You opened or submitted this record, so another person must decide on it (separation of duties).", { ...ctx.refusalDetails(), code: "SEPARATION_OF_DUTIES" });
  }
  if (step.permission) ctx.require(step.permission as Permission);
  const roles = rolesAllowedNow(step, args.pendingSince);
  if (roles.length > 0 && !ctx.actsAsAnyRole(roles)) {
    throw new DomainError("forbidden", `Step ${step.step} (${step.label}) must be decided by ${roles.map((r) => r.replace(/_/g, " ")).join(" or ")}.`);
  }
  if (ctx.sodBlocks(progress.steps.some((s) => s.approvals.some((a) => a.by === ctx.userId)), "You already approved a step of this record. A different person must decide this step.")) {
    throw new DomainError("separation_of_duties", "You already approved a step of this record. A different person must decide this step.", { ...ctx.refusalDetails(), code: "SEPARATION_OF_DUTIES" });
  }
  const note = args.note?.trim() || null;
  if (args.decision !== "approved" && (!note || note.length < 5)) throw new DomainError("validation", "Give the reason (at least 5 characters).", { field: "note" });
  if (note && note.length > 1000) throw new DomainError("validation", "Too long (max 1,000 characters).", { field: "note" });
  await tx.insert(approvalDecisions).values({
    organizationId: ctx.organizationId,
    siteId: args.siteId,
    recordType: args.recordType,
    recordId: args.recordId,
    step: step.step,
    cycle: progress.cycle,
    decision: args.decision,
    decidedBy: ctx.userId,
    note,
  });
  if (args.decision !== "approved") return { final: false, step };
  const remaining = progress.steps.filter((s) => !s.done && !(s.step === step.step && s.approvals.length + 1 >= s.requiredCount));
  return { final: remaining.length === 0, step };
}

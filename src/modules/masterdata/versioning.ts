import "server-only";
import { type SQL, and, asc, eq, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/db/client";
import { approvalDecisions, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { evaluateApprovalRulesAudited } from "@/modules/governance";
import { type ApprovalRecordType, type ApprovalRuleType, type ApprovalStepPolicy, loadApprovalPolicy, toStepPolicy } from "./approval-policy";

/**
 * Version state machine shared by formula, routing, work-instruction revisions and inspection
 * plans (docs/data-model.md §4.2). Every status change goes through assertVersionTransition and
 * is audited by the caller with before/after {status, revisionNo}.
 */
export const VERSION_STATUSES = ["draft", "pending_approval", "approved", "rejected", "retired"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const VERSION_TRANSITIONS: Record<VersionStatus, readonly VersionStatus[]> = {
  draft: ["pending_approval"],
  pending_approval: ["approved", "rejected", "draft"],
  approved: ["retired"],
  rejected: [],
  retired: [],
};

export function canVersionTransition(from: string, to: VersionStatus): boolean {
  return (VERSION_STATUSES as readonly string[]).includes(from) && VERSION_TRANSITIONS[from as VersionStatus].includes(to);
}

export function assertVersionTransition(label: string, from: string, to: VersionStatus) {
  if (!canVersionTransition(from, to)) {
    throw new DomainError("state", `${label} is ${from.replace(/_/g, " ")} and cannot move to ${to.replace(/_/g, " ")}.`);
  }
}

/** Draft-only editing (approved revisions are immutable; changes go through a new revision). */
export function assertDraft(label: string, status: string) {
  if (status !== "draft") {
    throw new DomainError("state", `${label} is ${status.replace(/_/g, " ")}. Only a draft can be changed; create a new revision to change approved content.`);
  }
}

/** Today's calendar date in the plant's time zone (Asia/Manila, ADR-019), as YYYY-MM-DD. */
export function businessToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isIsoDate(v: string | null | undefined): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Label for an approved revision relative to a date: effective, scheduled or superseded (derived, never stored). */
export function effectiveLabel(r: { status: string; effectiveFrom: string | null; effectiveTo: string | null }, on = businessToday()) {
  if (r.status !== "approved") return r.status;
  if (r.effectiveFrom && r.effectiveFrom > on) return "scheduled";
  if (r.effectiveTo && r.effectiveTo <= on) return "superseded";
  return "effective";
}

/** Permission check that passes when the caller holds any of the listed permissions. */
export function requireAny(ctx: AuthContext, perms: Parameters<AuthContext["can"]>[0][]) {
  if (!perms.some((p) => ctx.can(p))) ctx.require(perms[0]);
}

/* ------------------------------------------------------------------ approvals */

export type ApprovalState = {
  policy: ApprovalStepPolicy[];
  decisions: { step: number; decision: string; decidedBy: string; decidedByName: string; decidedAt: Date; note: string | null }[];
  /** Next step awaiting a decision, or null when complete/rejected. */
  nextStep: ApprovalStepPolicy | null;
};

/**
 * Approval decisions recorded so far on a record, with the policy that applies (from
 * `approval_rules` via the governance evaluation unless a policy is passed, US-1-14).
 */
export async function approvalState(dbx: DbOrTx, organizationId: string, recordType: ApprovalRecordType, recordId: string, policyArg?: ApprovalStepPolicy[]): Promise<ApprovalState> {
  const policy = policyArg ?? (await loadApprovalPolicy(dbx, organizationId, recordType));
  const rows = await dbx
    .select({ d: approvalDecisions, name: users.displayName })
    .from(approvalDecisions)
    .innerJoin(users, eq(users.id, approvalDecisions.decidedBy))
    .where(and(eq(approvalDecisions.organizationId, organizationId), eq(approvalDecisions.recordType, recordType), eq(approvalDecisions.recordId, recordId)))
    .orderBy(asc(approvalDecisions.step), asc(approvalDecisions.decidedAt));
  const decisions = rows.map((r) => ({ step: r.d.step, decision: r.d.decision, decidedBy: r.d.decidedBy, decidedByName: r.name, decidedAt: r.d.decidedAt, note: r.d.note }));
  const rejected = decisions.some((d) => d.decision === "rejected");
  const approvedCount = (step: number) => decisions.filter((d) => d.decision === "approved" && d.step === step).length;
  const nextStep = rejected ? null : (policy.find((p) => approvedCount(p.step) < (p.requiredCount ?? 1)) ?? null);
  return { policy, decisions, nextStep };
}

/** True when the caller may decide the given step (role + permission), ignoring separation of duties. */
export function canDecideStep(ctx: AuthContext, step: ApprovalStepPolicy | null) {
  if (!step) return false;
  return ctx.can(step.permission) && (step.roles.length === 0 || ctx.hasAnyRole(step.roles));
}

/**
 * Records one approval-step decision (docs/permissions-matrix.md §5.1, §5.2).
 * - the caller holds the step permission and one of the step roles;
 * - the caller is not the creator/submitter/requester (separation of duties);
 * - the caller has not decided an earlier step of the same record (distinct approvers).
 * Returns whether the record is now fully approved or rejected. Caller holds the record row lock.
 */
export async function recordApprovalDecision(
  tx: Tx,
  ctx: AuthContext,
  args: {
    recordType: ApprovalRecordType;
    recordId: string;
    siteId?: string | null;
    excludedUserIds: (string | null | undefined)[];
    decision: "approved" | "rejected";
    note?: string | null;
    policy?: ApprovalStepPolicy[];
    /** Rule document type when it differs from the record type (sequencing-only routing change). */
    ruleType?: ApprovalRuleType;
  },
): Promise<{ step: ApprovalStepPolicy; final: boolean; rejected: boolean }> {
  let policy = args.policy;
  if (!policy) {
    // US-1-14 AC2: the evaluation is audited (platform.approval_rule.evaluated) with the rule ids.
    const ruleType = args.ruleType ?? args.recordType;
    const ev = await evaluateApprovalRulesAudited(tx, ctx, { documentType: ruleType, siteId: args.siteId ?? null, recordId: args.recordId });
    policy = ev.steps.length ? toStepPolicy(ev.steps, ruleType) : await loadApprovalPolicy(tx, ctx.organizationId, ruleType, args.siteId);
  }
  const state = await approvalState(tx, ctx.organizationId, args.recordType, args.recordId, policy);
  const step = state.nextStep;
  if (!step) throw new DomainError("state", "This record has no approval step waiting for a decision.");
  ctx.require(step.permission);
  if (step.roles.length > 0 && !ctx.actsAsAnyRole(step.roles)) {
    throw new DomainError("forbidden", `Step ${step.step} (${step.label}) must be decided by ${step.roles.map((r) => r.replace(/_/g, " ")).join(" or ")}.`);
  }
  if (ctx.sodBlocks(args.excludedUserIds.some((u) => u && u === ctx.userId), "You prepared or requested this record, so another person must approve it.")) {
    throw new DomainError("separation_of_duties", "You prepared or requested this record, so another person must approve it.", ctx.refusalDetails());
  }
  if (ctx.sodBlocks(state.decisions.some((d) => d.decidedBy === ctx.userId), "You already approved an earlier step. A different person must decide this step.")) {
    throw new DomainError("separation_of_duties", "You already approved an earlier step. A different person must decide this step.", ctx.refusalDetails());
  }
  if (args.decision === "rejected" && !args.note?.trim()) throw new DomainError("validation", "Enter the reason for rejecting.");
  await tx.insert(approvalDecisions).values({
    organizationId: ctx.organizationId,
    siteId: args.siteId ?? null,
    recordType: args.recordType,
    recordId: args.recordId,
    step: step.step,
    decision: args.decision,
    decidedBy: ctx.userId,
    note: args.note?.trim() || null,
  });
  const lastStep = Math.max(...state.policy.map((p) => p.step));
  const approvedHere = state.decisions.filter((d) => d.decision === "approved" && d.step === step.step).length + 1;
  return { step, final: args.decision === "approved" && step.step === lastStep && approvedHere >= (step.requiredCount ?? 1), rejected: args.decision === "rejected" };
}

/**
 * Closes the approved revisions of one parent that would overlap a revision becoming effective on
 * `from` (they get effective_to = from, i.e. superseded on that date). An approved revision that
 * starts on or after `from` is a conflict: retire it first. Caller holds the parent row lock.
 */
export async function supersedeOverlapping(
  tx: Tx,
  table: "formula_revisions" | "routing_revisions" | "work_instruction_revisions" | "inspection_plans",
  /** SQL predicate selecting the revisions of the same parent, e.g. sql`formula_id = ${id}`. */
  scope: SQL,
  newId: string,
  from: string,
): Promise<{ id: string; revisionNo: number }[]> {
  const rows = await tx.execute<{ id: string; revision_no: number; effective_from: string }>(sql`
    select id, revision_no, effective_from::text as effective_from from ${sql.identifier(table)}
    where ${scope} and status = 'approved' and id <> ${newId}
      and (effective_to is null or effective_to > ${from}::date)`);
  const closed: { id: string; revisionNo: number }[] = [];
  for (const r of rows) {
    if (r.effective_from >= from) {
      throw new DomainError("conflict", `Revision ${r.revision_no} is already approved from ${r.effective_from}. Choose an effective date after it, or retire it first.`);
    }
    await tx.execute(sql`update ${sql.identifier(table)} set effective_to = ${from}::date where id = ${r.id}`);
    closed.push({ id: r.id, revisionNo: Number(r.revision_no) });
  }
  return closed;
}

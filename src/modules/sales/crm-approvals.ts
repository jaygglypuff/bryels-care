import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { type DbOrTx, type Tx } from "@/db/client";
import { approvalDecisions, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { type ApprovalBasis, type ApprovalDocumentType, type EvaluatedStep, evaluateApprovalRules, evaluateApprovalRulesAudited, rolesAllowedNow } from "@/modules/governance";

/**
 * Approval steps of the commercial records (sales orders, quotes, price lists) through the shared
 * `approval_rules` evaluation (US-1-14; docs/permissions-matrix.md §5.1, §5.2). Each decision is an
 * `approval_decisions` row (record type, record id, cycle, step, decided by). A return to draft or a
 * rejection closes the cycle; the next submission starts cycle + 1, so earlier approvals never count
 * twice. The approver must hold the base permission and, when the step names roles, one of them (or an
 * escalation role once the step has waited long enough); separation of duties compares user ids.
 */

export type RecordType = "sales_order" | "quote" | "price_list";

const BASE: Record<RecordType, Permission> = {
  sales_order: "sales.sales_order.approve",
  quote: "sales.quote.approve",
  price_list: "sales.price_list.approve",
};

export async function decisionsOf(q: DbOrTx, organizationId: string, recordType: RecordType, recordId: string) {
  const rows = await q
    .select({ d: approvalDecisions, name: users.displayName })
    .from(approvalDecisions)
    .innerJoin(users, eq(users.id, approvalDecisions.decidedBy))
    .where(and(eq(approvalDecisions.organizationId, organizationId), eq(approvalDecisions.recordType, recordType), eq(approvalDecisions.recordId, recordId)))
    .orderBy(asc(approvalDecisions.decidedAt));
  return rows.map((r) => ({ ...r.d, decidedByName: r.name }));
}

/** The cycle that is open now: 1 + every closed cycle (a cycle closes with a return or rejection). */
export function currentCycle(decisions: { cycle: number; decision: string }[]): number {
  const closed = decisions.filter((d) => d.decision !== "approved").map((d) => d.cycle);
  return closed.length ? Math.max(...closed) + 1 : 1;
}

export type ApprovalProgress = {
  steps: (EvaluatedStep & { approvals: { by: string; name: string; at: Date }[]; done: boolean })[];
  next: EvaluatedStep | null;
  cycle: number;
};

/** Steps that apply to the record (no audit), with the decisions of the open cycle. */
export async function approvalProgress(
  q: DbOrTx,
  organizationId: string,
  args: { recordType: RecordType; recordId: string; siteId: string | null; basis: ApprovalBasis; on?: Date },
): Promise<ApprovalProgress> {
  const ev = await evaluateApprovalRules(q, organizationId, { documentType: args.recordType as ApprovalDocumentType, siteId: args.siteId, basis: args.basis, on: args.on });
  const decisions = await decisionsOf(q, organizationId, args.recordType, args.recordId);
  const cycle = currentCycle(decisions);
  const open = decisions.filter((d) => d.cycle === cycle && d.decision === "approved");
  const steps = ev.steps.map((s) => {
    const approvals = open.filter((d) => d.step === s.step).map((d) => ({ by: d.decidedBy, name: d.decidedByName, at: d.decidedAt }));
    return { ...s, permission: s.permission ?? BASE[args.recordType], approvals, done: approvals.length >= s.requiredCount };
  });
  return { steps, next: steps.find((s) => !s.done) ?? null, cycle };
}

/** Whether the caller could decide the next step now (UI hint; the service re-checks everything). */
export function canDecide(ctx: AuthContext, recordType: RecordType, step: EvaluatedStep | null, pendingSince: Date | null, excludedUserIds: (string | null | undefined)[], sod: boolean) {
  if (!step) return false;
  if (!ctx.can(BASE[recordType])) return false;
  if (step.permission && !ctx.can(step.permission as Permission)) return false;
  const roles = rolesAllowedNow(step, pendingSince);
  if (roles.length > 0 && !ctx.hasAnyRole(roles)) return false;
  if (sod && excludedUserIds.some((u) => ctx.sodConflict(u))) return false;
  return true;
}

/**
 * Records the caller's decision on the next open step (caller holds the record row lock and has
 * checked the record's state). Returns whether every step is now complete.
 */
export async function recordDecision(
  tx: Tx,
  ctx: AuthContext,
  args: {
    recordType: RecordType;
    recordId: string;
    recordNumber: string;
    siteId: string | null;
    basis: ApprovalBasis;
    pendingSince: Date | null;
    excludedUserIds: (string | null | undefined)[];
    sod: boolean;
    decision: "approved" | "rejected" | "returned";
    note?: string | null;
  },
): Promise<{ final: boolean; step: EvaluatedStep | null }> {
  ctx.require(BASE[args.recordType]);
  if (args.siteId) ctx.requireAt(BASE[args.recordType], args.siteId);
  await evaluateApprovalRulesAudited(tx, ctx, { documentType: args.recordType as ApprovalDocumentType, siteId: args.siteId, basis: args.basis, recordId: args.recordId, recordNumber: args.recordNumber });
  const progress = await approvalProgress(tx, ctx.organizationId, args);
  const step = progress.next;
  if (ctx.sodBlocks(args.sod && args.excludedUserIds.some((u) => u && u === ctx.userId), "You created or submitted this record, so another person must decide on it.")) {
    throw new DomainError("separation_of_duties", "You created or submitted this record, so another person must decide on it.", { ...ctx.refusalDetails(), code: "SEPARATION_OF_DUTIES" });
  }
  if (step) {
    if (step.permission) ctx.require(step.permission as Permission);
    const roles = rolesAllowedNow(step, args.pendingSince);
    if (roles.length > 0 && !ctx.actsAsAnyRole(roles)) {
      throw new DomainError("forbidden", `Step ${step.step} (${step.label}) must be decided by ${roles.map((r) => r.replace(/_/g, " ")).join(" or ")}.`);
    }
    if (ctx.sodBlocks(args.decision === "approved" && progress.steps.some((s) => s.approvals.some((a) => a.by === ctx.userId)), "You already approved a step of this record. A different person must decide this step.")) {
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
  if (args.decision !== "approved") return { final: false, step };
  const remaining = progress.steps.filter((s) => !s.done && !(s.step === step?.step && s.approvals.length + 1 >= s.requiredCount));
  return { final: remaining.length === 0, step };
}

/** The roles to notify for a step (the step roles, or holders of the permission when none is named). */
export function stepRoles(step: EvaluatedStep | null): string[] {
  return step?.roleCodes.length ? step.roleCodes : [];
}

/** Display names of user ids (for "approved by"). */
export async function namesOf(q: DbOrTx, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await q.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

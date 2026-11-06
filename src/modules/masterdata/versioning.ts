import "server-only";
import { type SQL, and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/db/client";
import { approvalDecisions, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { approverLabel } from "@/lib/auth/self-approval";
import { DomainError } from "@/lib/errors";
import { OWNER_ALONE_VIEWER_NOTE, ownerAloneApprover } from "@/lib/owner-alone-words";
import { HANDOFFS, type HandoffKind, evaluateApprovalRulesAudited, notifyNextActors } from "@/modules/governance";
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
  /** `ownerAlone`: the owner decided this step alone (ADR-117, no separate QA review). */
  decisions: { step: number; decision: string; decidedBy: string; decidedByName: string; decidedAt: Date; note: string | null; ownerAlone: boolean }[];
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
  const decisions = rows.map((r) => ({ step: r.d.step, decision: r.d.decision, decidedBy: r.d.decidedBy, decidedByName: r.name, decidedAt: r.d.decidedAt, note: r.d.note, ownerAlone: r.d.ownerAlone }));
  const rejected = decisions.some((d) => d.decision === "rejected");
  const approvedCount = (step: number) => decisions.filter((d) => d.decision === "approved" && d.step === step).length;
  // ADR-117: a step the owner approved alone is complete whatever its required count.
  const doneAlone = (step: number) => decisions.some((d) => d.decision === "approved" && d.step === step && d.ownerAlone);
  const nextStep = rejected ? null : (policy.find((p) => !doneAlone(p.step) && approvedCount(p.step) < (p.requiredCount ?? 1)) ?? null);
  return { policy, decisions, nextStep };
}

/**
 * ADR-088 §2: recipes, routings, work instructions and inspection plans are operational master data: a top
 * role may approve their own at a step that is not a QA step (the step's role still applies). A step naming
 * qa_qc keeps the independent second person even for a QA user who is also the owner or a site manager, so the
 * QA approval of a recipe and every inspection plan (QA-only steps) stay independent. Equipment overrides
 * keep the independent second person.
 */
const SELF_APPROVABLE: readonly ApprovalRecordType[] = ["formula_revision", "routing_revision", "work_instruction_revision", "inspection_plan"];

function selfApprovable(recordType: ApprovalRecordType, step: ApprovalStepPolicy | null) {
  return SELF_APPROVABLE.includes(recordType) && !!step && !step.roles.includes("qa_qc");
}

function sodBlocksFor(ctx: AuthContext, recordType: ApprovalRecordType, step: ApprovalStepPolicy, conflict: boolean, rule: string, siteId: string | null | undefined) {
  return selfApprovable(recordType, step) ? ctx.sodBlocksAt(conflict, rule, siteId ?? null) : ctx.sodBlocks(conflict, rule);
}

/** For screens: whether `userId` blocks the caller on a record of this type (same-person rule, ADR-088 §2). */
export function approvalSodConflict(ctx: AuthContext, recordType: ApprovalRecordType, step: ApprovalStepPolicy | null, userId: string | null | undefined, siteId: string | null | undefined) {
  return selfApprovable(recordType, step) ? ctx.sodConflictAt(userId, siteId ?? null) : ctx.sodConflict(userId);
}

/** True when the caller may decide the given step (role + permission), ignoring separation of duties. */
export function canDecideStep(ctx: AuthContext, step: ApprovalStepPolicy | null) {
  if (!step) return false;
  return ctx.can(step.permission) && (step.roles.length === 0 || ctx.hasAnyRole(step.roles));
}

/* ------------------------------------------------------------- ADR-117 owner alone */

/**
 * "Approved by" of a version: "Ana Villanueva (owner) — no separate QA review" when the approver decided a step alone
 * (ADR-117), else "<name> (own request)" for an own-request approval (ADR-091), else the name.
 */
export function revisionApproverName(name: string | null, approvedBy: string | null, requesterIds: readonly (string | null | undefined)[], state: { decisions: readonly { decision: string; ownerAlone: boolean; decidedBy: string }[] }): string | null {
  if (!name) return name;
  if (approvedBy && state.decisions.some((d) => d.decision === "approved" && d.ownerAlone && d.decidedBy === approvedBy)) return ownerAloneApprover(name);
  return approverLabel(name, approvedBy, requesterIds);
}

/** ADR-117: the owner-alone approvals of these records (for lists that show "Approved by"). */
export async function ownerAloneDecisions(q: DbOrTx, organizationId: string, recordIds: string[]) {
  if (!recordIds.length) return [];
  const rows = await q
    .select({ recordId: approvalDecisions.recordId, decidedBy: approvalDecisions.decidedBy })
    .from(approvalDecisions)
    .where(and(eq(approvalDecisions.organizationId, organizationId), inArray(approvalDecisions.recordId, recordIds), eq(approvalDecisions.ownerAlone, true), eq(approvalDecisions.decision, "approved")));
  return rows.map((r) => ({ ...r, decision: "approved", ownerAlone: true }));
}

/** The approval box words for the viewer (ADR-117), or null. */
export function ownerAloneViewerNote(d: { canDecide: boolean; ownerAlone: boolean }): string | null {
  return d.canDecide && d.ownerAlone ? OWNER_ALONE_VIEWER_NOTE : null;
}

/**
 * ADR-117 (owner decision 2026-11-07): the record types the owner may approve alone — the recipe (formula), its steps
 * (routing) and how-to sheets (work instructions). Inspection plans and equipment overrides are NOT here: QA test
 * lists and every QA decision keep the independent second person.
 */
export const OWNER_ALONE_RECORD_TYPES: readonly ApprovalRecordType[] = ["formula_revision", "routing_revision", "work_instruction_revision"];

/** The reason stored on every step the owner decides alone, and shown on the record. */
export const OWNER_ALONE_NOTE = "Owner approved alone (no separate QA review)";

/** True when the caller is the owner (organization-wide), the setting is on and the record type is a recipe part. */
export function ownerAloneApplies(ctx: AuthContext, recordType: ApprovalRecordType): boolean {
  return ctx.ownerApprovesRecipesAlone && OWNER_ALONE_RECORD_TYPES.includes(recordType);
}

/**
 * Whether the caller may decide `step` on the ordinary rules (permission, the step's roles, the same-person rules of
 * ADR-073/ADR-091). Records nothing: a screen check and the owner-alone loop's "was this step needed alone?".
 */
function ordinaryCanDecide(ctx: AuthContext, recordType: ApprovalRecordType, step: ApprovalStepPolicy, excluded: readonly (string | null | undefined)[], priorDeciders: readonly string[], siteId: string | null | undefined) {
  return canDecideStep(ctx, step) && !excluded.some((u) => approvalSodConflict(ctx, recordType, step, u, siteId)) && !priorDeciders.some((u) => approvalSodConflict(ctx, recordType, step, u, siteId));
}

/**
 * For screens (records nothing): whether the viewer may decide the open step now — on the ordinary rules, or as the
 * owner alone (ADR-117). `ownerAlone` is true when the owner's Approve would complete steps they could not decide on
 * the ordinary rules (a QA step, their own revision, a step after one they decided).
 */
export function revisionDecisionFor(
  ctx: AuthContext,
  recordType: ApprovalRecordType,
  state: ApprovalState,
  status: string,
  excluded: readonly (string | null | undefined)[],
  siteId: string | null = null,
): { canDecide: boolean; ownerAlone: boolean } {
  const step = state.nextStep;
  if (status !== "pending_approval" || !step) return { canDecide: false, ownerAlone: false };
  const prior = state.decisions.map((d) => d.decidedBy);
  const ordinary = ordinaryCanDecide(ctx, recordType, step, excluded, prior, siteId);
  if (!ownerAloneApplies(ctx, recordType)) return { canDecide: ordinary, ownerAlone: false };
  const open = openStepsFrom(state, step);
  if (!open.every((p) => ctx.can(p.permission)) || open.some((p) => state.decisions.some((d) => d.step === p.step && d.decidedBy === ctx.userId))) return { canDecide: ordinary, ownerAlone: false };
  // The owner's one Approve decides every open step: an ordinary decision only when one step is open and allowed.
  const alone = !(open.length === 1 && stepCompletesOrdinarily(ctx, recordType, state, open[0], excluded, "approved", siteId));
  return { canDecide: true, ownerAlone: alone };
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
    /** For the next approvers' message ("Recipe F-ACS-135 v3"). */
    recordNumber?: string;
    /** Rule document type when it differs from the record type (sequencing-only routing change). */
    ruleType?: ApprovalRuleType;
  },
): Promise<{ step: ApprovalStepPolicy; final: boolean; rejected: boolean; ownerAlone: boolean; steps: DecidedStep[] }> {
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
  if (ownerAloneApplies(ctx, args.recordType)) return decideAsOwnerAlone(tx, ctx, args, state, step);
  ctx.require(step.permission);
  if (step.roles.length > 0 && !ctx.actsAsAnyRole(step.roles)) {
    throw new DomainError("forbidden", `Step ${step.step} (${step.label}) must be decided by ${step.roles.map((r) => r.replace(/_/g, " ")).join(" or ")}.`);
  }
  if (sodBlocksFor(ctx, args.recordType, step, args.excludedUserIds.some((u) => u && u === ctx.userId), "You prepared or requested this record, so another person must approve it.", args.siteId)) {
    throw new DomainError("separation_of_duties", "You prepared or requested this record, so another person must approve it.", ctx.refusalDetails());
  }
  if (sodBlocksFor(ctx, args.recordType, step, state.decisions.some((d) => d.decidedBy === ctx.userId), "You already approved an earlier step. A different person must decide this step.", args.siteId)) {
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
  const final = args.decision === "approved" && step.step === lastStep && approvedHere >= (step.requiredCount ?? 1);
  // Hand-off (ADR-109): a step approved and another one open: tell its approvers (never the requester, never this approver).
  if (args.decision === "approved" && !final) await notifyRevisionApprovers(tx, ctx, args.recordType, { recordId: args.recordId, name: args.recordNumber ?? "A version", link: "/approvals", siteId: args.siteId ?? null, exclude: args.excludedUserIds, policy: state.policy });
  return { step, final, rejected: args.decision === "rejected", ownerAlone: false, steps: [{ step: step.step, label: step.label, ownerAlone: false }] };
}

export type DecidedStep = { step: number; label: string; ownerAlone: boolean };

/** Audit detail of a decision (ADR-117): the steps the owner decided alone, for the decision event's `after`. */
export function ownerAloneDetail(d: { ownerAlone: boolean; steps: DecidedStep[] }): Record<string, unknown> {
  return d.ownerAlone ? { ownerAloneSteps: d.steps.filter((x) => x.ownerAlone).map((x) => `step ${x.step}: ${x.label}`), approvalNote: OWNER_ALONE_NOTE } : {};
}

/**
 * ADR-117: the owner (organization-wide, setting `approvals.owner_approves_recipes_alone` on) decides a recipe, steps
 * or how-to sheet revision. "Approve" completes EVERY open step in one go; "Reject" decides the open step. When only
 * one step is open and the owner may decide it on the ordinary rules (their role, the ADR-091 own-request rule), it is
 * an ordinary decision; otherwise every step of the press is recorded as decided by the owner with `owner_alone = true` and the reason
 * "Owner approved alone (no separate QA review)", and noted for `audit()` (`governance.owner_alone.used`, the decision
 * event flagged `ownerAlone: true`, the transaction-local `bc.owner_alone` for the same-person trigger). The owner must
 * still hold each step's permission. Caller holds the record row lock.
 */
async function decideAsOwnerAlone(
  tx: Tx,
  ctx: AuthContext,
  args: Parameters<typeof recordApprovalDecision>[2],
  state: ApprovalState,
  first: ApprovalStepPolicy,
): Promise<{ step: ApprovalStepPolicy; final: boolean; rejected: boolean; ownerAlone: boolean; steps: DecidedStep[] }> {
  if (args.decision === "rejected" && !args.note?.trim()) throw new DomainError("validation", "Enter the reason for rejecting.");
  const open = args.decision === "approved" ? openStepsFrom(state, first) : [first];
  for (const p of open) ctx.require(p.permission);
  if (open.some((p) => state.decisions.some((d) => d.step === p.step && d.decidedBy === ctx.userId))) {
    throw new DomainError("state", "You already decided a step of this version. Another approver must add theirs.");
  }
  const note = args.note?.trim() || null;
  // One open step the owner may decide on the ordinary rules: an ordinary decision (ADR-091 own request included).
  if (open.length === 1 && stepCompletesOrdinarily(ctx, args.recordType, state, open[0], args.excludedUserIds, args.decision, args.siteId)) {
    const p = open[0];
    if (p.roles.length > 0) ctx.actsAsAnyRole(p.roles);
    sodBlocksFor(ctx, args.recordType, p, args.excludedUserIds.some((u) => u && u === ctx.userId), "You prepared or requested this record, so another person must approve it.", args.siteId);
    sodBlocksFor(ctx, args.recordType, p, state.decisions.some((d) => d.decidedBy === ctx.userId), "You already approved an earlier step. A different person must decide this step.", args.siteId);
    await tx.insert(approvalDecisions).values({ organizationId: ctx.organizationId, siteId: args.siteId ?? null, recordType: args.recordType, recordId: args.recordId, step: p.step, decision: args.decision, decidedBy: ctx.userId, note });
    const lastStep = Math.max(...state.policy.map((x) => x.step));
    return { step: p, final: args.decision === "approved" && p.step === lastStep, rejected: args.decision === "rejected", ownerAlone: false, steps: [{ step: p.step, label: p.label, ownerAlone: false }] };
  }
  // Otherwise every step of this one press is the owner's alone (no separate QA review).
  const decided: DecidedStep[] = [];
  for (const p of open) {
    ctx.noteOwnerAlone(`Step ${p.step}: ${p.label}${p.roles.includes("qa_qc") ? " (a QA step)" : ""}`);
    await tx.insert(approvalDecisions).values({
      organizationId: ctx.organizationId,
      siteId: args.siteId ?? null,
      recordType: args.recordType,
      recordId: args.recordId,
      step: p.step,
      decision: args.decision,
      decidedBy: ctx.userId,
      note: args.decision === "approved" ? (note ? `${OWNER_ALONE_NOTE} — ${note}` : OWNER_ALONE_NOTE) : `${note} (the owner decided alone)`,
      ownerAlone: true,
    });
    decided.push({ step: p.step, label: p.label, ownerAlone: true });
  }
  return { step: open[open.length - 1], final: args.decision === "approved", rejected: args.decision === "rejected", ownerAlone: true, steps: decided };
}

/** The steps still open from `first` on (a step the owner already approved alone is complete). */
function openStepsFrom(state: ApprovalState, first: ApprovalStepPolicy) {
  const doneAlone = (n: number) => state.decisions.some((d) => d.decision === "approved" && d.step === n && d.ownerAlone);
  return state.policy.filter((p) => p.step >= first.step && !doneAlone(p.step));
}

/** The owner's decision of `step` would be allowed on the ordinary rules and complete it (records nothing). */
function stepCompletesOrdinarily(ctx: AuthContext, recordType: ApprovalRecordType, state: ApprovalState, step: ApprovalStepPolicy, excluded: readonly (string | null | undefined)[], decision: "approved" | "rejected", siteId: string | null | undefined) {
  const approvedHere = state.decisions.filter((d) => d.decision === "approved" && d.step === step.step).length;
  const completes = decision === "rejected" || approvedHere + 1 >= (step.requiredCount ?? 1);
  return completes && ordinaryCanDecide(ctx, recordType, step, excluded, state.decisions.map((d) => d.decidedBy), siteId);
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

const REVISION_KIND: Partial<Record<ApprovalRecordType, HandoffKind>> = {
  formula_revision: "recipe_revision",
  routing_revision: "routing_revision",
  work_instruction_revision: "work_instruction_revision",
  inspection_plan: "inspection_plan_revision",
};

/**
 * Tells the people who decide the open approval step of a version (ADR-109, docs/NEXT_APPROVER.md): the step's
 * permission and roles, never the person who made or sent it (`exclude`) nor an earlier step's approver. A step that
 * names QA keeps the independent second person; other steps follow ADR-091. Once per step and send.
 */
export async function notifyRevisionApprovers(
  tx: DbOrTx,
  ctx: AuthContext,
  recordType: ApprovalRecordType,
  a: { recordId: string; name: string; link: string; siteId: string | null; exclude: readonly (string | null | undefined)[]; policy?: ApprovalStepPolicy[] },
): Promise<string[]> {
  const kind = REVISION_KIND[recordType];
  if (!kind) return [];
  const state = await approvalState(tx, ctx.organizationId, recordType, a.recordId, a.policy);
  const step = state.nextStep;
  if (!step) return [];
  const qa = step.roles.includes("qa_qc");
  return notifyNextActors(
    tx,
    ctx,
    { ...HANDOFFS[kind], kind, independent: qa, operational: !qa },
    { siteId: a.siteId, roleCodes: step.roles, permission: step.permission, excludeUserIds: [...a.exclude, ctx.userId], priorApproverIds: state.decisions.filter((d) => d.decision === "approved").map((d) => d.decidedBy), stepNo: step.step, stepsTotal: state.policy.length, roleStandIn: false },
    { title: `${a.name} waits for your OK${state.policy.length > 1 ? ` (step ${step.step} of ${state.policy.length})` : ""}`, body: `${ctx.displayName} asks for ${step.label}.`, link: a.link, entityType: recordType, entityId: a.recordId, dedupeKey: `handoff.${kind}:${a.recordId}:step${step.step}:${Date.now()}` },
  );
}

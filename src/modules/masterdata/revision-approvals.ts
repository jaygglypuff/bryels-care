import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { formulaRevisions, formulas, products, routingRevisions, routings, users, workInstructionRevisions, workInstructions } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { EARLIER_STEP_REASON, OWN_REQUEST_REASON, type ApprovalVerdict } from "@/modules/governance";
import type { ApprovalRecordType } from "./approval-policy";
import { policyFor } from "./routings";
import { type ApprovalState, approvalSodConflict, approvalState, canDecideStep, ownerAloneViewerNote, revisionDecisionFor } from "./versioning";

/**
 * "To approve" for recipe (formula), steps (routing) and how-to sheet (work instruction) versions (ADR-117; ADR-109 sends
 * their approvers to "To approve"). Sources: every version pending approval in the organization (organization-level
 * records, no site). Verdicts: the rules the decide services enforce (`revisionDecisionFor`: the step's permission and
 * roles, the same-person rules, and the owner's "approve alone" while `approvals.owner_approves_recipes_alone` is on).
 * Screen hints only: the decide services re-check everything.
 */
export type RevisionApprovalKind = "approval.formula_revision" | "approval.routing_revision" | "approval.work_instruction_revision";

type Pending = { id: string; recordType: ApprovalRecordType; title: string; link: string; number: string; createdBy: string | null; submittedBy: string | null; submittedAt: Date | null; createdAt: Date; changeScope?: string | null; changeSummary: string | null };

async function pending(organizationId: string, kind: RevisionApprovalKind, ids?: string[]): Promise<Pending[]> {
  if (ids && !ids.length) return [];
  if (kind === "approval.formula_revision") {
    const rows = await db
      .select({ r: formulaRevisions, f: formulas, product: products.name })
      .from(formulaRevisions)
      .innerJoin(formulas, eq(formulas.id, formulaRevisions.formulaId))
      .innerJoin(products, eq(products.id, formulas.productId))
      .where(and(eq(formulas.organizationId, organizationId), eq(formulaRevisions.status, "pending_approval"), ids ? inArray(formulaRevisions.id, ids) : undefined));
    return rows.map(({ r, f, product }) => ({ id: r.id, recordType: "formula_revision", title: `Recipe for ${product} (version ${r.revisionNo})`, link: `/masterdata/formulas/${f.id}/revisions/${r.id}`, number: `${f.code} v${r.revisionNo}`, createdBy: r.createdBy, submittedBy: r.submittedBy, submittedAt: r.submittedAt, createdAt: r.createdAt, changeSummary: r.changeSummary }));
  }
  if (kind === "approval.routing_revision") {
    const rows = await db
      .select({ r: routingRevisions, ro: routings, product: products.name })
      .from(routingRevisions)
      .innerJoin(routings, eq(routings.id, routingRevisions.routingId))
      .innerJoin(products, eq(products.id, routings.productId))
      .where(and(eq(routings.organizationId, organizationId), eq(routingRevisions.status, "pending_approval"), ids ? inArray(routingRevisions.id, ids) : undefined));
    return rows.map(({ r, ro, product }) => ({ id: r.id, recordType: "routing_revision", title: `Steps for ${product} (version ${r.revisionNo})`, link: `/masterdata/routings/${ro.id}/revisions/${r.id}`, number: `${ro.code} v${r.revisionNo}`, createdBy: r.createdBy, submittedBy: r.submittedBy, submittedAt: r.submittedAt, createdAt: r.createdAt, changeScope: r.changeScope, changeSummary: r.changeSummary }));
  }
  const rows = await db
    .select({ r: workInstructionRevisions, w: workInstructions })
    .from(workInstructionRevisions)
    .innerJoin(workInstructions, eq(workInstructions.id, workInstructionRevisions.workInstructionId))
    .where(and(eq(workInstructions.organizationId, organizationId), eq(workInstructionRevisions.status, "pending_approval"), ids ? inArray(workInstructionRevisions.id, ids) : undefined));
  return rows.map(({ r, w }) => ({ id: r.id, recordType: "work_instruction_revision", title: `How-to sheet “${w.name}” (version ${r.revisionNo})`, link: `/masterdata/work-instructions/${w.id}`, number: `${w.code} v${r.revisionNo}`, createdBy: r.createdBy, submittedBy: r.submittedBy, submittedAt: r.submittedAt, createdAt: r.createdAt, changeSummary: r.changeSummary }));
}

/** Action-centre source: versions waiting for an OK (one item per version). */
export async function revisionApprovalCandidates(organizationId: string, kind: RevisionApprovalKind) {
  return (await pending(organizationId, kind)).map((p) => ({
    kind,
    siteId: null,
    entityType: p.recordType,
    entityId: p.id,
    recordNumber: p.number,
    title: `${p.title} waits for approval`,
    detail: null,
    link: p.link,
    openedAt: p.submittedAt ?? p.createdAt,
  }));
}

async function stateOf(ctx: AuthContext, p: Pending): Promise<ApprovalState> {
  const policy = p.recordType === "routing_revision" ? await policyFor(db, ctx.organizationId, p.changeScope ?? null) : undefined;
  return approvalState(db, ctx.organizationId, p.recordType, p.id, policy);
}

/** Action-centre gate: who can decide each waiting version now (same rules as the decide services). */
export function revisionApprovalVerdicts(kind: RevisionApprovalKind) {
  return async (ctx: AuthContext, ids: string[]): Promise<Map<string, ApprovalVerdict>> => {
    const out = new Map<string, ApprovalVerdict>();
    const rows = await pending(ctx.organizationId, kind, ids);
    const names = new Map<string, string>();
    const who = [...new Set(rows.map((r) => r.submittedBy ?? r.createdBy).filter((x): x is string => !!x))];
    if (who.length) for (const u of await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, who))) names.set(u.id, u.n);
    for (const p of rows) {
      const state = await stateOf(ctx, p);
      const step = state.nextStep;
      const excluded = [p.createdBy, p.submittedBy];
      const d = revisionDecisionFor(ctx, p.recordType, state, "pending_approval", excluded);
      let blockedReason: string | null = null;
      if (!d.canDecide && step && canDecideStep(ctx, step)) {
        if (excluded.some((u) => approvalSodConflict(ctx, p.recordType, step, u, null))) blockedReason = OWN_REQUEST_REASON;
        else if (state.decisions.some((x) => approvalSodConflict(ctx, p.recordType, step, x.decidedBy, null))) blockedReason = EARLIER_STEP_REASON;
      }
      const requester = p.submittedBy ?? p.createdBy;
      out.set(p.id, {
        canDecide: d.canDecide,
        waitingForRoles: step?.roles ?? [],
        stepLabel: step?.label ?? null,
        blockedReason,
        requestedById: requester,
        requestedByName: requester ? (names.get(requester) ?? null) : null,
        title: p.title,
        why: p.changeSummary ? p.changeSummary.slice(0, 160) : null,
        // ADR-117: the owner's own words in the list ("You can approve this alone because you are the owner …").
        ...(d.ownerAlone ? { ownRequest: true, selfApprovalNote: ownerAloneViewerNote(d) } : {}),
      });
    }
    return out;
  };
}

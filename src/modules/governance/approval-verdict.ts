import type { AuthContext } from "@/lib/auth/context";
import type { Permission } from "@/lib/permissions";
import { type EvaluatedStep, rolesAllowedNow } from "./approval-rules";

/**
 * "Who can decide this now" for the "To approve" list (ADR-075, ADR-082 §4). One verdict per record
 * waiting for a decision, computed with the same rules the module's decide service enforces
 * (base permission at the record's site, the open step's permission and roles with escalation,
 * same-person rules). It is a screen hint: the decide service re-checks everything.
 */
export type ApprovalVerdict = {
  /** The signed-in user may decide the open step now. */
  canDecide: boolean;
  /** Role codes that decide the open step now (empty = any holder of the permission). */
  waitingForRoles: string[];
  /** Label of the open step ("Site manager approval"), when the record has steps. */
  stepLabel: string | null;
  /** Plain reason when the person holds the right role but a same-person rule stops them. */
  blockedReason: string | null;
  /** Who asked (submitter / claimant / requester), when the module knows it. */
  requestedById?: string | null;
  requestedByName?: string | null;
  /** Money value of the record (decimal string) and currency, when there is one. */
  amount?: string | null;
  currency?: string | null;
  /** Plain words: why this record needs approval (credit hold, over limit, discount …). */
  why?: string | null;
  /** ADR-088 §2: the user decides their own request as a top role (owner, or site manager at the site). */
  ownRequest?: boolean;
  /** Plain words for the approval box ("You can approve this yourself because you are the owner."). */
  selfApprovalNote?: string | null;
  /** Plain title replacing the generic one ("Expense claim from Tess Reyes"). */
  title?: string | null;
};

export const OWN_REQUEST_REASON = "You asked for this, so another person must decide.";
export const EARLIER_STEP_REASON = "You approved an earlier step, so another person decides this one.";

/**
 * Verdict for one record whose approval runs through `approval_rules` steps.
 * `sod = false` only for record types whose separation of duties is switched off (A-PM-14).
 * `operational = true` for the record types of ADR-088 §2: a top role at the record's site (owner, or the
 * site manager there) may decide their own request and every step (`ctx.sodConflictAt`, `ctx.hasAnyRoleAt`);
 * the verdict then says `ownRequest` so the screen can explain why. Quality types never pass it.
 */
export function stepVerdict(
  ctx: AuthContext,
  a: {
    step: EvaluatedStep | null;
    basePermission: Permission;
    siteId: string | null;
    pendingSince: Date | null;
    excludedUserIds: (string | null | undefined)[];
    priorApproverIds?: string[];
    sod?: boolean;
    /** Number of steps that apply; 0 = no rule matched, so the base permission alone decides (one approver). */
    stepsCount?: number;
    operational?: boolean;
    /** With `operational`: false keeps the step roles as configured (finance documents: "where the approval rules allow the owner"). */
    roleStandIn?: boolean;
  },
): ApprovalVerdict {
  const step: EvaluatedStep | null = a.step ?? (a.stepsCount === 0 ? { step: 1, label: "Approval", ruleIds: [], roleCodes: [], permission: null, requiredCount: 1, posterMayEqualApprover: false, escalation: null } : null);
  const waitingForRoles = step ? rolesAllowedNow(step, a.pendingSince) : [];
  const out = { waitingForRoles, stepLabel: step?.label ?? null };
  const no = (blockedReason: string | null = null): ApprovalVerdict => ({ ...out, canDecide: false, blockedReason });
  if (!step) return no();
  const conflict = (u: string | null | undefined) => (a.operational ? ctx.sodConflictAt(u, a.siteId) : ctx.sodConflict(u));
  if (a.siteId ? !ctx.canAt(a.basePermission, a.siteId) : !ctx.can(a.basePermission)) return no();
  if (step.permission && !ctx.can(step.permission as Permission)) return no();
  if (waitingForRoles.length > 0 && !(a.operational && a.roleStandIn !== false ? ctx.hasAnyRoleAt(waitingForRoles, a.siteId, a.excludedUserIds) : ctx.hasAnyRole(waitingForRoles))) return no();
  if (a.sod !== false && a.excludedUserIds.some((u) => conflict(u))) return no(OWN_REQUEST_REASON);
  if ((a.priorApproverIds ?? []).some((u) => conflict(u))) return no(EARLIER_STEP_REASON);
  const own = !!a.operational && ctx.selfApprovesAt(a.siteId) && [...a.excludedUserIds, ...(a.priorApproverIds ?? [])].some((u) => !!u && u === ctx.userId);
  return { ...out, canDecide: true, blockedReason: null, ...(own ? { ownRequest: true, selfApprovalNote: selfApprovalNote(ctx) } : {}) };
}

/** Plain words for the approval box when a top role decides their own request (ADR-088 §2). */
export function selfApprovalNote(ctx: AuthContext): string {
  return ctx.roleCodes.includes("owner_director")
    ? "You can approve this yourself because you are the owner."
    : "You can approve this yourself because you are the site manager.";
}

import "server-only";
import { and, eq, or } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { rolePermissions, roles, userSiteAssignments, users } from "@/db/schema";
import { activeAssignment } from "@/lib/auth/assignments";
import type { AuthContext } from "@/lib/auth/context";
import { type NextActors, type NextPerson, personRole, roleCodesWords } from "@/lib/next-actors-words";
import type { Permission } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
import { notifyUsers } from "@/modules/platform/notifications";
import { rolesAllowedNow, type EvaluatedStep } from "./approval-rules";
import { selfApprovalNote } from "./approval-verdict";

/**
 * Who does the next step of a hand-off (owner request 2026-11-01: "Every approval must indicate who approves next";
 * docs/NEXT_APPROVER.md). One rule per hand-off kind: the permission the deciding service checks, the words, where the
 * next person finds it, and which same-person rule applies:
 *
 * - `independent` (GMP floor checks and QA decisions, ADR-080 §8 / ADR-091 "unchanged"): the people in
 *   `excludeUserIds` (the weigher, the person who did the step, the requester) are never listed, owner included.
 * - `operational` (ADR-091): an excluded person is listed only when they hold a top role at the record's site (owner
 *   organization-wide, or site manager there) and `approvals.top_roles_self_approve` is on — they may approve their
 *   own record. The viewer then reads "You can approve this yourself because you are the owner."
 *
 * Who is a candidate: active people of the organization with a current role assignment at the record's site (or
 * organization-wide; a record without a site accepts any assignment) whose role holds the permission, filtered to
 * the open step's roles when the record has approval steps. It is a screen hint and the notification list; the
 * deciding service re-checks everything.
 */

export type HandoffRule = {
  permission: Permission;
  does: string;
  doBase: string;
  where: string;
  /** Words when nobody holds the role and the step names no roles. */
  fallback: string;
  independent?: boolean;
  operational?: boolean;
  /** Roles listed first (people at the floor before the owner). */
  prefer?: string[];
};

const FLOOR = ["production_operator", "site_manager", "production_planner", "qa_qc", "owner_director"];
const OFFICE = ["site_manager", "owner_director"];
const TO_APPROVE = "in To approve";

export const HANDOFFS = {
  weighing_check: { permission: "production.dispense_record.approve", does: "checks this weighing", doBase: "check this weighing", where: "on their Home", fallback: "an operator or the site manager", independent: true, prefer: FLOOR },
  step_check: { permission: "production.process_step_record.approve", does: "checks this step", doBase: "check this step", where: "on their Home", fallback: "an operator or the site manager", independent: true, prefer: FLOOR },
  start_check: { permission: "production.line_clearance.approve", does: "checks the start check", doBase: "check the start check", where: "on their Home", fallback: "an operator or the site manager", independent: true, prefer: FLOOR },
  out_of_range_weighing: { permission: "production.over_tolerance_dispense.approve", does: "approves the weight outside the range", doBase: "approve the weight outside the range", where: "on this tablet (they pick their name)", fallback: "QA", independent: true, prefer: ["qa_qc", "site_manager", "owner_director"] },
  material_substitution: { permission: "production.material_substitution.approve", does: "decides on the other material", doBase: "decide on the other material", where: TO_APPROVE, fallback: "QA", independent: true, prefer: ["qa_qc"] },
  production_order: { permission: "production.work_order.approve", does: "approves this production order", doBase: "approve this production order", where: TO_APPROVE, fallback: "the site manager", operational: true, prefer: OFFICE },
  batch_qa: { permission: "quality.disposition.approve", does: "decides if the batch may be sold", doBase: "decide if the batch may be sold", where: "on Check quality", fallback: "QA", independent: true, prefer: ["qa_qc"] },
  lot_qa: { permission: "quality.disposition.approve", does: "decides if the lot may be used", doBase: "decide if the lot may be used", where: "on Check quality", fallback: "QA", independent: true, prefer: ["qa_qc"] },
  qa_result_correction: { permission: "quality.disposition.approve", does: "approves the corrected result", doBase: "approve the corrected result", where: "on Check quality", fallback: "another QA person", independent: true, prefer: ["qa_qc"] },
  stock_adjustment: { permission: "inventory.adjustment.approve", does: "approves this stock correction", doBase: "approve this stock correction", where: TO_APPROVE, fallback: "the site manager", operational: true, prefer: OFFICE },
  count_variance: { permission: "inventory.stock_count.approve", does: "approves the count differences", doBase: "approve the count differences", where: TO_APPROVE, fallback: "the site manager", operational: true, prefer: OFFICE },
  purchase_request: { permission: "procurement.purchase_request.approve", does: "approves it", doBase: "approve it", where: TO_APPROVE, fallback: "the site manager", operational: true, prefer: OFFICE },
  purchase_order: { permission: "procurement.purchase_order.approve", does: "approves it", doBase: "approve it", where: TO_APPROVE, fallback: "the site manager", operational: true, prefer: OFFICE },
  purchase_order_send: { permission: "procurement.purchase_order.post", does: "sends it to the supplier", doBase: "send it to the supplier", where: "on this order", fallback: "purchasing", prefer: ["procurement"] },
  supplier_return: { permission: "procurement.supplier_return.approve", does: "approves it", doBase: "approve it", where: TO_APPROVE, fallback: "the site manager", operational: true, prefer: OFFICE },
  quotation: { permission: "sales.quote.approve", does: "approves the price offer", doBase: "approve the price offer", where: TO_APPROVE, fallback: "the site manager", operational: true, prefer: OFFICE },
  sales_order: { permission: "sales.sales_order.approve", does: "approves the order", doBase: "approve the order", where: TO_APPROVE, fallback: "the site manager", operational: true, prefer: OFFICE },
  price_list: { permission: "sales.price_list.approve", does: "approves the price list", doBase: "approve the price list", where: TO_APPROVE, fallback: "the owner", operational: true, prefer: ["owner_director"] },
  customer_requirement: { permission: "masterdata.customer_requirement.approve", does: "approves the customer requirement", doBase: "approve the customer requirement", where: TO_APPROVE, fallback: "the owner", operational: true, prefer: ["owner_director"] },
  expense_claim: { permission: "finance.expense_claim.approve", does: "approves the claim", doBase: "approve the claim", where: TO_APPROVE, fallback: "the site manager", operational: true, prefer: OFFICE },
  invoice: { permission: "finance.invoice.approve", does: "approves the invoice", doBase: "approve the invoice", where: TO_APPROVE, fallback: "finance", operational: true, prefer: ["finance", "owner_director"] },
  supplier_bill: { permission: "finance.supplier_bill.approve", does: "approves the bill", doBase: "approve the bill", where: TO_APPROVE, fallback: "finance", operational: true, prefer: ["finance", "owner_director"] },
  payment: { permission: "finance.payment_record.approve", does: "approves the payment", doBase: "approve the payment", where: TO_APPROVE, fallback: "finance", operational: true, prefer: ["finance", "owner_director"] },
  credit_note: { permission: "finance.credit_note.approve", does: "approves the credit", doBase: "approve the credit", where: TO_APPROVE, fallback: "finance", operational: true, prefer: ["finance", "owner_director"] },
  recipe_revision: { permission: "masterdata.formula.approve", does: "approves the recipe", doBase: "approve the recipe", where: TO_APPROVE, fallback: "QA, then the manager", operational: true, prefer: ["qa_qc", "site_manager", "owner_director"] },
  routing_revision: { permission: "masterdata.routing.approve", does: "approves the steps", doBase: "approve the steps", where: TO_APPROVE, fallback: "QA, then the manager", operational: true, prefer: ["qa_qc", "site_manager", "owner_director"] },
  work_instruction_revision: { permission: "masterdata.work_instruction.approve", does: "approves the how-to sheet", doBase: "approve the how-to sheet", where: TO_APPROVE, fallback: "QA, then the manager", operational: true, prefer: ["qa_qc", "site_manager", "owner_director"] },
  inspection_plan_revision: { permission: "quality.inspection_plan.approve", does: "approves the check plan", doBase: "approve the check plan", where: TO_APPROVE, fallback: "QA", independent: true, prefer: ["qa_qc"] },
  setting_change: { permission: "platform.settings.approve", does: "approves the setting change", doBase: "approve the setting change", where: TO_APPROVE, fallback: "the owner", prefer: ["owner_director"] },
  pack_check: { permission: "inventory.pack.approve", does: "checks the box", doBase: "check the box", where: "on Packing", fallback: "the warehouse", independent: true, prefer: ["warehouse_operator", "site_manager"] },
} satisfies Record<string, HandoffRule>;

export type HandoffKind = keyof typeof HANDOFFS;

export type NextRecord = {
  /** The record's site (null: organization-level record such as a price list or a recipe). */
  siteId: string | null;
  /** People the same-person rule keeps out (weigher, step doer, creator, submitter, claimant). */
  excludeUserIds?: readonly (string | null | undefined)[];
  /** People who approved an earlier step (one person approves at most one step). */
  priorApproverIds?: readonly (string | null | undefined)[];
  /** Roles of the open approval step (empty: anyone holding the permission). */
  roleCodes?: readonly string[];
  stepNo?: number | null;
  stepsTotal?: number | null;
  /** A step that names its own permission (approval rules). */
  permission?: Permission | null;
};

type Candidate = { userId: string; name: string; roles: Map<string, string>; granting: Set<string>; ownerOrgWide: boolean; manager: boolean };

async function candidates(q: DbOrTx, organizationId: string, permission: string, siteId: string | null): Promise<Candidate[]> {
  const holderRoles = await q
    .select({ id: roles.id })
    .from(rolePermissions)
    .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
    .where(and(eq(rolePermissions.permissionCode, permission), eq(roles.organizationId, organizationId), eq(roles.status, "active")));
  if (!holderRoles.length) return [];
  const holderIds = new Set(holderRoles.map((r) => r.id));
  const rows = await q
    .select({ userId: users.id, name: users.displayName, roleId: roles.id, code: roles.code, roleName: roles.name, orgWide: userSiteAssignments.isOrganizationWide, siteId: userSiteAssignments.siteId })
    .from(userSiteAssignments)
    .innerJoin(roles, eq(roles.id, userSiteAssignments.roleId))
    .innerJoin(users, eq(users.id, userSiteAssignments.userId))
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
        eq(roles.status, "active"),
        activeAssignment(),
        siteId ? or(eq(userSiteAssignments.isOrganizationWide, true), eq(userSiteAssignments.siteId, siteId)) : undefined,
      ),
    );
  const out = new Map<string, Candidate>();
  for (const r of rows) {
    const c = out.get(r.userId) ?? { userId: r.userId, name: r.name, roles: new Map(), granting: new Set(), ownerOrgWide: false, manager: false };
    c.roles.set(r.code, r.roleName);
    if (holderIds.has(r.roleId)) c.granting.add(r.code);
    if (r.code === "owner_director" && r.orgWide) c.ownerOrgWide = true;
    if (r.code === "site_manager" && (r.orgWide || (siteId && r.siteId === siteId))) c.manager = true;
    out.set(r.userId, c);
  }
  return [...out.values()].filter((c) => c.granting.size > 0);
}

/**
 * The people who can do the next step of `kind` on `record`, the viewer's own position, and the words
 * (see `nextActorsSentence` in src/lib/next-actors-words.ts). Never throws for a missing record: an empty list
 * reads "Nobody can do it yet".
 */
export async function nextActors(ctx: AuthContext, kind: HandoffKind, record: NextRecord, q: DbOrTx = db): Promise<NextActors> {
  const rule: HandoffRule = HANDOFFS[kind];
  const permission = record.permission ?? rule.permission;
  const siteId = record.siteId;
  const excluded = (record.excludeUserIds ?? []).filter((u): u is string => !!u);
  const prior = (record.priorApproverIds ?? []).filter((u): u is string => !!u);
  const stepRoles = [...(record.roleCodes ?? [])];
  const selfApproveOn = !!rule.operational && !!(await getSetting(q, ctx.organizationId, "approvals.top_roles_self_approve"));
  const rank = (code: string) => {
    const i = (rule.prefer ?? []).indexOf(code);
    return i < 0 ? 50 : i;
  };

  const people: (NextPerson & { rank: number })[] = [];
  for (const c of await candidates(q, ctx.organizationId, permission, siteId)) {
    if (c.userId === ctx.userId) continue;
    const matching = stepRoles.length ? [...c.roles.keys()].filter((r) => stepRoles.includes(r)) : [...c.granting];
    if (!matching.length) continue;
    const sameperson = excluded.includes(c.userId) || prior.includes(c.userId);
    if (sameperson && !(selfApproveOn && !rule.independent && (c.ownerOrgWide || c.manager))) continue;
    const best = matching.sort((a, z) => rank(a) - rank(z))[0];
    people.push({ userId: c.userId, name: c.name, role: personRole(best, c.roles.get(best)), rank: rank(best) });
  }
  people.sort((a, z) => a.rank - z.rank || a.name.localeCompare(z.name));

  // The viewer, with the same checks the "To approve" verdicts use (approval-verdict.ts).
  const permOk = siteId ? ctx.canAt(permission, siteId) : ctx.can(permission);
  const rolesOk = !stepRoles.length || (rule.operational ? ctx.hasAnyRoleAt(stepRoles, siteId, excluded) : ctx.hasAnyRole(stepRoles));
  const mine = excluded.includes(ctx.userId) || prior.includes(ctx.userId);
  const topSelf = !!rule.operational && !rule.independent && ctx.selfApprovesAt(siteId);
  const can = permOk && rolesOk && (!mine || topSelf);
  const selfApproval = can && mine && topSelf;

  return {
    kind,
    does: rule.does,
    doBase: rule.doBase,
    where: rule.where,
    people: people.map(({ rank: _r, ...p }) => p),
    roleWords: roleCodesWords(stepRoles, rule.fallback),
    viewer: { can, selfApproval, note: selfApproval ? selfApprovalNote(ctx) : null },
    stepNo: record.stepNo ?? null,
    stepsTotal: record.stepsTotal ?? null,
  };
}

/**
 * For records whose approval runs through `approval_rules` steps (purchasing, stock, sales, finance, master data):
 * the open step's roles now (escalation included), its position and the earlier approvers.
 */
export function approvalStepRecord(
  base: { siteId: string | null; excludeUserIds?: readonly (string | null | undefined)[] },
  progress: { steps: { step: number; approvals?: { by: string }[] }[]; next: EvaluatedStep | null },
  pendingSince: Date | null,
): NextRecord {
  const next = progress.next;
  return {
    ...base,
    roleCodes: next ? rolesAllowedNow(next, pendingSince) : [],
    priorApproverIds: progress.steps.flatMap((s) => (s.approvals ?? []).map((a) => a.by)),
    stepNo: next?.step ?? null,
    stepsTotal: progress.steps.length,
    permission: (next?.permission as Permission | null) ?? null,
  };
}

/**
 * Tells the next people (in-app message with a link to the exact screen). Once per person and `dedupeKey`; the actor
 * is never told about their own hand-off. Runs inside the caller's transaction: no message for a change that rolled back.
 * Returns the people who got a new message.
 */
export async function notifyNextActors(
  q: DbOrTx,
  ctx: AuthContext,
  kind: HandoffKind,
  record: NextRecord,
  n: { title: string; body: string; link: string; entityType: string; entityId: string; dedupeKey: string; severity?: "info" | "warning" },
): Promise<string[]> {
  const next = await nextActors(ctx, kind, record, q);
  const to = next.people.map((p) => p.userId);
  if (!to.length) return [];
  return notifyUsers(q, to, { organizationId: ctx.organizationId, siteId: record.siteId, kind: `handoff.${kind}`, severity: n.severity ?? "info", title: n.title, body: n.body, entityType: n.entityType, entityId: n.entityId, link: n.link, dedupeKey: n.dedupeKey });
}

/** Ids of the people `nextActors` lists (tests and callers that only need the ids). */
export async function nextActorIds(ctx: AuthContext, kind: HandoffKind, record: NextRecord, q: DbOrTx = db): Promise<string[]> {
  return (await nextActors(ctx, kind, record, q)).people.map((p) => p.userId);
}

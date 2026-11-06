import "server-only";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { auditEvents } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";

const NOT_A_DECISION = new Set<string>(["platform.approval_rule.evaluated", "identity.authorization.denied"]);

/**
 * Writes an append-only audit event in the caller's transaction. action = module.entity.event.
 * People are recorded in actor_id. Background jobs are recorded as actor_label `system:<code>`
 * with on_behalf_of = the triggering user (architecture §8 rule 4), so a job's work is never
 * mistaken for something the person did by hand.
 */
export async function audit(
  tx: DbOrTx,
  ctx: AuthContext,
  e: {
    action: `${string}.${string}.${string}`;
    entityType: string;
    entityId?: string | null;
    entityNumber?: string | null;
    siteId?: string | null;
    reason?: string | null;
    before?: unknown;
    after?: unknown;
    correlationId?: string | null;
  },
) {
  const actor = ctx.actor;
  // ADR-088 §2: a top role approving their own operational record. The event it enabled carries `ownRequest: true`.
  // Bookkeeping events written before the decision (rule evaluation, refusals) leave the flag for the decision itself.
  const selfApprovals = NOT_A_DECISION.has(e.action) ? [] : ctx.takeSelfApprovals();
  // ADR-117: the owner decided recipe/steps/how-to approval steps alone (no separate QA review). Flagged `ownerAlone: true`.
  const ownerAlone = NOT_A_DECISION.has(e.action) ? [] : ctx.takeOwnerAlone();
  const asObject = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as object) : v === undefined || v === null ? {} : { value: v });
  const after =
    selfApprovals.length || ownerAlone.length
      ? { ...asObject(e.after), ...(selfApprovals.length ? { ownRequest: true } : {}), ...(ownerAlone.length ? { ownerAlone: true } : {}) }
      : e.after;
  const [row] = await tx.insert(auditEvents).values({
    organizationId: ctx.organizationId,
    siteId: "siteId" in e ? (e.siteId ?? null) : ctx.currentSiteId,
    actorId: actor.kind === "user" ? ctx.userId : null,
    actorLabel: ctx.actorLabel,
    onBehalfOf: actor.kind === "system" ? actor.onBehalfOf : null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    entityNumber: e.entityNumber ?? null,
    reason: e.reason ?? null,
    before: (e.before as object) ?? null,
    after: (after as object) ?? null,
    correlationId: e.correlationId ?? ctx.correlationId,
  }).returning({ id: auditEvents.id });
  if (selfApprovals.length) {
    // Lets the deferred same-person triggers accept this transaction's rows, on the operational tables only
    // (src/db/sql/adr088.sql); quality release tables never read this flag.
    await tx.execute(sql`select set_config('bc.self_approval', 'on', true)`);
    await tx.insert(auditEvents).values({
      organizationId: ctx.organizationId,
      siteId: "siteId" in e ? (e.siteId ?? null) : ctx.currentSiteId,
      actorId: ctx.userId,
      action: "governance.self_approval.used",
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      entityNumber: e.entityNumber ?? null,
      reason: "Own request approved by a top role (setting approvals.top_roles_self_approve)",
      after: { forAction: e.action, rules: selfApprovals, roles: ctx.roleCodes.filter((r) => r === "owner_director" || r === "site_manager") },
      correlationId: e.correlationId ?? ctx.correlationId,
    });
  }
  if (ownerAlone.length) {
    // Lets the deferred same-person triggers accept the owner as approver of their own recipe, steps or how-to sheet
    // revision (src/db/sql/adr117.sql: those three tables only; inspection plans and QA tables never read this flag).
    await tx.execute(sql`select set_config('bc.owner_alone', 'on', true)`);
    await tx.insert(auditEvents).values({
      organizationId: ctx.organizationId,
      siteId: "siteId" in e ? (e.siteId ?? null) : ctx.currentSiteId,
      actorId: ctx.userId,
      action: "governance.owner_alone.used",
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      entityNumber: e.entityNumber ?? null,
      reason: "Owner approved alone (no separate QA review) — setting approvals.owner_approves_recipes_alone",
      after: { forAction: e.action, steps: ownerAlone, gmpRisk: "No separate QA review (A-OWNER-ALONE-01)" },
      correlationId: e.correlationId ?? ctx.correlationId,
    });
  }
  // ADR-073: what the owner override let through in this operation is recorded next to the event it enabled.
  const overrides = ctx.takeOwnerOverrides();
  if (overrides.length) {
    // Lets the deferred same-person triggers (src/db/sql/adr073.sql) accept this transaction's rows.
    await tx.execute(sql`select set_config('bc.owner_override', 'on', true)`);
    await tx.insert(auditEvents).values({
      organizationId: ctx.organizationId,
      siteId: "siteId" in e ? (e.siteId ?? null) : ctx.currentSiteId,
      actorId: ctx.userId,
      action: "governance.owner_override.used",
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      entityNumber: e.entityNumber ?? null,
      reason: "Owner override (setting governance.owner_override)",
      after: { forAction: e.action, overridden: overrides },
      correlationId: e.correlationId ?? ctx.correlationId,
    });
  }
  // The id lets a caller cite the event (e.g. the cutover record cites the read-only toggle, runbook §17a.2).
  return row?.id ?? null;
}

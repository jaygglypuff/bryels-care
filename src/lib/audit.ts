import "server-only";
import type { DbOrTx } from "@/db/client";
import { auditEvents } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";

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
    after: (e.after as object) ?? null,
    correlationId: e.correlationId ?? ctx.correlationId,
  }).returning({ id: auditEvents.id });
  // The id lets a caller cite the event (e.g. the cutover record cites the read-only toggle, runbook §17a.2).
  return row?.id ?? null;
}

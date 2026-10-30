import "server-only";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { type ActionItemView, listActionItems } from "./items";

/**
 * "To approve" (ADR-075, owner request "there is no dedicated area to check needed approvals"):
 * everything waiting for a decision the signed-in user may take, across modules. It reads the
 * action centre's approval items (the same detectors, permission at the item's site; the owner
 * override of ADR-073 gives the owner every permission, so the owner sees everything) and adds who
 * asked and when, from the record's audit trail.
 */
export type ApprovalRow = ActionItemView & {
  requestedBy: { id: string | null; name: string | null; at: Date | null };
  /** The signed-in user asked for this: someone else decides (unless the owner override is on). */
  ownRequest: boolean;
};

/** Audit actions that mean "asked for a decision", most specific first. */
const ASK = ["submitted", "requested", "sent_for_approval", "release_requested", "reopen_requested"];

export async function listMyApprovals(ctx: AuthContext): Promise<ApprovalRow[]> {
  const items = await listActionItems(ctx, { tab: "approvals", includeAcknowledged: true });
  if (!items.length) return [];
  const ids = [...new Set(items.map((i) => i.entityId))];
  const evs = await db
    .select({ entityId: auditEvents.entityId, action: auditEvents.action, actorId: auditEvents.actorId, name: users.displayName, at: auditEvents.occurredAt })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(
      and(
        eq(auditEvents.organizationId, ctx.organizationId),
        inArray(auditEvents.entityId, ids),
        or(...ASK.map((a) => sql`${auditEvents.action} like ${"%." + a}`), sql`${auditEvents.action} like '%.created'`, sql`${auditEvents.action} like '%.drafted'`),
      ),
    )
    .orderBy(desc(auditEvents.occurredAt))
    .limit(5000);
  const byEntity = new Map<string, (typeof evs)[number]>();
  for (const e of evs) {
    if (!e.entityId) continue;
    const cur = byEntity.get(e.entityId);
    const asks = ASK.some((a) => e.action.endsWith("." + a));
    // Newest "asked" event wins; a "created" event only when nothing asked yet.
    if (!cur || (asks && !ASK.some((a) => cur.action.endsWith("." + a)))) byEntity.set(e.entityId, e);
  }
  return items
    .map((i) => {
      const e = byEntity.get(i.entityId);
      const requestedBy = { id: e?.actorId ?? null, name: e?.name ?? null, at: e?.at ?? i.openedAt };
      return { ...i, requestedBy, ownRequest: !!requestedBy.id && requestedBy.id === ctx.userId };
    })
    .sort((a, b) => Number(!!a.acknowledgedAt) - Number(!!b.acknowledgedAt) || a.openedAt.getTime() - b.openedAt.getTime());
}

/** Badge count for the "To approve" entry: open approval items the user may decide (not acknowledged). */
export async function myApprovalCount(ctx: AuthContext): Promise<number> {
  const items = await listActionItems(ctx, { tab: "approvals" });
  return items.length;
}

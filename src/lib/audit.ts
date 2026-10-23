import "server-only";
import type { DbOrTx } from "@/db/client";
import { auditEvents } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";

/** Writes an append-only audit event in the caller's transaction. action = module.entity.event */
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
  },
) {
  await tx.insert(auditEvents).values({
    organizationId: ctx.organizationId,
    siteId: e.siteId ?? ctx.currentSiteId,
    actorId: ctx.userId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    entityNumber: e.entityNumber ?? null,
    reason: e.reason ?? null,
    before: (e.before as object) ?? null,
    after: (e.after as object) ?? null,
  });
}

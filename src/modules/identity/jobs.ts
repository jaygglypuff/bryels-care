import { and, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { userSiteAssignments, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { defineJob } from "@/modules/platform/job-definition";
import { purgeSessions } from "./sessions";

/**
 * `identity.session_purge` (docs/architecture.md §8): daily. Deletes sessions 30 days (setting
 * `session.purge_after_days`, A-SEC-11) after expiry or revocation, and closes assignments whose
 * valid_to has passed (revoked_at set, `identity.site_assignment.revoked` by the system actor) so
 * "who holds role X" lookups and the live unique index see only current rows.
 */
export async function closeExpiredAssignments(ctx: AuthContext, now: Date = new Date()): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(userSiteAssignments)
      .set({ revokedAt: now, revokedReason: "validity ended" })
      .where(
        and(
          isNull(userSiteAssignments.revokedAt),
          isNotNull(userSiteAssignments.validTo),
          lte(userSiteAssignments.validTo, now),
          sql`${userSiteAssignments.userId} in (select ${users.id} from ${users} where ${users.organizationId} = ${ctx.organizationId})`,
        ),
      )
      .returning();
    for (const a of rows) {
      await audit(tx, ctx, { action: "identity.site_assignment.revoked", entityType: "user_site_assignments", entityId: a.id, siteId: a.siteId, reason: "validity ended", after: { validTo: a.validTo } });
    }
    return rows.length;
  });
}

export const identitySessionPurgeJob = defineJob<{ asOf: string }>({
  code: "identity.session_purge",
  title: "Purge old sessions and close ended assignments",
  description: "Deletes sessions 30 days after expiry or revocation and closes role assignments whose end date has passed (audited).",
  payload: z.object({ asOf: z.iso.datetime() }).strict(),
  keyTuple: (p) => [new Date(p.asOf).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })],
  systemPermissions: ["identity.session.void"],
  schedule: { cron: "30 2 * * *", tz: "Asia/Manila", payload: (now) => ({ asOf: now.toISOString() }) },
  run: async (run) => {
    const purged = await purgeSessions(run.ctx.organizationId, run.asOf);
    const closed = await closeExpiredAssignments(run.ctx, run.asOf);
    return { purgedSessions: purged, closedAssignments: closed };
  },
});

import "server-only";
import { and, desc, eq, ilike, inArray, isNull, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditEvents, userSiteAssignments, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";

/**
 * Read-only audit log (append-only audit_events). Scope: events of the caller's allowed sites;
 * organization-level events (site_id null, e.g. sign-ins, account unlocks) only for organization-wide users.
 * Keyset pagination on (occurred_at, id) descending; the cursor carries the exact database timestamp text so
 * microsecond precision is not lost.
 */

export const AUDIT_PAGE_SIZE = 100;

const FilterSchema = z.object({
  module: z
    .string()
    .regex(/^[a-z_]+$/)
    .optional(),
  q: z.string().trim().max(80).optional(),
  before: z.string().max(200).optional(),
});
export type AuditFilter = z.input<typeof FilterSchema>;

export type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityNumber: string | null;
  siteId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  /** `system:<job code>` when a background job acted (on behalf of the user in onBehalfOf). */
  actorLabel: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  occurredAt: Date;
};

export function encodeCursor(occurredAtText: string, id: string): string {
  return Buffer.from(`${occurredAtText}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(c: string): { ts: string; id: string } {
  const raw = Buffer.from(c, "base64url").toString("utf8");
  const [ts, id] = raw.split("|");
  const ok = z.object({ ts: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/), id: z.uuid() }).safeParse({ ts, id });
  if (!ok.success) throw new DomainError("validation", "The page link is invalid. Start again from the newest events.");
  return ok.data;
}

async function scopeFilter(ctx: AuthContext) {
  const [orgWide] = await db
    .select({ id: userSiteAssignments.id })
    .from(userSiteAssignments)
    .where(and(eq(userSiteAssignments.userId, ctx.userId), eq(userSiteAssignments.isOrganizationWide, true)))
    .limit(1);
  const sitePart = inArray(auditEvents.siteId, ctx.allowedSiteIds);
  return { orgWide: !!orgWide, where: and(eq(auditEvents.organizationId, ctx.organizationId), orgWide ? or(sitePart, isNull(auditEvents.siteId)) : sitePart) };
}

export async function listAuditEvents(
  ctx: AuthContext,
  filter: AuditFilter,
): Promise<{ rows: AuditRow[]; nextCursor: string | null; orgWide: boolean }> {
  ctx.require("platform.audit.view");
  const f = FilterSchema.parse(filter);
  const scope = await scopeFilter(ctx);
  const conds = [scope.where];
  if (f.module) conds.push(like(auditEvents.action, `${f.module}.%`));
  if (f.q) conds.push(ilike(auditEvents.entityNumber, `%${f.q.replace(/[\\%_]/g, (m) => "\\" + m)}%`));
  if (f.before) {
    const c = decodeCursor(f.before);
    conds.push(sql`(${auditEvents.occurredAt}, ${auditEvents.id}) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
  }
  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      entityNumber: auditEvents.entityNumber,
      siteId: auditEvents.siteId,
      actorName: users.displayName,
      actorEmail: users.email,
      actorLabel: auditEvents.actorLabel,
      reason: auditEvents.reason,
      before: auditEvents.before,
      after: auditEvents.after,
      occurredAt: auditEvents.occurredAt,
      occurredAtText: sql<string>`${auditEvents.occurredAt}::text`,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(and(...conds))
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(AUDIT_PAGE_SIZE + 1);
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor = rows.length > AUDIT_PAGE_SIZE && last ? encodeCursor(last.occurredAtText, last.id) : null;
  return { rows: page.map(({ occurredAtText: _t, ...r }) => r), nextCursor, orgWide: scope.orgWide };
}

/** Module prefixes present in the caller's scope, for the filter control. */
export async function listAuditModules(ctx: AuthContext): Promise<string[]> {
  ctx.require("platform.audit.view");
  const scope = await scopeFilter(ctx);
  const mod = sql<string>`split_part(${auditEvents.action}, '.', 1)`;
  const rows = await db.selectDistinct({ module: mod }).from(auditEvents).where(scope.where).orderBy(mod);
  return rows.map((r) => r.module);
}

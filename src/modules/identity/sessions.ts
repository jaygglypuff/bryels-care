import "server-only";
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { requireReason } from "./policy";
import { visibleUserIds } from "./users";

/**
 * Session listing and revocation (US-1-12, docs/security.md §3.5). Own sessions need no permission;
 * other people's need identity.session.view / identity.session.void within the caller's user scope.
 * Revocation is an update (revoked_at/by/reason) and takes effect on the device's next request.
 */
export type SessionView = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  deviceLabel: string | null;
  deviceClass: string;
  ip: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date | null;
  expiresAt: Date;
  privileged: boolean;
  mfaVerified: boolean;
  current: boolean;
};

const liveSession = (now: Date) =>
  and(isNull(sessions.revokedAt), gt(sessions.expiresAt, now), eq(sessions.stage, "active"), or(isNull(sessions.idleExpiresAt), gt(sessions.idleExpiresAt, now)));

async function listWhere(ctx: AuthContext, where: ReturnType<typeof and>, limit = 200): Promise<SessionView[]> {
  const rows = await db
    .select({ s: sessions, name: users.displayName, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(users.organizationId, ctx.organizationId), where))
    .orderBy(desc(sessions.lastSeenAt))
    .limit(limit);
  return rows.map(({ s, name, email }) => ({
    id: s.id,
    userId: s.userId,
    userName: name,
    userEmail: email,
    deviceLabel: s.deviceLabel,
    deviceClass: s.deviceClass,
    ip: s.ip,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    idleExpiresAt: s.idleExpiresAt,
    expiresAt: s.expiresAt,
    privileged: s.privileged,
    mfaVerified: !!s.mfaVerifiedAt,
    current: s.id === ctx.sessionId,
  }));
}

export async function listMySessions(ctx: AuthContext, now: Date = new Date()): Promise<SessionView[]> {
  return listWhere(ctx, and(eq(sessions.userId, ctx.userId), liveSession(now)));
}

/** Live sessions the caller may see: every user for organization-wide viewers, else users of their sites. */
export async function listActiveSessions(ctx: AuthContext, filter: { userId?: string } = {}, now: Date = new Date()): Promise<SessionView[]> {
  ctx.require("identity.session.view");
  const visible = await visibleUserIds(ctx);
  if (filter.userId && visible !== null && !visible.includes(filter.userId)) throw new DomainError("not_found", "User not found in your sites.");
  const conds = [liveSession(now)];
  if (filter.userId) conds.push(eq(sessions.userId, filter.userId));
  else if (visible !== null) conds.push(inArray(sessions.userId, visible.length ? visible : ["00000000-0000-0000-0000-000000000000"]));
  return listWhere(ctx, and(...conds));
}


/** Revokes one session: own sessions freely, other people's with identity.session.void. */
export async function revokeSession(ctx: AuthContext, sessionId: string, reason: string | null, now: Date = new Date()): Promise<void> {
  z.uuid().parse(sessionId);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ s: sessions, email: users.email, orgId: users.organizationId })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, sessionId))
      .for("update", { of: sessions })
      .limit(1);
    if (!row || row.orgId !== ctx.organizationId) throw new DomainError("not_found", "Session not found.");
    const own = row.s.userId === ctx.userId;
    let why = reason?.trim() || "signed out from the session list";
    if (!own) {
      ctx.require("identity.session.void");
      why = requireReason(reason);
      const visible = await visibleUserIds(ctx);
      if (visible !== null && !visible.includes(row.s.userId)) throw new DomainError("not_found", "Session not found.");
    }
    if (row.s.revokedAt) return;
    await tx.update(sessions).set({ revokedAt: now, revokedBy: ctx.userId, revokedReason: why.slice(0, 300) }).where(eq(sessions.id, sessionId));
    await audit(tx, ctx, { action: "identity.session.revoked", entityType: "session", entityId: sessionId, entityNumber: row.email, siteId: null, reason: why, after: { own } });
  });
}

/**
 * Daily job body (identity.session_purge, A-SEC-11): deletes sessions N days after expiry or revocation.
 * Audit rows keep the session id in their payloads for correlation.
 */
export async function purgeSessions(organizationId: string, now: Date = new Date()): Promise<number> {
  const days = await getSetting(db, organizationId, "session.purge_after_days");
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const rows = await db
    .delete(sessions)
    .where(
      and(
        sql`${sessions.userId} in (select id from users where organization_id = ${organizationId})`,
        or(lt(sessions.expiresAt, cutoff), lt(sessions.revokedAt, cutoff), lt(sessions.idleExpiresAt, cutoff)),
      ),
    )
    .returning({ id: sessions.id });
  return rows.length;
}

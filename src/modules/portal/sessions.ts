import "server-only";
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { portalSessions } from "@/db/schema";
import { newToken, sha256 } from "@/lib/auth/tokens";
import { getSetting } from "@/lib/settings";

/**
 * Portal sessions (docs/security.md §3.4 "Portal"): their own table and cookie, never `sessions`.
 * Only sha256(token) is stored. Idle expiry slides (refreshed at most every 5 minutes) within the
 * absolute lifetime; both are settings (`portal.session.idle_minutes` 30, `portal.session.absolute_hours` 24).
 * `mfa_pending` sessions exist only between the password and the TOTP step and authorize nothing.
 */
export const PORTAL_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
export const PORTAL_MFA_PENDING_MINUTES = 10;

export type PortalSessionRow = typeof portalSessions.$inferSelect;

export async function portalSessionLimits(q: DbOrTx, organizationId: string) {
  const [idle, abs] = await Promise.all([getSetting(q, organizationId, "portal.session.idle_minutes"), getSetting(q, organizationId, "portal.session.absolute_hours")]);
  return { idleMs: idle * 60_000, absoluteMs: abs * 3_600_000 };
}

export async function createPortalSession(
  q: DbOrTx,
  input: { organizationId: string; portalUserId: string; tenantId: string; stage?: "active" | "mfa_pending"; mfaVerified?: boolean; ip?: string | null; userAgent?: string | null; now?: Date },
): Promise<{ token: string; session: PortalSessionRow }> {
  const now = input.now ?? new Date();
  const stage = input.stage ?? "active";
  const { idleMs, absoluteMs } = stage === "mfa_pending" ? { idleMs: PORTAL_MFA_PENDING_MINUTES * 60_000, absoluteMs: PORTAL_MFA_PENDING_MINUTES * 60_000 } : await portalSessionLimits(q, input.organizationId);
  const token = newToken();
  const [session] = await q
    .insert(portalSessions)
    .values({
      portalUserId: input.portalUserId,
      tenantId: input.tenantId,
      tokenHash: sha256(token),
      stage,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + Math.min(idleMs, absoluteMs)),
      expiresAt: new Date(now.getTime() + absoluteMs),
      mfaVerifiedAt: input.mfaVerified ? now : null,
      ip: input.ip?.slice(0, 64) ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    })
    .returning();
  return { token, session };
}

/** A live portal session of the stage for the token, or null (revoked, idle- or absolute-expired). */
export async function validatePortalSessionToken(token: string, opts: { now?: Date; stage?: "active" | "mfa_pending" } = {}): Promise<PortalSessionRow | null> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const now = opts.now ?? new Date();
  const [s] = await db
    .select()
    .from(portalSessions)
    .where(and(eq(portalSessions.tokenHash, sha256(token)), isNull(portalSessions.revokedAt), gt(portalSessions.expiresAt, now), eq(portalSessions.stage, opts.stage ?? "active")))
    .limit(1);
  if (!s) return null;
  if (now.getTime() >= s.idleExpiresAt.getTime()) return null;
  if (now.getTime() - s.lastSeenAt.getTime() > PORTAL_TOUCH_INTERVAL_MS) {
    const idleLen = s.idleExpiresAt.getTime() - s.lastSeenAt.getTime();
    const next = new Date(Math.min(now.getTime() + idleLen, s.expiresAt.getTime()));
    await db.update(portalSessions).set({ lastSeenAt: now, idleExpiresAt: next }).where(eq(portalSessions.id, s.id));
    return { ...s, lastSeenAt: now, idleExpiresAt: next };
  }
  return s;
}

/** Promotes an mfa_pending session after a valid code: new token, normal lifetimes. */
export async function promotePortalMfaSession(q: DbOrTx, sessionId: string, organizationId: string, now: Date = new Date()): Promise<{ token: string; session: PortalSessionRow }> {
  const { idleMs, absoluteMs } = await portalSessionLimits(q, organizationId);
  const token = newToken();
  const [session] = await q
    .update(portalSessions)
    .set({ tokenHash: sha256(token), stage: "active", lastSeenAt: now, idleExpiresAt: new Date(now.getTime() + Math.min(idleMs, absoluteMs)), expiresAt: new Date(now.getTime() + absoluteMs), mfaVerifiedAt: now })
    .where(and(eq(portalSessions.id, sessionId), eq(portalSessions.stage, "mfa_pending")))
    .returning();
  return { token, session };
}

/** Revokes the live sessions of one portal user (optionally keeping one). */
export async function revokePortalUserSessions(q: DbOrTx, portalUserId: string, reason: string, opts: { exceptSessionId?: string | null; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const rows = await q
    .update(portalSessions)
    .set({ revokedAt: now, revokedReason: reason.slice(0, 300) })
    .where(and(eq(portalSessions.portalUserId, portalUserId), isNull(portalSessions.revokedAt), gt(portalSessions.expiresAt, now), opts.exceptSessionId ? ne(portalSessions.id, opts.exceptSessionId) : sql`true`))
    .returning({ id: portalSessions.id });
  return rows.length;
}

/** Revokes every live session of a tenant (tenant suspended). */
export async function revokePortalTenantSessions(q: DbOrTx, tenantId: string, reason: string, now: Date = new Date()): Promise<number> {
  const rows = await q
    .update(portalSessions)
    .set({ revokedAt: now, revokedReason: reason.slice(0, 300) })
    .where(and(eq(portalSessions.tenantId, tenantId), isNull(portalSessions.revokedAt), gt(portalSessions.expiresAt, now)))
    .returning({ id: portalSessions.id });
  return rows.length;
}

/** Signs one session out (row kept, revoked). */
export async function revokePortalSessionByToken(token: string, reason = "signed out", now: Date = new Date()): Promise<PortalSessionRow | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await db.update(portalSessions).set({ revokedAt: now, revokedReason: reason }).where(and(eq(portalSessions.tokenHash, sha256(token)), isNull(portalSessions.revokedAt))).returning();
  return row ?? null;
}

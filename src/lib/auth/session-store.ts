import "server-only";
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { rolePermissions, roles, sessions, userSiteAssignments, users } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { activeAssignment } from "./assignments";
import { isPrivileged } from "./sensitivity";
import { newToken, sha256 } from "./tokens";

/**
 * Session rows without cookies (docs/security.md §3.4, §3.5; US-1-12). `session.ts` wraps these
 * with the cookie jar; tests call them directly with an injected clock.
 *
 * - `expires_at` is the absolute expiry; `idle_expires_at` slides, refreshed at most every 5 minutes.
 *   The idle length of a session is fixed at creation (idle_expires_at − last_seen_at).
 * - privileged (holder of an R permission, owner_director, system_admin): shorter idle and absolute
 *   limits; a shared device (ticked at sign-in) gets the shared-device idle limit; the shortest wins.
 * - `mfa_pending` sessions exist only between the password and the TOTP step and authorize nothing.
 */
export const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
export const MFA_PENDING_MINUTES = 10;

export type DeviceClass = "standard" | "shared";

export type SessionRow = typeof sessions.$inferSelect;

/** Whether the user's current active assignments make them privileged. */
export async function userIsPrivileged(q: DbOrTx, userId: string, now: Date = new Date()): Promise<boolean> {
  const rows = await q
    .select({ roleCode: roles.code, perm: rolePermissions.permissionCode })
    .from(userSiteAssignments)
    .innerJoin(roles, eq(roles.id, userSiteAssignments.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(and(eq(userSiteAssignments.userId, userId), eq(roles.status, "active"), activeAssignment(now)));
  return isPrivileged(
    rows.map((r) => r.perm).filter((p): p is string => !!p),
    rows.map((r) => r.roleCode),
  );
}

export async function sessionLimits(q: DbOrTx, organizationId: string, privileged: boolean, deviceClass: DeviceClass) {
  const [idle, idlePriv, idleShared, abs, absPriv] = await Promise.all([
    getSetting(q, organizationId, "session.idle_minutes"),
    getSetting(q, organizationId, "session.idle_minutes_privileged"),
    getSetting(q, organizationId, "session.idle_minutes_shared_device"),
    getSetting(q, organizationId, "session.absolute_hours"),
    getSetting(q, organizationId, "session.absolute_hours_privileged"),
  ]);
  const idleMinutes = Math.min(privileged ? idlePriv : idle, deviceClass === "shared" ? idleShared : Number.POSITIVE_INFINITY);
  const absoluteHours = privileged ? absPriv : abs;
  return { idleMs: idleMinutes * 60_000, absoluteMs: absoluteHours * 3_600_000 };
}

export type CreateSessionInput = {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
  deviceClass?: DeviceClass;
  stage?: "active" | "mfa_pending";
  /** Set when the TOTP step was passed (or the user just enrolled). */
  mfaVerified?: boolean;
  now?: Date;
};

/** Inserts a session and returns the raw token (only its hash is stored). */
export async function createSessionRecord(input: CreateSessionInput): Promise<{ token: string; session: SessionRow }> {
  const now = input.now ?? new Date();
  const [u] = await db.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, input.userId)).limit(1);
  if (!u) throw new Error("Unknown user");
  const deviceClass = input.deviceClass ?? "standard";
  const privileged = await userIsPrivileged(db, input.userId, now);
  const stage = input.stage ?? "active";
  const { idleMs, absoluteMs } =
    stage === "mfa_pending"
      ? { idleMs: MFA_PENDING_MINUTES * 60_000, absoluteMs: MFA_PENDING_MINUTES * 60_000 }
      : await sessionLimits(db, u.organizationId, privileged, deviceClass);
  const token = newToken();
  const [session] = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash: sha256(token),
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + Math.min(idleMs, absoluteMs)),
      expiresAt: new Date(now.getTime() + absoluteMs),
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      ip: input.ip?.slice(0, 64) ?? null,
      deviceLabel: deviceLabelFrom(input.userAgent),
      deviceClass,
      privileged,
      stage,
      mfaVerifiedAt: input.mfaVerified ? now : null,
      // Signing in with the password (and code) counts as a fresh authentication for step-up.
      reauthenticatedAt: stage === "active" ? now : null,
    })
    .returning();
  return { token, session };
}

/**
 * Resolves a cookie token to a live session of the given stage, or null. Rejects revoked, absolute-
 * expired and idle-expired sessions; slides the idle expiry at most every 5 minutes.
 */
export async function validateSessionToken(token: string, opts: { now?: Date; stage?: "active" | "mfa_pending" } = {}): Promise<SessionRow | null> {
  const now = opts.now ?? new Date();
  const [s] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), eq(sessions.stage, opts.stage ?? "active")))
    .limit(1);
  if (!s) return null;
  const idleExpires = s.idleExpiresAt ?? new Date(s.lastSeenAt.getTime() + 12 * 3_600_000);
  if (now.getTime() >= idleExpires.getTime()) return null;
  if (now.getTime() - s.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    const idleLen = idleExpires.getTime() - s.lastSeenAt.getTime();
    const next = new Date(Math.min(now.getTime() + idleLen, s.expiresAt.getTime()));
    await db.update(sessions).set({ lastSeenAt: now, idleExpiresAt: next }).where(eq(sessions.id, s.id));
    return { ...s, lastSeenAt: now, idleExpiresAt: next };
  }
  return s;
}

/** Issues a new token for the same session (rotation after re-authentication or the MFA step). */
export async function rotateSessionToken(sessionId: string): Promise<string> {
  const token = newToken();
  await db.update(sessions).set({ tokenHash: sha256(token) }).where(eq(sessions.id, sessionId));
  return token;
}

/** Promotes an `mfa_pending` session after a valid TOTP or recovery code: new token, normal lifetimes. */
export async function promoteMfaSession(sessionId: string, now: Date = new Date()): Promise<{ token: string; session: SessionRow }> {
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  const [u] = await db.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, s.userId)).limit(1);
  const { idleMs, absoluteMs } = await sessionLimits(db, u.organizationId, s.privileged, s.deviceClass as DeviceClass);
  const token = newToken();
  const [session] = await db
    .update(sessions)
    .set({
      tokenHash: sha256(token),
      stage: "active",
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + Math.min(idleMs, absoluteMs)),
      expiresAt: new Date(now.getTime() + absoluteMs),
      mfaVerifiedAt: now,
      reauthenticatedAt: now,
    })
    .where(and(eq(sessions.id, sessionId), eq(sessions.stage, "mfa_pending")))
    .returning();
  return { token, session };
}

/** Revokes every live session of a user (optionally keeping one). Returns the revoked ids. */
export async function revokeUserSessions(
  q: DbOrTx,
  userId: string,
  r: { by: string | null; reason: string; exceptSessionId?: string | null; now?: Date },
): Promise<string[]> {
  const now = r.now ?? new Date();
  const rows = await q
    .update(sessions)
    .set({ revokedAt: now, revokedBy: r.by, revokedReason: r.reason.slice(0, 300) })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), r.exceptSessionId ? ne(sessions.id, r.exceptSessionId) : sql`true`))
    .returning({ id: sessions.id });
  return rows.map((x) => x.id);
}

/** "Chrome on Android" style label from the user agent (no fingerprinting, display only). */
export function deviceLabelFrom(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "unknown OS";
  return `${browser} on ${os}`;
}

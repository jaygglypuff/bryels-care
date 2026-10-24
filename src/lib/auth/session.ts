import "server-only";
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { type DeviceClass, createSessionRecord, validateSessionToken } from "./session-store";
import { sha256 } from "./tokens";

export const SESSION_COOKIE = "bc_session";
export const SITE_COOKIE = "bc_site";
/** Short-lived cookie that carries the `mfa_pending` session between the password and the TOTP step. */
export const MFA_COOKIE = "bc_mfa";

const cookieBase = () => ({ httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" });

/**
 * Client IP for audit and rate limits. Only the proxy header named in TRUSTED_PROXY_HEADER is trusted
 * (Railway: x-forwarded-for, first hop); without it the IP is unknown and IP limits do not apply.
 */
export async function clientIp(): Promise<string | null> {
  const name = process.env.TRUSTED_PROXY_HEADER;
  if (!name) return null;
  const v = (await headers()).get(name);
  return v ? v.split(",")[0].trim().slice(0, 64) || null : null;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, { ...cookieBase(), expires: expiresAt });
}

/** After token rotation (re-authentication): same session, new cookie value, same expiry. */
export async function replaceSessionCookie(token: string, sessionId: string) {
  const [s] = await db.select({ expiresAt: sessions.expiresAt }).from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (s) await setSessionCookie(token, s.expiresAt);
}

export async function setMfaCookie(token: string, expiresAt: Date) {
  (await cookies()).set(MFA_COOKIE, token, { ...cookieBase(), expires: expiresAt });
}

export async function readMfaCookie(): Promise<string | null> {
  return (await cookies()).get(MFA_COOKIE)?.value ?? null;
}

export async function clearMfaCookie() {
  (await cookies()).delete(MFA_COOKIE);
}

export async function createSession(userId: string, opts: { deviceClass?: DeviceClass; mfaVerified?: boolean } = {}) {
  const h = await headers();
  const { token, session } = await createSessionRecord({ userId, ip: await clientIp(), userAgent: h.get("user-agent"), deviceClass: opts.deviceClass, mfaVerified: opts.mfaVerified });
  await setSessionCookie(token, session.expiresAt);
  return session;
}

export type ReadSession = {
  sessionId: string;
  userId: string;
  activeSiteId: string | null;
  reauthenticatedAt: Date | null;
  mfaVerifiedAt: Date | null;
  privileged: boolean;
};

/** Returns the active session, or null. Enforces revocation, idle and absolute expiry on every request. */
export async function readSession(): Promise<ReadSession | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await validateSessionToken(token);
  if (!s) return null;
  return { sessionId: s.id, userId: s.userId, activeSiteId: s.activeSiteId, reauthenticatedAt: s.reauthenticatedAt, mfaVerifiedAt: s.mfaVerifiedAt, privileged: s.privileged };
}

/** Signs out this device: the row is revoked (never deleted) and the cookie cleared. */
export async function destroySession(reason = "signed out") {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.update(sessions).set({ revokedAt: new Date(), revokedReason: reason }).where(eq(sessions.tokenHash, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

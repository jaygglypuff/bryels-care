import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, mfaSecrets, sessions, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { takeToken } from "@/lib/auth/rate-limit";
import { type DeviceClass, type SessionRow, createSessionRecord, promoteMfaSession, rotateSessionToken, validateSessionToken } from "@/lib/auth/session-store";
import { DomainError } from "@/lib/errors";
import { verifySecondFactor } from "./mfa";

/**
 * Sign-in (US-1-10 behaviour kept: 5 failures lock the account) with the TOTP step (US-1-28 AC2) and
 * step-up re-authentication (docs/security.md §3.6). Cookie handling stays in the server actions.
 */
const MAX_FAILURES = 5;
let dummyHash: Promise<string> | null = null;

export type SignInResult =
  | { kind: "ok"; token: string; session: SessionRow }
  | { kind: "mfa"; pendingToken: string; session: SessionRow }
  | { kind: "failed"; message: string };

const GENERIC = "Email or password is incorrect.";

export async function signInWithPassword(input: { email: string; password: string; ip?: string | null; userAgent?: string | null; deviceClass?: DeviceClass }, now: Date = new Date()): Promise<SignInResult> {
  if (input.ip && !(await takeToken("login_ip", input.ip, now))) return { kind: "failed", message: "Too many sign-in attempts from this network. Wait a minute and try again." };
  const email = input.email.trim().toLowerCase();
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (!user) {
    // Same work as a real check so response time does not reveal whether the email exists.
    dummyHash ??= hashPassword("dummy-password-for-timing");
    await verifyPassword(await dummyHash, input.password);
    return { kind: "failed", message: GENERIC };
  }
  if (user.status === "locked") return { kind: "failed", message: "This account is locked. Ask a system administrator to unlock it." };
  if (user.status !== "active") {
    await verifyPassword(user.passwordHash.startsWith("$argon2") ? user.passwordHash : await (dummyHash ??= hashPassword("dummy-password-for-timing")), input.password);
    return { kind: "failed", message: GENERIC };
  }
  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) {
    const failures = user.failedLoginCount + 1;
    const lock = failures >= MAX_FAILURES;
    await db.update(users).set({ failedLoginCount: failures, status: lock ? "locked" : user.status }).where(eq(users.id, user.id));
    await db.insert(auditEvents).values({ organizationId: user.organizationId, actorId: user.id, action: "identity.session.sign_in_failed", entityType: "user", entityId: user.id, entityNumber: user.email });
    if (lock) await db.insert(auditEvents).values({ organizationId: user.organizationId, actorId: user.id, actorLabel: "system:identity.lockout", action: "identity.user.locked", entityType: "user", entityId: user.id, entityNumber: user.email, after: { failedLoginCount: failures } });
    return { kind: "failed", message: GENERIC };
  }
  const [factor] = await db.select({ confirmedAt: mfaSecrets.confirmedAt }).from(mfaSecrets).where(eq(mfaSecrets.userId, user.id)).limit(1);
  if (factor?.confirmedAt) {
    const { token, session } = await createSessionRecord({ userId: user.id, ip: input.ip, userAgent: input.userAgent, deviceClass: input.deviceClass, stage: "mfa_pending", now });
    return { kind: "mfa", pendingToken: token, session };
  }
  await db.update(users).set({ failedLoginCount: 0, lastLoginAt: now }).where(eq(users.id, user.id));
  const { token, session } = await createSessionRecord({ userId: user.id, ip: input.ip, userAgent: input.userAgent, deviceClass: input.deviceClass, now });
  await db.insert(auditEvents).values({ organizationId: user.organizationId, actorId: user.id, action: "identity.session.signed_in", entityType: "user", entityId: user.id, entityNumber: user.email, after: { method: "password", sessionId: session.id } });
  return { kind: "ok", token, session };
}

/** Second step of sign-in: a TOTP or recovery code promotes the pending session (new token). */
export async function completeMfaSignIn(pendingToken: string, code: string, now: Date = new Date()): Promise<{ token: string; session: SessionRow }> {
  const pending = await validateSessionToken(pendingToken, { now, stage: "mfa_pending" });
  if (!pending) throw new DomainError("unauthenticated", "The sign-in step expired. Sign in again.");
  const [u] = await db.select().from(users).where(eq(users.id, pending.userId)).limit(1);
  if (!u || u.status !== "active") throw new DomainError("unauthenticated", "Sign in again.");
  const method = await db.transaction((tx) => verifySecondFactor(tx, u, code, now));
  const out = await promoteMfaSession(pending.id, now);
  await db.update(users).set({ failedLoginCount: 0, lastLoginAt: now }).where(eq(users.id, u.id));
  await db.insert(auditEvents).values({ organizationId: u.organizationId, actorId: u.id, action: "identity.session.signed_in", entityType: "user", entityId: u.id, entityNumber: u.email, after: { method, sessionId: pending.id } });
  return out;
}

/**
 * Step-up (docs/security.md §3.6): password again, plus a TOTP/recovery code when enrolled. Marks the
 * session re-authenticated and rotates its token (session fixation). Returns the new token.
 */
export async function reauthenticate(ctx: AuthContext, input: { password: string; code?: string | null; purpose?: string }, now: Date = new Date()): Promise<string> {
  if (ctx.actor.kind !== "user" || !ctx.sessionId) throw new DomainError("unauthenticated", "Sign in again.");
  const [u] = await db.select().from(users).where(eq(users.id, ctx.userId)).limit(1);
  if (!u || !(await verifyPassword(u.passwordHash, input.password))) {
    await db.insert(auditEvents).values({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "identity.session.reauth_failed", entityType: "user", entityId: ctx.userId, entityNumber: ctx.email });
    throw new DomainError("validation", "That password is not correct.", { field: "password" });
  }
  const [factor] = await db.select({ confirmedAt: mfaSecrets.confirmedAt }).from(mfaSecrets).where(eq(mfaSecrets.userId, u.id)).limit(1);
  let mfa = false;
  if (factor?.confirmedAt) {
    if (!input.code) throw new DomainError("validation", "Enter the code from your authenticator app.", { field: "code" });
    await db.transaction((tx) => verifySecondFactor(tx, u, input.code!, now));
    mfa = true;
  }
  await db
    .update(sessions)
    .set({ reauthenticatedAt: now, ...(mfa ? { mfaVerifiedAt: now } : {}) })
    .where(and(eq(sessions.id, ctx.sessionId), eq(sessions.userId, ctx.userId)));
  await db.insert(auditEvents).values({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: "identity.session.reauthenticated",
    entityType: "session",
    entityId: ctx.sessionId,
    entityNumber: ctx.email,
    after: { purpose: input.purpose?.slice(0, 120) ?? null, mfa },
  });
  return rotateSessionToken(ctx.sessionId);
}

import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, type DbOrTx, type Tx } from "@/db/client";
import { auditEvents, invitations, passwordHistory, passwordResetTokens, sessions, users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { passwordProblem } from "@/lib/auth/password-policy";
import { limitAuth } from "@/lib/rate-limit";
import { revokeUserSessions } from "@/lib/auth/session-store";
import { SYSTEM_USER_STATUS } from "@/lib/auth/system";
import { looksLikeToken, newToken, sha256 } from "@/lib/auth/tokens";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { sendNoticeEmail, sendResetEmail } from "./messages";

/**
 * Self-service account flows that need no permission (docs/permissions-matrix.md §2.12 last paragraph):
 * accepting an invitation, password reset, changing one's own password (US-1-11). Tokens identify the
 * account; no user id is ever taken from the client (auth.reset.token_bound).
 */

type AuditRow = { organizationId: string; actorId: string | null; action: string; entityId: string; entityNumber: string; reason?: string | null; after?: unknown };

export async function auditAccount(q: DbOrTx, e: AuditRow) {
  await q.insert(auditEvents).values({
    organizationId: e.organizationId,
    siteId: null,
    actorId: e.actorId,
    action: e.action,
    entityType: "user",
    entityId: e.entityId,
    entityNumber: e.entityNumber,
    reason: e.reason ?? null,
    after: (e.after as object) ?? null,
  });
}

/** Password policy + reuse check (A-SEC-03..05). Throws a validation error with the field name. */
async function assertAcceptablePassword(q: DbOrTx, u: { id: string; organizationId: string; email: string; displayName: string; passwordHash: string }, password: string) {
  const minLength = await getSetting(q, u.organizationId, "identity.password.min_length");
  const problem = passwordProblem(password, { email: u.email, displayName: u.displayName, minLength });
  if (problem) throw new DomainError("validation", problem, { field: "password" });
  const keep = await getSetting(q, u.organizationId, "identity.password.history_count");
  if (keep > 0) {
    const recent = await q.select({ h: passwordHistory.passwordHash }).from(passwordHistory).where(eq(passwordHistory.userId, u.id)).orderBy(desc(passwordHistory.createdAt)).limit(keep);
    const hashes = [u.passwordHash, ...recent.map((r) => r.h)].filter((h) => h.startsWith("$argon2"));
    for (const h of hashes.slice(0, keep)) {
      if (await verifyPassword(h, password)) throw new DomainError("validation", `Choose a password you have not used for your last ${keep} passwords.`, { field: "password" });
    }
  }
}

async function setPassword(tx: Tx, u: { id: string; organizationId: string }, password: string, now: Date) {
  const hash = await hashPassword(password);
  await tx.update(users).set({ passwordHash: hash, passwordChangedAt: now, failedLoginCount: 0, updatedAt: now }).where(eq(users.id, u.id));
  await tx.insert(passwordHistory).values({ organizationId: u.organizationId, userId: u.id, passwordHash: hash, createdAt: now });
  // Keep only the newest N history rows (data-model §12.2 "security").
  const keep = await getSetting(tx, u.organizationId, "identity.password.history_count");
  await tx.execute(sql`delete from password_history where user_id = ${u.id} and id not in (select id from password_history where user_id = ${u.id} order by created_at desc limit ${Math.max(keep, 1)})`);
}

// ---------- invitation acceptance ----------

export type TokenState = { state: "valid"; email: string; displayName: string } | { state: "expired" | "used" | "invalid" };

export async function inspectInvitation(token: string, now: Date = new Date()): Promise<TokenState> {
  if (!looksLikeToken(token)) return { state: "invalid" };
  const [row] = await db
    .select({ inv: invitations, status: users.status, displayName: users.displayName })
    .from(invitations)
    .innerJoin(users, eq(users.id, invitations.userId))
    .where(eq(invitations.tokenHash, sha256(token)))
    .limit(1);
  if (!row) return { state: "invalid" };
  if (row.inv.acceptedAt || row.inv.revokedAt || row.status !== "invited") return { state: "used" };
  if (row.inv.expiresAt.getTime() <= now.getTime()) return { state: "expired" };
  return { state: "valid", email: row.inv.email, displayName: row.displayName };
}

/** Sets the password and activates the invited account (US-1-11 AC1). Single use. */
export async function acceptInvitation(input: { token: string; password: string; ip?: string | null }, now: Date = new Date()): Promise<{ userId: string; email: string }> {
  if (input.ip && !(await limitAuth("token_ip", input.ip, now))) throw new DomainError("validation", "Too many attempts from this network. Wait a few minutes and try again.");
  if (!looksLikeToken(input.token)) throw new DomainError("not_found", "This invitation link is not valid. Ask your administrator for a new one.");
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invitations).where(eq(invitations.tokenHash, sha256(input.token))).for("update").limit(1);
    if (!inv) throw new DomainError("not_found", "This invitation link is not valid. Ask your administrator for a new one.");
    const [u] = await tx.select().from(users).where(eq(users.id, inv.userId)).for("update").limit(1);
    if (inv.acceptedAt || inv.revokedAt || u.status !== "invited") throw new DomainError("state", "This invitation link was already used or withdrawn. Ask your administrator for a new one.");
    if (inv.expiresAt.getTime() <= now.getTime()) throw new DomainError("state", "This invitation link has expired. Ask your administrator to send a new one.");
    await assertAcceptablePassword(tx, u, input.password);
    await setPassword(tx, u, input.password, now);
    await tx.update(users).set({ status: "active" }).where(eq(users.id, u.id));
    await tx.update(invitations).set({ acceptedAt: now }).where(eq(invitations.id, inv.id));
    await auditAccount(tx, { organizationId: u.organizationId, actorId: u.id, action: "identity.invitation.accepted", entityId: u.id, entityNumber: u.email, after: { invitationId: inv.id, kind: inv.kind } });
    return { userId: u.id, email: u.email };
  });
}

// ---------- password reset ----------

const GENERIC_RESET = "If an account exists for that email, we sent a link to reset the password. It works for a short time and only once.";

/**
 * "Forgot password" (US-1-11 AC2): the same answer whether or not the account exists; at most 3 requests
 * per account per hour (and 10 per IP); 30-minute single-use token; the newest token voids older ones.
 */
export async function requestPasswordReset(input: { email: string; ip?: string | null }, now: Date = new Date()): Promise<{ message: string }> {
  const email = String(input.email ?? "").trim().toLowerCase().slice(0, 200);
  if (input.ip && !(await limitAuth("password_reset_ip", input.ip, now))) return { message: GENERIC_RESET };
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return { message: GENERIC_RESET };
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (!u || u.status !== "active") return { message: GENERIC_RESET };
  if (!(await limitAuth("password_reset_account", u.id, now))) return { message: GENERIC_RESET };
  const minutes = await getSetting(db, u.organizationId, "identity.password_reset.ttl_minutes");
  const token = newToken();
  await db.transaction(async (tx) => {
    await tx.update(passwordResetTokens).set({ voidedAt: now }).where(and(eq(passwordResetTokens.userId, u.id), isNull(passwordResetTokens.usedAt), isNull(passwordResetTokens.voidedAt)));
    await tx.insert(passwordResetTokens).values({ organizationId: u.organizationId, userId: u.id, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + minutes * 60_000), requestedIp: input.ip ?? null, createdAt: now });
    await auditAccount(tx, { organizationId: u.organizationId, actorId: u.id, action: "identity.user.password_reset_requested", entityId: u.id, entityNumber: u.email, after: { by: "self" } });
  });
  await sendResetEmail({ organizationId: u.organizationId, to: u.email, displayName: u.displayName, token, minutes });
  return { message: GENERIC_RESET };
}

export async function inspectResetToken(token: string, now: Date = new Date()): Promise<TokenState> {
  if (!looksLikeToken(token)) return { state: "invalid" };
  const [row] = await db
    .select({ t: passwordResetTokens, email: users.email, displayName: users.displayName, status: users.status })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(eq(passwordResetTokens.tokenHash, sha256(token)))
    .limit(1);
  if (!row) return { state: "invalid" };
  if (row.t.usedAt || row.t.voidedAt || (row.status !== "active" && row.status !== "locked")) return { state: "used" };
  if (row.t.expiresAt.getTime() <= now.getTime()) return { state: "expired" };
  return { state: "valid", email: row.email, displayName: row.displayName };
}

/** Sets a new password from a reset token; every session of the user is revoked (US-1-11 AC2). */
export async function completePasswordReset(input: { token: string; password: string; ip?: string | null }, now: Date = new Date()): Promise<{ userId: string }> {
  if (input.ip && !(await limitAuth("token_ip", input.ip, now))) throw new DomainError("validation", "Too many attempts from this network. Wait a few minutes and try again.");
  if (!looksLikeToken(input.token)) throw new DomainError("not_found", "This reset link is not valid. Request a new one.");
  const out = await db.transaction(async (tx) => {
    const [t] = await tx.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, sha256(input.token))).for("update").limit(1);
    if (!t) throw new DomainError("not_found", "This reset link is not valid. Request a new one.");
    const [u] = await tx.select().from(users).where(eq(users.id, t.userId)).for("update").limit(1);
    if (t.usedAt || t.voidedAt) throw new DomainError("state", "This reset link was already used or replaced by a newer one. Request a new link.");
    if (t.expiresAt.getTime() <= now.getTime()) throw new DomainError("state", "This reset link has expired. Request a new link.");
    if (u.status !== "active" && u.status !== "locked") throw new DomainError("state", "This account cannot be reset. Contact your system administrator.");
    await assertAcceptablePassword(tx, u, input.password);
    await setPassword(tx, u, input.password, now);
    // An admin-forced reset of a locked account does not unlock it; unlocking stays an admin decision.
    await tx.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.id, t.id));
    await tx.update(passwordResetTokens).set({ voidedAt: now }).where(and(eq(passwordResetTokens.userId, u.id), isNull(passwordResetTokens.usedAt), isNull(passwordResetTokens.voidedAt)));
    const revoked = await revokeUserSessions(tx, u.id, { by: null, reason: "password reset", now });
    await auditAccount(tx, { organizationId: u.organizationId, actorId: u.id, action: "identity.user.password_reset_completed", entityId: u.id, entityNumber: u.email, after: { revokedSessions: revoked.length } });
    return u;
  });
  await sendNoticeEmail({
    organizationId: out.organizationId,
    to: out.email,
    displayName: out.displayName,
    template: "identity.password_changed",
    subject: "Your Bryel's Care password was changed",
    body: "Your password was reset and every device was signed out.",
  });
  return { userId: out.id };
}

/** Own password change: current password required; every other session is revoked (US-1-12 AC3). */
export async function changeOwnPassword(ctx: AuthContext, input: { currentPassword: string; newPassword: string }, now: Date = new Date()): Promise<{ revokedSessions: number }> {
  if (ctx.actor.kind !== "user") throw new DomainError("forbidden", "Only people change passwords.");
  const out = await db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(and(eq(users.id, ctx.userId), sql`${users.status} <> ${SYSTEM_USER_STATUS}`)).for("update").limit(1);
    if (!u) throw new DomainError("not_found", "Account not found.");
    if (!(await verifyPassword(u.passwordHash, input.currentPassword))) throw new DomainError("validation", "Your current password is not correct.", { field: "currentPassword" });
    await assertAcceptablePassword(tx, u, input.newPassword);
    await setPassword(tx, u, input.newPassword, now);
    const revoked = await revokeUserSessions(tx, u.id, { by: u.id, reason: "password changed", exceptSessionId: ctx.sessionId, now });
    if (ctx.sessionId) await tx.update(sessions).set({ reauthenticatedAt: now }).where(eq(sessions.id, ctx.sessionId));
    await auditAccount(tx, { organizationId: u.organizationId, actorId: u.id, action: "identity.user.password_changed", entityId: u.id, entityNumber: u.email, after: { revokedSessions: revoked.length } });
    return { u, revoked: revoked.length };
  });
  await sendNoticeEmail({
    organizationId: out.u.organizationId,
    to: out.u.email,
    displayName: out.u.displayName,
    template: "identity.password_changed",
    subject: "Your Bryel's Care password was changed",
    body: "Your password was changed and your other devices were signed out.",
  });
  return { revokedSessions: out.revoked };
}

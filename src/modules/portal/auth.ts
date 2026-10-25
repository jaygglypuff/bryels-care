import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { db, type Tx } from "@/db/client";
import { customerPortalTenants, customers, portalInvitations, portalUsers } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { passwordProblem } from "@/lib/auth/password-policy";
import { decryptSecret, encryptSecret, newTotpSecret, otpauthUri, verifyTotp } from "@/lib/auth/totp";
import { looksLikeToken, sha256 } from "@/lib/auth/tokens";
import { DomainError } from "@/lib/errors";
import { limitAuth } from "@/lib/rate-limit";
import { getSetting } from "@/lib/settings";
import type { PortalAuthContext } from "./context";
import { createPortalSession, promotePortalMfaSession, revokePortalSessionByToken, revokePortalUserSessions, validatePortalSessionToken, type PortalSessionRow } from "./sessions";
import { limitPortalUnauthenticated, portalActor, portalAudit } from "./support";

/**
 * Portal sign-in, TOTP step, invitation acceptance and own-account changes (US-8-01; docs/security.md
 * §2.10, §3.3, §3.7, §3.8). Separate from internal identity in every respect: table, cookie,
 * lockout counter (setting portal.auth.max_failed_attempts, default 5), rate limit
 * (portal.rate_limits, 30 unauthenticated requests per IP and minute) and audit actor label.
 * Answers never reveal whether an email has an account (one generic message, same work done).
 */
const GENERIC = "Email or password is incorrect.";
let dummyHash: Promise<string> | null = null;
const dummy = () => (dummyHash ??= hashPassword("dummy-portal-password-for-timing"));

export type PortalSignInResult =
  | { kind: "ok"; token: string; session: PortalSessionRow }
  | { kind: "mfa"; pendingToken: string; session: PortalSessionRow }
  | { kind: "failed"; message: string; retryAfterSeconds?: number };

type PortalUserRow = typeof portalUsers.$inferSelect;

async function findByEmail(email: string) {
  const [row] = await db
    .select({ u: portalUsers, tenantStatus: customerPortalTenants.status, customerStatus: customers.status })
    .from(portalUsers)
    .innerJoin(customerPortalTenants, eq(customerPortalTenants.id, portalUsers.tenantId))
    .innerJoin(customers, eq(customers.id, customerPortalTenants.customerId))
    .where(sql`lower(${portalUsers.email}) = ${email}`)
    .limit(1);
  return row ?? null;
}

export async function signInPortal(input: { email: string; password: string; ip?: string | null; userAgent?: string | null }, now: Date = new Date()): Promise<PortalSignInResult> {
  const limited = await limitPortalUnauthenticated(input.ip, now);
  if (!limited.allowed) return { kind: "failed", message: `Too many attempts from this network. Wait ${limited.retryAfterSeconds} seconds, then try again.`, retryAfterSeconds: limited.retryAfterSeconds };
  const email = String(input.email ?? "").trim().toLowerCase().slice(0, 200);
  const password = String(input.password ?? "").slice(0, 256);
  const row = /^[^\s@]+@[^\s@]+$/.test(email) ? await findByEmail(email) : null;
  if (!row || !row.u.passwordHash.startsWith("$argon2") || (row.u.status !== "active" && row.u.status !== "locked")) {
    await verifyPassword(row?.u.passwordHash.startsWith("$argon2") ? row.u.passwordHash : await dummy(), password);
    return { kind: "failed", message: GENERIC };
  }
  const u = row.u;
  const ok = await verifyPassword(u.passwordHash, password);
  if (!ok) {
    if (u.status === "locked") return { kind: "failed", message: GENERIC };
    const max = await getSetting(db, u.organizationId, "portal.auth.max_failed_attempts");
    const failures = u.failedLoginCount + 1;
    const lock = failures >= max;
    await db.transaction(async (tx) => {
      await tx.update(portalUsers).set({ failedLoginCount: failures, status: lock ? "locked" : u.status, statusReason: lock ? `${failures} failed sign-ins` : u.statusReason, updatedAt: now }).where(eq(portalUsers.id, u.id));
      await portalAudit(tx, { organizationId: u.organizationId, actorLabel: portalActor(u.id), action: "sales.portal_user.sign_in_failed", entityType: "portal_user", entityId: u.id, entityNumber: u.email, after: { failedLoginCount: failures } });
      if (lock) await portalAudit(tx, { organizationId: u.organizationId, actorLabel: "system:portal.lockout", action: "sales.portal_user.locked", entityType: "portal_user", entityId: u.id, entityNumber: u.email, before: { status: u.status }, after: { status: "locked", failedLoginCount: failures } });
    });
    return { kind: "failed", message: GENERIC };
  }
  // The password was right: only now say why access is refused (no account enumeration).
  if (u.status === "locked") return { kind: "failed", message: "This portal account is locked after too many failed sign-ins. Ask your Bryel's Care contact to unlock it." };
  if (row.tenantStatus !== "active" || row.customerStatus === "inactive") return { kind: "failed", message: "Portal access for your company is paused. Contact your Bryel's Care sales representative." };
  if (u.totpConfirmedAt) {
    const { token, session } = await createPortalSession(db, { organizationId: u.organizationId, portalUserId: u.id, tenantId: u.tenantId, stage: "mfa_pending", ip: input.ip, userAgent: input.userAgent, now });
    return { kind: "mfa", pendingToken: token, session };
  }
  return finishSignIn(u, { ip: input.ip, userAgent: input.userAgent, method: "password", now });
}

async function finishSignIn(u: PortalUserRow, o: { ip?: string | null; userAgent?: string | null; method: string; now: Date }): Promise<PortalSignInResult> {
  return db.transaction(async (tx) => {
    const { token, session } = await createPortalSession(tx, { organizationId: u.organizationId, portalUserId: u.id, tenantId: u.tenantId, ip: o.ip, userAgent: o.userAgent, mfaVerified: o.method !== "password", now: o.now });
    await tx.update(portalUsers).set({ failedLoginCount: 0, lastLoginAt: o.now, updatedAt: o.now }).where(eq(portalUsers.id, u.id));
    await portalAudit(tx, { organizationId: u.organizationId, actorLabel: portalActor(u.id), action: "sales.portal_user.signed_in", entityType: "portal_user", entityId: u.id, entityNumber: u.email, after: { method: o.method, sessionId: session.id } });
    return { kind: "ok" as const, token, session };
  });
}

/** Second step: a TOTP code promotes the pending session (new token). 5 tries per 15 minutes. */
export async function completePortalMfa(pendingToken: string, code: string, now: Date = new Date()): Promise<{ token: string; session: PortalSessionRow }> {
  const pending = await validatePortalSessionToken(pendingToken, { now, stage: "mfa_pending" });
  if (!pending) throw new DomainError("unauthenticated", "The sign-in step expired. Sign in again.");
  const [u] = await db.select().from(portalUsers).where(eq(portalUsers.id, pending.portalUserId)).limit(1);
  if (!u || u.status !== "active" || !u.totpConfirmedAt || !u.totpSecretEnc || !u.totpKeyId) throw new DomainError("unauthenticated", "Sign in again.");
  if (!(await limitAuth("mfa_user", `portal:${u.id}`, now))) throw new DomainError("validation", "Too many codes tried. Wait 15 minutes and try again.", { field: "code" });
  const clean = String(code ?? "").trim();
  const step = /^\d{6}$/.test(clean) ? verifyTotp(decryptSecret(u.totpSecretEnc, u.totpKeyId), clean, now, u.totpLastStep) : null;
  if (step === null) {
    await portalAudit(db, { organizationId: u.organizationId, actorLabel: portalActor(u.id), action: "sales.portal_user.mfa_failed", entityType: "portal_user", entityId: u.id, entityNumber: u.email });
    throw new DomainError("validation", "That code did not match. Use the newest code from your app.", { field: "code" });
  }
  return db.transaction(async (tx) => {
    await tx.update(portalUsers).set({ totpLastStep: step, failedLoginCount: 0, lastLoginAt: now, updatedAt: now }).where(eq(portalUsers.id, u.id));
    const out = await promotePortalMfaSession(tx, pending.id, u.organizationId, now);
    await portalAudit(tx, { organizationId: u.organizationId, actorLabel: portalActor(u.id), action: "sales.portal_user.signed_in", entityType: "portal_user", entityId: u.id, entityNumber: u.email, after: { method: "totp", sessionId: pending.id } });
    return out;
  });
}

export async function signOutPortal(token: string | null | undefined, now: Date = new Date()): Promise<void> {
  if (!token) return;
  const row = await revokePortalSessionByToken(token, "signed out", now);
  if (row) {
    const [u] = await db.select({ organizationId: portalUsers.organizationId, email: portalUsers.email }).from(portalUsers).where(eq(portalUsers.id, row.portalUserId)).limit(1);
    if (u) await portalAudit(db, { organizationId: u.organizationId, actorLabel: portalActor(row.portalUserId), action: "sales.portal_user.signed_out", entityType: "portal_user", entityId: row.portalUserId, entityNumber: u.email });
  }
}

// ---------------------------------------------------------------- invitation acceptance

export type PortalTokenState = { state: "valid"; email: string; displayName: string; customerName: string } | { state: "expired" | "used" | "invalid" };

export async function inspectPortalInvitation(token: string, now: Date = new Date()): Promise<PortalTokenState> {
  if (!looksLikeToken(token)) return { state: "invalid" };
  const [row] = await db
    .select({ inv: portalInvitations, status: portalUsers.status, displayName: portalUsers.displayName, customerName: customers.name })
    .from(portalInvitations)
    .innerJoin(portalUsers, eq(portalUsers.id, portalInvitations.portalUserId))
    .innerJoin(customerPortalTenants, eq(customerPortalTenants.id, portalInvitations.tenantId))
    .innerJoin(customers, eq(customers.id, customerPortalTenants.customerId))
    .where(eq(portalInvitations.tokenHash, sha256(token)))
    .limit(1);
  if (!row) return { state: "invalid" };
  if (row.inv.acceptedAt || row.inv.revokedAt || row.status !== "invited") return { state: "used" };
  if (row.inv.expiresAt.getTime() <= now.getTime()) return { state: "expired" };
  return { state: "valid", email: row.inv.email, displayName: row.displayName, customerName: row.customerName };
}

async function assertPortalPassword(organizationId: string, u: { email: string; displayName: string }, password: string) {
  const minLength = await getSetting(db, organizationId, "identity.password.min_length");
  const problem = passwordProblem(password, { email: u.email, displayName: u.displayName, minLength });
  if (problem) throw new DomainError("validation", problem, { field: "password" });
}

/** Sets the password and activates the invited portal account (single use, tenant bound). */
export async function acceptPortalInvitation(input: { token: string; password: string; ip?: string | null }, now: Date = new Date()): Promise<{ portalUserId: string; email: string }> {
  const limited = await limitPortalUnauthenticated(input.ip, now);
  if (!limited.allowed) throw new DomainError("rate_limited", `Too many attempts from this network. Wait ${limited.retryAfterSeconds} seconds, then try again.`);
  if (!looksLikeToken(input.token)) throw new DomainError("not_found", "This invitation link is not valid. Ask your Bryel's Care contact for a new one.");
  const [peek] = await db.select().from(portalInvitations).where(eq(portalInvitations.tokenHash, sha256(input.token))).limit(1);
  if (!peek) throw new DomainError("not_found", "This invitation link is not valid. Ask your Bryel's Care contact for a new one.");
  const [pu] = await db.select().from(portalUsers).where(eq(portalUsers.id, peek.portalUserId)).limit(1);
  await assertPortalPassword(pu.organizationId, pu, String(input.password ?? ""));
  const hash = await hashPassword(String(input.password));
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(portalInvitations).where(eq(portalInvitations.id, peek.id)).for("update").limit(1);
    const [u] = await tx.select().from(portalUsers).where(eq(portalUsers.id, inv.portalUserId)).for("update").limit(1);
    if (inv.acceptedAt || inv.revokedAt || u.status !== "invited") throw new DomainError("state", "This invitation link was already used or withdrawn. Ask your Bryel's Care contact for a new one.");
    if (inv.expiresAt.getTime() <= now.getTime()) throw new DomainError("state", "This invitation link has expired. Ask your Bryel's Care contact to send a new one.");
    await tx.update(portalUsers).set({ passwordHash: hash, passwordChangedAt: now, status: "active", failedLoginCount: 0, statusReason: null, updatedAt: now }).where(eq(portalUsers.id, u.id));
    await tx.update(portalInvitations).set({ acceptedAt: now }).where(eq(portalInvitations.id, inv.id));
    await portalAudit(tx, { organizationId: u.organizationId, actorLabel: portalActor(u.id), action: "sales.portal_user.invitation_accepted", entityType: "portal_user", entityId: u.id, entityNumber: u.email, before: { status: "invited" }, after: { status: "active", invitationId: inv.id } });
    return { portalUserId: u.id, email: u.email };
  });
}

// ---------------------------------------------------------------- own account

async function loadSelf(ctx: PortalAuthContext) {
  const [u] = await db.select().from(portalUsers).where(and(eq(portalUsers.id, ctx.portalUserId), eq(portalUsers.tenantId, ctx.tenantId))).limit(1);
  if (!u) throw new DomainError("unauthenticated", "Sign in again.");
  return u;
}

export async function portalAccountState(ctx: PortalAuthContext) {
  ctx.require("portal.account.edit");
  const u = await loadSelf(ctx);
  return { email: u.email, displayName: u.displayName, mfaEnabled: !!u.totpConfirmedAt, mfaPending: !!u.totpSecretEnc && !u.totpConfirmedAt, lastLoginAt: u.lastLoginAt };
}

/** Changes the own password (current password required); every other portal session is signed out. */
export async function changePortalPassword(ctx: PortalAuthContext, input: { currentPassword: string; newPassword: string }, now: Date = new Date()): Promise<void> {
  ctx.require("portal.account.edit");
  const u = await loadSelf(ctx);
  if (!(await verifyPassword(u.passwordHash, String(input.currentPassword ?? "")))) throw new DomainError("validation", "Your current password is not correct.", { field: "currentPassword" });
  await assertPortalPassword(u.organizationId, u, String(input.newPassword ?? "")).catch((e) => {
    if (e instanceof DomainError) throw new DomainError("validation", e.message, { field: "newPassword" });
    throw e;
  });
  if (await verifyPassword(u.passwordHash, String(input.newPassword))) throw new DomainError("validation", "Choose a password different from the current one.", { field: "newPassword" });
  const hash = await hashPassword(String(input.newPassword));
  await db.transaction(async (tx) => {
    await tx.update(portalUsers).set({ passwordHash: hash, passwordChangedAt: now, updatedAt: now }).where(eq(portalUsers.id, u.id));
    const revoked = await revokePortalUserSessions(tx, u.id, "password changed", { exceptSessionId: ctx.sessionId, now });
    await portalAudit(tx, { organizationId: u.organizationId, actorLabel: ctx.actorLabel, action: "sales.portal_user.password_changed", entityType: "portal_user", entityId: u.id, entityNumber: u.email, after: { otherSessionsRevoked: revoked }, correlationId: ctx.correlationId });
  });
}

/** TOTP enrolment step 1 (optional for portal users): password again, then a new unconfirmed secret. */
export async function beginPortalTotp(ctx: PortalAuthContext, password: string, now: Date = new Date()): Promise<{ secret: string; uri: string; qrDataUrl: string }> {
  ctx.require("portal.account.edit");
  const u = await loadSelf(ctx);
  if (u.totpConfirmedAt) throw new DomainError("state", "Two-step sign-in is already on. Turn it off first to use a new phone.");
  if (!(await verifyPassword(u.passwordHash, String(password ?? "")))) throw new DomainError("validation", "That password is not correct.", { field: "password" });
  const secret = newTotpSecret();
  const { enc, keyId } = encryptSecret(secret);
  await db.update(portalUsers).set({ totpSecretEnc: enc, totpKeyId: keyId, totpLastStep: null, updatedAt: now }).where(eq(portalUsers.id, u.id));
  const uri = otpauthUri(secret, u.email, "Bryel's Care portal");
  return { secret, uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

/** TOTP enrolment step 2: one valid code turns two-step sign-in on. */
export async function confirmPortalTotp(ctx: PortalAuthContext, code: string, now: Date = new Date()): Promise<void> {
  ctx.require("portal.account.edit");
  if (!(await limitAuth("mfa_user", `portal:${ctx.portalUserId}`, now))) throw new DomainError("validation", "Too many codes tried. Wait 15 minutes and try again.", { field: "code" });
  await db.transaction(async (tx) => {
    const [u] = await tx.select().from(portalUsers).where(eq(portalUsers.id, ctx.portalUserId)).for("update").limit(1);
    if (!u?.totpSecretEnc || !u.totpKeyId) throw new DomainError("state", "Start the set-up again: no enrolment is in progress.");
    if (u.totpConfirmedAt) throw new DomainError("state", "Two-step sign-in is already on.");
    const step = /^\d{6}$/.test(String(code ?? "").trim()) ? verifyTotp(decryptSecret(u.totpSecretEnc, u.totpKeyId), String(code).trim(), now, u.totpLastStep) : null;
    if (step === null) throw new DomainError("validation", "That code did not match. Check the time on your phone and try the newest code.", { field: "code" });
    await tx.update(portalUsers).set({ totpConfirmedAt: now, totpLastStep: step, updatedAt: now }).where(eq(portalUsers.id, u.id));
    await portalAudit(tx, { organizationId: u.organizationId, actorLabel: ctx.actorLabel, action: "sales.portal_user.mfa_enrolled", entityType: "portal_user", entityId: u.id, entityNumber: u.email, correlationId: ctx.correlationId });
  });
}

/** Turns two-step sign-in off with a current code. */
export async function disablePortalTotp(ctx: PortalAuthContext, code: string, now: Date = new Date()): Promise<void> {
  ctx.require("portal.account.edit");
  if (!(await limitAuth("mfa_user", `portal:${ctx.portalUserId}`, now))) throw new DomainError("validation", "Too many codes tried. Wait 15 minutes and try again.", { field: "code" });
  await db.transaction(async (tx) => {
    const [u] = await tx.select().from(portalUsers).where(eq(portalUsers.id, ctx.portalUserId)).for("update").limit(1);
    if (!u?.totpConfirmedAt || !u.totpSecretEnc || !u.totpKeyId) throw new DomainError("state", "Two-step sign-in is not on.");
    const step = /^\d{6}$/.test(String(code ?? "").trim()) ? verifyTotp(decryptSecret(u.totpSecretEnc, u.totpKeyId), String(code).trim(), now, u.totpLastStep) : null;
    if (step === null) throw new DomainError("validation", "That code did not match.", { field: "code" });
    await tx.update(portalUsers).set({ totpConfirmedAt: null, totpSecretEnc: null, totpKeyId: null, totpLastStep: null, updatedAt: now }).where(eq(portalUsers.id, u.id));
    await portalAudit(tx, { organizationId: u.organizationId, actorLabel: ctx.actorLabel, action: "sales.portal_user.mfa_disabled", entityType: "portal_user", entityId: u.id, entityNumber: u.email, correlationId: ctx.correlationId });
  });
}

/** Revokes pending invitations of a portal user (used by staff lifecycle code). */
export async function revokeOpenPortalInvitations(tx: Tx, portalUserId: string, reason: string, now: Date) {
  await tx
    .update(portalInvitations)
    .set({ revokedAt: now, revokedReason: reason.slice(0, 300) })
    .where(and(eq(portalInvitations.portalUserId, portalUserId), isNull(portalInvitations.acceptedAt), isNull(portalInvitations.revokedAt)));
}

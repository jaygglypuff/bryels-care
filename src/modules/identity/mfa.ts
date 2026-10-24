import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import QRCode from "qrcode";
import { z } from "zod";
import { db, type Tx } from "@/db/client";
import { auditEvents, mfaRecoveryCodes, mfaSecrets, sessions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { takeToken } from "@/lib/auth/rate-limit";
import { revokeUserSessions } from "@/lib/auth/session-store";
import { decryptSecret, encryptSecret, newTotpSecret, otpauthUri, verifyTotp } from "@/lib/auth/totp";
import { DomainError } from "@/lib/errors";
import { notifyUser } from "./lifecycle";
import { type MfaState, assertStepUp, mfaStateFor, requireReason } from "./policy";
import { assertUserVisible } from "./users";

/**
 * TOTP multi-factor (US-1-28, docs/security.md §3.7). Enrolment needs a fresh re-authentication, shows
 * a QR code and the manual key, activates only after one valid code, and returns 10 single-use
 * recovery codes once. Sign-in and step-up verify codes with ±1 step and refuse a reused step.
 */
export const RECOVERY_CODE_COUNT = 10;

export async function myMfaState(ctx: AuthContext, now: Date = new Date()): Promise<MfaState & { recoveryCodesLeft: number }> {
  const s = await mfaStateFor(db, ctx.organizationId, ctx.userId, now);
  const left = s.enrolled
    ? (await db.select({ id: mfaRecoveryCodes.id }).from(mfaRecoveryCodes).where(and(eq(mfaRecoveryCodes.userId, ctx.userId), isNull(mfaRecoveryCodes.usedAt)))).length
    : 0;
  return { ...s, recoveryCodesLeft: left };
}

/** Step 1: a new (unconfirmed) secret. Replaces an earlier unconfirmed one; refuses when already enrolled. */
export async function beginMfaEnrolment(ctx: AuthContext, now: Date = new Date()): Promise<{ secret: string; uri: string; qrDataUrl: string }> {
  if (ctx.actor.kind !== "user") throw new DomainError("forbidden", "Only people enrol.");
  // Re-authentication is required even before enrolment (no TOTP yet): password within the window.
  await assertFreshPassword(ctx, now);
  const [existing] = await db.select().from(mfaSecrets).where(eq(mfaSecrets.userId, ctx.userId)).limit(1);
  if (existing?.confirmedAt) throw new DomainError("state", "Two-step sign-in is already set up. Turn it off first to enrol a new device.");
  const secret = newTotpSecret();
  const { enc, keyId } = encryptSecret(secret);
  if (existing) await db.update(mfaSecrets).set({ secretEnc: enc, keyId, lastUsedStep: null, updatedAt: now }).where(eq(mfaSecrets.id, existing.id));
  else await db.insert(mfaSecrets).values({ organizationId: ctx.organizationId, userId: ctx.userId, secretEnc: enc, keyId, createdAt: now, updatedAt: now });
  const uri = otpauthUri(secret, ctx.email);
  return { secret, uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

async function assertFreshPassword(ctx: AuthContext, now: Date) {
  try {
    await assertStepUp(ctx, "set up two-step sign-in", now);
  } catch (e) {
    // Being overdue for enrolment must not block enrolment itself.
    if (e instanceof DomainError && e.details?.mfaEnrolmentRequired) return;
    throw e;
  }
}

function newRecoveryCode(): string {
  const raw = randomBytes(8).toString("hex").toUpperCase(); // 64 bits
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

/** Step 2: verifies one code, activates the factor and returns the recovery codes (shown once). */
export async function confirmMfaEnrolment(ctx: AuthContext, code: string, now: Date = new Date()): Promise<{ recoveryCodes: string[] }> {
  if (ctx.actor.kind !== "user") throw new DomainError("forbidden", "Only people enrol.");
  const c = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the app.").parse(code);
  if (!(await takeToken("mfa_user", ctx.userId, now))) throw new DomainError("validation", "Too many codes tried. Wait 15 minutes and try again.");
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  const hashes = await Promise.all(codes.map((x) => hashPassword(x)));
  await db.transaction(async (tx) => {
    const [f] = await tx.select().from(mfaSecrets).where(eq(mfaSecrets.userId, ctx.userId)).for("update").limit(1);
    if (!f) throw new DomainError("state", "Start the set-up again: no enrolment is in progress.");
    if (f.confirmedAt) throw new DomainError("state", "Two-step sign-in is already set up.");
    const step = verifyTotp(decryptSecret(f.secretEnc, f.keyId), c, now, f.lastUsedStep);
    if (step === null) {
      await audit(tx, ctx, { action: "identity.mfa.failed", entityType: "user", entityId: ctx.userId, entityNumber: ctx.email, siteId: null, after: { stage: "enrolment" } });
      throw new DomainError("validation", "That code did not match. Check the time on your phone and try the newest code.", { field: "code" });
    }
    await tx.update(mfaSecrets).set({ confirmedAt: now, lastUsedStep: step, lastUsedAt: now, updatedAt: now }).where(eq(mfaSecrets.id, f.id));
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, ctx.userId));
    await tx.insert(mfaRecoveryCodes).values(hashes.map((h) => ({ organizationId: ctx.organizationId, userId: ctx.userId, codeHash: h, createdAt: now })));
    if (ctx.sessionId) await tx.update(sessions).set({ mfaVerifiedAt: now }).where(eq(sessions.id, ctx.sessionId));
    await audit(tx, ctx, { action: "identity.mfa.enrolled", entityType: "user", entityId: ctx.userId, entityNumber: ctx.email, siteId: null, after: { recoveryCodes: RECOVERY_CODE_COUNT } });
  });
  return { recoveryCodes: codes };
}

/**
 * Verifies a TOTP code or a recovery code for a user (sign-in step, step-up). Rate limited per user;
 * failures are audited. Returns the method used. Runs in the caller's transaction.
 */
export async function verifySecondFactor(tx: Tx, user: { id: string; organizationId: string; email: string }, code: string, now: Date): Promise<"totp" | "recovery_code"> {
  if (!(await takeToken("mfa_user", user.id, now))) throw new DomainError("validation", "Too many codes tried. Wait 15 minutes and try again.");
  const [f] = await tx.select().from(mfaSecrets).where(eq(mfaSecrets.userId, user.id)).for("update").limit(1);
  if (!f?.confirmedAt) throw new DomainError("state", "Two-step sign-in is not set up for this account.");
  const clean = code.trim().toUpperCase();
  if (/^\d{6}$/.test(clean)) {
    const step = verifyTotp(decryptSecret(f.secretEnc, f.keyId), clean, now, f.lastUsedStep);
    if (step !== null) {
      await tx.update(mfaSecrets).set({ lastUsedStep: step, lastUsedAt: now, updatedAt: now }).where(eq(mfaSecrets.id, f.id));
      return "totp";
    }
  } else if (/^[0-9A-F]{4}-?[0-9A-F]{4}-?[0-9A-F]{4}-?[0-9A-F]{4}$/.test(clean)) {
    const normalized = clean.replace(/-/g, "").replace(/(.{4})(?=.)/g, "$1-");
    const unused = await tx.select().from(mfaRecoveryCodes).where(and(eq(mfaRecoveryCodes.userId, user.id), isNull(mfaRecoveryCodes.usedAt)));
    for (const r of unused) {
      if (await verifyPassword(r.codeHash, normalized)) {
        await tx.update(mfaRecoveryCodes).set({ usedAt: now }).where(eq(mfaRecoveryCodes.id, r.id));
        return "recovery_code";
      }
    }
  }
  await db.insert(auditEvents).values({
    organizationId: user.organizationId,
    actorId: user.id,
    action: "identity.mfa.failed",
    entityType: "user",
    entityId: user.id,
    entityNumber: user.email,
  });
  throw new DomainError("validation", "That code did not match. Use the newest code from your app, or one of your recovery codes.", { field: "code" });
}

/** Turns off one's own TOTP. Refused while the role requires it (privileged users must keep it). */
export async function disableOwnMfa(ctx: AuthContext, code: string, now: Date = new Date()): Promise<void> {
  await assertStepUp(ctx, "turn off two-step sign-in", now);
  const state = await mfaStateFor(db, ctx.organizationId, ctx.userId, now);
  if (!state.enrolled) throw new DomainError("state", "Two-step sign-in is not set up.");
  if (state.required) throw new DomainError("forbidden", "Your role requires two-step sign-in. Ask an administrator to reset it if you lost your phone.");
  await db.transaction(async (tx) => {
    await verifySecondFactor(tx, { id: ctx.userId, organizationId: ctx.organizationId, email: ctx.email }, code, now);
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, ctx.userId));
    await tx.delete(mfaSecrets).where(eq(mfaSecrets.userId, ctx.userId));
    await audit(tx, ctx, { action: "identity.mfa.disabled", entityType: "user", entityId: ctx.userId, entityNumber: ctx.email, siteId: null });
  });
}

/**
 * Admin reset (identity.mfa.admin, US-1-28 AC2): removes the factor and recovery codes, signs the user
 * out everywhere and notifies them; they enrol again at next sign-in. Never on one's own account.
 */
export async function adminResetMfa(ctx: AuthContext, userId: string, reason: string, now: Date = new Date()): Promise<void> {
  ctx.require("identity.mfa.admin");
  const why = requireReason(reason);
  await assertUserVisible(ctx, userId);
  if (userId === ctx.userId) throw new DomainError("forbidden", "You cannot reset your own two-step sign-in. Ask another administrator.");
  await assertStepUp(ctx, "reset two-step sign-in", now);
  await db.transaction(async (tx) => {
    const [u] = await tx.select({ id: users.id, email: users.email }).from(users).where(and(eq(users.id, userId), eq(users.organizationId, ctx.organizationId))).limit(1);
    if (!u) throw new DomainError("not_found", "User not found.");
    const [f] = await tx.select({ id: mfaSecrets.id }).from(mfaSecrets).where(eq(mfaSecrets.userId, u.id)).limit(1);
    if (!f) throw new DomainError("state", "This user has no two-step sign-in to reset.");
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, u.id));
    await tx.delete(mfaSecrets).where(eq(mfaSecrets.userId, u.id));
    const revoked = await revokeUserSessions(tx, u.id, { by: ctx.userId, reason: "two-step sign-in reset", now });
    await audit(tx, ctx, { action: "identity.mfa.reset", entityType: "user", entityId: u.id, entityNumber: u.email, siteId: null, reason: why, after: { revokedSessions: revoked.length } });
  });
  await notifyUser(ctx.organizationId, userId, "identity.mfa_reset", "Your two-step sign-in was reset", "An administrator reset your two-step sign-in and signed you out. Set it up again after you sign in.");
}


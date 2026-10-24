import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { verifyPassword } from "@/lib/auth/password";
import { DomainError } from "@/lib/errors";
import { assertStepUp, mfaStateFor } from "@/modules/identity";

/**
 * Re-authentication for restricted (R) actions (docs/permissions-matrix.md §2.12, docs/security.md §3.6),
 * one rule for every restricted change (settings, approval rules, numbering, bulk disposition):
 *
 * 1. Inside W2E's step-up window (`sessions.reauthenticated_at` within identity.reauth_window_minutes,
 *    and the TOTP code when the user is enrolled) the change passes without a password: the person
 *    already confirmed it's them ("Confirm it's you" card, src/app/(app)/account/reauth.tsx).
 * 2. Otherwise the password typed in the form is checked (fallback for people without two-step
 *    sign-in). A wrong password writes `identity.reauth.failed` in its own transaction and returns
 *    `reauth_required`.
 * 3. A user enrolled in TOTP must use the session step-up: a password alone never skips the code.
 */
export async function requireReauthentication(ctx: AuthContext, password: string | null | undefined, purpose: string): Promise<void> {
  if (ctx.actor.kind !== "user") throw new DomainError("forbidden", "Background jobs cannot perform restricted changes.");
  try {
    await assertStepUp(ctx, "confirm this restricted change");
    return;
  } catch (e) {
    // Overdue TOTP enrolment (forbidden) is final; only a stale window falls through to the password.
    if (!(e instanceof DomainError) || e.code !== "reauth_required") throw e;
  }
  const mfa = await mfaStateFor(db, ctx.organizationId, ctx.userId);
  if (mfa.enrolled) {
    throw new DomainError("reauth_required", "Confirm it's you with your password and the code from your authenticator app (Confirm it's you card), then save again.", { reauth: true, mfa: true });
  }
  if (!password) throw new DomainError("reauth_required", "Enter your password to confirm this restricted change.", { field: "password" });
  const [u] = await db.select({ hash: users.passwordHash, status: users.status }).from(users).where(eq(users.id, ctx.userId)).limit(1);
  const ok = !!u && u.status === "active" && !!u.hash && (await verifyPassword(u.hash, password).catch(() => false));
  if (!ok) {
    await audit(db, ctx, { action: "identity.reauth.failed", entityType: "user", entityId: ctx.userId, siteId: null, after: { purpose } });
    throw new DomainError("reauth_required", "The password is not correct. The change was not saved.", { field: "password" });
  }
}

/**
 * `identity.authorization.denied` for a refused privileged decision, written outside the caller's
 * transaction so the evidence survives the rollback of the refused command.
 */
export async function auditDenied(ctx: AuthContext, e: { permission: string; entityType: string; entityId: string; siteId?: string | null; rule: string }) {
  await audit(db, ctx, { action: "identity.authorization.denied", entityType: e.entityType, entityId: e.entityId, siteId: e.siteId ?? null, reason: e.rule, after: { permission: e.permission, rule: e.rule } });
}

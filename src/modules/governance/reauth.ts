import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { verifyPassword } from "@/lib/auth/password";
import { DomainError } from "@/lib/errors";

/**
 * Re-authentication for restricted (R) actions (docs/permissions-matrix.md §2.12): the user enters
 * their password again in the same form. A wrong password writes `identity.reauth.failed` (in its
 * own transaction, so the refusal is never rolled back) and returns `reauth_required`.
 * Until session-level re-authentication (`sessions.reauthenticated_at`, US-1-10) exists this is
 * the per-action form of it (A-W2F-03).
 */
export async function requireReauthentication(ctx: AuthContext, password: string | null | undefined, purpose: string): Promise<void> {
  if (ctx.actor.kind !== "user") throw new DomainError("forbidden", "Background jobs cannot perform restricted changes.");
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

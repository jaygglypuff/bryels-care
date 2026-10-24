import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { auditEvents, mfaSecrets, rolePermissions, roles, userSiteAssignments, users } from "@/db/schema";
import { activeAssignment } from "@/lib/auth/assignments";
import type { AuthContext } from "@/lib/auth/context";
import { isPrivileged } from "@/lib/auth/sensitivity";
import { isDemoEmail, isDemoMode } from "@/lib/demo";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";

/**
 * Shared identity rules: step-up (re-authentication + TOTP, docs/security.md §3.6, §3.7), denial
 * auditing and owner break-glass detection.
 */

/** Audits a refused privileged attempt outside the (rolled back) transaction: identity.authorization.denied. */
export async function auditDenied(ctx: AuthContext, permission: string, detail: { entityType: string; entityId?: string | null; reason: string; siteId?: string | null }) {
  await db.insert(auditEvents).values({
    organizationId: ctx.organizationId,
    siteId: detail.siteId ?? null,
    actorId: ctx.actor.kind === "user" ? ctx.userId : null,
    actorLabel: ctx.actorLabel,
    action: "identity.authorization.denied",
    entityType: detail.entityType,
    entityId: detail.entityId ?? null,
    reason: detail.reason.slice(0, 500),
    after: { permission },
    correlationId: ctx.correlationId,
  });
}

/** Throws after writing identity.authorization.denied. */
export async function deny(ctx: AuthContext, permission: string, detail: { entityType: string; entityId?: string | null; reason: string; siteId?: string | null }, code: "forbidden" | "not_found" = "forbidden"): Promise<never> {
  await auditDenied(ctx, permission, detail);
  throw new DomainError(code, detail.reason);
}

/** owner_director acting on identity administration without holding system_admin: audited as break-glass. */
export function isOwnerBreakGlass(ctx: AuthContext): boolean {
  return ctx.roleCodes.includes("owner_director") && !ctx.roleCodes.includes("system_admin");
}

export type MfaState = {
  enrolled: boolean;
  pending: boolean;
  required: boolean;
  /** When enrolment becomes mandatory (null = not required or already enrolled). */
  graceEndsAt: Date | null;
  overdue: boolean;
};

/** TOTP state of a user: required for privileged holders after the grace period (A-SEC-13). */
export async function mfaStateFor(q: DbOrTx, organizationId: string, userId: string, now: Date = new Date()): Promise<MfaState> {
  const [factor] = await q.select({ confirmedAt: mfaSecrets.confirmedAt }).from(mfaSecrets).where(eq(mfaSecrets.userId, userId)).limit(1);
  const enrolled = !!factor?.confirmedAt;
  const rows = await q
    .select({ roleCode: roles.code, perm: rolePermissions.permissionCode, validFrom: userSiteAssignments.validFrom })
    .from(userSiteAssignments)
    .innerJoin(roles, eq(roles.id, userSiteAssignments.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(and(eq(userSiteAssignments.userId, userId), eq(roles.status, "active"), activeAssignment(now)))
    .orderBy(asc(userSiteAssignments.validFrom));
  const privilegedRows = rows.filter((r) => isPrivileged(r.perm ? [r.perm] : [], [r.roleCode]));
  const required = privilegedRows.length > 0;
  if (!required || enrolled) return { enrolled, pending: !!factor && !enrolled, required, graceEndsAt: null, overdue: false };
  // Demo mode (ADR-044): demo accounts are never blocked by the enrolment deadline; enrolling stays possible.
  if (isDemoMode()) {
    const [u] = await q.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (isDemoEmail(u?.email)) return { enrolled, pending: !!factor, required, graceEndsAt: null, overdue: false };
  }
  const graceDays = await getSetting(q, organizationId, "identity.mfa.grace_days");
  const since = privilegedRows[0].validFrom;
  const graceEndsAt = new Date(since.getTime() + graceDays * 86_400_000);
  return { enrolled, pending: !!factor, required, graceEndsAt, overdue: now.getTime() >= graceEndsAt.getTime() };
}

/**
 * Step-up for restricted (R) actions: the session must have re-authenticated within the window
 * (`identity.reauth_window_minutes`, A-SEC-12); a privileged user past the enrolment grace must have
 * enrolled TOTP, and an enrolled user's session must have passed the TOTP step. Jobs never step up.
 */
export async function assertStepUp(ctx: AuthContext, purpose: string, now: Date = new Date()): Promise<void> {
  if (ctx.actor.kind !== "user") throw new DomainError("forbidden", "Background jobs cannot perform identity administration.");
  const s = ctx.session;
  const windowMin = await getSetting(db, ctx.organizationId, "identity.reauth_window_minutes");
  if (!s || !s.reauthenticatedAt || now.getTime() - s.reauthenticatedAt.getTime() > windowMin * 60_000) {
    throw new DomainError("reauth_required", `Confirm your password to ${purpose}. This keeps restricted changes safe if a device is left signed in.`, { reauth: true });
  }
  const mfa = await mfaStateFor(db, ctx.organizationId, ctx.userId, now);
  if (mfa.enrolled && !s.mfaVerifiedAt) {
    throw new DomainError("reauth_required", "Enter the code from your authenticator app to continue.", { reauth: true, mfa: true });
  }
  if (mfa.overdue) {
    throw new DomainError("forbidden", "Set up two-step sign-in on your account page before making restricted changes. Your role requires it.", { mfaEnrolmentRequired: true });
  }
}

/** For screens: whether a restricted form will pass step-up now, and what the confirm card must ask for. */
export async function stepUpStatus(ctx: AuthContext, now: Date = new Date()): Promise<{ ready: boolean; reauthFresh: boolean; needsCode: boolean; mfa: MfaState }> {
  const mfa = await mfaStateFor(db, ctx.organizationId, ctx.userId, now);
  const windowMin = await getSetting(db, ctx.organizationId, "identity.reauth_window_minutes");
  const at = ctx.session?.reauthenticatedAt;
  const reauthFresh = !!at && now.getTime() - at.getTime() <= windowMin * 60_000 && (!mfa.enrolled || !!ctx.session?.mfaVerifiedAt);
  try {
    await assertStepUp(ctx, "continue", now);
    return { ready: true, reauthFresh, needsCode: mfa.enrolled, mfa };
  } catch {
    return { ready: false, reauthFresh, needsCode: mfa.enrolled, mfa };
  }
}

/** Organization-local midnight of a yyyy-mm-dd date (assignment validity, US-1-18). */
export function orgMidnight(date: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const asLocal = new Date(new Date(utcGuess).toLocaleString("en-US", { timeZone }));
  const asUtc = new Date(new Date(utcGuess).toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(utcGuess - (asLocal.getTime() - asUtc.getTime()));
}

/** A mandatory reason (5-300 characters), refused as a field validation error. */
export function requireReason(reason: unknown, field = "reason"): string {
  const s = typeof reason === "string" ? reason.trim() : "";
  if (s.length < 5) throw new DomainError("validation", "Give a short reason (at least 5 characters).", { field });
  if (s.length > 300) throw new DomainError("validation", "Keep the reason under 300 characters.", { field });
  return s;
}


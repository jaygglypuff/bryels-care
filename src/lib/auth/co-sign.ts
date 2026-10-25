import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, users } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { type AuthContext, buildContextForUser } from "./context";
import { verifyPassword } from "./password";

/** Failed co-signatures count towards the same lock-out as failed sign-ins (sign-in action). */
const MAX_FAILURES = 5;

export type CoSignInput = {
  /** The person signing (chosen on the device from the eligible list). */
  userId: string;
  /** Their own password, typed by them on the operator's device. */
  password: string;
  /** What they sign as, for the audit trail: checker, exception approver. */
  role: "checker" | "exception_approver";
  /** Permission they must hold at the record's site. */
  permission: Permission;
  siteId: string;
};

/**
 * Second-person signature on a shared device (W05 "checker signs on device"; US-3-09 AC1,
 * US-3-10 AC2/AC3). The operator's session can never sign as checker: the checker proves who they
 * are with their own password, and gets an AuthContext of their own (their current permissions and
 * sites) that the service then uses exactly like a signed-in session. Refused when the signer is the
 * signed-in operator (unless the owner override applies, ADR-073), inactive, locked, outside the site, or lacks the permission.
 *
 * This is a re-authentication of the second person, not a session: nothing is stored on the device.
 * Failures are audited and lock the account after MAX_FAILURES like the sign-in page.
 */
export async function coSign(operator: AuthContext, input: CoSignInput): Promise<AuthContext> {
  const what = input.role === "checker" ? "checker" : "approver";
  if (!input.userId) throw new DomainError("validation", `Choose the ${what}.`, { field: "checkerId" });
  operator.assertSeparation(input.userId === operator.userId, `You cannot sign as ${what} for your own work. The ${what} signs with their own password, or checks from their own device.`);
  if (!input.password) throw new DomainError("validation", `The ${what} must type their own password to sign.`, { field: "checkerPassword" });
  const [u] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!u || u.organizationId !== operator.organizationId) throw new DomainError("validation", `The selected ${what} was not found.`, { field: "checkerId" });
  if (u.status === "locked") throw new DomainError("forbidden", `${u.displayName}'s account is locked. Ask a system administrator to unlock it.`);
  if (u.status !== "active") throw new DomainError("validation", `${u.displayName} cannot sign (account not active).`, { field: "checkerId" });
  const ok = await verifyPassword(u.passwordHash, input.password);
  if (!ok) {
    const failures = u.failedLoginCount + 1;
    await db
      .update(users)
      .set({ failedLoginCount: failures, status: failures >= MAX_FAILURES ? "locked" : u.status })
      .where(eq(users.id, u.id));
    await db.insert(auditEvents).values({
      organizationId: u.organizationId,
      siteId: input.siteId,
      actorId: operator.userId,
      action: "identity.co_signature.failed",
      entityType: "user",
      entityId: u.id,
      entityNumber: u.email,
      after: { role: input.role, signer: u.displayName },
    });
    throw new DomainError("validation", `Password for ${u.displayName} is incorrect.`, { field: "checkerPassword" });
  }
  if (u.failedLoginCount > 0) await db.update(users).set({ failedLoginCount: 0 }).where(eq(users.id, u.id));
  // ADR-073: the owner override let the owner sign for their own work (password re-typed above); the
  // operator's context carries the override record, so it signs too.
  if (u.id === operator.userId) return operator;
  const signer = await buildContextForUser(u.id, input.siteId, { correlationId: operator.correlationId });
  if (!signer || !signer.allowedSiteIds.includes(input.siteId)) {
    throw new DomainError("validation", `${u.displayName} is not assigned to this site and cannot sign here.`, { field: "checkerId" });
  }
  if (!signer.can(input.permission)) {
    throw new DomainError("validation", `${u.displayName} is not authorized to sign as ${what} here (${input.permission}).`, { field: "checkerId" });
  }
  return signer;
}

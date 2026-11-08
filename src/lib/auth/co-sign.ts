import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, users } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import type { Permission } from "@/lib/permissions";
import { type AuthContext, buildContextForUser } from "./context";
import { verifyPassword } from "./password";

/** Failed co-signatures count towards the same lock-out as failed sign-ins (sign-in action). */
const MAX_FAILURES = 5;

export type CoSignInput = {
  /** The person signing (chosen on the device from the eligible list). */
  userId: string;
  /** Their own password, typed by them on the operator's device. Always required (ADR-130). */
  password: string;
  /** What they sign as, for the audit trail: checker, exception approver. */
  role: "checker" | "exception_approver";
  /** Permission they must hold at the record's site. */
  permission: Permission;
  siteId: string;
};

/**
 * Second-person signature on the operator's device (ADR-030 as restored by ADR-130).
 *
 * A name alone never signs: round 5 audit bug B1 showed the operator could tap the checker's name and record
 * "checked by Jun" on her own phone. The checker therefore either checks from their own signed-in phone (their
 * list "Waiting for you to check"; no coSign at all), or — only while `production.sign_off.same_device` is on —
 * types their OWN password here. The returned AuthContext is the checker's (their own permissions and sites) and
 * is marked `coSigned`, so services record `signedOn: "operator_device"` from the context, not from the form.
 *
 * Refused when: the setting is off; no password; a wrong password (audited, counts towards the lock-out); the
 * signer is the signed-in operator (unless the owner override applies, ADR-073); inactive, locked, outside the
 * site, or without the permission. Nothing is stored on the device; no session is created.
 */
export async function coSign(operator: AuthContext, input: CoSignInput): Promise<AuthContext> {
  const what = input.role === "checker" ? "checker" : "approver";
  if (!input.userId) throw new DomainError("validation", `Choose the ${what}.`, { field: "checkerId" });
  operator.assertSeparation(input.userId === operator.userId, `You cannot sign as ${what} for your own work. The ${what} checks on their own phone.`);
  const sameDevice = await getSetting(db, operator.organizationId, "production.sign_off.same_device");
  if (!sameDevice) {
    throw new DomainError("validation", `The ${what} checks on their own phone. It is on their list "Waiting for you to check".`, { field: "checkerId", code: "CHECK_ON_OWN_PHONE" });
  }
  const [u] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!u || u.organizationId !== operator.organizationId) throw new DomainError("validation", `The selected ${what} was not found.`, { field: "checkerId" });
  if (u.status === "locked") throw new DomainError("forbidden", `${u.displayName}'s account is locked. Ask a system administrator to unlock it.`);
  if (u.status !== "active") throw new DomainError("validation", `${u.displayName} cannot sign (account not active).`, { field: "checkerId" });
  if (!input.password) {
    throw new DomainError("validation", `${u.displayName} types their own password to sign here, or checks on their own phone.`, { field: "checkerPassword", fieldErrors: { checkerPassword: "Their own password." } });
  }
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
    throw new DomainError("validation", `Password for ${u.displayName} is incorrect.`, { field: "checkerPassword", fieldErrors: { checkerPassword: "Wrong password." } });
  }
  if (u.failedLoginCount > 0) await db.update(users).set({ failedLoginCount: 0 }).where(eq(users.id, u.id));
  // ADR-073: the owner override let the owner sign for their own work (password re-typed above); the
  // operator's context carries the override record, so it signs too.
  if (u.id === operator.userId) return operator;
  const signer = await buildContextForUser(u.id, input.siteId, {
    correlationId: operator.correlationId,
    coSigned: { operatorUserId: operator.userId, operatorSessionId: operator.sessionId, via: "password" },
  });
  if (!signer || !signer.allowedSiteIds.includes(input.siteId)) {
    throw new DomainError("validation", `${u.displayName} is not assigned to this site and cannot sign here.`, { field: "checkerId" });
  }
  if (!signer.can(input.permission)) {
    throw new DomainError("validation", `${u.displayName} is not allowed to sign as ${what} here.`, { field: "checkerId" });
  }
  await db.insert(auditEvents).values({
    organizationId: u.organizationId,
    siteId: input.siteId,
    actorId: operator.userId,
    action: "identity.co_signature.password",
    entityType: "user",
    entityId: u.id,
    entityNumber: u.email,
    after: { role: input.role, signer: u.displayName, enteredOnDeviceOf: operator.displayName, sessionId: operator.sessionId },
  });
  return signer;
}

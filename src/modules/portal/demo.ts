import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { customerPortalTenants, customers, portalUsers } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { DEMO_EMAIL_DOMAIN, DEMO_PASSWORD, isDemoEmail, isDemoMode } from "@/lib/demo";
import { DomainError } from "@/lib/errors";
import { PORTAL_ROLE_BUNDLES, isPortalRole } from "./capabilities";
import { type PortalSignInResult, signInPortal } from "./auth";
import { portalActor, portalAudit } from "./support";

/**
 * Demo portal accounts (ADR-055 rules applied to the portal): listed and signed in with one click
 * only in demo mode and only for demo addresses (@bryels-care.test). The one-click path is the real
 * password path with the published demo password, so lockout, TOTP, rate limits, session and audit
 * rules are the same as typing it in. Listed on the staff sign-in page as the "Customer portal" group
 * (links to /portal/sign-in) and on the portal sign-in page itself.
 */
export type PortalDemoAccount = { email: string; displayName: string; customerName: string; roleName: string };

export async function listPortalDemoAccounts(): Promise<PortalDemoAccount[] | null> {
  if (!isDemoMode()) return null;
  const rows = await db
    .select({ email: portalUsers.email, displayName: portalUsers.displayName, role: portalUsers.portalRole, customerName: customers.name })
    .from(portalUsers)
    .innerJoin(customerPortalTenants, eq(customerPortalTenants.id, portalUsers.tenantId))
    .innerJoin(customers, eq(customers.id, customerPortalTenants.customerId))
    .where(and(eq(portalUsers.status, "active"), eq(customerPortalTenants.status, "active"), sql`lower(${portalUsers.email}) like ${"%@" + DEMO_EMAIL_DOMAIN}`))
    .orderBy(asc(customers.name), asc(portalUsers.displayName));
  return rows.map((r) => ({ email: r.email, displayName: r.displayName, customerName: r.customerName, roleName: isPortalRole(r.role) ? PORTAL_ROLE_BUNDLES[r.role].name : r.role }));
}

export async function signInPortalAsDemo(input: { email: string; ip?: string | null; userAgent?: string | null }, now: Date = new Date()): Promise<PortalSignInResult> {
  if (!isDemoMode()) throw new DomainError("forbidden", "One-click sign-in exists only in the demo environment.");
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!isDemoEmail(email)) throw new DomainError("forbidden", `Only demo portal accounts (@${DEMO_EMAIL_DOMAIN}) can use one-click sign-in.`);
  const [u] = await db.select().from(portalUsers).where(sql`lower(${portalUsers.email}) = ${email}`).limit(1);
  if (!u || u.status !== "active") throw new DomainError("not_found", "This demo portal account is not available. Ask the owner to reset the demo data.");
  // A changed password is refused without counting a failed attempt (no lockout from clicking).
  if (!u.passwordHash.startsWith("$argon2") || !(await verifyPassword(u.passwordHash, DEMO_PASSWORD))) {
    return { kind: "failed", message: "Someone changed this demo account's password, so one-click sign-in no longer works for it. Use the form, or ask the owner to reset the demo data." };
  }
  const r = await signInPortal({ email, password: DEMO_PASSWORD, ip: input.ip, userAgent: input.userAgent }, now);
  if (r.kind !== "failed") await portalAudit(db, { organizationId: u.organizationId, actorLabel: portalActor(u.id), action: "sales.portal_user.demo_sign_in", entityType: "portal_user", entityId: u.id, entityNumber: u.email, after: { sessionId: r.session.id, mfaStep: r.kind === "mfa" } });
  return r;
}

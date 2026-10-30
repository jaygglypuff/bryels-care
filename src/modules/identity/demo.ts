import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, roles, sites, userSiteAssignments, users } from "@/db/schema";
import { activeAssignment } from "@/lib/auth/assignments";
import { verifyPassword } from "@/lib/auth/password";
import { DEMO_EMAIL_DOMAIN, DEMO_PASSWORD, DEMO_SYSTEM_EMAIL, SANDBOX_EMAIL_PREFIX, isDemoEmail, isDemoMode } from "@/lib/demo";
import { DomainError } from "@/lib/errors";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { type SignInResult, signInWithPassword } from "./sign-in";

/**
 * Demo accounts on the sign-in page (ADR-055): the "Try the demo" list and the one-click sign-in.
 * Both exist only in demo mode (src/lib/demo.ts) and only for demo addresses (@bryels-care.test).
 * The one-click sign-in uses the real password path with the published demo password, so lockout,
 * TOTP, session and audit rules are the same as typing it into the form.
 */

/** Display order of the role groups (permissions matrix order); unknown/custom roles go last. */
const ROLE_ORDER = ["owner_director", "system_admin", "site_manager", "production_planner", "production_operator", "qa_qc", "warehouse_operator", "procurement", "sales_cs", "finance", "auditor", "floor_display"];
const rank = (code: string) => {
  const i = ROLE_ORDER.indexOf(code);
  return i === -1 ? ROLE_ORDER.length : i;
};

export type DemoAccount = { email: string; displayName: string; roles: string[]; scope: string };
export type DemoAccountGroup = { roleCode: string; roleName: string; accounts: DemoAccount[] };

/** Active demo accounts of the fictional demo company, grouped by main role; null when demo mode is off. */
export async function listDemoAccounts(now: Date = new Date()): Promise<DemoAccountGroup[] | null> {
  return listAccounts("demo", now);
}

/** Accounts of the empty sandbox company (ADR-072, `sandbox.*@bryels-care.test`); null when demo mode is off. */
export async function listSandboxAccounts(now: Date = new Date()): Promise<DemoAccountGroup[] | null> {
  return listAccounts("sandbox", now);
}

async function listAccounts(which: "demo" | "sandbox", now: Date): Promise<DemoAccountGroup[] | null> {
  if (!isDemoMode()) return null;
  const prefix = sql`lower(${users.email}) like ${SANDBOX_EMAIL_PREFIX + "%"}`;
  const rows = await db
    .select({ email: users.email, displayName: users.displayName, roleCode: roles.code, roleName: roles.name, orgWide: userSiteAssignments.isOrganizationWide, siteCode: sites.code })
    .from(users)
    .innerJoin(userSiteAssignments, eq(userSiteAssignments.userId, users.id))
    .innerJoin(roles, eq(roles.id, userSiteAssignments.roleId))
    .leftJoin(sites, eq(sites.id, userSiteAssignments.siteId))
    .where(and(eq(users.status, "active"), eq(roles.status, "active"), sql`lower(${users.email}) like ${"%@" + DEMO_EMAIL_DOMAIN}`, which === "sandbox" ? prefix : sql`not (${prefix})`, activeAssignment(now)));
  const byUser = new Map<string, { email: string; displayName: string; roles: Map<string, string>; orgWide: boolean; sites: Set<string> }>();
  for (const r of rows) {
    const u = byUser.get(r.email) ?? { email: r.email, displayName: r.displayName, roles: new Map(), orgWide: false, sites: new Set<string>() };
    u.roles.set(r.roleCode, ROLE_BUNDLES[r.roleCode]?.name ?? r.roleName);
    if (r.orgWide) u.orgWide = true;
    if (r.siteCode) u.sites.add(r.siteCode);
    byUser.set(r.email, u);
  }
  const groups = new Map<string, DemoAccountGroup>();
  for (const u of byUser.values()) {
    const codes = [...u.roles.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const main = codes[0];
    const g = groups.get(main) ?? { roleCode: main, roleName: u.roles.get(main)!, accounts: [] };
    g.accounts.push({ email: u.email, displayName: u.displayName, roles: codes.map((c) => u.roles.get(c)!), scope: u.orgWide ? "All sites" : [...u.sites].sort().join(", ") });
    groups.set(main, g);
  }
  return [...groups.values()]
    .sort((a, b) => rank(a.roleCode) - rank(b.roleCode) || a.roleName.localeCompare(b.roleName))
    .map((g) => ({ ...g, accounts: g.accounts.sort((a, b) => a.displayName.localeCompare(b.displayName)) }));
}

/**
 * One-click "Sign in as …" (demo mode only, demo accounts only). Checks the stored hash against the
 * demo password first, so a demo account whose password someone changed is refused without counting
 * a failed attempt (no lockout from clicking). Audited as `identity.session.demo_sign_in` in addition
 * to the normal `identity.session.signed_in`.
 */
export async function signInAsDemoAccount(input: { email: string; ip?: string | null; userAgent?: string | null }, now: Date = new Date()): Promise<SignInResult> {
  if (!isDemoMode()) throw new DomainError("forbidden", "One-click sign-in exists only in the demo environment.");
  const email = input.email.trim().toLowerCase();
  if (!isDemoEmail(email) || email === DEMO_SYSTEM_EMAIL) throw new DomainError("forbidden", "Only demo accounts (@" + DEMO_EMAIL_DOMAIN + ") can use one-click sign-in.");
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (!u || u.status !== "active") throw new DomainError("not_found", "This demo account is not available. Ask the owner to reset the demo data.");
  if (!u.passwordHash.startsWith("$argon2") || !(await verifyPassword(u.passwordHash, DEMO_PASSWORD))) {
    return { kind: "failed", message: "Someone changed this demo account's password, so one-click sign-in no longer works for it. Use the form above, or ask the owner to reset the demo data." };
  }
  const r = await signInWithPassword({ email, password: DEMO_PASSWORD, ip: input.ip, userAgent: input.userAgent, deviceClass: "standard" }, now);
  if (r.kind !== "failed") {
    await db.insert(auditEvents).values({ organizationId: u.organizationId, actorId: u.id, action: "identity.session.demo_sign_in", entityType: "user", entityId: u.id, entityNumber: u.email, after: { method: "demo_one_click", sessionId: r.session.id, mfaStep: r.kind === "mfa" } });
  }
  return r;
}

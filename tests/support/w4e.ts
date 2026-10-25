import { and, desc, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { customerPortalTenants, customers, emailOutbox, portalUsers } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { buildPortalContext, signInPortal, type PortalAuthContext } from "@/modules/portal";
import { asUser, loadKit, type Kit } from "./kit";

/** Fixtures for the Wave 4 W4E customer portal tests (fictional seed data; portal accounts use demo1234). */
export type W4e = Kit & {
  /** sales_cs at NFD and RVS with a fresh step-up (re-authenticated now). */
  sales: AuthContext;
  /** The same person without step-up. */
  salesNoReauth: AuthContext;
  /** sales_cs at RVS only (the seeded tenants are fulfilled by NFD). */
  salesRvs: AuthContext;
  /** Portal-user administrator (site_manager, ADR-071) at NFD and RVS with a fresh step-up. */
  portalAdmin: AuthContext;
  /** The same person without step-up. */
  portalAdminNoReauth: AuthContext;
  /** site_manager at RVS only (the seeded tenants are fulfilled by NFD). */
  portalAdminRvs: AuthContext;
  warehouse: AuthContext;
  auditor: AuthContext;
  owner: AuthContext;
  admin: AuthContext;
  mabuhayId: string;
  salonId: string;
  mabuhayTenantId: string;
  salonTenantId: string;
};

const fresh = () => ({ session: { id: uuidv7(), reauthenticatedAt: new Date(), mfaVerifiedAt: null, privileged: true } });

export async function loadW4e(): Promise<W4e> {
  const kit = await loadKit();
  const both = [kit.nfd, kit.rvs];
  const cust = async (code: string) => (await db.select().from(customers).where(eq(customers.code, code)))[0].id;
  const mabuhayId = await cust("CUS-003");
  const salonId = await cust("CUS-006");
  const tenant = async (customerId: string) => (await db.select().from(customerPortalTenants).where(eq(customerPortalTenants.customerId, customerId)))[0].id;
  return {
    ...kit,
    sales: await asUser(kit, "sales@bryels-care.test", "sales_cs", both, fresh()),
    salesNoReauth: await asUser(kit, "sales@bryels-care.test", "sales_cs", both, { session: { id: uuidv7(), reauthenticatedAt: null, mfaVerifiedAt: null, privileged: true } }),
    salesRvs: await asUser(kit, "sales2@bryels-care.test", "sales_cs", [kit.rvs], fresh()),
    portalAdmin: await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", both, fresh()),
    portalAdminNoReauth: await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", both, { session: { id: uuidv7(), reauthenticatedAt: null, mfaVerifiedAt: null, privileged: true } }),
    portalAdminRvs: await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.rvs], fresh()),
    warehouse: await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd], fresh()),
    auditor: await asUser(kit, "auditor@bryels-care.test", "auditor", both, fresh()),
    owner: await asUser(kit, "owner@bryels-care.test", "owner_director", both, fresh()),
    admin: await asUser(kit, "admin@bryels-care.test", "system_admin", both, fresh()),
    mabuhayId,
    salonId,
    mabuhayTenantId: await tenant(mabuhayId),
    salonTenantId: await tenant(salonId),
  };
}

let ipSeq = 0;
/** A distinct fake client IP per call, so the per-IP portal limit does not couple tests. */
export const nextIp = () => `10.44.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

/** Signs a portal user in with the password and returns the cookie token and the context. */
export async function portalSignIn(email: string, password = "demo1234"): Promise<{ token: string; ctx: PortalAuthContext }> {
  const r = await signInPortal({ email, password, ip: nextIp(), userAgent: "vitest" });
  if (r.kind !== "ok") throw new Error(`portal sign-in failed for ${email}: ${r.kind === "failed" ? r.message : r.kind}`);
  const ctx = await buildPortalContext(r.token);
  if (!ctx) throw new Error(`no portal context for ${email}`);
  return { token: r.token, ctx };
}

export async function portalUserByEmail(email: string) {
  const [u] = await db.select().from(portalUsers).where(eq(portalUsers.email, email));
  return u;
}

/** The token from the newest captured portal invitation to `to` (EMAIL_PROVIDER=outbox). */
export async function lastPortalLinkToken(to: string): Promise<string> {
  const [m] = await db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.toAddress, to), eq(emailOutbox.template, "portal.invitation")))
    .orderBy(desc(emailOutbox.createdAt))
    .limit(1);
  const match = m?.bodyText?.match(/\/portal\/invite#token=([A-Za-z0-9_-]{43})/);
  if (!match) throw new Error(`no portal link mailed to ${to}`);
  return match[1];
}

/** Accepts the newest invitation of `email` with `password` and signs in. */
export async function acceptAndSignIn(email: string, password: string) {
  const { acceptPortalInvitation } = await import("@/modules/portal");
  await acceptPortalInvitation({ token: await lastPortalLinkToken(email), password, ip: nextIp() });
  return portalSignIn(email, password);
}

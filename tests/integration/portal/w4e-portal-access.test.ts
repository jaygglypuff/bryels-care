/**
 * US-8-01 portal tenants, users, sessions and invitations with a separate boundary (W4E).
 * Tests: portal.auth.lockout, portal.ratelimit, portal invitation (tenant bound, single use, expiry),
 * sessions (idle 30 min, absolute 24 h, revocation, suspension), optional TOTP, the staff "Portal access"
 * services (permissions, step-up, site scope, state machines, audit) and the boundary itself
 * (PortalAuthContext never satisfies an internal permission; the staff session never opens the portal).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, customerPortalTenants, portalInvitations, portalSessions, portalUsers, sessions } from "@/db/schema";
import { stepAt, totpAt } from "@/lib/auth/totp";
import { validateSessionToken } from "@/lib/auth/session-store";
import { listOrders } from "@/modules/sales";
import {
  PortalAuthContext,
  acceptPortalInvitation,
  beginPortalTotp,
  buildPortalContext,
  changePortalPassword,
  changePortalUser,
  completePortalMfa,
  confirmPortalTotp,
  enablePortal,
  getPortalAccess,
  inspectPortalInvitation,
  invitePortalUser,
  resendPortalInvitation,
  setPortalTenantStatus,
  signInPortal,
  signOutPortal,
  canPortalUserTransition,
  PORTAL_USER_TRANSITIONS,
} from "@/modules/portal";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { setOrgSetting, clearOrgSetting } from "../../support/w3d";
import { acceptAndSignIn, lastPortalLinkToken, loadW4e, nextIp, portalSignIn, portalUserByEmail, type W4e } from "../../support/w4e";

let w: W4e;
const prevEmail = process.env.EMAIL_PROVIDER;

beforeAll(async () => {
  process.env.EMAIL_PROVIDER = "outbox";
  await resetTestDatabase();
  w = await loadW4e();
});
afterAll(() => {
  process.env.EMAIL_PROVIDER = prevEmail;
});

const auditOf = async (entityId: string, action: string) => db.select().from(auditEvents).where(and(eq(auditEvents.entityId, entityId), eq(auditEvents.action, action)));

describe("US-8-01 separate boundary", () => {
  it("seeded demo portal accounts sign in with their own session table; a portal token is no staff session", async () => {
    const { token, ctx } = await portalSignIn("portal.mabuhay@bryels-care.test");
    expect(ctx).toBeInstanceOf(PortalAuthContext);
    expect(ctx.customerId).toBe(w.mabuhayId);
    expect(ctx.portalRole).toBe("portal_buyer");
    // The cookie value exists only in portal_sessions; the internal session store does not know it.
    expect(await validateSessionToken(token)).toBeNull();
    const [row] = await db.select().from(portalSessions).where(eq(portalSessions.id, ctx.sessionId!));
    expect(row.tenantId).toBe(w.mabuhayTenantId);
    expect((await db.select().from(sessions)).some((s) => s.id === ctx.sessionId)).toBe(false);
  });

  it("authz.portal.not_convertible: a portal context never satisfies an internal permission", async () => {
    const { ctx } = await portalSignIn("portal.mabuhay@bryels-care.test");
    // Even when forced through a cast, internal services refuse (the capability set holds no sales.* string).
    await expectCode(listOrders(ctx as never), "forbidden");
    expect("userId" in ctx).toBe(false);
    expect("allowedSiteIds" in ctx).toBe(false);
    expect(ctx.can("sales.sales_order.view" as never)).toBe(false);
  });

  it("a staff session token never opens the portal", async () => {
    const { createSessionRecord } = await import("@/lib/auth/session-store");
    const staff = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.email, "sales@bryels-care.test") });
    const { token } = await createSessionRecord({ userId: staff!.id });
    expect(await buildPortalContext(token)).toBeNull();
  });
});

describe("portal.auth.lockout and enumeration", () => {
  it("unknown email and wrong password give the same answer", async () => {
    const a = await signInPortal({ email: "nobody.here@bryels-care.test", password: "whatever-123", ip: nextIp() });
    const b = await signInPortal({ email: "portal.salon@bryels-care.test", password: "wrong-password-1", ip: nextIp() });
    expect(a).toEqual({ kind: "failed", message: "Email or password is incorrect." });
    expect(b).toEqual(a);
    // Reset the counter for the next tests.
    await db.update(portalUsers).set({ failedLoginCount: 0 }).where(eq(portalUsers.email, "portal.salon@bryels-care.test"));
  });

  it("5 failed sign-ins lock the account; the right password then says locked; staff unlock restores", async () => {
    const email = "portal.mabuhay.viewer@bryels-care.test";
    for (let i = 0; i < 5; i++) expect((await signInPortal({ email, password: `bad-pass-${i}-xyz`, ip: nextIp() })).kind).toBe("failed");
    const u = await portalUserByEmail(email);
    expect(u.status).toBe("locked");
    expect(await auditOf(u.id, "sales.portal_user.locked")).toHaveLength(1);
    const right = await signInPortal({ email, password: "demo1234", ip: nextIp() });
    expect(right.kind).toBe("failed");
    expect(right.kind === "failed" && right.message).toMatch(/locked/);
    // Staff unlock (sales.portal_user.admin, step-up) goes back to active.
    await expectCode(changePortalUser(w.salesNoReauth, u.id, "unlock"), "reauth_required");
    await changePortalUser(w.sales, u.id, "unlock");
    expect((await portalUserByEmail(email)).status).toBe("active");
    expect((await signInPortal({ email, password: "demo1234", ip: nextIp() })).kind).toBe("ok");
  });

  it("the lockout threshold is a setting", async () => {
    await setOrgSetting(w.orgId, "portal.auth.max_failed_attempts", 3);
    const email = "portal.salon@bryels-care.test";
    for (let i = 0; i < 3; i++) await signInPortal({ email, password: `bad-pass-${i}-abc`, ip: nextIp() });
    expect((await portalUserByEmail(email)).status).toBe("locked");
    await clearOrgSetting(w.orgId, "portal.auth.max_failed_attempts");
    await changePortalUser(w.sales, (await portalUserByEmail(email)).id, "unlock");
  });
});

describe("portal.ratelimit", () => {
  it("unauthenticated portal requests are limited per IP (30 / minute by default)", async () => {
    const ip = "10.99.0.1";
    const results: string[] = [];
    for (let i = 0; i < 31; i++) {
      const r = await signInPortal({ email: "nobody.ratelimit@bryels-care.test", password: "x-not-it-123", ip });
      results.push(r.kind === "failed" && r.retryAfterSeconds ? "limited" : r.kind);
    }
    expect(results.slice(0, 30).every((x) => x === "failed")).toBe(true);
    expect(results[30]).toBe("limited");
    // Another IP is not affected.
    const other = await signInPortal({ email: "nobody.ratelimit@bryels-care.test", password: "x", ip: "10.99.0.2" });
    expect(other.kind === "failed" && other.retryAfterSeconds).toBeFalsy();
  });
});

describe("staff Portal access panel: permissions, scope, step-up", () => {
  it("getPortalAccess: sales sees users and catalogue; auditor views; warehouse is refused; RVS-only sales sees it is managed elsewhere", async () => {
    const v = await getPortalAccess(w.sales, w.mabuhayId);
    expect(v.tenant?.status).toBe("active");
    expect(v.users?.map((u) => u.email)).toEqual(expect.arrayContaining(["portal.mabuhay@bryels-care.test", "portal.mabuhay.viewer@bryels-care.test", "portal.newbuyer@bryels-care.test"]));
    expect(v.users?.find((u) => u.email === "portal.salon@bryels-care.test")).toBeUndefined();
    expect(v.catalog?.mode).toBe("customer_price_list");
    const lea = v.users?.find((u) => u.email === "portal.newbuyer@bryels-care.test");
    expect(lea?.status).toBe("invited");
    expect(lea?.openInvitationExpiresAt).toBeInstanceOf(Date);
    expect(v.users?.find((u) => u.email === "portal.mabuhay@bryels-care.test")?.openInvitationExpiresAt).toBeNull();
    const a = await getPortalAccess(w.auditor, w.mabuhayId);
    expect(a.users?.length).toBeGreaterThan(0);
    expect("canAdminUsers" in a && a.canAdminUsers).toBe(false);
    await expectCode(getPortalAccess(w.warehouse, w.mabuhayId), "forbidden");
    const r = await getPortalAccess(w.salesRvs, w.mabuhayId);
    expect(r.outOfScope).toBe(true);
    expect(r.users).toBeNull();
  });

  it("authz.role_escalation: only sales.portal_user.admin at the tenant's site invites, with step-up", async () => {
    const input = { email: "portal.escalation@bryels-care.test", displayName: "Esca Lation", portalRole: "portal_buyer" };
    await expectCode(invitePortalUser(w.warehouse, w.mabuhayTenantId, input), "forbidden");
    await expectCode(invitePortalUser(w.auditor, w.mabuhayTenantId, input), "forbidden");
    await expectCode(invitePortalUser(w.owner, w.mabuhayTenantId, input), "forbidden"); // matrix: OD has no portal_user rights
    await expectCode(invitePortalUser(w.salesRvs, w.mabuhayTenantId, input), "not_found"); // cross-site: the tenant does not exist for RVS
    await expectCode(invitePortalUser(w.salesNoReauth, w.mabuhayTenantId, input), "reauth_required");
    expect(await portalUserByEmail(input.email)).toBeUndefined();
  });

  it("refuses staff addresses, duplicates and (demo mode) non-demo addresses", async () => {
    await expectCode(invitePortalUser(w.sales, w.mabuhayTenantId, { email: "finance@bryels-care.test", displayName: "Rosa Lim", portalRole: "portal_buyer" }), "conflict");
    await expectCode(invitePortalUser(w.sales, w.mabuhayTenantId, { email: "portal.salon@bryels-care.test", displayName: "Carla Dizon", portalRole: "portal_buyer" }), "conflict");
    const prev = process.env.DEMO_MODE;
    process.env.DEMO_MODE = "true";
    try {
      await expectCode(invitePortalUser(w.sales, w.mabuhayTenantId, { email: "real.person@example.com", displayName: "Real Person", portalRole: "portal_buyer" }), "validation");
    } finally {
      process.env.DEMO_MODE = prev;
    }
  });

  it("enablePortal: one tenant per customer, at an allowed site, active customers only, audited", async () => {
    const [isla] = await db.query.customers.findMany({ where: (c, { eq }) => eq(c.code, "CUS-002") });
    await expectCode(enablePortal(w.salesNoReauth, isla.id, { siteId: w.nfd.id }), "reauth_required");
    await expectCode(enablePortal(w.warehouse, isla.id, { siteId: w.nfd.id }), "forbidden");
    await expectCode(enablePortal(w.salesRvs, isla.id, { siteId: w.nfd.id }), "not_found");
    const { tenantId } = await enablePortal(w.sales, isla.id, { siteId: w.rvs.id, catalogMode: "curated" });
    expect((await auditOf(tenantId, "sales.portal_tenant.enabled")).length).toBe(1);
    await expectCode(enablePortal(w.sales, isla.id, { siteId: w.nfd.id }), "conflict");
    const [prospect] = await db.query.customers.findMany({ where: (c, { eq }) => eq(c.code, "CUS-007") });
    await expectCode(enablePortal(w.sales, prospect.id, { siteId: w.nfd.id }), "state");
  });
});

describe("invitation: tenant bound, single use, expiry", () => {
  it("invite → link → accept (password policy) → sign in; the link works once", async () => {
    const email = "portal.invitee@bryels-care.test";
    const out = await invitePortalUser(w.sales, w.mabuhayTenantId, { email, displayName: "Nina Invitee", portalRole: "portal_viewer" });
    expect(out.delivery.status).toBe("captured");
    const u = await portalUserByEmail(email);
    expect(u.status).toBe("invited");
    expect(u.tenantId).toBe(w.mabuhayTenantId);
    expect(await auditOf(u.id, "sales.portal_user.invited")).toHaveLength(1);
    const token = await lastPortalLinkToken(email);
    expect(await inspectPortalInvitation(token)).toMatchObject({ state: "valid", email, customerName: "Mabuhay Pharmacy Group" });
    // The stored row holds only the hash.
    const [inv] = await db.select().from(portalInvitations).where(eq(portalInvitations.portalUserId, u.id));
    expect(inv.tokenHash).not.toContain(token);
    await expectCode(acceptPortalInvitation({ token, password: "short", ip: nextIp() }), "validation");
    const { ctx } = await acceptAndSignIn(email, "a long fictional passphrase 42");
    expect(ctx.customerId).toBe(w.mabuhayId);
    expect(ctx.portalRole).toBe("portal_viewer");
    expect(await inspectPortalInvitation(token)).toEqual({ state: "used" });
    await expectCode(acceptPortalInvitation({ token, password: "another long passphrase 43", ip: nextIp() }), "state");
  });

  it("an expired link is refused; resend replaces the previous link", async () => {
    const email = "portal.late@bryels-care.test";
    await invitePortalUser(w.sales, w.salonTenantId, { email, displayName: "Leo Late", portalRole: "portal_buyer" });
    const first = await lastPortalLinkToken(email);
    const u = await portalUserByEmail(email);
    await db.update(portalInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(portalInvitations.portalUserId, u.id));
    expect(await inspectPortalInvitation(first)).toEqual({ state: "expired" });
    await expectCode(acceptPortalInvitation({ token: first, password: "a long fictional passphrase 44", ip: nextIp() }), "state");
    await resendPortalInvitation(w.sales, u.id);
    const second = await lastPortalLinkToken(email);
    expect(second).not.toBe(first);
    expect(await inspectPortalInvitation(first)).toEqual({ state: "used" });
    const { ctx } = await acceptAndSignIn(email, "a long fictional passphrase 45");
    expect(ctx.customerId).toBe(w.salonId);
  });
});

describe("sessions: idle, absolute, revocation, suspension", () => {
  it("idle 30 minutes and absolute 24 hours by default", async () => {
    const t0 = new Date();
    const r = await signInPortal({ email: "portal.mabuhay@bryels-care.test", password: "demo1234", ip: nextIp() }, t0);
    if (r.kind !== "ok") throw new Error("sign-in");
    expect(r.session.expiresAt.getTime() - t0.getTime()).toBe(24 * 3_600_000);
    expect(r.session.idleExpiresAt.getTime() - t0.getTime()).toBe(30 * 60_000);
    expect(await buildPortalContext(r.token, { now: new Date(t0.getTime() + 20 * 60_000) })).not.toBeNull();
    // Activity slid the idle expiry; 31 minutes of silence after that ends it.
    expect(await buildPortalContext(r.token, { now: new Date(t0.getTime() + 52 * 60_000) })).toBeNull();
    expect(await buildPortalContext(r.token, { now: new Date(t0.getTime() + 25 * 3_600_000) })).toBeNull();
  });

  it("sign-out revokes; suspending a user or the tenant ends sessions at once; reactivation needs a new sign-in", async () => {
    const a = await portalSignIn("portal.mabuhay@bryels-care.test");
    await signOutPortal(a.token);
    expect(await buildPortalContext(a.token)).toBeNull();

    const b = await portalSignIn("portal.mabuhay@bryels-care.test");
    const joy = await portalUserByEmail("portal.mabuhay@bryels-care.test");
    await expectCode(changePortalUser(w.sales, joy.id, "suspend", ""), "validation");
    await changePortalUser(w.sales, joy.id, "suspend", "Left the company (fictional)");
    expect(await buildPortalContext(b.token)).toBeNull();
    expect((await signInPortal({ email: joy.email, password: "demo1234", ip: nextIp() })).kind).toBe("failed");
    await changePortalUser(w.sales, joy.id, "reactivate");
    expect((await portalUserByEmail(joy.email)).status).toBe("active");

    const c = await portalSignIn("portal.mabuhay@bryels-care.test");
    await expectCode(setPortalTenantStatus(w.sales, w.mabuhayTenantId, "suspended", "x"), "validation");
    await setPortalTenantStatus(w.sales, w.mabuhayTenantId, "suspended", "Contract under review (fictional)");
    expect(await buildPortalContext(c.token)).toBeNull();
    const refused = await signInPortal({ email: joy.email, password: "demo1234", ip: nextIp() });
    expect(refused.kind === "failed" && refused.message).toMatch(/paused/);
    await expectCode(setPortalTenantStatus(w.sales, w.mabuhayTenantId, "suspended", "again please"), "state");
    await setPortalTenantStatus(w.sales, w.mabuhayTenantId, "active", "Contract renewed (fictional)");
    const [t] = await db.select().from(customerPortalTenants).where(eq(customerPortalTenants.id, w.mabuhayTenantId));
    expect(t.status).toBe("active");
    expect((await auditOf(w.mabuhayTenantId, "sales.portal_tenant.suspended")).length).toBe(1);
  });

  it("statemachine.portal_user: the transition table", () => {
    expect(canPortalUserTransition("invited", "active")).toBe(true);
    expect(canPortalUserTransition("active", "invited")).toBe(false);
    expect(canPortalUserTransition("locked", "active")).toBe(true);
    for (const to of Object.values(PORTAL_USER_TRANSITIONS).flat()) expect(Object.keys(PORTAL_USER_TRANSITIONS)).toContain(to);
  });

  it("changing the own password signs other portal sessions out", async () => {
    const email = "portal.invitee@bryels-care.test";
    const a = await portalSignIn(email, "a long fictional passphrase 42");
    const b = await portalSignIn(email, "a long fictional passphrase 42");
    await expectCode(changePortalPassword(b.ctx, { currentPassword: "wrong", newPassword: "another fine passphrase 77" }), "validation");
    await changePortalPassword(b.ctx, { currentPassword: "a long fictional passphrase 42", newPassword: "another fine passphrase 77" });
    expect(await buildPortalContext(a.token)).toBeNull();
    expect(await buildPortalContext(b.token)).not.toBeNull();
  });
});

describe("optional TOTP for portal users", () => {
  it("enrol with password + code; sign-in then needs the code; a reused code is refused; staff can reset it", async () => {
    const email = "portal.invitee@bryels-care.test";
    const { ctx } = await portalSignIn(email, "another fine passphrase 77");
    await expectCode(beginPortalTotp(ctx, "wrong password"), "validation");
    const { secret } = await beginPortalTotp(ctx, "another fine passphrase 77");
    const now = new Date();
    await expectCode(confirmPortalTotp(ctx, "000000"), "validation");
    await confirmPortalTotp(ctx, totpAt(secret, stepAt(now)), now);
    const r = await signInPortal({ email, password: "another fine passphrase 77", ip: nextIp() });
    expect(r.kind).toBe("mfa");
    if (r.kind !== "mfa") return;
    // A pending session authorizes nothing.
    expect(await buildPortalContext(r.pendingToken)).toBeNull();
    await expectCode(completePortalMfa(r.pendingToken, totpAt(secret, stepAt(now))), "validation"); // same step as enrolment: replay
    const later = new Date(now.getTime() + 30_000);
    const out = await completePortalMfa(r.pendingToken, totpAt(secret, stepAt(later)), later);
    expect(await buildPortalContext(out.token, { now: later })).not.toBeNull();
    const u = await portalUserByEmail(email);
    await changePortalUser(w.sales, u.id, "reset_mfa", "Lost phone (fictional)");
    expect((await portalUserByEmail(email)).totpConfirmedAt).toBeNull();
    expect(await buildPortalContext(out.token, { now: later })).toBeNull();
    expect((await signInPortal({ email, password: "another fine passphrase 77", ip: nextIp() })).kind).toBe("ok");
  });
});

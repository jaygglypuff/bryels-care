/**
 * W2E US-1-11 (invitation acceptance, password reset) and US-1-16 AC1 (invite).
 * Test ids: auth.reset.single_use, auth.reset.expiry, auth.reset.revokes_sessions, auth.reset.token_bound,
 * auth.enumeration.reset, identity.invitation.*, authz.role_escalation.missing_permission (identity).
 */
import { and, eq, isNull, like } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvents, emailOutbox, invitations, passwordResetTokens, sessions, userSiteAssignments, users } from "@/db/schema";
import { buildContextForUser } from "@/lib/auth/context";
import { validateSessionToken } from "@/lib/auth/session-store";
import {
  acceptInvitation,
  changeOwnPassword,
  completePasswordReset,
  inspectInvitation,
  inspectResetToken,
  inviteUser,
  requestPasswordReset,
  resendInvitation,
  revokeInvitation,
  signInWithPassword,
} from "@/modules/identity";
import { resetTestDatabase } from "../../support/db";
import { GOOD_PASSWORD, customCtx, expectCode, idKit, lastLinkToken, roleId, signedIn, userByEmail } from "./helpers";

process.env.EMAIL_PROVIDER = "outbox";

let k: Awaited<ReturnType<typeof idKit>>;

beforeAll(async () => {
  await resetTestDatabase();
  k = await idKit();
}, 180_000);

describe("US-1-16 AC1 / US-1-11 AC1 invitation", () => {
  it("invites a person: invited user, assignments, invitation and email in one go; acceptance activates once", async () => {
    const admin = await signedIn("admin@bryels-care.test");
    const wo = await roleId(k.orgId, "warehouse_operator");
    const { userId, delivery } = await inviteUser(admin, { email: "Rosa.Lim@bryels-care.test", displayName: "Rosa Lim", grants: [{ roleId: wo, siteId: k.nfd.id }] });
    expect(delivery.status).toBe("captured");
    const u = await userByEmail("rosa.lim@bryels-care.test");
    expect(u.id).toBe(userId);
    expect(u.status).toBe("invited");
    const asg = await db.select().from(userSiteAssignments).where(eq(userSiteAssignments.userId, userId));
    expect(asg).toHaveLength(1);
    expect(asg[0].siteId).toBe(k.nfd.id);
    const actions = (await db.select({ a: auditEvents.action }).from(auditEvents).where(eq(auditEvents.entityNumber, u.email))).map((r) => r.a);
    expect(actions).toEqual(expect.arrayContaining(["identity.user.created", "identity.site_assignment.granted", "identity.invitation.sent"]));

    // An invited user cannot sign in, and has no context.
    expect(await buildContextForUser(userId)).toBeNull();

    const token = await lastLinkToken(u.email);
    expect(await inspectInvitation(token)).toMatchObject({ state: "valid", email: u.email });
    await expectCode(acceptInvitation({ token, password: "short" }), "validation");
    await expectCode(acceptInvitation({ token, password: "rosa lim is my name ok" }), "validation"); // contains the name
    await acceptInvitation({ token, password: GOOD_PASSWORD });
    expect((await userByEmail(u.email)).status).toBe("active");
    await expectCode(acceptInvitation({ token, password: GOOD_PASSWORD }), "state"); // single use
    expect(await inspectInvitation(token)).toEqual({ state: "used" });
    const r = await signInWithPassword({ email: u.email, password: GOOD_PASSWORD });
    expect(r.kind).toBe("ok");
    const ctx = await buildContextForUser(userId);
    expect(ctx!.allowedSiteIds).toEqual([k.nfd.id]);
  });

  it("a resend invalidates the previous link; an expired link is refused; revoking deactivates", async () => {
    const admin = await signedIn("admin@bryels-care.test");
    const sc = await roleId(k.orgId, "sales_cs");
    const { userId } = await inviteUser(admin, { email: "tomas.cruz@bryels-care.test", displayName: "Tomas Cruz", grants: [{ roleId: sc, siteId: k.rvs.id }] });
    const first = await lastLinkToken("tomas.cruz@bryels-care.test");
    await resendInvitation(admin, userId);
    const second = await lastLinkToken("tomas.cruz@bryels-care.test");
    expect(second).not.toBe(first);
    expect(await inspectInvitation(first)).toEqual({ state: "used" });
    await expectCode(acceptInvitation({ token: first, password: GOOD_PASSWORD }), "state");
    const later = new Date(Date.now() + 73 * 3_600_000);
    expect(await inspectInvitation(second, later)).toEqual({ state: "expired" });
    await expectCode(acceptInvitation({ token: second, password: GOOD_PASSWORD }, later), "state");

    await revokeInvitation(admin, userId, "Hire withdrawn by HR");
    expect((await userByEmail("tomas.cruz@bryels-care.test")).status).toBe("deactivated");
    await expectCode(acceptInvitation({ token: second, password: GOOD_PASSWORD }), "state");
    const live = await db.select().from(userSiteAssignments).where(and(eq(userSiteAssignments.userId, userId), isNull(userSiteAssignments.revokedAt)));
    expect(live).toHaveLength(0);
  });

  it("escalation: only holders may invite; a system_admin cannot hand out restricted permissions they lack", async () => {
    const sm = await signedIn("manager.nfd@bryels-care.test");
    const wo = await roleId(k.orgId, "warehouse_operator");
    await expectCode(inviteUser(sm, { email: "x1@bryels-care.test", displayName: "X One", grants: [{ roleId: wo, siteId: k.nfd.id }] }), "forbidden");

    const admin = await signedIn("admin@bryels-care.test");
    const qa = await roleId(k.orgId, "qa_qc"); // carries quality.disposition.approve (R), which system_admin lacks
    const e = await expectCode(inviteUser(admin, { email: "x2@bryels-care.test", displayName: "X Two", grants: [{ roleId: qa, siteId: k.nfd.id }] }), "forbidden");
    expect(e.message).toMatch(/quality\.disposition\.approve/);
    expect(await userByEmail("x2@bryels-care.test")).toBeUndefined(); // rolled back
    const [denied] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "identity.authorization.denied"), eq(auditEvents.actorId, admin.userId)));
    expect(denied).toBeTruthy();

    // The owner tops the chain and may grant it.
    const owner = await signedIn("owner@bryels-care.test");
    await inviteUser(owner, { email: "x3@bryels-care.test", displayName: "Xenia Three", grants: [{ roleId: qa, siteId: k.nfd.id }] });
    expect((await userByEmail("x3@bryels-care.test")).status).toBe("invited");
  });

  it("a site-scoped user administrator cannot invite into another site (404), and org-wide only for the three roles", async () => {
    const admin = await signedIn("admin@bryels-care.test");
    const siteAdmin = customCtx(admin, ["identity.user.create", "identity.invitation.create", "identity.site_assignment.admin", "identity.site_assignment.view"], [k.nfd]);
    const wo = await roleId(k.orgId, "warehouse_operator");
    await expectCode(inviteUser(siteAdmin, { email: "x4@bryels-care.test", displayName: "X Four", grants: [{ roleId: wo, siteId: k.rvs.id }] }), "not_found");
    await expectCode(inviteUser(admin, { email: "x5@bryels-care.test", displayName: "X Five", grants: [{ roleId: wo, siteId: null }] }), "validation");
  });

  it("restricted invitation needs a fresh re-authentication", async () => {
    const stale = await signedIn("admin@bryels-care.test", { reauth: false });
    const wo = await roleId(k.orgId, "warehouse_operator");
    await expectCode(inviteUser(stale, { email: "x6@bryels-care.test", displayName: "X Six", grants: [{ roleId: wo, siteId: k.nfd.id }] }), "reauth_required");
  });
});

describe("US-1-11 AC2 password reset", () => {
  it("auth.enumeration.reset: the same answer for unknown and known accounts; only a known active account gets a token", async () => {
    const before = await db.select().from(passwordResetTokens);
    const a = await requestPasswordReset({ email: "nobody@bryels-care.test" });
    const b = await requestPasswordReset({ email: "sales@bryels-care.test" });
    expect(a.message).toBe(b.message);
    const after = await db.select().from(passwordResetTokens);
    expect(after.length).toBe(before.length + 1);
  });

  it("single use, token bound, revokes every session, rejects reuse of recent passwords", async () => {
    const u = await userByEmail("sales@bryels-care.test");
    const s1 = await signInWithPassword({ email: u.email, password: "demo1234" });
    const s2 = await signInWithPassword({ email: u.email, password: "demo1234" });
    expect(s1.kind).toBe("ok");
    await requestPasswordReset({ email: u.email });
    const token = await lastLinkToken(u.email);
    expect(await inspectResetToken(token)).toMatchObject({ state: "valid" });
    await expectCode(completePasswordReset({ token, password: "demo1234" }), "validation"); // too short / reused
    await completePasswordReset({ token, password: GOOD_PASSWORD });
    if (s1.kind === "ok" && s2.kind === "ok") {
      expect(await validateSessionToken(s1.token)).toBeNull();
      expect(await validateSessionToken(s2.token)).toBeNull();
    }
    await expectCode(completePasswordReset({ token, password: "another long passphrase 7" }), "state");
    expect((await signInWithPassword({ email: u.email, password: GOOD_PASSWORD })).kind).toBe("ok");
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "identity.user.password_reset_completed"), eq(auditEvents.entityId, u.id)));
    expect(ev).toBeTruthy();

    // History: the previous password cannot come back.
    await requestPasswordReset({ email: u.email });
    const t2 = await lastLinkToken(u.email);
    const e = await expectCode(completePasswordReset({ token: t2, password: GOOD_PASSWORD }), "validation");
    expect(e.message).toMatch(/not used/);
  });

  it("auth.reset.expiry and newest-token-wins", async () => {
    const u = await userByEmail("auditor@bryels-care.test");
    await requestPasswordReset({ email: u.email });
    const older = await lastLinkToken(u.email);
    await requestPasswordReset({ email: u.email });
    const newer = await lastLinkToken(u.email);
    expect(await inspectResetToken(older)).toEqual({ state: "used" });
    const late = new Date(Date.now() + 31 * 60_000);
    expect(await inspectResetToken(newer, late)).toEqual({ state: "expired" });
    await expectCode(completePasswordReset({ token: newer, password: GOOD_PASSWORD }, late), "state");
  });

  it("at most 3 requests per account per hour", async () => {
    const u = await userByEmail("warehouse.rvs@bryels-care.test");
    const t0 = new Date(Date.now() + 5 * 3_600_000);
    for (let i = 0; i < 5; i++) await requestPasswordReset({ email: u.email }, new Date(t0.getTime() + i * 1000));
    const rows = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, u.id));
    expect(rows.length).toBe(3);
  });

  it("own password change needs the current password and revokes the other sessions", async () => {
    const ctx = await signedIn("warehouse.nfd@bryels-care.test");
    const other = await signInWithPassword({ email: ctx.email, password: "demo1234" });
    await expectCode(changeOwnPassword(ctx, { currentPassword: "wrong-password", newPassword: GOOD_PASSWORD }), "validation");
    const r = await changeOwnPassword(ctx, { currentPassword: "demo1234", newPassword: GOOD_PASSWORD });
    expect(r.revokedSessions).toBeGreaterThanOrEqual(1);
    if (other.kind === "ok") expect(await validateSessionToken(other.token)).toBeNull();
    const [cur] = await db.select().from(sessions).where(eq(sessions.id, ctx.sessionId!));
    expect(cur.revokedAt).toBeNull();
  });

  it("US-1-11 AC3: no token, password or hash appears in audit payloads; only the outbox adapter stores bodies", async () => {
    const tokens = (await db.select({ b: emailOutbox.bodyText }).from(emailOutbox)).map((r) => r.b?.match(/#token=([A-Za-z0-9_-]{43})/)?.[1]).filter(Boolean) as string[];
    expect(tokens.length).toBeGreaterThan(3);
    const rows = await db.select().from(auditEvents).where(like(auditEvents.action, "identity.%"));
    const blob = JSON.stringify(rows);
    for (const t of tokens) expect(blob).not.toContain(t);
    expect(blob).not.toContain("$argon2");
    expect(blob).not.toContain(GOOD_PASSWORD);
    const invRows = await db.select({ h: invitations.tokenHash }).from(invitations);
    for (const t of tokens) expect(invRows.map((r) => r.h)).not.toContain(t);
    expect((await db.select().from(users).where(eq(users.email, "rosa.lim@bryels-care.test")))[0].passwordHash).toMatch(/^\$argon2id\$/);
  });
});

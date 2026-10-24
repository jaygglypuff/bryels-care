/**
 * W2E US-1-28 TOTP for privileged roles (enrolment, recovery codes, sign-in step, step-up, admin reset)
 * and the production first-administrator bootstrap.
 * Test ids: auth.mfa.enrol, auth.mfa.signin_step, auth.mfa.replay_refused, auth.mfa.recovery_single_use,
 * auth.mfa.grace_enforced, auth.mfa.admin_reset, identity.bootstrap.*.
 */
import { execSync } from "node:child_process";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvents, mfaRecoveryCodes, mfaSecrets, organizations, roles, sessions, sites, userSiteAssignments, users } from "@/db/schema";
import { buildContextForUser } from "@/lib/auth/context";
import { validateSessionToken } from "@/lib/auth/session-store";
import { stepAt, totpAt } from "@/lib/auth/totp";
import { ROLE_BUNDLES } from "@/lib/permissions";
import {
  acceptInvitation,
  adminResetMfa,
  assertStepUp,
  beginMfaEnrolment,
  bootstrapFirstAdmin,
  completeMfaSignIn,
  confirmMfaEnrolment,
  lockUser,
  reauthenticate,
  signInWithPassword,
} from "@/modules/identity";
import { resetTestDatabase } from "../../support/db";
import { GOOD_PASSWORD, expectCode, signedIn, userByEmail } from "./helpers";

describe("US-1-28 TOTP multi-factor", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  }, 180_000);

  it("enrolment needs re-auth, verifies one code, returns 10 recovery codes once; sign-in then needs the code", async () => {
    const stale = await signedIn("owner@bryels-care.test", { reauth: false });
    await expectCode(beginMfaEnrolment(stale), "reauth_required");
    const owner = await signedIn("owner@bryels-care.test");
    const { secret, uri, qrDataUrl } = await beginMfaEnrolment(owner);
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const [stored] = await db.select().from(mfaSecrets).where(eq(mfaSecrets.userId, owner.userId));
    expect(stored.secretEnc).not.toContain(secret);
    await expectCode(confirmMfaEnrolment(owner, "000000"), "validation");
    const t0 = new Date();
    const { recoveryCodes } = await confirmMfaEnrolment(owner, totpAt(secret, stepAt(t0)), t0);
    expect(recoveryCodes).toHaveLength(10);
    const hashes = await db.select().from(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, owner.userId));
    expect(hashes.every((h) => h.codeHash.startsWith("$argon2id$"))).toBe(true);

    // Password alone is no longer enough.
    const r = await signInWithPassword({ email: owner.email, password: "demo1234" });
    expect(r.kind).toBe("mfa");
    if (r.kind !== "mfa") return;
    expect(await validateSessionToken(r.pendingToken)).toBeNull(); // pending session authorizes nothing
    const t1 = new Date(t0.getTime() + 60_000);
    await expectCode(completeMfaSignIn(r.pendingToken, totpAt(secret, stepAt(t0)), t1), "validation"); // step already used / out of window
    const ok = await completeMfaSignIn(r.pendingToken, totpAt(secret, stepAt(t1)), t1);
    expect(await validateSessionToken(ok.token, { now: t1 })).not.toBeNull();
    expect(ok.session.mfaVerifiedAt).not.toBeNull();

    // A recovery code works exactly once.
    const r2 = await signInWithPassword({ email: owner.email, password: "demo1234" });
    if (r2.kind !== "mfa") throw new Error("expected mfa step");
    await completeMfaSignIn(r2.pendingToken, recoveryCodes[0]);
    const r3 = await signInWithPassword({ email: owner.email, password: "demo1234" });
    if (r3.kind !== "mfa") throw new Error("expected mfa step");
    await expectCode(completeMfaSignIn(r3.pendingToken, recoveryCodes[0]), "validation");
  });

  it("step-up: an enrolled user's session without the TOTP step is refused; re-authentication needs the code", async () => {
    const owner = await signedIn("owner@bryels-care.test"); // reauth fresh, mfa not verified
    await expectCode(assertStepUp(owner, "test"), "reauth_required");
    await expectCode(reauthenticate(owner, { password: "demo1234" }), "validation"); // code missing
    const [f] = await db.select().from(mfaSecrets).where(eq(mfaSecrets.userId, owner.userId));
    expect(f.confirmedAt).not.toBeNull();
  });

  it("auth.mfa.grace_enforced: a privileged user 8 days after the grant without TOTP is blocked from restricted actions", async () => {
    const admin = await userByEmail("admin@bryels-care.test");
    await db.update(userSiteAssignments).set({ validFrom: new Date(Date.now() - 8 * 86_400_000) }).where(eq(userSiteAssignments.userId, admin.id));
    const ctx = await signedIn("admin@bryels-care.test");
    const e = await expectCode(assertStepUp(ctx, "test"), "forbidden");
    expect(e.details?.mfaEnrolmentRequired).toBe(true);
    const target = await userByEmail("operator.nfd@bryels-care.test");
    await expectCode(lockUser(ctx, target.id, "blocked until enrolled"), "forbidden");
    // Enrolment itself stays possible.
    const { secret } = await beginMfaEnrolment(ctx);
    const now = new Date();
    await confirmMfaEnrolment(ctx, totpAt(secret, stepAt(now)), now);
  });

  it("auth.mfa.admin_reset: identity.mfa.admin with reason; never on oneself; the user is signed out", async () => {
    const owner = await userByEmail("owner@bryels-care.test");
    const s = await signInWithPassword({ email: "auditor@bryels-care.test", password: "demo1234" });
    expect(s.kind).toBe("ok");
    const sm = await signedIn("manager.nfd@bryels-care.test");
    await expectCode(adminResetMfa(sm, owner.id, "manager tries"), "forbidden");
    const adminCtx = await signedIn("admin@bryels-care.test", { mfa: true });
    await expectCode(adminResetMfa(adminCtx, adminCtx.userId, "my own phone"), "forbidden");
    await adminResetMfa(adminCtx, owner.id, "Owner replaced her phone");
    expect(await db.select().from(mfaSecrets).where(eq(mfaSecrets.userId, owner.id))).toHaveLength(0);
    const live = await db.select().from(sessions).where(and(eq(sessions.userId, owner.id)));
    expect(live.every((x) => x.revokedAt !== null)).toBe(true);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "identity.mfa.reset"), eq(auditEvents.entityId, owner.id)));
    expect(ev.reason).toBe("Owner replaced her phone");
  });
});

describe("first-administrator bootstrap", () => {
  beforeAll(async () => {
    // A fresh production-like database: migrations only, no demo seed.
    const url = process.env.DATABASE_URL!;
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS pgboss CASCADE; CREATE SCHEMA public;");
    await sql.end();
    execSync("pnpm -s tsx src/db/migrate.ts", { env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url }, stdio: "pipe" });
  }, 180_000);

  it("creates organization, site, seeded roles and an invited owner/admin with a one-time link; refuses once someone is active", async () => {
    await expectCode(bootstrapFirstAdmin({ email: "first.admin@example.test", displayName: "First Admin", roleCodes: ["owner_director", "system_admin"] }), "validation"); // no org name
    const r = await bootstrapFirstAdmin({
      email: "First.Admin@example.test",
      displayName: "First Admin",
      roleCodes: ["owner_director", "system_admin"],
      organizationName: "Fictional Soap Co.",
      siteCode: "hq",
      siteName: "Head office (fictional)",
    });
    expect(r.createdOrganization && r.createdSite).toBe(true);
    expect(r.roleSync.created.sort()).toEqual(Object.keys(ROLE_BUNDLES).sort());
    // ADR-040: a fresh database gets the reference master data with its first organization.
    expect(r.referenceData).toMatchObject({ uoms: 6, conversions: 3 });
    expect(r.referenceData.reasonCodes).toBeGreaterThan(30);
    expect(await db.select().from(organizations)).toHaveLength(1);
    expect((await db.select().from(sites))[0].code).toBe("HQ");
    expect((await db.select().from(roles)).length).toBe(Object.keys(ROLE_BUNDLES).length);
    const u = await userByEmail("first.admin@example.test");
    expect(u.status).toBe("invited");
    expect(u.passwordHash).toBe("!");

    // Re-running before acceptance replaces the link.
    const again = await bootstrapFirstAdmin({ email: "first.admin@example.test", displayName: "First Admin", roleCodes: ["owner_director", "system_admin"] });
    const oldToken = r.link.split("#token=")[1];
    const newToken = again.link.split("#token=")[1];
    await expectCode(acceptInvitation({ token: oldToken, password: GOOD_PASSWORD }), "state");
    await acceptInvitation({ token: newToken, password: GOOD_PASSWORD });
    const signIn = await signInWithPassword({ email: "first.admin@example.test", password: GOOD_PASSWORD });
    expect(signIn.kind).toBe("ok");
    const ctx = await buildContextForUser(u.id);
    expect(ctx!.isOrganizationWide).toBe(true);
    expect(ctx!.can("identity.invitation.create")).toBe(true);
    expect(ctx!.roleCodes.sort()).toEqual(["owner_director", "system_admin"]);

    await expectCode(bootstrapFirstAdmin({ email: "intruder@example.test", displayName: "Intruder", roleCodes: ["system_admin"] }), "conflict");
    expect(await userByEmail("intruder@example.test")).toBeUndefined();
    const evs = await db.select().from(auditEvents).where(eq(auditEvents.actorLabel, "system:identity.bootstrap"));
    expect(evs.map((e) => e.action)).toEqual(expect.arrayContaining(["identity.user.created", "identity.site_assignment.granted", "identity.invitation.sent"]));
    expect(JSON.stringify(evs)).not.toContain(newToken);
  });
});

/**
 * W2E US-1-12 session management and US-1-16 AC2 lifecycle effects on sessions.
 * Test ids: session.idle_expiry, session.absolute_expiry, session.active_continues, identity.revoke_all_sessions,
 * authz.session.revoked, jobs.session_purge, identity.deactivated_denied_every_request, auth.lifecycle.deactivated_denied.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvents, sessions, settings } from "@/db/schema";
import { buildContextForUser } from "@/lib/auth/context";
import { createSessionRecord, validateSessionToken } from "@/lib/auth/session-store";
import {
  deactivateUser,
  listActiveSessions,
  listMySessions,
  lockUser,
  purgeSessions,
  reactivateUser,
  revokeAllUserSessions,
  revokeSession,
  signInWithPassword,
  unlockUser,
} from "@/modules/identity";
import { resetTestDatabase } from "../../support/db";
import { expectCode, idKit, signedIn, userByEmail } from "./helpers";

const H = 3_600_000;
let k: Awaited<ReturnType<typeof idKit>>;

beforeAll(async () => {
  await resetTestDatabase();
  k = await idKit();
}, 180_000);

describe("US-1-12 AC2 idle and absolute expiry (clock injected)", () => {
  it("standard session: 12 h idle sliding, 7 d absolute; activity keeps it alive", async () => {
    const u = await userByEmail("sales@bryels-care.test"); // sales_cs holds no restricted permission
    const t0 = new Date("2026-11-02T00:00:00Z");
    const { token, session } = await createSessionRecord({ userId: u.id, now: t0 });
    expect(session.privileged).toBe(false);
    expect(session.expiresAt.getTime() - t0.getTime()).toBe(7 * 24 * H);
    expect(await validateSessionToken(token, { now: new Date(t0.getTime() + 11 * H) })).not.toBeNull(); // slides
    expect(await validateSessionToken(token, { now: new Date(t0.getTime() + 22 * H) })).not.toBeNull(); // 11 h after last activity
    expect(await validateSessionToken(token, { now: new Date(t0.getTime() + 35 * H) })).toBeNull(); // 13 h idle
    const { token: t2 } = await createSessionRecord({ userId: u.id, now: t0 });
    let at = t0.getTime();
    for (let i = 0; i < 16; i++) {
      at += 11 * H;
      const ok = await validateSessionToken(t2, { now: new Date(at) });
      if (at - t0.getTime() < 7 * 24 * H) expect(ok, `at +${(at - t0.getTime()) / H} h`).not.toBeNull();
      else expect(ok).toBeNull(); // absolute limit
    }
  });

  it("privileged session: 1 h idle, 24 h absolute; shared device: 30 min idle", async () => {
    const admin = await userByEmail("admin@bryels-care.test");
    const t0 = new Date("2026-11-03T00:00:00Z");
    const { token, session } = await createSessionRecord({ userId: admin.id, now: t0 });
    expect(session.privileged).toBe(true);
    expect(session.expiresAt.getTime() - t0.getTime()).toBe(24 * H);
    expect(await validateSessionToken(token, { now: new Date(t0.getTime() + 50 * 60_000) })).not.toBeNull();
    expect(await validateSessionToken(token, { now: new Date(t0.getTime() + 50 * 60_000 + 61 * 60_000) })).toBeNull();

    const op = await userByEmail("sales@bryels-care.test");
    const { token: shared } = await createSessionRecord({ userId: op.id, deviceClass: "shared", now: t0 });
    expect(await validateSessionToken(shared, { now: new Date(t0.getTime() + 29 * 60_000) })).not.toBeNull();
    expect(await validateSessionToken(shared, { now: new Date(t0.getTime() + 29 * 60_000 + 31 * 60_000) })).toBeNull();
  });

  it("timeouts are settings: an organization row overrides the default", async () => {
    await db.insert(settings).values({ organizationId: k.orgId, scope: "organization", key: "session.idle_minutes", value: 30 });
    const u = await userByEmail("sales@bryels-care.test");
    const t0 = new Date("2026-11-04T00:00:00Z");
    const { token } = await createSessionRecord({ userId: u.id, now: t0 });
    expect(await validateSessionToken(token, { now: new Date(t0.getTime() + 31 * 60_000) })).toBeNull();
    await db.delete(settings).where(and(eq(settings.organizationId, k.orgId), eq(settings.key, "session.idle_minutes")));
  });
});

describe("US-1-12 AC1 / AC3 listing and revocation", () => {
  it("identity.revoke_all_sessions: an admin signs a user out everywhere with a reason; both devices stop", async () => {
    const u = await userByEmail("qa.nfd@bryels-care.test");
    const a = await signInWithPassword({ email: u.email, password: "demo1234" });
    const b = await signInWithPassword({ email: u.email, password: "demo1234" });
    if (a.kind !== "ok" || b.kind !== "ok") throw new Error("sign-in failed");
    const admin = await signedIn("admin@bryels-care.test");
    const n = await revokeAllUserSessions(admin, u.id, "Phone reported lost");
    expect(n).toBeGreaterThanOrEqual(2);
    expect(await validateSessionToken(a.token)).toBeNull();
    expect(await validateSessionToken(b.token)).toBeNull();
    const [row] = await db.select().from(sessions).where(eq(sessions.id, a.session.id));
    expect(row.revokedBy).toBe(admin.userId);
    expect(row.revokedReason).toBe("Phone reported lost");
    const evs = await db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.entityNumber, u.email));
    expect(evs.filter((e) => e.action === "identity.session.revoked").length).toBeGreaterThanOrEqual(2);
    expect(evs.some((e) => e.action === "identity.session.revoked_all")).toBe(true);
  });

  it("own sessions are listed and revocable; other people's need identity.session.void; site_manager sees none", async () => {
    const me = await signedIn("warehouse.nfd@bryels-care.test");
    const second = await signInWithPassword({ email: me.email, password: "demo1234" });
    if (second.kind !== "ok") throw new Error("sign-in failed");
    const mine = await listMySessions(me);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.find((s) => s.id === me.sessionId)?.current).toBe(true);
    await revokeSession(me, second.session.id, null);
    expect(await validateSessionToken(second.token)).toBeNull();

    const other = await signInWithPassword({ email: "warehouse.rvs@bryels-care.test", password: "demo1234" });
    if (other.kind !== "ok") throw new Error("sign-in failed");
    await expectCode(revokeSession(me, other.session.id, "not mine to revoke"), "forbidden");
    const sm = await signedIn("manager.nfd@bryels-care.test");
    await expectCode(listActiveSessions(sm), "forbidden");
    const admin = await signedIn("admin@bryels-care.test");
    const all = await listActiveSessions(admin);
    expect(all.some((s) => s.id === other.session.id)).toBe(true);
    await expectCode(revokeSession(admin, other.session.id, "x"), "validation"); // reason required for others
    await revokeSession(admin, other.session.id, "Shared login suspected");
    expect(await validateSessionToken(other.token)).toBeNull();
  });

  it("jobs.session_purge: rows 30 days past expiry or revocation are deleted", async () => {
    const u = await userByEmail("sales@bryels-care.test");
    const old = new Date(Date.now() - 60 * 24 * H);
    const { session } = await createSessionRecord({ userId: u.id, now: old });
    const n = await purgeSessions(k.orgId);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(sessions).where(eq(sessions.id, session.id))).toHaveLength(0);
  });
});

describe("US-1-16 AC2 lifecycle", () => {
  it("lock → unlock; deactivate revokes sessions, ends assignments, denies every request; reactivate grants nothing", async () => {
    const admin = await signedIn("admin@bryels-care.test");
    const u = await userByEmail("checker.nfd@bryels-care.test");
    const s = await signInWithPassword({ email: u.email, password: "demo1234" });
    if (s.kind !== "ok") throw new Error("sign-in failed");

    await lockUser(admin, u.id, "Suspicious activity reported");
    expect((await userByEmail(u.email)).status).toBe("locked");
    expect(await validateSessionToken(s.token)).toBeNull();
    expect(await buildContextForUser(u.id)).toBeNull();
    await expectCode(lockUser(admin, u.id, "again please"), "state");
    await unlockUser(admin, u.id, "Identity confirmed by phone");
    expect((await userByEmail(u.email)).status).toBe("active");

    const s2 = await signInWithPassword({ email: u.email, password: "demo1234" });
    if (s2.kind !== "ok") throw new Error("sign-in failed");
    await deactivateUser(admin, u.id, "Left the company (offboarding)");
    expect((await userByEmail(u.email)).status).toBe("deactivated");
    expect(await validateSessionToken(s2.token)).toBeNull();
    expect(await buildContextForUser(u.id)).toBeNull(); // every request, not only login
    expect((await signInWithPassword({ email: u.email, password: "demo1234" })).kind).toBe("failed");

    await reactivateUser(admin, u.id, "Rehired as seasonal staff");
    expect((await userByEmail(u.email)).status).toBe("active");
    expect(await buildContextForUser(u.id)).toBeNull(); // no assignment comes back automatically
  });

  it("no self lock or deactivation; site_manager cannot administer accounts; step-up required", async () => {
    const admin = await signedIn("admin@bryels-care.test");
    await expectCode(deactivateUser(admin, admin.userId, "testing myself"), "forbidden");
    const sm = await signedIn("manager.nfd@bryels-care.test");
    const u = await userByEmail("operator.nfd@bryels-care.test");
    await expectCode(lockUser(sm, u.id, "manager tries to lock"), "forbidden");
    const stale = await signedIn("admin@bryels-care.test", { reauth: false });
    await expectCode(lockUser(stale, u.id, "no fresh password"), "reauth_required");
    const old = await signedIn("admin@bryels-care.test");
    const tooOld = new Date(Date.now() + 11 * 60_000); // window is 10 minutes
    await expectCode(lockUser(old, u.id, "re-auth expired", tooOld), "reauth_required");
  });
});

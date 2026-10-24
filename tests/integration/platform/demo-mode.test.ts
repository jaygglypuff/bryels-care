import { execFileSync } from "node:child_process";
import { hash } from "@node-rs/argon2";
import { and, count, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvents, organizations, userSiteAssignments, users } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { inviteUser, listDemoAccounts, mfaStateFor, signInAsDemoAccount } from "@/modules/identity";
import { resetDemoData } from "@/modules/platform";
import { signInAsDemo } from "@/app/(auth)/sign-in/actions";
import { resetTestDatabase } from "../../support/db";
import { idKit, roleId, signedIn, userByEmail } from "../identity/helpers";

/**
 * Demo mode safety (ADR-044): no demo UI or one-click sign-in outside demo mode, one-click only for
 * demo accounts, the seed and the resets refuse while a real account exists, owner-only reset with
 * step-up and confirmation, and demo accounts are not blocked by the TOTP enrolment deadline.
 */
const DEMO_VARS = ["DEMO_MODE", "ALLOW_DEMO_SEED", "APP_ENV"] as const;
const saved = Object.fromEntries(DEMO_VARS.map((k) => [k, process.env[k]]));
const demoOn = () => {
  process.env.DEMO_MODE = "true";
};
const restoreEnv = () => {
  for (const k of DEMO_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
};

async function rejectsWith(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe(code);
    return e as DomainError;
  }
  throw new Error(`expected ${code}`);
}

/** Runs a database script the way scripts/start.sh and the reset screen do; returns exit code and output. */
function runScript(file: string, args: string[], env: Record<string, string | undefined>) {
  try {
    const out = execFileSync(process.execPath, ["--import", "tsx", file, ...args], {
      env: { ...process.env, DEMO_MODE: undefined, ALLOW_DEMO_SEED: undefined, APP_ENV: undefined, ...env },
      stdio: "pipe",
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (e) {
    const x = e as { status: number; stdout: string; stderr: string };
    return { code: x.status, out: `${x.stdout}\n${x.stderr}` };
  }
}

let kit: Awaited<ReturnType<typeof idKit>>;
beforeAll(async () => {
  restoreEnv();
  delete process.env.DEMO_MODE;
  delete process.env.ALLOW_DEMO_SEED;
  await resetTestDatabase();
  kit = await idKit();
});
afterEach(() => {
  delete process.env.DEMO_MODE;
  delete process.env.ALLOW_DEMO_SEED;
  delete process.env.APP_ENV;
});
afterAll(restoreEnv);

describe("demo mode off: no demo UI, no one-click sign-in", () => {
  it("lists no demo accounts (the sign-in page renders no demo panel)", async () => {
    expect(await listDemoAccounts()).toBeNull();
  });
  it("refuses one-click sign-in in the service and in the server action", async () => {
    await rejectsWith(signInAsDemoAccount({ email: "owner@bryels-care.test" }), "forbidden");
    const fd = new FormData();
    fd.set("email", "owner@bryels-care.test");
    const r = await signInAsDemo(null, fd);
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("only in the demo environment") });
  });
  it("APP_ENV=production switches demo mode off even with DEMO_MODE=true", async () => {
    demoOn();
    process.env.APP_ENV = "production";
    expect(await listDemoAccounts()).toBeNull();
    await rejectsWith(signInAsDemoAccount({ email: "owner@bryels-care.test" }), "forbidden");
  });
  it("refuses the reset screen", async () => {
    const owner = await signedIn("owner@bryels-care.test", { reauth: true });
    let ran = false;
    await rejectsWith(resetDemoData(owner, { confirm: "RESET" }, { runner: async () => ((ran = true), { code: 0, output: "" }) }), "forbidden");
    expect(ran).toBe(false);
  });
});

describe("demo mode on: one-click sign-in", () => {
  it("lists the active demo accounts grouped by role, owner first, never the system actor or invitees", async () => {
    demoOn();
    const groups = (await listDemoAccounts())!;
    expect(groups[0].roleCode).toBe("owner_director");
    const emails = groups.flatMap((g) => g.accounts.map((a) => a.email));
    expect(emails).toEqual(expect.arrayContaining(["owner@bryels-care.test", "operator.nfd@bryels-care.test", "qa.nfd@bryels-care.test", "warehouse.nfd@bryels-care.test", "sales@bryels-care.test"]));
    expect(emails.every((e) => e.endsWith("@bryels-care.test"))).toBe(true);
    expect(emails).not.toContain("system@bryels-care.invalid");
    expect(emails).not.toContain("joy.ramos@bryels-care.test"); // invited, not active
    expect(new Set(emails).size).toBe(emails.length);
  });
  it("refuses addresses that are not demo accounts, including the system actor", async () => {
    demoOn();
    await rejectsWith(signInAsDemoAccount({ email: "someone@example.com" }), "forbidden");
    await rejectsWith(signInAsDemoAccount({ email: "owner@bryels-care.test.example.com" }), "forbidden");
    await rejectsWith(signInAsDemoAccount({ email: "system@bryels-care.invalid" }), "forbidden");
    await rejectsWith(signInAsDemoAccount({ email: "nobody@bryels-care.test" }), "not_found");
    const fd = new FormData();
    fd.set("email", "someone@example.com");
    expect(await signInAsDemo(null, fd)).toMatchObject({ ok: false });
  });
  it("signs a demo account in through the password path and audits the one-click use", async () => {
    demoOn();
    const r = await signInAsDemoAccount({ email: "qa.nfd@bryels-care.test", userAgent: "vitest" });
    expect(r.kind).toBe("ok");
    const u = await userByEmail("qa.nfd@bryels-care.test");
    const [n] = await db.select({ n: count() }).from(auditEvents).where(and(eq(auditEvents.actorId, u.id), eq(auditEvents.action, "identity.session.demo_sign_in")));
    expect(Number(n.n)).toBe(1);
  });
  it("refuses a demo account whose password was changed, without counting a failed attempt", async () => {
    demoOn();
    const u = await userByEmail("checker.nfd@bryels-care.test");
    await db.update(users).set({ passwordHash: await hash("a-different-password-123") }).where(eq(users.id, u.id));
    try {
      for (let i = 0; i < 6; i++) expect((await signInAsDemoAccount({ email: u.email })).kind).toBe("failed");
      const after = await userByEmail(u.email);
      expect(after.failedLoginCount).toBe(0);
      expect(after.status).toBe("active");
    } finally {
      await db.update(users).set({ passwordHash: u.passwordHash }).where(eq(users.id, u.id));
    }
  });
});

describe("demo mode on: accounts are not blocked by enforced TOTP; invitations stay fictional", () => {
  it("a privileged demo account past the enrolment deadline is not overdue in demo mode only", async () => {
    const owner = await userByEmail("owner@bryels-care.test");
    const [a] = await db.select().from(userSiteAssignments).where(eq(userSiteAssignments.userId, owner.id));
    await db.update(userSiteAssignments).set({ validFrom: new Date(Date.now() - 60 * 86_400_000) }).where(eq(userSiteAssignments.id, a.id));
    try {
      expect((await mfaStateFor(db, kit.orgId, owner.id)).overdue).toBe(true);
      demoOn();
      const s = await mfaStateFor(db, kit.orgId, owner.id);
      expect(s).toMatchObject({ required: true, enrolled: false, overdue: false, graceEndsAt: null });
    } finally {
      await db.update(userSiteAssignments).set({ validFrom: a.validFrom }).where(eq(userSiteAssignments.id, a.id));
    }
  });
  it("refuses to invite a real address in demo mode", async () => {
    demoOn();
    const admin = await signedIn("admin@bryels-care.test", { reauth: true });
    const operator = await roleId(kit.orgId, "production_operator");
    const e = await rejectsWith(inviteUser(admin, { email: "real.person@gmail.com", displayName: "Real Person", grants: [{ roleId: operator, siteId: kit.nfd.id }] }), "validation");
    expect(e.message).toContain("@bryels-care.test");
    const [none] = await db.select({ n: count() }).from(users).where(eq(users.email, "real.person@gmail.com"));
    expect(Number(none.n)).toBe(0);
  });
});

describe("reset demo data (owner only, step-up, confirmation)", () => {
  const ok = async () => ({ code: 0, output: "[demo] Demo data loaded in 1 s." });
  it("refuses everyone but the Owner/Director and audits the denial", async () => {
    demoOn();
    const admin = await signedIn("admin@bryels-care.test", { reauth: true });
    await rejectsWith(resetDemoData(admin, { confirm: "RESET" }, { runner: ok }), "forbidden");
    const [n] = await db.select({ n: count() }).from(auditEvents).where(and(eq(auditEvents.actorId, admin.userId), eq(auditEvents.action, "identity.authorization.denied")));
    expect(Number(n.n)).toBeGreaterThan(0);
  });
  it("needs a recent re-authentication and the typed word", async () => {
    demoOn();
    const stale = await signedIn("owner@bryels-care.test", { reauth: false });
    await rejectsWith(resetDemoData(stale, { confirm: "RESET" }, { runner: ok }), "reauth_required");
    const owner = await signedIn("owner@bryels-care.test", { reauth: true });
    await rejectsWith(resetDemoData(owner, { confirm: "reset please" }, { runner: ok }), "validation");
  });
  it("reports the runner's refusal and failure honestly, and records a success in the new data", async () => {
    demoOn();
    const owner = await signedIn("owner@bryels-care.test", { reauth: true });
    const refused = await rejectsWith(resetDemoData(owner, { confirm: "RESET" }, { runner: async () => ({ code: 2, output: "[demo] Refusing to reset: demo mode is off." }) }), "conflict");
    expect(refused.message).toContain("Refusing to reset");
    const failed = await rejectsWith(resetDemoData(owner, { confirm: "RESET" }, { runner: async () => ({ code: 1, output: "boom: seed failed" }) }), "setup_required");
    expect(failed.message).toContain("boom: seed failed");
    const r = await resetDemoData(owner, { confirm: " reset " }, { runner: ok });
    expect(r.durationSeconds).toBeGreaterThanOrEqual(0);
    const [n] = await db.select({ n: count() }).from(auditEvents).where(eq(auditEvents.action, "platform.demo.reset"));
    expect(Number(n.n)).toBe(1);
  });
});

describe("real accounts: the seed and every reset refuse, nothing is touched", () => {
  const REAL = "maria.santos@bryelscare.ph";
  beforeAll(async () => {
    await db.insert(users).values({ organizationId: kit.orgId, email: REAL, displayName: "Maria Santos", passwordHash: "!", status: "invited" });
  });
  afterAll(async () => {
    await db.delete(users).where(eq(users.email, REAL));
  });

  it("the reset screen refuses before running anything", async () => {
    demoOn();
    const owner = await signedIn("owner@bryels-care.test", { reauth: true });
    let ran = false;
    const e = await rejectsWith(resetDemoData(owner, { confirm: "RESET" }, { runner: async () => ((ran = true), { code: 0, output: "" }) }), "conflict");
    expect(e.message).toContain("not a demo address");
    expect(ran).toBe(false);
  });
  it("pnpm db:seed, db:demo auto|reset and db:reset all refuse; the data is unchanged", { timeout: 120_000 }, async () => {
    const [orgBefore] = await db.select().from(organizations);
    const seed = runScript("src/db/seed.ts", [], { DEMO_MODE: "true" });
    expect(seed.code).toBe(2);
    expect(seed.out).toContain("not a demo address");
    for (const mode of ["auto", "reset"]) {
      const r = runScript("src/db/demo.ts", [mode], { DEMO_MODE: "true" });
      expect(r.code, mode).toBe(2);
      expect(r.out).toContain("not a demo address");
    }
    const reset = runScript("src/db/reset.ts", [], { ALLOW_DEMO_SEED: "true" });
    expect(reset.code).toBe(1);
    expect(reset.out).toContain("not a demo address");
    const [orgAfter] = await db.select().from(organizations);
    expect(orgAfter.id).toBe(orgBefore.id);
    expect(await userByEmail(REAL)).toBeTruthy();
  });
});

describe("start-up and reset scripts (demo database)", () => {
  it("refuse when demo mode is off; auto does nothing then", { timeout: 120_000 }, () => {
    expect(runScript("src/db/seed.ts", [], {}).code).toBe(1);
    expect(runScript("src/db/demo.ts", ["reset"], {}).code).toBe(2);
    expect(runScript("src/db/demo.ts", ["reset"], { DEMO_MODE: "true", APP_ENV: "production" }).code).toBe(2);
    expect(runScript("src/db/reset.ts", [], {}).code).toBe(1);
    const auto = runScript("src/db/demo.ts", ["auto"], {});
    expect(auto).toEqual({ code: 0, out: "" });
  });
  it("auto never reloads a complete demo, reloads an interrupted one, and reset loads a fresh copy", { timeout: 240_000 }, async () => {
    const [before] = await db.select().from(organizations);
    const again = runScript("src/db/demo.ts", ["auto"], { DEMO_MODE: "true" });
    expect(again.code).toBe(0);
    expect(again.out).toContain("already loaded");
    expect((await db.select().from(organizations))[0].id).toBe(before.id);

    // An organization without the completeness marker is an interrupted load: cleared and loaded again.
    await db.delete(auditEvents).where(eq(auditEvents.action, "platform.demo.seeded"));
    const resumed = runScript("src/db/demo.ts", ["auto"], { DEMO_MODE: "true" });
    expect(resumed.code).toBe(0);
    expect(resumed.out).toContain("interrupted demo load");
    const [mid] = await db.select().from(organizations);
    expect(mid.id).not.toBe(before.id);

    const reset = runScript("src/db/demo.ts", ["reset"], { DEMO_MODE: "true" });
    expect(reset.code).toBe(0);
    const orgs = await db.select().from(organizations);
    expect(orgs).toHaveLength(1);
    expect(orgs[0].id).not.toBe(mid.id);
    const [marker] = await db.select({ n: count() }).from(auditEvents).where(eq(auditEvents.action, "platform.demo.seeded"));
    expect(Number(marker.n)).toBe(1);
    expect(await userByEmail("owner@bryels-care.test")).toBeTruthy();
  });
});

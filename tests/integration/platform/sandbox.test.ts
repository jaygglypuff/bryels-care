import { execFileSync } from "node:child_process";
import { hash } from "@node-rs/argon2";
import { and, count, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvents, formulaRevisions, locations, materials, organizations, products, settings, sites, users } from "@/db/schema";
import { buildContextForUser } from "@/lib/auth/context";
import { installSoapExample } from "@/modules/masterdata";
import { SANDBOX_ORG_NAME } from "@/lib/demo";
import { listDemoAccounts, listSandboxAccounts } from "@/modules/identity";
import { resetTestDatabase } from "../../support/db";

/**
 * ADR-072: the empty sandbox company. Demo mode only, demo addresses only, refused while a real
 * account exists, nothing to do on a second run; separate from the demo company's accounts; the
 * owner override (ADR-073) is on in both companies after the sandbox is created.
 */
function runSandbox(env: Record<string, string>) {
  try {
    const out = execFileSync(process.execPath, ["--import", "tsx", "src/db/sandbox.ts", "ensure"], {
      env: { ...process.env, DEMO_MODE: "", ALLOW_DEMO_SEED: "", APP_ENV: "", ...env },
      stdio: "pipe",
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (e) {
    const x = e as { status: number; stdout: string; stderr: string };
    return { code: x.status, out: `${x.stdout}\n${x.stderr}` };
  }
}

const savedDemo = process.env.DEMO_MODE;
beforeAll(async () => {
  await resetTestDatabase();
}, 120_000);
afterAll(() => {
  if (savedDemo === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = savedDemo;
});

const sandboxOrg = async () => (await db.select().from(organizations).where(eq(organizations.name, SANDBOX_ORG_NAME)))[0];

describe("ADR-072 empty sandbox company", () => {
  it("does nothing outside demo mode", async () => {
    expect(runSandbox({}).code).toBe(0);
    expect(await sandboxOrg()).toBeUndefined();
  });

  it("creates an empty company with its own site, locations and accounts", async () => {
    const r = runSandbox({ DEMO_MODE: "true" });
    expect(r.code, r.out).toBe(0);
    const org = await sandboxOrg();
    expect(org).toBeTruthy();
    const [site] = await db.select().from(sites).where(eq(sites.organizationId, org.id));
    expect(site.code).toBe("SBX");
    const [{ n: locs }] = await db.select({ n: count() }).from(locations).where(eq(locations.siteId, site.id));
    expect(locs).toBeGreaterThanOrEqual(10);
    const [{ n: mats }] = await db.select({ n: count() }).from(materials).where(eq(materials.organizationId, org.id));
    const [{ n: prods }] = await db.select({ n: count() }).from(products).where(eq(products.organizationId, org.id));
    expect(mats).toBe(0);
    expect(prods).toBe(0);
    const [{ n: people }] = await db.select({ n: count() }).from(users).where(and(eq(users.organizationId, org.id), like(users.email, "sandbox.%")));
    expect(people).toBe(14);
    const flags = await db.select().from(settings).where(eq(settings.key, "governance.owner_override"));
    expect(flags.length).toBe(2); // sandbox and demo company
    expect((await db.select().from(auditEvents).where(eq(auditEvents.action, "platform.sandbox.seeded"))).length).toBe(1);
  });

  it("a second run changes nothing", async () => {
    const r = runSandbox({ DEMO_MODE: "true" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("already there");
    expect((await db.select().from(organizations).where(eq(organizations.name, SANDBOX_ORG_NAME))).length).toBe(1);
  });

  it("the sign-in lists keep demo and sandbox accounts apart", async () => {
    process.env.DEMO_MODE = "true";
    const demo = (await listDemoAccounts())!.flatMap((g) => g.accounts.map((a) => a.email));
    const sandbox = (await listSandboxAccounts())!.flatMap((g) => g.accounts.map((a) => a.email));
    expect(sandbox).toHaveLength(14);
    expect(sandbox.every((e) => e.startsWith("sandbox."))).toBe(true);
    expect(demo.some((e) => e.startsWith("sandbox."))).toBe(false);
    expect(demo.length).toBeGreaterThan(0);
  });

  it("ADR-079: the Acapulco soap example fills an empty company once, as drafts", async () => {
    const [owner] = await db.select().from(users).where(eq(users.email, "sandbox.owner@bryels-care.test"));
    const ctx = (await buildContextForUser(owner.id))!;
    const first = await installSoapExample(ctx);
    expect(first.created).toEqual(expect.arrayContaining(["product Acapulco Soap 135 g", "formula (draft)", "routing (draft)"]));
    expect(first.created.filter((c) => c.startsWith("material ")).length).toBe(6);
    const [rev] = await db.select().from(formulaRevisions).where(eq(formulaRevisions.id, first.formulaRevisionId!));
    expect(rev.status).toBe("draft");
    const again = await installSoapExample(ctx);
    expect(again.created).toEqual([]);
    // A warehouse operator may not create master data.
    const [wh] = await db.select().from(users).where(eq(users.email, "sandbox.warehouse@bryels-care.test"));
    await expect(installSoapExample((await buildContextForUser(wh.id))!)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses while a real account exists", async () => {
    const org = await sandboxOrg();
    // Remove the sandbox so the run would create it, then add a real account.
    const [demoOrg] = await db.select().from(organizations).where(eq(organizations.name, "Bryel's Care (fictional demo)")).limit(1);
    const orgId = demoOrg?.id ?? (await db.select().from(organizations).limit(1))[0].id;
    await db.update(users).set({ email: "sandbox.owner.renamed@bryels-care.test" }).where(and(eq(users.organizationId, org.id), eq(users.email, "sandbox.owner@bryels-care.test")));
    await db.insert(users).values({ organizationId: orgId, email: "someone@real-company.example", displayName: "Real person", passwordHash: await hash("x-not-used-1234") });
    const r = runSandbox({ DEMO_MODE: "true" });
    expect(r.code).toBe(2);
    expect((await db.select().from(organizations).where(eq(organizations.name, SANDBOX_ORG_NAME))).length).toBe(1);
  });
});

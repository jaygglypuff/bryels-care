/**
 * US-5-13 Phase 5 diagnostics cards (Database, Imports, Alerts, Errors, Integrations):
 * `diagnostics.no_secrets` with secret-looking variables set, permission negatives and adapter states.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { backgroundJobs } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { alertsCard, databaseCard, errorsCard, importsCard, integrationsCard, registerImportStatsProvider } from "@/modules/platform";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit } from "../../support/kit";

let kit: Kit;
let admin: AuthContext;
let manager: AuthContext;
const SECRETS: Record<string, string> = {
  RESEND_API_KEY: "re_TopSecretKeyValue1234567890",
  S3_SECRET_ACCESS_KEY: "s3SecretValueThatMustNeverShow999",
  ERROR_REPORTING_DSN: "https://publicKeyAbc123@errors.example.invalid/42",
  ALERT_WEBHOOK_URL: "https://hooks.example.invalid/services/T000/B000/XXXXSECRET",
};
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  admin = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  for (const [k, v] of Object.entries({ ...SECRETS, EMAIL_PROVIDER: "resend", EMAIL_FROM: "noreply@example.invalid", FILE_STORAGE: "s3" })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("diagnostics.no_secrets (Phase 5 cards)", () => {
  it("renders counts, names, versions and states only; no variable value or connection string appears", async () => {
    await db.insert(backgroundJobs).values({
      organizationId: kit.orgId,
      jobKind: "inventory.reconcile",
      status: "failed",
      payload: {},
      idempotencyKey: `t:${randomUUID()}`,
      correlationId: "c",
      errorMessage: "connect failed postgres://bc_app:hunter2pass@db.internal:5432/app token=abcdefghijklmnopqrstuvwxyz123",
      finishedAt: new Date(),
      deadLetteredAt: new Date(),
    });
    const cards = { database: await databaseCard(admin), imports: await importsCard(admin), alerts: await alertsCard(admin), errors: await errorsCard(admin), integrations: integrationsCard(admin) };
    const json = JSON.stringify(cards);
    for (const v of Object.values(SECRETS)) expect(json).not.toContain(v);
    expect(json).not.toContain("hunter2pass");
    expect(json).not.toContain("abcdefghijklmnopqrstuvwxyz123");
    expect(json).not.toContain(process.env.DATABASE_URL!);
    expect(cards.database.serverVersion).toMatch(/^\d+/);
    expect(cards.database.tables.length).toBeGreaterThan(0);
    expect(cards.database.connections.max).toBeGreaterThan(0);
    expect(cards.errors.deadLettered24h).toBe(1);
    expect(cards.errors.reporting).toBe("provider");
    expect(cards.errors.recentFailures[0].jobKind).toBe("inventory.reconcile");
  });

  it("integrations show configured / setup required / not built per adapter", () => {
    const byName = Object.fromEntries(integrationsCard(admin).adapters.map((a) => [a.name, a]));
    expect(byName.Email.status).toBe("configured"); // resend + key + from present
    expect(byName["File storage"].status).toBe("setup_required"); // s3 without endpoint/bucket/key id
    expect(byName["Error reporting"].status).toBe("configured");
    expect(byName["Payment provider"].status).toBe("not_built");
    delete process.env.RESEND_API_KEY;
    expect(integrationsCard(admin).adapters.find((a) => a.name === "Email")?.status).toBe("setup_required");
    process.env.RESEND_API_KEY = SECRETS.RESEND_API_KEY;
  });

  it("the import wizard can register its import runs on the Imports card", async () => {
    expect((await importsCard(admin)).wizardAvailable).toBe(false);
    registerImportStatsProvider("test", async () => [{ label: "Master data imports", total: 3, failed: 1, lastAt: null }]);
    const c = await importsCard(admin);
    expect(c.wizardAvailable).toBe(true);
    expect(c.sources).toEqual([{ label: "Master data imports", total: 3, failed: 1, lastAt: null }]);
  });

  it("needs platform.diagnostics.view (site managers have none)", async () => {
    await expectCode(databaseCard(manager), "forbidden");
    await expectCode(errorsCard(manager), "forbidden");
    expect(() => integrationsCard(manager)).toThrow(/permission/);
  });
});

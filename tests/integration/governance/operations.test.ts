/**
 * US-1-25 / US-1-26 / W1A open items against a real database: the shared rate-limit store
 * (auth.ratelimit.login_ip, scan.ratelimit, API limit), errors.no_stack_in_response, correlation
 * ids on audit rows, diagnostics Health/Backups/Variables (diagnostics.no_secrets,
 * authz.role_escalation.missing_permission), platform.metrics_sample and platform.alerts_evaluate.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { auditEvents, backgroundJobs, backupRuns, metricsSamples, notifications, rateLimitBuckets, settings, workerHeartbeats } from "@/db/schema";
import { commands } from "@/lib/api/contract";
import { executeCommand } from "@/lib/api/server";
import { audit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import type { AuthContext } from "@/lib/auth/context";
import { consume, limitApi, sweepBuckets } from "@/lib/rate-limit";
import { backupsCard, healthCard, variablesCard } from "@/modules/governance";
import { deliverAlerts, evaluateAlerts, sampleMetrics } from "@/modules/governance/jobs/metrics";
import { resolveScanCard } from "@/modules/scan";
import { signIn } from "@/app/(auth)/sign-in/actions";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit } from "../../support/kit";

let kit: Kit;
let admin: AuthContext;
let manager: AuthContext;
let wh: AuthContext;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  admin = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
});

describe("shared rate-limit store", () => {
  it("window limit: up to capacity per window, then refused with Retry-After; refused calls do not consume; one row per key", async () => {
    const t0 = new Date("2026-10-23T00:00:00Z");
    const limit = { capacity: 5, windowSeconds: 60 };
    const results = await Promise.all(Array.from({ length: 7 }, () => consume(db, { scope: "test", key: "k1", limit, now: t0 })));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.find((r) => !r.allowed)!.retryAfterSeconds).toBe(60);
    const later = await consume(db, { scope: "test", key: "k1", limit, now: new Date(t0.getTime() + 45_000) });
    expect(later).toMatchObject({ allowed: false, retryAfterSeconds: 15 });
    expect((await consume(db, { scope: "test", key: "k1", limit, now: new Date(t0.getTime() + 60_000) })).allowed).toBe(true);
    expect(await db.select().from(rateLimitBuckets).where(and(eq(rateLimitBuckets.scope, "test"), eq(rateLimitBuckets.key, "k1")))).toHaveLength(1);
    expect(await sweepBuckets(db, 24, new Date(t0.getTime() + 25 * 3_600_000))).toBeGreaterThanOrEqual(1);
  });

  it("auth.ratelimit.login_ip: the 21st sign-in attempt in a minute from one address is refused before any lookup", async () => {
    const fd = () => {
      const f = new FormData();
      f.set("email", "nobody@bryels-care.test");
      f.set("password", "wrong");
      return f;
    };
    const out = [];
    for (let i = 0; i < 21; i++) out.push(await signIn(null, fd()));
    expect(out.slice(0, 20).every((r) => r?.message === "Email or password is incorrect.")).toBe(true);
    expect(out[20]?.message).toMatch(/Too many sign-in attempts/);
    await db.delete(rateLimitBuckets).where(like(rateLimitBuckets.scope, "login_ip%"));
  });

  it("scan.ratelimit: look-ups beyond the configured per-minute limit are refused (shared across replicas)", async () => {
    await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: "platform.rate_limits", value: { api_per_minute: 600, scan_lookups_per_minute: 10, login_ip_per_minute: 20, login_ip_per_hour: 200 } });
    const outcomes = [];
    for (let i = 0; i < 11; i++) outcomes.push((await resolveScanCard(wh, "BC:LOC:NOPE-XYZ")).outcome);
    expect(outcomes.slice(0, 10).includes("rate_limited")).toBe(false);
    expect(outcomes[10]).toBe("rate_limited");
  });

  it("authenticated API limit per user (setting platform.rate_limits)", async () => {
    await db.update(settings).set({ value: { api_per_minute: 10, scan_lookups_per_minute: 10, login_ip_per_minute: 20, login_ip_per_hour: 200 } }).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, "platform.rate_limits")));
    const r = [];
    for (let i = 0; i < 11; i++) r.push(await limitApi(kit.orgId, manager.userId));
    expect(r.filter((x) => x.allowed)).toHaveLength(10);
    expect(r[10].retryAfterSeconds).toBeGreaterThan(0);
    await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, "platform.rate_limits")));
  });
});

describe("errors and correlation", () => {
  it("errors.no_stack_in_response: an unexpected failure is 500 INTERNAL with no stack or message leak", async () => {
    const res = await executeCommand(commands.transferStock, wh, { body: { commandId: uuidv7(), siteId: kit.nfd.id, payload: { lotId: randomUUID(), fromLocationId: randomUUID(), toLocationId: randomUUID(), qty: "1", reason: "test reason" } }, idempotencyKey: randomUUID(), requestId: "req-test-0001" }, async () => {
      throw new Error("connection to 10.0.0.5 refused at /srv/app/secret.ts:12");
    });
    expect(res.status).toBe(500);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/10\.0\.0\.5|secret\.ts|at \//);
    expect(res.body).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
  });

  it("the request id is the correlation id of the audit rows written with that context", async () => {
    const ctx = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd], { correlationId: "req-corr-12345" });
    const id = await audit(db, ctx, { action: "platform.test.logged", entityType: "test", siteId: null });
    const [row] = await db.select().from(auditEvents).where(eq(auditEvents.id, id!));
    expect(row.correlationId).toBe("req-corr-12345");
  });
});

describe("diagnostics cards (US-1-26)", () => {
  afterEach(() => {
    delete process.env.BACKUP_STATUS_SOURCE;
  });

  it("authz.role_escalation.missing_permission: a site manager cannot read Health, Backups or Variables", async () => {
    await expectCode(healthCard(manager), "forbidden");
    await expectCode(backupsCard(manager), "forbidden");
    await expectCode(variablesCard(manager), "forbidden");
  });

  it("Health shows database, migrations current and the worker heartbeat", async () => {
    const h = await healthCard(admin);
    expect(h.web.database).toBe("ok");
    expect(h.migrations.current).toBe(true);
    expect(h.worker.present).toBe(false);
    await db.insert(workerHeartbeats).values({ workerId: "w-test", hostname: "worker-test", releaseTag: "abc", lastHeartbeatAt: new Date(), envPresence: { DATABASE_URL: true, WORKER_CONCURRENCY: false } });
    const h2 = await healthCard(admin);
    expect(h2.worker).toMatchObject({ present: true, alive: true, release: "abc" });
  });

  it("diagnostics.no_secrets: Variables lists names and presence only", async () => {
    process.env.ERROR_REPORTING_DSN = "https://supersecretkey123@errors.example.test/42";
    const v = await variablesCard(admin);
    const text = JSON.stringify(v);
    expect(text).not.toContain("supersecretkey123");
    expect(text).not.toContain(process.env.DATABASE_URL!);
    const web = v.services.find((s) => s.service === "web")!;
    expect(web.variables.find((x) => x.name === "DATABASE_URL")?.present).toBe(true);
    expect(web.variables.find((x) => x.name === "ERROR_REPORTING_DSN")?.present).toBe(true);
    const worker = v.services.find((s) => s.service === "worker")!;
    expect(worker.variables.find((x) => x.name === "WORKER_CONCURRENCY")?.present).toBe(false);
    delete process.env.ERROR_REPORTING_DSN;
  });

  it("Backups: 'not configured' honestly without a status source; reads backup_runs when configured", async () => {
    expect(await backupsCard(admin)).toEqual({ configured: false, source: null });
    process.env.BACKUP_STATUS_SOURCE = "table";
    const empty = await backupsCard(admin);
    expect(empty).toMatchObject({ configured: true, lastSuccess: null, overdue: true, lastRestoreDrill: null });
    const now = new Date("2026-10-23T10:00:00Z");
    await db.insert(backupRuns).values({ organizationId: kit.orgId, kind: "scheduled", label: "nightly (test)", startedAt: new Date("2026-10-22T18:17:00Z"), finishedAt: new Date("2026-10-22T18:30:00Z"), status: "succeeded", bucketKey: "backups/test/db.dump.age", offsiteBucketKey: "offsite/db.dump.age", sizeBytes: 1024 });
    const b = await backupsCard(admin, now);
    expect(b).toMatchObject({ configured: true, overdue: false, lastSuccess: { offsiteOk: true, ageHours: 15.5 } });
  });
});

describe("platform.metrics_sample and platform.alerts_evaluate", () => {
  it("samples metrics into metrics_samples and prunes old samples", async () => {
    const now = new Date();
    await db.insert(metricsSamples).values({ organizationId: kit.orgId, sampledAt: new Date(now.getTime() - 100 * 86_400_000), metric: "old", value: "1" });
    const r = await sampleMetrics(kit.orgId, now);
    expect(r.samples).toBeGreaterThanOrEqual(5);
    const rows = await db.select().from(metricsSamples).where(eq(metricsSamples.organizationId, kit.orgId));
    expect(rows.some((x) => x.metric === "old")).toBe(false);
    expect(rows.map((x) => x.metric)).toEqual(expect.arrayContaining(["jobs.queue_depth", "jobs.failed_last_hour", "database.size_bytes"]));
  });

  it("alerts: a silent worker and a dead-lettered job notify system_admin once per window", async () => {
    // Frozen clock at the start of a dedupe window, so "a minute later" is always the same window (the
    // test used to fail when a run crossed the window boundary, e.g. the hour).
    const windowMs = (await getSetting(db, kit.orgId, "alerts.dedupe_minutes")) * 60_000;
    const now = new Date(Math.floor(Date.now() / windowMs) * windowMs + 5_000);
    await db.update(workerHeartbeats).set({ lastHeartbeatAt: new Date(now.getTime() - 900_000) });
    await db.insert(backgroundJobs).values({ organizationId: kit.orgId, jobKind: "inventory.reconcile", status: "failed", payload: {}, idempotencyKey: `test:${randomUUID()}`, correlationId: "c", deadLetteredAt: new Date(now.getTime() - 60_000), finishedAt: new Date(now.getTime() - 60_000) });
    const f = await evaluateAlerts(kit.orgId, now);
    expect(f.map((x) => x.code).sort()).toEqual(["failed_jobs", "worker_down"]);
    const first = await deliverAlerts(kit.orgId, now);
    expect(first.delivered).toBeGreaterThanOrEqual(2);
    const again = await deliverAlerts(kit.orgId, new Date(now.getTime() + 60_000));
    expect(again.delivered).toBe(0);
    const rows = await db.select().from(notifications).where(like(notifications.kind, "alert.%"));
    expect(rows.every((n) => n.severity === "critical")).toBe(true);
  });
});

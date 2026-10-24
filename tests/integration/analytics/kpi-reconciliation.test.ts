/**
 * US-5-01 KPI definitions, snapshots and reconciliation (docs/analytics-kpis.md §1.4, §4.3; AC-21).
 * Fixed clock: the fictional month 2025-03-01..2025-03-31 is seeded through src/db/seeds/w3a.ts,
 * then analytics.snapshot_kpis runs at 01:30 Manila on 2025-04-01 and analytics.reconcile_kpis at
 * 02:00. Tests: analytics.kpi.reconciles_to_source (per KPI), snapshot idempotency, append-only
 * snapshots, mismatch → critical notification, definitions expose the explainability contract.
 */
import Decimal from "decimal.js";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { kpiDefinitions, kpiReconciliationResults, kpiRefreshLog, kpiSnapshots, notifications, roles, salesOrders, userSiteAssignments, users } from "@/db/schema";
import { seedW3a } from "@/db/seeds/w3a";
import { analyticsReconcileKpisJob, analyticsSnapshotKpisJob } from "@/modules/analytics/jobs";
import { KPIS, kpiByCode } from "@/modules/analytics/kpi/catalogue";
import { computeSnapshots, fromStored, rQuery } from "@/modules/analytics/kpi/engine";
import { enqueueJob, runJob, systemContext } from "@/modules/platform/jobs";
import { cancelOrder } from "@/modules/sales/orders";
import { customMigration } from "../../support/custom-sql";
import { resetTestDatabase } from "../../support/db";
import { asUser, type Kit, loadKit } from "../../support/kit";

const SNAPSHOT_AT = new Date("2025-03-31T17:30:00.000Z"); // 2025-04-01 01:30 Asia/Manila
const RECONCILE_AT = new Date("2025-03-31T18:00:00.000Z"); // 02:00
const BUSINESS_DATE = "2025-03-31";

let kit: Kit;

async function runScheduled(def: typeof analyticsSnapshotKpisJob, now: Date, trigger: "schedule" | "manual" = "schedule") {
  const ctx = await systemContext(kit.orgId, def);
  const { job, created } = await enqueueJob(db, ctx, def, { asOf: now.toISOString(), businessDate: null, trigger });
  const out = await runJob(job.id, { now });
  return { job, created, out };
}

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  const r = await seedW3a(db, { endDate: "2025-04-01", now: SNAPSHOT_AT });
  expect(r.skipped).toBe(false);
}, 180_000);

describe("W3A custom SQL", () => {
  it("the custom migration is a verbatim copy of src/db/sql/w3a.sql and is in the journal", () => {
    const { migration, canonical } = customMigration("w3a");
    expect(migration.endsWith(canonical)).toBe(true);
  });
});

describe("analytics.snapshot_kpis (fixed clock)", () => {
  it("writes one snapshot per KPI, scope and grain for the business day, as of its end", async () => {
    const { out } = await runScheduled(analyticsSnapshotKpisJob, SNAPSHOT_AT);
    expect(out.status).toBe("succeeded");
    const snaps = await db.select().from(kpiSnapshots).where(eq(kpiSnapshots.asOfDate, BUSINESS_DATE));
    const periodKpis = KPIS.filter((k) => k.kind === "period").length;
    const asofKpis = KPIS.filter((k) => k.kind === "asof").length;
    const scopes = 3; // NFD, RVS, all
    expect(snaps.length).toBe((periodKpis * 3 + asofKpis) * scopes);
    for (const s of snaps) {
      expect(s.asOf.toISOString()).toBe("2025-03-31T16:00:00.000Z"); // end of 31 March, Manila
      expect(s.periodEnd).toBe("2025-04-01");
    }
    const month = snaps.filter((s) => s.grain === "month");
    expect(new Set(month.map((s) => s.periodStart))).toEqual(new Set(["2025-03-01"]));
    expect(new Set(snaps.filter((s) => s.grain === "week").map((s) => s.periodStart))).toEqual(new Set(["2025-03-31"])); // Monday
    const [log] = await db.select().from(kpiRefreshLog).where(and(eq(kpiRefreshLog.runKind, "snapshot"), eq(kpiRefreshLog.businessDate, BUSINESS_DATE)));
    expect(log.status).toBe("succeeded");
    expect(log.snapshotsWritten).toBe(snaps.length);
  });

  it("is idempotent: the same tick reuses the job, and recomputing inserts nothing", async () => {
    const again = await runScheduled(analyticsSnapshotKpisJob, SNAPSHOT_AT);
    expect(again.created).toBe(false);
    const before = await db.select({ n: sql<number>`count(*)::int` }).from(kpiSnapshots);
    const sites = (await db.execute<{ id: string; tz: string }>(sql`select id, timezone as tz from sites`)) as unknown as { id: string; tz: string }[];
    const r = await computeSnapshots(db, { organizationId: kit.orgId, sites: [...sites], orgTz: "Asia/Manila", businessDate: BUSINESS_DATE, now: SNAPSHOT_AT, settings: { fefoWindowDays: 30, otifGraceDays: 0 }, refreshLogId: null });
    expect(r.written).toBe(0);
    const after = await db.select({ n: sql<number>`count(*)::int` }).from(kpiSnapshots);
    expect(after[0].n).toBe(before[0].n);
  });

  it("every KPI exposes definition, calculation, time basis, sources, refresh class, value label and version", async () => {
    const defs = await db.select().from(kpiDefinitions);
    for (const k of KPIS) {
      const d = defs.find((x) => x.kpiCode === k.code);
      expect(d, k.code).toBeTruthy();
      expect(d!.definition.length).toBeGreaterThan(20);
      expect(d!.formulaText.length).toBeGreaterThan(5);
      expect(d!.timeBasis.length).toBeGreaterThan(3);
      expect((d!.sources as string[]).length).toBeGreaterThan(0);
      expect(["post", "live", "mv15", "night", "wk"]).toContain(d!.refreshClass);
      expect(["actual", "estimate", "forecast", "overridden"]).toContain(d!.valueLabel);
      expect(d!.versionNo).toBe(1);
      expect(d!.drillRoute).toBe(`/analytics/kpi/${k.code}`);
    }
    expect(defs.find((d) => d.kpiCode === "KPI-FIN-02")!.valueLabel).toBe("estimate");
  });

  it("snapshots are append-only (database trigger)", async () => {
    const [s] = await db.select().from(kpiSnapshots).limit(1);
    const refused = { cause: expect.objectContaining({ message: expect.stringMatching(/append-only/) }) };
    await expect(db.update(kpiSnapshots).set({ value: "1" }).where(eq(kpiSnapshots.id, s.id))).rejects.toMatchObject(refused);
    await expect(db.delete(kpiSnapshots).where(eq(kpiSnapshots.id, s.id))).rejects.toMatchObject(refused);
    const [d] = await db.select().from(kpiDefinitions).limit(1);
    await expect(db.update(kpiDefinitions).set({ name: "changed" }).where(eq(kpiDefinitions.id, d.id))).rejects.toMatchObject(refused);
  });

  it("the seeded month gives meaningful values (fictional data, deterministic)", async () => {
    const all = await db.select().from(kpiSnapshots).where(and(eq(kpiSnapshots.asOfDate, BUSINESS_DATE), eq(kpiSnapshots.scopeKey, "all")));
    const v = (code: string, grain = "month") => all.find((s) => s.kpiCode === code && s.grain === (kpiByCode(code)!.kind === "asof" ? "day" : grain))!;
    expect(Number(v("KPI-SAL-01").value)).toBeGreaterThan(15);
    expect(Number(v("KPI-OPS-02").value)).toBeGreaterThan(0.9);
    expect(Number(v("KPI-OPS-02").value)).toBeLessThan(1.05);
    expect(v("KPI-OPS-02").rowCount).toBeGreaterThan(20);
    expect(Number(v("KPI-SAL-02").value)).toBeGreaterThan(0.3);
    expect(Number(v("KPI-SAL-02").value)).toBeLessThan(1);
    expect(Number(v("KPI-QUA-03").value)).toBe(1); // one hold still open at the end of March
    expect(Number(v("KPI-INV-04").value)).toBeGreaterThanOrEqual(1);
    expect(Number(v("KPI-INV-04E").value)).toBeGreaterThanOrEqual(1);
    expect(Number(v("KPI-OPS-14").value)).toBeGreaterThanOrEqual(1);
    expect(Number(v("KPI-QUA-05").value)).toBe(2); // the rejected batch and its output lot
    expect(Number(v("KPI-OWN-13").value)).toBe(3);
    expect(v("KPI-FIN-02").valueLabel).toBe("estimate");
  });

  it("all sites equals the sum of the sites for additive KPIs (rule 1.4.4)", async () => {
    const snaps = await db.select().from(kpiSnapshots).where(and(eq(kpiSnapshots.asOfDate, BUSINESS_DATE), eq(kpiSnapshots.grain, "month")));
    for (const code of ["KPI-SAL-01", "KPI-SAL-02", "KPI-FIN-02", "KPI-OPS-02"]) {
      const rows = snaps.filter((s) => s.kpiCode === code);
      const all = rows.find((s) => s.scopeKey === "all")!;
      const parts = rows.filter((s) => s.scopeKey !== "all");
      expect(parts.length).toBe(2);
      expect(parts.reduce((a, s) => a.plus(s.numerator), new Decimal(0)).eq(all.numerator), code).toBe(true);
      if (all.denominator !== null) expect(parts.reduce((a, s) => a.plus(s.denominator ?? 0), new Decimal(0)).eq(all.denominator), code).toBe(true);
    }
  });
});

describe("analytics.kpi.reconciles_to_source", () => {
  it.each(KPIS.map((k) => k.code))("%s: every snapshot equals its R-query recomputation exactly", async (code) => {
    const def = kpiByCode(code)!;
    const snaps = await db.select().from(kpiSnapshots).where(and(eq(kpiSnapshots.asOfDate, BUSINESS_DATE), eq(kpiSnapshots.kpiCode, code)));
    expect(snaps.length).toBeGreaterThan(0);
    for (const s of snaps) {
      const re = await rQuery(db, def, fromStored(s.params as Parameters<typeof fromStored>[0], "ledger"));
      expect(re.rowCount, `${code} ${s.scopeKey} ${s.grain}`).toBe(s.rowCount);
      expect(new Decimal(re.numerator.toFixed(10)).eq(s.numerator), `${code} ${s.scopeKey} numerator`).toBe(true);
      if (s.value === null) expect(re.value).toBeNull();
      else expect(new Decimal(re.value!.toFixed(10)).eq(s.value), `${code} ${s.scopeKey} ${s.grain} ${s.value} vs ${re.value}`).toBe(true);
    }
  });

  it("analytics.reconcile_kpis records a match for every snapshot and raises nothing", async () => {
    const { out } = await runScheduled(analyticsReconcileKpisJob, RECONCILE_AT);
    expect(out.status).toBe("succeeded");
    expect((out as { result: { checked: number; mismatches: number } }).result).toMatchObject({ mismatches: 0 });
    const snaps = await db.select({ n: sql<number>`count(*)::int` }).from(kpiSnapshots).where(eq(kpiSnapshots.asOfDate, BUSINESS_DATE));
    const results = await db.select().from(kpiReconciliationResults);
    expect(results.length).toBe(snaps[0].n);
    expect(results.every((r) => r.status === "match")).toBe(true);
    const alerts = await db.select().from(notifications).where(eq(notifications.kind, "kpi_reconciliation_mismatch"));
    expect(alerts).toHaveLength(0);
  });

  it("a source change after the snapshot is a mismatch with a critical notification to system_admin and the owner; nothing is corrected", async () => {
    // A confirmed March order that never shipped is cancelled after the night's snapshot.
    const [order] = await db
      .select()
      .from(salesOrders)
      .where(and(eq(salesOrders.status, "confirmed"), sql`${salesOrders.orderNumber} like 'SOM-%'`, sql`${salesOrders.createdAt} < '2025-03-31T16:00:00Z'`))
      .limit(1);
    expect(order).toBeTruthy();
    const sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd, kit.rvs]); // W3D: cancelling needs sales.sales_order.void (sales_cs)
    await cancelOrder(sales, order.id, "Customer withdrew the order (test).");
    const before = await db.select().from(kpiSnapshots).where(and(eq(kpiSnapshots.kpiCode, "KPI-SAL-01"), eq(kpiSnapshots.scopeKey, "all"), eq(kpiSnapshots.grain, "month")));

    const { out } = await runScheduled(analyticsReconcileKpisJob, new Date(RECONCILE_AT.getTime() + 3600_000), "manual");
    expect(out.status).toBe("succeeded");
    const [log] = await db.select().from(kpiRefreshLog).where(eq(kpiRefreshLog.id, (out as { result: { refreshLogId: string } }).result.refreshLogId));
    expect(log.mismatches).toBeGreaterThan(0);
    const bad = await db.select().from(kpiReconciliationResults).where(and(eq(kpiReconciliationResults.refreshLogId, log.id), eq(kpiReconciliationResults.status, "mismatch")));
    expect(bad.map((b) => b.kpiCode)).toEqual(expect.arrayContaining(["KPI-SAL-01", "KPI-SAL-01V"]));
    const sal = bad.find((b) => b.kpiCode === "KPI-SAL-01" && b.scopeKey === "all" && b.grain === "month")!;
    expect(new Decimal(sal.snapshotValue!).minus(sal.recomputedValue!).toNumber()).toBe(1);
    expect(sal.detail).toMatch(/R-query/);

    const alerts = await db.select().from(notifications).where(eq(notifications.kind, "kpi_reconciliation_mismatch"));
    expect(alerts.every((a) => a.severity === "critical")).toBe(true);
    const recipients = await db
      .select({ role: roles.code })
      .from(userSiteAssignments)
      .innerJoin(roles, eq(roles.id, userSiteAssignments.roleId))
      .innerJoin(users, eq(users.id, userSiteAssignments.userId))
      .where(inArray(users.id, alerts.map((a) => a.recipientUserId)));
    expect(new Set(recipients.map((r) => r.role))).toEqual(new Set(["system_admin", "owner_director"]));

    const after = await db.select().from(kpiSnapshots).where(and(eq(kpiSnapshots.kpiCode, "KPI-SAL-01"), eq(kpiSnapshots.scopeKey, "all"), eq(kpiSnapshots.grain, "month")));
    expect(after.map((s) => s.value)).toEqual(before.map((s) => s.value)); // the snapshot keeps what was reported
  });

  it("a snapshot run for a future business day fails, is logged as failed and never writes values", async () => {
    const ctx = await systemContext(kit.orgId, analyticsSnapshotKpisJob);
    const { job } = await enqueueJob(db, ctx, analyticsSnapshotKpisJob, { asOf: SNAPSHOT_AT.toISOString(), businessDate: "2025-04-05", trigger: "manual" });
    const out = await runJob(job.id, { now: SNAPSHOT_AT });
    expect(out.status).toBe("failed");
    const n = await db.select({ n: sql<number>`count(*)::int` }).from(kpiSnapshots).where(eq(kpiSnapshots.asOfDate, "2025-04-05"));
    expect(n[0].n).toBe(0);
  });
});

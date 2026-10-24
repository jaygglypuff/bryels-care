/**
 * US-5-02 owner overview and site comparison, US-5-03 area dashboards, US-5-16 trends
 * (docs/analytics-kpis.md §1.5, §3; docs/ux-system.md §9.2, §9.15). Fixed clock: "today" is
 * 2025-04-01 10:00 Manila, the fictional month of March 2025 is seeded and its nightly snapshots are
 * backfilled through the real engine. A third fictional site (SLK) exists that the site manager is
 * not assigned to. Tests: analytics.owner_dashboard_filters_to_allowed_sites (overview and trends),
 * financial masking in the DTO, cross-site and role-escalation negatives, drill-down = tile, inventory
 * totals = ledger, stale badge, trends table twin = snapshots, saved views are private.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { kpiSnapshots, organizations, sites } from "@/db/schema";
import { seedW3a } from "@/db/seeds/w3a";
import type { AuthContext, SiteRef } from "@/lib/auth/context";
import { analyticsSnapshotKpisJob } from "@/modules/analytics/jobs";
import { deleteTrendView, getAreaDashboard, getKpiRecords, getOwnerOverview, getTrends, listTrendViews, saveTrendView, snapshotFreshness } from "@/modules/analytics";
import { enqueueJob, runJob, systemContext } from "@/modules/platform/jobs";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit } from "../../support/kit";

const NOW = new Date("2025-04-01T02:00:00.000Z"); // 10:00 Manila
let kit: Kit;
let slk: SiteRef;
let owner: AuthContext;
let sm2: AuthContext; // site manager at NFD and RVS
let sm1: AuthContext; // site manager at NFD only
let salesCs: AuthContext;
let operator: AuthContext;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  const [org] = await db.select().from(organizations).limit(1);
  const [row] = await db.insert(sites).values({ organizationId: org.id, code: "SLK", name: "Silang Lakeside Depot (fictional)" }).returning();
  slk = { id: row.id, code: row.code, name: row.name };
  await seedW3a(db, { endDate: "2025-04-01", now: NOW, backfill: true });
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs, slk]);
  sm2 = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd, kit.rvs]);
  sm1 = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  salesCs = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd, kit.rvs]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
}, 240_000);

describe("US-5-02 owner overview", () => {
  it("owner_director opens All sites: owner KPI tiles with value, previous period, sparkline, label and drill-down", async () => {
    const o = await getOwnerOverview(owner, { now: NOW, period: "last_month" });
    expect(o.scope.all).toBe(true);
    expect(o.scope.siteIds.sort()).toEqual([kit.nfd.id, kit.rvs.id, slk.id].sort());
    expect(o.period).toMatchObject({ fromDate: "2025-03-01", toDate: "2025-04-01", previousFromDate: "2025-02-01" });
    for (const code of ["KPI-SAL-01", "KPI-OPS-01", "KPI-INV-04", "KPI-QUA-03", "KPI-OPS-02", "KPI-INV-07", "KPI-SAL-02", "KPI-FIN-02", "KPI-OWN-13"]) {
      const t = o.tiles[code];
      expect(t.masked, code).toBe(false);
      expect(t.current, code).not.toBeNull();
      if (code !== "KPI-OWN-13") expect(t.previous, code).not.toBeNull();
      expect(t.href).toBe(`/analytics/kpi/${code}?scope=all&from=2025-03-01&to=2025-04-01`);
    }
    expect(Number(o.tiles["KPI-SAL-01"].current!.value)).toBeGreaterThan(15);
    expect(o.tiles["KPI-FIN-02"].label).toBe("estimate");
    expect(o.tiles["KPI-SAL-01"].sparkline?.length).toBe(12);
    expect(o.tiles["KPI-SAL-02"].breakdown!.map((b) => b.key)).toEqual(expect.arrayContaining(["on_time", "late"]));
    expect(o.unavailable.map((u) => u.code)).toEqual(["KPI-OWN-03", "KPI-OWN-07", "KPI-OWN-11", "KPI-OWN-12"]);
    expect(o.unavailable.every((u) => !u.masked)).toBe(true);
    expect(o.exceptions!.length).toBe(3);
    expect(o.exceptions![0].category).toBe("critical");
    expect(o.freshness.stale).toBe(false);
    expect(o.comparison!.map((r) => r.siteCode).sort()).toEqual(["NFD", "RVS", "SLK"]);
    const nfd = o.comparison!.find((r) => r.siteCode === "NFD")!;
    expect(nfd.cells["KPI-OPS-02"].masked).toBe(false);
    expect(Number(nfd.cells["KPI-OPS-02"].value)).toBeGreaterThan(0.9);
    expect(nfd.cells["KPI-OWN-07"]).toMatchObject({ unavailable: true, value: null });
  });

  it("every tile equals the total of its drill-down records (the R-query rows)", async () => {
    const o = await getOwnerOverview(owner, { now: NOW, period: "last_month" });
    for (const code of ["KPI-SAL-01", "KPI-OPS-02", "KPI-SAL-02", "KPI-QUA-03", "KPI-INV-04"]) {
      const r = await getKpiRecords(owner, code, { scope: "all", from: o.period.fromDate, to: o.period.toDate, now: NOW });
      expect(r.total, code).toEqual(o.tiles[code].current);
      expect(r.rows.length, code).toBe(r.total.rowCount);
      expect(r.version?.versionNo).toBe(1);
    }
  });

  it("analytics.owner_dashboard_filters_to_allowed_sites: a site manager with two sites compares exactly those two", async () => {
    const o = await getOwnerOverview(sm2, { now: NOW, period: "last_month" });
    expect(o.scope.all).toBe(false);
    expect(o.canCrossSite).toBe(false);
    expect(o.comparison!.map((r) => r.siteCode).sort()).toEqual(["NFD", "RVS"]);
    const json = JSON.stringify(o);
    expect(json).not.toContain(slk.id);
    expect(json).not.toContain("SLK");
    expect(json).not.toContain("Silang");
  });

  it("cross-site scope needs analytics.owner_dashboard.view; a site outside the scope is not found", async () => {
    await expectCode(getOwnerOverview(sm2, { now: NOW, scope: "all" }), "forbidden");
    await expectCode(getOwnerOverview(sm1, { now: NOW, scope: kit.rvs.id }), "not_found");
    await expectCode(getOwnerOverview(sm2, { now: NOW, scope: slk.id }), "not_found");
    const one = await getOwnerOverview(sm1, { now: NOW });
    expect(one.scope.siteIds).toEqual([kit.nfd.id]);
    expect(one.comparison).toBeNull();
  });

  it("financial tiles appear only with analytics.financial_kpi.view and are masked in the DTO otherwise", async () => {
    const o = await getOwnerOverview(sm2, { now: NOW, period: "last_month" });
    for (const code of ["KPI-FIN-02", "KPI-SAL-01V"]) {
      expect(o.tiles[code]).toMatchObject({ masked: true, current: null, previous: null, sparkline: null });
    }
    expect(o.unavailable.find((u) => u.code === "KPI-OWN-12")!.masked).toBe(true);
    const rvs = o.comparison!.find((r) => r.siteCode === "RVS")!;
    expect(rvs.cells["KPI-FIN-02"]).toMatchObject({ masked: true, value: null });
    expect(o.tiles["KPI-OWN-13"].masked).toBe(true); // exceptions are owner-class
    await expectCode(getKpiRecords(sm2, "KPI-FIN-02", { scope: kit.nfd.id, now: NOW }), "forbidden");
  });

  it("role escalation: a user without analytics.dashboard.view gets nothing", async () => {
    await expectCode(getOwnerOverview(operator, { now: NOW }), "forbidden");
    await expectCode(getAreaDashboard(operator, "operations", { now: NOW }), "forbidden");
    await expectCode(getKpiRecords(operator, "KPI-OPS-02", { now: NOW }), "forbidden");
    await expectCode(getTrends(operator, { codes: ["KPI-OPS-02"], grain: "day", span: 14, comparison: "none" }, NOW), "forbidden");
  });

  it("module permissions still apply: sales_cs sees sales tiles, production tiles are masked", async () => {
    const o = await getOwnerOverview(salesCs, { now: NOW, period: "last_month" });
    expect(o.tiles["KPI-SAL-01"].masked).toBe(false);
    expect(o.tiles["KPI-OPS-02"].masked).toBe(true);
    expect(o.tiles["KPI-OPS-01"].masked).toBe(true);
  });
});

describe("US-5-03 operations, inventory, quality and sales dashboards", () => {
  it("inventory totals equal the ledger: usable and blocked stock from the projection match the ledger recomputation", async () => {
    const d = await getAreaDashboard(sm1, "inventory", { now: NOW });
    expect(d.ledgerCheck!.length).toBe(3);
    for (const c of d.ledgerCheck!) expect(c.agrees, c.code).toBe(true);
    const [direct] = (await db.execute<{ q: string }>(sql`
      select (coalesce(sum(m.qty_base) filter (where m.to_location_id is not null), 0) - coalesce(sum(m.qty_base) filter (where m.from_location_id is not null), 0))::text as q
        from stock_movements m join inventory_lots l on l.id = m.lot_id
       where m.site_id = ${kit.nfd.id} and l.base_uom = 'g' and l.quality_status = 'released' and (l.expires_on is null or l.expires_on >= '2025-04-01')
         and m.posted_at <= ${NOW.toISOString()}::timestamptz`)) as unknown as { q: string }[];
    expect(Number(d.tiles["KPI-INV-01G"].current!.value)).toBe(Number(direct.q));
    expect(d.lists.fefo_risk.length).toBeGreaterThanOrEqual(1);
  });

  it("operations: per-day output vs plan (the chart and its table twin come from the same rows)", async () => {
    const d = await getAreaDashboard(sm1, "operations", { now: NOW, period: "last_month" });
    const t = d.tiles["KPI-OPS-01"];
    expect(t.daily!.length).toBe(31);
    const sumNum = t.daily!.reduce((a, p) => a + Number(p.numerator), 0);
    expect(sumNum).toBeCloseTo(Number(t.current!.numerator), 6);
    expect(d.lists.late_work_orders.length).toBeGreaterThanOrEqual(1);
  });

  it("quality and sales dashboards load with breakdowns; sales_cs sees production KPIs masked", async () => {
    const q = await getAreaDashboard(sm2, "quality", { now: NOW, scope: kit.nfd.id, period: "last_month" });
    expect(q.tiles["KPI-QUA-06"].breakdown!.length).toBeGreaterThan(0);
    expect(q.lists.open_holds.length).toBe(1);
    const s = await getAreaDashboard(salesCs, "sales", { now: NOW, scope: kit.rvs.id, period: "last_month" });
    expect(s.tiles["KPI-SAL-02"].breakdown!.length).toBeGreaterThan(0);
    const ops = await getAreaDashboard(salesCs, "operations", { now: NOW, scope: kit.nfd.id });
    // sales_cs holds production.work_order.view (W2A) but not production.batch.view
    for (const code of ["KPI-OPS-01", "KPI-OPS-02", "KPI-OPS-03", "KPI-OPS-13", "KPI-OPS-16", "KPI-OPS-07"]) expect(ops.tiles[code].masked, code).toBe(true);
    expect(ops.tiles["KPI-OPS-05"].masked).toBe(false);
  });

  it("shows a Stale badge with the failed job when the nightly snapshot fails", async () => {
    expect((await snapshotFreshness(sm1, NOW)).stale).toBe(false);
    const ctx = await systemContext(kit.orgId, analyticsSnapshotKpisJob);
    const { job } = await enqueueJob(db, ctx, analyticsSnapshotKpisJob, { asOf: NOW.toISOString(), businessDate: "2025-04-09", trigger: "manual" });
    expect((await runJob(job.id, { now: NOW })).status).toBe("failed");
    const f = await snapshotFreshness(sm1, new Date());
    expect(f.stale).toBe(true);
    expect(f.failedJobId).toBe(job.id);
    expect(f.reason).toMatch(/failed/);
    const d = await getAreaDashboard(sm1, "sales", { now: NOW });
    expect(d.freshness.stale).toBe(true);
  });
});

describe("US-5-16 trends", () => {
  it("up to six KPIs; the table twin equals the snapshots of the scope", async () => {
    const codes = ["KPI-SAL-01", "KPI-OPS-02", "KPI-SAL-02", "KPI-QUA-03", "KPI-INV-04", "KPI-FIN-02"];
    const t = await getTrends(owner, { codes, grain: "day", span: 14, comparison: "previous", scope: "all" }, NOW);
    expect(t.series.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(t.buckets.length).toBe(14);
    expect(t.buckets[13].start).toBe("2025-03-31");
    const sal = t.series[0];
    for (const [i, b] of t.buckets.entries()) {
      const [snap] = await db.select().from(kpiSnapshots).where(and(eq(kpiSnapshots.kpiCode, "KPI-SAL-01"), eq(kpiSnapshots.scopeKey, "all"), eq(kpiSnapshots.grain, "day"), eq(kpiSnapshots.periodStart, b.start)));
      expect(sal.points[i]?.value).toBe(snap ? String(Number(snap.value)) : undefined);
    }
    expect(t.series[5].label).toBe("estimate");
    expect(sal.comparison!.length).toBe(14);
    expect(t.buckets[0].href[0]).toBe("/analytics/kpi/KPI-SAL-01?scope=all&from=2025-03-18&to=2025-03-19");
    await expectCode(getTrends(owner, { codes: [...codes, "KPI-QUA-01"], grain: "day", span: 14, comparison: "none" }, NOW), "validation");
    await expectCode(getTrends(owner, { codes: ["KPI-SAL-01"], grain: "day", span: 7, comparison: "none" }, NOW), "validation");
  });

  it("week and month grains use the most complete snapshot of each bucket", async () => {
    const t = await getTrends(owner, { codes: ["KPI-SAL-01", "KPI-QUA-03"], grain: "month", span: 3, comparison: "none", scope: "all" }, NOW);
    expect(t.buckets.map((b) => b.start)).toEqual(["2025-01-01", "2025-02-01", "2025-03-01"]);
    const [march] = await db.select().from(kpiSnapshots).where(and(eq(kpiSnapshots.kpiCode, "KPI-SAL-01"), eq(kpiSnapshots.scopeKey, "all"), eq(kpiSnapshots.grain, "month"), eq(kpiSnapshots.periodStart, "2025-03-01"), eq(kpiSnapshots.asOfDate, "2025-03-31")));
    expect(Number(t.series[0].points[2]!.value)).toBe(Number(march.value));
    expect(t.series[1].points[2]).not.toBeNull(); // as-of KPI: last day snapshot of March
  });

  it("analytics.owner_dashboard_filters_to_allowed_sites (trends): cross-site only with the owner permission", async () => {
    await expectCode(getTrends(sm2, { codes: ["KPI-SAL-01"], grain: "day", span: 14, comparison: "none", scope: "all" }, NOW), "forbidden");
    await expectCode(getTrends(sm1, { codes: ["KPI-SAL-01"], grain: "day", span: 14, comparison: "none", scope: slk.id }, NOW), "not_found");
    const mine = await getTrends(sm2, { codes: ["KPI-SAL-01"], grain: "day", span: 14, comparison: "none", scope: kit.rvs.id }, NOW);
    expect(mine.scope.siteIds).toEqual([kit.rvs.id]);
    await expectCode(getTrends(sm2, { codes: ["KPI-FIN-02"], grain: "day", span: 14, comparison: "none", scope: kit.nfd.id }, NOW), "forbidden");
  });

  it("a cross-site scope that is not every site adds per-site snapshots for additive KPIs only", async () => {
    const partial = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
    const t = await getTrends(partial, { codes: ["KPI-SAL-01", "KPI-QUA-01"], grain: "day", span: 14, comparison: "none", scope: "all" }, NOW);
    expect(t.scope.coversAllActive).toBe(false);
    const all = await getTrends(owner, { codes: ["KPI-SAL-01"], grain: "day", span: 14, comparison: "none", scope: "all" }, NOW);
    expect(t.series[0].points.map((p) => Number(p?.value))).toEqual(all.series[0].points.map((p) => Number(p?.value))); // SLK has no orders
    expect(t.series[1].points.every((p) => p === null)).toBe(true);
    expect(t.series[1].note).toMatch(/median/);
  });

  it("Save view stores the caller's own selection; other users never see or delete it", async () => {
    const config = { codes: ["KPI-SAL-01", "KPI-OPS-02"], grain: "week" as const, span: 8, comparison: "previous" as const, scope: kit.nfd.id };
    const v = await saveTrendView(sm1, { name: "Weekly plant review", config });
    expect((await listTrendViews(sm1)).map((x) => x.name)).toEqual(["Weekly plant review"]);
    expect(await listTrendViews(owner)).toEqual([]);
    await expectCode(deleteTrendView(owner, v.id), "not_found");
    const again = await saveTrendView(sm1, { name: "Weekly plant review", config: { ...config, span: 12 } });
    expect(again.id).toBe(v.id);
    await expectCode(saveTrendView(sm2, { name: "All", config: { ...config, scope: "all" } }), "forbidden");
    await expectCode(saveTrendView(sm1, { name: "Money", config: { ...config, codes: ["KPI-FIN-02"] } }), "forbidden");
    await deleteTrendView(sm1, v.id);
    expect(await listTrendViews(sm1)).toEqual([]);
  });
});

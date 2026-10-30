/**
 * Owner Home (ADR-083 §4, mockup panel 1; src/modules/analytics/owner-home.ts): ONE SOURCE PER LABEL.
 * Every card count equals the row count of the list it opens (the review found "2 material lots are on
 * quality hold" next to "STOCK ON QUALITY HOLD 1" and "6 raw material lots expire within 30 days" next
 * to "STOCK EXPIRING SOON 5"), the stock numbers equal the Stock screen's warning cards, sales equal the
 * KPI drill-down rows, money is masked by permission in the DTO, and nothing crosses a site boundary.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { batches, locations } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { getKpiRecords, getOwnerHome, listStockAlerts, listWeekBatches, stockAlertCounts } from "@/modules/analytics";
import { lotKpis } from "@/modules/inventory/lots";
import { createOrder, manilaToday, submitOrder } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit, makeLot } from "../../support/kit";
import { inDays, newCustomer, productId, type W3d, loadW3d } from "../../support/w3d";

let kit: Kit;
let w: W3d;
let owner: AuthContext; // both sites, NFD current
let ownerNfd: AuthContext; // NFD only
let ownerRvs: AuthContext; // RVS only
let manager: AuthContext; // site manager, NFD only (no all-sites permission)
let salesCs: AuthContext; // dashboard, no money KPIs, no batches, no audit
let operator: AuthContext; // no analytics at all

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

async function storage(siteId: string) {
  const l = await db.query.locations.findFirst({ where: and(eq(locations.siteId, siteId), eq(locations.kind, "storage")) });
  return l!;
}

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  w = await loadW3d();
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  ownerNfd = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd]);
  ownerRvs = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  salesCs = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);

  // Stock fixtures at NFD: one on hold, one expiring in 10 days, one already expired (never "expiring"),
  // one on hold that also expires soon (listed in both groups), and an on-hold lot at RVS.
  const nfdShelf = await storage(kit.nfd.id);
  const rvsShelf = await storage(kit.rvs.id);
  await makeLot(ownerNfd, kit.nfd.id, nfdShelf.id, "500", { status: "on_hold" });
  await makeLot(ownerNfd, kit.nfd.id, nfdShelf.id, "500", { status: "released", expiresOn: day(10) });
  await makeLot(ownerNfd, kit.nfd.id, nfdShelf.id, "500", { status: "released", expiresOn: day(-1) });
  await makeLot(ownerNfd, kit.nfd.id, nfdShelf.id, "500", { status: "on_hold", expiresOn: day(5) });
  await makeLot(ownerRvs, kit.rvs.id, rvsShelf.id, "500", { status: "on_hold" });

  // Sales today: one order confirmed now at NFD.
  const c = await newCustomer(w, { creditLimit: "1000000", minShelfLifeDays: 0 });
  const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(10), lines: [{ productId: await productId("ACS-135"), qtyUnits: "4", unitPrice: "70" }] });
  await submitOrder(w.sales, o.id);
}, 240_000);

describe("stock alerts: the card count is the linked list's row count", () => {
  it("card total and breakdown equal the rows of listStockAlerts (same query, one source per label)", async () => {
    const home = await getOwnerHome(ownerNfd);
    const list = await listStockAlerts(ownerNfd);
    expect(home.stock).not.toBeNull();
    expect(home.stock!.onHold).toBe(list.onHold!.length);
    expect(home.stock!.expiring).toBe(list.expiring!.length);
    expect(home.stock!.lowStock).toBe(list.lowStock!.length);
    expect(home.stock!.total).toBe(list.onHold!.length + list.expiring!.length + list.lowStock!.length);
    expect(stockAlertCounts(list)).toEqual(home.stock);
  });

  it("on hold and expiring equal the Stock screen's warning cards (lotKpis) at the site", async () => {
    const list = await listStockAlerts(ownerNfd);
    const k = await lotKpis(ownerNfd);
    expect(list.onHold!.length).toBe(k.onHold);
    expect(list.expiring!.length).toBe(k.expiring);
    expect(list.onHold!.length).toBeGreaterThanOrEqual(2);
    expect(list.onHold!.every((l) => l.qualityStatus === "on_hold" && Number(l.onHand) > 0)).toBe(true);
  });

  it("an already expired lot is never counted as expiring; an on-hold lot expiring soon is in both groups", async () => {
    const list = await listStockAlerts(ownerNfd);
    const today = manilaToday();
    expect(list.expiring!.every((l) => l.expiresOn !== null && l.expiresOn >= today && l.expiresOn <= day(30))).toBe(true);
    expect(list.expiring!.some((l) => l.expiresOn === day(-1))).toBe(false);
    const both = list.onHold!.filter((l) => l.expiresOn === day(5));
    expect(both.length).toBe(1);
    expect(list.expiring!.some((l) => l.id === both[0].id)).toBe(true);
  });

  it("never counts another site's lots (cross-site negative); all sites = the sum of each site", async () => {
    const nfd = await listStockAlerts(ownerNfd);
    const rvs = await listStockAlerts(ownerRvs);
    const all = await listStockAlerts(owner, { all: true });
    expect(nfd.onHold!.every((l) => l.siteCode === "NFD")).toBe(true);
    expect(rvs.onHold!.every((l) => l.siteCode === "RVS")).toBe(true);
    expect(all.onHold!.length).toBe(nfd.onHold!.length + rvs.onHold!.length);
    expect(all.expiring!.length).toBe(nfd.expiring!.length + rvs.expiring!.length);
    // The NFD-only owner asking for all sites still sees NFD only.
    const home = await getOwnerHome(ownerNfd, { all: true });
    expect(home.scope.siteIds).toEqual([kit.nfd.id]);
    expect(home.stock!.onHold).toBe(nfd.onHold!.length);
  });
});

describe("production progress: x of y = the week's batch list", () => {
  it("done and total come from listWeekBatches; done = QA released", async () => {
    // A batch planned today and released counts as done.
    const [b] = await db.select().from(batches).where(eq(batches.siteId, kit.nfd.id)).limit(1);
    await db.update(batches).set({ plannedStartOn: manilaToday() }).where(eq(batches.id, b.id));
    const home = await getOwnerHome(ownerNfd);
    const list = await listWeekBatches(ownerNfd);
    expect(home.production).not.toBeNull();
    expect(home.production!.total).toBe(list.rows.length);
    expect(home.production!.done).toBe(list.rows.filter((r) => r.done).length);
    expect(list.rows.some((r) => r.id === b.id)).toBe(true);
    const row = list.rows.find((r) => r.id === b.id)!;
    expect(row.done).toBe(b.status === "released" || b.status === "closed");
    expect(list.rows.every((r) => r.siteCode === "NFD")).toBe(true);
    const [{ n }] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from batches where site_id = ${kit.nfd.id} and status <> 'draft' and coalesce(planned_start_on, ((created_at at time zone 'Asia/Manila')::date)::text) between ${list.weekStart} and ${list.weekEnd} and not (status in ('rejected','closed') and started_at is null)`,
    );
    expect(list.rows.length).toBe(Number(n));
  });

  it("needs production.batch.view (role negative)", async () => {
    await expectCode(listWeekBatches(salesCs), "forbidden");
    const home = await getOwnerHome(salesCs);
    expect(home.production).toBeNull();
  });
});

describe("sales today and this week: the KPI drill-down rows", () => {
  it("sales today equals the KPI-SAL-01V records of today; vs yesterday from the same query", async () => {
    const home = await getOwnerHome(ownerNfd);
    const today = manilaToday();
    const rec = await getKpiRecords(ownerNfd, "KPI-SAL-01V", { scope: kit.nfd.id, from: today, to: day(1) });
    const prev = await getKpiRecords(ownerNfd, "KPI-SAL-01V", { scope: kit.nfd.id, from: day(-1), to: today });
    expect(home.salesToday!.masked).toBe(false);
    expect(Number(home.salesToday!.value)).toBe(Number(rec.total.value));
    expect(Number(home.salesToday!.value)).toBeGreaterThanOrEqual(280);
    expect(Number(home.salesToday!.yesterday)).toBe(Number(prev.total.value));
    expect(home.salesToday!.orders).toBe(rec.rows.length);
    expect(home.salesToday!.href).toBe(`/analytics/kpi/KPI-SAL-01V?scope=${kit.nfd.id}&from=${today}&to=${day(1)}`);
  });

  it("the 7 bars add up to the KPI records of the last 7 days (actuals)", async () => {
    const home = await getOwnerHome(ownerNfd);
    expect(home.salesWeek!.days.length).toBe(7);
    expect(home.salesWeek!.days.at(-1)!.date).toBe(manilaToday());
    const rec = await getKpiRecords(ownerNfd, "KPI-SAL-01V", { scope: kit.nfd.id, from: day(-6), to: day(1) });
    expect(home.salesWeek!.days.reduce((s, d) => s + Number(d.value), 0)).toBeCloseTo(Number(rec.total.value), 2);
    expect(home.salesWeek!.days.reduce((s, d) => s + d.orders, 0)).toBe(rec.rows.length);
  });

  it("masks money in the DTO without the financial KPI permission (sales staff see order counts only)", async () => {
    const home = await getOwnerHome(salesCs);
    expect(home.salesToday!.masked).toBe(true);
    expect(home.salesToday!.value).toBeNull();
    expect(home.salesToday!.orders).toBeGreaterThanOrEqual(1);
    expect(home.salesWeek!.unit).toBe("count");
    expect(home.salesWeek!.href).toContain("KPI-SAL-01?");
  });

  it("an RVS-only owner does not see NFD's order (cross-site negative)", async () => {
    const home = await getOwnerHome(ownerRvs);
    const rec = await getKpiRecords(ownerRvs, "KPI-SAL-01", { scope: kit.rvs.id, from: manilaToday(), to: day(1) });
    expect(home.salesToday!.orders).toBe(rec.rows.length);
    expect(rec.rows.every((r) => r.siteCode === "RVS")).toBe(true);
  });
});

describe("permissions", () => {
  it("users without analytics.dashboard.view get nothing (role negative)", async () => {
    await expectCode(getOwnerHome(operator), "forbidden");
    await expectCode(listStockAlerts(operator), "forbidden");
  });

  it("all sites needs analytics.owner_dashboard.view (role escalation negative)", async () => {
    const two = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd, kit.rvs]);
    await expectCode(getOwnerHome(two, { all: true }), "forbidden");
    await expectCode(listStockAlerts(two, { all: true }), "forbidden");
    const home = await getOwnerHome(manager);
    expect(home.scope.siteIds).toEqual([kit.nfd.id]);
  });

  it("recent activity needs platform.audit.view and stays in the scope's sites", async () => {
    expect((await getOwnerHome(salesCs)).activity).toBeNull();
    const a = await getOwnerHome(ownerRvs);
    expect(a.activity!.length).toBeLessThanOrEqual(8);
    expect(a.activity!.every((r) => r.siteCode === "RVS")).toBe(true);
  });
});

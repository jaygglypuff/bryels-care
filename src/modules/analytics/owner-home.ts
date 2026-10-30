import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { batches, inventoryBalances, inventoryLots, materials, organizations, products } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { lowStockItems, type LowStockItem } from "@/modules/inventory";
import { NEAR_EXPIRY_WINDOW_DAYS, addDays, listRecentActivity, resolveScope, type ActivityRow, type DashboardScope } from "./dashboard";
import { getKpiTile } from "./kpis";
import { weekStart } from "./kpi/time";

/**
 * Owner Home read model (ADR-083 §4, mockup panel 1 "Owner Dashboard"; docs/analytics-kpis.md §2.1).
 *
 * ONE SOURCE PER LABEL. Every number on Home is the length (or the sum) of the rows of the list it
 * opens, computed by the same function:
 *
 * | Home label                        | Rows (function)                    | Opens                                |
 * |-----------------------------------|------------------------------------|--------------------------------------|
 * | Sales today, "vs yesterday"       | KPI-SAL-01V record query (today)   | /analytics/kpi/KPI-SAL-01V?from&to   |
 * | Sales this week (7 bars)          | KPI-SAL-01V (or KPI-SAL-01) daily  | /analytics/kpi/…?from&to             |
 * | Production progress x of y        | `listWeekBatches`                  | /dashboard/details/batches           |
 * | Stock alerts (and its breakdown)  | `listStockAlerts`                  | /dashboard/details/stock             |
 * | "Needs your attention" stock rows | `listStockAlerts` (same counts)    | /dashboard/details/stock#…           |
 *
 * The stock rules match the Stock screen's warning cards (`lotKpis` in src/modules/inventory/lots.ts):
 * - on quality hold = lots with stock on hand (sum of balances > 0) whose quality status is `on_hold`;
 * - expiring within 30 days = lots with stock on hand, status not expired / rejected / recalled, expiry
 *   date from today to today + 30 days inclusive (already expired lots are NOT "expiring");
 * - low stock = `lowStockItems` (usable stock below the active minimum, A-INV-LOW-01).
 * A lot on hold that also expires soon is listed in both groups; the card total is the number of
 * alert rows (low + expiring + on hold), the breakdown says which.
 *
 * Production progress: the batches planned to start this week (Monday to Sunday, organization time
 * zone; a batch without a planned date counts in the week it was created). Done = QA released (status
 * `released`, or `closed` after a release). Batches abandoned before they started (rejected, never
 * started) and drafts are not counted.
 *
 * Every query is limited to the caller's sites (current site, or every allowed site with ?scope=all and
 * analytics.owner_dashboard.view) and each part needs its module's view permission.
 */

export type StockAlertLot = {
  id: string;
  lotNumber: string;
  itemKind: string;
  itemName: string;
  itemCode: string;
  qualityStatus: string;
  expiresOn: string | null;
  onHand: string;
  uom: string;
  siteCode: string;
};

export type StockAlerts = {
  scope: DashboardScope;
  today: string;
  /** null = the caller may not see that part (no permission). */
  lowStock: LowStockItem[] | null;
  expiring: StockAlertLot[] | null;
  onHold: StockAlertLot[] | null;
};

export type StockAlertCounts = { lowStock: number | null; expiring: number | null; onHold: number | null; total: number };

export type WeekBatch = {
  id: string;
  batchNumber: string;
  productName: string;
  status: string;
  plannedStartOn: string | null;
  siteCode: string;
  done: boolean;
  href: string;
};

export type WeekBatches = { scope: DashboardScope; weekStart: string; weekEnd: string; rows: WeekBatch[] };

export type SalesDay = { date: string; value: string; orders: number };

export type OwnerHome = {
  scope: DashboardScope;
  today: string;
  generatedAt: string;
  /** KPI-SAL-01V today vs yesterday; `masked` when the caller may not see money (value null). */
  salesToday: null | { masked: boolean; value: string | null; yesterday: string | null; orders: number; ordersYesterday: number; href: string; ordersHref: string };
  production: null | { done: number; total: number; pct: number | null; weekStart: string; weekEnd: string };
  stock: StockAlertCounts | null;
  /** The last 7 days (today included), one point per day, from confirmed orders (actuals only). */
  salesWeek: null | { masked: boolean; unit: "money" | "count"; days: SalesDay[]; href: string };
  activity: ActivityRow[] | null;
};

/** `all` needs the owner dashboard permission and more than one site (otherwise the current site). */
function homeScope(ctx: AuthContext, all: boolean | undefined): DashboardScope {
  if (all && !ctx.can("analytics.owner_dashboard.view")) throw new DomainError("forbidden", "All-sites figures need the owner dashboard permission (analytics.owner_dashboard.view).");
  return resolveScope(ctx, !!all);
}

async function orgClock(ctx: AuthContext): Promise<{ tz: string; today: string }> {
  const [o] = await db.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const tz = o?.tz ?? "Asia/Manila";
  const [r] = await db.execute<{ today: string }>(sql`select ((now() at time zone ${tz})::date)::text as today`);
  return { tz, today: r.today };
}

/** Lots with stock on hand in the sites, matching `where` (one row per lot, earliest expiry first). */
async function lotsOnHand(siteIds: string[], siteCode: Map<string, string>, where: ReturnType<typeof sql>): Promise<StockAlertLot[]> {
  const rows = await db
    .select({
      id: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      itemKind: inventoryLots.itemKind,
      qualityStatus: inventoryLots.qualityStatus,
      expiresOn: inventoryLots.expiresOn,
      uom: inventoryLots.baseUom,
      siteId: inventoryLots.siteId,
      itemName: sql<string>`coalesce(${materials.name}, ${products.name})`,
      itemCode: sql<string>`coalesce(${materials.code}, ${products.skuCode})`,
      onHand: sql<string>`sum(${inventoryBalances.qtyBase})::text`,
    })
    .from(inventoryLots)
    .innerJoin(inventoryBalances, eq(inventoryBalances.lotId, inventoryLots.id))
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .where(and(inArray(inventoryLots.siteId, siteIds), where))
    .groupBy(inventoryLots.id, materials.id, products.id)
    .having(sql`sum(${inventoryBalances.qtyBase}) > 0`)
    .orderBy(sql`${inventoryLots.expiresOn} asc nulls last`, asc(inventoryLots.lotNumber));
  return rows.map((r) => ({
    id: r.id,
    lotNumber: r.lotNumber,
    itemKind: r.itemKind,
    itemName: r.itemName ?? "—",
    itemCode: r.itemCode ?? "",
    qualityStatus: r.qualityStatus,
    expiresOn: r.expiresOn,
    onHand: r.onHand,
    uom: r.uom,
    siteCode: siteCode.get(r.siteId) ?? "",
  }));
}

/** The rows behind "Stock alerts" (see the rules at the top of this file). */
export async function listStockAlerts(ctx: AuthContext, opts: { all?: boolean } = {}): Promise<StockAlerts> {
  ctx.require("analytics.dashboard.view");
  const scope = homeScope(ctx, opts.all);
  const { today } = await orgClock(ctx);
  const siteCode = new Map(scope.sites.map((s) => [s.id, s.code]));
  const until = addDays(today, NEAR_EXPIRY_WINDOW_DAYS);
  const seesLots = ctx.can("inventory.lot.view");
  const [lowStock, expiring, onHold] = await Promise.all([
    ctx.can("inventory.balance.view") ? lowStockItems(ctx, { siteIds: scope.siteIds }) : null,
    seesLots
      ? lotsOnHand(
          scope.siteIds,
          siteCode,
          sql`${inventoryLots.qualityStatus} not in ('expired', 'rejected', 'recalled') and ${inventoryLots.expiresOn} between ${today}::date and ${until}::date`,
        )
      : null,
    seesLots ? lotsOnHand(scope.siteIds, siteCode, sql`${inventoryLots.qualityStatus} = 'on_hold'`) : null,
  ]);
  return { scope, today, lowStock, expiring, onHold };
}

export function stockAlertCounts(a: Pick<StockAlerts, "lowStock" | "expiring" | "onHold">): StockAlertCounts {
  const lowStock = a.lowStock ? a.lowStock.length : null;
  const expiring = a.expiring ? a.expiring.length : null;
  const onHold = a.onHold ? a.onHold.length : null;
  return { lowStock, expiring, onHold, total: (lowStock ?? 0) + (expiring ?? 0) + (onHold ?? 0) };
}

/** The batches behind "Production progress" (planned this week; done = QA released). */
export async function listWeekBatches(ctx: AuthContext, opts: { all?: boolean } = {}): Promise<WeekBatches> {
  ctx.require("analytics.dashboard.view");
  ctx.require("production.batch.view");
  const scope = homeScope(ctx, opts.all);
  const { tz, today } = await orgClock(ctx);
  const ws = weekStart(today);
  const we = addDays(ws, 7);
  const siteCode = new Map(scope.sites.map((s) => [s.id, s.code]));
  const planned = sql`coalesce(${batches.plannedStartOn}, ((${batches.createdAt} at time zone ${tz})::date)::text)`;
  const released = sql<boolean>`(${batches.status} = 'released' or (${batches.status} = 'closed' and exists (select 1 from batch_state_transitions t where t.batch_id = ${batches.id} and t.to_state = 'released')))`;
  const rows = await db
    .select({
      id: batches.id,
      batchNumber: batches.batchNumber,
      productName: products.name,
      status: batches.status,
      plannedStartOn: batches.plannedStartOn,
      siteId: batches.siteId,
      workOrderId: batches.workOrderId,
      done: released,
    })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .where(
      and(
        inArray(batches.siteId, scope.siteIds),
        sql`${planned} >= ${ws} and ${planned} < ${we}`,
        sql`${batches.status} <> 'draft'`,
        sql`not (${batches.status} in ('rejected', 'closed') and ${batches.startedAt} is null)`,
      ),
    )
    .orderBy(asc(batches.plannedStartOn), asc(batches.batchNumber));
  return {
    scope,
    weekStart: ws,
    weekEnd: addDays(we, -1),
    rows: rows.map((r) => ({
      id: r.id,
      batchNumber: r.batchNumber,
      productName: r.productName,
      status: r.status,
      plannedStartOn: r.plannedStartOn,
      siteCode: siteCode.get(r.siteId) ?? "",
      done: !!r.done,
      href: r.workOrderId ? `/production/orders/${r.workOrderId}` : `/production/${r.id}`,
    })),
  };
}

const kpiScopeKey = (ctx: AuthContext, scope: DashboardScope) => (scope.all ? "all" : ctx.currentSiteId);

/** Home for owners and managers: the four cards, the 7-day sales trend and recent activity. */
export async function getOwnerHome(ctx: AuthContext, opts: { all?: boolean; now?: Date } = {}): Promise<OwnerHome> {
  ctx.require("analytics.dashboard.view");
  const scope = homeScope(ctx, opts.all);
  const now = opts.now ?? new Date();
  const { today } = await orgClock(ctx);
  const kscope = kpiScopeKey(ctx, scope);
  const seesOrders = ctx.can("sales.sales_order.view");
  const from7 = addDays(today, -6);
  const tomorrow = addDays(today, 1);

  const [valueToday, countToday, valueWeek, countWeek, week, alerts, activity] = await Promise.all([
    seesOrders ? getKpiTile(ctx, "KPI-SAL-01V", { scope: kscope, period: "today", now }) : null,
    seesOrders ? getKpiTile(ctx, "KPI-SAL-01", { scope: kscope, period: "today", now }) : null,
    seesOrders ? getKpiTile(ctx, "KPI-SAL-01V", { scope: kscope, from: from7, to: tomorrow, daily: true, now }) : null,
    seesOrders ? getKpiTile(ctx, "KPI-SAL-01", { scope: kscope, from: from7, to: tomorrow, daily: true, now }) : null,
    ctx.can("production.batch.view") ? listWeekBatches(ctx, opts) : null,
    ctx.can("inventory.lot.view") || ctx.can("inventory.balance.view") ? listStockAlerts(ctx, opts) : null,
    ctx.can("platform.audit.view") ? listRecentActivity(ctx, scope, 8) : null,
  ]);

  const salesToday =
    valueToday && countToday
      ? {
          masked: valueToday.masked,
          value: valueToday.current?.value ?? null,
          yesterday: valueToday.previous?.value ?? null,
          orders: countToday.current?.rowCount ?? 0,
          ordersYesterday: countToday.previous?.rowCount ?? 0,
          href: valueToday.masked ? countToday.href : valueToday.href,
          ordersHref: countToday.href,
        }
      : null;

  let salesWeek: OwnerHome["salesWeek"] = null;
  if (valueWeek && countWeek) {
    const useValue = !valueWeek.masked && !!valueWeek.daily;
    const counts = new Map((countWeek.daily ?? []).map((d) => [d.date, d.rowCount]));
    const values = new Map((valueWeek.daily ?? []).map((d) => [d.date, d.value ?? "0"]));
    salesWeek = {
      masked: valueWeek.masked,
      unit: useValue ? "money" : "count",
      days: Array.from({ length: 7 }, (_, i) => {
        const date = addDays(from7, i);
        return { date, value: useValue ? (values.get(date) ?? "0") : String(counts.get(date) ?? 0), orders: counts.get(date) ?? 0 };
      }),
      href: useValue ? valueWeek.href : countWeek.href,
    };
  }

  const production = week
    ? (() => {
        const total = week.rows.length;
        const done = week.rows.filter((r) => r.done).length;
        return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : null, weekStart: week.weekStart, weekEnd: week.weekEnd };
      })()
    : null;

  return {
    scope,
    today,
    generatedAt: now.toISOString(),
    salesToday,
    production,
    stock: alerts ? stockAlertCounts(alerts) : null,
    salesWeek,
    activity,
  };
}

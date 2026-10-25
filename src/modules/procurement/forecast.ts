import "server-only";
import Decimal from "decimal.js";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { forecastOverrides, products, sites, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { type ForecastResult, forecastSeries } from "./forecast-math";
import { businessDate, isUuid, parseDecimal, requireReason } from "./shared";

/**
 * Forecast assumptions and overrides (US-6-20, FR-analytics-08, docs/analytics-kpis.md §6). Level:
 * SKU (a `products` row) × site × month. Demand history: confirmed sales order line quantities by the
 * month the order was confirmed (first `confirmed` transition; cancelled orders excluded), complete
 * months only. A forecast is an estimate: it is never labelled Actual, never a hero KPI, never turned
 * into an order or a reservation. Overrides (`analytics.forecast.edit`, value + period + reason) stay
 * `submitted` until a different user approves (`analytics.forecast.approve`; SoD per setting
 * `approvals.sod.forecast_override`, default on); the original forecast stays visible.
 */

export const FORECAST_BANNER = "Forecasts are estimates, not actuals.";

const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
function addMonths(month: string, k: number) {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + k, 1));
  return t.toISOString().slice(0, 10);
}

/** Monthly confirmed demand per product × site (complete months, oldest first). */
async function demandHistory(organizationId: string, siteIds: string[], historyMonths: number, today: string) {
  const current = monthStart(today);
  const from = addMonths(current, -historyMonths);
  const rows = (await db.execute(sql`
    with o as (
      select so.id, so.site_id,
             coalesce((select min(t.occurred_at) from sales_order_state_transitions t where t.sales_order_id = so.id and t.to_state = 'confirmed'),
                      case when not exists (select 1 from sales_order_state_transitions t2 where t2.sales_order_id = so.id and t2.to_state in ('draft','submitted','pending_approval')) then so.created_at end) as confirmed_at
        from sales_orders so
       where so.organization_id = ${organizationId}::uuid and so.site_id in (${sql.join(siteIds.map((s) => sql`${s}::uuid`), sql`, `)})
         and so.status not in ('draft','submitted','pending_approval','cancelled')
    )
    select o.site_id::text as site_id, l.product_id::text as product_id,
           to_char(date_trunc('month', o.confirmed_at at time zone 'Asia/Manila'), 'YYYY-MM-DD') as month,
           sum(l.qty_units)::text as qty
      from o join sales_order_lines l on l.sales_order_id = o.id
     where o.confirmed_at >= (${from}::date)::timestamp at time zone 'Asia/Manila'
       and o.confirmed_at < (${current}::date)::timestamp at time zone 'Asia/Manila'
     group by 1, 2, 3`)) as unknown as { site_id: string; product_id: string; month: string; qty: string }[];
  return { rows, from, current };
}

export type ForecastRow = {
  siteId: string;
  siteCode: string;
  productId: string;
  sku: string;
  productName: string;
  baseUom: string;
  nextPeriodStart: string;
  forecast: ForecastResult;
  lastActual: string | null;
  overrides: { id: string; periodStart: string; overrideQty: string; baselineQty: string | null; status: string; reason: string; submittedByName: string; submittedAt: Date; decidedAt: Date | null }[];
};

export async function forecastRows(ctx: AuthContext, f: { siteId?: string; now?: Date } = {}): Promise<{ banner: string; alpha: number; horizonMonths: number; historyMonths: number; nextPeriodStart: string; rows: ForecastRow[] }> {
  ctx.require("analytics.forecast.view");
  const today = businessDate(f.now);
  const alpha = await getSetting(db, ctx.organizationId, "analytics.forecast.ses_alpha");
  const horizonMonths = await getSetting(db, ctx.organizationId, "analytics.forecast.horizon_months");
  const historyMonths = await getSetting(db, ctx.organizationId, "analytics.forecast.history_months");
  const siteIds = ctx.allowedSiteIds.filter((s) => ctx.canAt("analytics.forecast.view", s) && (!f.siteId || s === f.siteId));
  const nextPeriodStart = monthStart(today);
  if (!siteIds.length) return { banner: FORECAST_BANNER, alpha, horizonMonths, historyMonths, nextPeriodStart, rows: [] };
  const { rows, current } = await demandHistory(ctx.organizationId, siteIds, historyMonths, today);
  const prods = await db.select().from(products).where(and(eq(products.organizationId, ctx.organizationId), eq(products.status, "active")));
  const siteRows = await db.select({ id: sites.id, code: sites.code }).from(sites).where(inArray(sites.id, siteIds));
  const ovs = await db
    .select({ o: forecastOverrides, name: users.displayName })
    .from(forecastOverrides)
    .innerJoin(users, eq(users.id, forecastOverrides.submittedBy))
    .where(and(eq(forecastOverrides.organizationId, ctx.organizationId), inArray(forecastOverrides.siteId, siteIds), sql`${forecastOverrides.periodEnd} > ${today}::date`))
    .orderBy(desc(forecastOverrides.submittedAt));
  const out: ForecastRow[] = [];
  for (const site of siteRows) {
    for (const p of prods) {
      const mine = rows.filter((r) => r.site_id === site.id && r.product_id === p.id);
      const firstMonth = mine.map((r) => r.month).sort()[0];
      const series: Decimal[] = [];
      if (firstMonth) {
        for (let m = firstMonth; m < current; m = addMonths(m, 1)) series.push(new Decimal(mine.find((r) => r.month === m)?.qty ?? 0));
      }
      const myOv = ovs.filter((o) => o.o.siteId === site.id && o.o.productId === p.id);
      if (!series.length && !myOv.length) continue;
      out.push({
        siteId: site.id,
        siteCode: site.code,
        productId: p.id,
        sku: p.skuCode,
        productName: p.name,
        baseUom: p.baseUom,
        nextPeriodStart,
        forecast: forecastSeries(series, alpha),
        lastActual: series.length ? series[series.length - 1].toString() : null,
        overrides: myOv.map((o) => ({ id: o.o.id, periodStart: o.o.periodStart, overrideQty: o.o.overrideQtyBase, baselineQty: o.o.baselineQtyBase, status: o.o.status, reason: o.o.reason, submittedByName: o.name, submittedAt: o.o.submittedAt, decidedAt: o.o.decidedAt })),
      });
    }
  }
  return { banner: FORECAST_BANNER, alpha, horizonMonths, historyMonths, nextPeriodStart, rows: out };
}

/** Submits an override for a month within the horizon (W4A, §6.4); the baseline forecast is kept with it. */
export async function submitForecastOverride(ctx: AuthContext, input: { siteId: string; productId: string; periodStart: string; overrideQty: string; reason: string; now?: Date }) {
  if (!isUuid(input.siteId) || !ctx.allowedSiteIds.includes(input.siteId)) throw new DomainError("not_found", "Site not found in your sites.");
  ctx.requireAt("analytics.forecast.edit", input.siteId);
  ctx.assertWritable();
  const reason = requireReason(input.reason);
  const qty = parseDecimal(input.overrideQty, "overrideQty", "Override quantity", { allowZero: true, dp: 0 });
  if (!/^\d{4}-\d{2}-01$/.test(input.periodStart ?? "")) throw new DomainError("validation", "Choose a month.", { field: "periodStart" });
  const today = businessDate(input.now);
  const horizon = await getSetting(db, ctx.organizationId, "analytics.forecast.horizon_months");
  const first = monthStart(today);
  if (input.periodStart < first || input.periodStart >= addMonths(first, horizon)) throw new DomainError("validation", `Overrides are for the next ${horizon} month(s) only.`, { field: "periodStart" });
  if (!isUuid(input.productId)) throw new DomainError("validation", "Choose a product.", { field: "productId" });
  const [p] = await db.select().from(products).where(and(eq(products.id, input.productId), eq(products.organizationId, ctx.organizationId))).limit(1);
  if (!p) throw new DomainError("validation", "Choose a product.", { field: "productId" });
  const fc = (await forecastRows(ctx, { siteId: input.siteId, now: input.now })).rows.find((r) => r.productId === p.id)?.forecast ?? null;
  const baseline = fc && fc.sufficient ? fc.next : null;
  return db.transaction(async (tx) => {
    const [o] = await tx
      .insert(forecastOverrides)
      .values({
        organizationId: ctx.organizationId,
        siteId: input.siteId,
        productId: p.id,
        periodStart: input.periodStart,
        periodEnd: addMonths(input.periodStart, 1),
        baselineQtyBase: baseline,
        baselineMethod: fc && fc.sufficient ? fc.method : null,
        overrideQtyBase: qty.toString(),
        baseUom: p.baseUom,
        reason,
        status: "submitted",
        baselineSnapshot: fc ? { schema: "forecast_snapshot/v1", ...fc } : null,
        submittedBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, { action: "analytics.forecast.overridden", entityType: "forecast_override", entityId: o.id, entityNumber: p.skuCode, siteId: input.siteId, reason, after: { period: input.periodStart, baseline, override: qty.toString(), status: "submitted" } });
    return { overrideId: o.id, baseline };
  });
}

/** A different user approves or rejects a submitted override; approving retires an earlier approved one. */
export async function decideForecastOverride(ctx: AuthContext, input: { overrideId: string; decision: "approved" | "rejected"; note?: string | null }) {
  if (!isUuid(input.overrideId)) throw new DomainError("not_found", "Override not found.");
  if (input.decision !== "approved" && input.decision !== "rejected") throw new DomainError("validation", "Choose approve or reject.", { field: "decision" });
  const note = input.decision === "rejected" ? requireReason(input.note, "note") : (input.note?.trim() || null);
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(forecastOverrides).where(and(eq(forecastOverrides.id, input.overrideId), eq(forecastOverrides.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!o || !ctx.allowedSiteIds.includes(o.siteId)) throw new DomainError("not_found", "Override not found.");
    ctx.requireAt("analytics.forecast.approve", o.siteId);
    if (o.status !== "submitted") throw new DomainError("state", `This override is already ${o.status}.`);
    const sod = await getSetting(tx, ctx.organizationId, "approvals.sod.forecast_override");
    ctx.assertSeparation(sod && o.submittedBy === ctx.userId, "You entered this override, so another person must decide it (separation of duties).", { code: "SEPARATION_OF_DUTIES" });
    if (input.decision === "approved") {
      await tx.update(forecastOverrides).set({ status: "retired", decisionNote: "Replaced by a newer approved override" }).where(and(eq(forecastOverrides.siteId, o.siteId), eq(forecastOverrides.productId, o.productId), eq(forecastOverrides.periodStart, o.periodStart), eq(forecastOverrides.status, "approved")));
    }
    await tx.update(forecastOverrides).set({ status: input.decision, decidedBy: ctx.userId, decidedAt: new Date(), decisionNote: note }).where(eq(forecastOverrides.id, o.id));
    await audit(tx, ctx, { action: input.decision === "approved" ? "analytics.forecast.override_approved" : "analytics.forecast.override_rejected", entityType: "forecast_override", entityId: o.id, siteId: o.siteId, reason: note, after: { period: o.periodStart, override: o.overrideQtyBase, baseline: o.baselineQtyBase } });
    return { overrideId: o.id, status: input.decision };
  });
}

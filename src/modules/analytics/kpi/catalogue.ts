import { type SQL, sql } from "drizzle-orm";
import type { Permission } from "../../../lib/permissions";
import {
  type KpiQueryParams,
  dt,
  inSites,
  inspectionStatusAt,
  lotItemName,
  lotStatusAt,
  notReversedMovement,
  notReversedPosting,
  onHandCte,
  ts,
  workOrderStatusAt,
} from "./sql";

/**
 * The KPI catalogue as typed data (docs/analytics-kpis.md §2; mirrored into `kpi_definitions`).
 *
 * Each KPI is ONE record query: the rows a user sees on the drill-down page are the rows the number
 * is made of (W11-02). Every record query returns the same columns:
 *   site_id, ref_type, ref_id, ref_number, basis_at, num, den, item, detail, category
 * - the snapshot and dashboard value aggregates those rows in the application with decimal.js;
 * - the R-query (`R-<code>` = SELECT aggregate FROM (record query)) aggregates them in PostgreSQL;
 * - the reconciliation job compares the two (§1.4).
 * Quantities are base units per dimension (never mixed), money is PHP, durations are rounded to
 * 4 decimals in SQL so both paths read identical values.
 */

export type KpiUnit = "count" | "qty_g" | "qty_pcs" | "money" | "ratio" | "hours" | "days" | "minutes";
export type KpiAggregate = "sum" | "ratio" | "median" | "p90" | "max";
export type ValueLabel = "actual" | "estimate" | "forecast" | "overridden";
export type RefreshClass = "post" | "live" | "mv15" | "night" | "wk";
export type KpiArea = "operations" | "inventory" | "quality" | "sales" | "finance" | "owner";

export type KpiDefinition = {
  code: string;
  name: string;
  /** Tile caption. */
  short: string;
  area: KpiArea;
  definition: string;
  formula: string;
  timeBasis: string;
  sources: string[];
  refresh: RefreshClass;
  label: ValueLabel;
  unit: KpiUnit;
  aggregate: KpiAggregate;
  /** period = flows in [from, to); asof = point in time at the period end (or now). */
  kind: "period" | "asof";
  /** Sum and ratio components add up across sites (rule 1.4.4). */
  additive: boolean;
  /** Rows without a site: counted in the all-sites scope only, or in every site. */
  nullSiteRows?: "all_only" | "every_site";
  /** Every permission is required to see the value (docs/analytics-kpis.md §1.5). */
  permissions: Permission[];
  /** Is a higher value better (delta colour)? null = neutral. */
  better: "up" | "down" | null;
  /** What `category` means in the rows (chart and donut breakdowns). */
  categories?: { key: string; label: string; tone?: "good" | "bad" | "neutral" | "warn" }[];
  rows: (p: KpiQueryParams) => SQL;
};

/** A KPI of the catalogue that cannot be computed from posted data yet; its tile says why. */
export type UnavailableKpi = { code: string; name: string; short: string; reason: string; phase: string; permissions: Permission[] };

const T = (p: KpiQueryParams) => ts(p.asOf);
const inPeriod = (col: string, p: KpiQueryParams) => sql`${sql.raw(col)} >= ${ts(p.from)} and ${sql.raw(col)} < ${ts(p.to)} and ${sql.raw(col)} <= ${T(p)}`;
const hours = (a: string, b: string) => sql`round(extract(epoch from (${sql.raw(a)} - ${sql.raw(b)})) / 3600, 4)`;
const days = (a: string, b: string) => sql`round(extract(epoch from (${sql.raw(a)} - ${sql.raw(b)})) / 86400, 4)`;

// ---------------------------------------------------------------- sales

const confirmedOrders = (p: KpiQueryParams, value: boolean) => sql`
  select o.site_id, 'sales_order'::text as ref_type, o.id as ref_id, o.order_number as ref_number, o.created_at as basis_at,
         ${value ? sql`(select coalesce(sum(l.qty_units * l.unit_price), 0) from sales_order_lines l where l.sales_order_id = o.id)` : sql`1::numeric`} as num,
         null::numeric as den, c.name as item, o.status as detail, o.status as category
    from sales_orders o join customers c on c.id = o.customer_id
   where ${inSites("o.site_id", p.siteIds)} and ${inPeriod("o.created_at", p)} and o.status not in ('draft', 'cancelled')`;

/** Shipped quantity per (order, product) known by T, net of reversed shipment movements. */
const shippedByProduct = (p: KpiQueryParams, orderFilter: SQL) => sql`
  select s.sales_order_id, lot.product_id, sum(m.qty_base) as q, max(s.dispatched_at) as last_dispatch
    from shipments s
    join stock_movements m on m.source_document_type = 'shipment' and m.source_document_id = s.id and m.movement_type = 'shipment'
    join inventory_lots lot on lot.id = m.lot_id
   where ${orderFilter} and s.dispatched_at <= ${T(p)} and m.posted_at <= ${T(p)} and ${notReversedMovement("m", p.asOf)}
   group by 1, 2`;

const otif = (p: KpiQueryParams) => sql`
  with due as (
    select o.* from sales_orders o
     where ${inSites("o.site_id", p.siteIds)} and o.status not in ('draft', 'cancelled') and o.created_at <= ${T(p)}
       and o.requested_delivery_on ~ '^\\d{4}-\\d{2}-\\d{2}$'
       and o.requested_delivery_on::date >= ${dt(p.fromDate)} and o.requested_delivery_on::date < ${dt(p.toDate)}),
  ordered as (select l.sales_order_id, l.product_id, sum(l.qty_units) as q from sales_order_lines l where l.sales_order_id in (select id from due) group by 1, 2),
  shipped as (${shippedByProduct(p, sql`s.sales_order_id in (select id from due)`)}),
  per as (select o.sales_order_id, bool_and(coalesce(sh.q, 0) >= o.q) as in_full, max(sh.last_dispatch) as last_dispatch
            from ordered o left join shipped sh on sh.sales_order_id = o.sales_order_id and sh.product_id = o.product_id group by 1),
  judged as (
    select d.*, per.in_full, per.last_dispatch,
           case when per.in_full and (per.last_dispatch at time zone st.timezone)::date <= d.requested_delivery_on::date + ${p.otifGraceDays}::int then 'on_time'
                when per.in_full then 'late' else 'open' end as outcome
      from due d join per on per.sales_order_id = d.id join sites st on st.id = d.site_id)
  select j.site_id, 'sales_order'::text as ref_type, j.id as ref_id, j.order_number as ref_number,
         ((j.requested_delivery_on::date)::timestamp at time zone st.timezone) as basis_at,
         case when j.outcome = 'on_time' then 1 else 0 end::numeric as num, 1::numeric as den, c.name as item,
         'Due ' || j.requested_delivery_on || coalesce(', last dispatch ' || to_char(j.last_dispatch at time zone st.timezone, 'YYYY-MM-DD'), ', not shipped in full') as detail,
         j.outcome as category
    from judged j join customers c on c.id = j.customer_id join sites st on st.id = j.site_id`;

/** First dispatched shipment per order known by T, dispatched in the period. */
const firstShipments = (p: KpiQueryParams) => sql`
  select distinct on (s.sales_order_id) s.sales_order_id, s.id, s.site_id, s.dispatched_at, s.delivery_receipt_number
    from shipments s where ${inSites("s.site_id", p.siteIds)} and s.dispatched_at <= ${T(p)}
   order by s.sales_order_id, s.dispatched_at, s.id`;

const fillRate = (p: KpiQueryParams) => sql`
  with fs as (${firstShipments(p)})
  select fs.site_id, 'sales_order'::text as ref_type, o.id as ref_id, o.order_number as ref_number, fs.dispatched_at as basis_at,
         (select coalesce(sum(m.qty_base), 0) from stock_movements m
           where m.source_document_type = 'shipment' and m.source_document_id = fs.id and m.movement_type = 'shipment'
             and m.posted_at <= ${T(p)} and ${notReversedMovement("m", p.asOf)}) as num,
         (select coalesce(sum(l.qty_units), 0) from sales_order_lines l where l.sales_order_id = o.id) as den,
         c.name as item, fs.delivery_receipt_number as detail, null::text as category
    from fs join sales_orders o on o.id = fs.sales_order_id join customers c on c.id = o.customer_id
   where ${inPeriod("fs.dispatched_at", p)} and o.status <> 'cancelled'`;

const orderToShip = (p: KpiQueryParams) => sql`
  with fs as (${firstShipments(p)})
  select fs.site_id, 'sales_order'::text as ref_type, o.id as ref_id, o.order_number as ref_number, fs.dispatched_at as basis_at,
         ${days("fs.dispatched_at", "o.created_at")} as num, null::numeric as den, c.name as item, fs.delivery_receipt_number as detail, null::text as category
    from fs join sales_orders o on o.id = fs.sales_order_id join customers c on c.id = o.customer_id
   where ${inPeriod("fs.dispatched_at", p)} and o.status <> 'cancelled'`;

const overdueOrders = (p: KpiQueryParams) => sql`
  select o.site_id, 'sales_order'::text as ref_type, o.id as ref_id, o.order_number as ref_number, o.created_at as basis_at,
         1::numeric as num, null::numeric as den, c.name as item,
         'Due ' || o.requested_delivery_on || ', ' || (${dt(p.asOfDate)} - o.requested_delivery_on::date) || ' days overdue' as detail, o.status as category
    from sales_orders o join customers c on c.id = o.customer_id
   where ${inSites("o.site_id", p.siteIds)} and o.status not in ('draft', 'cancelled') and o.created_at <= ${T(p)}
     and o.requested_delivery_on ~ '^\\d{4}-\\d{2}-\\d{2}$' and o.requested_delivery_on::date < ${dt(p.asOfDate)}
     and not exists (select 1 from shipments s where s.sales_order_id = o.id and s.dispatched_at <= ${T(p)})`;

/** KPI-FIN-02: shipped quantity × the order's weighted unit price for that product (Estimate, A-KPI-10). */
const shippedValue = (p: KpiQueryParams) => sql`
  select s.site_id, 'shipment'::text as ref_type, s.id as ref_id, s.delivery_receipt_number as ref_number, s.dispatched_at as basis_at,
         coalesce((select sum(round(m.qty_base * pr.price, 4)) from stock_movements m
                     join inventory_lots lot on lot.id = m.lot_id
                     join lateral (select sum(l.qty_units * l.unit_price) / nullif(sum(l.qty_units), 0) as price
                                     from sales_order_lines l where l.sales_order_id = s.sales_order_id and l.product_id = lot.product_id) pr on true
                    where m.source_document_type = 'shipment' and m.source_document_id = s.id and m.movement_type = 'shipment'
                      and m.posted_at <= ${T(p)} and ${notReversedMovement("m", p.asOf)}), 0) as num,
         null::numeric as den, c.name as item, o.order_number as detail, null::text as category
    from shipments s join sales_orders o on o.id = s.sales_order_id join customers c on c.id = o.customer_id
   where ${inSites("s.site_id", p.siteIds)} and ${inPeriod("s.dispatched_at", p)}`;

// ---------------------------------------------------------------- production

const outputVsPlan = (p: KpiQueryParams) => sql`
  select w.site_id, 'work_order'::text as ref_type, w.id as ref_id, w.work_order_number as ref_number,
         ((w.planned_end)::timestamp at time zone st.timezone) as basis_at, 0::numeric as num, w.qty_planned_base as den,
         pr.name as item, 'Planned ' || w.qty_planned_base || ' ' || w.base_uom || ', due ' || w.planned_end as detail, 'planned'::text as category
    from work_orders w join products pr on pr.id = w.product_id join sites st on st.id = w.site_id
   where ${inSites("w.site_id", p.siteIds)} and w.planned_end >= ${dt(p.fromDate)} and w.planned_end < ${dt(p.toDate)}
     and w.created_at <= ${T(p)} and ${workOrderStatusAt("w", p.asOf)} not in ('draft', 'cancelled')
  union all
  select pp.site_id, 'batch'::text, b.id, b.batch_number, pp.posted_at,
         coalesce(bo.mass_g, case when pp.base_uom = 'g' then pp.qty_base else pp.qty_base * pr.unit_net_mass_g end) as num, 0::numeric,
         pr.name, 'Output ' || pp.qty_base || ' ' || pp.base_uom, 'actual'::text
    from production_postings pp join batches b on b.id = pp.batch_id join products pr on pr.id = b.product_id
    left join batch_outputs bo on bo.id = pp.batch_output_id
   where ${inSites("pp.site_id", p.siteIds)} and pp.posting_type = 'output' and ${inPeriod("pp.posted_at", p)} and ${notReversedPosting("pp", p.asOf)}`;

/** Current yield record (as of T) of batches whose first yield record falls in the period. */
const yieldBase = (p: KpiQueryParams, num: SQL, den: SQL, category: SQL) => sql`
  select y.site_id, 'batch'::text as ref_type, b.id as ref_id, b.batch_number as ref_number, f.first_at as basis_at,
         ${num} as num, ${den} as den, pr.name as item,
         'Yield ' || round(y.yield_pct, 2) || ' % (' || y.actual_units || ' units)' as detail, ${category} as category
    from yield_records y join batches b on b.id = y.batch_id join products pr on pr.id = b.product_id
    join lateral (select min(f.recorded_at) as first_at from yield_records f where f.batch_id = y.batch_id) f on true
   where ${inSites("y.site_id", p.siteIds)} and y.recorded_at <= ${T(p)} and ${inPeriod("f.first_at", p)}
     and not exists (select 1 from yield_records n where n.supersedes_id = y.id and n.recorded_at <= ${T(p)})`;

const rightFirstTime = (p: KpiQueryParams) => sql`case when not exists (select 1 from deviations d where d.batch_id = b.id and d.raised_at <= ${T(p)})
      and not exists (select 1 from dispense_records x join batch_materials bm on bm.id = x.batch_material_id where bm.batch_id = b.id and x.exception_approved_by is not null)
      and not exists (select 1 from process_step_records s where s.batch_id = b.id and (s.exception_approved_by is not null or s.status = 'skipped'))
    then 1 else 0 end::numeric`;

const stepOverrun = (p: KpiQueryParams) => sql`
  select b.site_id, 'batch'::text as ref_type, b.id as ref_id, b.batch_number as ref_number, r.completed_at as basis_at,
         greatest(round(extract(epoch from (r.completed_at - r.started_at)) / 60, 4) - rs.expected_duration_minutes, 0) as num,
         null::numeric as den, r.name as item,
         round(extract(epoch from (r.completed_at - r.started_at)) / 60, 1) || ' min vs ' || rs.expected_duration_minutes || ' min expected' as detail,
         rs.step_kind as category
    from process_step_records r join routing_steps rs on rs.id = r.routing_step_id join batches b on b.id = r.batch_id
   where ${inSites("b.site_id", p.siteIds)} and r.status = 'completed' and r.started_at is not null
     and rs.expected_duration_minutes is not null and ${inPeriod("r.completed_at", p)}`;

const dispenseFirstTime = (p: KpiQueryParams) => sql`
  select b.site_id, 'batch'::text as ref_type, b.id as ref_id, b.batch_number as ref_number, x.recorded_at as basis_at,
         case when x.is_within_tolerance then 1 else 0 end::numeric as num, 1::numeric as den, m.name as item,
         x.actual_qty_g || ' g of ' || bm.theoretical_qty_g || ' g' as detail,
         case when x.is_within_tolerance then 'within' else 'outside' end as category
    from dispense_records x join batch_materials bm on bm.id = x.batch_material_id join batches b on b.id = bm.batch_id
    join materials m on m.id = bm.material_id
   where ${inSites("b.site_id", p.siteIds)} and x.supersedes_id is null and (x.voided_at is null or x.voided_at > ${T(p)})
     and ${inPeriod("x.recorded_at", p)}`;

const openWorkOrders = (p: KpiQueryParams, lateOnly: boolean) => sql`
  select w.site_id, 'work_order'::text as ref_type, w.id as ref_id, w.work_order_number as ref_number, w.created_at as basis_at,
         1::numeric as num, null::numeric as den, pr.name as item,
         ${lateOnly ? sql`'Due ' || w.planned_end || ', ' || (${dt(p.asOfDate)} - w.planned_end) || ' days late'` : sql`'Due ' || w.planned_end`} as detail,
         ${workOrderStatusAt("w", p.asOf)} as category
    from work_orders w join products pr on pr.id = w.product_id
   where ${inSites("w.site_id", p.siteIds)} and w.created_at <= ${T(p)}
     and ${workOrderStatusAt("w", p.asOf)} in ('planned', 'released', 'in_progress')
     ${lateOnly ? sql`and w.planned_end < ${dt(p.asOfDate)}` : sql``}`;

// ---------------------------------------------------------------- inventory

/** Lots with stock on hand as of T, with their status as of T and an "expired by date" flag. */
const stockLots = (p: KpiQueryParams, where: SQL, num: SQL, category: SQL, detail: SQL) => sql`
  with oh as (${onHandCte(p)}),
  lots as (select l.*, ${lotStatusAt("l", p.asOf)} as status_at, oh.qty as on_hand,
                  (l.expires_on is not null and l.expires_on < ${dt(p.asOfDate)}) as past_expiry
             from oh join inventory_lots l on l.id = oh.lot_id)
  select l.site_id, 'lot'::text as ref_type, l.id as ref_id, l.lot_number as ref_number, l.created_at as basis_at,
         ${num} as num, null::numeric as den, ${lotItemName("l")} as item, ${detail} as detail, ${category} as category
    from lots l where ${where}`;

const qtyDetail = sql`l.on_hand || ' ' || l.base_uom || coalesce(', expires ' || l.expires_on, '')`;
const usable = sql`l.status_at = 'released' and not l.past_expiry`;

const materialCoverage = (p: KpiQueryParams) => sql`
  with oh as (${onHandCte(p)}),
  usable as (select oh.site_id, l.material_id, sum(oh.qty) as q from oh join inventory_lots l on l.id = oh.lot_id
              where l.material_id is not null and ${lotStatusAt("l", p.asOf)} = 'released'
                and (l.expires_on is null or l.expires_on >= ${dt(p.asOfDate)}) group by 1, 2),
  wo as (select w.* from work_orders w
          where ${inSites("w.site_id", p.siteIds)} and w.created_at <= ${T(p)} and w.formula_revision_id is not null
            and ${workOrderStatusAt("w", p.asOf)} in ('planned', 'released')),
  req as (select wo.id as wo_id, wo.site_id, bl.material_id,
                 sum(case when bl.scaling = 'fixed' then bl.quantity_g * wo.batch_count else bl.quantity_g * wo.qty_planned_base / fr.reference_batch_size_g end) as q
            from wo join formula_revisions fr on fr.id = wo.formula_revision_id join bom_lines bl on bl.formula_revision_id = wo.formula_revision_id
           group by 1, 2, 3),
  short as (select r.wo_id, string_agg(m.code, ', ' order by m.code) as codes, count(*) as n
              from req r join materials m on m.id = r.material_id left join usable u on u.site_id = r.site_id and u.material_id = r.material_id
             where coalesce(u.q, 0) < r.q group by 1)
  select wo.site_id, 'work_order'::text as ref_type, wo.id as ref_id, wo.work_order_number as ref_number, wo.created_at as basis_at,
         case when s.n is null then 1 else 0 end::numeric as num, 1::numeric as den, pr.name as item,
         coalesce('Short: ' || s.codes, 'All materials covered by released stock') as detail,
         case when s.n is null then 'covered' else 'short' end as category
    from wo join products pr on pr.id = wo.product_id left join short s on s.wo_id = wo.id`;

const dockToStock = (p: KpiQueryParams) => sql`
  select g.site_id, 'goods_receipt'::text as ref_type, g.id as ref_id, g.receipt_number as ref_number, d.released_at as basis_at,
         ${hours("d.released_at", "g.received_at")} as num, null::numeric as den, m.name as item,
         coalesce(l.lot_number, '') || ' released' as detail, null::text as category
    from goods_receipt_lines gl join goods_receipts g on g.id = gl.goods_receipt_id join materials m on m.id = gl.material_id
    join inventory_lots l on l.id = gl.lot_id
    join lateral (select min(x.decided_at) as released_at from dispositions x
                   where x.subject_type = 'lot' and x.subject_id = gl.lot_id and x.to_status = 'released' and x.decided_at <= ${T(p)}) d on true
   where ${inSites("g.site_id", p.siteIds)} and g.status in ('posted', 'reversed') and g.posted_at <= ${T(p)} and ${inPeriod("d.released_at", p)}`;

const receiptDiscrepancy = (p: KpiQueryParams) => sql`
  select g.site_id, 'goods_receipt'::text as ref_type, g.id as ref_id, g.receipt_number as ref_number, g.posted_at as basis_at,
         case when gl.discrepancy_kind is not null then 1 else 0 end::numeric as num, 1::numeric as den, m.name as item,
         coalesce(gl.discrepancy_kind || coalesce(': ' || gl.discrepancy_note, ''), 'No discrepancy') as detail,
         coalesce(gl.discrepancy_kind, 'none') as category
    from goods_receipt_lines gl join goods_receipts g on g.id = gl.goods_receipt_id join materials m on m.id = gl.material_id
   where ${inSites("g.site_id", p.siteIds)} and g.status in ('posted', 'reversed') and ${inPeriod("g.posted_at", p)}`;

const ledgerCheck = (p: KpiQueryParams) => sql`
  select distinct on (coalesce(r.site_id::text, 'org')) r.site_id, 'reconciliation_run'::text as ref_type, r.id as ref_id,
         to_char(r.as_of at time zone ${p.tz}, 'YYYY-MM-DD HH24:MI') as ref_number, r.created_at as basis_at,
         r.differences_count::numeric as num, null::numeric as den, 'Stock ledger vs balances'::text as item,
         r.status || ', ' || r.differences_count || ' differences' as detail, r.status as category
    from reconciliation_runs r
   where r.kind = 'inventory_balances' and r.created_at <= ${T(p)} and (${inSites("r.site_id", p.siteIds)} or r.site_id is null)
   order by coalesce(r.site_id::text, 'org'), r.created_at desc, r.id desc`;

// ---------------------------------------------------------------- quality

const turnaround = (p: KpiQueryParams) => sql`
  select i.site_id, 'inspection'::text as ref_type, i.id as ref_id, i.inspection_number as ref_number, i.reviewed_at as basis_at,
         ${hours("i.reviewed_at", "i.sampled_at")} as num, null::numeric as den, i.inspection_kind as item,
         'Outcome ' || coalesce(i.outcome, '—') as detail, i.inspection_kind as category
    from inspections i
   where ${inSites("i.site_id", p.siteIds)} and i.status in ('approved', 'rejected') and i.sampled_at is not null and ${inPeriod("i.reviewed_at", p)}`;

const firstPass = (p: KpiQueryParams) => sql`
  select i.site_id, 'inspection'::text as ref_type, i.id as ref_id, i.inspection_number as ref_number, i.reviewed_at as basis_at,
         case when i.outcome = 'pass' then 1 else 0 end::numeric as num, 1::numeric as den,
         coalesce((select b.batch_number from batches b where b.id = i.batch_id), '') as item,
         'Outcome ' || coalesce(i.outcome, '—') as detail, coalesce(i.outcome, 'none') as category
    from inspections i
   where ${inSites("i.site_id", p.siteIds)} and i.inspection_kind = 'finished_product' and i.status in ('approved', 'rejected') and ${inPeriod("i.reviewed_at", p)}`;

const openHolds = (p: KpiQueryParams, ageAsNum: boolean) => sql`
  select h.site_id, 'quality_hold'::text as ref_type, h.id as ref_id, h.hold_number as ref_number, h.opened_at as basis_at,
         ${ageAsNum ? sql`round(extract(epoch from (${T(p)} - h.opened_at)) / 86400, 4)` : sql`1::numeric`} as num, null::numeric as den,
         coalesce((select l.lot_number from inventory_lots l where l.id = h.lot_id), (select lo.code from locations lo where lo.id = h.location_id), '') as item,
         h.reason_code || ', open ' || floor(extract(epoch from (${T(p)} - h.opened_at)) / 86400) || ' days' as detail,
         h.status as category
    from quality_holds h
   where ${inSites("h.site_id", p.siteIds)} and h.opened_at <= ${T(p)} and (h.closed_at is null or h.closed_at > ${T(p)})`;

const outOfSpec = (p: KpiQueryParams) => sql`
  select i.site_id, 'inspection'::text as ref_type, i.id as ref_id, i.inspection_number as ref_number, t.tested_at as basis_at,
         case when t.passed then 0 else 1 end::numeric as num, 1::numeric as den, t.test_name as item,
         case when t.passed then 'Within specification' else 'Out of specification' end as detail,
         case when t.passed then 'within' else 'oos' end as category
    from test_results t join inspections i on i.id = t.inspection_id
   where ${inSites("i.site_id", p.siteIds)} and ${inPeriod("t.tested_at", p)}
     and not exists (select 1 from test_results n where n.supersedes_id = t.id and n.tested_at <= ${T(p)})`;

const rejections = (p: KpiQueryParams) => sql`
  select d.site_id, d.subject_type as ref_type, d.subject_id as ref_id,
         coalesce((select l.lot_number from inventory_lots l where d.subject_type = 'lot' and l.id = d.subject_id),
                  (select b.batch_number from batches b where d.subject_type = 'batch' and b.id = d.subject_id)) as ref_number,
         d.decided_at as basis_at, 1::numeric as num, null::numeric as den, d.decision as item, coalesce(d.reason, '') as detail, d.subject_type as category
    from dispositions d
   where ${inSites("d.site_id", p.siteIds)} and d.to_status = 'rejected' and ${inPeriod("d.decided_at", p)}`;

const deviationsRaised = (p: KpiQueryParams) => sql`
  select d.site_id, 'deviation'::text as ref_type, d.id as ref_id, d.deviation_number as ref_number, d.raised_at as basis_at,
         1::numeric as num, null::numeric as den, d.source as item, coalesce(d.severity, 'unclassified') || ', ' || d.status as detail,
         coalesce(d.severity, 'unclassified') as category
    from deviations d where ${inSites("d.site_id", p.siteIds)} and ${inPeriod("d.raised_at", p)}`;

const deviationsClosed = (p: KpiQueryParams) => sql`
  select d.site_id, 'deviation'::text as ref_type, d.id as ref_id, d.deviation_number as ref_number, d.closed_at as basis_at,
         ${days("d.closed_at", "d.raised_at")} as num, null::numeric as den, d.source as item, coalesce(d.severity, 'unclassified') as detail,
         coalesce(d.severity, 'unclassified') as category
    from deviations d where ${inSites("d.site_id", p.siteIds)} and d.closed_at is not null and ${inPeriod("d.closed_at", p)}`;

const incomingBacklog = (p: KpiQueryParams) => sql`
  select i.site_id, 'inspection'::text as ref_type, i.id as ref_id, i.inspection_number as ref_number, i.created_at as basis_at,
         1::numeric as num, null::numeric as den, coalesce((select l.lot_number from inventory_lots l where l.id = i.lot_id), '') as item,
         'Open ' || floor(extract(epoch from (${T(p)} - i.created_at)) / 86400) || ' days' as detail, ${inspectionStatusAt("i", p.asOf)} as category
    from inspections i
   where ${inSites("i.site_id", p.siteIds)} and i.inspection_kind = 'incoming' and i.created_at <= ${T(p)}
     and ${inspectionStatusAt("i", p.asOf)} in ('pending', 'in_progress', 'awaiting_review')`;

// ---------------------------------------------------------------- owner

/** KPI-OWN-13: distinct open action-centre items (one per dedupe key, not per recipient). */
const openExceptions = (p: KpiQueryParams) => sql`
  select distinct on (coalesce(n.dedupe_key, n.kind || ':' || coalesce(n.entity_id::text, n.title)))
         n.site_id, 'notification'::text as ref_type, n.id as ref_id, n.kind as ref_number, n.created_at as basis_at,
         1::numeric as num, null::numeric as den, n.title as item, n.severity as detail, n.severity as category
    from notifications n
   where n.created_at <= ${T(p)} and (n.resolved_at is null or n.resolved_at > ${T(p)}) and (n.acknowledged_at is null or n.acknowledged_at > ${T(p)})
     and (${inSites("n.site_id", p.siteIds)}${p.includeOrgLevel ? sql` or n.site_id is null` : sql``})
   order by coalesce(n.dedupe_key, n.kind || ':' || coalesce(n.entity_id::text, n.title)), n.created_at, n.id`;

// ---------------------------------------------------------------- catalogue

const SALES_VIEW: Permission[] = ["sales.sales_order.view"];
const OUTCOMES = [
  { key: "on_time", label: "On time in full", tone: "good" as const },
  { key: "late", label: "Late", tone: "bad" as const },
  { key: "open", label: "Open / short", tone: "neutral" as const },
];

export const KPIS: KpiDefinition[] = [
  // sales
  {
    code: "KPI-SAL-01", name: "Orders confirmed", short: "Orders", area: "sales", kind: "period", aggregate: "sum", unit: "count", label: "actual", refresh: "live", additive: true, better: "up",
    definition: "Sales orders entered in the period that are confirmed or further along (drafts and cancelled orders excluded).",
    formula: "COUNT(sales orders created in [from, to) with status not in (draft, cancelled))",
    timeBasis: "sales_orders.created_at (order entry; until order state transitions are recorded, A-W3A-03)",
    sources: ["sales_orders.created_at", "sales_orders.status", "customers.name"], permissions: SALES_VIEW,
    rows: (p) => confirmedOrders(p, false),
  },
  {
    code: "KPI-SAL-01V", name: "Order value confirmed", short: "Order value", area: "sales", kind: "period", aggregate: "sum", unit: "money", label: "actual", refresh: "live", additive: true, better: "up",
    definition: "Value at order price of the orders counted by KPI-SAL-01.",
    formula: "Σ sales_order_lines.qty_units × unit_price over the orders of KPI-SAL-01",
    timeBasis: "sales_orders.created_at", sources: ["sales_orders", "sales_order_lines.qty_units", "sales_order_lines.unit_price"],
    permissions: [...SALES_VIEW, "analytics.financial_kpi.view"],
    rows: (p) => confirmedOrders(p, true),
  },
  {
    code: "KPI-SAL-02", name: "On time in full (OTIF)", short: "OTIF", area: "sales", kind: "period", aggregate: "ratio", unit: "ratio", label: "actual", refresh: "mv15", additive: true, better: "up",
    definition: "Share of orders due in the period whose every product was shipped in full, with the last dispatch on or before the requested date (plus the configured grace days).",
    formula: "orders on time in full / orders due in [from, to); due = requested_delivery_on; shipped = Σ non-reversed shipment movements per product",
    timeBasis: "sales_orders.requested_delivery_on; shipments.dispatched_at (A-KPI-02)",
    sources: ["sales_orders.requested_delivery_on", "sales_order_lines.qty_units", "shipments.dispatched_at", "stock_movements (shipment)"],
    permissions: SALES_VIEW, categories: OUTCOMES,
    rows: otif,
  },
  {
    code: "KPI-SAL-03", name: "Fill rate on first shipment", short: "Fill rate", area: "sales", kind: "period", aggregate: "ratio", unit: "ratio", label: "actual", refresh: "mv15", additive: true, better: "up",
    definition: "Quantity on the first dispatched shipment of each order divided by the ordered quantity, for orders first shipped in the period.",
    formula: "Σ qty on first shipment / Σ ordered qty, orders whose first dispatch is in [from, to)",
    timeBasis: "first shipments.dispatched_at", sources: ["shipments", "stock_movements (shipment)", "sales_order_lines.qty_units"],
    permissions: SALES_VIEW, rows: fillRate,
  },
  {
    code: "KPI-SAL-04", name: "Order-to-ship time", short: "Order to ship", area: "sales", kind: "period", aggregate: "median", unit: "days", label: "actual", refresh: "mv15", additive: false, better: "down",
    definition: "Median days from order entry to the first dispatch, for orders first shipped in the period.",
    formula: "percentile_disc(0.5) of (first dispatched_at − sales_orders.created_at) in days",
    timeBasis: "first shipments.dispatched_at", sources: ["sales_orders.created_at", "shipments.dispatched_at"],
    permissions: SALES_VIEW, rows: orderToShip,
  },
  {
    code: "KPI-SAL-11", name: "Unshipped orders past requested date", short: "Overdue orders", area: "sales", kind: "asof", aggregate: "sum", unit: "count", label: "actual", refresh: "live", additive: true, better: "down",
    definition: "Orders (not draft or cancelled) whose requested delivery date has passed and that had no dispatch yet, as of the period end.",
    formula: "COUNT(orders with requested_delivery_on < as-of date and no shipment dispatched by as-of)",
    timeBasis: "as of the period end", sources: ["sales_orders.requested_delivery_on", "shipments.dispatched_at"],
    permissions: SALES_VIEW, rows: overdueOrders,
  },
  {
    code: "KPI-FIN-02", name: "Shipped value at order price", short: "Shipped value", area: "finance", kind: "period", aggregate: "sum", unit: "money", label: "estimate", refresh: "mv15", additive: true, better: "up",
    definition: "Value of goods dispatched in the period at the order's unit price. An estimate of revenue until invoices exist (Phase 6, A-KPI-10).",
    formula: "Σ shipped qty × (Σ line qty × unit price / Σ line qty of that product on the order), shipments dispatched in [from, to)",
    timeBasis: "shipments.dispatched_at", sources: ["shipments", "stock_movements (shipment)", "sales_order_lines.unit_price"],
    permissions: [...SALES_VIEW, "analytics.financial_kpi.view"], rows: shippedValue,
  },
  // production
  {
    code: "KPI-OPS-01", name: "Output vs plan", short: "Output vs plan", area: "operations", kind: "period", aggregate: "ratio", unit: "ratio", label: "actual", refresh: "mv15", additive: true, better: "up",
    definition: "Finished output mass posted in the period divided by the planned mass of work orders due in the period.",
    formula: "Σ net output postings (mass, g) in [from, to) / Σ work_orders.qty_planned_base with planned_end in [from, to)",
    timeBasis: "production_postings.posted_at; work_orders.planned_end", sources: ["production_postings (output)", "batch_outputs.mass_g", "work_orders.qty_planned_base"],
    permissions: ["production.batch.view", "production.work_order.view"],
    categories: [{ key: "actual", label: "Actual output" }, { key: "planned", label: "Planned" }],
    rows: outputVsPlan,
  },
  {
    code: "KPI-OPS-02", name: "Yield", short: "Yield", area: "operations", kind: "period", aggregate: "ratio", unit: "ratio", label: "actual", refresh: "mv15", additive: true, better: "up",
    definition: "Actual good output mass divided by theoretical output mass, over the current yield record of batches whose yield was first recorded in the period.",
    formula: "Σ yield_records.actual_base / Σ theoretical_base (latest record per batch)",
    timeBasis: "first yield_records.recorded_at of the batch (A-W3A-04)", sources: ["yield_records", "batches"],
    permissions: ["production.batch.view"],
    categories: [{ key: "within", label: "Within limits", tone: "good" }, { key: "outside", label: "Outside limits", tone: "bad" }],
    rows: (p) => yieldBase(p, sql`y.actual_base`, sql`y.theoretical_base`, sql`case when y.is_within_limits then 'within' else 'outside' end`),
  },
  {
    code: "KPI-OPS-03", name: "Yield loss", short: "Yield loss", area: "operations", kind: "period", aggregate: "sum", unit: "qty_g", label: "actual", refresh: "mv15", additive: true, better: "down",
    definition: "Theoretical minus actual output mass over the batches of KPI-OPS-02 (negative = above theoretical).",
    formula: "Σ (theoretical_base − actual_base)", timeBasis: "first yield_records.recorded_at of the batch", sources: ["yield_records"],
    permissions: ["production.batch.view"],
    rows: (p) => yieldBase(p, sql`y.theoretical_base - y.actual_base`, sql`null::numeric`, sql`null::text`),
  },
  {
    code: "KPI-OPS-05", name: "Open work orders", short: "Open work orders", area: "operations", kind: "asof", aggregate: "sum", unit: "count", label: "actual", refresh: "post", additive: true, better: null,
    definition: "Work orders planned, released or in progress at the period end.",
    formula: "COUNT(work orders with status as of T in (planned, released, in_progress))", timeBasis: "as of the period end (work_order_state_transitions)",
    sources: ["work_orders", "work_order_state_transitions"], permissions: ["production.work_order.view"],
    categories: [{ key: "planned", label: "Planned" }, { key: "released", label: "Released" }, { key: "in_progress", label: "In progress" }],
    rows: (p) => openWorkOrders(p, false),
  },
  {
    code: "KPI-OPS-07", name: "Step overrun minutes", short: "Step overrun", area: "operations", kind: "period", aggregate: "sum", unit: "minutes", label: "actual", refresh: "mv15", additive: true, better: "down",
    definition: "Minutes by which completed process steps ran over their expected duration (steps with an expected duration only).",
    formula: "Σ max(0, (completed_at − started_at) in minutes − routing_steps.expected_duration_minutes)", timeBasis: "process_step_records.completed_at",
    sources: ["process_step_records", "routing_steps.expected_duration_minutes"], permissions: ["production.batch.view"],
    rows: stepOverrun,
  },
  {
    code: "KPI-OPS-13", name: "Right first time", short: "Right first time", area: "operations", kind: "period", aggregate: "ratio", unit: "ratio", label: "actual", refresh: "mv15", additive: true, better: "up",
    definition: "Share of the batches of KPI-OPS-02 with no deviation, no dispensing exception and no step exception or skipped step.",
    formula: "batches without deviation / CX-TOL dispense / step exception / skipped step ÷ batches", timeBasis: "first yield_records.recorded_at of the batch",
    sources: ["yield_records", "deviations", "dispense_records.exception_approved_by", "process_step_records"], permissions: ["production.batch.view"],
    rows: (p) => yieldBase(p, rightFirstTime(p), sql`1::numeric`, sql`case when ${rightFirstTime(p)} = 1 then 'right_first_time' else 'exception' end`),
  },
  {
    code: "KPI-OPS-14", name: "Late work orders", short: "Late work orders", area: "operations", kind: "asof", aggregate: "sum", unit: "count", label: "actual", refresh: "live", additive: true, better: "down",
    definition: "Open work orders whose planned end date has passed, as of the period end.",
    formula: "COUNT(open work orders with planned_end < as-of date)", timeBasis: "as of the period end",
    sources: ["work_orders.planned_end", "work_order_state_transitions"], permissions: ["production.work_order.view"],
    rows: (p) => openWorkOrders(p, true),
  },
  {
    code: "KPI-OPS-16", name: "Dispensing first time in tolerance", short: "Dispense in tolerance", area: "operations", kind: "period", aggregate: "ratio", unit: "ratio", label: "actual", refresh: "mv15", additive: true, better: "up",
    definition: "Share of original (not corrected, not voided) weighings recorded in the period whose line total was within tolerance.",
    formula: "COUNT(is_within_tolerance) / COUNT(*) over dispense_records with supersedes_id null", timeBasis: "dispense_records.recorded_at",
    sources: ["dispense_records", "batch_materials"], permissions: ["production.batch.view"],
    rows: dispenseFirstTime,
  },
  // inventory
  {
    code: "KPI-INV-01G", name: "Usable stock (g)", short: "Usable stock (g)", area: "inventory", kind: "asof", aggregate: "sum", unit: "qty_g", label: "actual", refresh: "post", additive: true, better: null,
    definition: "On-hand quantity of released, unexpired lots counted in grams, at the period end.",
    formula: "Σ on hand of lots with status released and expiry ≥ as-of date, base unit g", timeBasis: "as of the period end",
    sources: ["inventory_balances", "stock_movements", "inventory_lots", "dispositions"], permissions: ["inventory.lot.view"],
    rows: (p) => stockLots(p, sql`${usable} and l.base_uom = 'g'`, sql`l.on_hand`, sql`l.item_kind`, qtyDetail),
  },
  {
    code: "KPI-INV-01P", name: "Usable stock (pcs)", short: "Usable stock (pcs)", area: "inventory", kind: "asof", aggregate: "sum", unit: "qty_pcs", label: "actual", refresh: "post", additive: true, better: null,
    definition: "On-hand quantity of released, unexpired lots counted in pieces, at the period end.",
    formula: "Σ on hand of lots with status released and expiry ≥ as-of date, base unit pcs", timeBasis: "as of the period end",
    sources: ["inventory_balances", "stock_movements", "inventory_lots", "dispositions"], permissions: ["inventory.lot.view"],
    rows: (p) => stockLots(p, sql`${usable} and l.base_uom = 'pcs'`, sql`l.on_hand`, sql`l.item_kind`, qtyDetail),
  },
  {
    code: "KPI-INV-02", name: "Blocked lots", short: "Blocked stock", area: "inventory", kind: "asof", aggregate: "sum", unit: "count", label: "actual", refresh: "post", additive: true, better: "down",
    definition: "Lots with stock on hand that cannot be used: quarantined, on hold, rejected, recalled or expired, at the period end.",
    formula: "COUNT(lots on hand with status in (quarantine, on_hold, rejected, recalled, expired) or past expiry)", timeBasis: "as of the period end",
    sources: ["inventory_balances", "stock_movements", "inventory_lots", "dispositions"], permissions: ["inventory.lot.view"],
    categories: [
      { key: "quarantine", label: "Quarantine" }, { key: "on_hold", label: "QA hold" }, { key: "rejected", label: "Rejected" },
      { key: "recalled", label: "Recalled" }, { key: "expired", label: "Expired" },
    ],
    rows: (p) => stockLots(p, sql`(l.status_at in ('quarantine', 'on_hold', 'rejected', 'recalled', 'expired') or (l.status_at = 'released' and l.past_expiry))`, sql`1::numeric`, sql`case when l.past_expiry and l.status_at = 'released' then 'expired' else l.status_at end`, qtyDetail),
  },
  {
    code: "KPI-INV-04", name: "Lots at FEFO risk", short: "FEFO risk", area: "inventory", kind: "asof", aggregate: "sum", unit: "count", label: "actual", refresh: "post", additive: true, better: "down",
    definition: "Released lots with stock on hand that expire within the configured window (default 30 days), at the period end.",
    formula: "COUNT(released lots on hand with expires_on between as-of date and as-of date + window)", timeBasis: "as of the period end; inventory_lots.expires_on",
    sources: ["inventory_balances", "inventory_lots.expires_on", "dispositions"], permissions: ["inventory.lot.view"],
    rows: (p) => stockLots(p, sql`l.status_at = 'released' and l.expires_on between ${dt(p.asOfDate)} and ${dt(p.asOfDate)} + ${p.fefoWindowDays}::int`, sql`1::numeric`, sql`case when l.expires_on <= ${dt(p.asOfDate)} + 14 then 'within_14' else 'within_window' end`, qtyDetail),
  },
  {
    code: "KPI-INV-04E", name: "Expired lots on hand", short: "Expired on hand", area: "inventory", kind: "asof", aggregate: "sum", unit: "count", label: "actual", refresh: "post", additive: true, better: "down",
    definition: "Lots with stock on hand that are past their expiry date or in status Expired, at the period end.",
    formula: "COUNT(lots on hand with expires_on < as-of date or status expired)", timeBasis: "as of the period end",
    sources: ["inventory_balances", "inventory_lots.expires_on", "dispositions"], permissions: ["inventory.lot.view"],
    rows: (p) => stockLots(p, sql`(l.past_expiry or l.status_at = 'expired')`, sql`1::numeric`, sql`l.status_at`, qtyDetail),
  },
  {
    code: "KPI-INV-07", name: "Material coverage of planned work orders", short: "Material coverage", area: "inventory", kind: "asof", aggregate: "ratio", unit: "ratio", label: "actual", refresh: "mv15", additive: true, better: "up",
    definition: "Share of planned and released work orders whose every BOM material requirement is covered by released, unexpired stock at the site (each order judged on its own).",
    formula: "work orders with no short material / work orders in (planned, released)", timeBasis: "as of the period end",
    sources: ["work_orders", "bom_lines", "formula_revisions", "inventory_balances", "inventory_lots"], permissions: ["production.work_order.view", "inventory.lot.view"],
    categories: [{ key: "covered", label: "Covered", tone: "good" }, { key: "short", label: "Short", tone: "bad" }],
    rows: materialCoverage,
  },
  {
    code: "KPI-INV-09", name: "Dock-to-stock time", short: "Dock to stock", area: "inventory", kind: "period", aggregate: "median", unit: "hours", label: "actual", refresh: "mv15", additive: false, better: "down",
    definition: "Median hours from receipt to the lot's first release, for lots released in the period.",
    formula: "percentile_disc(0.5) of (first release disposition − goods_receipts.received_at) in hours", timeBasis: "dispositions.decided_at (first release)",
    sources: ["goods_receipts.received_at", "goods_receipt_lines", "dispositions"], permissions: ["procurement.goods_receipt.view"],
    rows: dockToStock,
  },
  {
    code: "KPI-INV-10", name: "Receipt discrepancy rate", short: "Receipt discrepancies", area: "inventory", kind: "period", aggregate: "ratio", unit: "ratio", label: "actual", refresh: "mv15", additive: true, better: "down",
    definition: "Share of posted receipt lines with a recorded discrepancy (short, over, damaged, wrong item, missing documents).",
    formula: "lines with discrepancy_kind / posted receipt lines, receipts posted in [from, to)", timeBasis: "goods_receipts.posted_at",
    sources: ["goods_receipt_lines.discrepancy_kind", "goods_receipts.posted_at"], permissions: ["procurement.goods_receipt.view"],
    rows: receiptDiscrepancy,
  },
  {
    code: "KPI-INV-14", name: "Ledger differences at the last check", short: "Ledger check", area: "inventory", kind: "asof", aggregate: "max", unit: "count", label: "actual", refresh: "night", additive: false, nullSiteRows: "every_site", better: "down",
    definition: "Differences between the stock ledger and the balance projection found by the last inventory.reconcile run before the period end (0 = they agree).",
    formula: "differences_count of the latest reconciliation_runs row (kind inventory_balances) per site or organization", timeBasis: "reconciliation_runs.created_at",
    sources: ["reconciliation_runs"], permissions: ["inventory.lot.view"],
    rows: ledgerCheck,
  },
  // quality
  {
    code: "KPI-QUA-01", name: "QC turnaround (median)", short: "QC turnaround", area: "quality", kind: "period", aggregate: "median", unit: "hours", label: "actual", refresh: "mv15", additive: false, better: "down",
    definition: "Median hours from first sample to QA review, for inspections reviewed in the period.",
    formula: "percentile_disc(0.5) of (reviewed_at − sampled_at) in hours", timeBasis: "inspections.reviewed_at",
    sources: ["inspections.sampled_at", "inspections.reviewed_at"], permissions: ["quality.inspection.view"],
    rows: turnaround,
  },
  {
    code: "KPI-QUA-01P", name: "QC turnaround (90th percentile)", short: "QC turnaround p90", area: "quality", kind: "period", aggregate: "p90", unit: "hours", label: "actual", refresh: "mv15", additive: false, better: "down",
    definition: "90th percentile of hours from first sample to QA review, for inspections reviewed in the period.",
    formula: "percentile_disc(0.9) of (reviewed_at − sampled_at) in hours", timeBasis: "inspections.reviewed_at",
    sources: ["inspections.sampled_at", "inspections.reviewed_at"], permissions: ["quality.inspection.view"],
    rows: turnaround,
  },
  {
    code: "KPI-QUA-02", name: "First-pass release rate", short: "First pass", area: "quality", kind: "period", aggregate: "ratio", unit: "ratio", label: "actual", refresh: "mv15", additive: true, better: "up",
    definition: "Share of finished-product inspections reviewed in the period with outcome Pass.",
    formula: "finished-product inspections with outcome pass / reviewed finished-product inspections", timeBasis: "inspections.reviewed_at",
    sources: ["inspections.outcome", "inspections.reviewed_at"], permissions: ["quality.inspection.view"],
    rows: firstPass,
  },
  {
    code: "KPI-QUA-03", name: "Quality holds open", short: "QA holds", area: "quality", kind: "asof", aggregate: "sum", unit: "count", label: "actual", refresh: "live", additive: true, better: "down",
    definition: "Quality holds open or under investigation at the period end.",
    formula: "COUNT(quality_holds opened ≤ T and not closed by T)", timeBasis: "as of the period end",
    sources: ["quality_holds.opened_at", "quality_holds.closed_at"], permissions: ["quality.hold.view"],
    rows: (p) => openHolds(p, false),
  },
  {
    code: "KPI-QUA-03A", name: "Oldest open hold (days)", short: "Oldest hold", area: "quality", kind: "asof", aggregate: "max", unit: "days", label: "actual", refresh: "live", additive: false, better: "down",
    definition: "Age in days of the oldest quality hold open at the period end.",
    formula: "MAX(T − opened_at) over the holds of KPI-QUA-03", timeBasis: "as of the period end",
    sources: ["quality_holds.opened_at", "quality_holds.closed_at"], permissions: ["quality.hold.view"],
    rows: (p) => openHolds(p, true),
  },
  {
    code: "KPI-QUA-04", name: "Out-of-specification rate", short: "OOS rate", area: "quality", kind: "period", aggregate: "ratio", unit: "ratio", label: "actual", refresh: "mv15", additive: true, better: "down",
    definition: "Share of current inspection test results (corrections replace the original) recorded in the period that are out of specification.",
    formula: "results not within specification / results, latest per correction chain", timeBasis: "test_results.tested_at",
    sources: ["test_results.passed", "test_results.supersedes_id", "inspections"], permissions: ["quality.inspection.view"],
    rows: outOfSpec,
  },
  {
    code: "KPI-QUA-05", name: "Lots and batches rejected", short: "Rejections", area: "quality", kind: "period", aggregate: "sum", unit: "count", label: "actual", refresh: "mv15", additive: true, better: "down",
    definition: "QA dispositions in the period that moved a lot or batch to Rejected.",
    formula: "COUNT(dispositions with to_status = rejected in [from, to))", timeBasis: "dispositions.decided_at",
    sources: ["dispositions"], permissions: ["quality.disposition.view"],
    rows: rejections,
  },
  {
    code: "KPI-QUA-06", name: "Deviations raised", short: "Deviations", area: "quality", kind: "period", aggregate: "sum", unit: "count", label: "actual", refresh: "mv15", additive: true, better: "down",
    definition: "Deviations raised in the period, by severity.",
    formula: "COUNT(deviations raised in [from, to))", timeBasis: "deviations.raised_at",
    sources: ["deviations.raised_at", "deviations.severity"], permissions: ["quality.deviation.view"],
    rows: deviationsRaised,
  },
  {
    code: "KPI-QUA-06T", name: "Deviation time to close", short: "Days to close", area: "quality", kind: "period", aggregate: "median", unit: "days", label: "actual", refresh: "mv15", additive: false, better: "down",
    definition: "Median days from raising to closing, for deviations closed in the period.",
    formula: "percentile_disc(0.5) of (closed_at − raised_at) in days", timeBasis: "deviations.closed_at",
    sources: ["deviations.raised_at", "deviations.closed_at"], permissions: ["quality.deviation.view"],
    rows: deviationsClosed,
  },
  {
    code: "KPI-QUA-11", name: "Incoming inspection backlog", short: "Incoming backlog", area: "quality", kind: "asof", aggregate: "sum", unit: "count", label: "actual", refresh: "live", additive: true, better: "down",
    definition: "Incoming inspections pending, in progress or awaiting review at the period end.",
    formula: "COUNT(incoming inspections with status as of T in (pending, in_progress, awaiting_review))", timeBasis: "as of the period end (inspection_state_transitions)",
    sources: ["inspections", "inspection_state_transitions"], permissions: ["quality.inspection.view"],
    rows: incomingBacklog,
  },
  // owner
  {
    code: "KPI-OWN-13", name: "Open exceptions", short: "Exceptions", area: "owner", kind: "asof", aggregate: "sum", unit: "count", label: "actual", refresh: "live", additive: false, nullSiteRows: "all_only", better: "down",
    definition: "Distinct action-centre items (one per alert, not per recipient) not acknowledged or resolved at the period end. Organization-level items count in the all-sites scope only.",
    formula: "COUNT(DISTINCT dedupe key of notifications created ≤ T, not acknowledged or resolved by T)", timeBasis: "as of the period end",
    sources: ["notifications.created_at", "notifications.acknowledged_at", "notifications.resolved_at"], permissions: ["analytics.owner_dashboard.view"],
    categories: [{ key: "critical", label: "Critical", tone: "bad" }, { key: "warning", label: "Warning", tone: "warn" }, { key: "info", label: "Info" }],
    rows: openExceptions,
  },
];

/** Owner KPIs (§2.1) that cannot be computed from posted data yet. */
export const UNAVAILABLE_KPIS: UnavailableKpi[] = [
  { code: "KPI-OWN-03", name: "Gross margin", short: "Gross margin", reason: "Needs invoices and final costing runs (finance scope, ADR-020).", phase: "Phase 6", permissions: ["analytics.financial_kpi.view"] },
  { code: "KPI-OWN-07", name: "Stock value", short: "Stock value", reason: "Lot unit costs are not recorded yet; a value would be invented (A-KPI-08).", phase: "Phase 6", permissions: ["inventory.lot.view"] },
  { code: "KPI-OWN-11", name: "Labour: present vs scheduled", short: "Labour", reason: "Attendance imports and shifts are not built yet (HR module).", phase: "Phase 5–6", permissions: ["analytics.dashboard.view"] },
  { code: "KPI-OWN-12", name: "Cash, receivables, payables", short: "Cash & AR/AP", reason: "Needs invoices, bills and payments (finance scope, ADR-020).", phase: "Phase 6", permissions: ["analytics.financial_kpi.view"] },
];

const BY_CODE = new Map(KPIS.map((k) => [k.code, k]));

export function kpiByCode(code: string): KpiDefinition | undefined {
  return BY_CODE.get(code);
}

/** Owner overview composition (§2.1, A-KPI-18): each owner KPI and the detailed KPIs it is built from. */
export const OWNER_KPIS: { code: string; name: string; builtFrom: string[] }[] = [
  { code: "KPI-OWN-01", name: "Orders confirmed (value when permitted)", builtFrom: ["KPI-SAL-01", "KPI-SAL-01V"] },
  { code: "KPI-OWN-02", name: "Revenue: shipped value at order price (Estimate)", builtFrom: ["KPI-FIN-02"] },
  { code: "KPI-OWN-03", name: "Gross margin", builtFrom: [] },
  { code: "KPI-OWN-04", name: "Production: output vs plan", builtFrom: ["KPI-OPS-01"] },
  { code: "KPI-OWN-05", name: "Yield and yield loss", builtFrom: ["KPI-OPS-02", "KPI-OPS-03"] },
  { code: "KPI-OWN-06", name: "Material availability of planned work orders", builtFrom: ["KPI-INV-07"] },
  { code: "KPI-OWN-07", name: "Stock value", builtFrom: [] },
  { code: "KPI-OWN-08", name: "Stock at FEFO risk", builtFrom: ["KPI-INV-04", "KPI-INV-04E"] },
  { code: "KPI-OWN-09", name: "Order fulfilment (OTIF)", builtFrom: ["KPI-SAL-02"] },
  { code: "KPI-OWN-10", name: "Quality holds open", builtFrom: ["KPI-QUA-03", "KPI-QUA-03A"] },
  { code: "KPI-OWN-11", name: "Labour", builtFrom: [] },
  { code: "KPI-OWN-12", name: "Cash, receivables, payables", builtFrom: [] },
  { code: "KPI-OWN-13", name: "Exceptions", builtFrom: ["KPI-OWN-13"] },
  { code: "KPI-OWN-14", name: "Site comparison", builtFrom: ["KPI-OPS-01", "KPI-OPS-02", "KPI-SAL-02", "KPI-QUA-03", "KPI-INV-04", "KPI-FIN-02"] },
];

/** Dashboard compositions (§3). */
export const DASHBOARD_KPIS: Record<"operations" | "inventory" | "quality" | "sales", string[]> = {
  operations: ["KPI-OPS-05", "KPI-OPS-01", "KPI-OPS-02", "KPI-OPS-14", "KPI-OPS-03", "KPI-OPS-13", "KPI-OPS-16", "KPI-OPS-07"],
  inventory: ["KPI-INV-01G", "KPI-INV-01P", "KPI-INV-02", "KPI-INV-04", "KPI-INV-04E", "KPI-INV-07", "KPI-INV-09", "KPI-INV-10", "KPI-INV-14"],
  quality: ["KPI-QUA-03", "KPI-QUA-01", "KPI-QUA-02", "KPI-QUA-11", "KPI-QUA-01P", "KPI-QUA-04", "KPI-QUA-05", "KPI-QUA-06", "KPI-QUA-06T", "KPI-QUA-03A"],
  sales: ["KPI-SAL-01", "KPI-SAL-02", "KPI-SAL-03", "KPI-SAL-11", "KPI-SAL-01V", "KPI-SAL-04", "KPI-FIN-02"],
};

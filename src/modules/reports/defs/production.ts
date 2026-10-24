import "server-only";
import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { countBy, dayStart, inIds, localTs, select, totalsByUnit } from "../sql";
import type { ReportDefinition, ReportRow } from "../types";

/** Production reports: batch output and yield, work orders and lateness (docs/analytics-kpis.md §2.2). */

const BATCH_STATUSES = ["draft", "planned", "materials_staged", "in_process", "awaiting_qc", "quarantined", "released", "rejected", "rework_approved", "closed"];

export const batchYieldReport: ReportDefinition = {
  code: "RPT-PRD-BATCHES",
  title: "Batch production and yield",
  category: "Production",
  description: "Batches with planned size, recorded output, theoretical yield and yield %, by the date chosen (completed, started or created).",
  viewPermission: "production.batch.view",
  exportPermission: null,
  sensitivity: "N",
  params: [
    { name: "period", kind: "period", label: "Period", default: "this_month" },
    {
      name: "basis",
      kind: "select",
      label: "Date basis",
      options: [
        { value: "completed", label: "Completed in the period" },
        { value: "started", label: "Started in the period" },
        { value: "created", label: "Created in the period" },
      ],
      default: "completed",
    },
    { name: "status", kind: "select", label: "Status", options: [{ value: "all", label: "All statuses" }, ...BATCH_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))], default: "all" },
  ],
  columns: [
    { key: "site", header: "Site" },
    { key: "batch", header: "Batch" },
    { key: "workOrder", header: "Work order" },
    { key: "productCode", header: "Product code" },
    { key: "product", header: "Product" },
    { key: "status", header: "Status" },
    { key: "startedAt", header: "Started" },
    { key: "completedAt", header: "Completed" },
    { key: "plannedG", header: "Planned size (g)", numeric: true },
    { key: "theoreticalG", header: "Theoretical yield (g)", numeric: true },
    { key: "actualG", header: "Actual output (g)", numeric: true },
    { key: "actualUnits", header: "Actual units", numeric: true },
    { key: "yieldPct", header: "Yield %", numeric: true },
    { key: "withinLimits", header: "Within yield limits" },
  ],
  fetch: async ({ siteIds, params, period, limit, tz }) => {
    const p = period!;
    const col = params.basis === "started" ? sql`b.started_at` : params.basis === "created" ? sql`b.created_at` : sql`b.completed_at`;
    const status = params.status !== "all" ? sql`and b.status = ${params.status}` : sql``;
    return select(sql`
      select s.code as site, b.batch_number as batch, coalesce(wo.work_order_number, '') as "workOrder", p.sku_code as "productCode", p.name as product, b.status,
             ${localTs(sql`b.started_at`, tz)} as "startedAt", ${localTs(sql`b.completed_at`, tz)} as "completedAt",
             trim_scale(b.planned_size_g)::text as "plannedG", trim_scale(coalesce(y.theoretical_base, b.theoretical_yield_g))::text as "theoreticalG",
             trim_scale(coalesce(y.actual_base, b.actual_output_g))::text as "actualG", trim_scale(coalesce(y.actual_units, b.actual_units))::text as "actualUnits",
             trim_scale(round(coalesce(y.yield_pct, b.yield_pct), 2))::text as "yieldPct",
             case when y.id is null then '' when y.is_within_limits then 'yes' else 'no' end as "withinLimits", b.id::text as "_batchId"
      from batches b
      join products p on p.id = b.product_id
      join sites s on s.id = b.site_id
      left join work_orders wo on wo.id = b.work_order_id
      left join yield_records y on y.batch_id = b.id and y.is_current
      where ${inIds(sql`b.site_id`, siteIds)} and ${col} >= ${dayStart(p.from, tz)} and ${col} < ${dayStart(p.toExclusive, tz)} ${status}
      order by ${col}, b.batch_number
      limit ${limit}`);
  },
  valueLabel: "Actual",
  timeBasis: "By the chosen batch timestamp (completed_at, started_at or created_at) in the organization's time zone.",
  sources: "batches, yield_records (current record per batch), work_orders, products",
  footnotes: [
    "Yield % = actual good output mass ÷ theoretical yield mass × 100, from the current yield record (corrections supersede earlier records); batches without a yield record show the batch's own figures.",
    "Yield limits are the configured range at recording time (setting production.yield.limits_pct), confirmed by production and QA.",
    "Overall yield is computed from summed masses, never by averaging percentages (docs/analytics-kpis.md §1.6).",
  ],
  summarize: (rows) => {
    const sum = (k: string) => rows.reduce((a, r) => (r[k] ? a.plus(String(r[k])) : a), new Decimal(0));
    const theo = sum("theoreticalG");
    const act = sum("actualG");
    return [
      ["Batches by status", countBy(rows, "status")],
      ["Overall yield (listed rows)", theo.gt(0) ? `${act.div(theo).times(100).toDecimalPlaces(2).toFixed()} % (${act.toFixed()} g of ${theo.toFixed()} g)` : "n/a"],
    ];
  },
  schedulable: true,
  defaultCadence: "weekly",
  rowLink: (r) => (r._batchId ? `/production/${r._batchId}` : null),
};

const OPEN_WO = ["draft", "planned", "released", "in_progress"];

export const workOrdersReport: ReportDefinition = {
  code: "RPT-PRD-WORK-ORDERS",
  title: "Work orders and lateness",
  category: "Production",
  description: "Work orders with plan dates, status, batches done and whether they are late (open past the planned end).",
  viewPermission: "production.work_order.view",
  exportPermission: "production.work_order.export",
  sensitivity: "N",
  params: [
    {
      name: "scope",
      kind: "select",
      label: "Show",
      options: [
        { value: "open", label: "Open work orders" },
        { value: "late", label: "Late work orders only" },
        { value: "period", label: "Planned to end in the period" },
      ],
      default: "open",
    },
    { name: "period", kind: "period", label: "Period (for “planned to end”)", default: "this_month" },
  ],
  columns: [
    { key: "site", header: "Site" },
    { key: "workOrder", header: "Work order" },
    { key: "status", header: "Status" },
    { key: "productCode", header: "Product code" },
    { key: "product", header: "Product" },
    { key: "plannedStart", header: "Planned start" },
    { key: "plannedEnd", header: "Planned end" },
    { key: "qtyPlanned", header: "Planned bulk", numeric: true, unitKey: "unit" },
    { key: "unit", header: "Unit" },
    { key: "batchCount", header: "Batches planned", numeric: true },
    { key: "batchesDone", header: "Batches completed", numeric: true },
    { key: "daysLate", header: "Days late", numeric: true },
    { key: "shortage", header: "Released with shortage" },
  ],
  fetch: async ({ siteIds, params, period, limit, today }) => {
    const openList = sql.join(OPEN_WO.map((s) => sql`${s}`), sql`, `);
    const where =
      params.scope === "late"
        ? sql`wo.status in (${openList}) and wo.planned_end < ${today}::date`
        : params.scope === "period"
          ? sql`wo.planned_end >= ${period!.from}::date and wo.planned_end < ${period!.toExclusive}::date`
          : sql`wo.status in (${openList})`;
    return select(sql`
      select s.code as site, wo.work_order_number as "workOrder", wo.status, p.sku_code as "productCode", p.name as product,
             wo.planned_start::text as "plannedStart", wo.planned_end::text as "plannedEnd", trim_scale(wo.qty_planned_base)::text as "qtyPlanned", wo.base_uom as unit,
             wo.batch_count as "batchCount", (select count(*)::int from batches b where b.work_order_id = wo.id and b.status in ('released','closed','rejected')) as "batchesDone",
             case when wo.status in (${openList}) and wo.planned_end < ${today}::date then (${today}::date - wo.planned_end) else 0 end as "daysLate",
             case when wo.released_with_shortage then 'yes' else '' end as shortage, wo.id::text as "_woId"
      from work_orders wo
      join products p on p.id = wo.product_id
      join sites s on s.id = wo.site_id
      where ${inIds(sql`wo.site_id`, siteIds)} and ${where}
      order by wo.planned_end, wo.priority, wo.work_order_number
      limit ${limit}`);
  },
  valueLabel: "Actual",
  timeBasis: "Late = still draft, planned, released or in progress after its planned end date (business date of the organization).",
  sources: "work_orders, batches, products",
  footnotes: ["Batches completed counts batches released, rejected or closed (a QA decision was taken).", "Planned bulk is in the formula's base unit (g)."],
  summarize: (rows: ReportRow[]) => [
    ["Work orders by status", countBy(rows, "status")],
    ["Late (listed rows)", String(rows.filter((r) => Number(r.daysLate) > 0).length)],
    ["Planned bulk (listed rows)", totalsByUnit(rows, "qtyPlanned", "unit")],
  ],
  schedulable: true,
  defaultCadence: "daily",
  rowLink: (r) => (r._woId ? `/production/work-orders/${r._woId}` : null),
};

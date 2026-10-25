import "server-only";
import { sql } from "drizzle-orm";
import { countBy, inIds, localTs, select } from "../sql";
import type { ReportDefinition } from "../types";

/** Wave 4 W4C: CAPA register and maintenance work orders (US-6-18, US-6-19). Rows are scoped to the viewer's sites. */

export const capaReport: ReportDefinition = {
  code: "RPT-QUA-CAPA",
  title: "CAPA register",
  category: "Quality",
  description: "CAPAs with their source, owner, open and overdue actions and the effectiveness check.",
  viewPermission: "quality.capa.view",
  exportPermission: null,
  sensitivity: "S",
  params: [
    {
      name: "scope",
      kind: "select",
      label: "Show",
      options: [
        { value: "active", label: "Open, in progress and verification" },
        { value: "all", label: "All CAPAs" },
      ],
      default: "active",
    },
  ],
  columns: [
    { key: "capa", header: "CAPA" },
    { key: "site", header: "Site" },
    { key: "status", header: "Status" },
    { key: "source", header: "Source" },
    { key: "reference", header: "Reference" },
    { key: "title", header: "Title" },
    { key: "owner", header: "Owner", personalData: true },
    { key: "dueDate", header: "Target date" },
    { key: "openActions", header: "Open actions", numeric: true },
    { key: "overdueActions", header: "Overdue actions", numeric: true },
    { key: "effectivenessDueOn", header: "Effectiveness check due" },
    { key: "effectiveness", header: "Effectiveness" },
    { key: "openedAt", header: "Opened at" },
  ],
  fetch: async ({ siteIds, params, limit, tz, today }) => {
    const scope = params.scope === "all" ? sql`` : sql`and c.status in ('open', 'in_progress', 'verification')`;
    return select(sql`
      select c.capa_number as capa, s.code as site, c.status, c.source_kind as source, coalesce(c.source_reference, '') as reference, c.title,
             u.display_name as owner, coalesce(c.due_date::text, '') as "dueDate",
             (select count(*)::int from capa_actions a where a.capa_id = c.id and a.status = 'open') as "openActions",
             (select count(*)::int from capa_actions a where a.capa_id = c.id and a.status = 'open' and a.due_date < ${today}::date) as "overdueActions",
             coalesce(c.effectiveness_due_on::text, '') as "effectivenessDueOn", coalesce(c.effectiveness_result, '') as effectiveness,
             ${localTs(sql`c.created_at`, tz)} as "openedAt", c.id::text as "_id"
      from capas c
      join sites s on s.id = c.site_id
      join users u on u.id = c.owner_id
      where ${inIds(sql`c.site_id`, siteIds)} ${scope}
      order by c.created_at, c.capa_number
      limit ${limit}`);
  },
  valueLabel: "Actual",
  timeBasis: "Current state at generation time; an action is overdue when it is still open after its due date (organization's business date).",
  sources: "capas, capa_actions",
  footnotes: ["Effectiveness-check periods are the company's QA configuration (setting quality.capa.effectiveness_check_days), not a regulatory rule."],
  summarize: (rows) => [
    ["By status", countBy(rows, "status")],
    ["By source", countBy(rows, "source")],
  ],
  schedulable: true,
  defaultCadence: "weekly",
  rowLink: (r) => (r._id ? `/quality/capa/${r._id}` : null),
};

export const maintenanceReport: ReportDefinition = {
  code: "RPT-PRO-MAINTENANCE",
  title: "Maintenance work orders",
  category: "Production",
  description: "Maintenance work orders open now or completed in the last 90 days: equipment, kind, technician, downtime and spare parts issued.",
  viewPermission: "maintenance.work_order.view",
  exportPermission: null,
  sensitivity: "S",
  params: [
    {
      name: "scope",
      kind: "select",
      label: "Show",
      options: [
        { value: "live", label: "Open, in progress, on hold" },
        { value: "recent", label: "Everything from the last 90 days" },
      ],
      default: "live",
    },
  ],
  columns: [
    { key: "workOrder", header: "Work order" },
    { key: "site", header: "Site" },
    { key: "equipment", header: "Equipment" },
    { key: "kind", header: "Kind" },
    { key: "status", header: "Status" },
    { key: "priority", header: "Priority" },
    { key: "technician", header: "Technician", personalData: true },
    { key: "dueDate", header: "Due" },
    { key: "startedAt", header: "Started" },
    { key: "completedAt", header: "Completed" },
    { key: "result", header: "Result" },
    { key: "hoursDown", header: "Hours in progress", numeric: true },
    { key: "partsIssued", header: "Part lines issued", numeric: true },
  ],
  fetch: async ({ siteIds, params, limit, tz, now }) => {
    const scope = params.scope === "recent" ? sql`and w.created_at >= ${now.toISOString()}::timestamptz - interval '90 days'` : sql`and w.status in ('open', 'in_progress', 'on_hold')`;
    return select(sql`
      select w.work_order_number as "workOrder", s.code as site, e.code as equipment, w.kind, w.status, w.priority,
             coalesce(u.display_name, '') as technician, coalesce(w.due_date::text, '') as "dueDate",
             coalesce(${localTs(sql`w.started_at`, tz)}, '') as "startedAt", coalesce(${localTs(sql`w.completed_at`, tz)}, '') as "completedAt", coalesce(w.result, '') as result,
             case when w.started_at is null then null else round((extract(epoch from (coalesce(w.completed_at, ${now.toISOString()}::timestamptz) - w.started_at)) / 3600)::numeric, 1)::text end as "hoursDown",
             (select count(*)::int from maintenance_work_order_parts p where p.work_order_id = w.id) as "partsIssued", w.id::text as "_id"
      from maintenance_work_orders w
      join sites s on s.id = w.site_id
      join equipment e on e.id = w.equipment_id
      left join users u on u.id = w.assigned_to
      where ${inIds(sql`w.site_id`, siteIds)} ${scope}
      order by w.created_at, w.work_order_number
      limit ${limit}`);
  },
  valueLabel: "Actual",
  timeBasis: "Hours in progress = completion (or generation) time minus start time; the equipment's own downtime events are in the equipment register.",
  sources: "maintenance_work_orders, maintenance_work_order_parts, equipment",
  footnotes: ["PM intervals and lead days are the company's maintenance configuration per plan."],
  summarize: (rows) => [
    ["By status", countBy(rows, "status")],
    ["By kind", countBy(rows, "kind")],
  ],
  schedulable: true,
  defaultCadence: "weekly",
  rowLink: (r) => (r._id ? `/maintenance/work-orders/${r._id}` : null),
};

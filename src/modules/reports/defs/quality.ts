import "server-only";
import { sql } from "drizzle-orm";
import { countBy, dayStart, inIds, localTs, select } from "../sql";
import type { ReportDefinition } from "../types";

/** Quality reports: dispositions, deviations, holds (docs/analytics-kpis.md §2.4, RPT-QUA-WEEKLY building blocks). */

export const dispositionsReport: ReportDefinition = {
  code: "RPT-QUA-DISPOSITIONS",
  title: "QA dispositions",
  category: "Quality",
  description: "Every QA decision on lots and batches in the period: release, reject, hold, conditional release, hold lifted, expiry.",
  viewPermission: "quality.disposition.view",
  exportPermission: null,
  sensitivity: "S",
  params: [
    { name: "period", kind: "period", label: "Period", default: "last_30_days" },
    {
      name: "decision",
      kind: "select",
      label: "Decision",
      options: [
        { value: "all", label: "All decisions" },
        ...["release", "reject", "hold", "release_from_hold", "conditional_release", "hold_lifted", "expire"].map((d) => ({ value: d, label: d.replace(/_/g, " ") })),
      ],
      default: "all",
    },
  ],
  columns: [
    { key: "decidedAt", header: "Decided at" },
    { key: "site", header: "Site" },
    { key: "subjectType", header: "Subject" },
    { key: "subject", header: "Lot / batch" },
    { key: "item", header: "Item" },
    { key: "decision", header: "Decision" },
    { key: "fromStatus", header: "From" },
    { key: "toStatus", header: "To" },
    { key: "reason", header: "Reason" },
    { key: "conditions", header: "Conditions" },
    { key: "decidedBy", header: "Decided by", personalData: true },
    { key: "requestedBy", header: "Requested by", personalData: true },
  ],
  fetch: async ({ siteIds, params, period, limit, tz }) => {
    const p = period!;
    const decision = params.decision !== "all" ? sql`and d.decision = ${params.decision}` : sql``;
    return select(sql`
      select ${localTs(sql`d.decided_at`, tz)} as "decidedAt", s.code as site, d.subject_type as "subjectType",
             coalesce(lot.lot_number, b.batch_number) as subject, coalesce(m.code, p.sku_code, bp.sku_code) as item, d.decision,
             d.from_status as "fromStatus", d.to_status as "toStatus", d.reason, coalesce(d.conditions, '') as conditions,
             u.display_name as "decidedBy", coalesce(r.display_name, '') as "requestedBy",
             case when d.subject_type = 'lot' then '/quality/lots/' || d.subject_id::text else '/quality/batches/' || d.subject_id::text end as "_href"
      from dispositions d
      join sites s on s.id = d.site_id
      join users u on u.id = d.decided_by
      left join users r on r.id = d.requested_by
      left join inventory_lots lot on d.subject_type = 'lot' and lot.id = d.subject_id
      left join materials m on m.id = lot.material_id
      left join products p on p.id = lot.product_id
      left join batches b on d.subject_type = 'batch' and b.id = d.subject_id
      left join products bp on bp.id = b.product_id
      where ${inIds(sql`d.site_id`, siteIds)} and d.decided_at >= ${dayStart(p.from, tz)} and d.decided_at < ${dayStart(p.toExclusive, tz)} ${decision}
      order by d.decided_at, d.id
      limit ${limit}`);
  },
  valueLabel: "Actual",
  timeBasis: "By decision time (dispositions.decided_at); dispositions are append-only records.",
  sources: "dispositions, inventory_lots, batches",
  footnotes: [
    "Release and reject decisions are taken by QA only, by a person other than the submitter (separation of duties); conditional releases name the requester and the second approver.",
    "Raw test results are not part of this report (quality.test_result.view).",
  ],
  summarize: (rows) => [["Decisions", countBy(rows, "decision")]],
  schedulable: true,
  defaultCadence: "weekly",
  rowLink: (r) => (r._href ? String(r._href) : null),
};

export const deviationsReport: ReportDefinition = {
  code: "RPT-QUA-DEVIATIONS",
  title: "Deviations",
  category: "Quality",
  description: "Deviations raised in the period or still open: status, severity, source, batch or lot, age and closure.",
  viewPermission: "quality.deviation.view",
  exportPermission: "quality.deviation.export",
  sensitivity: "S",
  params: [
    {
      name: "scope",
      kind: "select",
      label: "Show",
      options: [
        { value: "open", label: "Open and investigating" },
        { value: "period", label: "Raised in the period" },
        { value: "closed_period", label: "Closed in the period" },
      ],
      default: "open",
    },
    { name: "period", kind: "period", label: "Period", default: "last_30_days" },
  ],
  columns: [
    { key: "deviation", header: "Deviation" },
    { key: "site", header: "Site" },
    { key: "status", header: "Status" },
    { key: "severity", header: "Severity" },
    { key: "source", header: "Source" },
    { key: "batch", header: "Batch" },
    { key: "lot", header: "Lot" },
    { key: "raisedAt", header: "Raised at" },
    { key: "raisedBy", header: "Raised by", personalData: true },
    { key: "ageDays", header: "Age (days)", numeric: true },
    { key: "closedAt", header: "Closed at" },
    { key: "releasePermitted", header: "Release permitted" },
    { key: "description", header: "Description", requires: "quality.test_result.view" },
  ],
  fetch: async ({ siteIds, params, period, limit, tz, now }) => {
    const p = period!;
    const where =
      params.scope === "period"
        ? sql`dv.raised_at >= ${dayStart(p.from, tz)} and dv.raised_at < ${dayStart(p.toExclusive, tz)}`
        : params.scope === "closed_period"
          ? sql`dv.closed_at >= ${dayStart(p.from, tz)} and dv.closed_at < ${dayStart(p.toExclusive, tz)}`
          : sql`dv.status <> 'closed'`;
    return select(sql`
      select dv.deviation_number as deviation, s.code as site, dv.status, coalesce(dv.severity, 'unclassified') as severity, dv.source,
             coalesce(b.batch_number, '') as batch, coalesce(lot.lot_number, '') as lot, ${localTs(sql`dv.raised_at`, tz)} as "raisedAt", u.display_name as "raisedBy",
             floor(extract(epoch from (coalesce(dv.closed_at, ${now.toISOString()}::timestamptz) - dv.raised_at)) / 86400)::int as "ageDays",
             ${localTs(sql`dv.closed_at`, tz)} as "closedAt", case when dv.release_permitted is null then '' when dv.release_permitted then 'yes' else 'no' end as "releasePermitted",
             left(dv.description, 300) as description, dv.id::text as "_id"
      from deviations dv
      join sites s on s.id = dv.site_id
      join users u on u.id = dv.raised_by
      left join batches b on b.id = dv.batch_id
      left join inventory_lots lot on lot.id = dv.lot_id
      where ${inIds(sql`dv.site_id`, siteIds)} and ${where}
      order by dv.raised_at, dv.deviation_number
      limit ${limit}`);
  },
  valueLabel: "Actual",
  timeBasis: "Age = closure time (or generation time while open) minus raising time, in whole days.",
  sources: "deviations, batches, inventory_lots",
  footnotes: [
    "Severity levels are QA configuration (setting quality.deviation.severity_levels); unclassified = not yet classified.",
    "The description column needs quality.test_result.view; without it the column is omitted (docs/analytics-kpis.md §1.5).",
  ],
  summarize: (rows) => [
    ["By status", countBy(rows, "status")],
    ["By severity", countBy(rows, "severity")],
  ],
  schedulable: true,
  defaultCadence: "weekly",
  rowLink: (r) => (r._id ? `/quality/deviations/${r._id}` : null),
};

export const holdsReport: ReportDefinition = {
  code: "RPT-QUA-HOLDS",
  title: "QA holds",
  category: "Quality",
  description: "Open QA holds with their age, or holds opened or closed in the period, with scope, reason and resolution.",
  viewPermission: "quality.hold.view",
  exportPermission: null,
  sensitivity: "S",
  params: [
    {
      name: "scope",
      kind: "select",
      label: "Show",
      options: [
        { value: "open", label: "Open and investigating" },
        { value: "period", label: "Opened in the period" },
        { value: "closed_period", label: "Closed in the period" },
      ],
      default: "open",
    },
    { name: "period", kind: "period", label: "Period", default: "last_30_days" },
  ],
  columns: [
    { key: "hold", header: "Hold" },
    { key: "site", header: "Site" },
    { key: "status", header: "Status" },
    { key: "lot", header: "Lot" },
    { key: "location", header: "Location" },
    { key: "reasonCode", header: "Reason code" },
    { key: "reason", header: "Reason" },
    { key: "openedAt", header: "Opened at" },
    { key: "openedBy", header: "Opened by", personalData: true },
    { key: "ageDays", header: "Age (days)", numeric: true },
    { key: "closedAt", header: "Closed at" },
    { key: "resolution", header: "Resolution" },
  ],
  fetch: async ({ siteIds, params, period, limit, tz, now }) => {
    const p = period!;
    const where =
      params.scope === "period"
        ? sql`h.opened_at >= ${dayStart(p.from, tz)} and h.opened_at < ${dayStart(p.toExclusive, tz)}`
        : params.scope === "closed_period"
          ? sql`h.closed_at >= ${dayStart(p.from, tz)} and h.closed_at < ${dayStart(p.toExclusive, tz)}`
          : sql`h.status <> 'closed'`;
    return select(sql`
      select h.hold_number as hold, s.code as site, h.status, coalesce(lot.lot_number, '') as lot, coalesce(l.code, '') as location, h.reason_code as "reasonCode", h.reason,
             ${localTs(sql`h.opened_at`, tz)} as "openedAt", u.display_name as "openedBy",
             floor(extract(epoch from (coalesce(h.closed_at, ${now.toISOString()}::timestamptz) - h.opened_at)) / 86400)::int as "ageDays",
             ${localTs(sql`h.closed_at`, tz)} as "closedAt", coalesce(h.resolution, '') as resolution, h.id::text as "_id"
      from quality_holds h
      join sites s on s.id = h.site_id
      join users u on u.id = h.opened_by
      left join inventory_lots lot on lot.id = h.lot_id
      left join locations l on l.id = h.location_id
      where ${inIds(sql`h.site_id`, siteIds)} and ${where}
      order by h.opened_at, h.hold_number
      limit ${limit}`);
  },
  valueLabel: "Actual",
  timeBasis: "Age = closure time (or generation time while open) minus opening time, in whole days.",
  sources: "quality_holds, inventory_lots, locations",
  footnotes: ["A hold is lifted by a QA approver other than the person who opened it, with a closing disposition."],
  summarize: (rows) => [["By status", countBy(rows, "status")]],
  schedulable: true,
  defaultCadence: "weekly",
  rowLink: (r) => (r._id ? `/quality/holds/${r._id}` : null),
};

import "server-only";
import { type SQL, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { getSetting } from "@/lib/settings";
import { countBy, dayStart, inIds, likePattern, localTs, select } from "../sql";
import type { ReportDefinition, ReportQuery } from "../types";

/**
 * Audit extract and the weekly access-and-exceptions report (US-5-14, docs/security.md §2.11, §5).
 * Scope: events of the sites in scope; organization-level events (site_id null) only for
 * organization-wide viewers, exactly as on the audit log screen. Before/after payloads are never
 * printed (redaction by data class stays on the audit log screen).
 */

function scopeWhere(q: ReportQuery): SQL {
  const sites = inIds(sql`a.site_id`, q.siteIds);
  const includeOrgLevel = q.orgWide && q.siteIds.length === q.ctx.allowedSiteIds.length;
  return includeOrgLevel ? sql`(${sites} or a.site_id is null)` : sites;
}

const actorExpr = sql`coalesce(u.display_name, a.actor_label, 'system')`;

export const auditExtractReport: ReportDefinition = {
  code: "RPT-AUD-EXTRACT",
  title: "Audit extract",
  category: "Audit and access",
  description: "Audit events in the period for one module or all: who did what, to which record, where and why. Payloads stay on the audit log screen.",
  viewPermission: "platform.audit.view",
  exportPermission: "platform.audit.export",
  sensitivity: "S",
  params: [
    { name: "period", kind: "period", label: "Period", default: "last_7_days" },
    {
      name: "module",
      kind: "select",
      label: "Module",
      options: [
        { value: "all", label: "All modules" },
        ...["identity", "platform", "masterdata", "inventory", "procurement", "production", "quality", "sales", "documents", "analytics"].map((m) => ({ value: m, label: m })),
      ],
      default: "all",
    },
    { name: "q", kind: "text", label: "Record number contains", maxLength: 80 },
  ],
  columns: [
    { key: "occurredAt", header: "When" },
    { key: "site", header: "Site" },
    { key: "action", header: "Action" },
    { key: "entityType", header: "Record type" },
    { key: "record", header: "Record" },
    { key: "actor", header: "Actor", personalData: true },
    { key: "reason", header: "Reason" },
    { key: "correlation", header: "Correlation id" },
  ],
  fetch: async (q) => {
    const p = q.period!;
    const mod = q.params.module !== "all" ? sql`and a.action like ${String(q.params.module) + ".%"}` : sql``;
    const num = q.params.q ? sql`and a.entity_number ilike ${likePattern(String(q.params.q))}` : sql``;
    return select(sql`
      select ${localTs(sql`a.occurred_at`, q.tz)} as "occurredAt", coalesce(s.code, 'Organization') as site, a.action, a.entity_type as "entityType",
             coalesce(a.entity_number, left(a.entity_id::text, 8), '') as record, ${actorExpr} as actor, coalesce(a.reason, '') as reason, coalesce(a.correlation_id, '') as correlation
      from audit_events a
      left join sites s on s.id = a.site_id
      left join users u on u.id = a.actor_id
      where a.organization_id = ${q.ctx.organizationId}::uuid and ${scopeWhere(q)}
        and a.occurred_at >= ${dayStart(p.from, q.tz)} and a.occurred_at < ${dayStart(p.toExclusive, q.tz)} ${mod} ${num}
      order by a.occurred_at, a.id
      limit ${q.limit}`);
  },
  valueLabel: "Actual",
  timeBasis: "By event time (audit_events.occurred_at, server time) shown in the organization's time zone.",
  sources: "audit_events (append-only), users, sites",
  footnotes: ["Organization-level events (sign-ins, settings, role changes) are included only for organization-wide viewers and only when all sites are selected.", "Before/after payloads are omitted; open the audit log for a record's details (redacted by data class)."],
  summarize: (rows) => [["Events", String(rows.length)]],
  schedulable: true,
  defaultCadence: "weekly",
};

const GRANT_ACTIONS = [
  "identity.site_assignment.granted",
  "identity.site_assignment.revoked",
  "identity.site_assignment.scope_changed",
  "identity.role.created",
  "identity.role.updated",
  "identity.user.created",
  "identity.user.deactivated",
  "identity.user.reactivated",
  "identity.invitation.sent",
];
const REPRINT_ACTIONS = ["documents.generated_document.reprinted", "documents.label_job.reprinted"];

const list = (xs: string[]) => sql.join(xs.length ? xs.map((x) => sql`${x}`) : [sql`'__none__'`], sql`, `);

/**
 * Weekly access-and-exceptions report for the owner (US-5-14): role grants, restricted-permission use,
 * controlled exceptions, reprints by kind and sensitive exports. Which audit events count as
 * "restricted" and "controlled exception" is configuration (reports.access_report.*_actions, A-W3B-06).
 */
export const accessReport: ReportDefinition = {
  code: "RPT-SEC-ACCESS",
  title: "Access and exceptions (weekly)",
  category: "Audit and access",
  description: "For the owner: role grants and changes, use of restricted permissions, controlled exceptions, reprints by kind and sensitive exports in the week.",
  viewPermission: "platform.audit.view",
  exportPermission: "platform.audit.export",
  orgWideOnly: true,
  sensitivity: "S",
  params: [{ name: "period", kind: "period", label: "Period", default: "previous_week" }],
  columns: [
    { key: "section", header: "Section" },
    { key: "occurredAt", header: "When" },
    { key: "site", header: "Site" },
    { key: "action", header: "Action" },
    { key: "record", header: "Record" },
    { key: "actor", header: "Actor", personalData: true },
    { key: "detail", header: "Detail" },
  ],
  fetch: async (q) => {
    const p = q.period!;
    const restricted = await getSetting(db, q.ctx.organizationId, "reports.access_report.restricted_actions");
    const exceptions = await getSetting(db, q.ctx.organizationId, "reports.access_report.exception_actions");
    return select(sql`
      select section, "occurredAt", site, action, record, actor, detail, "_kind" from (
        select case
                 when a.action in (${list(GRANT_ACTIONS)}) then '1 Role grants and access changes'
                 when a.action in (${list(restricted)}) then '2 Restricted-permission use'
                 when a.action in (${list(exceptions)}) then '3 Controlled exceptions'
                 when a.action in (${list(REPRINT_ACTIONS)}) then '4 Reprints'
                 else '5 Sensitive exports' end as section,
               ${localTs(sql`a.occurred_at`, q.tz)} as "occurredAt", a.occurred_at as at, coalesce(s.code, 'Organization') as site, a.action,
               coalesce(a.entity_number, left(a.entity_id::text, 8), '') as record, ${actorExpr} as actor,
               case
                 when a.action in (${list(REPRINT_ACTIONS)}) then 'kind ' || coalesce(a.after->>'kind', 'label') || coalesce(': ' || a.reason, '')
                 when a.action = 'platform.export.created' then coalesce(a.after->>'code', a.entity_number, '') || ' · ' || coalesce(a.after->>'format', '') || ' · ' || coalesce(a.after->>'rowCount', '?') || ' rows'
                 else coalesce(a.reason, '') end as detail,
               case when a.action in (${list(REPRINT_ACTIONS)}) then coalesce(a.after->>'kind', 'label') end as "_kind"
        from audit_events a
        left join sites s on s.id = a.site_id
        left join users u on u.id = a.actor_id
        where a.organization_id = ${q.ctx.organizationId}::uuid and ${scopeWhere(q)}
          and a.occurred_at >= ${dayStart(p.from, q.tz)} and a.occurred_at < ${dayStart(p.toExclusive, q.tz)}
          and a.action in (${list([...GRANT_ACTIONS, ...restricted, ...exceptions, ...REPRINT_ACTIONS, "platform.export.created"])})
      ) x
      order by section, at
      limit ${q.limit}`);
  },
  valueLabel: "Actual",
  timeBasis: "By event time in the organization's time zone; the default period is the previous Monday-to-Sunday week.",
  sources: "audit_events (append-only); lists of restricted and exception actions from settings reports.access_report.*",
  footnotes: [
    "Which events count as restricted-permission use and as controlled exceptions is configuration reviewed by the owner (A-W3B-06), not a fixed rule.",
    "Sensitive exports are every audited export (platform.export.created); restricted (R) exports also require re-authentication.",
    "Delivered every Monday to the roles in reports.access_report.recipient_role_codes (default owner_director) in-app and by email link (A-PRD-25).",
  ],
  summarize: (rows) => [
    ["Rows by section", countBy(rows, "section")],
    ["Reprints by kind", countBy(rows.filter((r) => r._kind), "_kind")],
  ],
  schedulable: false,
};

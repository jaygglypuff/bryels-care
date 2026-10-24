import { sql } from "drizzle-orm";
import { boolean, check, customType, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";
import { backgroundJobs } from "./platform";

/**
 * Wave 3 W3B: report registry overrides, scheduled reports with recipient re-check, report runs and
 * their files, notification rules and the action centre (US-5-04..07, US-5-14; docs/data-model.md §3.10,
 * docs/analytics-kpis.md §5, docs/reports-and-templates.md §9 "Configurable reports").
 *
 * Report definitions themselves (query, parameters, columns, footnotes) are code (src/modules/reports/defs),
 * the same way document renderers are (A-RPT-01). The organization only switches a report on or off and adds
 * an owner note through `report_definitions` (analytics.report.admin).
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));

/** Per-organization switch and owner note for a code-defined report (analytics.report.admin). */
export const reportDefinitions = pgTable(
  "report_definitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    reportCode: text("report_code").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    /** Printed as an extra footnote on every output, e.g. "Definition reviewed by the plant manager on 2026-11-02". */
    ownerNote: text("owner_note"),
    version: integer("version").notNull().default(1),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("report_definitions_org_code_uq").on(t.organizationId, t.reportCode), check("ck_report_definitions_version", sql`${t.version} >= 1`)],
);

export const SCHEDULE_CADENCES = ["daily", "weekly", "monthly"] as const;
export const SCHEDULE_FORMATS = ["csv", "xlsx", "html"] as const;

/**
 * A report delivered on a cadence to system users (docs/data-model.md §3.10 `scheduled_reports`). The
 * cadence is stored as daily / weekly (weekday) / monthly (day 1–28) at a local time instead of a free cron
 * expression, so a schedule can be validated and explained in plain words (A-W3B-04). `site_id` null = the
 * recipient's whole scope. `format` html = printable HTML (browser "Save as PDF", ADR-026).
 */
export const scheduledReports = pgTable(
  "scheduled_reports",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    name: text("name").notNull(),
    reportCode: text("report_code").notNull(),
    /** Notified when a recipient is skipped (matrix §6 rule 3). */
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
    cadence: text("cadence").notNull(),
    /** Local time HH:MM in `timezone`. */
    runAtTime: text("run_at_time").notNull(),
    /** ISO weekday 1 = Monday … 7 = Sunday (weekly only). */
    weekday: integer("weekday"),
    /** Day of month 1–28 (monthly only). */
    monthDay: integer("month_day"),
    timezone: text("timezone").notNull().default("Asia/Manila"),
    format: text("format").notNull(),
    /** Report filters as entered (validated against the report's parameter schema at save and at run). */
    parameters: jsonb("parameters").notNull().default(sql`'{}'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("scheduled_reports_due_idx").on(t.isActive, t.nextRunAt),
    index("scheduled_reports_owner_idx").on(t.ownerUserId),
    check("ck_scheduled_reports_cadence", sql`${t.cadence} in (${inList(SCHEDULE_CADENCES)})`),
    check("ck_scheduled_reports_format", sql`${t.format} in (${inList(SCHEDULE_FORMATS)})`),
    check("ck_scheduled_reports_time", sql`${t.runAtTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check("ck_scheduled_reports_weekday", sql`(${t.cadence} = 'weekly') = (${t.weekday} is not null) and (${t.weekday} is null or ${t.weekday} between 1 and 7)`),
    check("ck_scheduled_reports_month_day", sql`(${t.cadence} = 'monthly') = (${t.monthDay} is not null) and (${t.monthDay} is null or ${t.monthDay} between 1 and 28)`),
  ],
);

/** Recipients must be system users; they must hold the report's permissions at send time (re-checked per run). */
export const scheduledReportRecipients = pgTable(
  "scheduled_report_recipients",
  {
    id: id(),
    scheduledReportId: uuid("scheduled_report_id").notNull().references(() => scheduledReports.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("scheduled_report_recipients_uq").on(t.scheduledReportId, t.userId)],
);

export const REPORT_RUN_STATUSES = ["running", "succeeded", "partial", "skipped", "failed"] as const;
export const REPORT_RUN_TRIGGERS = ["schedule", "access_report"] as const;

/**
 * One delivery of a scheduled report or of the weekly access report (docs/analytics-kpis.md §5.2 rule 3).
 * `run_key` makes a delivery happen once per schedule and period (`schedule:<id>:<period>`, `access:<iso week>`).
 * status: succeeded (every recipient got a file), partial (some skipped), skipped (nobody eligible), failed.
 */
export const reportRuns = pgTable(
  "report_runs",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    scheduledReportId: uuid("scheduled_report_id").references(() => scheduledReports.id),
    reportCode: text("report_code").notNull(),
    trigger: text("trigger").notNull(),
    runKey: text("run_key").notNull(),
    periodKey: text("period_key").notNull(),
    status: text("status").notNull().default("running"),
    recipientsSent: integer("recipients_sent").notNull().default(0),
    recipientsSkipped: integer("recipients_skipped").notNull().default(0),
    /** [{ userId, name, reason }] — who was skipped and why (permission lost, inactive, no site left). */
    skipped: jsonb("skipped").notNull().default(sql`'[]'::jsonb`),
    filesCount: integer("files_count").notNull().default(0),
    emailsSent: integer("emails_sent").notNull().default(0),
    emailStatus: text("email_status"),
    backgroundJobId: uuid("background_job_id").references(() => backgroundJobs.id),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("report_runs_org_key_uq").on(t.organizationId, t.runKey),
    index("report_runs_schedule_idx").on(t.scheduledReportId, t.createdAt),
    check("ck_report_runs_status", sql`${t.status} in (${inList(REPORT_RUN_STATUSES)})`),
    check("ck_report_runs_trigger", sql`${t.trigger} in (${inList(REPORT_RUN_TRIGGERS)})`),
    check("ck_report_runs_counts", sql`${t.recipientsSent} >= 0 and ${t.recipientsSkipped} >= 0 and ${t.filesCount} >= 0`),
  ],
);

/**
 * One file per distinct (permission set, site scope) group of a run (docs/analytics-kpis.md §5.2 rule 2):
 * two recipients never share a file one of them could not open on screen. The bytes are kept in the
 * database until `reports.file_retention_days` (A-SEC-30, A-W3B-05), then `content` is cleared and
 * `purged_at` set; the row (hash, counts, recipients) stays as the delivery record.
 */
export const reportRunFiles = pgTable(
  "report_run_files",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    reportRunId: uuid("report_run_id").notNull().references(() => reportRuns.id),
    format: text("format").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    content: bytea("content"),
    sha256: text("sha256").notNull(),
    rowCount: integer("row_count").notNull(),
    truncated: boolean("truncated").notNull().default(false),
    siteIds: jsonb("site_ids").notNull(),
    recipientUserIds: jsonb("recipient_user_ids").notNull(),
    /** Hash of the permission strings that decide the content (the grouping key). */
    permissionFingerprint: text("permission_fingerprint").notNull(),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("report_run_files_run_idx").on(t.reportRunId),
    check("ck_report_run_files_format", sql`${t.format} in (${inList(SCHEDULE_FORMATS)})`),
    check("ck_report_run_files_purged", sql`${t.purgedAt} is null or ${t.content} is null`),
  ],
);

export const NOTIFICATION_SEVERITIES = ["info", "warning", "critical"] as const;

/**
 * Who hears about an action-centre item kind, how severe it is and when it escalates (US-5-07,
 * FR-platform-08; platform.notification_rule.admin). Defaults are seeded data (A-W3B-08), never code.
 * `site_id` null = every site; a site rule wins over the organization rule for that site.
 */
export const notificationRules = pgTable(
  "notification_rules",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    itemKind: text("item_kind").notNull(),
    name: text("name").notNull(),
    severity: text("severity").notNull(),
    /** Role codes notified in-app when an item of this kind opens. */
    ownerRoleCodes: jsonb("owner_role_codes").notNull().default(sql`'[]'::jsonb`),
    /** Hours an item may stay unacknowledged before it escalates; null = never. */
    escalateAfterHours: integer("escalate_after_hours"),
    escalationRoleCodes: jsonb("escalation_role_codes").notNull().default(sql`'[]'::jsonb`),
    /** Also send email (through the adapter) when the item opens / escalates. */
    emailOnOpen: boolean("email_on_open").notNull().default(false),
    emailOnEscalation: boolean("email_on_escalation").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("notification_rules_scope_kind_uq").on(t.organizationId, t.siteId, t.itemKind).nullsNotDistinct(),
    check("ck_notification_rules_severity", sql`${t.severity} in (${inList(NOTIFICATION_SEVERITIES)})`),
    check(
      "ck_notification_rules_escalation",
      sql`(${t.escalateAfterHours} is null) = (jsonb_array_length(${t.escalationRoleCodes}) = 0) and (${t.escalateAfterHours} is null or ${t.escalateAfterHours} between 1 and 720)`,
    ),
  ],
);

export const ACTION_ITEM_TABS = ["approvals", "exceptions"] as const;

/**
 * Action centre queue (US-5-06, FR-platform-07; docs/ux-system.md 5.5). Rows are derived from the
 * underlying records by `refreshActionItems` (on open and every 5 minutes): a new condition opens an
 * item, and `resolved_at` is set the moment the record no longer meets it ("items clear when the
 * underlying record resolves"). One open item per (kind, entity). Acknowledgement and escalation are
 * recorded here and audited (`platform.action_item.*`).
 */
export const actionItems = pgTable(
  "action_items",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    tab: text("tab").notNull(),
    kind: text("kind").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    recordNumber: text("record_number"),
    title: text("title").notNull(),
    detail: text("detail"),
    severity: text("severity").notNull(),
    /** Permission needed (at the item's site) to see and acknowledge the item. */
    viewPermission: text("view_permission").notNull(),
    link: text("link").notNull(),
    actionLabel: text("action_label").notNull(),
    /** When the underlying condition started (record time), for the age column. */
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: uuid("acknowledged_by").references(() => users.id),
    acknowledgementNote: text("acknowledgement_note"),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    escalationLevel: integer("escalation_level").notNull().default(0),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("action_items_open_uq").on(t.organizationId, t.kind, t.entityId).where(sql`${t.resolvedAt} is null`),
    index("action_items_open_idx").on(t.organizationId, t.resolvedAt, t.siteId),
    index("action_items_entity_idx").on(t.entityType, t.entityId),
    check("ck_action_items_tab", sql`${t.tab} in (${inList(ACTION_ITEM_TABS)})`),
    check("ck_action_items_severity", sql`${t.severity} in (${inList(NOTIFICATION_SEVERITIES)})`),
    check("ck_action_items_ack", sql`(${t.acknowledgedAt} is null) = (${t.acknowledgedBy} is null)`),
  ],
);

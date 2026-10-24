import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";
import { backgroundJobs } from "./platform";

/**
 * KPI engine (Wave 3 W3A, backlog E-5-01: US-5-01; docs/analytics-kpis.md §1.1, §1.4, §4).
 *
 * The catalogue itself is typed data in src/modules/analytics/kpi/catalogue.ts; `kpi_definitions`
 * mirrors it as versioned rows (a changed definition gets a new version_no, old snapshots keep the
 * version they were computed with, A-KPI-17). Snapshots and reconciliation results are append-only
 * (src/db/sql/w3a.sql). Tables live in the `public` schema (A-W3A-01): the test and reset scripts
 * drop and recreate `public` only, and nothing else reads them.
 */

const NUM = { precision: 30, scale: 10 } as const;

export const KPI_VALUE_LABELS = ["actual", "estimate", "forecast", "overridden"] as const;
export const KPI_REFRESH_CLASSES = ["post", "live", "mv15", "night", "wk"] as const;
export const KPI_GRAINS = ["day", "week", "month"] as const;
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

/** One row per version of a KPI definition (the explainability contract of §1.1). */
export const kpiDefinitions = pgTable(
  "kpi_definitions",
  {
    id: id(),
    /** Catalogue id, e.g. KPI-OPS-02. */
    kpiCode: text("kpi_code").notNull(),
    versionNo: integer("version_no").notNull(),
    name: text("name").notNull(),
    definition: text("definition").notNull(),
    formulaText: text("formula_text").notNull(),
    timeBasis: text("time_basis").notNull(),
    /** Tables and columns the R-query reads. */
    sources: jsonb("sources").notNull(),
    refreshClass: text("refresh_class").notNull(),
    valueLabel: text("value_label").notNull(),
    /** count | qty_g | qty_pcs | money | ratio | hours | days | minutes */
    unit: text("unit").notNull(),
    /** sum | ratio | median | p90 | max */
    aggregate: text("aggregate").notNull(),
    drillRoute: text("drill_route").notNull(),
    /** Permissions needed to see the value (docs/analytics-kpis.md §1.5). */
    permissions: jsonb("permissions").notNull(),
    /** SHA-256 of the definition content; a different checksum is a new version. */
    checksum: text("checksum").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("kpi_definitions_code_version_uq").on(t.kpiCode, t.versionNo),
    uniqueIndex("kpi_definitions_code_checksum_uq").on(t.kpiCode, t.checksum),
    check("ck_kpi_definitions_label", sql`${t.valueLabel} in (${inList(KPI_VALUE_LABELS)})`),
    check("ck_kpi_definitions_refresh", sql`${t.refreshClass} in (${inList(KPI_REFRESH_CLASSES)})`),
    check("ck_kpi_definitions_version", sql`${t.versionNo} >= 1`),
  ],
);

/**
 * One run of analytics.snapshot_kpis or analytics.reconcile_kpis (the refresh log of §1.3): "Updated
 * HH:MM" on snapshot-based visuals and the Stale badge (failed run or older than twice the cadence).
 * status: running → succeeded | failed.
 */
export const kpiRefreshLog = pgTable(
  "kpi_refresh_log",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    /** snapshot | reconcile */
    runKind: text("run_kind").notNull(),
    status: text("status").notNull().default("running"),
    /** Business date the run covers (yesterday at 01:30). */
    businessDate: date("business_date").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    backgroundJobId: uuid("background_job_id").references(() => backgroundJobs.id),
    snapshotsWritten: integer("snapshots_written").notNull().default(0),
    checked: integer("checked").notNull().default(0),
    mismatches: integer("mismatches").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("kpi_refresh_log_org_kind_idx").on(t.organizationId, t.runKind, t.startedAt),
    check("ck_kpi_refresh_log_kind", sql`${t.runKind} in ('snapshot','reconcile')`),
    check("ck_kpi_refresh_log_status", sql`${t.status} in ('running','succeeded','failed')`),
  ],
);

/**
 * Append-only KPI values per scope (one site, or the all-sites aggregate), grain and period.
 * value is null when the ratio is n/a (denominator 0). Idempotency key of the job:
 * (kpi, scope, grain, period_start, as_of_date, params_hash), enforced by the unique index.
 */
export const kpiSnapshots = pgTable(
  "kpi_snapshots",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    kpiCode: text("kpi_code").notNull(),
    kpiDefinitionId: uuid("kpi_definition_id").notNull().references(() => kpiDefinitions.id),
    /** `site:<uuid>` or `all`. */
    scopeKey: text("scope_key").notNull(),
    /** Null for the all-sites aggregate. */
    siteId: uuid("site_id").references(() => sites.id),
    /** The sites the value covers (all active sites for `all`). */
    siteIds: jsonb("site_ids").notNull(),
    grain: text("grain").notNull(),
    periodStart: date("period_start").notNull(),
    /** Exclusive. */
    periodEnd: date("period_end").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    asOfDate: date("as_of_date").notNull(),
    value: numeric("value", NUM),
    numerator: numeric("numerator", NUM).notNull(),
    denominator: numeric("denominator", NUM),
    rowCount: integer("row_count").notNull(),
    valueLabel: text("value_label").notNull(),
    params: jsonb("params").notNull(),
    paramsHash: text("params_hash").notNull(),
    refreshLogId: uuid("refresh_log_id").references(() => kpiRefreshLog.id),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("kpi_snapshots_idem_uq").on(t.organizationId, t.kpiCode, t.scopeKey, t.grain, t.periodStart, t.asOfDate, t.paramsHash),
    index("kpi_snapshots_series_idx").on(t.organizationId, t.kpiCode, t.scopeKey, t.grain, t.periodStart),
    check("ck_kpi_snapshots_grain", sql`${t.grain} in (${inList(KPI_GRAINS)})`),
    check("ck_kpi_snapshots_label", sql`${t.valueLabel} in (${inList(KPI_VALUE_LABELS)})`),
    check("ck_kpi_snapshots_period", sql`${t.periodEnd} > ${t.periodStart}`),
    check("ck_kpi_snapshots_scope", sql`(${t.scopeKey} = 'all') = (${t.siteId} is null)`),
  ],
);

/**
 * analytics.reconcile_kpis output (§1.4): the R-query recomputation of a snapshot. status match |
 * mismatch; tolerance 0 for counts, quantities and ratios, 0.01 for money (A-KPI-20). Append-only.
 */
export const kpiReconciliationResults = pgTable(
  "kpi_reconciliation_results",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    refreshLogId: uuid("refresh_log_id").notNull().references(() => kpiRefreshLog.id),
    kpiSnapshotId: uuid("kpi_snapshot_id").notNull().references(() => kpiSnapshots.id),
    kpiCode: text("kpi_code").notNull(),
    scopeKey: text("scope_key").notNull(),
    grain: text("grain").notNull(),
    periodStart: date("period_start").notNull(),
    status: text("status").notNull(),
    snapshotValue: numeric("snapshot_value", NUM),
    recomputedValue: numeric("recomputed_value", NUM),
    snapshotNumerator: numeric("snapshot_numerator", NUM).notNull(),
    recomputedNumerator: numeric("recomputed_numerator", NUM),
    snapshotDenominator: numeric("snapshot_denominator", NUM),
    recomputedDenominator: numeric("recomputed_denominator", NUM),
    snapshotRowCount: integer("snapshot_row_count").notNull(),
    recomputedRowCount: integer("recomputed_row_count"),
    tolerance: numeric("tolerance", NUM).notNull(),
    /** What differs, in words (shown in the critical notification). */
    detail: text("detail"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("kpi_reconciliation_results_run_idx").on(t.refreshLogId),
    uniqueIndex("kpi_reconciliation_results_run_snapshot_uq").on(t.refreshLogId, t.kpiSnapshotId),
    check("ck_kpi_reconciliation_results_status", sql`${t.status} in ('match','mismatch')`),
  ],
);

/** Trends page "Save view" (US-5-16): a user's own KPI selection; private to the user. */
export const kpiSavedViews = pgTable(
  "kpi_saved_views",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    /** { kpis, period, grain, comparison, scope } validated by the service. */
    config: jsonb("config").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("kpi_saved_views_user_name_uq").on(t.userId, t.name), check("ck_kpi_saved_views_name", sql`length(btrim(${t.name})) between 1 and 80`)],
);

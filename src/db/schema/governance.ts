import { sql } from "drizzle-orm";
import { bigint, boolean, char, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";

/**
 * Wave 2 W2F: platform governance and operations (US-1-14, US-1-19, US-1-25, US-1-26).
 * docs/data-model.md §3.1 (approval_rules, setting_change_requests, rate_limit_buckets),
 * §9.1 (numbering rule versions) and §3.10 (backup_runs, metrics_samples).
 */

/** One value per approvable record type (docs/data-model.md §3.1; W2F adds the W1D master-data types). */
export const APPROVAL_DOCUMENT_TYPES = [
  "purchase_request",
  "purchase_order",
  "sales_order",
  "quote",
  "stock_adjustment",
  "stock_count_variance",
  "expense_claim",
  "invoice",
  "supplier_bill",
  "credit_note",
  "payment_record",
  "dispense_exception",
  "over_shipment",
  "formula_revision",
  "routing_revision",
  "routing_revision_sequencing",
  "work_instruction_revision",
  "inspection_plan",
  "disposition_conditional_release",
  "recall_case",
  "batch_reopen",
  "work_order_release",
  "leave_request",
  "overtime_request",
  "payroll_period",
  "period_lock_unlock",
  "setting_change_request",
  "retention_action",
  "supplier_return",
  "equipment_override",
  "payroll_period_reopen",
  "price_list", // Wave 3 W3D (US-4-03)
] as const;

export const APPROVAL_THRESHOLD_BASES = ["always", "amount", "qty_base", "variance_pct", "discount_pct", "credit_check_failed"] as const;

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

/**
 * Approval thresholds as data (ADR-005, docs/permissions-matrix.md §5.2). Evaluated by
 * `evaluateApprovalRules` in src/modules/governance: site-specific rules beat organization-wide
 * ones, matching rows are ordered by `step`, each step needs `required_count` distinct users holding
 * one of `required_role_codes` (any role when empty) and `required_permission_code` (the record
 * type's base `.approve` permission when null). Threshold match: `min_value` exclusive, `max_value`
 * inclusive, null = unbounded. Soft-deleted rows (`deleted_at`) are kept for history.
 *
 * Deviation from the data model (recorded in docs/data-model.md): roles are a jsonb list of role
 * codes instead of one `required_role_id`, because the §5.2 defaults name alternatives
 * ("site_manager or owner_director") within one step.
 */
export const approvalRules = pgTable(
  "approval_rules",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    /** Null = organization-wide. */
    siteId: uuid("site_id").references(() => sites.id),
    documentType: text("document_type").notNull(),
    label: text("label").notNull(),
    thresholdBasis: text("threshold_basis").notNull().default("always"),
    minValue: numeric("min_value", { precision: 18, scale: 6 }),
    maxValue: numeric("max_value", { precision: 18, scale: 6 }),
    currency: char("currency", { length: 3 }),
    step: integer("step").notNull().default(1),
    requiredCount: integer("required_count").notNull().default(1),
    requiredRoleCodes: jsonb("required_role_codes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    requiredPermissionCode: text("required_permission_code"),
    posterMayEqualApprover: boolean("poster_may_equal_approver").notNull().default(false),
    escalationRoleCodes: jsonb("escalation_role_codes").$type<string[]>(),
    escalationAfterHours: integer("escalation_after_hours"),
    effectiveFrom: date("effective_from").notNull().default(sql`current_date`),
    effectiveTo: date("effective_to"),
    /** Assumption id or policy reference the rule encodes (e.g. A-PM-15). */
    source: text("source"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** Optimistic concurrency for the admin editor. */
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("approval_rules_lookup_idx").on(t.organizationId, t.documentType, t.siteId),
    check("ck_approval_rules_document_type", sql`${t.documentType} in (${inList(APPROVAL_DOCUMENT_TYPES)})`),
    check("ck_approval_rules_basis", sql`${t.thresholdBasis} in (${inList(APPROVAL_THRESHOLD_BASES)})`),
    check("ck_approval_rules_bounds", sql`${t.minValue} is null or ${t.maxValue} is null or ${t.minValue} <= ${t.maxValue}`),
    check("ck_approval_rules_always_unbounded", sql`${t.thresholdBasis} <> 'always' or (${t.minValue} is null and ${t.maxValue} is null)`),
    check("ck_approval_rules_step", sql`${t.step} >= 1 and ${t.requiredCount} >= 1`),
    check("ck_approval_rules_who", sql`jsonb_typeof(${t.requiredRoleCodes}) = 'array' and (jsonb_array_length(${t.requiredRoleCodes}) > 0 or ${t.requiredPermissionCode} is not null)`),
    check("ck_approval_rules_escalation", sql`(${t.escalationRoleCodes} is null) = (${t.escalationAfterHours} is null)`),
    check("ck_approval_rules_escalation_hours", sql`${t.escalationAfterHours} is null or ${t.escalationAfterHours} >= 1`),
    check("ck_approval_rules_dates", sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`),
  ],
);

/**
 * Every change to a registered setting (docs/data-model.md §3.1 `setting_change_requests`).
 * Keys whose registry entry has `requiresApproval` are proposed here (`submitted`) and written to
 * `settings` only when a different holder of `platform.settings.approve` approves (`applied` in
 * the same transaction). Other keys are written directly and recorded here as `applied` with no
 * approver, so this table is the version history of every setting ("settings are versioned").
 */
export const settingChangeRequests = pgTable(
  "setting_change_requests",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    scope: text("scope").notNull(),
    siteId: uuid("site_id").references(() => sites.id),
    userId: uuid("user_id").references(() => users.id),
    key: text("key").notNull(),
    /** Stored value at submission (null = the registry default applied). */
    oldValue: jsonb("old_value"),
    /** Proposed value; null = remove the stored row (back to the default / organization value). */
    newValue: jsonb("new_value"),
    reason: text("reason").notNull(),
    requiresApproval: boolean("requires_approval").notNull(),
    status: text("status").notNull(),
    submittedBy: uuid("submitted_by").notNull().references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    rejectedBy: uuid("rejected_by").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("setting_change_requests_status_idx").on(t.organizationId, t.status, t.submittedAt),
    index("setting_change_requests_key_idx").on(t.organizationId, t.key, t.createdAt),
    check("ck_setting_change_requests_status", sql`${t.status} in ('submitted','approved','rejected','applied','cancelled')`),
    check("ck_setting_change_requests_scope", sql`${t.scope} in ('organization','site','user')`),
    check(
      "ck_setting_change_requests_scope_target",
      sql`(${t.scope} = 'organization' and ${t.siteId} is null and ${t.userId} is null)
       or (${t.scope} = 'site' and ${t.siteId} is not null and ${t.userId} is null)
       or (${t.scope} = 'user' and ${t.userId} is not null)`,
    ),
    // Separation of duties (S1-03): the approver and the rejecter are never the submitter.
    check("ck_setting_change_requests_sod", sql`${t.approvedBy} is null or ${t.approvedBy} <> ${t.submittedBy}`),
    check("ck_setting_change_requests_sod_reject", sql`${t.rejectedBy} is null or ${t.rejectedBy} <> ${t.submittedBy}`),
    check("ck_setting_change_requests_applied_approved", sql`not (${t.requiresApproval} and ${t.status} = 'applied' and ${t.approvedBy} is null)`),
    check("ck_setting_change_requests_applied_at", sql`(${t.status} = 'applied') = (${t.appliedAt} is not null)`),
  ],
);

/**
 * Versioned numbering patterns per document type (docs/data-model.md §9.1 `ver` set). The
 * counters themselves stay in `numbering_rules` (one row per document type and period key,
 * locked last by `nextNumber`); a version only changes how the next numbers look, never the
 * numbers already issued. A version is submitted by one holder of
 * `platform.numbering_rule.admin` and approved by a different one (A-DM-25). No approved version
 * = the built-in default in src/lib/numbering.ts.
 */
export const numberingRuleVersions = pgTable(
  "numbering_rule_versions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    documentType: text("document_type").notNull(),
    scope: text("scope").notNull().default("organization"),
    siteId: uuid("site_id").references(() => sites.id),
    versionNo: integer("version_no").notNull(),
    status: text("status").notNull().default("submitted"),
    prefix: text("prefix").notNull(),
    pattern: text("pattern").notNull(),
    resetPeriod: text("reset_period").notNull(),
    sequenceWidth: integer("sequence_width").notNull().default(5),
    isGapless: boolean("is_gapless").notNull().default(false),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    supersedesId: uuid("supersedes_id"),
    changeSummary: text("change_summary").notNull(),
    submittedBy: uuid("submitted_by").notNull().references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedBy: uuid("rejected_by").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("numbering_rule_versions_no_uq").on(t.organizationId, t.documentType, t.siteId, t.versionNo).nullsNotDistinct(),
    // One open-ended approved organization-scope version per type; the service closes the previous
    // one (effective_to) in the approval transaction, so approved ranges never overlap.
    uniqueIndex("numbering_rule_versions_open_uq")
      .on(t.organizationId, t.documentType)
      .where(sql`${t.status} = 'approved' and ${t.effectiveTo} is null and ${t.siteId} is null`),
    index("numbering_rule_versions_lookup_idx").on(t.organizationId, t.documentType, t.status),
    check("ck_numbering_rule_versions_status", sql`${t.status} in ('submitted','approved','rejected','cancelled')`),
    check("ck_numbering_rule_versions_scope", sql`(${t.scope} = 'organization' and ${t.siteId} is null) or (${t.scope} = 'site' and ${t.siteId} is not null)`),
    check("ck_numbering_rule_versions_reset", sql`${t.resetPeriod} in ('never','yearly','monthly','daily')`),
    check("ck_numbering_rule_versions_width", sql`${t.sequenceWidth} between 1 and 12`),
    check("ck_numbering_rule_versions_prefix", sql`${t.prefix} ~ '^[A-Z0-9]{1,8}$'`),
    // §9.4 pattern rules (the "pattern trigger" expressed as CHECKs): allowed characters and tokens,
    // exactly one {SEQ}, {SITE} for site scope, the date token the reset period needs.
    check("ck_numbering_rule_versions_pattern_chars", sql`${t.pattern} ~ '^([A-Z0-9._-]|\\{(PREFIX|SITE|YYYY|YY|YYMM|YYMMDD|SEQ)\\})+$'`),
    check("ck_numbering_rule_versions_pattern_seq", sql`(length(${t.pattern}) - length(replace(${t.pattern}, '{SEQ}', ''))) = 5`),
    check("ck_numbering_rule_versions_pattern_site", sql`${t.scope} <> 'site' or position('{SITE}' in ${t.pattern}) > 0`),
    check("ck_numbering_rule_versions_pattern_daily", sql`${t.resetPeriod} <> 'daily' or position('{YYMMDD}' in ${t.pattern}) > 0`),
    check("ck_numbering_rule_versions_pattern_monthly", sql`${t.resetPeriod} <> 'monthly' or position('{YYMM}' in ${t.pattern}) > 0`),
    check("ck_numbering_rule_versions_pattern_yearly", sql`${t.resetPeriod} <> 'yearly' or ${t.pattern} ~ '\\{(YYYY|YY|YYMM|YYMMDD)\\}'`),
    check("ck_numbering_rule_versions_sod", sql`${t.approvedBy} is null or ${t.approvedBy} <> ${t.submittedBy}`),
    check("ck_numbering_rule_versions_dates", sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`),
  ],
);

/**
 * Postgres token buckets behind the limits of docs/security.md §4.5 (shared by every web replica).
 * scope = limit name (`login_ip`, `login_ip_hour`, `api_user`, `scan_lookup`, …); key = ip or user id.
 * `last_allowed` records the decision of the last single-statement upsert (W2F addition).
 * Rows idle for 24 h are deleted by the `platform.metrics_sample` sweep.
 */
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    id: id(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    tokens: numeric("tokens", { precision: 12, scale: 3 }).notNull(),
    refilledAt: timestamp("refilled_at", { withTimezone: true }).notNull().defaultNow(),
    lastAllowed: boolean("last_allowed").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique("rate_limit_buckets_scope_key_uq").on(t.scope, t.key), index("rate_limit_buckets_refilled_idx").on(t.refilledAt)],
);

/**
 * Application metrics (docs/data-model.md §3.10, docs/deployment-railway.md §8.2): written by the
 * `platform.metrics_sample` job every 5 minutes; kept `platform.metrics.retention_days` (90).
 * Not partitioned yet (A-W2F-07).
 */
export const metricsSamples = pgTable(
  "metrics_samples",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull().defaultNow(),
    metric: text("metric").notNull(),
    value: numeric("value", { precision: 18, scale: 6 }).notNull(),
    labels: jsonb("labels").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("metrics_samples_metric_time_idx").on(t.organizationId, t.metric, t.sampledAt)],
);

/**
 * One row per logical dump written by the `backup` service (docs/deployment-railway.md §9,
 * docs/data-model.md §3.10). Read by the diagnostics Backups card when
 * BACKUP_STATUS_SOURCE=table; the application never writes it except through
 * `recordBackupRun` (scripts/record-backup-run.ts).
 */
export const backupRuns = pgTable(
  "backup_runs",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    kind: text("kind").notNull(),
    label: text("label"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull(),
    bucketKey: text("bucket_key"),
    offsiteBucketKey: text("offsite_bucket_key"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    checksumSha256: text("checksum_sha256"),
    pgVersion: text("pg_version"),
    releaseTag: text("release_tag"),
    errorMessage: text("error_message"),
    triggeredBy: uuid("triggered_by").references(() => users.id),
    rowCounts: jsonb("row_counts"),
    hold: boolean("hold").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("backup_runs_org_time_idx").on(t.organizationId, t.startedAt),
    check("ck_backup_runs_kind", sql`${t.kind} in ('scheduled','manual')`),
    check("ck_backup_runs_status", sql`${t.status} in ('running','succeeded','failed')`),
  ],
);

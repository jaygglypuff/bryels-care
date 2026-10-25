import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common";
import { backupRuns } from "./governance";
import { organizations, users } from "./identity";

/**
 * Wave 4 W4F (US-9-03, US-9-05): retention configuration, legal holds, purge runs and restore
 * drills (docs/data-model.md §12.1, §3.10). Periods are configuration confirmed by the company's
 * qualified reviewers (docs/security.md §7, A-SEC-24); nothing here is legal advice.
 */

/** Data classes of docs/data-model.md §12.2 (one vocabulary for policies, the sweep and the docs). */
export const RETENTION_DATA_CLASSES = [
  "quality_batch",
  "stock_ledger",
  "financial",
  "sales_customer",
  "procurement",
  "employee_personal",
  "attendance",
  "payroll",
  "audit",
  "identity",
  "security",
  "idempotency",
  "sync",
  "jobs_notifications",
  "documents_generated",
  "labels_generated",
  "exports",
  "attachments_other",
  "backups",
  "portal",
  "master_data",
  "master_data_shadow",
  "platform_ops",
] as const;
export const RETENTION_BASES = ["record_date", "expiry_date", "last_activity", "employment_end", "period_end", "parent_record"] as const;
export const RETENTION_ACTIONS = ["archive", "anonymise", "delete", "keep"] as const;
export const LEGAL_HOLD_KINDS = ["litigation", "complaint", "recall", "audit", "regulatory", "other"] as const;
/** Entities a legal hold can reference (the hold resolver expands lots ↔ batches, docs/data-model.md §12.1). */
export const LEGAL_HOLD_ENTITY_TYPES = ["inventory_lot", "batch", "customer", "complaint", "sales_order", "user"] as const;

const inList = (xs: readonly string[]) => sql.raw(xs.map((x) => `'${x}'`).join(","));

/**
 * One row per data class and target (`target` = `*` for the whole class or a table name for a
 * subset with its own period, e.g. `jobs_notifications/notifications`). A class without a row uses
 * the shipped default (unconfirmed). Editing a row clears the confirmation; the sweep only acts on
 * confirmed rows and reports for the rest.
 */
export const retentionPolicies = pgTable(
  "retention_policies",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    dataClass: text("data_class").notNull(),
    target: text("target").notNull().default("*"),
    retentionMonths: integer("retention_months"),
    /** Sub-month periods (idempotency keys 7 days, heartbeats 7 days); exactly one of months/days is set. */
    retentionDays: integer("retention_days"),
    basis: text("basis").notNull(),
    minimumMonths: integer("minimum_months"),
    action: text("action").notNull(),
    isConfirmed: boolean("is_confirmed").notNull().default(false),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmationNote: text("confirmation_note"),
    effectiveFrom: date("effective_from").notNull(),
    assumptionId: text("assumption_id"),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("retention_policies_class_target_uq").on(t.organizationId, t.dataClass, t.target),
    check("ck_retention_policies_class", sql`${t.dataClass} in (${inList(RETENTION_DATA_CLASSES)})`),
    check("ck_retention_policies_basis", sql`${t.basis} in (${inList(RETENTION_BASES)})`),
    check("ck_retention_policies_action", sql`${t.action} in (${inList(RETENTION_ACTIONS)})`),
    check("ck_retention_policies_period", sql`(${t.action} = 'keep') or ((${t.retentionMonths} is null) <> (${t.retentionDays} is null))`),
    check("ck_retention_policies_months_positive", sql`${t.retentionMonths} is null or ${t.retentionMonths} > 0`),
    check("ck_retention_policies_days_positive", sql`${t.retentionDays} is null or ${t.retentionDays} > 0`),
    check("ck_retention_policies_confirmed", sql`(not ${t.isConfirmed}) or (${t.confirmedBy} is not null and ${t.confirmedAt} is not null)`),
    check("ck_retention_policies_confirm_sod", sql`${t.confirmedBy} is null or ${t.updatedBy} is null or ${t.confirmedBy} <> ${t.updatedBy}`),
  ],
);

/** Blocks every retention action on what it references until released by a different person. */
export const legalHolds = pgTable(
  "legal_holds",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    holdKind: text("hold_kind").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    /** Display reference captured at placement (lot number, batch number, customer code). */
    entityLabel: text("entity_label"),
    reason: text("reason").notNull(),
    placedBy: uuid("placed_by").notNull().references(() => users.id),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    releasedBy: uuid("released_by").references(() => users.id),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseNote: text("release_note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("legal_holds_entity_active_idx").on(t.entityType, t.entityId).where(sql`${t.releasedAt} is null`),
    index("legal_holds_org_idx").on(t.organizationId, t.placedAt),
    check("ck_legal_holds_kind", sql`${t.holdKind} in (${inList(LEGAL_HOLD_KINDS)})`),
    check("ck_legal_holds_entity_type", sql`${t.entityType} in (${inList(LEGAL_HOLD_ENTITY_TYPES)})`),
    check("ck_legal_holds_release_sod", sql`${t.releasedBy} is null or ${t.releasedBy} <> ${t.placedBy}`),
    check("ck_legal_holds_release_complete", sql`(${t.releasedAt} is null) = (${t.releasedBy} is null) and (${t.releasedAt} is null or ${t.releaseNote} is not null)`),
  ],
);

/**
 * One row per retention sweep (dry run or execution): the per-target report (candidates, held,
 * deleted, skipped and why) is the evidence. Append-only once finished.
 */
export const purgeRuns = pgTable(
  "purge_runs",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    mode: text("mode").notNull(),
    trigger: text("trigger").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    requestedBy: uuid("requested_by").references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    candidateRows: integer("candidate_rows").notNull().default(0),
    heldRows: integer("held_rows").notNull().default(0),
    deletedRows: integer("deleted_rows").notNull().default(0),
    report: jsonb("report").notNull().default(sql`'[]'::jsonb`),
    errorMessage: text("error_message"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
  },
  (t) => [
    index("purge_runs_org_time_idx").on(t.organizationId, t.startedAt),
    uniqueIndex("purge_runs_idem_uq").on(t.organizationId, t.idempotencyKey),
    check("ck_purge_runs_mode", sql`${t.mode} in ('dry_run','execute')`),
    check("ck_purge_runs_trigger", sql`${t.trigger} in ('manual','scheduled')`),
    check("ck_purge_runs_status", sql`${t.status} in ('running','succeeded','failed')`),
    check("ck_purge_runs_dry_run_deletes_nothing", sql`${t.mode} = 'execute' or ${t.deletedRows} = 0`),
  ],
);

/**
 * Evidence of one restore drill (docs/deployment-railway.md §10, AC-23): what was restored, how long
 * it took (measured RTO), how old the dump was (measured RPO) and whether the checks passed. The
 * owner signs off; the signer is never the person who performed the drill.
 */
export const restoreDrills = pgTable(
  "restore_drills",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    backupRunId: uuid("backup_run_id").references(() => backupRuns.id),
    performedAt: timestamp("performed_at", { withTimezone: true }).notNull(),
    performedBy: uuid("performed_by").notNull().references(() => users.id),
    witnessUserId: uuid("witness_user_id").references(() => users.id),
    targetEnvironment: text("target_environment").notNull(),
    sourceKey: text("source_key"),
    durationSeconds: integer("duration_seconds").notNull(),
    measuredRtoSeconds: integer("measured_rto_seconds").notNull(),
    dumpAgeSeconds: integer("dump_age_seconds"),
    checksumVerified: boolean("checksum_verified").notNull(),
    decryptSucceeded: boolean("decrypt_succeeded").notNull(),
    rowCountsMatch: boolean("row_counts_match"),
    migrationsCurrent: boolean("migrations_current"),
    reconciliationRows: integer("reconciliation_rows"),
    result: text("result").notNull(),
    details: jsonb("details"),
    notes: text("notes"),
    reportAttachmentId: uuid("report_attachment_id"),
    signedOffBy: uuid("signed_off_by").references(() => users.id),
    signedOffAt: timestamp("signed_off_at", { withTimezone: true }),
    signOffNote: text("sign_off_note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("restore_drills_org_time_idx").on(t.organizationId, t.performedAt),
    check("ck_restore_drills_result", sql`${t.result} in ('passed','failed')`),
    check("ck_restore_drills_signoff_sod", sql`${t.signedOffBy} is null or ${t.signedOffBy} <> ${t.performedBy}`),
    check("ck_restore_drills_signoff_complete", sql`(${t.signedOffBy} is null) = (${t.signedOffAt} is null)`),
    check("ck_restore_drills_durations", sql`${t.durationSeconds} >= 0 and ${t.measuredRtoSeconds} >= 0`),
  ],
);

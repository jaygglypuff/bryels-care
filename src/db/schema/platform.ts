import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";

/**
 * Typed configuration values (docs/data-model.md §3.1). The key registry with defaults and
 * validation lives in src/lib/settings.ts; a missing row means "use the registry default".
 * scope: organization | site | user
 */
export const settings = pgTable(
  "settings",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    scope: text("scope").notNull(),
    siteId: uuid("site_id").references(() => sites.id),
    userId: uuid("user_id").references(() => users.id),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("settings_scope_key_uq").on(t.organizationId, t.scope, t.siteId, t.userId, t.key).nullsNotDistinct(),
    check("ck_settings_scope", sql`${t.scope} in ('organization','site','user')`),
    check(
      "ck_settings_scope_target",
      sql`(${t.scope} = 'organization' and ${t.siteId} is null and ${t.userId} is null)
       or (${t.scope} = 'site' and ${t.siteId} is not null and ${t.userId} is null)
       or (${t.scope} = 'user' and ${t.userId} is not null)`,
    ),
  ],
);

/**
 * Our registry over pg-boss (ADR-015, docs/architecture.md §8). One row per enqueued job; the
 * worker relays queued rows to pg-boss and records every attempt here so the diagnostics Jobs
 * card never depends on pg-boss internals.
 * status: queued → running → succeeded | failed (dead-lettered) | cancelled; a failed attempt
 * with retries left goes back to queued.
 */
export const backgroundJobs = pgTable(
  "background_jobs",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    /** Job code from the registry, e.g. inventory.reconcile. */
    jobKind: text("job_kind").notNull(),
    status: text("status").notNull().default("queued"),
    /** Zod-validated payload; never contains secrets (registry rule). */
    payload: jsonb("payload").notNull(),
    result: jsonb("result"),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    /** `<code>:<key tuple>`; also the pg-boss singletonKey. */
    idempotencyKey: text("idempotency_key").notNull(),
    pgbossJobId: uuid("pgboss_job_id"),
    correlationId: text("correlation_id").notNull(),
    /** The user who triggered the job (the job runs on their behalf with their current access). */
    requestedBy: uuid("requested_by").references(() => users.id),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    retriedCount: integer("retried_count").notNull().default(0),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("background_jobs_idem_uq").on(t.organizationId, t.idempotencyKey),
    index("background_jobs_status_idx").on(t.status, t.runAfter),
    index("background_jobs_kind_idx").on(t.jobKind, t.createdAt),
    check("ck_background_jobs_status", sql`${t.status} in ('queued','running','succeeded','failed','cancelled')`),
    check("ck_background_jobs_attempts", sql`${t.attempts} >= 0 and ${t.maxAttempts} >= 1`),
  ],
);

/**
 * In-app notifications (action centre). Recipients see only their own rows (self-service).
 * severity: info | warning | critical; channel: in_app | email (email only when configured).
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    recipientUserId: uuid("recipient_user_id").notNull().references(() => users.id),
    kind: text("kind").notNull(),
    severity: text("severity").notNull().default("info"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    /** In-app link to the record page (never a signed file URL). */
    link: text("link"),
    channel: text("channel").notNull().default("in_app"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_dedupe_uq").on(t.recipientUserId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
    index("notifications_recipient_idx").on(t.recipientUserId, t.acknowledgedAt, t.createdAt),
    check("ck_notifications_severity", sql`${t.severity} in ('info','warning','critical')`),
    check("ck_notifications_channel", sql`${t.channel} in ('in_app','email')`),
  ],
);

/**
 * Result of each inventory.reconcile and inventory.rebuild_balances run (docs/data-model.md §5.6).
 * Differences are reported, never auto-fixed. kind: inventory_balances | rebuild;
 * status: clean | differences | failed (reconcile) or rebuilt | failed (rebuild).
 */
export const reconciliationRuns = pgTable(
  "reconciliation_runs",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    /** Null = every site of the organization. */
    siteId: uuid("site_id").references(() => sites.id),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    differencesCount: integer("differences_count").notNull().default(0),
    /** The report: one entry per difference (or per rebuilt key with before/after). */
    report: jsonb("report").notNull(),
    /** Set when the report is also stored as a file (documents stream, file_attachments). */
    reportAttachmentId: uuid("report_attachment_id"),
    notifiedUserIds: jsonb("notified_user_ids").notNull().default(sql`'[]'::jsonb`),
    backgroundJobId: uuid("background_job_id").references(() => backgroundJobs.id),
    /** For a rebuild: the reconciliation run whose differences it addressed. */
    sourceRunId: uuid("source_run_id"),
    triggeredBy: uuid("triggered_by").references(() => users.id),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
  },
  (t) => [
    index("reconciliation_runs_org_time_idx").on(t.organizationId, t.createdAt),
    check("ck_reconciliation_runs_kind", sql`${t.kind} in ('inventory_balances','container_contents','reservations','quality_status','rebuild')`),
    check("ck_reconciliation_runs_status", sql`${t.status} in ('clean','differences','rebuilt','failed')`),
  ],
);

/** One row per worker process, refreshed every 30 s; read by diagnostics and readiness. */
export const workerHeartbeats = pgTable("worker_heartbeats", {
  id: id(),
  workerId: text("worker_id").notNull().unique(),
  hostname: text("hostname").notNull(),
  releaseTag: text("release_tag"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
  queueDepth: integer("queue_depth"),
  migrationsCurrent: boolean("migrations_current").notNull().default(true),
});

/**
 * One row per approval-step decision on any approvable record (docs/data-model.md §3.1): master
 * data revisions (W1D) and inventory documents (stock_adjustment, stock_count; W1C), ADR-028.
 * Append-only (trigger in src/db/sql/w1d.sql): never updated or deleted. The record's own
 * approved_by holds the final step. `cycle` counts approval rounds of a record that can go back
 * for rework (a stock count sent to recount starts cycle 2); a user decides a given step of a
 * record once per cycle.
 */
export const approvalDecisions = pgTable(
  "approval_decisions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    recordType: text("record_type").notNull(),
    recordId: uuid("record_id").notNull(),
    step: integer("step").notNull().default(1),
    cycle: integer("cycle").notNull().default(1),
    /** approved | rejected | returned */
    decision: text("decision").notNull(),
    decidedBy: uuid("decided_by").notNull().references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("approval_decisions_step_user_uq").on(t.recordType, t.recordId, t.cycle, t.step, t.decidedBy),
    index("approval_decisions_record_idx").on(t.recordType, t.recordId),
    check("approval_decisions_decision_ck", sql`${t.decision} in ('approved', 'rejected', 'returned')`),
    check("approval_decisions_step_ck", sql`${t.step} >= 1`),
    check("approval_decisions_cycle_ck", sql`${t.cycle} >= 1`),
  ],
);

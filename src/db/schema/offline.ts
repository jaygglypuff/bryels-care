import { bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, id, updatedAt } from "./_common";
import { organizations, sessions, sites, users } from "./identity";

/**
 * Offline and sync tables (Phase 7, ADR-018, docs/data-model.md §11, docs/offline-sync.md).
 * Table names per ADR-023 item 4. Wave 4 W4D.
 *
 * Plain language: a phone that loses signal can keep counting and weighing; what it recorded is sent
 * later as a list of commands. The server treats each command as if it had been typed online, keeps
 * the answer so a resend changes nothing, and parks anything it could not accept for a supervisor.
 */
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

/** Offline workflow codes (docs/offline-sync.md §3); a device may run one offline only when the site policy and its grant allow it. */
export const OFFLINE_WORKFLOWS = ["movement_request", "dispensing", "process_steps", "stock_count", "receiving", "pick_pack"] as const;
export const DEVICE_STATUSES = ["pending", "active", "suspended", "removed"] as const;
export const DEVICE_CLASSES = ["floor_shared", "personal", "managed_tablet"] as const;
export const DEVICE_PLATFORMS = ["android", "ios", "windows", "macos", "other"] as const;
/** Server-side command status (docs/offline-sync.md §4.2). `received` is the only non-terminal value. */
export const SYNC_COMMAND_STATUSES = ["received", "applied", "rejected", "conflict", "superseded"] as const;
export const SYNC_CONFLICT_REASONS = [
  "validation_failed",
  "permission_denied",
  "site_not_allowed",
  "state_changed",
  "stock_not_eligible",
  "insufficient_stock",
  "out_of_tolerance",
  "wrong_lot",
  "duplicate_key_mismatch",
  "dependency_failed",
  "auth_snapshot_expired",
  "session_revoked",
  "count_closed",
  "other",
] as const;
export const SYNC_CONFLICT_STATUSES = ["open", "resolved_applied", "resolved_discarded", "resolved_amended", "escalated"] as const;

/**
 * A browser installation registered to a site (data-model §11.1). The device key is random, held by
 * the PWA, and only identifies the device; the session cookie authenticates the person. A user asks
 * for registration from the device (`pending`); a holder of `platform.device.admin` at the site
 * activates it with the offline workflows it may run, suspends or removes it (reason required).
 * Rows are never deleted (posted rows and sync commands reference them, A-DM-13).
 */
export const deviceRegistrations = pgTable(
  "device_registrations",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    deviceKeyHash: text("device_key_hash").notNull(),
    label: text("label").notNull(),
    platform: text("platform").notNull().default("other"),
    browser: text("browser"),
    deviceClass: text("device_class").notNull().default("floor_shared"),
    isManaged: boolean("is_managed").notNull().default(false),
    status: text("status").notNull().default("pending"),
    allowedOfflineWorkflows: text("allowed_offline_workflows").array().notNull().default(sql`'{}'::text[]`),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    /** Who activated the device (null while pending). */
    registeredBy: uuid("registered_by").references(() => users.id),
    registeredAt: timestamp("registered_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastReferenceRefreshAt: timestamp("last_reference_refresh_at", { withTimezone: true }),
    referenceCursor: text("reference_cursor"),
    maxClockSkewSeenSeconds: integer("max_clock_skew_seen_seconds").notNull().default(0),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").references(() => users.id),
    statusReason: text("status_reason"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id),
    removedReason: text("removed_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("device_registrations_org_key_uq").on(t.organizationId, t.deviceKeyHash),
    index("device_registrations_site_status_idx").on(t.siteId, t.status),
    check("ck_device_registrations_status", sql`${t.status} in (${inList(DEVICE_STATUSES)})`),
    check("ck_device_registrations_class", sql`${t.deviceClass} in (${inList(DEVICE_CLASSES)})`),
    check("ck_device_registrations_platform", sql`${t.platform} in (${inList(DEVICE_PLATFORMS)})`),
    check("ck_device_registrations_workflows", sql`${t.allowedOfflineWorkflows} <@ array[${inList(OFFLINE_WORKFLOWS)}]::text[]`),
    check("ck_device_registrations_registered", sql`${t.status} not in ('active','suspended') or ${t.registeredBy} is not null`),
    check("ck_device_registrations_removed", sql`${t.status} <> 'removed' or (${t.removedReason} is not null and ${t.removedAt} is not null)`),
  ],
);

/**
 * One offline command as received by `POST /api/v1/sync/commands` (data-model §11.2). The id is the
 * client-generated UUIDv7 of the outbox entry; a second arrival is answered from this row. No update
 * after a terminal status except `conflict`/`rejected` → `superseded` when a reviewer's resolution
 * command replaces it. Resolution commands are created on the server (no device sequence).
 */
export const syncCommands = pgTable(
  "sync_commands",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    deviceRegistrationId: uuid("device_registration_id").references(() => deviceRegistrations.id),
    /** The person who queued the command (from the authorization snapshot; equals the session user unless the device changed hands). */
    userId: uuid("user_id").notNull().references(() => users.id),
    /** The session that replayed it. */
    sessionId: uuid("session_id").references(() => sessions.id),
    commandType: text("command_type").notNull(),
    payload: jsonb("payload").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    clientCreatedAt: timestamp("client_created_at", { withTimezone: true }).notNull(),
    clientSequence: bigint("client_sequence", { mode: "number" }),
    authSnapshotIssuedAt: timestamp("auth_snapshot_issued_at", { withTimezone: true }).notNull(),
    authSnapshotSessionId: uuid("auth_snapshot_session_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    syncBatchId: uuid("sync_batch_id").notNull(),
    positionInBatch: integer("position_in_batch").notNull().default(0),
    replayedAt: timestamp("replayed_at", { withTimezone: true }),
    clockSkewSeconds: integer("clock_skew_seconds").notNull().default(0),
    isClockSkewFlagged: boolean("is_clock_skew_flagged").notNull().default(false),
    dependsOnCommandId: uuid("depends_on_command_id"),
    status: text("status").notNull().default("received"),
    serverResult: jsonb("server_result"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    appliedEntityType: text("applied_entity_type"),
    appliedEntityId: uuid("applied_entity_id"),
    appliedEntityNumber: text("applied_entity_number"),
    /** Set on server-created resolution commands: the conflict they resolve and who asked. */
    resolutionOfConflictId: uuid("resolution_of_conflict_id"),
    createdBy: uuid("created_by").references(() => users.id),
    correlationId: uuid("correlation_id").notNull(),
  },
  (t) => [
    uniqueIndex("sync_commands_org_key_uq").on(t.organizationId, t.idempotencyKey),
    uniqueIndex("sync_commands_device_sequence_uq").on(t.deviceRegistrationId, t.clientSequence).where(sql`${t.deviceRegistrationId} is not null and ${t.clientSequence} is not null`),
    index("sync_commands_site_status_idx").on(t.siteId, t.status, t.receivedAt),
    index("sync_commands_user_idx").on(t.userId, t.receivedAt),
    index("sync_commands_device_idx").on(t.deviceRegistrationId, t.receivedAt),
    check("ck_sync_commands_status", sql`${t.status} in (${inList(SYNC_COMMAND_STATUSES)})`),
    check("ck_sync_commands_type", sql`${t.commandType} ~ '^[a-z]+\\.[a-z_]+\\.[a-z_]+$'`),
  ],
);

/**
 * One row per rejected or conflicted command (data-model §11.3): the payload as sent, the server's
 * view of the related record, a reason from the catalogue, and how a reviewer resolved it. Every
 * resolution needs a note; re-apply creates a new command (`resolution_command_id`); the original is
 * never applied silently.
 */
export const syncConflicts = pgTable(
  "sync_conflicts",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    syncCommandId: uuid("sync_command_id").notNull().references(() => syncCommands.id),
    deviceRegistrationId: uuid("device_registration_id").references(() => deviceRegistrations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    commandType: text("command_type").notNull(),
    reasonCode: text("reason_code").notNull(),
    reasonMessage: text("reason_message").notNull(),
    clientState: jsonb("client_state").notNull(),
    serverState: jsonb("server_state"),
    relatedEntityType: text("related_entity_type"),
    relatedEntityId: uuid("related_entity_id"),
    relatedEntityNumber: text("related_entity_number"),
    status: text("status").notNull().default("open"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    resolutionCommandId: uuid("resolution_command_id").references(() => syncCommands.id),
    escalatedEntityType: text("escalated_entity_type"),
    escalatedEntityId: uuid("escalated_entity_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("sync_conflicts_command_uq").on(t.syncCommandId),
    index("sync_conflicts_site_status_idx").on(t.siteId, t.status, t.createdAt),
    index("sync_conflicts_user_status_idx").on(t.userId, t.status),
    check("ck_sync_conflicts_reason", sql`${t.reasonCode} in (${inList(SYNC_CONFLICT_REASONS)})`),
    check("ck_sync_conflicts_status", sql`${t.status} in (${inList(SYNC_CONFLICT_STATUSES)})`),
    check("ck_sync_conflicts_resolution_note", sql`${t.status} = 'open' or (${t.resolutionNote} is not null and ${t.resolvedBy} is not null and ${t.resolvedAt} is not null)`),
    check("ck_sync_conflicts_escalation", sql`(${t.escalatedEntityType} is null) = (${t.escalatedEntityId} is null)`),
    check("ck_sync_conflicts_escalated_kind", sql`${t.escalatedEntityType} is null or ${t.escalatedEntityType} in ('deviation','stock_adjustment')`),
  ],
);

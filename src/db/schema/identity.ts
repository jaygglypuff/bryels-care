import { sql } from "drizzle-orm";
import { type AnyPgColumn, bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common";

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Manila"),
  currency: text("currency").notNull().default("PHP"),
  createdAt: createdAt(),
});

export const sites = pgTable(
  "sites",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sites_org_code_uq").on(t.organizationId, t.code)],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** invited | active | locked | deactivated | system (the organization's system actor, ADR-029: never signs in, hidden from user admin) */
    status: text("status").notNull().default("active"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /** W2E (US-1-11, US-1-16): password set/changed (acceptance, reset, own change); deactivation time. */
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_org_email_uq").on(t.organizationId, t.email)],
);

export const roles = pgTable(
  "roles",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Seeded roles are read-only templates (ruling 60). */
    isSystem: boolean("is_system").notNull().default(true),
    /** owner_director, system_admin and auditor may be assigned organization-wide. */
    allowsOrganizationWide: boolean("allows_organization_wide").notNull().default(false),
    /** W2E (US-1-29): custom roles are cloned from a seeded template; status active | inactive. */
    description: text("description"),
    clonedFromRoleId: uuid("cloned_from_role_id").references((): AnyPgColumn => roles.id),
    status: text("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("roles_org_code_uq").on(t.organizationId, t.code),
    check("ck_roles_status", sql`${t.status} in ('active','inactive')`),
    check("ck_roles_custom_clone", sql`${t.isSystem} or ${t.clonedFromRoleId} is not null`),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull().references(() => roles.id),
    permissionCode: text("permission_code").notNull(),
  },
  (t) => [uniqueIndex("role_permissions_uq").on(t.roleId, t.permissionCode)],
);

export const userSiteAssignments = pgTable(
  "user_site_assignments",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    roleId: uuid("role_id").notNull().references(() => roles.id),
    /** Null when isOrganizationWide is true. */
    siteId: uuid("site_id").references(() => sites.id),
    isOrganizationWide: boolean("is_organization_wide").notNull().default(false),
    /**
     * W2E (US-1-18): validity window. timestamptz (org-local midnight computed by the service) so every
     * query compares with now() without a timezone; active = valid_from <= now() < coalesce(valid_to, ∞).
     */
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    /** W2E (US-2-29): optional sub-scope inside the site, `{"warehouseIds": [...]}`; null = whole site. */
    scope: jsonb("scope"),
    createdBy: uuid("created_by").references(() => users.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id),
    revokedReason: text("revoked_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    index("usa_user_idx").on(t.userId),
    check("ck_usa_org_wide_site", sql`(${t.isOrganizationWide} and ${t.siteId} is null) or (not ${t.isOrganizationWide} and ${t.siteId} is not null)`),
    check("ck_usa_validity", sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
    uniqueIndex("usa_live_uq")
      .on(t.userId, t.roleId, sql`coalesce(${t.siteId}, '00000000-0000-0000-0000-000000000000'::uuid)`)
      .where(sql`${t.revokedAt} is null`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent"),
    /** W2E (US-1-12, US-1-28): see docs/security.md §3.4. `expires_at` is the absolute expiry. */
    idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }),
    ip: text("ip"),
    deviceLabel: text("device_label"),
    /** standard | shared (shared floor device: shorter idle timeout, setting session.idle_minutes_shared_device). */
    deviceClass: text("device_class").notNull().default("standard"),
    /** The user held a restricted (R) permission when the session started: shorter timeouts, MFA. */
    privileged: boolean("privileged").notNull().default(false),
    /** mfa_pending (password ok, TOTP step outstanding; never authorizes anything) | active. */
    stage: text("stage").notNull().default("active"),
    activeSiteId: uuid("active_site_id").references(() => sites.id),
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
    reauthenticatedAt: timestamp("reauthenticated_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id),
    revokedReason: text("revoked_reason"),
  },
  (t) => [
    uniqueIndex("sessions_token_uq").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
    check("ck_sessions_stage", sql`${t.stage} in ('mfa_pending','active')`),
    check("ck_sessions_device_class", sql`${t.deviceClass} in ('standard','shared')`),
  ],
);

/** Append-only audit trail; action follows module.entity.event (data-model §8.1). */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    actorId: uuid("actor_id").references(() => users.id),
    /** Non-user actor, e.g. `system:inventory.reconcile` for background jobs (architecture §8 rule 4). */
    actorLabel: text("actor_label"),
    /** The user a system actor acted for (job triggered by that user). */
    onBehalfOf: uuid("on_behalf_of").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    entityNumber: text("entity_number"),
    reason: text("reason"),
    before: jsonb("before"),
    after: jsonb("after"),
    correlationId: text("correlation_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_site_time_idx").on(t.siteId, t.occurredAt), index("audit_entity_idx").on(t.entityType, t.entityId)],
);

/** Human-readable document numbers allocated inside the posting transaction (ADR-009). */
export const numberingRules = pgTable(
  "numbering_rules",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    documentType: text("document_type").notNull(),
    prefix: text("prefix").notNull(),
    sequenceWidth: integer("sequence_width").notNull().default(5),
    periodKey: text("period_key").notNull().default(""),
    nextValue: bigint("next_value", { mode: "number" }).notNull().default(1),
  },
  (t) => [uniqueIndex("numbering_doc_period_uq").on(t.organizationId, t.documentType, t.periodKey)],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    key: text("key").notNull(),
    command: text("command").notNull(),
    result: jsonb("result"),
    /** /api/v1 commands (data-model §11.4): who sent it and a hash of the canonical input. */
    userId: uuid("user_id").references(() => users.id),
    requestHash: text("request_hash"),
    responseCode: integer("response_code"),
    /** Offline-replay envelope (ADR-018): client UUIDv7 command id, device id, client clock. */
    clientCommandId: uuid("client_command_id"),
    deviceId: text("device_id"),
    clientCreatedAt: timestamp("client_created_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("idempotency_org_key_uq").on(t.organizationId, t.key)],
);

import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    /** invited | active | locked | deactivated */
    status: text("status").notNull().default("active"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
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
  },
  (t) => [uniqueIndex("roles_org_code_uq").on(t.organizationId, t.code)],
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
    createdAt: createdAt(),
  },
  (t) => [index("usa_user_idx").on(t.userId)],
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
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash)],
);

/** Append-only audit trail; action follows module.entity.event (data-model §8.1). */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    actorId: uuid("actor_id").references(() => users.id),
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
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("idempotency_org_key_uq").on(t.organizationId, t.key)],
);

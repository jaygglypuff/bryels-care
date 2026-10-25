import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";
import { customers, products } from "./masterdata";

/**
 * Customer portal (Wave 4 W4E, backlog E-8-01 / E-8-02, US-8-01 / US-8-02; ADR-011;
 * docs/permissions-matrix.md §7; docs/security.md §2.10, §3.4, §3.8; docs/data-model.md §3.10).
 *
 * A separate authentication boundary: portal users, sessions and invitations live in their own
 * tables and NEVER reference or share `users` / `sessions` / `invitations`. A portal user belongs to
 * exactly one tenant; a tenant belongs to exactly one customer (unique `customer_id`). Every portal
 * query filters on the tenant's customer id (src/modules/portal), never on an id the browser sends.
 *
 * - `customer_portal_tenants`: one per customer; `status` active | suspended (machine in
 *   src/modules/portal/states.ts); `site_id` = the site that fulfils portal orders;
 *   `catalog_mode` decides which priced products the customer sees (all_priced | customer_price_list | curated).
 * - `portal_users`: `status` invited | active | locked | suspended; `portal_role` portal_buyer | portal_viewer
 *   (capabilities in src/modules/portal/capabilities.ts, never in internal `roles`); own lockout
 *   counter; optional TOTP (secret encrypted with DATA_ENCRYPTION_KEY like internal TOTP).
 * - `portal_sessions`: same shape as `sessions` (sha256 of the cookie value only), stage
 *   mfa_pending | active; idle and absolute expiry from settings `portal.session.*`.
 * - `portal_invitations`: 32-byte token, sha256 stored, tenant bound, single use, 72 h by default.
 * - `portal_catalog_items`: the staff-curated allow-list used when `catalog_mode = 'curated'`.
 *
 * Email is unique per organization (not only per tenant, as the catalogue draft said) so that
 * signing in by email is unambiguous (A-W4E-02).
 */

export const PORTAL_TENANT_STATUSES = ["active", "suspended"] as const;
export const PORTAL_CATALOG_MODES = ["all_priced", "customer_price_list", "curated"] as const;
export const PORTAL_USER_STATUSES = ["invited", "active", "locked", "suspended"] as const;
export const PORTAL_ROLES = ["portal_buyer", "portal_viewer"] as const;

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

export const customerPortalTenants = pgTable(
  "customer_portal_tenants",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    status: text("status").notNull().default("active"),
    /** The site that fulfils (and approves) this customer's portal orders. */
    siteId: uuid("site_id").notNull().references(() => sites.id),
    catalogMode: text("catalog_mode").notNull().default("all_priced"),
    statusReason: text("status_reason"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("customer_portal_tenants_customer_uq").on(t.customerId),
    check("customer_portal_tenants_status_ck", sql`${t.status} in (${inList(PORTAL_TENANT_STATUSES)})`),
    check("customer_portal_tenants_catalog_ck", sql`${t.catalogMode} in (${inList(PORTAL_CATALOG_MODES)})`),
    check("customer_portal_tenants_reason_ck", sql`${t.status} <> 'suspended' or ${t.statusReason} is not null`),
  ],
);

export const portalUsers = pgTable(
  "portal_users",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    tenantId: uuid("tenant_id").notNull().references(() => customerPortalTenants.id),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    /** argon2id; `!` until the invitation is accepted (matches nothing). */
    passwordHash: text("password_hash").notNull().default("!"),
    status: text("status").notNull().default("invited"),
    portalRole: text("portal_role").notNull().default("portal_buyer"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    /** Optional TOTP (docs/security.md §3.7: optional for portal users). Encrypted at rest. */
    totpSecretEnc: text("totp_secret_enc"),
    totpKeyId: text("totp_key_id"),
    totpConfirmedAt: timestamp("totp_confirmed_at", { withTimezone: true }),
    totpLastStep: integer("totp_last_step"),
    statusReason: text("status_reason"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("portal_users_org_email_uq").on(t.organizationId, sql`lower(${t.email})`),
    index("portal_users_tenant_idx").on(t.tenantId),
    check("portal_users_status_ck", sql`${t.status} in (${inList(PORTAL_USER_STATUSES)})`),
    check("portal_users_role_ck", sql`${t.portalRole} in (${inList(PORTAL_ROLES)})`),
  ],
);

export const portalSessions = pgTable(
  "portal_sessions",
  {
    id: id(),
    portalUserId: uuid("portal_user_id").notNull().references(() => portalUsers.id),
    tenantId: uuid("tenant_id").notNull().references(() => customerPortalTenants.id),
    tokenHash: text("token_hash").notNull(),
    stage: text("stage").notNull().default("active"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
  },
  (t) => [
    uniqueIndex("portal_sessions_token_uq").on(t.tokenHash),
    index("portal_sessions_user_idx").on(t.portalUserId),
    index("portal_sessions_expires_idx").on(t.expiresAt),
    check("portal_sessions_stage_ck", sql`${t.stage} in ('mfa_pending','active')`),
  ],
);

export const portalInvitations = pgTable(
  "portal_invitations",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    tenantId: uuid("tenant_id").notNull().references(() => customerPortalTenants.id),
    portalUserId: uuid("portal_user_id").notNull().references(() => portalUsers.id),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("portal_invitations_token_uq").on(t.tokenHash), index("portal_invitations_user_idx").on(t.portalUserId)],
);

export const portalCatalogItems = pgTable(
  "portal_catalog_items",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    tenantId: uuid("tenant_id").notNull().references(() => customerPortalTenants.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("portal_catalog_items_uq").on(t.tenantId, t.productId)],
);

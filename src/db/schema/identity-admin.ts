import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common";
import { organizations, roles, sites, users } from "./identity";

/**
 * Wave 2 W2E: identity administration (US-1-11, US-1-12, US-1-16..18, US-1-28, US-1-29, US-2-29).
 * Tokens are 32 random bytes; only sha256(token) is stored (docs/security.md §3.8). No table here ever
 * holds a password, a raw token or a TOTP secret in clear text.
 */

/**
 * Invitation of a person (docs/data-model.md §3.1). The `users` row (status `invited`) and its site
 * assignments are created at invitation time (US-1-16 AC1); acceptance sets the password and moves the
 * user to `active`. A resend revokes the previous row and inserts a new one.
 */
export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    /** Copy for the message; the user row is the link. */
    email: text("email").notNull(),
    /** Primary grant shown in the message (all grants are user_site_assignments rows). */
    roleId: uuid("role_id").references(() => roles.id),
    siteId: uuid("site_id").references(() => sites.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    /** bootstrap = first administrator created by `pnpm admin:bootstrap` (no inviter). */
    kind: text("kind").notNull().default("standard"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("invitations_token_uq").on(t.tokenHash),
    index("invitations_user_idx").on(t.userId),
    check("ck_invitations_kind", sql`${t.kind} in ('standard','bootstrap')`),
  ],
);

/** Self-service password reset (30 minutes, single use; the newest token invalidates older ones). */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    /** Set when a newer token, a deactivation or an admin voided this one. */
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    requestedIp: text("requested_ip"),
    /** self | admin (identity.user.admin "force password reset"). */
    requestedBy: text("requested_by").notNull().default("self"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("password_reset_tokens_token_uq").on(t.tokenHash),
    index("password_reset_tokens_user_idx").on(t.userId, t.createdAt),
    check("ck_password_reset_requested_by", sql`${t.requestedBy} in ('self','admin')`),
  ],
);

/** The last N password hashes per user so a new password cannot repeat one (A-SEC-05). */
export const passwordHistory = pgTable(
  "password_history",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("password_history_user_idx").on(t.userId, t.createdAt)],
);

/**
 * TOTP factor (RFC 6238; docs/security.md §3.7). `secret_enc` is AES-256-GCM ciphertext
 * (base64url of iv | tag | ciphertext) under DATA_ENCRYPTION_KEY with `key_id` for rotation.
 * A row without `confirmed_at` is an enrolment in progress and protects nothing.
 */
export const mfaSecrets = pgTable(
  "mfa_secrets",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    secretEnc: text("secret_enc").notNull(),
    keyId: text("key_id").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    /** Last accepted 30-second step: a code is never accepted twice (replay). */
    lastUsedStep: bigint("last_used_step", { mode: "number" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("mfa_secrets_user_uq").on(t.userId)],
);

/** Single-use recovery codes (10 per enrolment, argon2id hashes, shown once). */
export const mfaRecoveryCodes = pgTable(
  "mfa_recovery_codes",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("mfa_recovery_codes_user_idx").on(t.userId)],
);

/**
 * Email delivery log. The dev/test adapter (`EMAIL_PROVIDER=outbox`) stores the full message so a
 * developer or a test can open the link; production adapters store metadata only (`body_text` null),
 * so tokens never rest in the database.
 * status: captured (outbox adapter) | sent | failed | not_configured (EMAIL_PROVIDER=none)
 */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    /** Message template code, e.g. identity.invitation. */
    template: text("template").notNull(),
    bodyText: text("body_text"),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("email_outbox_to_idx").on(t.toAddress, t.createdAt),
    check("ck_email_outbox_status", sql`${t.status} in ('captured','sent','failed','not_configured')`),
  ],
);

/* rate_limit_buckets lives in ./governance.ts (one shared store, src/lib/rate-limit; ADR-038). */

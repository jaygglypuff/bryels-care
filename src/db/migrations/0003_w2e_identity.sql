CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"template" text NOT NULL,
	"body_text" text,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"provider_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_email_outbox_status" CHECK ("email_outbox"."status" in ('captured','sent','failed','not_configured'))
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role_id" uuid,
	"site_id" uuid,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"kind" text DEFAULT 'standard' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_invitations_kind" CHECK ("invitations"."kind" in ('standard','bootstrap'))
);
--> statement-breakpoint
CREATE TABLE "mfa_recovery_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_secrets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"secret_enc" text NOT NULL,
	"key_id" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"last_used_step" bigint,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"requested_ip" text,
	"requested_by" text DEFAULT 'self' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_password_reset_requested_by" CHECK ("password_reset_tokens"."requested_by" in ('self','admin'))
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"tokens" numeric(9, 2) NOT NULL,
	"refilled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "cloned_from_role_id" uuid;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "idle_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_label" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_class" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "privileged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "stage" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "active_site_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "mfa_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "reauthenticated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "revoked_by" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "revoked_reason" text;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD COLUMN "valid_from" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD COLUMN "valid_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD COLUMN "scope" jsonb;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD COLUMN "revoked_by" uuid;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD COLUMN "revoked_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_secrets" ADD CONSTRAINT "mfa_secrets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_secrets" ADD CONSTRAINT "mfa_secrets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_to_idx" ON "email_outbox" USING btree ("to_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_user_idx" ON "invitations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mfa_recovery_codes_user_idx" ON "mfa_recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_secrets_user_uq" ON "mfa_secrets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_history_user_idx" ON "password_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_token_uq" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_buckets_uq" ON "rate_limit_buckets" USING btree ("scope","key");--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_cloned_from_role_id_roles_id_fk" FOREIGN KEY ("cloned_from_role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_site_id_sites_id_fk" FOREIGN KEY ("active_site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD CONSTRAINT "user_site_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD CONSTRAINT "user_site_assignments_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usa_live_uq" ON "user_site_assignments" USING btree ("user_id","role_id",coalesce("site_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "user_site_assignments"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "ck_roles_status" CHECK ("roles"."status" in ('active','inactive'));--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "ck_roles_custom_clone" CHECK ("roles"."is_system" or "roles"."cloned_from_role_id" is not null);--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "ck_sessions_stage" CHECK ("sessions"."stage" in ('mfa_pending','active'));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "ck_sessions_device_class" CHECK ("sessions"."device_class" in ('standard','shared'));--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD CONSTRAINT "ck_usa_org_wide_site" CHECK (("user_site_assignments"."is_organization_wide" and "user_site_assignments"."site_id" is null) or (not "user_site_assignments"."is_organization_wide" and "user_site_assignments"."site_id" is not null));--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD CONSTRAINT "ck_usa_validity" CHECK ("user_site_assignments"."valid_to" is null or "user_site_assignments"."valid_to" >= "user_site_assignments"."valid_from");
CREATE TABLE "customer_portal_tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"site_id" uuid NOT NULL,
	"catalog_mode" text DEFAULT 'all_priced' NOT NULL,
	"status_reason" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_portal_tenants_status_ck" CHECK ("customer_portal_tenants"."status" in ('active','suspended')),
	CONSTRAINT "customer_portal_tenants_catalog_ck" CHECK ("customer_portal_tenants"."catalog_mode" in ('all_priced','customer_price_list','curated')),
	CONSTRAINT "customer_portal_tenants_reason_ck" CHECK ("customer_portal_tenants"."status" <> 'suspended' or "customer_portal_tenants"."status_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "portal_catalog_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"portal_user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"portal_user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"stage" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"mfa_verified_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "portal_sessions_stage_ck" CHECK ("portal_sessions"."stage" in ('mfa_pending','active'))
);
--> statement-breakpoint
CREATE TABLE "portal_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text DEFAULT '!' NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"portal_role" text DEFAULT 'portal_buyer' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"totp_secret_enc" text,
	"totp_key_id" text,
	"totp_confirmed_at" timestamp with time zone,
	"totp_last_step" integer,
	"status_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_users_status_ck" CHECK ("portal_users"."status" in ('invited','active','locked','suspended')),
	CONSTRAINT "portal_users_role_ck" CHECK ("portal_users"."portal_role" in ('portal_buyer','portal_viewer'))
);
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "source" text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "portal_user_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_portal_tenants" ADD CONSTRAINT "customer_portal_tenants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portal_tenants" ADD CONSTRAINT "customer_portal_tenants_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portal_tenants" ADD CONSTRAINT "customer_portal_tenants_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portal_tenants" ADD CONSTRAINT "customer_portal_tenants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portal_tenants" ADD CONSTRAINT "customer_portal_tenants_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_catalog_items" ADD CONSTRAINT "portal_catalog_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_catalog_items" ADD CONSTRAINT "portal_catalog_items_tenant_id_customer_portal_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."customer_portal_tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_catalog_items" ADD CONSTRAINT "portal_catalog_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_catalog_items" ADD CONSTRAINT "portal_catalog_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_tenant_id_customer_portal_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."customer_portal_tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_portal_user_id_portal_users_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "public"."portal_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_portal_user_id_portal_users_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "public"."portal_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_tenant_id_customer_portal_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."customer_portal_tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_tenant_id_customer_portal_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."customer_portal_tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_portal_tenants_customer_uq" ON "customer_portal_tenants" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_catalog_items_uq" ON "portal_catalog_items" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_invitations_token_uq" ON "portal_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "portal_invitations_user_idx" ON "portal_invitations" USING btree ("portal_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_sessions_token_uq" ON "portal_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "portal_sessions_user_idx" ON "portal_sessions" USING btree ("portal_user_id");--> statement-breakpoint
CREATE INDEX "portal_sessions_expires_idx" ON "portal_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_users_org_email_uq" ON "portal_users" USING btree ("organization_id",lower("email"));--> statement-breakpoint
CREATE INDEX "portal_users_tenant_idx" ON "portal_users" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_portal_user_id_portal_users_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "public"."portal_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "so_source_ck" CHECK ("sales_orders"."source" in ('internal','portal') and ("sales_orders"."source" = 'portal') = ("sales_orders"."portal_user_id" is not null));
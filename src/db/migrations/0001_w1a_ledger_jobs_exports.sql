CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"job_kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"idempotency_key" text NOT NULL,
	"pgboss_job_id" uuid,
	"correlation_id" text NOT NULL,
	"requested_by" uuid,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone,
	"retried_count" integer DEFAULT 0 NOT NULL,
	"cancelled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_background_jobs_status" CHECK ("background_jobs"."status" in ('queued','running','succeeded','failed','cancelled')),
	CONSTRAINT "ck_background_jobs_attempts" CHECK ("background_jobs"."attempts" >= 0 and "background_jobs"."max_attempts" >= 1)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"recipient_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"link" text,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_notifications_severity" CHECK ("notifications"."severity" in ('info','warning','critical')),
	CONSTRAINT "ck_notifications_channel" CHECK ("notifications"."channel" in ('in_app','email'))
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"differences_count" integer DEFAULT 0 NOT NULL,
	"report" jsonb NOT NULL,
	"report_attachment_id" uuid,
	"notified_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"background_job_id" uuid,
	"source_run_id" uuid,
	"triggered_by" uuid,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_reconciliation_runs_kind" CHECK ("reconciliation_runs"."kind" in ('inventory_balances','container_contents','reservations','quality_status','rebuild')),
	CONSTRAINT "ck_reconciliation_runs_status" CHECK ("reconciliation_runs"."status" in ('clean','differences','rebuilt','failed'))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"site_id" uuid,
	"user_id" uuid,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_scope_key_uq" UNIQUE NULLS NOT DISTINCT("organization_id","scope","site_id","user_id","key"),
	CONSTRAINT "ck_settings_scope" CHECK ("settings"."scope" in ('organization','site','user')),
	CONSTRAINT "ck_settings_scope_target" CHECK (("settings"."scope" = 'organization' and "settings"."site_id" is null and "settings"."user_id" is null)
       or ("settings"."scope" = 'site' and "settings"."site_id" is not null and "settings"."user_id" is null)
       or ("settings"."scope" = 'user' and "settings"."user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"hostname" text NOT NULL,
	"release_tag" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"queue_depth" integer,
	"migrations_current" boolean DEFAULT true NOT NULL,
	CONSTRAINT "worker_heartbeats_worker_id_unique" UNIQUE("worker_id")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "actor_label" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "on_behalf_of" uuid;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "request_hash" text;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "response_code" integer;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "client_command_id" uuid;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "client_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "qty_entered" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "entered_uom" text;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "quality_status_at_posting" text;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "correlation_id" uuid;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_background_job_id_background_jobs_id_fk" FOREIGN KEY ("background_job_id") REFERENCES "public"."background_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "background_jobs_idem_uq" ON "background_jobs" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "background_jobs_status_idx" ON "background_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "background_jobs_kind_idx" ON "background_jobs" USING btree ("job_kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("recipient_user_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_user_id","acknowledged_at","created_at");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_org_time_idx" ON "reconciliation_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_on_behalf_of_users_id_fk" FOREIGN KEY ("on_behalf_of") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reversal_of_id_stock_movements_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "movements_reversal_of_uq" ON "stock_movements" USING btree ("reversal_of_id") WHERE "stock_movements"."reversal_of_id" is not null;--> statement-breakpoint
CREATE INDEX "movements_correlation_idx" ON "stock_movements" USING btree ("correlation_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "ck_stock_movements_qty_positive" CHECK ("stock_movements"."qty_base" > 0);--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "ck_stock_movements_type" CHECK ("stock_movements"."movement_type" in ('receipt','issue','transfer','consumption','output','adjustment','return','shipment','reversal'));--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "ck_stock_movements_locations" CHECK (case "stock_movements"."movement_type"
        when 'receipt' then "stock_movements"."from_location_id" is null and "stock_movements"."to_location_id" is not null
        when 'output' then "stock_movements"."from_location_id" is null and "stock_movements"."to_location_id" is not null
        when 'return' then "stock_movements"."from_location_id" is null and "stock_movements"."to_location_id" is not null
        when 'issue' then "stock_movements"."from_location_id" is not null and "stock_movements"."to_location_id" is null
        when 'consumption' then "stock_movements"."from_location_id" is not null and "stock_movements"."to_location_id" is null
        when 'shipment' then "stock_movements"."from_location_id" is not null and "stock_movements"."to_location_id" is null
        when 'transfer' then "stock_movements"."from_location_id" is not null and "stock_movements"."to_location_id" is not null and "stock_movements"."from_location_id" <> "stock_movements"."to_location_id"
        when 'adjustment' then ("stock_movements"."from_location_id" is null) <> ("stock_movements"."to_location_id" is null)
        when 'reversal' then "stock_movements"."reversal_of_id" is not null and ("stock_movements"."from_location_id" is not null or "stock_movements"."to_location_id" is not null)
        else false end);--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "ck_stock_movements_reversal_link" CHECK (("stock_movements"."movement_type" = 'reversal') = ("stock_movements"."reversal_of_id" is not null));
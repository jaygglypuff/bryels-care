CREATE TABLE "action_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"tab" text NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"record_number" text,
	"title" text NOT NULL,
	"detail" text,
	"severity" text NOT NULL,
	"view_permission" text NOT NULL,
	"link" text NOT NULL,
	"action_label" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"acknowledgement_note" text,
	"escalated_at" timestamp with time zone,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_action_items_tab" CHECK ("action_items"."tab" in ('approvals','exceptions')),
	CONSTRAINT "ck_action_items_severity" CHECK ("action_items"."severity" in ('info','warning','critical')),
	CONSTRAINT "ck_action_items_ack" CHECK (("action_items"."acknowledged_at" is null) = ("action_items"."acknowledged_by" is null))
);
--> statement-breakpoint
CREATE TABLE "notification_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"item_kind" text NOT NULL,
	"name" text NOT NULL,
	"severity" text NOT NULL,
	"owner_role_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"escalate_after_hours" integer,
	"escalation_role_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"email_on_open" boolean DEFAULT false NOT NULL,
	"email_on_escalation" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_rules_scope_kind_uq" UNIQUE NULLS NOT DISTINCT("organization_id","site_id","item_kind"),
	CONSTRAINT "ck_notification_rules_severity" CHECK ("notification_rules"."severity" in ('info','warning','critical')),
	CONSTRAINT "ck_notification_rules_escalation" CHECK (("notification_rules"."escalate_after_hours" is null) = (jsonb_array_length("notification_rules"."escalation_role_codes") = 0) and ("notification_rules"."escalate_after_hours" is null or "notification_rules"."escalate_after_hours" between 1 and 720))
);
--> statement-breakpoint
CREATE TABLE "report_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"report_code" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"owner_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_report_definitions_version" CHECK ("report_definitions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "report_run_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"report_run_id" uuid NOT NULL,
	"format" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"content" "bytea",
	"sha256" text NOT NULL,
	"row_count" integer NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"site_ids" jsonb NOT NULL,
	"recipient_user_ids" jsonb NOT NULL,
	"permission_fingerprint" text NOT NULL,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_report_run_files_format" CHECK ("report_run_files"."format" in ('csv','xlsx','html')),
	CONSTRAINT "ck_report_run_files_purged" CHECK ("report_run_files"."purged_at" is null or "report_run_files"."content" is null)
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"scheduled_report_id" uuid,
	"report_code" text NOT NULL,
	"trigger" text NOT NULL,
	"run_key" text NOT NULL,
	"period_key" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"recipients_sent" integer DEFAULT 0 NOT NULL,
	"recipients_skipped" integer DEFAULT 0 NOT NULL,
	"skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"files_count" integer DEFAULT 0 NOT NULL,
	"emails_sent" integer DEFAULT 0 NOT NULL,
	"email_status" text,
	"background_job_id" uuid,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_report_runs_status" CHECK ("report_runs"."status" in ('running','succeeded','partial','skipped','failed')),
	CONSTRAINT "ck_report_runs_trigger" CHECK ("report_runs"."trigger" in ('schedule','access_report')),
	CONSTRAINT "ck_report_runs_counts" CHECK ("report_runs"."recipients_sent" >= 0 and "report_runs"."recipients_skipped" >= 0 and "report_runs"."files_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "scheduled_report_recipients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scheduled_report_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"name" text NOT NULL,
	"report_code" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"cadence" text NOT NULL,
	"run_at_time" text NOT NULL,
	"weekday" integer,
	"month_day" integer,
	"timezone" text DEFAULT 'Asia/Manila' NOT NULL,
	"format" text NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_scheduled_reports_cadence" CHECK ("scheduled_reports"."cadence" in ('daily','weekly','monthly')),
	CONSTRAINT "ck_scheduled_reports_format" CHECK ("scheduled_reports"."format" in ('csv','xlsx','html')),
	CONSTRAINT "ck_scheduled_reports_time" CHECK ("scheduled_reports"."run_at_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "ck_scheduled_reports_weekday" CHECK (("scheduled_reports"."cadence" = 'weekly') = ("scheduled_reports"."weekday" is not null) and ("scheduled_reports"."weekday" is null or "scheduled_reports"."weekday" between 1 and 7)),
	CONSTRAINT "ck_scheduled_reports_month_day" CHECK (("scheduled_reports"."cadence" = 'monthly') = ("scheduled_reports"."month_day" is not null) and ("scheduled_reports"."month_day" is null or "scheduled_reports"."month_day" between 1 and 28))
);
--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_run_files" ADD CONSTRAINT "report_run_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_run_files" ADD CONSTRAINT "report_run_files_report_run_id_report_runs_id_fk" FOREIGN KEY ("report_run_id") REFERENCES "public"."report_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_scheduled_report_id_scheduled_reports_id_fk" FOREIGN KEY ("scheduled_report_id") REFERENCES "public"."scheduled_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_background_job_id_background_jobs_id_fk" FOREIGN KEY ("background_job_id") REFERENCES "public"."background_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_report_recipients" ADD CONSTRAINT "scheduled_report_recipients_scheduled_report_id_scheduled_reports_id_fk" FOREIGN KEY ("scheduled_report_id") REFERENCES "public"."scheduled_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_report_recipients" ADD CONSTRAINT "scheduled_report_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_items_open_uq" ON "action_items" USING btree ("organization_id","kind","entity_id") WHERE "action_items"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "action_items_open_idx" ON "action_items" USING btree ("organization_id","resolved_at","site_id");--> statement-breakpoint
CREATE INDEX "action_items_entity_idx" ON "action_items" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_definitions_org_code_uq" ON "report_definitions" USING btree ("organization_id","report_code");--> statement-breakpoint
CREATE INDEX "report_run_files_run_idx" ON "report_run_files" USING btree ("report_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_runs_org_key_uq" ON "report_runs" USING btree ("organization_id","run_key");--> statement-breakpoint
CREATE INDEX "report_runs_schedule_idx" ON "report_runs" USING btree ("scheduled_report_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_report_recipients_uq" ON "scheduled_report_recipients" USING btree ("scheduled_report_id","user_id");--> statement-breakpoint
CREATE INDEX "scheduled_reports_due_idx" ON "scheduled_reports" USING btree ("is_active","next_run_at");--> statement-breakpoint
CREATE INDEX "scheduled_reports_owner_idx" ON "scheduled_reports" USING btree ("owner_user_id");
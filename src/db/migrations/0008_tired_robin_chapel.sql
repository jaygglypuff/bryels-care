CREATE TABLE "kpi_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kpi_code" text NOT NULL,
	"version_no" integer NOT NULL,
	"name" text NOT NULL,
	"definition" text NOT NULL,
	"formula_text" text NOT NULL,
	"time_basis" text NOT NULL,
	"sources" jsonb NOT NULL,
	"refresh_class" text NOT NULL,
	"value_label" text NOT NULL,
	"unit" text NOT NULL,
	"aggregate" text NOT NULL,
	"drill_route" text NOT NULL,
	"permissions" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_kpi_definitions_label" CHECK ("kpi_definitions"."value_label" in ('actual','estimate','forecast','overridden')),
	CONSTRAINT "ck_kpi_definitions_refresh" CHECK ("kpi_definitions"."refresh_class" in ('post','live','mv15','night','wk')),
	CONSTRAINT "ck_kpi_definitions_version" CHECK ("kpi_definitions"."version_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE "kpi_reconciliation_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"refresh_log_id" uuid NOT NULL,
	"kpi_snapshot_id" uuid NOT NULL,
	"kpi_code" text NOT NULL,
	"scope_key" text NOT NULL,
	"grain" text NOT NULL,
	"period_start" date NOT NULL,
	"status" text NOT NULL,
	"snapshot_value" numeric(30, 10),
	"recomputed_value" numeric(30, 10),
	"snapshot_numerator" numeric(30, 10) NOT NULL,
	"recomputed_numerator" numeric(30, 10),
	"snapshot_denominator" numeric(30, 10),
	"recomputed_denominator" numeric(30, 10),
	"snapshot_row_count" integer NOT NULL,
	"recomputed_row_count" integer,
	"tolerance" numeric(30, 10) NOT NULL,
	"detail" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_kpi_reconciliation_results_status" CHECK ("kpi_reconciliation_results"."status" in ('match','mismatch'))
);
--> statement-breakpoint
CREATE TABLE "kpi_refresh_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"business_date" date NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"background_job_id" uuid,
	"snapshots_written" integer DEFAULT 0 NOT NULL,
	"checked" integer DEFAULT 0 NOT NULL,
	"mismatches" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ck_kpi_refresh_log_kind" CHECK ("kpi_refresh_log"."run_kind" in ('snapshot','reconcile')),
	CONSTRAINT "ck_kpi_refresh_log_status" CHECK ("kpi_refresh_log"."status" in ('running','succeeded','failed'))
);
--> statement-breakpoint
CREATE TABLE "kpi_saved_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_kpi_saved_views_name" CHECK (length(btrim("kpi_saved_views"."name")) between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "kpi_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kpi_code" text NOT NULL,
	"kpi_definition_id" uuid NOT NULL,
	"scope_key" text NOT NULL,
	"site_id" uuid,
	"site_ids" jsonb NOT NULL,
	"grain" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"as_of_date" date NOT NULL,
	"value" numeric(30, 10),
	"numerator" numeric(30, 10) NOT NULL,
	"denominator" numeric(30, 10),
	"row_count" integer NOT NULL,
	"value_label" text NOT NULL,
	"params" jsonb NOT NULL,
	"params_hash" text NOT NULL,
	"refresh_log_id" uuid,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_kpi_snapshots_grain" CHECK ("kpi_snapshots"."grain" in ('day','week','month')),
	CONSTRAINT "ck_kpi_snapshots_label" CHECK ("kpi_snapshots"."value_label" in ('actual','estimate','forecast','overridden')),
	CONSTRAINT "ck_kpi_snapshots_period" CHECK ("kpi_snapshots"."period_end" > "kpi_snapshots"."period_start"),
	CONSTRAINT "ck_kpi_snapshots_scope" CHECK (("kpi_snapshots"."scope_key" = 'all') = ("kpi_snapshots"."site_id" is null))
);
--> statement-breakpoint
ALTER TABLE "kpi_reconciliation_results" ADD CONSTRAINT "kpi_reconciliation_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_reconciliation_results" ADD CONSTRAINT "kpi_reconciliation_results_refresh_log_id_kpi_refresh_log_id_fk" FOREIGN KEY ("refresh_log_id") REFERENCES "public"."kpi_refresh_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_reconciliation_results" ADD CONSTRAINT "kpi_reconciliation_results_kpi_snapshot_id_kpi_snapshots_id_fk" FOREIGN KEY ("kpi_snapshot_id") REFERENCES "public"."kpi_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_refresh_log" ADD CONSTRAINT "kpi_refresh_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_refresh_log" ADD CONSTRAINT "kpi_refresh_log_background_job_id_background_jobs_id_fk" FOREIGN KEY ("background_job_id") REFERENCES "public"."background_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_saved_views" ADD CONSTRAINT "kpi_saved_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_saved_views" ADD CONSTRAINT "kpi_saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_kpi_definition_id_kpi_definitions_id_fk" FOREIGN KEY ("kpi_definition_id") REFERENCES "public"."kpi_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_refresh_log_id_kpi_refresh_log_id_fk" FOREIGN KEY ("refresh_log_id") REFERENCES "public"."kpi_refresh_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_definitions_code_version_uq" ON "kpi_definitions" USING btree ("kpi_code","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_definitions_code_checksum_uq" ON "kpi_definitions" USING btree ("kpi_code","checksum");--> statement-breakpoint
CREATE INDEX "kpi_reconciliation_results_run_idx" ON "kpi_reconciliation_results" USING btree ("refresh_log_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_reconciliation_results_run_snapshot_uq" ON "kpi_reconciliation_results" USING btree ("refresh_log_id","kpi_snapshot_id");--> statement-breakpoint
CREATE INDEX "kpi_refresh_log_org_kind_idx" ON "kpi_refresh_log" USING btree ("organization_id","run_kind","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_saved_views_user_name_uq" ON "kpi_saved_views" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_snapshots_idem_uq" ON "kpi_snapshots" USING btree ("organization_id","kpi_code","scope_key","grain","period_start","as_of_date","params_hash");--> statement-breakpoint
CREATE INDEX "kpi_snapshots_series_idx" ON "kpi_snapshots" USING btree ("organization_id","kpi_code","scope_key","grain","period_start");
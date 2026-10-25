CREATE TABLE "legal_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"hold_kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_label" text,
	"reason" text NOT NULL,
	"placed_by" uuid NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"release_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_legal_holds_kind" CHECK ("legal_holds"."hold_kind" in ('litigation','complaint','recall','audit','regulatory','other')),
	CONSTRAINT "ck_legal_holds_entity_type" CHECK ("legal_holds"."entity_type" in ('inventory_lot','batch','customer','complaint','sales_order','user')),
	CONSTRAINT "ck_legal_holds_release_sod" CHECK ("legal_holds"."released_by" is null or "legal_holds"."released_by" <> "legal_holds"."placed_by"),
	CONSTRAINT "ck_legal_holds_release_complete" CHECK (("legal_holds"."released_at" is null) = ("legal_holds"."released_by" is null) and ("legal_holds"."released_at" is null or "legal_holds"."release_note" is not null))
);
--> statement-breakpoint
CREATE TABLE "purge_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"trigger" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"requested_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"candidate_rows" integer DEFAULT 0 NOT NULL,
	"held_rows" integer DEFAULT 0 NOT NULL,
	"deleted_rows" integer DEFAULT 0 NOT NULL,
	"report" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_message" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_purge_runs_mode" CHECK ("purge_runs"."mode" in ('dry_run','execute')),
	CONSTRAINT "ck_purge_runs_trigger" CHECK ("purge_runs"."trigger" in ('manual','scheduled')),
	CONSTRAINT "ck_purge_runs_status" CHECK ("purge_runs"."status" in ('running','succeeded','failed')),
	CONSTRAINT "ck_purge_runs_dry_run_deletes_nothing" CHECK ("purge_runs"."mode" = 'execute' or "purge_runs"."deleted_rows" = 0)
);
--> statement-breakpoint
CREATE TABLE "restore_drills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"backup_run_id" uuid,
	"performed_at" timestamp with time zone NOT NULL,
	"performed_by" uuid NOT NULL,
	"witness_user_id" uuid,
	"target_environment" text NOT NULL,
	"source_key" text,
	"duration_seconds" integer NOT NULL,
	"measured_rto_seconds" integer NOT NULL,
	"dump_age_seconds" integer,
	"checksum_verified" boolean NOT NULL,
	"decrypt_succeeded" boolean NOT NULL,
	"row_counts_match" boolean,
	"migrations_current" boolean,
	"reconciliation_rows" integer,
	"result" text NOT NULL,
	"details" jsonb,
	"notes" text,
	"report_attachment_id" uuid,
	"signed_off_by" uuid,
	"signed_off_at" timestamp with time zone,
	"sign_off_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_restore_drills_result" CHECK ("restore_drills"."result" in ('passed','failed')),
	CONSTRAINT "ck_restore_drills_signoff_sod" CHECK ("restore_drills"."signed_off_by" is null or "restore_drills"."signed_off_by" <> "restore_drills"."performed_by"),
	CONSTRAINT "ck_restore_drills_signoff_complete" CHECK (("restore_drills"."signed_off_by" is null) = ("restore_drills"."signed_off_at" is null)),
	CONSTRAINT "ck_restore_drills_durations" CHECK ("restore_drills"."duration_seconds" >= 0 and "restore_drills"."measured_rto_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "retention_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"data_class" text NOT NULL,
	"target" text DEFAULT '*' NOT NULL,
	"retention_months" integer,
	"retention_days" integer,
	"basis" text NOT NULL,
	"minimum_months" integer,
	"action" text NOT NULL,
	"is_confirmed" boolean DEFAULT false NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"confirmation_note" text,
	"effective_from" date NOT NULL,
	"assumption_id" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_retention_policies_class" CHECK ("retention_policies"."data_class" in ('quality_batch','stock_ledger','financial','sales_customer','procurement','employee_personal','attendance','payroll','audit','identity','security','idempotency','sync','jobs_notifications','documents_generated','labels_generated','exports','attachments_other','backups','portal','master_data','master_data_shadow','platform_ops')),
	CONSTRAINT "ck_retention_policies_basis" CHECK ("retention_policies"."basis" in ('record_date','expiry_date','last_activity','employment_end','period_end','parent_record')),
	CONSTRAINT "ck_retention_policies_action" CHECK ("retention_policies"."action" in ('archive','anonymise','delete','keep')),
	CONSTRAINT "ck_retention_policies_period" CHECK (("retention_policies"."action" = 'keep') or (("retention_policies"."retention_months" is null) <> ("retention_policies"."retention_days" is null))),
	CONSTRAINT "ck_retention_policies_months_positive" CHECK ("retention_policies"."retention_months" is null or "retention_policies"."retention_months" > 0),
	CONSTRAINT "ck_retention_policies_days_positive" CHECK ("retention_policies"."retention_days" is null or "retention_policies"."retention_days" > 0),
	CONSTRAINT "ck_retention_policies_confirmed" CHECK ((not "retention_policies"."is_confirmed") or ("retention_policies"."confirmed_by" is not null and "retention_policies"."confirmed_at" is not null)),
	CONSTRAINT "ck_retention_policies_confirm_sod" CHECK ("retention_policies"."confirmed_by" is null or "retention_policies"."updated_by" is null or "retention_policies"."confirmed_by" <> "retention_policies"."updated_by")
);
--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_placed_by_users_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purge_runs" ADD CONSTRAINT "purge_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purge_runs" ADD CONSTRAINT "purge_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_drills" ADD CONSTRAINT "restore_drills_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_drills" ADD CONSTRAINT "restore_drills_backup_run_id_backup_runs_id_fk" FOREIGN KEY ("backup_run_id") REFERENCES "public"."backup_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_drills" ADD CONSTRAINT "restore_drills_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_drills" ADD CONSTRAINT "restore_drills_witness_user_id_users_id_fk" FOREIGN KEY ("witness_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_drills" ADD CONSTRAINT "restore_drills_signed_off_by_users_id_fk" FOREIGN KEY ("signed_off_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legal_holds_entity_active_idx" ON "legal_holds" USING btree ("entity_type","entity_id") WHERE "legal_holds"."released_at" is null;--> statement-breakpoint
CREATE INDEX "legal_holds_org_idx" ON "legal_holds" USING btree ("organization_id","placed_at");--> statement-breakpoint
CREATE INDEX "purge_runs_org_time_idx" ON "purge_runs" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "purge_runs_idem_uq" ON "purge_runs" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "restore_drills_org_time_idx" ON "restore_drills" USING btree ("organization_id","performed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_policies_class_target_uq" ON "retention_policies" USING btree ("organization_id","data_class","target");--> statement-breakpoint
CREATE INDEX "movements_source_doc_idx" ON "stock_movements" USING btree ("source_document_type","source_document_id");--> statement-breakpoint
CREATE INDEX "sales_order_lines_order_idx" ON "sales_order_lines" USING btree ("sales_order_id","line_no");
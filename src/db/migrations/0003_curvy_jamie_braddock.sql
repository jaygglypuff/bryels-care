CREATE TABLE "approval_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"document_type" text NOT NULL,
	"label" text NOT NULL,
	"threshold_basis" text DEFAULT 'always' NOT NULL,
	"min_value" numeric(18, 6),
	"max_value" numeric(18, 6),
	"currency" char(3),
	"step" integer DEFAULT 1 NOT NULL,
	"required_count" integer DEFAULT 1 NOT NULL,
	"required_role_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_permission_code" text,
	"poster_may_equal_approver" boolean DEFAULT false NOT NULL,
	"escalation_role_codes" jsonb,
	"escalation_after_hours" integer,
	"effective_from" date DEFAULT current_date NOT NULL,
	"effective_to" date,
	"source" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_approval_rules_document_type" CHECK ("approval_rules"."document_type" in ('purchase_request','purchase_order','sales_order','quote','stock_adjustment','stock_count_variance','expense_claim','invoice','supplier_bill','credit_note','payment_record','dispense_exception','over_shipment','formula_revision','routing_revision','routing_revision_sequencing','work_instruction_revision','inspection_plan','disposition_conditional_release','recall_case','batch_reopen','work_order_release','leave_request','overtime_request','payroll_period','period_lock_unlock','setting_change_request','retention_action','supplier_return','equipment_override','payroll_period_reopen')),
	CONSTRAINT "ck_approval_rules_basis" CHECK ("approval_rules"."threshold_basis" in ('always','amount','qty_base','variance_pct','discount_pct','credit_check_failed')),
	CONSTRAINT "ck_approval_rules_bounds" CHECK ("approval_rules"."min_value" is null or "approval_rules"."max_value" is null or "approval_rules"."min_value" <= "approval_rules"."max_value"),
	CONSTRAINT "ck_approval_rules_always_unbounded" CHECK ("approval_rules"."threshold_basis" <> 'always' or ("approval_rules"."min_value" is null and "approval_rules"."max_value" is null)),
	CONSTRAINT "ck_approval_rules_step" CHECK ("approval_rules"."step" >= 1 and "approval_rules"."required_count" >= 1),
	CONSTRAINT "ck_approval_rules_who" CHECK (jsonb_typeof("approval_rules"."required_role_codes") = 'array' and (jsonb_array_length("approval_rules"."required_role_codes") > 0 or "approval_rules"."required_permission_code" is not null)),
	CONSTRAINT "ck_approval_rules_escalation" CHECK (("approval_rules"."escalation_role_codes" is null) = ("approval_rules"."escalation_after_hours" is null)),
	CONSTRAINT "ck_approval_rules_escalation_hours" CHECK ("approval_rules"."escalation_after_hours" is null or "approval_rules"."escalation_after_hours" >= 1),
	CONSTRAINT "ck_approval_rules_dates" CHECK ("approval_rules"."effective_to" is null or "approval_rules"."effective_to" > "approval_rules"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"bucket_key" text,
	"offsite_bucket_key" text,
	"size_bytes" bigint,
	"checksum_sha256" text,
	"pg_version" text,
	"release_tag" text,
	"error_message" text,
	"triggered_by" uuid,
	"row_counts" jsonb,
	"hold" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_backup_runs_kind" CHECK ("backup_runs"."kind" in ('scheduled','manual')),
	CONSTRAINT "ck_backup_runs_status" CHECK ("backup_runs"."status" in ('running','succeeded','failed'))
);
--> statement-breakpoint
CREATE TABLE "metrics_samples" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"sampled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metric" text NOT NULL,
	"value" numeric(18, 6) NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "numbering_rule_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"scope" text DEFAULT 'organization' NOT NULL,
	"site_id" uuid,
	"version_no" integer NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"prefix" text NOT NULL,
	"pattern" text NOT NULL,
	"reset_period" text NOT NULL,
	"sequence_width" integer DEFAULT 5 NOT NULL,
	"is_gapless" boolean DEFAULT false NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"supersedes_id" uuid,
	"change_summary" text NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "numbering_rule_versions_no_uq" UNIQUE NULLS NOT DISTINCT("organization_id","document_type","site_id","version_no"),
	CONSTRAINT "ck_numbering_rule_versions_status" CHECK ("numbering_rule_versions"."status" in ('submitted','approved','rejected','cancelled')),
	CONSTRAINT "ck_numbering_rule_versions_scope" CHECK (("numbering_rule_versions"."scope" = 'organization' and "numbering_rule_versions"."site_id" is null) or ("numbering_rule_versions"."scope" = 'site' and "numbering_rule_versions"."site_id" is not null)),
	CONSTRAINT "ck_numbering_rule_versions_reset" CHECK ("numbering_rule_versions"."reset_period" in ('never','yearly','monthly','daily')),
	CONSTRAINT "ck_numbering_rule_versions_width" CHECK ("numbering_rule_versions"."sequence_width" between 1 and 12),
	CONSTRAINT "ck_numbering_rule_versions_prefix" CHECK ("numbering_rule_versions"."prefix" ~ '^[A-Z0-9]{1,8}$'),
	CONSTRAINT "ck_numbering_rule_versions_pattern_chars" CHECK ("numbering_rule_versions"."pattern" ~ '^([A-Z0-9._-]|\{(PREFIX|SITE|YYYY|YY|YYMM|YYMMDD|SEQ)\})+$'),
	CONSTRAINT "ck_numbering_rule_versions_pattern_seq" CHECK ((length("numbering_rule_versions"."pattern") - length(replace("numbering_rule_versions"."pattern", '{SEQ}', ''))) = 5),
	CONSTRAINT "ck_numbering_rule_versions_pattern_site" CHECK ("numbering_rule_versions"."scope" <> 'site' or position('{SITE}' in "numbering_rule_versions"."pattern") > 0),
	CONSTRAINT "ck_numbering_rule_versions_pattern_daily" CHECK ("numbering_rule_versions"."reset_period" <> 'daily' or position('{YYMMDD}' in "numbering_rule_versions"."pattern") > 0),
	CONSTRAINT "ck_numbering_rule_versions_pattern_monthly" CHECK ("numbering_rule_versions"."reset_period" <> 'monthly' or position('{YYMM}' in "numbering_rule_versions"."pattern") > 0),
	CONSTRAINT "ck_numbering_rule_versions_pattern_yearly" CHECK ("numbering_rule_versions"."reset_period" <> 'yearly' or "numbering_rule_versions"."pattern" ~ '\{(YYYY|YY|YYMM|YYMMDD)\}'),
	CONSTRAINT "ck_numbering_rule_versions_sod" CHECK ("numbering_rule_versions"."approved_by" is null or "numbering_rule_versions"."approved_by" <> "numbering_rule_versions"."submitted_by"),
	CONSTRAINT "ck_numbering_rule_versions_dates" CHECK ("numbering_rule_versions"."effective_to" is null or "numbering_rule_versions"."effective_to" > "numbering_rule_versions"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"tokens" numeric(12, 3) NOT NULL,
	"refilled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_allowed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_buckets_scope_key_uq" UNIQUE("scope","key")
);
--> statement-breakpoint
CREATE TABLE "setting_change_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"site_id" uuid,
	"user_id" uuid,
	"key" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"reason" text NOT NULL,
	"requires_approval" boolean NOT NULL,
	"status" text NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"cancelled_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_setting_change_requests_status" CHECK ("setting_change_requests"."status" in ('submitted','approved','rejected','applied','cancelled')),
	CONSTRAINT "ck_setting_change_requests_scope" CHECK ("setting_change_requests"."scope" in ('organization','site','user')),
	CONSTRAINT "ck_setting_change_requests_scope_target" CHECK (("setting_change_requests"."scope" = 'organization' and "setting_change_requests"."site_id" is null and "setting_change_requests"."user_id" is null)
       or ("setting_change_requests"."scope" = 'site' and "setting_change_requests"."site_id" is not null and "setting_change_requests"."user_id" is null)
       or ("setting_change_requests"."scope" = 'user' and "setting_change_requests"."user_id" is not null)),
	CONSTRAINT "ck_setting_change_requests_sod" CHECK ("setting_change_requests"."approved_by" is null or "setting_change_requests"."approved_by" <> "setting_change_requests"."submitted_by"),
	CONSTRAINT "ck_setting_change_requests_sod_reject" CHECK ("setting_change_requests"."rejected_by" is null or "setting_change_requests"."rejected_by" <> "setting_change_requests"."submitted_by"),
	CONSTRAINT "ck_setting_change_requests_applied_approved" CHECK (not ("setting_change_requests"."requires_approval" and "setting_change_requests"."status" = 'applied' and "setting_change_requests"."approved_by" is null)),
	CONSTRAINT "ck_setting_change_requests_applied_at" CHECK (("setting_change_requests"."status" = 'applied') = ("setting_change_requests"."applied_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "worker_heartbeats" ADD COLUMN "env_presence" jsonb;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_samples" ADD CONSTRAINT "metrics_samples_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "numbering_rule_versions" ADD CONSTRAINT "numbering_rule_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "numbering_rule_versions" ADD CONSTRAINT "numbering_rule_versions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "numbering_rule_versions" ADD CONSTRAINT "numbering_rule_versions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "numbering_rule_versions" ADD CONSTRAINT "numbering_rule_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "numbering_rule_versions" ADD CONSTRAINT "numbering_rule_versions_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_change_requests" ADD CONSTRAINT "setting_change_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_change_requests" ADD CONSTRAINT "setting_change_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_change_requests" ADD CONSTRAINT "setting_change_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_change_requests" ADD CONSTRAINT "setting_change_requests_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_change_requests" ADD CONSTRAINT "setting_change_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting_change_requests" ADD CONSTRAINT "setting_change_requests_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_rules_lookup_idx" ON "approval_rules" USING btree ("organization_id","document_type","site_id");--> statement-breakpoint
CREATE INDEX "backup_runs_org_time_idx" ON "backup_runs" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX "metrics_samples_metric_time_idx" ON "metrics_samples" USING btree ("organization_id","metric","sampled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "numbering_rule_versions_open_uq" ON "numbering_rule_versions" USING btree ("organization_id","document_type") WHERE "numbering_rule_versions"."status" = 'approved' and "numbering_rule_versions"."effective_to" is null and "numbering_rule_versions"."site_id" is null;--> statement-breakpoint
CREATE INDEX "numbering_rule_versions_lookup_idx" ON "numbering_rule_versions" USING btree ("organization_id","document_type","status");--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_refilled_idx" ON "rate_limit_buckets" USING btree ("refilled_at");--> statement-breakpoint
CREATE INDEX "setting_change_requests_status_idx" ON "setting_change_requests" USING btree ("organization_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "setting_change_requests_key_idx" ON "setting_change_requests" USING btree ("organization_id","key","created_at");
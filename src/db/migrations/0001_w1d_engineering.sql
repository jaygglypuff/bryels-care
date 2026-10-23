CREATE TABLE "approval_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"record_type" text NOT NULL,
	"record_id" uuid NOT NULL,
	"step" integer DEFAULT 1 NOT NULL,
	"decision" text NOT NULL,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_decisions_decision_ck" CHECK ("approval_decisions"."decision" in ('approved', 'rejected', 'returned')),
	CONSTRAINT "approval_decisions_step_ck" CHECK ("approval_decisions"."step" >= 1)
);
--> statement-breakpoint
CREATE TABLE "downtime_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"reason" text NOT NULL,
	"logged_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "downtime_range_ck" CHECK ("downtime_events"."ended_at" is null or "downtime_events"."ended_at" >= "downtime_events"."started_at")
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"equipment_kind" text NOT NULL,
	"line_label" text,
	"status" text DEFAULT 'in_service' NOT NULL,
	"calibration_interval_days" integer,
	"last_calibrated_date" date,
	"calibration_due_date" date,
	"maintenance_interval_days" integer,
	"last_maintained_date" date,
	"maintenance_due_date" date,
	"cleaning_status" text DEFAULT 'clean' NOT NULL,
	"last_cleaned_at" timestamp with time zone,
	"cleaning_rule" text DEFAULT 'per_batch' NOT NULL,
	"qualification_status" text DEFAULT 'not_required' NOT NULL,
	"blocking_rule" text DEFAULT 'block' NOT NULL,
	"capacity_min" numeric(18, 6),
	"capacity_max" numeric(18, 6),
	"capacity_uom" text,
	"responsible_user_id" uuid,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_code_ck" CHECK ("equipment"."code" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
	CONSTRAINT "equipment_kind_ck" CHECK ("equipment"."equipment_kind" in ('scale', 'mixer', 'heater', 'kettle', 'homogenizer', 'mould', 'cutter', 'filler', 'labeller', 'other')),
	CONSTRAINT "equipment_status_ck" CHECK ("equipment"."status" in ('in_service', 'maintenance', 'out_of_service')),
	CONSTRAINT "equipment_cleaning_status_ck" CHECK ("equipment"."cleaning_status" in ('clean', 'dirty', 'in_progress')),
	CONSTRAINT "equipment_cleaning_rule_ck" CHECK ("equipment"."cleaning_rule" in ('per_batch', 'per_changeover', 'none')),
	CONSTRAINT "equipment_qualification_ck" CHECK ("equipment"."qualification_status" in ('not_required', 'qualified', 'pending', 'failed')),
	CONSTRAINT "equipment_blocking_rule_ck" CHECK ("equipment"."blocking_rule" in ('block', 'warn', 'none')),
	CONSTRAINT "equipment_capacity_ck" CHECK ("equipment"."capacity_min" is null or "equipment"."capacity_max" is null or "equipment"."capacity_min" <= "equipment"."capacity_max"),
	CONSTRAINT "equipment_intervals_ck" CHECK (coalesce("equipment"."calibration_interval_days", 1) > 0 and coalesce("equipment"."maintenance_interval_days", 1) > 0)
);
--> statement-breakpoint
CREATE TABLE "equipment_override_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"reason" text NOT NULL,
	"availability_reasons" text[] NOT NULL,
	"work_reference" text,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_override_status_ck" CHECK ("equipment_override_requests"."status" in ('pending_approval', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "equipment_override_window_ck" CHECK ("equipment_override_requests"."valid_until" > "equipment_override_requests"."valid_from"),
	CONSTRAINT "equipment_override_sod_ck" CHECK ("equipment_override_requests"."approved_by" is null or "equipment_override_requests"."approved_by" <> "equipment_override_requests"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "equipment_service_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"service_kind" text NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"performed_by" uuid,
	"performed_by_external" text,
	"result" text NOT NULL,
	"next_due_date" date,
	"reference_number" text,
	"notes" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"supersedes_id" uuid,
	"correction_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_service_kind_ck" CHECK ("equipment_service_records"."service_kind" in ('cleaning', 'calibration', 'preventive_maintenance', 'repair', 'qualification', 'inspection')),
	CONSTRAINT "equipment_service_result_ck" CHECK ("equipment_service_records"."result" in ('pass', 'fail', 'completed')),
	CONSTRAINT "equipment_service_performer_ck" CHECK (num_nonnulls("equipment_service_records"."performed_by", "equipment_service_records"."performed_by_external") >= 1),
	CONSTRAINT "equipment_service_reviewer_ck" CHECK ("equipment_service_records"."reviewed_by" is null or "equipment_service_records"."reviewed_by" is distinct from "equipment_service_records"."performed_by"),
	CONSTRAINT "equipment_service_reviewer_creator_ck" CHECK ("equipment_service_records"."reviewed_by" is null or "equipment_service_records"."reviewed_by" <> "equipment_service_records"."created_by"),
	CONSTRAINT "equipment_service_correction_ck" CHECK ("equipment_service_records"."supersedes_id" is null or "equipment_service_records"."correction_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "equipment_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_plan_tests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inspection_plan_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"test_code" text NOT NULL,
	"name" text NOT NULL,
	"method" text,
	"value_kind" text NOT NULL,
	"uom" text,
	"spec_min" numeric(18, 6),
	"spec_max" numeric(18, 6),
	"spec_text" text,
	"is_required" boolean DEFAULT true NOT NULL,
	CONSTRAINT "inspection_plan_tests_kind_ck" CHECK ("inspection_plan_tests"."value_kind" in ('numeric', 'text', 'pass_fail')),
	CONSTRAINT "inspection_plan_tests_range_ck" CHECK ("inspection_plan_tests"."spec_min" is null or "inspection_plan_tests"."spec_max" is null or "inspection_plan_tests"."spec_min" <= "inspection_plan_tests"."spec_max"),
	CONSTRAINT "inspection_plan_tests_numeric_ck" CHECK ("inspection_plan_tests"."value_kind" <> 'numeric' or ("inspection_plan_tests"."uom" is not null and num_nonnulls("inspection_plan_tests"."spec_min", "inspection_plan_tests"."spec_max") >= 1))
);
--> statement-breakpoint
CREATE TABLE "inspection_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"plan_kind" text NOT NULL,
	"product_id" uuid,
	"material_id" uuid,
	"sampling_instructions" text,
	"is_placeholder" boolean DEFAULT false NOT NULL,
	"revision_no" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"supersedes_id" uuid,
	"change_summary" text,
	"created_by" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspection_plans_status_ck" CHECK (status in ('draft', 'pending_approval', 'approved', 'rejected', 'retired')),
	CONSTRAINT "inspection_plans_kind_ck" CHECK ("inspection_plans"."plan_kind" in ('incoming', 'in_process', 'finished_product')),
	CONSTRAINT "inspection_plans_subject_ck" CHECK (("inspection_plans"."plan_kind" = 'incoming' and "inspection_plans"."material_id" is not null and "inspection_plans"."product_id" is null) or ("inspection_plans"."plan_kind" <> 'incoming' and "inspection_plans"."product_id" is not null and "inspection_plans"."material_id" is null)),
	CONSTRAINT "inspection_plans_sod_ck" CHECK ("inspection_plans"."approved_by" is null or "inspection_plans"."approved_by" is distinct from "inspection_plans"."submitted_by"),
	CONSTRAINT "inspection_plans_effective_ck" CHECK ("inspection_plans"."status" not in ('approved', 'retired') or ("inspection_plans"."effective_from" is not null and "inspection_plans"."approved_by" is not null)),
	CONSTRAINT "inspection_plans_range_ck" CHECK ("inspection_plans"."effective_to" is null or "inspection_plans"."effective_from" is null or "inspection_plans"."effective_to" > "inspection_plans"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "routing_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"routing_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"supersedes_id" uuid,
	"change_scope" text,
	"change_summary" text,
	"notes" text,
	"created_by" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routing_rev_status_ck" CHECK (status in ('draft', 'pending_approval', 'approved', 'rejected', 'retired')),
	CONSTRAINT "routing_rev_scope_ck" CHECK ("routing_revisions"."change_scope" is null or "routing_revisions"."change_scope" in ('sequencing_only', 'quality_relevant')),
	CONSTRAINT "routing_rev_sod_ck" CHECK ("routing_revisions"."approved_by" is null or "routing_revisions"."approved_by" is distinct from "routing_revisions"."submitted_by"),
	CONSTRAINT "routing_rev_effective_ck" CHECK ("routing_revisions"."status" not in ('approved', 'retired') or ("routing_revisions"."effective_from" is not null and "routing_revisions"."approved_by" is not null)),
	CONSTRAINT "routing_rev_range_ck" CHECK ("routing_revisions"."effective_to" is null or "routing_revisions"."effective_from" is null or "routing_revisions"."effective_to" > "routing_revisions"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "routing_step_checklist_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"routing_step_id" uuid NOT NULL,
	"item_no" integer NOT NULL,
	"text" text NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"is_blocking" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_step_parameters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"routing_step_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"value_kind" text NOT NULL,
	"uom" text,
	"min_value" numeric(18, 6),
	"target_value" numeric(18, 6),
	"max_value" numeric(18, 6),
	"is_required" boolean DEFAULT true NOT NULL,
	CONSTRAINT "routing_step_params_kind_ck" CHECK ("routing_step_parameters"."value_kind" in ('numeric', 'text', 'boolean')),
	CONSTRAINT "routing_step_params_range_ck" CHECK ("routing_step_parameters"."min_value" is null or "routing_step_parameters"."max_value" is null or "routing_step_parameters"."min_value" <= "routing_step_parameters"."max_value"),
	CONSTRAINT "routing_step_params_target_ck" CHECK ("routing_step_parameters"."target_value" is null or (("routing_step_parameters"."min_value" is null or "routing_step_parameters"."min_value" <= "routing_step_parameters"."target_value") and ("routing_step_parameters"."max_value" is null or "routing_step_parameters"."target_value" <= "routing_step_parameters"."max_value"))),
	CONSTRAINT "routing_step_params_numeric_ck" CHECK ("routing_step_parameters"."value_kind" <> 'numeric' or "routing_step_parameters"."uom" is not null)
);
--> statement-breakpoint
CREATE TABLE "routings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_instruction_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_instruction_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"body_markdown" text NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"supersedes_id" uuid,
	"change_summary" text,
	"created_by" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wi_rev_status_ck" CHECK (status in ('draft', 'pending_approval', 'approved', 'rejected', 'retired')),
	CONSTRAINT "wi_rev_sod_ck" CHECK ("work_instruction_revisions"."approved_by" is null or "work_instruction_revisions"."approved_by" is distinct from "work_instruction_revisions"."submitted_by"),
	CONSTRAINT "wi_rev_effective_ck" CHECK ("work_instruction_revisions"."status" not in ('approved', 'retired') or ("work_instruction_revisions"."effective_from" is not null and "work_instruction_revisions"."approved_by" is not null)),
	CONSTRAINT "wi_rev_range_ck" CHECK ("work_instruction_revisions"."effective_to" is null or "work_instruction_revisions"."effective_from" is null or "work_instruction_revisions"."effective_to" > "work_instruction_revisions"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "work_instructions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bom_lines" ALTER COLUMN "tolerance_pct" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "routing_steps" ALTER COLUMN "formula_revision_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "tolerance_abs_g" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "phase_code" text;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "scaling" text DEFAULT 'proportional' NOT NULL;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "is_critical" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "requires_checker" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD COLUMN "effective_from" date;--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD COLUMN "effective_to" date;--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD COLUMN "supersedes_id" uuid;--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD COLUMN "change_summary" text;--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD COLUMN "approval_note" text;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD COLUMN "routing_revision_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD COLUMN "area" text;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD COLUMN "work_instruction_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD COLUMN "inspection_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD COLUMN "blocks_until_complete" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD COLUMN "requires_equipment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD COLUMN "equipment_kind" text;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD COLUMN "record_mode" text DEFAULT 'electronic' NOT NULL;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD COLUMN "min_duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD COLUMN "expected_duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "batch_materials" ADD COLUMN "tolerance_abs_g" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "routing_revision_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "inspection_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downtime_events" ADD CONSTRAINT "downtime_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downtime_events" ADD CONSTRAINT "downtime_events_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downtime_events" ADD CONSTRAINT "downtime_events_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downtime_events" ADD CONSTRAINT "downtime_events_logged_by_users_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_override_requests" ADD CONSTRAINT "equipment_override_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_override_requests" ADD CONSTRAINT "equipment_override_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_override_requests" ADD CONSTRAINT "equipment_override_requests_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_override_requests" ADD CONSTRAINT "equipment_override_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_override_requests" ADD CONSTRAINT "equipment_override_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_service_records" ADD CONSTRAINT "equipment_service_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_service_records" ADD CONSTRAINT "equipment_service_records_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_service_records" ADD CONSTRAINT "equipment_service_records_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_service_records" ADD CONSTRAINT "equipment_service_records_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_service_records" ADD CONSTRAINT "equipment_service_records_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_service_records" ADD CONSTRAINT "equipment_service_records_supersedes_id_equipment_service_records_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."equipment_service_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_service_records" ADD CONSTRAINT "equipment_service_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_state_transitions" ADD CONSTRAINT "equipment_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_state_transitions" ADD CONSTRAINT "equipment_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_state_transitions" ADD CONSTRAINT "equipment_state_transitions_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_state_transitions" ADD CONSTRAINT "equipment_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plan_tests" ADD CONSTRAINT "inspection_plan_tests_inspection_plan_id_inspection_plans_id_fk" FOREIGN KEY ("inspection_plan_id") REFERENCES "public"."inspection_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_supersedes_id_inspection_plans_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."inspection_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_plans" ADD CONSTRAINT "inspection_plans_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_revisions" ADD CONSTRAINT "routing_revisions_routing_id_routings_id_fk" FOREIGN KEY ("routing_id") REFERENCES "public"."routings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_revisions" ADD CONSTRAINT "routing_revisions_supersedes_id_routing_revisions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."routing_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_revisions" ADD CONSTRAINT "routing_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_revisions" ADD CONSTRAINT "routing_revisions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_revisions" ADD CONSTRAINT "routing_revisions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_step_checklist_items" ADD CONSTRAINT "routing_step_checklist_items_routing_step_id_routing_steps_id_fk" FOREIGN KEY ("routing_step_id") REFERENCES "public"."routing_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_step_parameters" ADD CONSTRAINT "routing_step_parameters_routing_step_id_routing_steps_id_fk" FOREIGN KEY ("routing_step_id") REFERENCES "public"."routing_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routings" ADD CONSTRAINT "routings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routings" ADD CONSTRAINT "routings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routings" ADD CONSTRAINT "routings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_instruction_revisions" ADD CONSTRAINT "work_instruction_revisions_work_instruction_id_work_instructions_id_fk" FOREIGN KEY ("work_instruction_id") REFERENCES "public"."work_instructions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_instruction_revisions" ADD CONSTRAINT "work_instruction_revisions_supersedes_id_work_instruction_revisions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."work_instruction_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_instruction_revisions" ADD CONSTRAINT "work_instruction_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_instruction_revisions" ADD CONSTRAINT "work_instruction_revisions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_instruction_revisions" ADD CONSTRAINT "work_instruction_revisions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_instructions" ADD CONSTRAINT "work_instructions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_instructions" ADD CONSTRAINT "work_instructions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_decisions_step_user_uq" ON "approval_decisions" USING btree ("record_type","record_id","step","decided_by");--> statement-breakpoint
CREATE INDEX "approval_decisions_record_idx" ON "approval_decisions" USING btree ("record_type","record_id");--> statement-breakpoint
CREATE INDEX "downtime_site_started_idx" ON "downtime_events" USING btree ("site_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "downtime_one_open_uq" ON "downtime_events" USING btree ("equipment_id") WHERE "downtime_events"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_org_code_uq" ON "equipment" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "equipment_site_idx" ON "equipment" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "equipment_override_eq_idx" ON "equipment_override_requests" USING btree ("equipment_id","status");--> statement-breakpoint
CREATE INDEX "equipment_service_site_eq_idx" ON "equipment_service_records" USING btree ("site_id","equipment_id","performed_at");--> statement-breakpoint
CREATE INDEX "equipment_transitions_eq_idx" ON "equipment_state_transitions" USING btree ("equipment_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_plan_tests_code_uq" ON "inspection_plan_tests" USING btree ("inspection_plan_id","test_code");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_plans_code_rev_uq" ON "inspection_plans" USING btree ("organization_id","code","revision_no");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_plans_one_open_uq" ON "inspection_plans" USING btree ("organization_id","code") WHERE "inspection_plans"."status" in ('draft', 'pending_approval');--> statement-breakpoint
CREATE INDEX "inspection_plans_product_idx" ON "inspection_plans" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "inspection_plans_material_idx" ON "inspection_plans" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "routing_rev_uq" ON "routing_revisions" USING btree ("routing_id","revision_no");--> statement-breakpoint
CREATE UNIQUE INDEX "routing_rev_one_open_uq" ON "routing_revisions" USING btree ("routing_id") WHERE "routing_revisions"."status" in ('draft', 'pending_approval');--> statement-breakpoint
CREATE UNIQUE INDEX "routing_step_checklist_item_uq" ON "routing_step_checklist_items" USING btree ("routing_step_id","item_no");--> statement-breakpoint
CREATE UNIQUE INDEX "routing_step_params_code_uq" ON "routing_step_parameters" USING btree ("routing_step_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "routings_org_code_uq" ON "routings" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "routings_product_idx" ON "routings" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wi_rev_uq" ON "work_instruction_revisions" USING btree ("work_instruction_id","revision_no");--> statement-breakpoint
CREATE UNIQUE INDEX "wi_rev_one_open_uq" ON "work_instruction_revisions" USING btree ("work_instruction_id") WHERE "work_instruction_revisions"."status" in ('draft', 'pending_approval');--> statement-breakpoint
CREATE UNIQUE INDEX "work_instructions_org_code_uq" ON "work_instructions" USING btree ("organization_id","code");--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD CONSTRAINT "formula_revisions_supersedes_id_formula_revisions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."formula_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD CONSTRAINT "formula_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_routing_revision_id_routing_revisions_id_fk" FOREIGN KEY ("routing_revision_id") REFERENCES "public"."routing_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_work_instruction_revision_id_work_instruction_revisions_id_fk" FOREIGN KEY ("work_instruction_revision_id") REFERENCES "public"."work_instruction_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_inspection_plan_id_inspection_plans_id_fk" FOREIGN KEY ("inspection_plan_id") REFERENCES "public"."inspection_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_routing_revision_id_routing_revisions_id_fk" FOREIGN KEY ("routing_revision_id") REFERENCES "public"."routing_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_inspection_plan_id_inspection_plans_id_fk" FOREIGN KEY ("inspection_plan_id") REFERENCES "public"."inspection_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bom_lines_rev_line_uq" ON "bom_lines" USING btree ("formula_revision_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "formula_rev_one_open_uq" ON "formula_revisions" USING btree ("formula_id") WHERE "formula_revisions"."status" in ('draft', 'pending_approval');--> statement-breakpoint
CREATE UNIQUE INDEX "routing_steps_rev_step_uq" ON "routing_steps" USING btree ("routing_revision_id","step_no");--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_tolerance_one_ck" CHECK (num_nonnulls("bom_lines"."tolerance_pct", "bom_lines"."tolerance_abs_g") = 1);--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_tolerance_non_negative_ck" CHECK (coalesce("bom_lines"."tolerance_pct", 0) >= 0 and coalesce("bom_lines"."tolerance_abs_g", 0) >= 0);--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_qty_ck" CHECK ("bom_lines"."quantity_g" > 0);--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_scaling_ck" CHECK ("bom_lines"."scaling" in ('proportional', 'fixed'));--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD CONSTRAINT "formula_rev_status_ck" CHECK ("formula_revisions"."status" in ('draft', 'pending_approval', 'approved', 'rejected', 'retired'));--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD CONSTRAINT "formula_rev_sod_ck" CHECK ("formula_revisions"."approved_by" is null or "formula_revisions"."approved_by" is distinct from "formula_revisions"."submitted_by");--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD CONSTRAINT "formula_rev_effective_ck" CHECK ("formula_revisions"."status" not in ('approved', 'retired') or ("formula_revisions"."effective_from" is not null and "formula_revisions"."approved_by" is not null));--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD CONSTRAINT "formula_rev_range_ck" CHECK ("formula_revisions"."effective_to" is null or "formula_revisions"."effective_from" is null or "formula_revisions"."effective_to" > "formula_revisions"."effective_from");--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD CONSTRAINT "formula_rev_size_ck" CHECK ("formula_revisions"."reference_batch_size_g" > 0);--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD CONSTRAINT "formula_rev_yield_ck" CHECK ("formula_revisions"."theoretical_yield_pct" > 0 and "formula_revisions"."theoretical_yield_pct" <= 100);--> statement-breakpoint
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_kind_ck" CHECK ("routing_steps"."step_kind" in ('line_clearance', 'dispensing', 'process', 'in_process_qc', 'filling', 'cutting', 'curing', 'hold', 'packaging', 'reconciliation', 'transfer', 'checklist'));--> statement-breakpoint
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_area_ck" CHECK ("routing_steps"."area" is null or "routing_steps"."area" in ('weighing', 'production', 'packaging', 'filling', 'other'));--> statement-breakpoint
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_clearance_area_ck" CHECK ("routing_steps"."step_kind" <> 'line_clearance' or "routing_steps"."area" is not null);--> statement-breakpoint
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_record_mode_ck" CHECK ("routing_steps"."record_mode" in ('electronic', 'paper_then_transcribe', 'paper_only'));--> statement-breakpoint
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_durations_ck" CHECK (coalesce("routing_steps"."min_duration_minutes", 1) > 0 and coalesce("routing_steps"."expected_duration_minutes", 1) > 0);--> statement-breakpoint
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_equipment_ck" CHECK (not "routing_steps"."requires_equipment" or "routing_steps"."equipment_kind" is not null);
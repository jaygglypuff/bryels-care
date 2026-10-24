CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_code_ck" CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "production_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"department_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_lines_status_ck" CHECK ("production_lines"."status" in ('active', 'down', 'inactive')),
	CONSTRAINT "production_lines_code_ck" CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "reason_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"applies_to" text[] NOT NULL,
	"requires_note" boolean DEFAULT false NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reason_codes_code_ck" CHECK ("reason_codes"."code" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "reason_codes_applies_to_ck" CHECK (cardinality(applies_to) >= 1 and applies_to <@ array['adjustment', 'transfer', 'receipt', 'disposition', 'sample', 'scrap', 'rework', 'return', 'count_variance', 'hold', 'reprint', 'deviation', 'reversal', 'exception', 'cancel', 'downtime', 'audit']::text[])
);
--> statement-breakpoint
CREATE TABLE "skus" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"variant_label" text,
	"pack_format" text,
	"net_content_qty" numeric(18, 6),
	"net_content_uom_id" uuid,
	"uom_base_id" uuid NOT NULL,
	"units_per_box" integer,
	"boxes_per_pallet" integer,
	"gtin" text,
	"shelf_life_days" integer,
	"retest_days" integer,
	"storage_conditions" text,
	"allocation_rule" text DEFAULT 'fefo' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skus_code_ck" CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
	CONSTRAINT "skus_status_ck" CHECK ("skus"."status" in ('draft', 'active', 'discontinued')),
	CONSTRAINT "skus_allocation_ck" CHECK ("skus"."allocation_rule" in ('fefo', 'fifo')),
	CONSTRAINT "skus_pack_ck" CHECK (coalesce("skus"."units_per_box", 1) > 0 and coalesce("skus"."boxes_per_pallet", 1) > 0),
	CONSTRAINT "skus_days_ck" CHECK (coalesce("skus"."shelf_life_days", 1) > 0 and coalesce("skus"."retest_days", 1) > 0),
	CONSTRAINT "skus_net_content_ck" CHECK ("skus"."net_content_qty" is null or ("skus"."net_content_qty" > 0 and "skus"."net_content_uom_id" is not null)),
	CONSTRAINT "skus_gtin_ck" CHECK ("skus"."gtin" is null or "skus"."gtin" ~ '^[0-9]{8,14}$')
);
--> statement-breakpoint
CREATE TABLE "uom_conversions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"from_uom_id" uuid NOT NULL,
	"to_uom_id" uuid NOT NULL,
	"factor" numeric(24, 12) NOT NULL,
	"material_id" uuid,
	"revision_no" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"supersedes_id" uuid,
	"change_reason" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"decision_note" text,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uom_conv_factor_ck" CHECK ("uom_conversions"."factor" > 0),
	CONSTRAINT "uom_conv_distinct_ck" CHECK ("uom_conversions"."from_uom_id" <> "uom_conversions"."to_uom_id"),
	CONSTRAINT "uom_conv_status_ck" CHECK ("uom_conversions"."status" in ('pending_approval', 'approved', 'rejected', 'retired')),
	CONSTRAINT "uom_conv_sod_ck" CHECK ("uom_conversions"."approved_by" is null or "uom_conversions"."approved_by" is distinct from "uom_conversions"."submitted_by"),
	CONSTRAINT "uom_conv_approved_ck" CHECK ("uom_conversions"."status" not in ('approved', 'retired') or ("uom_conversions"."approved_at" is not null and ("uom_conversions"."approved_by" is not null or "uom_conversions"."is_system")))
);
--> statement-breakpoint
CREATE TABLE "uoms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"dimension" text NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uoms_dimension_ck" CHECK ("uoms"."dimension" in ('mass', 'volume', 'count', 'length')),
	CONSTRAINT "uoms_code_ck" CHECK ("uoms"."code" ~ '^[A-Za-z][A-Za-z0-9_]{0,15}$')
);
--> statement-breakpoint
CREATE TABLE "warehouse_special_locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"role" text NOT NULL,
	"location_id" uuid NOT NULL,
	"designated_by" uuid,
	"designated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_special_locations_role_ck" CHECK ("warehouse_special_locations"."role" in ('receiving', 'staging', 'quarantine', 'hold', 'rejected', 'recall'))
);
--> statement-breakpoint
CREATE TABLE "batch_outputs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"output_kind" text NOT NULL,
	"product_id" uuid,
	"material_id" uuid,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"mass_g" numeric(18, 6),
	"to_location_id" uuid NOT NULL,
	"lot_id" uuid,
	"production_posting_id" uuid,
	"recorded_by" uuid NOT NULL,
	"checked_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_outputs_kind_ck" CHECK ("batch_outputs"."output_kind" in ('finished', 'intermediate', 'by_product', 'sample')),
	CONSTRAINT "batch_outputs_item_ck" CHECK (num_nonnulls("batch_outputs"."product_id", "batch_outputs"."material_id") = 1),
	CONSTRAINT "batch_outputs_qty_ck" CHECK ("batch_outputs"."qty_base" > 0),
	CONSTRAINT "batch_outputs_sod_ck" CHECK ("batch_outputs"."checked_by" is null or "batch_outputs"."checked_by" <> "batch_outputs"."recorded_by")
);
--> statement-breakpoint
CREATE TABLE "equipment_uses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"process_step_record_id" uuid,
	"operator_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"status_at_start" text NOT NULL,
	"cleaning_status_at_start" text NOT NULL,
	"calibration_due_date_at_use" date,
	"maintenance_due_date_at_use" date,
	"availability_reasons" text[],
	"override_request_id" uuid,
	"exception_approved_by" uuid,
	"exception_reason" text,
	"deviation_id" uuid,
	CONSTRAINT "equipment_uses_range_ck" CHECK ("equipment_uses"."ended_at" is null or "equipment_uses"."ended_at" >= "equipment_uses"."started_at"),
	CONSTRAINT "equipment_uses_override_ck" CHECK (("equipment_uses"."override_request_id" is null) = ("equipment_uses"."exception_approved_by" is null) and ("equipment_uses"."exception_approved_by" is null or "equipment_uses"."exception_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "packaging_reconciliations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"process_step_record_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"from_location_id" uuid NOT NULL,
	"base_uom" text NOT NULL,
	"issued_qty" numeric(18, 6) NOT NULL,
	"used_qty" numeric(18, 6),
	"damaged_qty" numeric(18, 6),
	"returned_qty" numeric(18, 6),
	"variance_qty" numeric(18, 6),
	"tolerance_qty" numeric(18, 6),
	"is_within_tolerance" boolean,
	"issued_by" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"counted_by" uuid,
	"counted_at" timestamp with time zone,
	"supersedes_id" uuid,
	"correction_reason" text,
	"voided_at" timestamp with time zone,
	"production_posting_id" uuid,
	"deviation_id" uuid,
	CONSTRAINT "packaging_reconciliations_issued_ck" CHECK ("packaging_reconciliations"."issued_qty" > 0),
	CONSTRAINT "packaging_reconciliations_nonneg_ck" CHECK (coalesce("packaging_reconciliations"."used_qty", 0) >= 0 and coalesce("packaging_reconciliations"."damaged_qty", 0) >= 0 and coalesce("packaging_reconciliations"."returned_qty", 0) >= 0),
	CONSTRAINT "packaging_reconciliations_returned_ck" CHECK (coalesce("packaging_reconciliations"."returned_qty", 0) <= "packaging_reconciliations"."issued_qty"),
	CONSTRAINT "packaging_reconciliations_correction_ck" CHECK ("packaging_reconciliations"."supersedes_id" is null or "packaging_reconciliations"."correction_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "process_step_checklist_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"process_step_record_id" uuid NOT NULL,
	"routing_step_checklist_item_id" uuid NOT NULL,
	"item_no" integer NOT NULL,
	"item_text" text NOT NULL,
	"is_blocking" boolean NOT NULL,
	"answer" text NOT NULL,
	"note" text,
	"photo_attachment_id" uuid,
	"answered_by" uuid NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"supersedes_id" uuid,
	CONSTRAINT "checklist_results_answer_ck" CHECK ("process_step_checklist_results"."answer" in ('yes', 'no', 'na')),
	CONSTRAINT "checklist_results_no_note_ck" CHECK ("process_step_checklist_results"."answer" <> 'no' or "process_step_checklist_results"."note" is not null)
);
--> statement-breakpoint
CREATE TABLE "process_step_readings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"process_step_record_id" uuid NOT NULL,
	"routing_step_parameter_id" uuid NOT NULL,
	"parameter_code" text NOT NULL,
	"parameter_name" text NOT NULL,
	"value_kind" text NOT NULL,
	"uom" text,
	"min_value" numeric(18, 6),
	"target_value" numeric(18, 6),
	"max_value" numeric(18, 6),
	"value_numeric" numeric(18, 6),
	"value_text" text,
	"value_boolean" boolean,
	"is_within_limits" boolean NOT NULL,
	"equipment_id" uuid,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"supersedes_id" uuid,
	"correction_reason" text,
	CONSTRAINT "step_readings_one_value_ck" CHECK (num_nonnulls("process_step_readings"."value_numeric", "process_step_readings"."value_text", "process_step_readings"."value_boolean") = 1),
	CONSTRAINT "step_readings_kind_ck" CHECK ("process_step_readings"."value_kind" in ('numeric', 'text', 'boolean')),
	CONSTRAINT "step_readings_correction_ck" CHECK ("process_step_readings"."supersedes_id" is null or "process_step_readings"."correction_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "production_postings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"posting_type" text NOT NULL,
	"batch_material_id" uuid,
	"dispense_record_id" uuid,
	"packaging_reconciliation_id" uuid,
	"batch_output_id" uuid,
	"process_step_record_id" uuid,
	"lot_id" uuid NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"stock_movement_id" uuid NOT NULL,
	"reversal_of_id" uuid,
	"posted_by" uuid NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_postings_type_ck" CHECK ("production_postings"."posting_type" in ('consumption', 'output', 'scrap', 'rework_return', 'reversal')),
	CONSTRAINT "production_postings_reversal_ck" CHECK (("production_postings"."posting_type" = 'reversal') = ("production_postings"."reversal_of_id" is not null)),
	CONSTRAINT "production_postings_qty_ck" CHECK ("production_postings"."qty_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "scrap_rework_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"record_kind" text NOT NULL,
	"reason_code" text NOT NULL,
	"qty" numeric(18, 6) NOT NULL,
	"uom" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'recorded' NOT NULL,
	"requires_approval" boolean NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"production_posting_id" uuid,
	"voided_at" timestamp with time zone,
	CONSTRAINT "scrap_rework_kind_ck" CHECK ("scrap_rework_records"."record_kind" in ('scrap', 'rework')),
	CONSTRAINT "scrap_rework_status_ck" CHECK ("scrap_rework_records"."status" in ('recorded', 'approved', 'rejected')),
	CONSTRAINT "scrap_rework_qty_ck" CHECK ("scrap_rework_records"."qty" > 0),
	CONSTRAINT "scrap_rework_sod_ck" CHECK ("scrap_rework_records"."decided_by" is null or "scrap_rework_records"."decided_by" <> "scrap_rework_records"."recorded_by")
);
--> statement-breakpoint
CREATE TABLE "yield_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"theoretical_base" numeric(18, 6) NOT NULL,
	"actual_base" numeric(18, 6) NOT NULL,
	"actual_units" numeric(18, 6) NOT NULL,
	"variance_base" numeric(18, 6) NOT NULL,
	"yield_pct" numeric(18, 6) NOT NULL,
	"variance_pct" numeric(18, 6) NOT NULL,
	"min_pct" numeric(18, 6) NOT NULL,
	"max_pct" numeric(18, 6) NOT NULL,
	"is_within_limits" boolean NOT NULL,
	"labels_issued" integer,
	"labels_used" integer,
	"labels_destroyed" integer,
	"notes" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_reason" text,
	"deviation_id" uuid,
	"is_current" boolean DEFAULT true NOT NULL,
	"supersedes_id" uuid,
	"correction_reason" text,
	CONSTRAINT "yield_records_sod_ck" CHECK ("yield_records"."approved_by" is null or "yield_records"."approved_by" <> "yield_records"."recorded_by"),
	CONSTRAINT "yield_records_correction_ck" CHECK ("yield_records"."supersedes_id" is null or "yield_records"."correction_reason" is not null),
	CONSTRAINT "yield_records_labels_ck" CHECK ("yield_records"."labels_issued" is null or coalesce("yield_records"."labels_used", 0) + coalesce("yield_records"."labels_destroyed", 0) <= "yield_records"."labels_issued")
);
--> statement-breakpoint
CREATE TABLE "deviation_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deviation_id" uuid NOT NULL,
	"quality_hold_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deviation_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"deviation_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deviations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"deviation_number" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"severity" text,
	"description" text NOT NULL,
	"step_ref" text,
	"batch_id" uuid,
	"lot_id" uuid,
	"process_step_record_id" uuid,
	"dispense_record_id" uuid,
	"inspection_id" uuid,
	"test_result_id" uuid,
	"raised_by" uuid NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"classified_by" uuid,
	"classified_at" timestamp with time zone,
	"investigation" text,
	"impact_assessment" text,
	"root_cause" text,
	"resolution" text,
	"release_permitted" boolean,
	"effectiveness_check_on" date,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_deviations_status" CHECK ("deviations"."status" in ('open','investigating','closed')),
	CONSTRAINT "ck_deviations_source" CHECK ("deviations"."source" in ('manual','cx_tol','cx_cal','in_process_check','yield','reconciliation','oos','other')),
	CONSTRAINT "ck_deviations_subject" CHECK (num_nonnulls("deviations"."batch_id", "deviations"."lot_id") >= 1),
	CONSTRAINT "ck_deviations_closed" CHECK (("deviations"."status" = 'closed') = ("deviations"."closed_by" is not null and "deviations"."closed_at" is not null and "deviations"."root_cause" is not null and "deviations"."resolution" is not null and "deviations"."release_permitted" is not null and "deviations"."severity" is not null)),
	CONSTRAINT "ck_deviations_closer_not_raiser" CHECK ("deviations"."closed_by" is null or "deviations"."closed_by" <> "deviations"."raised_by")
);
--> statement-breakpoint
CREATE TABLE "disposition_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"decision" text DEFAULT 'conditional_release' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"conditions" text NOT NULL,
	"review_date" date NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"disposition_id" uuid,
	CONSTRAINT "ck_disposition_requests_status" CHECK ("disposition_requests"."status" in ('pending','approved','rejected','cancelled')),
	CONSTRAINT "ck_disposition_requests_decision" CHECK ("disposition_requests"."decision" in ('conditional_release')),
	CONSTRAINT "ck_disposition_requests_sod" CHECK ("disposition_requests"."decided_by" is null or "disposition_requests"."decided_by" <> "disposition_requests"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "inspection_samples" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"inspection_id" uuid NOT NULL,
	"sample_no" integer NOT NULL,
	"lot_id" uuid NOT NULL,
	"container_id" uuid,
	"from_location_id" uuid NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"note" text,
	"sampled_by" uuid NOT NULL,
	"sampled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumption_movement_id" uuid,
	"idempotency_key" text,
	CONSTRAINT "ck_inspection_samples_qty" CHECK ("inspection_samples"."qty_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "inspection_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"inspection_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"inspection_number" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"inspection_kind" text NOT NULL,
	"inspection_plan_id" uuid NOT NULL,
	"lot_id" uuid,
	"batch_id" uuid,
	"process_step_record_id" uuid,
	"sampled_at" timestamp with time zone,
	"sampled_by" uuid,
	"sample_qty_base" numeric(18, 6),
	"sample_uom" text,
	"performed_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"outcome" text,
	"review_note" text,
	"cancel_reason" text,
	"due_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid NOT NULL,
	"idempotency_key" text,
	CONSTRAINT "ck_inspections_status" CHECK ("inspections"."status" in ('pending','in_progress','awaiting_review','approved','rejected','cancelled')),
	CONSTRAINT "ck_inspections_kind" CHECK ("inspections"."inspection_kind" in ('incoming','in_process','finished_product')),
	CONSTRAINT "ck_inspections_outcome" CHECK ("inspections"."outcome" is null or "inspections"."outcome" in ('pass','fail','conditional')),
	CONSTRAINT "ck_inspections_subject" CHECK (num_nonnulls("inspections"."lot_id", "inspections"."batch_id") >= 1),
	CONSTRAINT "ck_inspections_reviewer_not_performer" CHECK ("inspections"."reviewed_by" is null or "inspections"."performed_by" is null or "inspections"."reviewed_by" <> "inspections"."performed_by"),
	CONSTRAINT "ck_inspections_reviewed" CHECK (("inspections"."status" in ('approved','rejected')) = ("inspections"."reviewed_by" is not null and "inspections"."reviewed_at" is not null and "inspections"."outcome" is not null)),
	CONSTRAINT "ck_inspections_cancelled" CHECK ("inspections"."status" <> 'cancelled' or "inspections"."cancel_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "label_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"container_id" uuid,
	"lot_id" uuid,
	"location_id" uuid NOT NULL,
	"scan_payload" text NOT NULL,
	"verified_by" uuid NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_sequence" bigint,
	CONSTRAINT "ck_label_verifications_subject" CHECK (num_nonnulls("label_verifications"."container_id", "label_verifications"."lot_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "batch_amendments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"reopen_request_id" uuid NOT NULL,
	"amendment_no" integer NOT NULL,
	"section" text NOT NULL,
	"reference" text NOT NULL,
	"previous_value" text NOT NULL,
	"corrected_value" text NOT NULL,
	"reason" text NOT NULL,
	"supersedes_id" uuid,
	"idempotency_key" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_amendments_section_ck" CHECK ("batch_amendments"."section" in ('header', 'materials', 'process_steps', 'line_clearance', 'packaging_reconciliation', 'output_yield', 'qc', 'deviations', 'remarks', 'attachments', 'other')),
	CONSTRAINT "batch_amendments_reason_ck" CHECK (length(trim("batch_amendments"."reason")) >= 5)
);
--> statement-breakpoint
CREATE TABLE "batch_closures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"closure_no" integer NOT NULL,
	"from_state" text NOT NULL,
	"batch_state_transition_id" uuid,
	"generated_document_id" uuid NOT NULL,
	"checks" jsonb NOT NULL,
	"reservations_released" integer DEFAULT 0 NOT NULL,
	"note" text,
	"closed_by" uuid NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_closures_no_ck" CHECK ("batch_closures"."closure_no" >= 1),
	CONSTRAINT "batch_closures_from_ck" CHECK ("batch_closures"."from_state" in ('released', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "batch_paper_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"routing_step_id" uuid,
	"step_no" integer NOT NULL,
	"step_name" text NOT NULL,
	"record_mode" text NOT NULL,
	"page_no" integer NOT NULL,
	"paper_reference" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"generated_document_id" uuid,
	"file_attachment_id" uuid,
	"transcription_note" text,
	"transcribed_by" uuid,
	"transcribed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"issued_by" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_paper_records_status_ck" CHECK ("batch_paper_records"."status" in ('issued', 'attached', 'returned', 'reviewed', 'void')),
	CONSTRAINT "batch_paper_records_mode_ck" CHECK ("batch_paper_records"."record_mode" in ('electronic', 'paper_then_transcribe', 'paper_only')),
	CONSTRAINT "batch_paper_records_page_ck" CHECK ("batch_paper_records"."page_no" >= 1),
	CONSTRAINT "batch_paper_records_sod_ck" CHECK ("batch_paper_records"."reviewed_by" is null or "batch_paper_records"."transcribed_by" is null or "batch_paper_records"."reviewed_by" <> "batch_paper_records"."transcribed_by"),
	CONSTRAINT "batch_paper_records_attached_ck" CHECK ("batch_paper_records"."status" not in ('attached', 'reviewed') or ("batch_paper_records"."file_attachment_id" is not null and "batch_paper_records"."transcribed_by" is not null and "batch_paper_records"."transcribed_at" is not null)),
	CONSTRAINT "batch_paper_records_reviewed_ck" CHECK ("batch_paper_records"."status" <> 'reviewed' or ("batch_paper_records"."reviewed_by" is not null and "batch_paper_records"."reviewed_at" is not null)),
	CONSTRAINT "batch_paper_records_void_ck" CHECK ("batch_paper_records"."status" <> 'void' or ("batch_paper_records"."voided_by" is not null and "batch_paper_records"."voided_at" is not null and "batch_paper_records"."void_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "batch_reopen_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"closure_no" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"target_state" text NOT NULL,
	"reason" text NOT NULL,
	"amendment_scope" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"reopen_no" integer,
	"reopened_at" timestamp with time zone,
	"batch_state_transition_id" uuid,
	"idempotency_key" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_reopen_requests_status_ck" CHECK ("batch_reopen_requests"."status" in ('pending', 'reopened', 'rejected', 'withdrawn')),
	CONSTRAINT "batch_reopen_requests_target_ck" CHECK ("batch_reopen_requests"."target_state" in ('released', 'rejected', 'quarantined')),
	CONSTRAINT "batch_reopen_requests_reason_ck" CHECK (length(trim("batch_reopen_requests"."reason")) >= 10 and length(trim("batch_reopen_requests"."amendment_scope")) >= 5),
	CONSTRAINT "batch_reopen_requests_reopened_ck" CHECK (("batch_reopen_requests"."status" = 'reopened') = ("batch_reopen_requests"."reopen_no" is not null and "batch_reopen_requests"."reopened_at" is not null))
);
--> statement-breakpoint
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
CREATE TABLE "batch_material_stagings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"batch_material_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"movement_id" uuid NOT NULL,
	"batch_reservation_id" uuid,
	"substitution_id" uuid,
	"staged_by" uuid NOT NULL,
	"staged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_batch_material_stagings_qty" CHECK ("batch_material_stagings"."qty_base" > 0),
	CONSTRAINT "ck_batch_material_stagings_locations" CHECK ("batch_material_stagings"."from_location_id" <> "batch_material_stagings"."to_location_id")
);
--> statement-breakpoint
CREATE TABLE "batch_material_substitutions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"batch_material_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"expected_lot_id" uuid,
	"substitute_lot_id" uuid NOT NULL,
	"substitute_location_id" uuid NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"reason" text NOT NULL,
	"new_reservation_id" uuid,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_batch_material_substitutions_qty" CHECK ("batch_material_substitutions"."qty_base" > 0),
	CONSTRAINT "ck_batch_material_substitutions_lots" CHECK ("batch_material_substitutions"."expected_lot_id" is null or "batch_material_substitutions"."expected_lot_id" <> "batch_material_substitutions"."substitute_lot_id"),
	CONSTRAINT "ck_batch_material_substitutions_reason" CHECK (length(btrim("batch_material_substitutions"."reason")) >= 5)
);
--> statement-breakpoint
CREATE TABLE "product_min_stock" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"min_stock_units" numeric(18, 6) NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_product_min_stock_qty" CHECK ("product_min_stock"."min_stock_units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_plan_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"production_plan_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"source" text NOT NULL,
	"sales_order_id" uuid,
	"sales_order_line_id" uuid,
	"demand_units" numeric(18, 6) NOT NULL,
	"on_hand_units" numeric(18, 6) DEFAULT '0' NOT NULL,
	"available_units" numeric(18, 6) DEFAULT '0' NOT NULL,
	"open_work_order_units" numeric(18, 6) DEFAULT '0' NOT NULL,
	"min_stock_units" numeric(18, 6),
	"qty_units" numeric(18, 6) NOT NULL,
	"target_date" date NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_production_plan_lines_source" CHECK ("production_plan_lines"."source" in ('sales_order','min_stock','manual')),
	CONSTRAINT "ck_production_plan_lines_qty" CHECK ("production_plan_lines"."qty_units" > 0 and "production_plan_lines"."demand_units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"plan_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"notes" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_production_plans_status" CHECK ("production_plans"."status" in ('draft','approved','closed')),
	CONSTRAINT "ck_production_plans_period" CHECK ("production_plans"."period_start" <= "production_plans"."period_end")
);
--> statement-breakpoint
CREATE TABLE "work_order_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"work_order_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"product_id" uuid NOT NULL,
	"formula_id" uuid NOT NULL,
	"formula_revision_id" uuid,
	"routing_revision_id" uuid,
	"production_line_id" uuid,
	"production_plan_line_id" uuid,
	"sales_order_id" uuid,
	"qty_planned_base" numeric(18, 6) NOT NULL,
	"base_uom" text DEFAULT 'g' NOT NULL,
	"batch_count" integer NOT NULL,
	"batch_size_base" numeric(18, 6) NOT NULL,
	"target_units" numeric(18, 6),
	"planned_start" date NOT NULL,
	"planned_end" date NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"assigned_planner_id" uuid,
	"assigned_supervisor_id" uuid,
	"notes" text,
	"release_shortages" jsonb,
	"released_with_shortage" boolean DEFAULT false NOT NULL,
	"cancel_reason" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_work_orders_status" CHECK ("work_orders"."status" in ('draft','planned','released','in_progress','completed','closed','cancelled')),
	CONSTRAINT "ck_work_orders_qty" CHECK ("work_orders"."qty_planned_base" > 0 and "work_orders"."batch_size_base" > 0 and "work_orders"."batch_count" > 0),
	CONSTRAINT "ck_work_orders_dates" CHECK ("work_orders"."planned_end" >= "work_orders"."planned_start"),
	CONSTRAINT "ck_work_orders_priority" CHECK ("work_orders"."priority" between 1 and 9),
	CONSTRAINT "ck_work_orders_revisions" CHECK ("work_orders"."status" in ('draft','cancelled') or ("work_orders"."formula_revision_id" is not null and "work_orders"."routing_revision_id" is not null)),
	CONSTRAINT "ck_work_orders_release" CHECK ("work_orders"."status" not in ('released','in_progress','completed','closed') or ("work_orders"."approved_by" is not null and "work_orders"."approved_at" is not null)),
	CONSTRAINT "ck_work_orders_cancel" CHECK ("work_orders"."status" <> 'cancelled' or "work_orders"."cancel_reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "dispense_records" ALTER COLUMN "checker_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "process_step_records" ALTER COLUMN "completed_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "process_step_records" ALTER COLUMN "completed_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "test_results" ALTER COLUMN "batch_id" DROP NOT NULL;--> statement-breakpoint
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
ALTER TABLE "sites" ADD COLUMN "timezone" text DEFAULT 'Asia/Manila' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "province" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "country" text DEFAULT 'PH' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD COLUMN "valid_from" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD COLUMN "valid_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD COLUMN "scope" jsonb;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD COLUMN "revoked_by" uuid;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD COLUMN "revoked_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "parent_location_id" uuid;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "is_pickable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "common_name" text;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "retest_days" integer;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "allergen_notes" text;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "hazard_notes" text;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "allocation_rule" text DEFAULT 'fefo' NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "storage_conditions" text;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "warehouse_kind" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "production_line_id" uuid;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "work_order_id" uuid;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "sequence" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "entered_qty" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "entered_uom" text;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "tare_qty_g" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "gross_qty_g" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "is_partial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "equipment_id" uuid;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "exception_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "deviation_id" uuid;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "supersedes_id" uuid;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "correction_reason" text;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "production_posting_id" uuid;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD COLUMN "step_kind" text;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD COLUMN "area" text;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD COLUMN "status" text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD COLUMN "started_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "process_step_records" ADD COLUMN "earliest_completion_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD COLUMN "performed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD COLUMN "exception_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD COLUMN "exception_reason" text;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD COLUMN "deviation_id" uuid;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "inspection_id" uuid;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "inspection_plan_test_id" uuid;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "test_code" text;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "value_numeric" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "value_text" text;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "value_pass" boolean;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "uom" text;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "instrument_equipment_id" uuid;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "supersedes_id" uuid;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "correction_reason" text;--> statement-breakpoint
ALTER TABLE "dispositions" ADD COLUMN "requested_by" uuid;--> statement-breakpoint
ALTER TABLE "dispositions" ADD COLUMN "conditions" text;--> statement-breakpoint
ALTER TABLE "dispositions" ADD COLUMN "review_date" date;--> statement-breakpoint
ALTER TABLE "dispositions" ADD COLUMN "inspection_id" uuid;--> statement-breakpoint
ALTER TABLE "worker_heartbeats" ADD COLUMN "env_presence" jsonb;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reason_codes" ADD CONSTRAINT "reason_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reason_codes" ADD CONSTRAINT "reason_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reason_codes" ADD CONSTRAINT "reason_codes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_net_content_uom_id_uoms_id_fk" FOREIGN KEY ("net_content_uom_id") REFERENCES "public"."uoms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_uom_base_id_uoms_id_fk" FOREIGN KEY ("uom_base_id") REFERENCES "public"."uoms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_from_uom_id_uoms_id_fk" FOREIGN KEY ("from_uom_id") REFERENCES "public"."uoms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_to_uom_id_uoms_id_fk" FOREIGN KEY ("to_uom_id") REFERENCES "public"."uoms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_supersedes_id_uom_conversions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."uom_conversions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uoms" ADD CONSTRAINT "uoms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uoms" ADD CONSTRAINT "uoms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uoms" ADD CONSTRAINT "uoms_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_special_locations" ADD CONSTRAINT "warehouse_special_locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_special_locations" ADD CONSTRAINT "warehouse_special_locations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_special_locations" ADD CONSTRAINT "warehouse_special_locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_special_locations" ADD CONSTRAINT "warehouse_special_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_special_locations" ADD CONSTRAINT "warehouse_special_locations_designated_by_users_id_fk" FOREIGN KEY ("designated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_outputs" ADD CONSTRAINT "batch_outputs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_outputs" ADD CONSTRAINT "batch_outputs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_outputs" ADD CONSTRAINT "batch_outputs_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_outputs" ADD CONSTRAINT "batch_outputs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_outputs" ADD CONSTRAINT "batch_outputs_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_outputs" ADD CONSTRAINT "batch_outputs_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_outputs" ADD CONSTRAINT "batch_outputs_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_outputs" ADD CONSTRAINT "batch_outputs_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_outputs" ADD CONSTRAINT "batch_outputs_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_uses" ADD CONSTRAINT "equipment_uses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_uses" ADD CONSTRAINT "equipment_uses_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_uses" ADD CONSTRAINT "equipment_uses_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_uses" ADD CONSTRAINT "equipment_uses_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_uses" ADD CONSTRAINT "equipment_uses_process_step_record_id_process_step_records_id_fk" FOREIGN KEY ("process_step_record_id") REFERENCES "public"."process_step_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_uses" ADD CONSTRAINT "equipment_uses_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_uses" ADD CONSTRAINT "equipment_uses_override_request_id_equipment_override_requests_id_fk" FOREIGN KEY ("override_request_id") REFERENCES "public"."equipment_override_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_uses" ADD CONSTRAINT "equipment_uses_exception_approved_by_users_id_fk" FOREIGN KEY ("exception_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_reconciliations" ADD CONSTRAINT "packaging_reconciliations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_reconciliations" ADD CONSTRAINT "packaging_reconciliations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_reconciliations" ADD CONSTRAINT "packaging_reconciliations_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_reconciliations" ADD CONSTRAINT "packaging_reconciliations_process_step_record_id_process_step_records_id_fk" FOREIGN KEY ("process_step_record_id") REFERENCES "public"."process_step_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_reconciliations" ADD CONSTRAINT "packaging_reconciliations_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_reconciliations" ADD CONSTRAINT "packaging_reconciliations_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_reconciliations" ADD CONSTRAINT "packaging_reconciliations_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_reconciliations" ADD CONSTRAINT "packaging_reconciliations_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_reconciliations" ADD CONSTRAINT "packaging_reconciliations_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_reconciliations" ADD CONSTRAINT "packaging_reconciliations_supersedes_id_packaging_reconciliations_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."packaging_reconciliations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_checklist_results" ADD CONSTRAINT "process_step_checklist_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_checklist_results" ADD CONSTRAINT "process_step_checklist_results_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_checklist_results" ADD CONSTRAINT "process_step_checklist_results_process_step_record_id_process_step_records_id_fk" FOREIGN KEY ("process_step_record_id") REFERENCES "public"."process_step_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_checklist_results" ADD CONSTRAINT "process_step_checklist_results_routing_step_checklist_item_id_routing_step_checklist_items_id_fk" FOREIGN KEY ("routing_step_checklist_item_id") REFERENCES "public"."routing_step_checklist_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_checklist_results" ADD CONSTRAINT "process_step_checklist_results_photo_attachment_id_file_attachments_id_fk" FOREIGN KEY ("photo_attachment_id") REFERENCES "public"."file_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_checklist_results" ADD CONSTRAINT "process_step_checklist_results_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_checklist_results" ADD CONSTRAINT "process_step_checklist_results_supersedes_id_process_step_checklist_results_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."process_step_checklist_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_readings" ADD CONSTRAINT "process_step_readings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_readings" ADD CONSTRAINT "process_step_readings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_readings" ADD CONSTRAINT "process_step_readings_process_step_record_id_process_step_records_id_fk" FOREIGN KEY ("process_step_record_id") REFERENCES "public"."process_step_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_readings" ADD CONSTRAINT "process_step_readings_routing_step_parameter_id_routing_step_parameters_id_fk" FOREIGN KEY ("routing_step_parameter_id") REFERENCES "public"."routing_step_parameters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_readings" ADD CONSTRAINT "process_step_readings_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_readings" ADD CONSTRAINT "process_step_readings_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_readings" ADD CONSTRAINT "process_step_readings_supersedes_id_process_step_readings_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."process_step_readings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_postings" ADD CONSTRAINT "production_postings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_postings" ADD CONSTRAINT "production_postings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_postings" ADD CONSTRAINT "production_postings_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_postings" ADD CONSTRAINT "production_postings_batch_material_id_batch_materials_id_fk" FOREIGN KEY ("batch_material_id") REFERENCES "public"."batch_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_postings" ADD CONSTRAINT "production_postings_dispense_record_id_dispense_records_id_fk" FOREIGN KEY ("dispense_record_id") REFERENCES "public"."dispense_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_postings" ADD CONSTRAINT "production_postings_packaging_reconciliation_id_packaging_reconciliations_id_fk" FOREIGN KEY ("packaging_reconciliation_id") REFERENCES "public"."packaging_reconciliations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_postings" ADD CONSTRAINT "production_postings_batch_output_id_batch_outputs_id_fk" FOREIGN KEY ("batch_output_id") REFERENCES "public"."batch_outputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_postings" ADD CONSTRAINT "production_postings_process_step_record_id_process_step_records_id_fk" FOREIGN KEY ("process_step_record_id") REFERENCES "public"."process_step_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_postings" ADD CONSTRAINT "production_postings_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_postings" ADD CONSTRAINT "production_postings_stock_movement_id_stock_movements_id_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_postings" ADD CONSTRAINT "production_postings_reversal_of_id_production_postings_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."production_postings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_postings" ADD CONSTRAINT "production_postings_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrap_rework_records" ADD CONSTRAINT "scrap_rework_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrap_rework_records" ADD CONSTRAINT "scrap_rework_records_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrap_rework_records" ADD CONSTRAINT "scrap_rework_records_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrap_rework_records" ADD CONSTRAINT "scrap_rework_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrap_rework_records" ADD CONSTRAINT "scrap_rework_records_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yield_records" ADD CONSTRAINT "yield_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yield_records" ADD CONSTRAINT "yield_records_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yield_records" ADD CONSTRAINT "yield_records_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yield_records" ADD CONSTRAINT "yield_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yield_records" ADD CONSTRAINT "yield_records_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yield_records" ADD CONSTRAINT "yield_records_supersedes_id_yield_records_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."yield_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_holds" ADD CONSTRAINT "deviation_holds_deviation_id_deviations_id_fk" FOREIGN KEY ("deviation_id") REFERENCES "public"."deviations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_holds" ADD CONSTRAINT "deviation_holds_quality_hold_id_quality_holds_id_fk" FOREIGN KEY ("quality_hold_id") REFERENCES "public"."quality_holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_holds" ADD CONSTRAINT "deviation_holds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_state_transitions" ADD CONSTRAINT "deviation_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_state_transitions" ADD CONSTRAINT "deviation_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_state_transitions" ADD CONSTRAINT "deviation_state_transitions_deviation_id_deviations_id_fk" FOREIGN KEY ("deviation_id") REFERENCES "public"."deviations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_state_transitions" ADD CONSTRAINT "deviation_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_process_step_record_id_process_step_records_id_fk" FOREIGN KEY ("process_step_record_id") REFERENCES "public"."process_step_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_dispense_record_id_dispense_records_id_fk" FOREIGN KEY ("dispense_record_id") REFERENCES "public"."dispense_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_test_result_id_test_results_id_fk" FOREIGN KEY ("test_result_id") REFERENCES "public"."test_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_classified_by_users_id_fk" FOREIGN KEY ("classified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposition_requests" ADD CONSTRAINT "disposition_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposition_requests" ADD CONSTRAINT "disposition_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposition_requests" ADD CONSTRAINT "disposition_requests_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposition_requests" ADD CONSTRAINT "disposition_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposition_requests" ADD CONSTRAINT "disposition_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_samples" ADD CONSTRAINT "inspection_samples_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_samples" ADD CONSTRAINT "inspection_samples_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_samples" ADD CONSTRAINT "inspection_samples_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_samples" ADD CONSTRAINT "inspection_samples_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_samples" ADD CONSTRAINT "inspection_samples_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_samples" ADD CONSTRAINT "inspection_samples_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_samples" ADD CONSTRAINT "inspection_samples_sampled_by_users_id_fk" FOREIGN KEY ("sampled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_samples" ADD CONSTRAINT "inspection_samples_consumption_movement_id_stock_movements_id_fk" FOREIGN KEY ("consumption_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_state_transitions" ADD CONSTRAINT "inspection_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_state_transitions" ADD CONSTRAINT "inspection_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_state_transitions" ADD CONSTRAINT "inspection_state_transitions_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_state_transitions" ADD CONSTRAINT "inspection_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspection_plan_id_inspection_plans_id_fk" FOREIGN KEY ("inspection_plan_id") REFERENCES "public"."inspection_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_process_step_record_id_process_step_records_id_fk" FOREIGN KEY ("process_step_record_id") REFERENCES "public"."process_step_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_sampled_by_users_id_fk" FOREIGN KEY ("sampled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_verifications" ADD CONSTRAINT "label_verifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_verifications" ADD CONSTRAINT "label_verifications_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_verifications" ADD CONSTRAINT "label_verifications_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_verifications" ADD CONSTRAINT "label_verifications_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_verifications" ADD CONSTRAINT "label_verifications_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_verifications" ADD CONSTRAINT "label_verifications_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_amendments" ADD CONSTRAINT "batch_amendments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_amendments" ADD CONSTRAINT "batch_amendments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_amendments" ADD CONSTRAINT "batch_amendments_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_amendments" ADD CONSTRAINT "batch_amendments_reopen_request_id_batch_reopen_requests_id_fk" FOREIGN KEY ("reopen_request_id") REFERENCES "public"."batch_reopen_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_amendments" ADD CONSTRAINT "batch_amendments_supersedes_id_batch_amendments_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."batch_amendments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_amendments" ADD CONSTRAINT "batch_amendments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_closures" ADD CONSTRAINT "batch_closures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_closures" ADD CONSTRAINT "batch_closures_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_closures" ADD CONSTRAINT "batch_closures_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_closures" ADD CONSTRAINT "batch_closures_batch_state_transition_id_batch_state_transitions_id_fk" FOREIGN KEY ("batch_state_transition_id") REFERENCES "public"."batch_state_transitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_closures" ADD CONSTRAINT "batch_closures_generated_document_id_generated_documents_id_fk" FOREIGN KEY ("generated_document_id") REFERENCES "public"."generated_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_closures" ADD CONSTRAINT "batch_closures_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_routing_step_id_routing_steps_id_fk" FOREIGN KEY ("routing_step_id") REFERENCES "public"."routing_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_generated_document_id_generated_documents_id_fk" FOREIGN KEY ("generated_document_id") REFERENCES "public"."generated_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_file_attachment_id_file_attachments_id_fk" FOREIGN KEY ("file_attachment_id") REFERENCES "public"."file_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_transcribed_by_users_id_fk" FOREIGN KEY ("transcribed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_reopen_requests" ADD CONSTRAINT "batch_reopen_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_reopen_requests" ADD CONSTRAINT "batch_reopen_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_reopen_requests" ADD CONSTRAINT "batch_reopen_requests_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_reopen_requests" ADD CONSTRAINT "batch_reopen_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_reopen_requests" ADD CONSTRAINT "batch_reopen_requests_batch_state_transition_id_batch_state_transitions_id_fk" FOREIGN KEY ("batch_state_transition_id") REFERENCES "public"."batch_state_transitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_batch_material_id_batch_materials_id_fk" FOREIGN KEY ("batch_material_id") REFERENCES "public"."batch_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_movement_id_stock_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_batch_reservation_id_stock_reservations_id_fk" FOREIGN KEY ("batch_reservation_id") REFERENCES "public"."stock_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_substitution_id_batch_material_substitutions_id_fk" FOREIGN KEY ("substitution_id") REFERENCES "public"."batch_material_substitutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_staged_by_users_id_fk" FOREIGN KEY ("staged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_batch_material_id_batch_materials_id_fk" FOREIGN KEY ("batch_material_id") REFERENCES "public"."batch_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_expected_lot_id_inventory_lots_id_fk" FOREIGN KEY ("expected_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_substitute_lot_id_inventory_lots_id_fk" FOREIGN KEY ("substitute_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_substitute_location_id_locations_id_fk" FOREIGN KEY ("substitute_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_new_reservation_id_stock_reservations_id_fk" FOREIGN KEY ("new_reservation_id") REFERENCES "public"."stock_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_min_stock" ADD CONSTRAINT "product_min_stock_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_min_stock" ADD CONSTRAINT "product_min_stock_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_min_stock" ADD CONSTRAINT "product_min_stock_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_min_stock" ADD CONSTRAINT "product_min_stock_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_production_plan_id_production_plans_id_fk" FOREIGN KEY ("production_plan_id") REFERENCES "public"."production_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_state_transitions" ADD CONSTRAINT "work_order_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_state_transitions" ADD CONSTRAINT "work_order_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_state_transitions" ADD CONSTRAINT "work_order_state_transitions_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_state_transitions" ADD CONSTRAINT "work_order_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_formula_id_formulas_id_fk" FOREIGN KEY ("formula_id") REFERENCES "public"."formulas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_formula_revision_id_formula_revisions_id_fk" FOREIGN KEY ("formula_revision_id") REFERENCES "public"."formula_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_routing_revision_id_routing_revisions_id_fk" FOREIGN KEY ("routing_revision_id") REFERENCES "public"."routing_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_production_line_id_production_lines_id_fk" FOREIGN KEY ("production_line_id") REFERENCES "public"."production_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_production_plan_line_id_production_plan_lines_id_fk" FOREIGN KEY ("production_plan_line_id") REFERENCES "public"."production_plan_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assigned_planner_id_users_id_fk" FOREIGN KEY ("assigned_planner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assigned_supervisor_id_users_id_fk" FOREIGN KEY ("assigned_supervisor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_site_code_uq" ON "departments" USING btree ("site_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "production_lines_site_code_uq" ON "production_lines" USING btree ("site_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "reason_codes_org_code_uq" ON "reason_codes" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "reason_codes_applies_to_idx" ON "reason_codes" USING gin ("applies_to");--> statement-breakpoint
CREATE UNIQUE INDEX "skus_org_code_uq" ON "skus" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "skus_product_idx" ON "skus" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uom_conv_approved_generic_uq" ON "uom_conversions" USING btree ("organization_id","from_uom_id","to_uom_id") WHERE "uom_conversions"."status" = 'approved' and "uom_conversions"."material_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uom_conv_approved_material_uq" ON "uom_conversions" USING btree ("organization_id","from_uom_id","to_uom_id","material_id") WHERE "uom_conversions"."status" = 'approved' and "uom_conversions"."material_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uom_conv_pending_generic_uq" ON "uom_conversions" USING btree ("organization_id","from_uom_id","to_uom_id") WHERE "uom_conversions"."status" = 'pending_approval' and "uom_conversions"."material_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uom_conv_pending_material_uq" ON "uom_conversions" USING btree ("organization_id","from_uom_id","to_uom_id","material_id") WHERE "uom_conversions"."status" = 'pending_approval' and "uom_conversions"."material_id" is not null;--> statement-breakpoint
CREATE INDEX "uom_conv_material_idx" ON "uom_conversions" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uoms_org_code_uq" ON "uoms" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "uoms_one_base_per_dimension_uq" ON "uoms" USING btree ("organization_id","dimension") WHERE "uoms"."is_base";--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_special_locations_uq" ON "warehouse_special_locations" USING btree ("warehouse_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_outputs_line_uq" ON "batch_outputs" USING btree ("batch_id","line_no");--> statement-breakpoint
CREATE INDEX "equipment_uses_batch_idx" ON "equipment_uses" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "equipment_uses_equipment_idx" ON "equipment_uses" USING btree ("equipment_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_uses_open_uq" ON "equipment_uses" USING btree ("equipment_id","process_step_record_id") WHERE "equipment_uses"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "packaging_reconciliations_batch_idx" ON "packaging_reconciliations" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "packaging_reconciliations_supersedes_uq" ON "packaging_reconciliations" USING btree ("supersedes_id") WHERE "packaging_reconciliations"."supersedes_id" is not null;--> statement-breakpoint
CREATE INDEX "checklist_results_record_idx" ON "process_step_checklist_results" USING btree ("process_step_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_results_supersedes_uq" ON "process_step_checklist_results" USING btree ("supersedes_id") WHERE "process_step_checklist_results"."supersedes_id" is not null;--> statement-breakpoint
CREATE INDEX "step_readings_record_idx" ON "process_step_readings" USING btree ("process_step_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "step_readings_supersedes_uq" ON "process_step_readings" USING btree ("supersedes_id") WHERE "process_step_readings"."supersedes_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "production_postings_movement_uq" ON "production_postings" USING btree ("stock_movement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_postings_reversal_uq" ON "production_postings" USING btree ("reversal_of_id") WHERE "production_postings"."reversal_of_id" is not null;--> statement-breakpoint
CREATE INDEX "production_postings_batch_idx" ON "production_postings" USING btree ("batch_id","posting_type");--> statement-breakpoint
CREATE INDEX "production_postings_lot_idx" ON "production_postings" USING btree ("lot_id","posting_type");--> statement-breakpoint
CREATE INDEX "scrap_rework_batch_idx" ON "scrap_rework_records" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "yield_records_current_uq" ON "yield_records" USING btree ("batch_id") WHERE "yield_records"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deviation_holds_pair" ON "deviation_holds" USING btree ("deviation_id","quality_hold_id");--> statement-breakpoint
CREATE INDEX "ix_deviation_holds_hold" ON "deviation_holds" USING btree ("quality_hold_id");--> statement-breakpoint
CREATE INDEX "ix_deviation_transitions_deviation" ON "deviation_state_transitions" USING btree ("deviation_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deviations_org_number" ON "deviations" USING btree ("organization_id","deviation_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deviations_org_idem" ON "deviations" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_deviations_site_status" ON "deviations" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_deviations_batch" ON "deviations" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "ix_deviations_lot" ON "deviations" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "ix_deviations_test_result" ON "deviations" USING btree ("test_result_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_disposition_requests_batch_pending" ON "disposition_requests" USING btree ("batch_id") WHERE "disposition_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inspection_samples_no" ON "inspection_samples" USING btree ("inspection_id","sample_no");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inspection_samples_org_idem" ON "inspection_samples" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_inspection_transitions_inspection" ON "inspection_state_transitions" USING btree ("inspection_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inspections_org_number" ON "inspections" USING btree ("organization_id","inspection_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inspections_org_idem" ON "inspections" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inspections_batch_plan_live" ON "inspections" USING btree ("batch_id","inspection_plan_id") WHERE "inspections"."batch_id" is not null and "inspections"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inspections_lot_plan_live" ON "inspections" USING btree ("lot_id","inspection_plan_id") WHERE "inspections"."batch_id" is null and "inspections"."lot_id" is not null and "inspections"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "ix_inspections_site_status" ON "inspections" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_inspections_lot" ON "inspections" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "ix_inspections_batch" ON "inspections" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_label_verifications_container" ON "label_verifications" USING btree ("container_id") WHERE "label_verifications"."container_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_label_verifications_lot_location" ON "label_verifications" USING btree ("lot_id","location_id") WHERE "label_verifications"."container_id" is null;--> statement-breakpoint
CREATE INDEX "ix_label_verifications_location" ON "label_verifications" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_amendments_batch_no_uq" ON "batch_amendments" USING btree ("batch_id","amendment_no");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_amendments_org_idem_uq" ON "batch_amendments" USING btree ("organization_id","idempotency_key") WHERE "batch_amendments"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "batch_closures_batch_no_uq" ON "batch_closures" USING btree ("batch_id","closure_no");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_paper_records_batch_page_uq" ON "batch_paper_records" USING btree ("batch_id","page_no");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_paper_records_org_idem_uq" ON "batch_paper_records" USING btree ("organization_id","idempotency_key") WHERE "batch_paper_records"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "batch_paper_records_batch_idx" ON "batch_paper_records" USING btree ("batch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_reopen_requests_one_pending_uq" ON "batch_reopen_requests" USING btree ("batch_id") WHERE "batch_reopen_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "batch_reopen_requests_reopen_no_uq" ON "batch_reopen_requests" USING btree ("batch_id","reopen_no") WHERE "batch_reopen_requests"."reopen_no" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "batch_reopen_requests_org_idem_uq" ON "batch_reopen_requests" USING btree ("organization_id","idempotency_key") WHERE "batch_reopen_requests"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "batch_reopen_requests_batch_idx" ON "batch_reopen_requests" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "email_outbox_to_idx" ON "email_outbox" USING btree ("to_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_user_idx" ON "invitations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mfa_recovery_codes_user_idx" ON "mfa_recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_secrets_user_uq" ON "mfa_secrets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_history_user_idx" ON "password_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_token_uq" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_rules_lookup_idx" ON "approval_rules" USING btree ("organization_id","document_type","site_id");--> statement-breakpoint
CREATE INDEX "backup_runs_org_time_idx" ON "backup_runs" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX "metrics_samples_metric_time_idx" ON "metrics_samples" USING btree ("organization_id","metric","sampled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "numbering_rule_versions_open_uq" ON "numbering_rule_versions" USING btree ("organization_id","document_type") WHERE "numbering_rule_versions"."status" = 'approved' and "numbering_rule_versions"."effective_to" is null and "numbering_rule_versions"."site_id" is null;--> statement-breakpoint
CREATE INDEX "numbering_rule_versions_lookup_idx" ON "numbering_rule_versions" USING btree ("organization_id","document_type","status");--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_refilled_idx" ON "rate_limit_buckets" USING btree ("refilled_at");--> statement-breakpoint
CREATE INDEX "setting_change_requests_status_idx" ON "setting_change_requests" USING btree ("organization_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "setting_change_requests_key_idx" ON "setting_change_requests" USING btree ("organization_id","key","created_at");--> statement-breakpoint
CREATE INDEX "batch_material_stagings_batch_idx" ON "batch_material_stagings" USING btree ("batch_id","batch_material_id");--> statement-breakpoint
CREATE INDEX "batch_material_stagings_wo_idx" ON "batch_material_stagings" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "batch_material_substitutions_batch_idx" ON "batch_material_substitutions" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_min_stock_site_product_uq" ON "product_min_stock" USING btree ("site_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_plan_lines_plan_line_uq" ON "production_plan_lines" USING btree ("production_plan_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "production_plans_org_number_uq" ON "production_plans" USING btree ("organization_id","plan_number");--> statement-breakpoint
CREATE INDEX "production_plans_site_status_idx" ON "production_plans" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "work_order_transitions_wo_idx" ON "work_order_state_transitions" USING btree ("work_order_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_org_number_uq" ON "work_orders" USING btree ("organization_id","work_order_number");--> statement-breakpoint
CREATE INDEX "work_orders_site_status_idx" ON "work_orders" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "work_orders_plan_line_idx" ON "work_orders" USING btree ("production_plan_line_id");--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_cloned_from_role_id_roles_id_fk" FOREIGN KEY ("cloned_from_role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_site_id_sites_id_fk" FOREIGN KEY ("active_site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD CONSTRAINT "user_site_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD CONSTRAINT "user_site_assignments_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_location_id_locations_id_fk" FOREIGN KEY ("parent_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_production_line_id_production_lines_id_fk" FOREIGN KEY ("production_line_id") REFERENCES "public"."production_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_exception_approved_by_users_id_fk" FOREIGN KEY ("exception_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_supersedes_id_dispense_records_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."dispense_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD CONSTRAINT "process_step_records_exception_approved_by_users_id_fk" FOREIGN KEY ("exception_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_inspection_plan_test_id_inspection_plan_tests_id_fk" FOREIGN KEY ("inspection_plan_test_id") REFERENCES "public"."inspection_plan_tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_instrument_equipment_id_equipment_id_fk" FOREIGN KEY ("instrument_equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_supersedes_id_test_results_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."test_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispositions" ADD CONSTRAINT "dispositions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usa_live_uq" ON "user_site_assignments" USING btree ("user_id","role_id",coalesce("site_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "user_site_assignments"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "locations_parent_idx" ON "locations" USING btree ("parent_location_id");--> statement-breakpoint
CREATE INDEX "batches_work_order_idx" ON "batches" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispense_records_line_seq_uq" ON "dispense_records" USING btree ("batch_material_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "dispense_records_supersedes_uq" ON "dispense_records" USING btree ("supersedes_id") WHERE "dispense_records"."supersedes_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "process_step_records_batch_step_uq" ON "process_step_records" USING btree ("batch_id","step_no");--> statement-breakpoint
CREATE INDEX "test_results_batch_idx" ON "test_results" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "test_results_inspection_idx" ON "test_results" USING btree ("inspection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_test_results_supersedes" ON "test_results" USING btree ("supersedes_id");--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "ck_roles_status" CHECK ("roles"."status" in ('active','inactive'));--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "ck_roles_custom_clone" CHECK ("roles"."is_system" or "roles"."cloned_from_role_id" is not null);--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "ck_sessions_stage" CHECK ("sessions"."stage" in ('mfa_pending','active'));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "ck_sessions_device_class" CHECK ("sessions"."device_class" in ('standard','shared'));--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD CONSTRAINT "ck_usa_org_wide_site" CHECK (("user_site_assignments"."is_organization_wide" and "user_site_assignments"."site_id" is null) or (not "user_site_assignments"."is_organization_wide" and "user_site_assignments"."site_id" is not null));--> statement-breakpoint
ALTER TABLE "user_site_assignments" ADD CONSTRAINT "ck_usa_validity" CHECK ("user_site_assignments"."valid_to" is null or "user_site_assignments"."valid_to" >= "user_site_assignments"."valid_from");--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_status_ck" CHECK ("locations"."status" in ('active', 'blocked', 'inactive'));--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_active_status_ck" CHECK ("locations"."is_active" = ("locations"."status" <> 'inactive'));--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_kind_ck" CHECK ("locations"."kind" in ('receiving', 'staging', 'storage', 'quarantine', 'hold', 'rejected', 'recall', 'production', 'shipping'));--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_kind_ck" CHECK ("materials"."material_kind" in ('raw_material', 'intermediate', 'packaging', 'consumable'));--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_status_ck" CHECK ("materials"."status" in ('draft', 'active', 'blocked', 'discontinued'));--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_allocation_ck" CHECK ("materials"."allocation_rule" in ('fefo', 'fifo'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_status_ck" CHECK ("products"."status" in ('draft', 'active', 'discontinued'));--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_kind_ck" CHECK ("warehouses"."warehouse_kind" in ('raw_materials', 'packaging', 'finished_goods', 'general'));--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_qty_ck" CHECK ("dispense_records"."actual_qty_g" > 0);--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_sod_ck" CHECK ("dispense_records"."checker_id" is null or "dispense_records"."checker_id" <> "dispense_records"."operator_id");--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_exception_sod_ck" CHECK ("dispense_records"."exception_approved_by" is null or ("dispense_records"."exception_approved_by" <> "dispense_records"."operator_id" and "dispense_records"."exception_reason" is not null));--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_correction_ck" CHECK ("dispense_records"."supersedes_id" is null or "dispense_records"."correction_reason" is not null);--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_void_ck" CHECK ("dispense_records"."voided_at" is null or ("dispense_records"."voided_by" is not null and "dispense_records"."void_reason" is not null));--> statement-breakpoint
ALTER TABLE "process_step_records" ADD CONSTRAINT "process_step_records_status_ck" CHECK ("process_step_records"."status" in ('pending', 'in_progress', 'awaiting_check', 'completed', 'skipped'));--> statement-breakpoint
ALTER TABLE "process_step_records" ADD CONSTRAINT "process_step_records_sod_ck" CHECK ("process_step_records"."checked_by" is null or "process_step_records"."checked_by" <> "process_step_records"."conducted_by");--> statement-breakpoint
ALTER TABLE "process_step_records" ADD CONSTRAINT "process_step_records_completed_ck" CHECK ("process_step_records"."status" <> 'completed' or "process_step_records"."completed_at" is not null);--> statement-breakpoint
ALTER TABLE "process_step_records" ADD CONSTRAINT "process_step_records_exception_ck" CHECK ("process_step_records"."exception_approved_by" is null or ("process_step_records"."exception_approved_by" <> "process_step_records"."conducted_by" and "process_step_records"."exception_reason" is not null));--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "ck_test_results_subject" CHECK (num_nonnulls("test_results"."batch_id", "test_results"."inspection_id") >= 1);--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "ck_test_results_correction" CHECK (("test_results"."supersedes_id" is null) = ("test_results"."correction_reason" is null));--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "ck_test_results_plan_test" CHECK ("test_results"."inspection_id" is null or "test_results"."inspection_plan_test_id" is not null);--> statement-breakpoint
ALTER TABLE "dispositions" ADD CONSTRAINT "ck_dispositions_requester_not_decider" CHECK ("dispositions"."requested_by" is null or "dispositions"."requested_by" <> "dispositions"."decided_by");--> statement-breakpoint
ALTER TABLE "dispositions" ADD CONSTRAINT "ck_dispositions_conditional" CHECK ("dispositions"."decision" <> 'conditional_release' or ("dispositions"."conditions" is not null and "dispositions"."review_date" is not null and "dispositions"."requested_by" is not null));
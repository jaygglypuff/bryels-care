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
CREATE TABLE "file_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"storage_driver" text NOT NULL,
	"bucket_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"attachment_kind" text NOT NULL,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"virus_scan_status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	CONSTRAINT "ck_file_attachments_driver" CHECK ("file_attachments"."storage_driver" in ('local','s3')),
	CONSTRAINT "ck_file_attachments_kind" CHECK ("file_attachments"."attachment_kind" in ('coa','sds','specification','certificate','photo','signature','paper_record_page','legacy_document','template_test_page','import','export','report','backup_manifest','archive','product_image','artwork','other')),
	CONSTRAINT "ck_file_attachments_scan" CHECK ("file_attachments"."virus_scan_status" in ('pending','clean','blocked','failed')),
	CONSTRAINT "ck_file_attachments_size" CHECK ("file_attachments"."size_bytes" > 0),
	CONSTRAINT "ck_file_attachments_deleted" CHECK (("file_attachments"."deleted_at" is null) = ("file_attachments"."deleted_by" is null))
);
--> statement-breakpoint
CREATE TABLE "supplier_lot_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"goods_receipt_line_id" uuid NOT NULL,
	"lot_id" uuid,
	"file_attachment_id" uuid NOT NULL,
	"document_kind" text NOT NULL,
	"document_number" text,
	"issued_on" date,
	"expires_on" date,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "ck_supplier_lot_documents_kind" CHECK ("supplier_lot_documents"."document_kind" in ('coa','sds','specification','photo','other'))
);
--> statement-breakpoint
CREATE TABLE "supplier_materials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"supplier_part_number" text,
	"is_approved" boolean DEFAULT false NOT NULL,
	"lead_time_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"legacy_number" text,
	"contact_name" text,
	"email" text,
	"phone" text,
	"address_line1" text,
	"city" text,
	"country" text,
	"payment_terms_days" integer,
	"default_lead_time_days" integer,
	"quality_status" text DEFAULT 'new' NOT NULL,
	"quality_status_reason" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "ck_suppliers_quality_status" CHECK ("suppliers"."quality_status" in ('new','approved','conditional','suspended')),
	CONSTRAINT "ck_suppliers_terms" CHECK ("suppliers"."payment_terms_days" is null or "suppliers"."payment_terms_days" >= 0),
	CONSTRAINT "ck_suppliers_lead_time" CHECK ("suppliers"."default_lead_time_days" is null or "suppliers"."default_lead_time_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quality_hold_lots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quality_hold_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"previous_status" text NOT NULL,
	"hold_disposition_id" uuid,
	"closing_disposition_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_hold_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"quality_hold_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"hold_number" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"lot_id" uuid,
	"location_id" uuid,
	"reason_code" text NOT NULL,
	"reason" text NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolution" text,
	"close_reason" text,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_quality_holds_status" CHECK ("quality_holds"."status" in ('open','investigating','closed')),
	CONSTRAINT "ck_quality_holds_scope" CHECK (num_nonnulls("quality_holds"."lot_id", "quality_holds"."location_id") >= 1),
	CONSTRAINT "ck_quality_holds_resolution" CHECK ("quality_holds"."resolution" is null or "quality_holds"."resolution" in ('released','rejected','rework','recalled')),
	CONSTRAINT "ck_quality_holds_closed" CHECK (("quality_holds"."status" = 'closed') = ("quality_holds"."closed_by" is not null and "quality_holds"."closed_at" is not null and "quality_holds"."resolution" is not null)),
	CONSTRAINT "ck_quality_holds_closer_not_opener" CHECK ("quality_holds"."closed_by" is null or "quality_holds"."closed_by" <> "quality_holds"."opened_by")
);
--> statement-breakpoint
CREATE TABLE "container_contents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"container_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"qty_base" numeric(18, 6) DEFAULT '0' NOT NULL,
	"base_uom" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_container_contents_qty" CHECK ("container_contents"."qty_base" >= 0)
);
--> statement-breakpoint
CREATE TABLE "container_lineage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"parent_container_id" uuid NOT NULL,
	"child_container_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"reason" text,
	"performed_by" uuid NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_container_lineage_operation" CHECK ("container_lineage"."operation" in ('split','merge','repack')),
	CONSTRAINT "ck_container_lineage_not_self" CHECK ("container_lineage"."parent_container_id" <> "container_lineage"."child_container_id"),
	CONSTRAINT "ck_container_lineage_qty" CHECK ("container_lineage"."qty_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "containers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"container_number" text NOT NULL,
	"container_kind" text DEFAULT 'box' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"current_location_id" uuid,
	"parent_container_id" uuid,
	"packed_at" timestamp with time zone,
	"packed_by" uuid,
	"is_partial" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_containers_kind" CHECK ("containers"."container_kind" in ('box','carton','pallet','drum','tote','sack','bag','bottle','loose')),
	CONSTRAINT "ck_containers_status" CHECK ("containers"."status" in ('open','sealed','in_transit','shipped','empty','void'))
);
--> statement-breakpoint
CREATE TABLE "transfer_request_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transfer_request_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"lot_id" uuid NOT NULL,
	"container_id" uuid,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"issue_movement_id" uuid,
	"receipt_movement_id" uuid,
	"destination_lot_id" uuid,
	"reversal_movement_id" uuid,
	"status" text DEFAULT 'posted' NOT NULL,
	CONSTRAINT "ck_transfer_request_lines_status" CHECK ("transfer_request_lines"."status" in ('pending','posted','cancelled')),
	CONSTRAINT "ck_transfer_request_lines_qty" CHECK ("transfer_request_lines"."qty_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "transfer_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"transfer_number" text NOT NULL,
	"transfer_kind" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"to_site_id" uuid,
	"container_id" uuid,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"reason" text,
	"requested_by" uuid NOT NULL,
	"session_id" uuid,
	"idempotency_key" text,
	"correlation_id" uuid NOT NULL,
	"completed_at" timestamp with time zone,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_transfer_requests_kind" CHECK ("transfer_requests"."transfer_kind" in ('scan_move','planned','inter_site','put_away','status_location')),
	CONSTRAINT "ck_transfer_requests_status" CHECK ("transfer_requests"."status" in ('draft','in_progress','completed','cancelled')),
	CONSTRAINT "ck_transfer_requests_to_site" CHECK (("transfer_requests"."transfer_kind" = 'inter_site') = ("transfer_requests"."to_site_id" is not null)),
	CONSTRAINT "ck_transfer_requests_undo" CHECK (("transfer_requests"."undone_at" is null) = ("transfer_requests"."undone_by" is null))
);
--> statement-breakpoint
CREATE TABLE "stock_adjustment_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stock_adjustment_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"lot_id" uuid,
	"location_id" uuid NOT NULL,
	"container_id" uuid,
	"direction" text NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"unit_cost_amount" numeric(18, 4),
	"note" text,
	"new_lot_material_id" uuid,
	"new_lot_product_id" uuid,
	"new_lot_expires_on" date,
	"new_lot_supplier_lot_number" text,
	"stock_movement_id" uuid,
	CONSTRAINT "ck_stock_adjustment_lines_direction" CHECK ("stock_adjustment_lines"."direction" in ('increase','decrease')),
	CONSTRAINT "ck_stock_adjustment_lines_qty" CHECK ("stock_adjustment_lines"."qty_base" > 0),
	CONSTRAINT "ck_stock_adjustment_lines_lot" CHECK ("stock_adjustment_lines"."lot_id" is not null or ("stock_adjustment_lines"."direction" = 'increase' and num_nonnulls("stock_adjustment_lines"."new_lot_material_id", "stock_adjustment_lines"."new_lot_product_id") = 1))
);
--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"adjustment_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"reason_code" text NOT NULL,
	"reason_note" text,
	"total_value_amount" numeric(18, 4),
	"currency" text,
	"value_unknown" boolean DEFAULT false NOT NULL,
	"requires_second_approval" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"idempotency_key" text,
	"correlation_id" uuid,
	CONSTRAINT "ck_stock_adjustments_status" CHECK ("stock_adjustments"."status" in ('draft','submitted','approved','rejected','posted','cancelled')),
	CONSTRAINT "ck_stock_adjustments_reason" CHECK ("stock_adjustments"."reason_code" in ('found','found_unlabelled','lost','damaged','spillage','expired_disposal','data_correction','other')),
	CONSTRAINT "ck_stock_adjustments_sod" CHECK ("stock_adjustments"."approved_by" is null or ("stock_adjustments"."approved_by" <> "stock_adjustments"."submitted_by" and "stock_adjustments"."approved_by" <> "stock_adjustments"."created_by"))
);
--> statement-breakpoint
CREATE TABLE "stock_approval_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"record_type" text NOT NULL,
	"record_id" uuid NOT NULL,
	"step" integer DEFAULT 1 NOT NULL,
	"decision" text NOT NULL,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	CONSTRAINT "ck_stock_approval_decisions_type" CHECK ("stock_approval_decisions"."record_type" in ('stock_adjustment','stock_count')),
	CONSTRAINT "ck_stock_approval_decisions_decision" CHECK ("stock_approval_decisions"."decision" in ('approved','rejected'))
);
--> statement-breakpoint
CREATE TABLE "stock_count_counters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stock_count_id" uuid NOT NULL,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_count_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stock_count_id" uuid NOT NULL,
	"stock_count_line_id" uuid NOT NULL,
	"entry_kind" text NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"counted_by" uuid NOT NULL,
	"counted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"idempotency_key" text,
	CONSTRAINT "ck_stock_count_entries_kind" CHECK ("stock_count_entries"."entry_kind" in ('count','recount')),
	CONSTRAINT "ck_stock_count_entries_qty" CHECK ("stock_count_entries"."qty_base" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_count_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"stock_count_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"lot_id" uuid,
	"container_id" uuid,
	"base_uom" text,
	"expected_qty_base" numeric(18, 6) DEFAULT '0' NOT NULL,
	"is_unexpected" boolean DEFAULT false NOT NULL,
	"is_unlabelled" boolean DEFAULT false NOT NULL,
	"description" text,
	"line_status" text DEFAULT 'open' NOT NULL,
	"final_qty_base" numeric(18, 6),
	"variance_qty_base" numeric(18, 6),
	"variance_pct" numeric(12, 4),
	"variance_reason_code" text,
	"variance_note" text,
	"auto_approved" boolean DEFAULT false NOT NULL,
	"adjustment_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_stock_count_lines_status" CHECK ("stock_count_lines"."line_status" in ('open','counted','recount_required','final')),
	CONSTRAINT "ck_stock_count_lines_unlabelled" CHECK (("stock_count_lines"."lot_id" is null) = "stock_count_lines"."is_unlabelled"),
	CONSTRAINT "ck_stock_count_lines_expected" CHECK ("stock_count_lines"."expected_qty_base" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_count_scopes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stock_count_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"location_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"count_number" text NOT NULL,
	"warehouse_id" uuid,
	"count_kind" text DEFAULT 'cycle' NOT NULL,
	"is_blind" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"scheduled_for" date,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_at" timestamp with time zone,
	"released_by" uuid,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"approval_note" text,
	"requires_second_approval" boolean DEFAULT false NOT NULL,
	"posted_at" timestamp with time zone,
	"posted_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	CONSTRAINT "ck_stock_counts_kind" CHECK ("stock_counts"."count_kind" in ('cycle','full','spot')),
	CONSTRAINT "ck_stock_counts_status" CHECK ("stock_counts"."status" in ('planned','in_progress','counted','recount','pending_approval','approved','posted','cancelled')),
	CONSTRAINT "ck_stock_counts_cancel_reason" CHECK ("stock_counts"."status" <> 'cancelled' or "stock_counts"."cancel_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "allocation_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"material_kind" text,
	"material_id" uuid,
	"product_id" uuid,
	"customer_id" uuid,
	"strategy" text DEFAULT 'fefo' NOT NULL,
	"min_shelf_life_days" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_allocation_rules_scope" CHECK ("allocation_rules"."scope" in ('default','material_kind','material','product','customer')),
	CONSTRAINT "ck_allocation_rules_strategy" CHECK ("allocation_rules"."strategy" in ('fefo','fifo')),
	CONSTRAINT "ck_allocation_rules_scope_ref" CHECK (("allocation_rules"."scope" = 'default' and num_nonnulls("allocation_rules"."material_kind", "allocation_rules"."material_id", "allocation_rules"."product_id", "allocation_rules"."customer_id") = 0)
       or ("allocation_rules"."scope" = 'material_kind' and "allocation_rules"."material_kind" is not null and num_nonnulls("allocation_rules"."material_id", "allocation_rules"."product_id", "allocation_rules"."customer_id") = 0)
       or ("allocation_rules"."scope" = 'material' and "allocation_rules"."material_id" is not null and num_nonnulls("allocation_rules"."material_kind", "allocation_rules"."product_id", "allocation_rules"."customer_id") = 0)
       or ("allocation_rules"."scope" = 'product' and "allocation_rules"."product_id" is not null and num_nonnulls("allocation_rules"."material_kind", "allocation_rules"."material_id", "allocation_rules"."customer_id") = 0)
       or ("allocation_rules"."scope" = 'customer' and "allocation_rules"."customer_id" is not null and num_nonnulls("allocation_rules"."material_kind", "allocation_rules"."material_id") = 0))
);
--> statement-breakpoint
CREATE TABLE "inventory_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_settings_uq" UNIQUE NULLS NOT DISTINCT("organization_id","site_id","key")
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"reservation_number" text NOT NULL,
	"lot_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"container_id" uuid,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"demand_type" text NOT NULL,
	"demand_id" uuid,
	"demand_reference" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"released_by" uuid,
	"released_reason" text,
	"idempotency_key" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_stock_reservations_qty" CHECK ("stock_reservations"."qty_base" > 0),
	CONSTRAINT "ck_stock_reservations_demand_type" CHECK ("stock_reservations"."demand_type" in ('sales_order_line','work_order','batch','transfer_request','manual')),
	CONSTRAINT "ck_stock_reservations_status" CHECK ("stock_reservations"."status" in ('active','converted','released','expired','cancelled')),
	CONSTRAINT "ck_stock_reservations_release" CHECK ("stock_reservations"."status" in ('active','expired','converted') or "stock_reservations"."released_reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "bom_lines" ALTER COLUMN "tolerance_pct" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "routing_steps" ALTER COLUMN "formula_revision_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ALTER COLUMN "lot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipts" ALTER COLUMN "receipt_number" DROP NOT NULL;--> statement-breakpoint
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
ALTER TABLE "materials" ADD COLUMN "requires_coa" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "requires_incoming_inspection" boolean DEFAULT true NOT NULL;--> statement-breakpoint
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
ALTER TABLE "goods_receipt_lines" ADD COLUMN "line_no" integer;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "qty_entered" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "uom_entered" text;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "supplier_lot_number" text;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "manufactured_on" date;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "expires_on" date;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "retest_on" date;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "container_count" integer;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "storage_conditions_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "initial_quality_status" text DEFAULT 'quarantine' NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "discrepancy_kind" text;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "discrepancy_note" text;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "discrepancy_recorded_by" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "discrepancy_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "discrepancy_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "discrepancy_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "discrepancy_approval_note" text;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "document_missing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "stock_movement_id" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "receipt_kind" text DEFAULT 'unplanned' NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "unplanned_reason_code" text;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "correlation_id" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "posted_by" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "cancelled_by" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "reversed_by" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "reversal_reason" text;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "retest_on" date;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "origin_lot_id" uuid;--> statement-breakpoint
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
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_lot_documents" ADD CONSTRAINT "supplier_lot_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_lot_documents" ADD CONSTRAINT "supplier_lot_documents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_lot_documents" ADD CONSTRAINT "supplier_lot_documents_goods_receipt_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_lot_documents" ADD CONSTRAINT "supplier_lot_documents_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_lot_documents" ADD CONSTRAINT "supplier_lot_documents_file_attachment_id_file_attachments_id_fk" FOREIGN KEY ("file_attachment_id") REFERENCES "public"."file_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_lot_documents" ADD CONSTRAINT "supplier_lot_documents_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_lot_documents" ADD CONSTRAINT "supplier_lot_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_hold_lots" ADD CONSTRAINT "quality_hold_lots_quality_hold_id_quality_holds_id_fk" FOREIGN KEY ("quality_hold_id") REFERENCES "public"."quality_holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_hold_lots" ADD CONSTRAINT "quality_hold_lots_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_hold_lots" ADD CONSTRAINT "quality_hold_lots_hold_disposition_id_dispositions_id_fk" FOREIGN KEY ("hold_disposition_id") REFERENCES "public"."dispositions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_hold_lots" ADD CONSTRAINT "quality_hold_lots_closing_disposition_id_dispositions_id_fk" FOREIGN KEY ("closing_disposition_id") REFERENCES "public"."dispositions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_hold_state_transitions" ADD CONSTRAINT "quality_hold_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_hold_state_transitions" ADD CONSTRAINT "quality_hold_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_hold_state_transitions" ADD CONSTRAINT "quality_hold_state_transitions_quality_hold_id_quality_holds_id_fk" FOREIGN KEY ("quality_hold_id") REFERENCES "public"."quality_holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_hold_state_transitions" ADD CONSTRAINT "quality_hold_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_holds" ADD CONSTRAINT "quality_holds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_holds" ADD CONSTRAINT "quality_holds_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_holds" ADD CONSTRAINT "quality_holds_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_holds" ADD CONSTRAINT "quality_holds_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_holds" ADD CONSTRAINT "quality_holds_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_holds" ADD CONSTRAINT "quality_holds_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_holds" ADD CONSTRAINT "quality_holds_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_contents" ADD CONSTRAINT "container_contents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_contents" ADD CONSTRAINT "container_contents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_contents" ADD CONSTRAINT "container_contents_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_contents" ADD CONSTRAINT "container_contents_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_lineage" ADD CONSTRAINT "container_lineage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_lineage" ADD CONSTRAINT "container_lineage_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_lineage" ADD CONSTRAINT "container_lineage_parent_container_id_containers_id_fk" FOREIGN KEY ("parent_container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_lineage" ADD CONSTRAINT "container_lineage_child_container_id_containers_id_fk" FOREIGN KEY ("child_container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_lineage" ADD CONSTRAINT "container_lineage_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_lineage" ADD CONSTRAINT "container_lineage_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_current_location_id_locations_id_fk" FOREIGN KEY ("current_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_parent_container_id_containers_id_fk" FOREIGN KEY ("parent_container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_packed_by_users_id_fk" FOREIGN KEY ("packed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_request_lines" ADD CONSTRAINT "transfer_request_lines_transfer_request_id_transfer_requests_id_fk" FOREIGN KEY ("transfer_request_id") REFERENCES "public"."transfer_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_request_lines" ADD CONSTRAINT "transfer_request_lines_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_request_lines" ADD CONSTRAINT "transfer_request_lines_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_request_lines" ADD CONSTRAINT "transfer_request_lines_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_request_lines" ADD CONSTRAINT "transfer_request_lines_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_request_lines" ADD CONSTRAINT "transfer_request_lines_issue_movement_id_stock_movements_id_fk" FOREIGN KEY ("issue_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_request_lines" ADD CONSTRAINT "transfer_request_lines_receipt_movement_id_stock_movements_id_fk" FOREIGN KEY ("receipt_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_request_lines" ADD CONSTRAINT "transfer_request_lines_destination_lot_id_inventory_lots_id_fk" FOREIGN KEY ("destination_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_request_lines" ADD CONSTRAINT "transfer_request_lines_reversal_movement_id_stock_movements_id_fk" FOREIGN KEY ("reversal_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_to_site_id_sites_id_fk" FOREIGN KEY ("to_site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_undone_by_users_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_stock_adjustment_id_stock_adjustments_id_fk" FOREIGN KEY ("stock_adjustment_id") REFERENCES "public"."stock_adjustments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_new_lot_material_id_materials_id_fk" FOREIGN KEY ("new_lot_material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_new_lot_product_id_products_id_fk" FOREIGN KEY ("new_lot_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_stock_movement_id_stock_movements_id_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_approval_decisions" ADD CONSTRAINT "stock_approval_decisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_approval_decisions" ADD CONSTRAINT "stock_approval_decisions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_approval_decisions" ADD CONSTRAINT "stock_approval_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_counters" ADD CONSTRAINT "stock_count_counters_stock_count_id_stock_counts_id_fk" FOREIGN KEY ("stock_count_id") REFERENCES "public"."stock_counts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_counters" ADD CONSTRAINT "stock_count_counters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_stock_count_id_stock_counts_id_fk" FOREIGN KEY ("stock_count_id") REFERENCES "public"."stock_counts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_stock_count_line_id_stock_count_lines_id_fk" FOREIGN KEY ("stock_count_line_id") REFERENCES "public"."stock_count_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_stock_count_id_stock_counts_id_fk" FOREIGN KEY ("stock_count_id") REFERENCES "public"."stock_counts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_adjustment_movement_id_stock_movements_id_fk" FOREIGN KEY ("adjustment_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_scopes" ADD CONSTRAINT "stock_count_scopes_stock_count_id_stock_counts_id_fk" FOREIGN KEY ("stock_count_id") REFERENCES "public"."stock_counts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_scopes" ADD CONSTRAINT "stock_count_scopes_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_scopes" ADD CONSTRAINT "stock_count_scopes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_settings" ADD CONSTRAINT "inventory_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_settings" ADD CONSTRAINT "inventory_settings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_settings" ADD CONSTRAINT "inventory_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
CREATE UNIQUE INDEX "uq_file_attachments_bucket_key" ON "file_attachments" USING btree ("bucket_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_file_attachments_org_idem" ON "file_attachments" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_file_attachments_entity" ON "file_attachments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_lot_documents_file" ON "supplier_lot_documents" USING btree ("file_attachment_id");--> statement-breakpoint
CREATE INDEX "ix_supplier_lot_documents_line" ON "supplier_lot_documents" USING btree ("goods_receipt_line_id");--> statement-breakpoint
CREATE INDEX "ix_supplier_lot_documents_lot" ON "supplier_lot_documents" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_materials_pair" ON "supplier_materials" USING btree ("supplier_id","material_id");--> statement-breakpoint
CREATE INDEX "ix_supplier_materials_material" ON "supplier_materials" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_suppliers_org_code" ON "suppliers" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_suppliers_org_name" ON "suppliers" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "uq_quality_hold_lots_pair" ON "quality_hold_lots" USING btree ("quality_hold_id","lot_id");--> statement-breakpoint
CREATE INDEX "ix_quality_hold_lots_lot" ON "quality_hold_lots" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "ix_quality_hold_transitions_hold" ON "quality_hold_state_transitions" USING btree ("quality_hold_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_quality_holds_org_number" ON "quality_holds" USING btree ("organization_id","hold_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_quality_holds_org_idem" ON "quality_holds" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_quality_holds_site_status" ON "quality_holds" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_quality_holds_lot" ON "quality_holds" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "ix_quality_holds_location" ON "quality_holds" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "container_contents_container_lot_uq" ON "container_contents" USING btree ("container_id","lot_id");--> statement-breakpoint
CREATE INDEX "container_contents_lot_idx" ON "container_contents" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "container_lineage_parent_idx" ON "container_lineage" USING btree ("parent_container_id");--> statement-breakpoint
CREATE INDEX "container_lineage_child_idx" ON "container_lineage" USING btree ("child_container_id");--> statement-breakpoint
CREATE UNIQUE INDEX "containers_org_number_uq" ON "containers" USING btree ("organization_id","container_number");--> statement-breakpoint
CREATE INDEX "containers_site_location_idx" ON "containers" USING btree ("site_id","current_location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_request_lines_uq" ON "transfer_request_lines" USING btree ("transfer_request_id","line_no");--> statement-breakpoint
CREATE INDEX "transfer_request_lines_lot_idx" ON "transfer_request_lines" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_requests_org_number_uq" ON "transfer_requests" USING btree ("organization_id","transfer_number");--> statement-breakpoint
CREATE INDEX "transfer_requests_site_time_idx" ON "transfer_requests" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "transfer_requests_container_idx" ON "transfer_requests" USING btree ("container_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_adjustment_lines_uq" ON "stock_adjustment_lines" USING btree ("stock_adjustment_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_adjustments_org_number_uq" ON "stock_adjustments" USING btree ("organization_id","adjustment_number");--> statement-breakpoint
CREATE INDEX "stock_adjustments_site_status_idx" ON "stock_adjustments" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "stock_approval_decisions_record_idx" ON "stock_approval_decisions" USING btree ("record_type","record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_approval_decisions_uq" ON "stock_approval_decisions" USING btree ("record_type","record_id","step","decided_by","decision");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_counters_uq" ON "stock_count_counters" USING btree ("stock_count_id","user_id");--> statement-breakpoint
CREATE INDEX "stock_count_entries_line_idx" ON "stock_count_entries" USING btree ("stock_count_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_entries_idem_uq" ON "stock_count_entries" USING btree ("stock_count_id","idempotency_key") WHERE "stock_count_entries"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "stock_count_lines_count_idx" ON "stock_count_lines" USING btree ("stock_count_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_lines_lot_location_uq" ON "stock_count_lines" USING btree ("stock_count_id","location_id","lot_id") WHERE "stock_count_lines"."lot_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_scopes_uq" ON "stock_count_scopes" USING btree ("stock_count_id","location_id");--> statement-breakpoint
CREATE INDEX "stock_count_scopes_location_idx" ON "stock_count_scopes" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_counts_org_number_uq" ON "stock_counts" USING btree ("organization_id","count_number");--> statement-breakpoint
CREATE INDEX "stock_counts_site_status_idx" ON "stock_counts" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "allocation_rules_org_scope_idx" ON "allocation_rules" USING btree ("organization_id","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_reservations_org_number_uq" ON "stock_reservations" USING btree ("organization_id","reservation_number");--> statement-breakpoint
CREATE INDEX "stock_reservations_lot_location_idx" ON "stock_reservations" USING btree ("lot_id","location_id");--> statement-breakpoint
CREATE INDEX "stock_reservations_site_status_idx" ON "stock_reservations" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "stock_reservations_demand_idx" ON "stock_reservations" USING btree ("demand_type","demand_id");--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD CONSTRAINT "formula_revisions_supersedes_id_formula_revisions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."formula_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formula_revisions" ADD CONSTRAINT "formula_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_routing_revision_id_routing_revisions_id_fk" FOREIGN KEY ("routing_revision_id") REFERENCES "public"."routing_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_work_instruction_revision_id_work_instruction_revisions_id_fk" FOREIGN KEY ("work_instruction_revision_id") REFERENCES "public"."work_instruction_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_inspection_plan_id_inspection_plans_id_fk" FOREIGN KEY ("inspection_plan_id") REFERENCES "public"."inspection_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_discrepancy_recorded_by_users_id_fk" FOREIGN KEY ("discrepancy_recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_discrepancy_approved_by_users_id_fk" FOREIGN KEY ("discrepancy_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_stock_movement_id_stock_movements_id_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_routing_revision_id_routing_revisions_id_fk" FOREIGN KEY ("routing_revision_id") REFERENCES "public"."routing_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_inspection_plan_id_inspection_plans_id_fk" FOREIGN KEY ("inspection_plan_id") REFERENCES "public"."inspection_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bom_lines_rev_line_uq" ON "bom_lines" USING btree ("formula_revision_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "formula_rev_one_open_uq" ON "formula_revisions" USING btree ("formula_id") WHERE "formula_revisions"."status" in ('draft', 'pending_approval');--> statement-breakpoint
CREATE UNIQUE INDEX "routing_steps_rev_step_uq" ON "routing_steps" USING btree ("routing_revision_id","step_no");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_goods_receipt_lines_no" ON "goods_receipt_lines" USING btree ("goods_receipt_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_goods_receipt_lines_lot" ON "goods_receipt_lines" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_goods_receipts_org_number" ON "goods_receipts" USING btree ("organization_id","receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_goods_receipts_org_idem" ON "goods_receipts" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_goods_receipts_site_status" ON "goods_receipts" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_goods_receipts_supplier" ON "goods_receipts" USING btree ("supplier_id");--> statement-breakpoint
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
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_equipment_ck" CHECK (not "routing_steps"."requires_equipment" or "routing_steps"."equipment_kind" is not null);--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "ck_goods_receipt_lines_qty" CHECK ("goods_receipt_lines"."qty_base" > 0 and ("goods_receipt_lines"."qty_entered" is null or "goods_receipt_lines"."qty_entered" > 0));--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "ck_goods_receipt_lines_containers" CHECK ("goods_receipt_lines"."container_count" is null or "goods_receipt_lines"."container_count" > 0);--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "ck_goods_receipt_lines_initial_status" CHECK ("goods_receipt_lines"."initial_quality_status" in ('quarantine','released'));--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "ck_goods_receipt_lines_discrepancy_kind" CHECK ("goods_receipt_lines"."discrepancy_kind" is null or "goods_receipt_lines"."discrepancy_kind" in ('short','over','damaged','wrong_item','missing_documents'));--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "ck_goods_receipt_lines_discrepancy_sod" CHECK ("goods_receipt_lines"."discrepancy_approved_by" is null or "goods_receipt_lines"."discrepancy_approved_by" <> "goods_receipt_lines"."discrepancy_recorded_by");--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "ck_goods_receipt_lines_dates" CHECK ("goods_receipt_lines"."expires_on" is null or "goods_receipt_lines"."manufactured_on" is null or "goods_receipt_lines"."expires_on" > "goods_receipt_lines"."manufactured_on");--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "ck_goods_receipts_status" CHECK ("goods_receipts"."status" in ('draft','posted','cancelled','reversed'));--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "ck_goods_receipts_kind" CHECK ("goods_receipts"."receipt_kind" in ('unplanned','purchase_order','opening_balance'));--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "ck_goods_receipts_number" CHECK ("goods_receipts"."status" in ('draft','cancelled') or "goods_receipts"."receipt_number" is not null);--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "ck_goods_receipts_posted" CHECK ("goods_receipts"."status" in ('draft','cancelled') or ("goods_receipts"."posted_at" is not null and "goods_receipts"."posted_by" is not null));--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "ck_goods_receipts_reversed" CHECK ("goods_receipts"."status" <> 'reversed' or ("goods_receipts"."reversed_at" is not null and "goods_receipts"."reversal_reason" is not null));--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "ck_goods_receipts_cancelled" CHECK ("goods_receipts"."status" <> 'cancelled' or ("goods_receipts"."cancelled_at" is not null and "goods_receipts"."cancel_reason" is not null));
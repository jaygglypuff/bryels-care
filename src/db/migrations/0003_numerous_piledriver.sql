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
ALTER TABLE "dispense_records" ALTER COLUMN "checker_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "process_step_records" ALTER COLUMN "completed_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "process_step_records" ALTER COLUMN "completed_at" DROP NOT NULL;--> statement-breakpoint
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
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_exception_approved_by_users_id_fk" FOREIGN KEY ("exception_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_supersedes_id_dispense_records_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."dispense_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD CONSTRAINT "process_step_records_exception_approved_by_users_id_fk" FOREIGN KEY ("exception_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dispense_records_line_seq_uq" ON "dispense_records" USING btree ("batch_material_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "dispense_records_supersedes_uq" ON "dispense_records" USING btree ("supersedes_id") WHERE "dispense_records"."supersedes_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "process_step_records_batch_step_uq" ON "process_step_records" USING btree ("batch_id","step_no");--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_qty_ck" CHECK ("dispense_records"."actual_qty_g" > 0);--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_sod_ck" CHECK ("dispense_records"."checker_id" is null or "dispense_records"."checker_id" <> "dispense_records"."operator_id");--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_exception_sod_ck" CHECK ("dispense_records"."exception_approved_by" is null or ("dispense_records"."exception_approved_by" <> "dispense_records"."operator_id" and "dispense_records"."exception_reason" is not null));--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_correction_ck" CHECK ("dispense_records"."supersedes_id" is null or "dispense_records"."correction_reason" is not null);--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_void_ck" CHECK ("dispense_records"."voided_at" is null or ("dispense_records"."voided_by" is not null and "dispense_records"."void_reason" is not null));--> statement-breakpoint
ALTER TABLE "process_step_records" ADD CONSTRAINT "process_step_records_status_ck" CHECK ("process_step_records"."status" in ('pending', 'in_progress', 'awaiting_check', 'completed', 'skipped'));--> statement-breakpoint
ALTER TABLE "process_step_records" ADD CONSTRAINT "process_step_records_sod_ck" CHECK ("process_step_records"."checked_by" is null or "process_step_records"."checked_by" <> "process_step_records"."conducted_by");--> statement-breakpoint
ALTER TABLE "process_step_records" ADD CONSTRAINT "process_step_records_completed_ck" CHECK ("process_step_records"."status" <> 'completed' or "process_step_records"."completed_at" is not null);--> statement-breakpoint
ALTER TABLE "process_step_records" ADD CONSTRAINT "process_step_records_exception_ck" CHECK ("process_step_records"."exception_approved_by" is null or ("process_step_records"."exception_approved_by" <> "process_step_records"."conducted_by" and "process_step_records"."exception_reason" is not null));
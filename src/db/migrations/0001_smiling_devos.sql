CREATE TABLE "document_template_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_template_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"definition" jsonb NOT NULL,
	"definition_checksum" text NOT NULL,
	"change_note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"retired_by" uuid,
	"retired_at" timestamp with time zone,
	"retire_reason" text,
	CONSTRAINT "document_template_versions_status_ck" CHECK ("document_template_versions"."status" in ('draft', 'pending_approval', 'approved', 'retired')),
	CONSTRAINT "document_template_versions_sod_ck" CHECK ("document_template_versions"."approved_by" is null or "document_template_versions"."submitted_by" is null or "document_template_versions"."approved_by" <> "document_template_versions"."submitted_by"),
	CONSTRAINT "document_template_versions_approved_ck" CHECK ("document_template_versions"."status" <> 'approved' or ("document_template_versions"."approved_by" is not null and "document_template_versions"."approved_at" is not null and "document_template_versions"."effective_from" is not null)),
	CONSTRAINT "document_template_versions_retired_ck" CHECK ("document_template_versions"."status" <> 'retired' or ("document_template_versions"."retired_by" is not null and "document_template_versions"."retired_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"template_kind" text NOT NULL,
	"page_size" text DEFAULT 'A4' NOT NULL,
	"orientation" text DEFAULT 'portrait' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_templates_kind_ck" CHECK ("document_templates"."template_kind" in ('bmr', 'dispensing_sheet', 'traveler', 'boxing_note', 'delivery_receipt', 'pick_list', 'label', 'stock_card', 'goods_receipt', 'count_sheet', 'variance_report', 'hold_notice', 'coa', 'deviation_report', 'traceability_report', 'supplier_return', 'purchase_order', 'quotation', 'order_confirmation', 'invoice', 'statement', 'payslip', 'attendance_exception_report', 'recall_notice', 'return_receipt', 'report', 'test_page', 'other')),
	CONSTRAINT "document_templates_page_size_ck" CHECK ("document_templates"."page_size" in ('A4', 'Letter', 'label')),
	CONSTRAINT "document_templates_orientation_ck" CHECK ("document_templates"."orientation" in ('portrait', 'landscape')),
	CONSTRAINT "document_templates_code_ck" CHECK ("document_templates"."code" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "generated_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"document_template_version_id" uuid NOT NULL,
	"document_kind" text NOT NULL,
	"source_entity_type" text NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"source_revision_at" timestamp with time zone NOT NULL,
	"document_number" text NOT NULL,
	"status" text DEFAULT 'rendering' NOT NULL,
	"superseded_by_id" uuid,
	"record_revision_no" integer NOT NULL,
	"source_state" text,
	"watermark" text,
	"output_format" text DEFAULT 'html' NOT NULL,
	"dataset" jsonb NOT NULL,
	"checksum_sha256" text,
	"page_count" integer,
	"file_attachment_id" uuid,
	"error_message" text,
	"generated_by" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rendered_at" timestamp with time zone,
	"background_job_id" uuid,
	"reprint_of_id" uuid,
	"reprint_no" integer DEFAULT 0 NOT NULL,
	"reprint_reason_code" text,
	"reprint_note" text,
	"parameters" jsonb,
	"idempotency_key" text,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	CONSTRAINT "generated_documents_status_ck" CHECK ("generated_documents"."status" in ('rendering', 'ready', 'failed', 'superseded', 'void')),
	CONSTRAINT "generated_documents_format_ck" CHECK ("generated_documents"."output_format" in ('html', 'pdf')),
	CONSTRAINT "generated_documents_ready_ck" CHECK ("generated_documents"."status" <> 'ready' or ("generated_documents"."checksum_sha256" is not null and ("generated_documents"."output_format" = 'html' or "generated_documents"."file_attachment_id" is not null))),
	CONSTRAINT "generated_documents_reprint_ck" CHECK (("generated_documents"."reprint_of_id" is null and "generated_documents"."reprint_no" = 0) or ("generated_documents"."reprint_of_id" is not null and "generated_documents"."reprint_no" > 0 and "generated_documents"."reprint_reason_code" is not null)),
	CONSTRAINT "generated_documents_void_ck" CHECK ("generated_documents"."status" <> 'void' or ("generated_documents"."voided_by" is not null and "generated_documents"."voided_at" is not null and "generated_documents"."void_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "label_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"label_template_id" uuid NOT NULL,
	"document_template_version_id" uuid NOT NULL,
	"print_station_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_number" text NOT NULL,
	"copies" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"printer_name" text,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"generated_document_id" uuid,
	"reprint_of_id" uuid,
	"reprint_no" integer DEFAULT 0 NOT NULL,
	"reprint_reason_code" text,
	"reprint_note" text,
	"idempotency_key" text,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"printed_by" uuid,
	"printed_at" timestamp with time zone,
	"station_device_registration_id" uuid,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	CONSTRAINT "label_jobs_status_ck" CHECK ("label_jobs"."status" in ('queued', 'rendering', 'ready', 'printed', 'failed', 'cancelled')),
	CONSTRAINT "label_jobs_entity_type_ck" CHECK ("label_jobs"."entity_type" in ('inventory_lot', 'container', 'location', 'batch', 'inspection_sample', 'equipment')),
	CONSTRAINT "label_jobs_copies_ck" CHECK ("label_jobs"."copies" between 1 and 99),
	CONSTRAINT "label_jobs_reprint_ck" CHECK (("label_jobs"."reprint_of_id" is null and "label_jobs"."reprint_no" = 0) or ("label_jobs"."reprint_of_id" is not null and "label_jobs"."reprint_no" > 0 and "label_jobs"."reprint_reason_code" is not null)),
	CONSTRAINT "label_jobs_void_ck" CHECK (("label_jobs"."voided_at" is null and "label_jobs"."voided_by" is null and "label_jobs"."void_reason" is null) or ("label_jobs"."voided_at" is not null and "label_jobs"."voided_by" is not null and "label_jobs"."void_reason" is not null)),
	CONSTRAINT "label_jobs_printed_ck" CHECK ("label_jobs"."status" <> 'printed' or ("label_jobs"."printed_by" is not null and "label_jobs"."printed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "label_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"document_template_id" uuid NOT NULL,
	"applies_to" text NOT NULL,
	"symbology" text DEFAULT 'qr' NOT NULL,
	"copies_default" integer DEFAULT 1 NOT NULL,
	"fields" jsonb,
	"media_width_mm" numeric(6, 1) NOT NULL,
	"media_height_mm" numeric(6, 1) NOT NULL,
	"dpi" integer DEFAULT 203 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	CONSTRAINT "label_templates_applies_to_ck" CHECK ("label_templates"."applies_to" in ('material', 'wip', 'finished_good', 'carton', 'pallet', 'location', 'equipment', 'sample')),
	CONSTRAINT "label_templates_symbology_ck" CHECK ("label_templates"."symbology" in ('qr', 'code128', 'ean13')),
	CONSTRAINT "label_templates_status_ck" CHECK ("label_templates"."status" in ('draft', 'approved', 'retired')),
	CONSTRAINT "label_templates_copies_ck" CHECK ("label_templates"."copies_default" between 1 and 99),
	CONSTRAINT "label_templates_media_ck" CHECK ("label_templates"."media_width_mm" between 20 and 220 and "label_templates"."media_height_mm" between 15 and 300),
	CONSTRAINT "label_templates_dpi_ck" CHECK ("label_templates"."dpi" in (203, 300, 600)),
	CONSTRAINT "label_templates_sod_ck" CHECK ("label_templates"."approved_by" is null or "label_templates"."approved_by" <> "label_templates"."updated_by"),
	CONSTRAINT "label_templates_code_ck" CHECK ("label_templates"."code" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "print_stations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"printer_name" text NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "print_stations_code_ck" CHECK ("print_stations"."code" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_document_template_id_document_templates_id_fk" FOREIGN KEY ("document_template_id") REFERENCES "public"."document_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_retired_by_users_id_fk" FOREIGN KEY ("retired_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_document_template_version_id_document_template_versions_id_fk" FOREIGN KEY ("document_template_version_id") REFERENCES "public"."document_template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_superseded_by_id_generated_documents_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."generated_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_reprint_of_id_generated_documents_id_fk" FOREIGN KEY ("reprint_of_id") REFERENCES "public"."generated_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_jobs" ADD CONSTRAINT "label_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_jobs" ADD CONSTRAINT "label_jobs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_jobs" ADD CONSTRAINT "label_jobs_label_template_id_label_templates_id_fk" FOREIGN KEY ("label_template_id") REFERENCES "public"."label_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_jobs" ADD CONSTRAINT "label_jobs_document_template_version_id_document_template_versions_id_fk" FOREIGN KEY ("document_template_version_id") REFERENCES "public"."document_template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_jobs" ADD CONSTRAINT "label_jobs_print_station_id_print_stations_id_fk" FOREIGN KEY ("print_station_id") REFERENCES "public"."print_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_jobs" ADD CONSTRAINT "label_jobs_generated_document_id_generated_documents_id_fk" FOREIGN KEY ("generated_document_id") REFERENCES "public"."generated_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_jobs" ADD CONSTRAINT "label_jobs_reprint_of_id_label_jobs_id_fk" FOREIGN KEY ("reprint_of_id") REFERENCES "public"."label_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_jobs" ADD CONSTRAINT "label_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_jobs" ADD CONSTRAINT "label_jobs_printed_by_users_id_fk" FOREIGN KEY ("printed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_jobs" ADD CONSTRAINT "label_jobs_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_jobs" ADD CONSTRAINT "label_jobs_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_templates" ADD CONSTRAINT "label_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_templates" ADD CONSTRAINT "label_templates_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_templates" ADD CONSTRAINT "label_templates_document_template_id_document_templates_id_fk" FOREIGN KEY ("document_template_id") REFERENCES "public"."document_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_templates" ADD CONSTRAINT "label_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_templates" ADD CONSTRAINT "label_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_templates" ADD CONSTRAINT "label_templates_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_stations" ADD CONSTRAINT "print_stations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_stations" ADD CONSTRAINT "print_stations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_stations" ADD CONSTRAINT "print_stations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_template_versions_no_uq" ON "document_template_versions" USING btree ("document_template_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "document_template_versions_one_approved_uq" ON "document_template_versions" USING btree ("document_template_id") WHERE "document_template_versions"."status" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "document_templates_org_code_uq" ON "document_templates" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "generated_documents_org_number_uq" ON "generated_documents" USING btree ("organization_id","document_number");--> statement-breakpoint
CREATE UNIQUE INDEX "generated_documents_org_idem_uq" ON "generated_documents" USING btree ("organization_id","idempotency_key") WHERE "generated_documents"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "generated_documents_revision_uq" ON "generated_documents" USING btree ("source_entity_type","source_entity_id","document_kind","record_revision_no") WHERE "generated_documents"."reprint_of_id" is null;--> statement-breakpoint
CREATE INDEX "generated_documents_source_idx" ON "generated_documents" USING btree ("source_entity_type","source_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "label_jobs_org_idem_uq" ON "label_jobs" USING btree ("organization_id","idempotency_key") WHERE "label_jobs"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "label_jobs_station_status_idx" ON "label_jobs" USING btree ("print_station_id","status");--> statement-breakpoint
CREATE INDEX "label_jobs_entity_idx" ON "label_jobs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "label_templates_org_code_uq" ON "label_templates" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "print_stations_site_code_uq" ON "print_stations" USING btree ("site_id","code");
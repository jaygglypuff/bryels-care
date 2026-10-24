CREATE TABLE "import_job_rows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"import_job_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"values" jsonb,
	"result" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"errors" jsonb,
	"warnings" jsonb,
	"group_key" text,
	"hold_on_post" boolean DEFAULT false NOT NULL,
	"duplicate_tier" integer,
	"match_entity_type" text,
	"match_entity_id" uuid,
	"match_label" text,
	"decision" text,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_entity_type" text,
	"created_entity_id" uuid,
	"created_entity_label" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_import_job_rows_result" CHECK ("import_job_rows"."result" in ('pending','accepted','hold','duplicate','possible_duplicate','rejected','failed')),
	CONSTRAINT "ck_import_job_rows_decision" CHECK ("import_job_rows"."decision" is null or "import_job_rows"."decision" in ('same_as_existing','new_record','reject')),
	CONSTRAINT "ck_import_job_rows_decided" CHECK (("import_job_rows"."decision" is null) = ("import_job_rows"."decided_by" is null)),
	CONSTRAINT "ck_import_job_rows_tier" CHECK ("import_job_rows"."duplicate_tier" is null or "import_job_rows"."duplicate_tier" in (1, 2, 3)),
	CONSTRAINT "ck_import_job_rows_posted" CHECK (("import_job_rows"."created_entity_id" is null) = ("import_job_rows"."posted_at" is null))
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"import_number" text NOT NULL,
	"import_kind" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"source" text DEFAULT 'wizard' NOT NULL,
	"file_attachment_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_format" text NOT NULL,
	"checksum_sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"headers" jsonb NOT NULL,
	"file_notes" jsonb,
	"import_mapping_id" uuid,
	"mapping" jsonb,
	"run_no" integer DEFAULT 0 NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_accepted" integer DEFAULT 0 NOT NULL,
	"rows_hold" integer DEFAULT 0 NOT NULL,
	"rows_duplicate" integer DEFAULT 0 NOT NULL,
	"rows_possible_duplicate" integer DEFAULT 0 NOT NULL,
	"rows_rejected" integer DEFAULT 0 NOT NULL,
	"rows_warned" integer DEFAULT 0 NOT NULL,
	"rows_created" integer DEFAULT 0 NOT NULL,
	"rows_failed" integer DEFAULT 0 NOT NULL,
	"error_file_attachment_id" uuid,
	"reupload_reason" text,
	"failure_message" text,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validated_at" timestamp with time zone,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"reject_reason" text,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"idempotency_key" text NOT NULL,
	"correlation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_import_jobs_kind" CHECK ("import_jobs"."import_kind" in ('attendance','materials','skus','suppliers','customers','price_lists','locations','uom_conversions','reason_codes','legacy_documents','opening_stock','open_sales_orders','open_purchase_orders','employees','equipment','other')),
	CONSTRAINT "ck_import_jobs_status" CHECK ("import_jobs"."status" in ('uploaded','validating','validated','under_review','submitted','approved','posting','posted','failed','rejected','voided')),
	CONSTRAINT "ck_import_jobs_source" CHECK ("import_jobs"."source" in ('wizard','loader')),
	CONSTRAINT "ck_import_jobs_format" CHECK ("import_jobs"."file_format" in ('csv','xlsx')),
	CONSTRAINT "ck_import_jobs_sod" CHECK ("import_jobs"."approved_by" is null or "import_jobs"."submitted_by" is not null),
	CONSTRAINT "ck_import_jobs_posted" CHECK ("import_jobs"."status" not in ('posted','voided') or ("import_jobs"."posted_at" is not null and "import_jobs"."posted_by" is not null)),
	CONSTRAINT "ck_import_jobs_voided" CHECK ("import_jobs"."status" <> 'voided' or ("import_jobs"."voided_at" is not null and "import_jobs"."void_reason" is not null)),
	CONSTRAINT "ck_import_jobs_rejected" CHECK ("import_jobs"."status" <> 'rejected' or "import_jobs"."reject_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "import_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"import_kind" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"definition" jsonb NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_import_mappings_kind" CHECK ("import_mappings"."import_kind" in ('attendance','materials','skus','suppliers','customers','price_lists','locations','uom_conversions','reason_codes','legacy_documents','opening_stock','open_sales_orders','open_purchase_orders','employees','equipment','other')),
	CONSTRAINT "ck_import_mappings_code" CHECK ("import_mappings"."code" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
	CONSTRAINT "ck_import_mappings_version" CHECK ("import_mappings"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "legacy_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"document_number" text NOT NULL,
	"legacy_kind" text NOT NULL,
	"legacy_number" text NOT NULL,
	"product_id" uuid,
	"formula_number" text,
	"batch_size_qty" numeric(18, 6),
	"batch_size_uom_id" uuid,
	"start_date" date,
	"end_date" date,
	"expiry_date" date,
	"disposition" text,
	"qa_name" text,
	"remarks" text,
	"file_attachment_id" uuid NOT NULL,
	"import_job_id" uuid,
	"import_job_row_id" uuid,
	"indexed_by" uuid NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_legacy_documents_kind" CHECK ("legacy_documents"."legacy_kind" in ('bmr','dr','invoice','test_record','other')),
	CONSTRAINT "ck_legacy_documents_disposition" CHECK ("legacy_documents"."disposition" is null or "legacy_documents"."disposition" in ('approved','disapproved','unknown')),
	CONSTRAINT "ck_legacy_documents_batch_size" CHECK ("legacy_documents"."batch_size_qty" is null or "legacy_documents"."batch_size_qty" > 0),
	CONSTRAINT "ck_legacy_documents_dates" CHECK ("legacy_documents"."end_date" is null or "legacy_documents"."start_date" is null or "legacy_documents"."end_date" >= "legacy_documents"."start_date"),
	CONSTRAINT "ck_legacy_documents_verifier" CHECK ("legacy_documents"."verified_by" is null or "legacy_documents"."verified_by" <> "legacy_documents"."indexed_by"),
	CONSTRAINT "ck_legacy_documents_verified" CHECK (("legacy_documents"."verified_by" is null) = ("legacy_documents"."verified_at" is null)),
	CONSTRAINT "ck_legacy_documents_voided" CHECK (("legacy_documents"."voided_at" is null) = ("legacy_documents"."void_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "material_aliases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"source" text DEFAULT 'import' NOT NULL,
	"import_job_row_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_material_aliases_source" CHECK ("material_aliases"."source" in ('import','manual'))
);
--> statement-breakpoint
CREATE TABLE "opening_balance_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	"import_job_id" uuid NOT NULL,
	"import_job_row_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_kind" text NOT NULL,
	"material_id" uuid,
	"product_id" uuid,
	"lot_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"qty_entered" numeric(18, 6) NOT NULL,
	"uom_entered" text NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"count_sheet_ref" text NOT NULL,
	"counted_by" text NOT NULL,
	"checked_by" text NOT NULL,
	"initial_quality_status" text NOT NULL,
	"hold_reason_code" text,
	"hold_reason_note" text,
	"quality_status_claimed" text,
	"container_count" integer DEFAULT 0 NOT NULL,
	"unit_cost" numeric(18, 4),
	"currency" text,
	"notes" text,
	"stock_movement_id" uuid NOT NULL,
	"reversal_movement_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_opening_balance_lines_item" CHECK (("opening_balance_lines"."item_kind" = 'material' and "opening_balance_lines"."material_id" is not null and "opening_balance_lines"."product_id" is null) or ("opening_balance_lines"."item_kind" = 'product' and "opening_balance_lines"."product_id" is not null and "opening_balance_lines"."material_id" is null)),
	CONSTRAINT "ck_opening_balance_lines_qty" CHECK ("opening_balance_lines"."qty_base" > 0 and "opening_balance_lines"."qty_entered" > 0),
	CONSTRAINT "ck_opening_balance_lines_status" CHECK ("opening_balance_lines"."initial_quality_status" in ('quarantine','on_hold','expired')),
	CONSTRAINT "ck_opening_balance_lines_counter" CHECK (lower("opening_balance_lines"."counted_by") <> lower("opening_balance_lines"."checked_by")),
	CONSTRAINT "ck_opening_balance_lines_hold_reason" CHECK ("opening_balance_lines"."initial_quality_status" <> 'on_hold' or "opening_balance_lines"."hold_reason_code" is not null)
);
--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "legacy_number" text;--> statement-breakpoint
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_file_attachment_id_file_attachments_id_fk" FOREIGN KEY ("file_attachment_id") REFERENCES "public"."file_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_import_mapping_id_import_mappings_id_fk" FOREIGN KEY ("import_mapping_id") REFERENCES "public"."import_mappings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_error_file_attachment_id_file_attachments_id_fk" FOREIGN KEY ("error_file_attachment_id") REFERENCES "public"."file_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_batch_size_uom_id_uoms_id_fk" FOREIGN KEY ("batch_size_uom_id") REFERENCES "public"."uoms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_file_attachment_id_file_attachments_id_fk" FOREIGN KEY ("file_attachment_id") REFERENCES "public"."file_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_import_job_row_id_import_job_rows_id_fk" FOREIGN KEY ("import_job_row_id") REFERENCES "public"."import_job_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_indexed_by_users_id_fk" FOREIGN KEY ("indexed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_aliases" ADD CONSTRAINT "material_aliases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_aliases" ADD CONSTRAINT "material_aliases_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_aliases" ADD CONSTRAINT "material_aliases_import_job_row_id_import_job_rows_id_fk" FOREIGN KEY ("import_job_row_id") REFERENCES "public"."import_job_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_aliases" ADD CONSTRAINT "material_aliases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_goods_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_import_job_row_id_import_job_rows_id_fk" FOREIGN KEY ("import_job_row_id") REFERENCES "public"."import_job_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_stock_movement_id_stock_movements_id_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_reversal_movement_id_stock_movements_id_fk" FOREIGN KEY ("reversal_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_import_job_rows_row" ON "import_job_rows" USING btree ("import_job_id","row_no");--> statement-breakpoint
CREATE INDEX "ix_import_job_rows_result" ON "import_job_rows" USING btree ("import_job_id","result");--> statement-breakpoint
CREATE INDEX "ix_import_job_rows_entity" ON "import_job_rows" USING btree ("created_entity_type","created_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_import_jobs_number" ON "import_jobs" USING btree ("organization_id","import_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_import_jobs_idem" ON "import_jobs" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_import_jobs_site_status" ON "import_jobs" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_import_jobs_checksum" ON "import_jobs" USING btree ("organization_id","import_kind","site_id","checksum_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_import_mappings_code_version" ON "import_mappings" USING btree ("organization_id","code","version");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_import_mappings_current" ON "import_mappings" USING btree ("organization_id","code") WHERE "import_mappings"."is_current";--> statement-breakpoint
CREATE INDEX "ix_import_mappings_kind" ON "import_mappings" USING btree ("organization_id","import_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_legacy_documents_number" ON "legacy_documents" USING btree ("organization_id","document_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_legacy_documents_legacy" ON "legacy_documents" USING btree ("organization_id","legacy_kind","legacy_number") WHERE "legacy_documents"."voided_at" is null;--> statement-breakpoint
CREATE INDEX "ix_legacy_documents_product" ON "legacy_documents" USING btree ("product_id","start_date");--> statement-breakpoint
CREATE INDEX "ix_legacy_documents_legacy_number" ON "legacy_documents" USING btree ("organization_id","legacy_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_material_aliases_alias" ON "material_aliases" USING btree ("organization_id",lower("alias"));--> statement-breakpoint
CREATE INDEX "ix_material_aliases_material" ON "material_aliases" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_opening_balance_lines_no" ON "opening_balance_lines" USING btree ("goods_receipt_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_opening_balance_lines_row" ON "opening_balance_lines" USING btree ("import_job_row_id");--> statement-breakpoint
CREATE INDEX "ix_opening_balance_lines_lot" ON "opening_balance_lines" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lots_org_legacy_number_uq" ON "inventory_lots" USING btree ("organization_id","legacy_number") WHERE "inventory_lots"."legacy_number" is not null;
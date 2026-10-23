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
ALTER TABLE "goods_receipt_lines" ALTER COLUMN "lot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipts" ALTER COLUMN "receipt_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "requires_coa" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "requires_incoming_inspection" boolean DEFAULT true NOT NULL;--> statement-breakpoint
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
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_discrepancy_recorded_by_users_id_fk" FOREIGN KEY ("discrepancy_recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_discrepancy_approved_by_users_id_fk" FOREIGN KEY ("discrepancy_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_stock_movement_id_stock_movements_id_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_goods_receipt_lines_no" ON "goods_receipt_lines" USING btree ("goods_receipt_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_goods_receipt_lines_lot" ON "goods_receipt_lines" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_goods_receipts_org_number" ON "goods_receipts" USING btree ("organization_id","receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_goods_receipts_org_idem" ON "goods_receipts" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_goods_receipts_site_status" ON "goods_receipts" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_goods_receipts_supplier" ON "goods_receipts" USING btree ("supplier_id");--> statement-breakpoint
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
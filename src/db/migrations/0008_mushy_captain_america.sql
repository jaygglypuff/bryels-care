CREATE TABLE "delivery_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"dr_number" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"legacy_number" text,
	"issued_at" timestamp with time zone,
	"issued_by" uuid,
	"acknowledged_at" timestamp with time zone,
	"received_by_name" text,
	"received_by_position" text,
	"remarks" text,
	"acknowledgment_kind" text,
	"signature_attachment_id" uuid,
	"acknowledged_by_user_id" uuid,
	"generated_document_id" uuid,
	"copies_printed" integer DEFAULT 0 NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_delivery_receipts_status" CHECK ("delivery_receipts"."status" in ('draft','issued','acknowledged','voided')),
	CONSTRAINT "ck_delivery_receipts_kind" CHECK ("delivery_receipts"."acknowledgment_kind" is null or "delivery_receipts"."acknowledgment_kind" in ('drawn','photo','name_only')),
	CONSTRAINT "ck_delivery_receipts_issued" CHECK ("delivery_receipts"."status" not in ('issued','acknowledged') or ("delivery_receipts"."dr_number" is not null and "delivery_receipts"."issued_at" is not null)),
	CONSTRAINT "ck_delivery_receipts_ack" CHECK ("delivery_receipts"."status" <> 'acknowledged' or ("delivery_receipts"."acknowledged_at" is not null and "delivery_receipts"."received_by_name" is not null and "delivery_receipts"."acknowledgment_kind" is not null and "delivery_receipts"."acknowledged_by_user_id" is not null)),
	CONSTRAINT "ck_delivery_receipts_ack_image" CHECK ("delivery_receipts"."acknowledgment_kind" is null or "delivery_receipts"."acknowledgment_kind" = 'name_only' or "delivery_receipts"."signature_attachment_id" is not null),
	CONSTRAINT "ck_delivery_receipts_void" CHECK ("delivery_receipts"."status" <> 'voided' or ("delivery_receipts"."voided_at" is not null and "delivery_receipts"."voided_by" is not null and "delivery_receipts"."void_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "pack_boxes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"container_id" uuid NOT NULL,
	"box_no" integer NOT NULL,
	"lot_id" uuid NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"is_partial" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'packed' NOT NULL,
	"source_container_ids" jsonb,
	"removed_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_pack_boxes_status" CHECK ("pack_boxes"."status" in ('packed','removed','repacked')),
	CONSTRAINT "ck_pack_boxes_qty" CHECK ("pack_boxes"."qty_base" > 0),
	CONSTRAINT "ck_pack_boxes_removed" CHECK ("pack_boxes"."status" <> 'removed' or "pack_boxes"."removed_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "pack_verification_scans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"container_id" uuid,
	"lot_id" uuid,
	"qty_base" numeric(18, 6),
	"scan_payload" text NOT NULL,
	"scanned_by" uuid NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_registration_id" uuid,
	"result" text NOT NULL,
	"note" text,
	"idempotency_key" text,
	CONSTRAINT "ck_pack_verification_scans_result" CHECK ("pack_verification_scans"."result" in ('ok','not_in_pack','unknown_box','label_mismatch','duplicate'))
);
--> statement-breakpoint
CREATE TABLE "packs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"pack_number" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"source_kind" text NOT NULL,
	"batch_id" uuid,
	"batch_output_id" uuid,
	"sales_order_id" uuid,
	"pick_id" uuid,
	"shipment_id" uuid,
	"product_id" uuid NOT NULL,
	"lot_id" uuid,
	"location_id" uuid,
	"customer_requirement_id" uuid,
	"label_template_id" uuid,
	"label_template_version_id" uuid,
	"units_per_box" integer NOT NULL,
	"expected_units_base" numeric(18, 6),
	"packed_units_base" numeric(18, 6) DEFAULT '0' NOT NULL,
	"box_count" integer DEFAULT 0 NOT NULL,
	"config_snapshot" jsonb NOT NULL,
	"used_default_config" boolean DEFAULT false NOT NULL,
	"verification_mode" text DEFAULT 'all' NOT NULL,
	"verification_sample_size" integer,
	"verification_failure_count" integer DEFAULT 0 NOT NULL,
	"packed_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"checked_by" uuid,
	"verified_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"boxing_note_document_id" uuid,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_packs_status" CHECK ("packs"."status" in ('open','verified','closed','cancelled')),
	CONSTRAINT "ck_packs_source_kind" CHECK ("packs"."source_kind" in ('batch_output','sales_order','repack')),
	CONSTRAINT "ck_packs_verification_mode" CHECK ("packs"."verification_mode" in ('all','sample')),
	CONSTRAINT "ck_packs_source_ref" CHECK (("packs"."source_kind" <> 'batch_output' or "packs"."batch_output_id" is not null) and ("packs"."source_kind" <> 'sales_order' or "packs"."sales_order_id" is not null)),
	CONSTRAINT "ck_packs_checker_not_packer" CHECK ("packs"."checked_by" is null or "packs"."checked_by" <> "packs"."packed_by"),
	CONSTRAINT "ck_packs_verified" CHECK ("packs"."status" not in ('verified','closed') or ("packs"."checked_by" is not null and "packs"."verified_at" is not null)),
	CONSTRAINT "ck_packs_cancelled" CHECK ("packs"."status" <> 'cancelled' or ("packs"."cancelled_by" is not null and "packs"."cancel_reason" is not null)),
	CONSTRAINT "ck_packs_units_per_box" CHECK ("packs"."units_per_box" > 0)
);
--> statement-breakpoint
CREATE TABLE "pick_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"pick_id" uuid NOT NULL,
	"sales_order_line_id" uuid NOT NULL,
	"allocation_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"container_id" uuid,
	"from_location_id" uuid NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"substituted_for_container_id" uuid,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"picked_by" uuid NOT NULL,
	"scan_payload" text,
	"entry_mode" text DEFAULT 'scan' NOT NULL,
	"manual_entry_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"idempotency_key" text,
	CONSTRAINT "ck_pick_lines_qty" CHECK ("pick_lines"."qty_base" > 0),
	CONSTRAINT "ck_pick_lines_mode" CHECK ("pick_lines"."entry_mode" in ('scan','manual')),
	CONSTRAINT "ck_pick_lines_payload" CHECK ("pick_lines"."scan_payload" is not null or "pick_lines"."entry_mode" = 'manual'),
	CONSTRAINT "ck_pick_lines_manual_reason" CHECK ("pick_lines"."entry_mode" <> 'manual' or "pick_lines"."manual_entry_reason" is not null),
	CONSTRAINT "ck_pick_lines_void" CHECK (("pick_lines"."voided_at" is null) = ("pick_lines"."void_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "picks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"pick_number" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"assigned_to" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"short_pick_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"idempotency_key" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_picks_status" CHECK ("picks"."status" in ('draft','in_progress','completed','cancelled')),
	CONSTRAINT "ck_picks_completed" CHECK ("picks"."status" <> 'completed' or ("picks"."completed_at" is not null and "picks"."completed_by" is not null)),
	CONSTRAINT "ck_picks_cancelled" CHECK ("picks"."status" <> 'cancelled' or ("picks"."cancelled_by" is not null and "picks"."cancel_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "shipment_exceptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sales_order_line_id" uuid,
	"extra_qty_base" numeric(18, 6),
	"reason" text NOT NULL,
	"customer_reference" text NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_shipment_exceptions_kind" CHECK ("shipment_exceptions"."kind" in ('over_shipment','partial_shipment')),
	CONSTRAINT "ck_shipment_exceptions_over" CHECK ("shipment_exceptions"."kind" <> 'over_shipment' or ("shipment_exceptions"."sales_order_line_id" is not null and "shipment_exceptions"."extra_qty_base" > 0))
);
--> statement-breakpoint
CREATE TABLE "shipment_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"sales_order_line_id" uuid NOT NULL,
	"allocation_id" uuid,
	"pick_line_id" uuid,
	"container_id" uuid,
	"lot_id" uuid NOT NULL,
	"from_location_id" uuid NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"is_over_shipment" boolean DEFAULT false NOT NULL,
	"stock_movement_id" uuid,
	"verified_by" uuid NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_shipment_lines_qty" CHECK ("shipment_lines"."qty_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "shipment_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"correlation_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "delivery_receipt_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "dispatched_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "dispatched_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "dispatched_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "shipment_number" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "status" text DEFAULT 'dispatched' NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "ship_to_address" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "tracking_number" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "gross_weight" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "weight_uom" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "packed_by" uuid;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "packed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "over_shipment_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "reversed_by" uuid;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "reverse_reason" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "correlation_id" uuid;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "created_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD COLUMN "container_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD COLUMN "fulfilled_shipment_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD COLUMN "released_by" uuid;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD COLUMN "release_reason" text;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_signature_attachment_id_file_attachments_id_fk" FOREIGN KEY ("signature_attachment_id") REFERENCES "public"."file_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_acknowledged_by_user_id_users_id_fk" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_generated_document_id_generated_documents_id_fk" FOREIGN KEY ("generated_document_id") REFERENCES "public"."generated_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_boxes" ADD CONSTRAINT "pack_boxes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_boxes" ADD CONSTRAINT "pack_boxes_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_boxes" ADD CONSTRAINT "pack_boxes_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_boxes" ADD CONSTRAINT "pack_boxes_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_boxes" ADD CONSTRAINT "pack_boxes_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_boxes" ADD CONSTRAINT "pack_boxes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_verification_scans" ADD CONSTRAINT "pack_verification_scans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_verification_scans" ADD CONSTRAINT "pack_verification_scans_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_verification_scans" ADD CONSTRAINT "pack_verification_scans_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_verification_scans" ADD CONSTRAINT "pack_verification_scans_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_verification_scans" ADD CONSTRAINT "pack_verification_scans_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_verification_scans" ADD CONSTRAINT "pack_verification_scans_scanned_by_users_id_fk" FOREIGN KEY ("scanned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_batch_output_id_batch_outputs_id_fk" FOREIGN KEY ("batch_output_id") REFERENCES "public"."batch_outputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_pick_id_picks_id_fk" FOREIGN KEY ("pick_id") REFERENCES "public"."picks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_label_template_id_label_templates_id_fk" FOREIGN KEY ("label_template_id") REFERENCES "public"."label_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_label_template_version_id_document_template_versions_id_fk" FOREIGN KEY ("label_template_version_id") REFERENCES "public"."document_template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_packed_by_users_id_fk" FOREIGN KEY ("packed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_boxing_note_document_id_generated_documents_id_fk" FOREIGN KEY ("boxing_note_document_id") REFERENCES "public"."generated_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_pick_id_picks_id_fk" FOREIGN KEY ("pick_id") REFERENCES "public"."picks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_allocation_id_stock_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."stock_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_substituted_for_container_id_containers_id_fk" FOREIGN KEY ("substituted_for_container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_picked_by_users_id_fk" FOREIGN KEY ("picked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_exceptions" ADD CONSTRAINT "shipment_exceptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_exceptions" ADD CONSTRAINT "shipment_exceptions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_exceptions" ADD CONSTRAINT "shipment_exceptions_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_exceptions" ADD CONSTRAINT "shipment_exceptions_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_exceptions" ADD CONSTRAINT "shipment_exceptions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_allocation_id_stock_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."stock_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_pick_line_id_pick_lines_id_fk" FOREIGN KEY ("pick_line_id") REFERENCES "public"."pick_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_stock_movement_id_stock_movements_id_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_state_transitions" ADD CONSTRAINT "shipment_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_state_transitions" ADD CONSTRAINT "shipment_state_transitions_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_state_transitions" ADD CONSTRAINT "shipment_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_receipts_org_number_uq" ON "delivery_receipts" USING btree ("organization_id","dr_number") WHERE "delivery_receipts"."dr_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_receipts_org_legacy_uq" ON "delivery_receipts" USING btree ("organization_id","legacy_number") WHERE "delivery_receipts"."legacy_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_receipts_shipment_live_uq" ON "delivery_receipts" USING btree ("shipment_id") WHERE "delivery_receipts"."status" <> 'voided';--> statement-breakpoint
CREATE INDEX "delivery_receipts_site_status_idx" ON "delivery_receipts" USING btree ("site_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "pack_boxes_pack_no_uq" ON "pack_boxes" USING btree ("pack_id","box_no");--> statement-breakpoint
CREATE UNIQUE INDEX "pack_boxes_pack_container_uq" ON "pack_boxes" USING btree ("pack_id","container_id");--> statement-breakpoint
CREATE INDEX "pack_boxes_container_idx" ON "pack_boxes" USING btree ("container_id");--> statement-breakpoint
CREATE INDEX "pack_verification_scans_pack_idx" ON "pack_verification_scans" USING btree ("pack_id","scanned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pack_verification_scans_idem_uq" ON "pack_verification_scans" USING btree ("organization_id","idempotency_key") WHERE "pack_verification_scans"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "packs_org_number_uq" ON "packs" USING btree ("organization_id","pack_number");--> statement-breakpoint
CREATE UNIQUE INDEX "packs_org_idem_uq" ON "packs" USING btree ("organization_id","idempotency_key") WHERE "packs"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "packs_shipment_live_uq" ON "packs" USING btree ("shipment_id") WHERE "packs"."shipment_id" is not null and "packs"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "packs_site_status_idx" ON "packs" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "packs_lot_idx" ON "packs" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "pick_lines_pick_idx" ON "pick_lines" USING btree ("pick_id");--> statement-breakpoint
CREATE INDEX "pick_lines_allocation_idx" ON "pick_lines" USING btree ("allocation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pick_lines_idem_uq" ON "pick_lines" USING btree ("organization_id","idempotency_key") WHERE "pick_lines"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pick_lines_pick_box_uq" ON "pick_lines" USING btree ("pick_id","container_id") WHERE "pick_lines"."container_id" is not null and "pick_lines"."voided_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "picks_org_number_uq" ON "picks" USING btree ("organization_id","pick_number");--> statement-breakpoint
CREATE UNIQUE INDEX "picks_org_idem_uq" ON "picks" USING btree ("organization_id","idempotency_key") WHERE "picks"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "picks_order_open_uq" ON "picks" USING btree ("sales_order_id") WHERE "picks"."status" in ('draft','in_progress');--> statement-breakpoint
CREATE INDEX "picks_site_status_idx" ON "picks" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "shipment_exceptions_shipment_idx" ON "shipment_exceptions" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_lines_shipment_idx" ON "shipment_lines" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_lines_lot_idx" ON "shipment_lines" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "shipment_lines_container_idx" ON "shipment_lines" USING btree ("container_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_lines_box_uq" ON "shipment_lines" USING btree ("shipment_id","container_id") WHERE "shipment_lines"."container_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_lines_movement_uq" ON "shipment_lines" USING btree ("stock_movement_id") WHERE "shipment_lines"."stock_movement_id" is not null;--> statement-breakpoint
CREATE INDEX "shipment_state_transitions_shipment_idx" ON "shipment_state_transitions" USING btree ("shipment_id","at");--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_packed_by_users_id_fk" FOREIGN KEY ("packed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_over_shipment_approved_by_users_id_fk" FOREIGN KEY ("over_shipment_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "stock_allocations_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "stock_allocations_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "stock_allocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_org_number_uq" ON "shipments" USING btree ("organization_id","shipment_number") WHERE "shipments"."shipment_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_org_idem_uq" ON "shipments" USING btree ("organization_id","idempotency_key") WHERE "shipments"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "shipments" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "shipments_site_status_idx" ON "shipments" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "stock_allocations_line_idx" ON "stock_allocations" USING btree ("sales_order_line_id");--> statement-breakpoint
CREATE INDEX "stock_allocations_lot_location_idx" ON "stock_allocations" USING btree ("lot_id","location_id");--> statement-breakpoint
CREATE INDEX "stock_allocations_container_idx" ON "stock_allocations" USING btree ("container_id");--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_status" CHECK ("shipments"."status" in ('draft','picked','packed','dispatched','delivered','returned','cancelled','reversed'));--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_dispatched" CHECK ("shipments"."status" not in ('dispatched','delivered','returned','reversed') or ("shipments"."dispatched_at" is not null and "shipments"."dispatched_by" is not null and "shipments"."delivery_receipt_number" is not null));--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_package_count" CHECK ("shipments"."package_count" is null or "shipments"."package_count" > 0);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_gross_weight" CHECK ("shipments"."gross_weight" is null or "shipments"."gross_weight" > 0);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_reversed" CHECK ("shipments"."status" <> 'reversed' or ("shipments"."reversed_at" is not null and "shipments"."reverse_reason" is not null));--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "ck_stock_allocations_status" CHECK ("stock_allocations"."status" in ('open','fulfilled','released'));--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "ck_stock_allocations_qty" CHECK ("stock_allocations"."qty_units" > 0);--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "ck_stock_allocations_released" CHECK ("stock_allocations"."status" <> 'released' or "stock_allocations"."release_reason" is not null);
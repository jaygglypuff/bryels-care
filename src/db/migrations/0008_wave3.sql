CREATE TABLE "sales_order_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artwork_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid,
	"product_id" uuid NOT NULL,
	"artwork_code" text NOT NULL,
	"version_label" text NOT NULL,
	"description" text,
	"file_attachment_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_by" uuid,
	"retired_at" timestamp with time zone,
	CONSTRAINT "artwork_versions_status_ck" CHECK ("artwork_versions"."status" in ('active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"city" text NOT NULL,
	"province" text,
	"postal_code" text,
	"country" char(2) DEFAULT 'PH' NOT NULL,
	"contact_name" text,
	"phone" text,
	"is_default_ship_to" boolean DEFAULT false NOT NULL,
	"is_default_bill_to" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_addresses_default_live_ck" CHECK ("customer_addresses"."deleted_at" is null or not ("customer_addresses"."is_default_ship_to" or "customer_addresses"."is_default_bill_to"))
);
--> statement-breakpoint
CREATE TABLE "customer_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role_label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"anonymised_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_item_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_item_code" text NOT NULL,
	"customer_description" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_requirements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"product_id" uuid,
	"requirement_kind" text NOT NULL,
	"value_numeric" numeric(18, 6),
	"value_text" text,
	"artwork_version_id" uuid,
	"label_template_id" uuid,
	"version_no" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"supersedes_id" uuid,
	"change_summary" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_requirements_kind_ck" CHECK ("customer_requirements"."requirement_kind" in ('label_artwork','carton_count','coa_required','moq','lead_time','packaging','document','lot_age_max_days','min_remaining_shelf_life_days','full_shipment_required','shipping_marks','other')),
	CONSTRAINT "customer_requirements_status_ck" CHECK ("customer_requirements"."status" in ('draft','pending_approval','approved','rejected','retired')),
	CONSTRAINT "customer_requirements_sod_ck" CHECK ("customer_requirements"."approved_by" is null or "customer_requirements"."approved_by" is distinct from "customer_requirements"."submitted_by"),
	CONSTRAINT "customer_requirements_dates_ck" CHECK ("customer_requirements"."effective_to" is null or "customer_requirements"."effective_to" > "customer_requirements"."effective_from"),
	CONSTRAINT "customer_requirements_value_ck" CHECK (num_nonnulls("customer_requirements"."value_numeric", "customer_requirements"."value_text", "customer_requirements"."artwork_version_id", "customer_requirements"."label_template_id") >= 1)
);
--> statement-breakpoint
CREATE TABLE "price_list_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"price_list_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"min_qty_units" numeric(18, 6) DEFAULT '0' NOT NULL,
	"unit_amount" numeric(18, 4) NOT NULL,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	CONSTRAINT "price_list_lines_amount_ck" CHECK ("price_list_lines"."unit_amount" >= 0 and "price_list_lines"."min_qty_units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"party_kind" text NOT NULL,
	"customer_id" uuid,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"version_no" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"supersedes_id" uuid,
	"change_summary" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_lists_kind_ck" CHECK (("price_lists"."party_kind" = 'customer' and "price_lists"."customer_id" is not null) or ("price_lists"."party_kind" = 'general' and "price_lists"."customer_id" is null)),
	CONSTRAINT "price_lists_status_ck" CHECK ("price_lists"."status" in ('draft','pending_approval','approved','rejected','retired')),
	CONSTRAINT "price_lists_sod_ck" CHECK ("price_lists"."approved_by" is null or "price_lists"."approved_by" is distinct from "price_lists"."submitted_by"),
	CONSTRAINT "price_lists_dates_ck" CHECK ("price_lists"."effective_to" is null or "price_lists"."effective_to" > "price_lists"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quote_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_units" numeric(18, 6) NOT NULL,
	"list_unit_amount" numeric(18, 4),
	"unit_amount" numeric(18, 4) NOT NULL,
	"discount_pct" numeric(9, 4) DEFAULT '0' NOT NULL,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"price_list_line_id" uuid,
	CONSTRAINT "quote_lines_qty_ck" CHECK ("quote_lines"."qty_units" > 0 and "quote_lines"."unit_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"quote_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"customer_id" uuid NOT NULL,
	"ship_to_address_id" uuid,
	"price_list_id" uuid,
	"valid_until" date NOT NULL,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"subtotal_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"max_discount_pct" numeric(9, 4) DEFAULT '0' NOT NULL,
	"notes_customer" text,
	"notes_internal" text,
	"converted_sales_order_id" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"sent_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_status_ck" CHECK ("quotes"."status" in ('draft','pending_approval','sent','accepted','rejected','expired','converted','voided')),
	CONSTRAINT "quotes_converted_ck" CHECK (("quotes"."status" = 'converted') = ("quotes"."converted_sales_order_id" is not null))
);
--> statement-breakpoint
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
CREATE TABLE "complaint_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"complaint_id" uuid NOT NULL,
	"link_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_number" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_complaint_links_kind" CHECK ("complaint_links"."link_kind" in ('deviation','customer_return','lot','container','shipment'))
);
--> statement-breakpoint
CREATE TABLE "complaint_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"complaint_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"complaint_number" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"category" text NOT NULL,
	"severity" text,
	"channel" text DEFAULT 'phone' NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_reference" text,
	"product_id" uuid,
	"lot_id" uuid,
	"container_id" uuid,
	"sales_order_id" uuid,
	"shipment_id" uuid,
	"reported_code" text,
	"trace_match" text DEFAULT 'not_given' NOT NULL,
	"description" text NOT NULL,
	"qty_affected" numeric(18, 6),
	"sample_returned" boolean DEFAULT false NOT NULL,
	"internal_notes" text,
	"investigation" text,
	"root_cause" text,
	"resolution" text,
	"customer_response" text,
	"deviation_id" uuid,
	"recall_review_flagged" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"received_by" uuid NOT NULL,
	"classified_by" uuid,
	"classified_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_complaints_status" CHECK ("complaints"."status" in ('open','investigating','resolved','closed')),
	CONSTRAINT "ck_complaints_channel" CHECK ("complaints"."channel" in ('phone','email','visit','sales_rep','other')),
	CONSTRAINT "ck_complaints_trace_match" CHECK ("complaints"."trace_match" in ('verified','unverified','mismatch','not_given')),
	CONSTRAINT "ck_complaints_verified_shipment" CHECK ("complaints"."trace_match" <> 'verified' or "complaints"."shipment_id" is not null),
	CONSTRAINT "ck_complaints_qty" CHECK ("complaints"."qty_affected" is null or "complaints"."qty_affected" > 0),
	CONSTRAINT "ck_complaints_resolved" CHECK ("complaints"."status" not in ('resolved','closed') or ("complaints"."resolution" is not null and "complaints"."resolved_by" is not null and "complaints"."resolved_at" is not null)),
	CONSTRAINT "ck_complaints_closed" CHECK (("complaints"."status" = 'closed') = ("complaints"."closed_by" is not null and "complaints"."closed_at" is not null and "complaints"."severity" is not null))
);
--> statement-breakpoint
CREATE TABLE "customer_return_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"customer_return_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid,
	"lot_id" uuid NOT NULL,
	"container_id" uuid,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"condition" text DEFAULT 'unknown' NOT NULL,
	"to_location_id" uuid NOT NULL,
	"return_lot_id" uuid,
	"stock_movement_id" uuid,
	"scan_payload" text,
	"manual_entry" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_customer_return_lines_qty" CHECK ("customer_return_lines"."qty_base" > 0),
	CONSTRAINT "ck_customer_return_lines_condition" CHECK ("customer_return_lines"."condition" in ('sellable','damaged','expired','unknown')),
	CONSTRAINT "ck_customer_return_lines_posted" CHECK (("customer_return_lines"."stock_movement_id" is null) = ("customer_return_lines"."return_lot_id" is null))
);
--> statement-breakpoint
CREATE TABLE "customer_return_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"customer_return_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"return_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"customer_id" uuid NOT NULL,
	"sales_order_id" uuid,
	"shipment_id" uuid NOT NULL,
	"complaint_id" uuid,
	"reason_code" text NOT NULL,
	"reason_note" text,
	"to_location_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"received_by" uuid,
	"received_at" timestamp with time zone,
	"inspected_by" uuid,
	"inspected_at" timestamp with time zone,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"cancel_reason" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_customer_returns_status" CHECK ("customer_returns"."status" in ('draft','submitted','approved','received','inspected','closed','cancelled')),
	CONSTRAINT "ck_customer_returns_submitted" CHECK ("customer_returns"."status" in ('draft','cancelled') or ("customer_returns"."submitted_by" is not null and "customer_returns"."submitted_at" is not null)),
	CONSTRAINT "ck_customer_returns_approved" CHECK ("customer_returns"."status" not in ('approved','received','inspected','closed') or ("customer_returns"."approved_by" is not null and "customer_returns"."approved_at" is not null)),
	CONSTRAINT "ck_customer_returns_received" CHECK ("customer_returns"."status" not in ('received','inspected','closed') or ("customer_returns"."received_by" is not null and "customer_returns"."received_at" is not null)),
	CONSTRAINT "ck_customer_returns_cancelled" CHECK ("customer_returns"."status" <> 'cancelled' or "customer_returns"."cancel_reason" is not null)
);
--> statement-breakpoint
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
CREATE TABLE "action_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"tab" text NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"record_number" text,
	"title" text NOT NULL,
	"detail" text,
	"severity" text NOT NULL,
	"view_permission" text NOT NULL,
	"link" text NOT NULL,
	"action_label" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"acknowledgement_note" text,
	"escalated_at" timestamp with time zone,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_action_items_tab" CHECK ("action_items"."tab" in ('approvals','exceptions')),
	CONSTRAINT "ck_action_items_severity" CHECK ("action_items"."severity" in ('info','warning','critical')),
	CONSTRAINT "ck_action_items_ack" CHECK (("action_items"."acknowledged_at" is null) = ("action_items"."acknowledged_by" is null))
);
--> statement-breakpoint
CREATE TABLE "notification_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"item_kind" text NOT NULL,
	"name" text NOT NULL,
	"severity" text NOT NULL,
	"owner_role_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"escalate_after_hours" integer,
	"escalation_role_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"email_on_open" boolean DEFAULT false NOT NULL,
	"email_on_escalation" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_rules_scope_kind_uq" UNIQUE NULLS NOT DISTINCT("organization_id","site_id","item_kind"),
	CONSTRAINT "ck_notification_rules_severity" CHECK ("notification_rules"."severity" in ('info','warning','critical')),
	CONSTRAINT "ck_notification_rules_escalation" CHECK (("notification_rules"."escalate_after_hours" is null) = (jsonb_array_length("notification_rules"."escalation_role_codes") = 0) and ("notification_rules"."escalate_after_hours" is null or "notification_rules"."escalate_after_hours" between 1 and 720))
);
--> statement-breakpoint
CREATE TABLE "report_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"report_code" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"owner_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_report_definitions_version" CHECK ("report_definitions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "report_run_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"report_run_id" uuid NOT NULL,
	"format" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"content" "bytea",
	"sha256" text NOT NULL,
	"row_count" integer NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"site_ids" jsonb NOT NULL,
	"recipient_user_ids" jsonb NOT NULL,
	"permission_fingerprint" text NOT NULL,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_report_run_files_format" CHECK ("report_run_files"."format" in ('csv','xlsx','html')),
	CONSTRAINT "ck_report_run_files_purged" CHECK ("report_run_files"."purged_at" is null or "report_run_files"."content" is null)
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"scheduled_report_id" uuid,
	"report_code" text NOT NULL,
	"trigger" text NOT NULL,
	"run_key" text NOT NULL,
	"period_key" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"recipients_sent" integer DEFAULT 0 NOT NULL,
	"recipients_skipped" integer DEFAULT 0 NOT NULL,
	"skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"files_count" integer DEFAULT 0 NOT NULL,
	"emails_sent" integer DEFAULT 0 NOT NULL,
	"email_status" text,
	"background_job_id" uuid,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_report_runs_status" CHECK ("report_runs"."status" in ('running','succeeded','partial','skipped','failed')),
	CONSTRAINT "ck_report_runs_trigger" CHECK ("report_runs"."trigger" in ('schedule','access_report')),
	CONSTRAINT "ck_report_runs_counts" CHECK ("report_runs"."recipients_sent" >= 0 and "report_runs"."recipients_skipped" >= 0 and "report_runs"."files_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "scheduled_report_recipients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scheduled_report_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"name" text NOT NULL,
	"report_code" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"cadence" text NOT NULL,
	"run_at_time" text NOT NULL,
	"weekday" integer,
	"month_day" integer,
	"timezone" text DEFAULT 'Asia/Manila' NOT NULL,
	"format" text NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_scheduled_reports_cadence" CHECK ("scheduled_reports"."cadence" in ('daily','weekly','monthly')),
	CONSTRAINT "ck_scheduled_reports_format" CHECK ("scheduled_reports"."format" in ('csv','xlsx','html')),
	CONSTRAINT "ck_scheduled_reports_time" CHECK ("scheduled_reports"."run_at_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "ck_scheduled_reports_weekday" CHECK (("scheduled_reports"."cadence" = 'weekly') = ("scheduled_reports"."weekday" is not null) and ("scheduled_reports"."weekday" is null or "scheduled_reports"."weekday" between 1 and 7)),
	CONSTRAINT "ck_scheduled_reports_month_day" CHECK (("scheduled_reports"."cadence" = 'monthly') = ("scheduled_reports"."month_day" is not null) and ("scheduled_reports"."month_day" is null or "scheduled_reports"."month_day" between 1 and 28))
);
--> statement-breakpoint
CREATE TABLE "kpi_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kpi_code" text NOT NULL,
	"version_no" integer NOT NULL,
	"name" text NOT NULL,
	"definition" text NOT NULL,
	"formula_text" text NOT NULL,
	"time_basis" text NOT NULL,
	"sources" jsonb NOT NULL,
	"refresh_class" text NOT NULL,
	"value_label" text NOT NULL,
	"unit" text NOT NULL,
	"aggregate" text NOT NULL,
	"drill_route" text NOT NULL,
	"permissions" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_kpi_definitions_label" CHECK ("kpi_definitions"."value_label" in ('actual','estimate','forecast','overridden')),
	CONSTRAINT "ck_kpi_definitions_refresh" CHECK ("kpi_definitions"."refresh_class" in ('post','live','mv15','night','wk')),
	CONSTRAINT "ck_kpi_definitions_version" CHECK ("kpi_definitions"."version_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE "kpi_reconciliation_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"refresh_log_id" uuid NOT NULL,
	"kpi_snapshot_id" uuid NOT NULL,
	"kpi_code" text NOT NULL,
	"scope_key" text NOT NULL,
	"grain" text NOT NULL,
	"period_start" date NOT NULL,
	"status" text NOT NULL,
	"snapshot_value" numeric(30, 10),
	"recomputed_value" numeric(30, 10),
	"snapshot_numerator" numeric(30, 10) NOT NULL,
	"recomputed_numerator" numeric(30, 10),
	"snapshot_denominator" numeric(30, 10),
	"recomputed_denominator" numeric(30, 10),
	"snapshot_row_count" integer NOT NULL,
	"recomputed_row_count" integer,
	"tolerance" numeric(30, 10) NOT NULL,
	"detail" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_kpi_reconciliation_results_status" CHECK ("kpi_reconciliation_results"."status" in ('match','mismatch'))
);
--> statement-breakpoint
CREATE TABLE "kpi_refresh_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"business_date" date NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"background_job_id" uuid,
	"snapshots_written" integer DEFAULT 0 NOT NULL,
	"checked" integer DEFAULT 0 NOT NULL,
	"mismatches" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ck_kpi_refresh_log_kind" CHECK ("kpi_refresh_log"."run_kind" in ('snapshot','reconcile')),
	CONSTRAINT "ck_kpi_refresh_log_status" CHECK ("kpi_refresh_log"."status" in ('running','succeeded','failed'))
);
--> statement-breakpoint
CREATE TABLE "kpi_saved_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_kpi_saved_views_name" CHECK (length(btrim("kpi_saved_views"."name")) between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "kpi_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kpi_code" text NOT NULL,
	"kpi_definition_id" uuid NOT NULL,
	"scope_key" text NOT NULL,
	"site_id" uuid,
	"site_ids" jsonb NOT NULL,
	"grain" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"as_of_date" date NOT NULL,
	"value" numeric(30, 10),
	"numerator" numeric(30, 10) NOT NULL,
	"denominator" numeric(30, 10),
	"row_count" integer NOT NULL,
	"value_label" text NOT NULL,
	"params" jsonb NOT NULL,
	"params_hash" text NOT NULL,
	"refresh_log_id" uuid,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_kpi_snapshots_grain" CHECK ("kpi_snapshots"."grain" in ('day','week','month')),
	CONSTRAINT "ck_kpi_snapshots_label" CHECK ("kpi_snapshots"."value_label" in ('actual','estimate','forecast','overridden')),
	CONSTRAINT "ck_kpi_snapshots_period" CHECK ("kpi_snapshots"."period_end" > "kpi_snapshots"."period_start"),
	CONSTRAINT "ck_kpi_snapshots_scope" CHECK (("kpi_snapshots"."scope_key" = 'all') = ("kpi_snapshots"."site_id" is null))
);
--> statement-breakpoint
ALTER TABLE "deviations" DROP CONSTRAINT "ck_deviations_source";--> statement-breakpoint
ALTER TABLE "approval_rules" DROP CONSTRAINT "ck_approval_rules_document_type";--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "delivery_receipt_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "dispatched_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "dispatched_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "dispatched_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "segment" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "currency" text DEFAULT 'PHP' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "payment_terms_days" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "credit_limit_amount" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "default_lead_time_days" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "tax_identifier" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "notes_internal" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "legacy_number" text;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "price_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "list_unit_price" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "price_list_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "price_list_line_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "discount_pct" numeric(9, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "requirement_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "min_remaining_shelf_life_days" integer;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "customer_item_code" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "ship_to_address_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "bill_to_address_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "ship_to_text" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "quote_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "currency" char(3) DEFAULT 'PHP' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "subtotal_amount" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "tax_amount" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "total_amount" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "credit_check_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "approval_reasons" jsonb;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "approval_basis" jsonb;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "warnings" jsonb;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "submitted_by" uuid;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "approval_note" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "status_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "status_changed_by" uuid;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
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
ALTER TABLE "sales_order_state_transitions" ADD CONSTRAINT "sales_order_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_state_transitions" ADD CONSTRAINT "sales_order_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_state_transitions" ADD CONSTRAINT "sales_order_state_transitions_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_state_transitions" ADD CONSTRAINT "sales_order_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_file_attachment_id_file_attachments_id_fk" FOREIGN KEY ("file_attachment_id") REFERENCES "public"."file_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_retired_by_users_id_fk" FOREIGN KEY ("retired_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_item_codes" ADD CONSTRAINT "customer_item_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_item_codes" ADD CONSTRAINT "customer_item_codes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_item_codes" ADD CONSTRAINT "customer_item_codes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_item_codes" ADD CONSTRAINT "customer_item_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_artwork_version_id_artwork_versions_id_fk" FOREIGN KEY ("artwork_version_id") REFERENCES "public"."artwork_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_label_template_id_label_templates_id_fk" FOREIGN KEY ("label_template_id") REFERENCES "public"."label_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_supersedes_id_customer_requirements_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."customer_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_requirements" ADD CONSTRAINT "customer_requirements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_lines" ADD CONSTRAINT "price_list_lines_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_lines" ADD CONSTRAINT "price_list_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_supersedes_id_price_lists_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_price_list_line_id_price_list_lines_id_fk" FOREIGN KEY ("price_list_line_id") REFERENCES "public"."price_list_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_ship_to_address_id_customer_addresses_id_fk" FOREIGN KEY ("ship_to_address_id") REFERENCES "public"."customer_addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "complaint_links" ADD CONSTRAINT "complaint_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_links" ADD CONSTRAINT "complaint_links_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_links" ADD CONSTRAINT "complaint_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_state_transitions" ADD CONSTRAINT "complaint_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_state_transitions" ADD CONSTRAINT "complaint_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_state_transitions" ADD CONSTRAINT "complaint_state_transitions_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_state_transitions" ADD CONSTRAINT "complaint_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_deviation_id_deviations_id_fk" FOREIGN KEY ("deviation_id") REFERENCES "public"."deviations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_classified_by_users_id_fk" FOREIGN KEY ("classified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_customer_return_id_customer_returns_id_fk" FOREIGN KEY ("customer_return_id") REFERENCES "public"."customer_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_return_lot_id_inventory_lots_id_fk" FOREIGN KEY ("return_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_stock_movement_id_stock_movements_id_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_state_transitions" ADD CONSTRAINT "customer_return_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_state_transitions" ADD CONSTRAINT "customer_return_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_state_transitions" ADD CONSTRAINT "customer_return_state_transitions_customer_return_id_customer_returns_id_fk" FOREIGN KEY ("customer_return_id") REFERENCES "public"."customer_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_state_transitions" ADD CONSTRAINT "customer_return_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_inspected_by_users_id_fk" FOREIGN KEY ("inspected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_run_files" ADD CONSTRAINT "report_run_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_run_files" ADD CONSTRAINT "report_run_files_report_run_id_report_runs_id_fk" FOREIGN KEY ("report_run_id") REFERENCES "public"."report_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_scheduled_report_id_scheduled_reports_id_fk" FOREIGN KEY ("scheduled_report_id") REFERENCES "public"."scheduled_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_background_job_id_background_jobs_id_fk" FOREIGN KEY ("background_job_id") REFERENCES "public"."background_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_report_recipients" ADD CONSTRAINT "scheduled_report_recipients_scheduled_report_id_scheduled_reports_id_fk" FOREIGN KEY ("scheduled_report_id") REFERENCES "public"."scheduled_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_report_recipients" ADD CONSTRAINT "scheduled_report_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_reconciliation_results" ADD CONSTRAINT "kpi_reconciliation_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_reconciliation_results" ADD CONSTRAINT "kpi_reconciliation_results_refresh_log_id_kpi_refresh_log_id_fk" FOREIGN KEY ("refresh_log_id") REFERENCES "public"."kpi_refresh_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_reconciliation_results" ADD CONSTRAINT "kpi_reconciliation_results_kpi_snapshot_id_kpi_snapshots_id_fk" FOREIGN KEY ("kpi_snapshot_id") REFERENCES "public"."kpi_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_refresh_log" ADD CONSTRAINT "kpi_refresh_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_refresh_log" ADD CONSTRAINT "kpi_refresh_log_background_job_id_background_jobs_id_fk" FOREIGN KEY ("background_job_id") REFERENCES "public"."background_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_saved_views" ADD CONSTRAINT "kpi_saved_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_saved_views" ADD CONSTRAINT "kpi_saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_kpi_definition_id_kpi_definitions_id_fk" FOREIGN KEY ("kpi_definition_id") REFERENCES "public"."kpi_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_refresh_log_id_kpi_refresh_log_id_fk" FOREIGN KEY ("refresh_log_id") REFERENCES "public"."kpi_refresh_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "so_transitions_order_idx" ON "sales_order_state_transitions" USING btree ("sales_order_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artwork_versions_code_uq" ON "artwork_versions" USING btree ("organization_id","artwork_code","version_label");--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_idx" ON "customer_addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_addresses_default_ship_uq" ON "customer_addresses" USING btree ("customer_id") WHERE "customer_addresses"."is_default_ship_to" and "customer_addresses"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_addresses_default_bill_uq" ON "customer_addresses" USING btree ("customer_id") WHERE "customer_addresses"."is_default_bill_to" and "customer_addresses"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "customer_contacts_customer_idx" ON "customer_contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_contacts_primary_uq" ON "customer_contacts" USING btree ("customer_id") WHERE "customer_contacts"."is_primary" and "customer_contacts"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_item_codes_product_uq" ON "customer_item_codes" USING btree ("customer_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_item_codes_code_uq" ON "customer_item_codes" USING btree ("customer_id","customer_item_code");--> statement-breakpoint
CREATE INDEX "customer_requirements_customer_idx" ON "customer_requirements" USING btree ("customer_id","requirement_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_requirements_version_uq" ON "customer_requirements" USING btree ("customer_id",coalesce("product_id", '00000000-0000-0000-0000-000000000000'::uuid),"requirement_kind","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_requirements_one_open_uq" ON "customer_requirements" USING btree ("customer_id",coalesce("product_id", '00000000-0000-0000-0000-000000000000'::uuid),"requirement_kind") WHERE "customer_requirements"."status" in ('draft', 'pending_approval');--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_lines_uq" ON "price_list_lines" USING btree ("price_list_id","product_id","min_qty_units");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_code_version_uq" ON "price_lists" USING btree ("organization_id","code","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_one_open_uq" ON "price_lists" USING btree ("organization_id","code") WHERE "price_lists"."status" in ('draft', 'pending_approval');--> statement-breakpoint
CREATE INDEX "price_lists_customer_idx" ON "price_lists" USING btree ("customer_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_lines_line_uq" ON "quote_lines" USING btree ("quote_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_org_number_uq" ON "quotes" USING btree ("organization_id","quote_number");--> statement-breakpoint
CREATE INDEX "quotes_site_status_idx" ON "quotes" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "quotes_customer_idx" ON "quotes" USING btree ("customer_id");--> statement-breakpoint
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
CREATE UNIQUE INDEX "uq_complaint_links" ON "complaint_links" USING btree ("complaint_id","link_kind","entity_id");--> statement-breakpoint
CREATE INDEX "ix_complaint_links_entity" ON "complaint_links" USING btree ("link_kind","entity_id");--> statement-breakpoint
CREATE INDEX "ix_complaint_transitions_complaint" ON "complaint_state_transitions" USING btree ("complaint_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_complaints_org_number" ON "complaints" USING btree ("organization_id","complaint_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_complaints_org_idem" ON "complaints" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_complaints_site_status" ON "complaints" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_complaints_customer" ON "complaints" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "ix_complaints_lot" ON "complaints" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customer_return_lines_no" ON "customer_return_lines" USING btree ("customer_return_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customer_return_lines_box" ON "customer_return_lines" USING btree ("customer_return_id","container_id") WHERE "customer_return_lines"."container_id" is not null;--> statement-breakpoint
CREATE INDEX "ix_customer_return_lines_lot" ON "customer_return_lines" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "ix_customer_return_lines_return_lot" ON "customer_return_lines" USING btree ("return_lot_id");--> statement-breakpoint
CREATE INDEX "ix_customer_return_transitions_return" ON "customer_return_state_transitions" USING btree ("customer_return_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customer_returns_org_number" ON "customer_returns" USING btree ("organization_id","return_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customer_returns_org_idem" ON "customer_returns" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_customer_returns_site_status" ON "customer_returns" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_customer_returns_shipment" ON "customer_returns" USING btree ("shipment_id");--> statement-breakpoint
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
CREATE UNIQUE INDEX "action_items_open_uq" ON "action_items" USING btree ("organization_id","kind","entity_id") WHERE "action_items"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "action_items_open_idx" ON "action_items" USING btree ("organization_id","resolved_at","site_id");--> statement-breakpoint
CREATE INDEX "action_items_entity_idx" ON "action_items" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_definitions_org_code_uq" ON "report_definitions" USING btree ("organization_id","report_code");--> statement-breakpoint
CREATE INDEX "report_run_files_run_idx" ON "report_run_files" USING btree ("report_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_runs_org_key_uq" ON "report_runs" USING btree ("organization_id","run_key");--> statement-breakpoint
CREATE INDEX "report_runs_schedule_idx" ON "report_runs" USING btree ("scheduled_report_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_report_recipients_uq" ON "scheduled_report_recipients" USING btree ("scheduled_report_id","user_id");--> statement-breakpoint
CREATE INDEX "scheduled_reports_due_idx" ON "scheduled_reports" USING btree ("is_active","next_run_at");--> statement-breakpoint
CREATE INDEX "scheduled_reports_owner_idx" ON "scheduled_reports" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_definitions_code_version_uq" ON "kpi_definitions" USING btree ("kpi_code","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_definitions_code_checksum_uq" ON "kpi_definitions" USING btree ("kpi_code","checksum");--> statement-breakpoint
CREATE INDEX "kpi_reconciliation_results_run_idx" ON "kpi_reconciliation_results" USING btree ("refresh_log_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_reconciliation_results_run_snapshot_uq" ON "kpi_reconciliation_results" USING btree ("refresh_log_id","kpi_snapshot_id");--> statement-breakpoint
CREATE INDEX "kpi_refresh_log_org_kind_idx" ON "kpi_refresh_log" USING btree ("organization_id","run_kind","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_saved_views_user_name_uq" ON "kpi_saved_views" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_snapshots_idem_uq" ON "kpi_snapshots" USING btree ("organization_id","kpi_code","scope_key","grain","period_start","as_of_date","params_hash");--> statement-breakpoint
CREATE INDEX "kpi_snapshots_series_idx" ON "kpi_snapshots" USING btree ("organization_id","kpi_code","scope_key","grain","period_start");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_price_list_line_id_price_list_lines_id_fk" FOREIGN KEY ("price_list_line_id") REFERENCES "public"."price_list_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_ship_to_address_id_customer_addresses_id_fk" FOREIGN KEY ("ship_to_address_id") REFERENCES "public"."customer_addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_bill_to_address_id_customer_addresses_id_fk" FOREIGN KEY ("bill_to_address_id") REFERENCES "public"."customer_addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_packed_by_users_id_fk" FOREIGN KEY ("packed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_over_shipment_approved_by_users_id_fk" FOREIGN KEY ("over_shipment_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "stock_allocations_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "stock_allocations_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "stock_allocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lots_org_legacy_number_uq" ON "inventory_lots" USING btree ("organization_id","legacy_number") WHERE "inventory_lots"."legacy_number" is not null;--> statement-breakpoint
CREATE INDEX "so_customer_idx" ON "sales_orders" USING btree ("customer_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_org_number_uq" ON "shipments" USING btree ("organization_id","shipment_number") WHERE "shipments"."shipment_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_org_idem_uq" ON "shipments" USING btree ("organization_id","idempotency_key") WHERE "shipments"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "shipments" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "shipments_site_status_idx" ON "shipments" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "stock_allocations_line_idx" ON "stock_allocations" USING btree ("sales_order_line_id");--> statement-breakpoint
CREATE INDEX "stock_allocations_lot_location_idx" ON "stock_allocations" USING btree ("lot_id","location_id");--> statement-breakpoint
CREATE INDEX "stock_allocations_container_idx" ON "stock_allocations" USING btree ("container_id");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_status_ck" CHECK ("customers"."status" in ('prospect', 'active', 'on_hold', 'inactive'));--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_credit_ck" CHECK (coalesce("customers"."credit_limit_amount", 0) >= 0 and coalesce("customers"."payment_terms_days", 0) >= 0 and coalesce("customers"."default_lead_time_days", 0) >= 0);--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "so_status_ck" CHECK ("sales_orders"."status" in ('draft','submitted','pending_approval','confirmed','allocated','picking','packed','partially_shipped','shipped','invoiced','closed','cancelled'));--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "so_credit_check_ck" CHECK ("sales_orders"."credit_check_status" in ('not_required','pending','passed','failed','overridden'));--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_status" CHECK ("shipments"."status" in ('draft','picked','packed','dispatched','delivered','returned','cancelled','reversed'));--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_dispatched" CHECK ("shipments"."status" not in ('dispatched','delivered','returned','reversed') or ("shipments"."dispatched_at" is not null and "shipments"."dispatched_by" is not null and "shipments"."delivery_receipt_number" is not null));--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_package_count" CHECK ("shipments"."package_count" is null or "shipments"."package_count" > 0);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_gross_weight" CHECK ("shipments"."gross_weight" is null or "shipments"."gross_weight" > 0);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_reversed" CHECK ("shipments"."status" <> 'reversed' or ("shipments"."reversed_at" is not null and "shipments"."reverse_reason" is not null));--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "ck_stock_allocations_status" CHECK ("stock_allocations"."status" in ('open','fulfilled','released'));--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "ck_stock_allocations_qty" CHECK ("stock_allocations"."qty_units" > 0);--> statement-breakpoint
ALTER TABLE "stock_allocations" ADD CONSTRAINT "ck_stock_allocations_released" CHECK ("stock_allocations"."status" <> 'released' or "stock_allocations"."release_reason" is not null);--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "ck_deviations_source" CHECK ("deviations"."source" in ('manual','cx_tol','cx_cal','in_process_check','yield','reconciliation','oos','other','complaint'));--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "ck_approval_rules_document_type" CHECK ("approval_rules"."document_type" in ('purchase_request','purchase_order','sales_order','quote','stock_adjustment','stock_count_variance','expense_claim','invoice','supplier_bill','credit_note','payment_record','dispense_exception','over_shipment','formula_revision','routing_revision','routing_revision_sequencing','work_instruction_revision','inspection_plan','disposition_conditional_release','recall_case','batch_reopen','work_order_release','leave_request','overtime_request','payroll_period','period_lock_unlock','setting_change_request','retention_action','supplier_return','equipment_override','payroll_period_reopen','price_list'));
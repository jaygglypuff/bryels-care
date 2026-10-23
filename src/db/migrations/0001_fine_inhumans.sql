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
ALTER TABLE "inventory_lots" ADD COLUMN "origin_lot_id" uuid;--> statement-breakpoint
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
CREATE INDEX "stock_reservations_demand_idx" ON "stock_reservations" USING btree ("demand_type","demand_id");
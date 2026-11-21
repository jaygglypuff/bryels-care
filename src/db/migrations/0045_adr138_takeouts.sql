CREATE TABLE "shelf_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"container_id" uuid,
	"lot_id" uuid NOT NULL,
	"expected_qty" numeric(18, 6) NOT NULL,
	"counted_qty" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"reason_code" text,
	"note" text,
	"stock_adjustment_id" uuid,
	"counted_by" uuid NOT NULL,
	"counted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "ck_shelf_checks_qty" CHECK ("shelf_checks"."expected_qty" >= 0 and "shelf_checks"."counted_qty" >= 0),
	CONSTRAINT "ck_shelf_checks_difference" CHECK ("shelf_checks"."expected_qty" = "shelf_checks"."counted_qty" or ("shelf_checks"."reason_code" is not null and "shelf_checks"."stock_adjustment_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "stock_takeout_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"takeout_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"container_id" uuid,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"opened_box" boolean DEFAULT false NOT NULL,
	"stock_movement_id" uuid,
	"reversal_movement_id" uuid,
	CONSTRAINT "ck_stock_takeout_lines_qty" CHECK ("stock_takeout_lines"."qty_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_takeouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"takeout_number" text NOT NULL,
	"status" text NOT NULL,
	"purpose" text NOT NULL,
	"channel" text,
	"platform_order_ref" text,
	"customer_id" uuid,
	"recipient_name" text,
	"note" text,
	"total_pieces" numeric(18, 6) NOT NULL,
	"approval_reason" text,
	"idempotency_key" text NOT NULL,
	"correlation_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"reject_reason" text,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"reversed_by" uuid,
	"reversed_at" timestamp with time zone,
	"reverse_reason" text,
	CONSTRAINT "ck_stock_takeouts_status" CHECK ("stock_takeouts"."status" in ('awaiting_approval','posted','rejected','cancelled','reversed')),
	CONSTRAINT "ck_stock_takeouts_purpose" CHECK ("stock_takeouts"."purpose" in ('sold_online','customer_sample','giveaway','display','staff_use','other')),
	CONSTRAINT "ck_stock_takeouts_channel" CHECK (("stock_takeouts"."purpose" = 'sold_online') = ("stock_takeouts"."channel" is not null)),
	CONSTRAINT "ck_stock_takeouts_order_ref" CHECK ("stock_takeouts"."platform_order_ref" is null or "stock_takeouts"."purpose" = 'sold_online'),
	CONSTRAINT "ck_stock_takeouts_recipient" CHECK (("stock_takeouts"."customer_id" is null and "stock_takeouts"."recipient_name" is null) or "stock_takeouts"."purpose" = 'customer_sample'),
	CONSTRAINT "ck_stock_takeouts_other_note" CHECK ("stock_takeouts"."purpose" <> 'other' or coalesce(length(trim("stock_takeouts"."note")), 0) >= 3),
	CONSTRAINT "ck_stock_takeouts_pieces" CHECK ("stock_takeouts"."total_pieces" > 0),
	CONSTRAINT "ck_stock_takeouts_posted" CHECK ("stock_takeouts"."status" not in ('posted', 'reversed') or ("stock_takeouts"."posted_by" is not null and "stock_takeouts"."posted_at" is not null)),
	CONSTRAINT "ck_stock_takeouts_rejected" CHECK ("stock_takeouts"."status" <> 'rejected' or ("stock_takeouts"."rejected_by" is not null and "stock_takeouts"."reject_reason" is not null)),
	CONSTRAINT "ck_stock_takeouts_cancelled" CHECK ("stock_takeouts"."status" <> 'cancelled' or ("stock_takeouts"."cancelled_by" is not null and "stock_takeouts"."cancel_reason" is not null)),
	CONSTRAINT "ck_stock_takeouts_reversed" CHECK ("stock_takeouts"."status" <> 'reversed' or ("stock_takeouts"."reversed_by" is not null and "stock_takeouts"."reverse_reason" is not null)),
	CONSTRAINT "ck_stock_takeouts_approval" CHECK ("stock_takeouts"."status" <> 'awaiting_approval' or "stock_takeouts"."approval_reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "approval_rules" DROP CONSTRAINT "ck_approval_rules_document_type";--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "takeout_shelf" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "made_for" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "made_for_note" text;--> statement-breakpoint
ALTER TABLE "shelf_checks" ADD CONSTRAINT "shelf_checks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf_checks" ADD CONSTRAINT "shelf_checks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf_checks" ADD CONSTRAINT "shelf_checks_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf_checks" ADD CONSTRAINT "shelf_checks_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf_checks" ADD CONSTRAINT "shelf_checks_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf_checks" ADD CONSTRAINT "shelf_checks_stock_adjustment_id_stock_adjustments_id_fk" FOREIGN KEY ("stock_adjustment_id") REFERENCES "public"."stock_adjustments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf_checks" ADD CONSTRAINT "shelf_checks_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeout_lines" ADD CONSTRAINT "stock_takeout_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeout_lines" ADD CONSTRAINT "stock_takeout_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeout_lines" ADD CONSTRAINT "stock_takeout_lines_takeout_id_stock_takeouts_id_fk" FOREIGN KEY ("takeout_id") REFERENCES "public"."stock_takeouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeout_lines" ADD CONSTRAINT "stock_takeout_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeout_lines" ADD CONSTRAINT "stock_takeout_lines_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeout_lines" ADD CONSTRAINT "stock_takeout_lines_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeout_lines" ADD CONSTRAINT "stock_takeout_lines_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeout_lines" ADD CONSTRAINT "stock_takeout_lines_stock_movement_id_stock_movements_id_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeout_lines" ADD CONSTRAINT "stock_takeout_lines_reversal_movement_id_stock_movements_id_fk" FOREIGN KEY ("reversal_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeouts" ADD CONSTRAINT "stock_takeouts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeouts" ADD CONSTRAINT "stock_takeouts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeouts" ADD CONSTRAINT "stock_takeouts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeouts" ADD CONSTRAINT "stock_takeouts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeouts" ADD CONSTRAINT "stock_takeouts_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeouts" ADD CONSTRAINT "stock_takeouts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeouts" ADD CONSTRAINT "stock_takeouts_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeouts" ADD CONSTRAINT "stock_takeouts_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takeouts" ADD CONSTRAINT "stock_takeouts_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shelf_checks_org_idem_uq" ON "shelf_checks" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "shelf_checks_container_idx" ON "shelf_checks" USING btree ("container_id","counted_at");--> statement-breakpoint
CREATE INDEX "shelf_checks_location_lot_idx" ON "shelf_checks" USING btree ("location_id","lot_id","counted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_takeout_lines_line_uq" ON "stock_takeout_lines" USING btree ("takeout_id","line_no");--> statement-breakpoint
CREATE INDEX "stock_takeout_lines_lot_idx" ON "stock_takeout_lines" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "stock_takeout_lines_container_idx" ON "stock_takeout_lines" USING btree ("container_id") WHERE "stock_takeout_lines"."container_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_takeouts_org_number_uq" ON "stock_takeouts" USING btree ("organization_id","takeout_number");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_takeouts_org_idem_uq" ON "stock_takeouts" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "stock_takeouts_site_created_idx" ON "stock_takeouts" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_takeouts_customer_idx" ON "stock_takeouts" USING btree ("customer_id") WHERE "stock_takeouts"."customer_id" is not null;--> statement-breakpoint
CREATE INDEX "stock_takeouts_creator_day_idx" ON "stock_takeouts" USING btree ("created_by","created_at");--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_takeout_shelf_ck" CHECK (not "locations"."takeout_shelf" or "locations"."kind" = 'storage');--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "ck_approval_rules_document_type" CHECK ("approval_rules"."document_type" in ('purchase_request','purchase_order','sales_order','quote','stock_adjustment','stock_count_variance','expense_claim','invoice','supplier_bill','credit_note','payment_record','dispense_exception','over_shipment','formula_revision','routing_revision','routing_revision_sequencing','work_instruction_revision','inspection_plan','disposition_conditional_release','recall_case','batch_reopen','work_order_release','leave_request','overtime_request','payroll_period','period_lock_unlock','setting_change_request','retention_action','supplier_return','equipment_override','payroll_period_reopen','price_list','change_control','stock_takeout'));--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "ck_work_orders_made_for" CHECK ("work_orders"."made_for" is null or ("work_orders"."made_for" in ('stock','online_shop','samples','other') and "work_orders"."sales_order_id" is null));--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "ck_work_orders_made_for_note" CHECK (coalesce("work_orders"."made_for", '') <> 'other' or coalesce(length(trim("work_orders"."made_for_note")), 0) >= 3);
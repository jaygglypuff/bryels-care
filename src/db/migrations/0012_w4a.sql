CREATE TABLE "forecast_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"baseline_qty_base" numeric(18, 6),
	"baseline_method" text,
	"override_qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"baseline_snapshot" jsonb,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_forecast_overrides_status" CHECK ("forecast_overrides"."status" in ('submitted','approved','rejected','retired')),
	CONSTRAINT "ck_forecast_overrides_qty" CHECK ("forecast_overrides"."override_qty_base" >= 0),
	CONSTRAINT "ck_forecast_overrides_period" CHECK ("forecast_overrides"."period_end" > "forecast_overrides"."period_start")
);
--> statement-breakpoint
CREATE TABLE "material_reorder_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"min_stock_base" numeric(18, 6) NOT NULL,
	"safety_stock_base" numeric(18, 6) DEFAULT '0' NOT NULL,
	"preferred_supplier_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_material_reorder_policies_qty" CHECK ("material_reorder_policies"."min_stock_base" >= 0 and "material_reorder_policies"."safety_stock_base" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"material_id" uuid NOT NULL,
	"supplier_material_id" uuid,
	"purchase_request_line_id" uuid,
	"qty_entered" numeric(18, 6) NOT NULL,
	"uom_entered" text NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"unit_amount" numeric(18, 4) NOT NULL,
	"line_amount" numeric(18, 4) NOT NULL,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"expected_date" date,
	"qty_received_base" numeric(18, 6) DEFAULT '0' NOT NULL,
	"line_status" text DEFAULT 'open' NOT NULL,
	"short_closed_at" timestamp with time zone,
	"short_closed_by" uuid,
	"short_close_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_purchase_order_lines_qty" CHECK ("purchase_order_lines"."qty_entered" > 0 and "purchase_order_lines"."qty_base" > 0 and "purchase_order_lines"."qty_received_base" >= 0),
	CONSTRAINT "ck_purchase_order_lines_amount" CHECK ("purchase_order_lines"."unit_amount" >= 0 and "purchase_order_lines"."line_amount" >= 0),
	CONSTRAINT "ck_purchase_order_lines_status" CHECK ("purchase_order_lines"."line_status" in ('open','received','short_closed','cancelled')),
	CONSTRAINT "ck_purchase_order_lines_short" CHECK ("purchase_order_lines"."line_status" <> 'short_closed' or ("purchase_order_lines"."short_close_reason" is not null and "purchase_order_lines"."short_closed_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "purchase_order_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"po_number" text NOT NULL,
	"legacy_number" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"supplier_id" uuid NOT NULL,
	"ship_to_warehouse_id" uuid,
	"order_date" date NOT NULL,
	"expected_date" date,
	"promised_date" date,
	"payment_terms_days" integer,
	"subtotal_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"is_urgent" boolean DEFAULT false NOT NULL,
	"urgent_reason" text,
	"notes" text,
	"supplier_reference" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"sent_at" timestamp with time zone,
	"sent_by" uuid,
	"sent_to" text,
	"send_result" text,
	"generated_document_id" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"close_reason" text,
	"cancel_reason" text,
	"idempotency_key" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_purchase_orders_status" CHECK ("purchase_orders"."status" in ('draft','submitted','approved','sent','partially_received','received','closed','cancelled')),
	CONSTRAINT "ck_purchase_orders_amounts" CHECK ("purchase_orders"."subtotal_amount" >= 0 and "purchase_orders"."tax_amount" >= 0 and "purchase_orders"."total_amount" >= 0),
	CONSTRAINT "ck_purchase_orders_urgent" CHECK (not "purchase_orders"."is_urgent" or "purchase_orders"."urgent_reason" is not null),
	CONSTRAINT "ck_purchase_orders_sod" CHECK ("purchase_orders"."approved_by" is null or ("purchase_orders"."approved_by" <> "purchase_orders"."created_by" and ("purchase_orders"."submitted_by" is null or "purchase_orders"."approved_by" <> "purchase_orders"."submitted_by"))),
	CONSTRAINT "ck_purchase_orders_sent" CHECK ("purchase_orders"."status" not in ('sent','partially_received','received','closed') or ("purchase_orders"."sent_at" is not null and "purchase_orders"."sent_by" is not null)),
	CONSTRAINT "ck_purchase_orders_terms" CHECK ("purchase_orders"."payment_terms_days" is null or "purchase_orders"."payment_terms_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_request_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"purchase_request_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"material_id" uuid NOT NULL,
	"qty_entered" numeric(18, 6) NOT NULL,
	"uom_entered" text NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"estimated_unit_amount" numeric(18, 4),
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"suggested_supplier_id" uuid,
	"note" text,
	"converted_po_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_purchase_request_lines_qty" CHECK ("purchase_request_lines"."qty_entered" > 0 and "purchase_request_lines"."qty_base" > 0),
	CONSTRAINT "ck_purchase_request_lines_amount" CHECK ("purchase_request_lines"."estimated_unit_amount" is null or "purchase_request_lines"."estimated_unit_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_request_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"purchase_request_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"request_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"requested_by" uuid NOT NULL,
	"needed_by_date" date,
	"justification" text,
	"estimated_total_amount" numeric(18, 4),
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"reorder_suggestion_id" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"reject_reason" text,
	"cancel_reason" text,
	"idempotency_key" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_purchase_requests_status" CHECK ("purchase_requests"."status" in ('draft','submitted','approved','rejected','converted','cancelled')),
	CONSTRAINT "ck_purchase_requests_sod" CHECK ("purchase_requests"."approved_by" is null or ("purchase_requests"."approved_by" <> "purchase_requests"."requested_by" and ("purchase_requests"."submitted_by" is null or "purchase_requests"."approved_by" <> "purchase_requests"."submitted_by"))),
	CONSTRAINT "ck_purchase_requests_amount" CHECK ("purchase_requests"."estimated_total_amount" is null or "purchase_requests"."estimated_total_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reorder_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"suggested_qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"on_hand_base" numeric(18, 6),
	"reserved_base" numeric(18, 6),
	"open_po_qty_base" numeric(18, 6),
	"forecast_qty_base" numeric(18, 6),
	"min_stock_base" numeric(18, 6),
	"safety_stock_base" numeric(18, 6),
	"expiry_risk_qty_base" numeric(18, 6),
	"moq_base" numeric(18, 6),
	"lead_time_days" integer,
	"supplier_id" uuid,
	"need_by_date" date,
	"explanation" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"purchase_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_reorder_suggestions_qty" CHECK ("reorder_suggestions"."suggested_qty_base" > 0),
	CONSTRAINT "ck_reorder_suggestions_status" CHECK ("reorder_suggestions"."status" in ('open','accepted','dismissed','superseded')),
	CONSTRAINT "ck_reorder_suggestions_reviewed" CHECK ("reorder_suggestions"."status" not in ('accepted','dismissed') or ("reorder_suggestions"."reviewed_by" is not null and "reorder_suggestions"."review_note" is not null))
);
--> statement-breakpoint
CREATE TABLE "supplier_material_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"supplier_material_id" uuid NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"proposed_by" uuid NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text NOT NULL,
	"audit_date" date,
	"evidence_attachment_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	CONSTRAINT "ck_supplier_material_changes_action" CHECK ("supplier_material_changes"."action" in ('approve','suspend')),
	CONSTRAINT "ck_supplier_material_changes_status" CHECK ("supplier_material_changes"."status" in ('pending','approved','rejected','withdrawn')),
	CONSTRAINT "ck_supplier_material_changes_sod" CHECK ("supplier_material_changes"."decided_by" is null or "supplier_material_changes"."decided_by" <> "supplier_material_changes"."proposed_by"),
	CONSTRAINT "ck_supplier_material_changes_decided" CHECK ("supplier_material_changes"."status" in ('pending','withdrawn') or ("supplier_material_changes"."decided_by" is not null and "supplier_material_changes"."decided_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "supplier_return_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"supplier_return_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"lot_id" uuid NOT NULL,
	"container_id" uuid,
	"from_location_id" uuid NOT NULL,
	"qty_entered" numeric(18, 6) NOT NULL,
	"uom_entered" text NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"credit_expected_amount" numeric(18, 4),
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"stock_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_supplier_return_lines_qty" CHECK ("supplier_return_lines"."qty_entered" > 0 and "supplier_return_lines"."qty_base" > 0),
	CONSTRAINT "ck_supplier_return_lines_amount" CHECK ("supplier_return_lines"."credit_expected_amount" is null or "supplier_return_lines"."credit_expected_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_return_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"supplier_return_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"return_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"supplier_id" uuid NOT NULL,
	"goods_receipt_id" uuid,
	"purchase_order_id" uuid,
	"reason_code" text NOT NULL,
	"reason_note" text,
	"supplier_rma_reference" text,
	"credit_expected_amount" numeric(18, 4),
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"posted_at" timestamp with time zone,
	"posted_by" uuid,
	"cancel_reason" text,
	"idempotency_key" text,
	"post_idempotency_key" text,
	"correlation_id" uuid,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_supplier_returns_status" CHECK ("supplier_returns"."status" in ('draft','submitted','approved','posted','cancelled')),
	CONSTRAINT "ck_supplier_returns_sod" CHECK ("supplier_returns"."approved_by" is null or ("supplier_returns"."approved_by" <> "supplier_returns"."created_by" and ("supplier_returns"."submitted_by" is null or "supplier_returns"."approved_by" <> "supplier_returns"."submitted_by"))),
	CONSTRAINT "ck_supplier_returns_poster" CHECK ("supplier_returns"."posted_by" is null or "supplier_returns"."approved_by" is null or "supplier_returns"."posted_by" <> "supplier_returns"."approved_by"),
	CONSTRAINT "ck_supplier_returns_posted" CHECK ("supplier_returns"."status" <> 'posted' or ("supplier_returns"."posted_at" is not null and "supplier_returns"."posted_by" is not null and "supplier_returns"."approved_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "purchase_order_line_id" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "purchase_order_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "requested_by" uuid;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "audit_date" date;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "evidence_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "moq_qty" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "moq_uom" text;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "unit_price" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "price_uom" text;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "currency" char(3);--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "price_effective_from" date;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_reorder_policies" ADD CONSTRAINT "material_reorder_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_reorder_policies" ADD CONSTRAINT "material_reorder_policies_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_reorder_policies" ADD CONSTRAINT "material_reorder_policies_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_reorder_policies" ADD CONSTRAINT "material_reorder_policies_preferred_supplier_id_suppliers_id_fk" FOREIGN KEY ("preferred_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_reorder_policies" ADD CONSTRAINT "material_reorder_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_supplier_material_id_supplier_materials_id_fk" FOREIGN KEY ("supplier_material_id") REFERENCES "public"."supplier_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_request_line_id_purchase_request_lines_id_fk" FOREIGN KEY ("purchase_request_line_id") REFERENCES "public"."purchase_request_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_short_closed_by_users_id_fk" FOREIGN KEY ("short_closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_state_transitions" ADD CONSTRAINT "purchase_order_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_state_transitions" ADD CONSTRAINT "purchase_order_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_state_transitions" ADD CONSTRAINT "purchase_order_state_transitions_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_state_transitions" ADD CONSTRAINT "purchase_order_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_ship_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("ship_to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_purchase_request_id_purchase_requests_id_fk" FOREIGN KEY ("purchase_request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_suggested_supplier_id_suppliers_id_fk" FOREIGN KEY ("suggested_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_state_transitions" ADD CONSTRAINT "purchase_request_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_state_transitions" ADD CONSTRAINT "purchase_request_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_state_transitions" ADD CONSTRAINT "purchase_request_state_transitions_purchase_request_id_purchase_requests_id_fk" FOREIGN KEY ("purchase_request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_state_transitions" ADD CONSTRAINT "purchase_request_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "reorder_suggestions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "reorder_suggestions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "reorder_suggestions_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "reorder_suggestions_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "reorder_suggestions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "reorder_suggestions_purchase_request_id_purchase_requests_id_fk" FOREIGN KEY ("purchase_request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_material_changes" ADD CONSTRAINT "supplier_material_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_material_changes" ADD CONSTRAINT "supplier_material_changes_supplier_material_id_supplier_materials_id_fk" FOREIGN KEY ("supplier_material_id") REFERENCES "public"."supplier_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_material_changes" ADD CONSTRAINT "supplier_material_changes_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_material_changes" ADD CONSTRAINT "supplier_material_changes_evidence_attachment_id_file_attachments_id_fk" FOREIGN KEY ("evidence_attachment_id") REFERENCES "public"."file_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_material_changes" ADD CONSTRAINT "supplier_material_changes_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_supplier_return_id_supplier_returns_id_fk" FOREIGN KEY ("supplier_return_id") REFERENCES "public"."supplier_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_stock_movement_id_stock_movements_id_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_state_transitions" ADD CONSTRAINT "supplier_return_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_state_transitions" ADD CONSTRAINT "supplier_return_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_state_transitions" ADD CONSTRAINT "supplier_return_state_transitions_supplier_return_id_supplier_returns_id_fk" FOREIGN KEY ("supplier_return_id") REFERENCES "public"."supplier_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_state_transitions" ADD CONSTRAINT "supplier_return_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_goods_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_forecast_overrides_product" ON "forecast_overrides" USING btree ("site_id","product_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_forecast_overrides_approved" ON "forecast_overrides" USING btree ("site_id","product_id","period_start") WHERE "forecast_overrides"."status" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_material_reorder_policies" ON "material_reorder_policies" USING btree ("site_id","material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_order_lines_no" ON "purchase_order_lines" USING btree ("purchase_order_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_purchase_order_lines_material" ON "purchase_order_lines" USING btree ("material_id","line_status");--> statement-breakpoint
CREATE INDEX "ix_purchase_order_transitions_po" ON "purchase_order_state_transitions" USING btree ("purchase_order_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_orders_number" ON "purchase_orders" USING btree ("organization_id","po_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_orders_legacy" ON "purchase_orders" USING btree ("organization_id","legacy_number") WHERE "purchase_orders"."legacy_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_orders_idem" ON "purchase_orders" USING btree ("organization_id","idempotency_key") WHERE "purchase_orders"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "ix_purchase_orders_site_status" ON "purchase_orders" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_purchase_orders_supplier" ON "purchase_orders" USING btree ("supplier_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_request_lines_no" ON "purchase_request_lines" USING btree ("purchase_request_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_purchase_request_lines_material" ON "purchase_request_lines" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "ix_purchase_request_transitions_pr" ON "purchase_request_state_transitions" USING btree ("purchase_request_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_requests_number" ON "purchase_requests" USING btree ("organization_id","request_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_requests_idem" ON "purchase_requests" USING btree ("organization_id","idempotency_key") WHERE "purchase_requests"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "ix_purchase_requests_site_status" ON "purchase_requests" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_reorder_suggestions_site_status" ON "reorder_suggestions" USING btree ("site_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reorder_suggestions_open" ON "reorder_suggestions" USING btree ("site_id","material_id") WHERE "reorder_suggestions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "ix_supplier_material_changes_pair" ON "supplier_material_changes" USING btree ("supplier_material_id","proposed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_material_changes_pending" ON "supplier_material_changes" USING btree ("supplier_material_id") WHERE "supplier_material_changes"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_return_lines_no" ON "supplier_return_lines" USING btree ("supplier_return_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_supplier_return_lines_lot" ON "supplier_return_lines" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "ix_supplier_return_transitions_sr" ON "supplier_return_state_transitions" USING btree ("supplier_return_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_returns_number" ON "supplier_returns" USING btree ("organization_id","return_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_returns_idem" ON "supplier_returns" USING btree ("organization_id","idempotency_key") WHERE "supplier_returns"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_returns_post_idem" ON "supplier_returns" USING btree ("organization_id","post_idempotency_key") WHERE "supplier_returns"."post_idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "ix_supplier_returns_site_status" ON "supplier_returns" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_supplier_returns_supplier" ON "supplier_returns" USING btree ("supplier_id");--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_evidence_attachment_id_file_attachments_id_fk" FOREIGN KEY ("evidence_attachment_id") REFERENCES "public"."file_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_goods_receipt_lines_po_line" ON "goods_receipt_lines" USING btree ("purchase_order_line_id");--> statement-breakpoint
CREATE INDEX "ix_goods_receipts_po" ON "goods_receipts" USING btree ("purchase_order_id");--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "ck_goods_receipts_po_kind" CHECK (("goods_receipts"."receipt_kind" = 'purchase_order') = ("goods_receipts"."purchase_order_id" is not null));--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "ck_supplier_materials_requested" CHECK (("supplier_materials"."requested_by" is null) = ("supplier_materials"."requested_at" is null));--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "ck_supplier_materials_sod" CHECK ("supplier_materials"."approved_by" is null or "supplier_materials"."requested_by" is null or "supplier_materials"."approved_by" <> "supplier_materials"."requested_by");--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "ck_supplier_materials_moq" CHECK ("supplier_materials"."moq_qty" is null or ("supplier_materials"."moq_qty" > 0 and "supplier_materials"."moq_uom" is not null));--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "ck_supplier_materials_price" CHECK ("supplier_materials"."unit_price" is null or ("supplier_materials"."unit_price" >= 0 and "supplier_materials"."price_uom" is not null and "supplier_materials"."currency" is not null));--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "ck_supplier_materials_lead_time" CHECK ("supplier_materials"."lead_time_days" is null or "supplier_materials"."lead_time_days" >= 0);
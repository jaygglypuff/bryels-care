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
ALTER TABLE "deviations" DROP CONSTRAINT "ck_deviations_source";--> statement-breakpoint
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
ALTER TABLE "deviations" ADD CONSTRAINT "ck_deviations_source" CHECK ("deviations"."source" in ('manual','cx_tol','cx_cal','in_process_check','yield','reconciliation','oos','other','complaint'));
CREATE TABLE "batch_material_stagings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"batch_material_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"movement_id" uuid NOT NULL,
	"batch_reservation_id" uuid,
	"substitution_id" uuid,
	"staged_by" uuid NOT NULL,
	"staged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_batch_material_stagings_qty" CHECK ("batch_material_stagings"."qty_base" > 0),
	CONSTRAINT "ck_batch_material_stagings_locations" CHECK ("batch_material_stagings"."from_location_id" <> "batch_material_stagings"."to_location_id")
);
--> statement-breakpoint
CREATE TABLE "batch_material_substitutions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"batch_material_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"expected_lot_id" uuid,
	"substitute_lot_id" uuid NOT NULL,
	"substitute_location_id" uuid NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"reason" text NOT NULL,
	"new_reservation_id" uuid,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_batch_material_substitutions_qty" CHECK ("batch_material_substitutions"."qty_base" > 0),
	CONSTRAINT "ck_batch_material_substitutions_lots" CHECK ("batch_material_substitutions"."expected_lot_id" is null or "batch_material_substitutions"."expected_lot_id" <> "batch_material_substitutions"."substitute_lot_id"),
	CONSTRAINT "ck_batch_material_substitutions_reason" CHECK (length(btrim("batch_material_substitutions"."reason")) >= 5)
);
--> statement-breakpoint
CREATE TABLE "product_min_stock" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"min_stock_units" numeric(18, 6) NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_product_min_stock_qty" CHECK ("product_min_stock"."min_stock_units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"department_label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_production_lines_status" CHECK ("production_lines"."status" in ('active','down','inactive')),
	CONSTRAINT "ck_production_lines_code" CHECK ("production_lines"."code" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "production_plan_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"production_plan_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"source" text NOT NULL,
	"sales_order_id" uuid,
	"sales_order_line_id" uuid,
	"demand_units" numeric(18, 6) NOT NULL,
	"on_hand_units" numeric(18, 6) DEFAULT '0' NOT NULL,
	"available_units" numeric(18, 6) DEFAULT '0' NOT NULL,
	"open_work_order_units" numeric(18, 6) DEFAULT '0' NOT NULL,
	"min_stock_units" numeric(18, 6),
	"qty_units" numeric(18, 6) NOT NULL,
	"target_date" date NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_production_plan_lines_source" CHECK ("production_plan_lines"."source" in ('sales_order','min_stock','manual')),
	CONSTRAINT "ck_production_plan_lines_qty" CHECK ("production_plan_lines"."qty_units" > 0 and "production_plan_lines"."demand_units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"plan_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"notes" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_production_plans_status" CHECK ("production_plans"."status" in ('draft','approved','closed')),
	CONSTRAINT "ck_production_plans_period" CHECK ("production_plans"."period_start" <= "production_plans"."period_end")
);
--> statement-breakpoint
CREATE TABLE "work_order_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"work_order_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"product_id" uuid NOT NULL,
	"formula_id" uuid NOT NULL,
	"formula_revision_id" uuid,
	"routing_revision_id" uuid,
	"production_line_id" uuid,
	"production_plan_line_id" uuid,
	"sales_order_id" uuid,
	"qty_planned_base" numeric(18, 6) NOT NULL,
	"base_uom" text DEFAULT 'g' NOT NULL,
	"batch_count" integer NOT NULL,
	"batch_size_base" numeric(18, 6) NOT NULL,
	"target_units" numeric(18, 6),
	"planned_start" date NOT NULL,
	"planned_end" date NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"assigned_planner_id" uuid,
	"assigned_supervisor_id" uuid,
	"notes" text,
	"release_shortages" jsonb,
	"released_with_shortage" boolean DEFAULT false NOT NULL,
	"cancel_reason" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_work_orders_status" CHECK ("work_orders"."status" in ('draft','planned','released','in_progress','completed','closed','cancelled')),
	CONSTRAINT "ck_work_orders_qty" CHECK ("work_orders"."qty_planned_base" > 0 and "work_orders"."batch_size_base" > 0 and "work_orders"."batch_count" > 0),
	CONSTRAINT "ck_work_orders_dates" CHECK ("work_orders"."planned_end" >= "work_orders"."planned_start"),
	CONSTRAINT "ck_work_orders_priority" CHECK ("work_orders"."priority" between 1 and 9),
	CONSTRAINT "ck_work_orders_revisions" CHECK ("work_orders"."status" in ('draft','cancelled') or ("work_orders"."formula_revision_id" is not null and "work_orders"."routing_revision_id" is not null)),
	CONSTRAINT "ck_work_orders_release" CHECK ("work_orders"."status" not in ('released','in_progress','completed','closed') or ("work_orders"."approved_by" is not null and "work_orders"."approved_at" is not null)),
	CONSTRAINT "ck_work_orders_cancel" CHECK ("work_orders"."status" <> 'cancelled' or "work_orders"."cancel_reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "work_order_id" uuid;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_batch_material_id_batch_materials_id_fk" FOREIGN KEY ("batch_material_id") REFERENCES "public"."batch_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_movement_id_stock_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_batch_reservation_id_stock_reservations_id_fk" FOREIGN KEY ("batch_reservation_id") REFERENCES "public"."stock_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_substitution_id_batch_material_substitutions_id_fk" FOREIGN KEY ("substitution_id") REFERENCES "public"."batch_material_substitutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_stagings" ADD CONSTRAINT "batch_material_stagings_staged_by_users_id_fk" FOREIGN KEY ("staged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_batch_material_id_batch_materials_id_fk" FOREIGN KEY ("batch_material_id") REFERENCES "public"."batch_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_expected_lot_id_inventory_lots_id_fk" FOREIGN KEY ("expected_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_substitute_lot_id_inventory_lots_id_fk" FOREIGN KEY ("substitute_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_substitute_location_id_locations_id_fk" FOREIGN KEY ("substitute_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_new_reservation_id_stock_reservations_id_fk" FOREIGN KEY ("new_reservation_id") REFERENCES "public"."stock_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_min_stock" ADD CONSTRAINT "product_min_stock_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_min_stock" ADD CONSTRAINT "product_min_stock_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_min_stock" ADD CONSTRAINT "product_min_stock_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_min_stock" ADD CONSTRAINT "product_min_stock_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_production_plan_id_production_plans_id_fk" FOREIGN KEY ("production_plan_id") REFERENCES "public"."production_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_state_transitions" ADD CONSTRAINT "work_order_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_state_transitions" ADD CONSTRAINT "work_order_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_state_transitions" ADD CONSTRAINT "work_order_state_transitions_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_state_transitions" ADD CONSTRAINT "work_order_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_formula_id_formulas_id_fk" FOREIGN KEY ("formula_id") REFERENCES "public"."formulas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_formula_revision_id_formula_revisions_id_fk" FOREIGN KEY ("formula_revision_id") REFERENCES "public"."formula_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_routing_revision_id_routing_revisions_id_fk" FOREIGN KEY ("routing_revision_id") REFERENCES "public"."routing_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_production_line_id_production_lines_id_fk" FOREIGN KEY ("production_line_id") REFERENCES "public"."production_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_production_plan_line_id_production_plan_lines_id_fk" FOREIGN KEY ("production_plan_line_id") REFERENCES "public"."production_plan_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assigned_planner_id_users_id_fk" FOREIGN KEY ("assigned_planner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assigned_supervisor_id_users_id_fk" FOREIGN KEY ("assigned_supervisor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batch_material_stagings_batch_idx" ON "batch_material_stagings" USING btree ("batch_id","batch_material_id");--> statement-breakpoint
CREATE INDEX "batch_material_stagings_wo_idx" ON "batch_material_stagings" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "batch_material_substitutions_batch_idx" ON "batch_material_substitutions" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_min_stock_site_product_uq" ON "product_min_stock" USING btree ("site_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_lines_site_code_uq" ON "production_lines" USING btree ("site_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "production_plan_lines_plan_line_uq" ON "production_plan_lines" USING btree ("production_plan_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "production_plans_org_number_uq" ON "production_plans" USING btree ("organization_id","plan_number");--> statement-breakpoint
CREATE INDEX "production_plans_site_status_idx" ON "production_plans" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "work_order_transitions_wo_idx" ON "work_order_state_transitions" USING btree ("work_order_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_org_number_uq" ON "work_orders" USING btree ("organization_id","work_order_number");--> statement-breakpoint
CREATE INDEX "work_orders_site_status_idx" ON "work_orders" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "work_orders_plan_line_idx" ON "work_orders" USING btree ("production_plan_line_id");--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batches_work_order_idx" ON "batches" USING btree ("work_order_id");
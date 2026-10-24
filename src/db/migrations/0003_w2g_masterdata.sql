CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_code_ck" CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "production_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"department_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_lines_status_ck" CHECK ("production_lines"."status" in ('active', 'down', 'inactive')),
	CONSTRAINT "production_lines_code_ck" CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "reason_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"applies_to" text[] NOT NULL,
	"requires_note" boolean DEFAULT false NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reason_codes_code_ck" CHECK ("reason_codes"."code" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "reason_codes_applies_to_ck" CHECK (cardinality(applies_to) >= 1 and applies_to <@ array['adjustment', 'transfer', 'receipt', 'disposition', 'sample', 'scrap', 'rework', 'return', 'count_variance', 'hold', 'reprint', 'deviation', 'reversal', 'exception', 'cancel', 'downtime', 'audit']::text[])
);
--> statement-breakpoint
CREATE TABLE "skus" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"variant_label" text,
	"pack_format" text,
	"net_content_qty" numeric(18, 6),
	"net_content_uom_id" uuid,
	"uom_base_id" uuid NOT NULL,
	"units_per_box" integer,
	"boxes_per_pallet" integer,
	"gtin" text,
	"shelf_life_days" integer,
	"retest_days" integer,
	"storage_conditions" text,
	"allocation_rule" text DEFAULT 'fefo' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skus_code_ck" CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
	CONSTRAINT "skus_status_ck" CHECK ("skus"."status" in ('draft', 'active', 'discontinued')),
	CONSTRAINT "skus_allocation_ck" CHECK ("skus"."allocation_rule" in ('fefo', 'fifo')),
	CONSTRAINT "skus_pack_ck" CHECK (coalesce("skus"."units_per_box", 1) > 0 and coalesce("skus"."boxes_per_pallet", 1) > 0),
	CONSTRAINT "skus_days_ck" CHECK (coalesce("skus"."shelf_life_days", 1) > 0 and coalesce("skus"."retest_days", 1) > 0),
	CONSTRAINT "skus_net_content_ck" CHECK ("skus"."net_content_qty" is null or ("skus"."net_content_qty" > 0 and "skus"."net_content_uom_id" is not null)),
	CONSTRAINT "skus_gtin_ck" CHECK ("skus"."gtin" is null or "skus"."gtin" ~ '^[0-9]{8,14}$')
);
--> statement-breakpoint
CREATE TABLE "uom_conversions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"from_uom_id" uuid NOT NULL,
	"to_uom_id" uuid NOT NULL,
	"factor" numeric(24, 12) NOT NULL,
	"material_id" uuid,
	"revision_no" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"supersedes_id" uuid,
	"change_reason" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"decision_note" text,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uom_conv_factor_ck" CHECK ("uom_conversions"."factor" > 0),
	CONSTRAINT "uom_conv_distinct_ck" CHECK ("uom_conversions"."from_uom_id" <> "uom_conversions"."to_uom_id"),
	CONSTRAINT "uom_conv_status_ck" CHECK ("uom_conversions"."status" in ('pending_approval', 'approved', 'rejected', 'retired')),
	CONSTRAINT "uom_conv_sod_ck" CHECK ("uom_conversions"."approved_by" is null or "uom_conversions"."approved_by" is distinct from "uom_conversions"."submitted_by"),
	CONSTRAINT "uom_conv_approved_ck" CHECK ("uom_conversions"."status" not in ('approved', 'retired') or ("uom_conversions"."approved_at" is not null and ("uom_conversions"."approved_by" is not null or "uom_conversions"."is_system")))
);
--> statement-breakpoint
CREATE TABLE "uoms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"dimension" text NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uoms_dimension_ck" CHECK ("uoms"."dimension" in ('mass', 'volume', 'count', 'length')),
	CONSTRAINT "uoms_code_ck" CHECK ("uoms"."code" ~ '^[A-Za-z][A-Za-z0-9_]{0,15}$')
);
--> statement-breakpoint
CREATE TABLE "warehouse_special_locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"role" text NOT NULL,
	"location_id" uuid NOT NULL,
	"designated_by" uuid,
	"designated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_special_locations_role_ck" CHECK ("warehouse_special_locations"."role" in ('receiving', 'staging', 'quarantine', 'hold', 'rejected', 'recall'))
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "timezone" text DEFAULT 'Asia/Manila' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "province" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "country" text DEFAULT 'PH' NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "parent_location_id" uuid;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "is_pickable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "common_name" text;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "retest_days" integer;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "allergen_notes" text;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "hazard_notes" text;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "allocation_rule" text DEFAULT 'fefo' NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "storage_conditions" text;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "warehouse_kind" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "production_line_id" uuid;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reason_codes" ADD CONSTRAINT "reason_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reason_codes" ADD CONSTRAINT "reason_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reason_codes" ADD CONSTRAINT "reason_codes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_net_content_uom_id_uoms_id_fk" FOREIGN KEY ("net_content_uom_id") REFERENCES "public"."uoms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_uom_base_id_uoms_id_fk" FOREIGN KEY ("uom_base_id") REFERENCES "public"."uoms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_from_uom_id_uoms_id_fk" FOREIGN KEY ("from_uom_id") REFERENCES "public"."uoms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_to_uom_id_uoms_id_fk" FOREIGN KEY ("to_uom_id") REFERENCES "public"."uoms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_supersedes_id_uom_conversions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."uom_conversions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uoms" ADD CONSTRAINT "uoms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uoms" ADD CONSTRAINT "uoms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uoms" ADD CONSTRAINT "uoms_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_special_locations" ADD CONSTRAINT "warehouse_special_locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_special_locations" ADD CONSTRAINT "warehouse_special_locations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_special_locations" ADD CONSTRAINT "warehouse_special_locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_special_locations" ADD CONSTRAINT "warehouse_special_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_special_locations" ADD CONSTRAINT "warehouse_special_locations_designated_by_users_id_fk" FOREIGN KEY ("designated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_site_code_uq" ON "departments" USING btree ("site_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "production_lines_site_code_uq" ON "production_lines" USING btree ("site_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "reason_codes_org_code_uq" ON "reason_codes" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "reason_codes_applies_to_idx" ON "reason_codes" USING gin ("applies_to");--> statement-breakpoint
CREATE UNIQUE INDEX "skus_org_code_uq" ON "skus" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "skus_product_idx" ON "skus" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uom_conv_approved_generic_uq" ON "uom_conversions" USING btree ("organization_id","from_uom_id","to_uom_id") WHERE "uom_conversions"."status" = 'approved' and "uom_conversions"."material_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uom_conv_approved_material_uq" ON "uom_conversions" USING btree ("organization_id","from_uom_id","to_uom_id","material_id") WHERE "uom_conversions"."status" = 'approved' and "uom_conversions"."material_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uom_conv_pending_generic_uq" ON "uom_conversions" USING btree ("organization_id","from_uom_id","to_uom_id") WHERE "uom_conversions"."status" = 'pending_approval' and "uom_conversions"."material_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uom_conv_pending_material_uq" ON "uom_conversions" USING btree ("organization_id","from_uom_id","to_uom_id","material_id") WHERE "uom_conversions"."status" = 'pending_approval' and "uom_conversions"."material_id" is not null;--> statement-breakpoint
CREATE INDEX "uom_conv_material_idx" ON "uom_conversions" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uoms_org_code_uq" ON "uoms" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "uoms_one_base_per_dimension_uq" ON "uoms" USING btree ("organization_id","dimension") WHERE "uoms"."is_base";--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_special_locations_uq" ON "warehouse_special_locations" USING btree ("warehouse_id","role");--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_location_id_locations_id_fk" FOREIGN KEY ("parent_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_production_line_id_production_lines_id_fk" FOREIGN KEY ("production_line_id") REFERENCES "public"."production_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "locations_parent_idx" ON "locations" USING btree ("parent_location_id");--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_status_ck" CHECK ("locations"."status" in ('active', 'blocked', 'inactive'));--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_active_status_ck" CHECK ("locations"."is_active" = ("locations"."status" <> 'inactive'));--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_kind_ck" CHECK ("locations"."kind" in ('receiving', 'staging', 'storage', 'quarantine', 'hold', 'rejected', 'recall', 'production', 'shipping'));--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_kind_ck" CHECK ("materials"."material_kind" in ('raw_material', 'intermediate', 'packaging', 'consumable'));--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_status_ck" CHECK ("materials"."status" in ('draft', 'active', 'blocked', 'discontinued'));--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_allocation_ck" CHECK ("materials"."allocation_rule" in ('fefo', 'fifo'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_status_ck" CHECK ("products"."status" in ('draft', 'active', 'discontinued'));--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_kind_ck" CHECK ("warehouses"."warehouse_kind" in ('raw_materials', 'packaging', 'finished_goods', 'general'));
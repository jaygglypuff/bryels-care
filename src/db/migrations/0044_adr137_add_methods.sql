CREATE TABLE "material_units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"unit_key" uuid NOT NULL,
	"version_no" integer DEFAULT 1 NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"qty_per_unit" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'active' NOT NULL,
	"supersedes_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_by" uuid,
	"retired_at" timestamp with time zone,
	"retired_reason" text,
	CONSTRAINT "material_units_kind_ck" CHECK ("material_units"."kind" in ('pack', 'volume')),
	CONSTRAINT "material_units_status_ck" CHECK ("material_units"."status" in ('active', 'retired')),
	CONSTRAINT "material_units_qty_ck" CHECK ("material_units"."qty_per_unit" > 0),
	CONSTRAINT "material_units_name_ck" CHECK (length(btrim("material_units"."name")) between 1 and 30),
	CONSTRAINT "material_units_volume_ck" CHECK ("material_units"."kind" <> 'volume' or "material_units"."name" = 'mL'),
	CONSTRAINT "material_units_retired_ck" CHECK ("material_units"."status" <> 'retired' or ("material_units"."retired_by" is not null and "material_units"."retired_at" is not null and "material_units"."retired_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "recipe_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"body" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_by" uuid,
	"retired_at" timestamp with time zone,
	"retired_reason" text,
	CONSTRAINT "recipe_templates_kind_ck" CHECK ("recipe_templates"."kind" in ('step', 'add_method')),
	CONSTRAINT "recipe_templates_status_ck" CHECK ("recipe_templates"."status" in ('active', 'retired')),
	CONSTRAINT "recipe_templates_name_ck" CHECK (length(btrim("recipe_templates"."name")) between 1 and 80),
	CONSTRAINT "recipe_templates_retired_ck" CHECK ("recipe_templates"."status" <> 'retired' or ("recipe_templates"."retired_by" is not null and "recipe_templates"."retired_at" is not null and "recipe_templates"."retired_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "bom_lines" DROP CONSTRAINT "bom_lines_scaling_ck";--> statement-breakpoint
ALTER TABLE "routing_step_parameters" DROP CONSTRAINT "routing_step_params_kind_ck";--> statement-breakpoint
ALTER TABLE "process_step_readings" DROP CONSTRAINT "step_readings_kind_ck";--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "add_method" text DEFAULT 'weigh' NOT NULL;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "method_qty" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "material_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "method_unit" text;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "method_unit_qty" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "tolerance_units" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "max_qty_g" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "rounding" text;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "method_spec" jsonb;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN "operator_note" text;--> statement-breakpoint
ALTER TABLE "routing_step_parameters" ADD COLUMN "options" jsonb;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD COLUMN "qa_signs" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD COLUMN "is_custom" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "batch_materials" ADD COLUMN "add_method" text DEFAULT 'weigh' NOT NULL;--> statement-breakpoint
ALTER TABLE "batch_materials" ADD COLUMN "method_unit" text;--> statement-breakpoint
ALTER TABLE "batch_materials" ADD COLUMN "method_unit_qty" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "batch_materials" ADD COLUMN "method_target_qty" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "batch_materials" ADD COLUMN "method_rounded_from" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "batch_materials" ADD COLUMN "method_tolerance_units" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "batch_materials" ADD COLUMN "max_qty_g" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "batch_materials" ADD COLUMN "method_spec" jsonb;--> statement-breakpoint
ALTER TABLE "batch_materials" ADD COLUMN "operator_note" text;--> statement-breakpoint
ALTER TABLE "batch_materials" ADD COLUMN "none_needed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "batch_materials" ADD COLUMN "none_needed_by" uuid;--> statement-breakpoint
ALTER TABLE "batch_materials" ADD COLUMN "none_needed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "batch_materials" ADD COLUMN "none_needed_reading" text;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "add_method" text DEFAULT 'weigh' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "method_unit_qty" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "reading_value" text;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "reading_within" boolean;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "whole_container" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "material_units" ADD CONSTRAINT "material_units_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_units" ADD CONSTRAINT "material_units_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_units" ADD CONSTRAINT "material_units_supersedes_id_material_units_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."material_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_units" ADD CONSTRAINT "material_units_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_units" ADD CONSTRAINT "material_units_retired_by_users_id_fk" FOREIGN KEY ("retired_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_templates" ADD CONSTRAINT "recipe_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_templates" ADD CONSTRAINT "recipe_templates_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_templates" ADD CONSTRAINT "recipe_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_templates" ADD CONSTRAINT "recipe_templates_retired_by_users_id_fk" FOREIGN KEY ("retired_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_units_key_version_uq" ON "material_units" USING btree ("unit_key","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "material_units_active_name_uq" ON "material_units" USING btree ("material_id",lower("name")) WHERE "material_units"."status" = 'active';--> statement-breakpoint
CREATE INDEX "material_units_material_idx" ON "material_units" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_templates_active_name_uq" ON "recipe_templates" USING btree ("site_id","kind",lower("name")) WHERE "recipe_templates"."status" = 'active';--> statement-breakpoint
CREATE INDEX "recipe_templates_org_kind_idx" ON "recipe_templates" USING btree ("organization_id","kind");--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_material_unit_id_material_units_id_fk" FOREIGN KEY ("material_unit_id") REFERENCES "public"."material_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_materials" ADD CONSTRAINT "batch_materials_none_needed_by_users_id_fk" FOREIGN KEY ("none_needed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_add_method_ck" CHECK ("bom_lines"."add_method" in ('weigh', 'count', 'volume', 'whole_container', 'as_needed', 'custom'));--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_rounding_ck" CHECK (("bom_lines"."scaling" = 'proportional_round') = ("bom_lines"."rounding" is not null) and ("bom_lines"."rounding" is null or "bom_lines"."rounding" in ('up', 'down', 'nearest')));--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_method_numbers_ck" CHECK (coalesce("bom_lines"."method_qty", 1) > 0 and coalesce("bom_lines"."method_unit_qty", 1) > 0 and coalesce("bom_lines"."tolerance_units", 0) >= 0);--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_whole_units_ck" CHECK ("bom_lines"."add_method" not in ('count', 'whole_container') or ("bom_lines"."scaling" <> 'proportional' and "bom_lines"."method_qty" is not null and "bom_lines"."method_unit_qty" is not null));--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_round_units_ck" CHECK ("bom_lines"."scaling" <> 'proportional_round' or ("bom_lines"."method_qty" is not null and "bom_lines"."method_unit_qty" is not null));--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_as_needed_ck" CHECK (("bom_lines"."add_method" = 'as_needed') = ("bom_lines"."max_qty_g" is not null) and ("bom_lines"."max_qty_g" is null or "bom_lines"."max_qty_g" >= "bom_lines"."quantity_g"));--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_scaling_ck" CHECK ("bom_lines"."scaling" in ('proportional', 'fixed', 'proportional_round'));--> statement-breakpoint
ALTER TABLE "routing_step_parameters" ADD CONSTRAINT "routing_step_params_options_ck" CHECK (("routing_step_parameters"."value_kind" = 'choice') = ("routing_step_parameters"."options" is not null));--> statement-breakpoint
ALTER TABLE "routing_step_parameters" ADD CONSTRAINT "routing_step_params_kind_ck" CHECK ("routing_step_parameters"."value_kind" in ('numeric', 'text', 'boolean', 'choice'));--> statement-breakpoint
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_qa_signs_ck" CHECK (not "routing_steps"."qa_signs" or "routing_steps"."requires_checker");--> statement-breakpoint
ALTER TABLE "process_step_readings" ADD CONSTRAINT "step_readings_kind_ck" CHECK ("process_step_readings"."value_kind" in ('numeric', 'text', 'boolean', 'choice'));--> statement-breakpoint
-- ADR-137: a material unit version is never rewritten. Its material, key, version, kind, name, amount and stock unit
-- stay as they were made; the only change allowed is retiring it (status active -> retired, with who, when and why).
-- A new size is a new version row (same unit_key, version_no + 1). Rows are never deleted.
CREATE OR REPLACE FUNCTION tg_material_units_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'material_units rows are never deleted (retire the unit instead)' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.material_id IS DISTINCT FROM OLD.material_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.unit_key IS DISTINCT FROM OLD.unit_key
     OR NEW.version_no IS DISTINCT FROM OLD.version_no
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.qty_per_unit IS DISTINCT FROM OLD.qty_per_unit
     OR NEW.base_uom IS DISTINCT FROM OLD.base_uom
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a material unit version cannot be changed; add a new version instead' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'retired' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a retired material unit stays retired' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_material_units_immutable ON material_units;
CREATE TRIGGER tg_material_units_immutable BEFORE UPDATE OR DELETE ON material_units
  FOR EACH ROW EXECUTE FUNCTION tg_material_units_immutable();

CREATE TABLE "lookup_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"list_key" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "ck_lookup_values_list_key" CHECK ("lookup_values"."list_key" in ('product_family','material_category','customer_segment','supplier_category')),
	CONSTRAINT "ck_lookup_values_code" CHECK (length("lookup_values"."code") between 1 and 40),
	CONSTRAINT "ck_lookup_values_label" CHECK (length(btrim("lookup_values"."label")) between 1 and 60),
	CONSTRAINT "ck_lookup_values_sort" CHECK ("lookup_values"."sort_order" between 0 and 9999)
);
--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "standard_pack_qty" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "standard_pack_uom" text;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "pack_qty" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "pack_uom" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "lookup_values" ADD CONSTRAINT "lookup_values_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lookup_values" ADD CONSTRAINT "lookup_values_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lookup_values" ADD CONSTRAINT "lookup_values_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lookup_values_org_list_code" ON "lookup_values" USING btree ("organization_id","list_key","code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lookup_values_org_list_label" ON "lookup_values" USING btree ("organization_id","list_key",lower("label"));--> statement-breakpoint
CREATE INDEX "ix_lookup_values_org_list_sort" ON "lookup_values" USING btree ("organization_id","list_key","sort_order");--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_standard_pack_ck" CHECK (("materials"."standard_pack_qty" is null) = ("materials"."standard_pack_uom" is null) and ("materials"."standard_pack_qty" is null or "materials"."standard_pack_qty" > 0));--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "ck_supplier_materials_pack" CHECK (("supplier_materials"."pack_qty" is null) = ("supplier_materials"."pack_uom" is null) and ("supplier_materials"."pack_qty" is null or "supplier_materials"."pack_qty" > 0));
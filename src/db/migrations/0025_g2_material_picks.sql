CREATE TABLE "batch_material_picks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"batch_material_id" uuid NOT NULL,
	"action" text NOT NULL,
	"lot_id" uuid,
	"scanned_lot_code" text,
	"staging_id" uuid,
	"reason" text,
	"picked_by" uuid NOT NULL,
	"picked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_batch_material_picks_action" CHECK ("batch_material_picks"."action" in ('taken','not_needed','untaken')),
	CONSTRAINT "ck_batch_material_picks_reason" CHECK ("batch_material_picks"."action" <> 'not_needed' or length(btrim(coalesce("batch_material_picks"."reason", ''))) >= 3)
);
--> statement-breakpoint
ALTER TABLE "batch_material_picks" ADD CONSTRAINT "batch_material_picks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_picks" ADD CONSTRAINT "batch_material_picks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_picks" ADD CONSTRAINT "batch_material_picks_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_picks" ADD CONSTRAINT "batch_material_picks_batch_material_id_batch_materials_id_fk" FOREIGN KEY ("batch_material_id") REFERENCES "public"."batch_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_picks" ADD CONSTRAINT "batch_material_picks_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_picks" ADD CONSTRAINT "batch_material_picks_staging_id_batch_material_stagings_id_fk" FOREIGN KEY ("staging_id") REFERENCES "public"."batch_material_stagings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_picks" ADD CONSTRAINT "batch_material_picks_picked_by_users_id_fk" FOREIGN KEY ("picked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batch_material_picks_batch_idx" ON "batch_material_picks" USING btree ("batch_id","batch_material_id","picked_at");
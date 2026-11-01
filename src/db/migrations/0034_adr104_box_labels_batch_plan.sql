CREATE TABLE "batch_boxes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"plan_no" integer NOT NULL,
	"box_no" integer NOT NULL,
	"box_count" integer NOT NULL,
	"pieces" integer NOT NULL,
	"units_per_box" integer NOT NULL,
	"container_number" text NOT NULL,
	"container_id" uuid,
	"status" text DEFAULT 'planned' NOT NULL,
	"label_job_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replaced_by" uuid,
	"replaced_at" timestamp with time zone,
	"replaced_reason" text,
	CONSTRAINT "batch_boxes_status_ck" CHECK ("batch_boxes"."status" in ('planned', 'boxed', 'replaced')),
	CONSTRAINT "batch_boxes_numbers_ck" CHECK ("batch_boxes"."pieces" > 0 and "batch_boxes"."units_per_box" > 0 and "batch_boxes"."pieces" <= "batch_boxes"."units_per_box" and "batch_boxes"."box_no" between 1 and "batch_boxes"."box_count"),
	CONSTRAINT "batch_boxes_replaced_ck" CHECK ("batch_boxes"."status" <> 'replaced' or ("batch_boxes"."replaced_by" is not null and "batch_boxes"."replaced_at" is not null and "batch_boxes"."replaced_reason" is not null)),
	CONSTRAINT "batch_boxes_boxed_ck" CHECK ("batch_boxes"."status" <> 'boxed' or "batch_boxes"."container_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "label_jobs" DROP CONSTRAINT "label_jobs_entity_type_ck";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "labelling" text DEFAULT 'per_box' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "batch_plan" jsonb;--> statement-breakpoint
ALTER TABLE "batch_boxes" ADD CONSTRAINT "batch_boxes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_boxes" ADD CONSTRAINT "batch_boxes_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_boxes" ADD CONSTRAINT "batch_boxes_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_boxes" ADD CONSTRAINT "batch_boxes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_boxes" ADD CONSTRAINT "batch_boxes_replaced_by_users_id_fk" FOREIGN KEY ("replaced_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "batch_boxes_org_number_uq" ON "batch_boxes" USING btree ("organization_id","container_number");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_boxes_plan_box_uq" ON "batch_boxes" USING btree ("batch_id","plan_no","box_no");--> statement-breakpoint
CREATE INDEX "batch_boxes_batch_status_idx" ON "batch_boxes" USING btree ("batch_id","status");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_labelling_ck" CHECK ("products"."labelling" in ('per_box', 'per_piece'));--> statement-breakpoint
ALTER TABLE "label_jobs" ADD CONSTRAINT "label_jobs_entity_type_ck" CHECK ("label_jobs"."entity_type" in ('inventory_lot', 'container', 'location', 'batch', 'batch_box', 'inspection_sample', 'equipment'));--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "ck_work_orders_batch_plan" CHECK ("work_orders"."batch_plan" is null or jsonb_array_length("work_orders"."batch_plan"->'sizesG') = "work_orders"."batch_count");
CREATE TABLE "production_daily_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"batch_id" uuid,
	"product_id" uuid NOT NULL,
	"log_date" date NOT NULL,
	"shift" text,
	"notes" text,
	"good_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"qty_uom" text DEFAULT 'units' NOT NULL,
	"corrects_id" uuid,
	"correction_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_production_daily_logs_qty" CHECK ("production_daily_logs"."good_qty" >= 0),
	CONSTRAINT "ck_production_daily_logs_correction" CHECK (("production_daily_logs"."corrects_id" is null) = ("production_daily_logs"."correction_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "production_defect_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"daily_log_id" uuid NOT NULL,
	"defect_type" text NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_production_defect_entries_qty" CHECK ("production_defect_entries"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "production_daily_logs" ADD CONSTRAINT "production_daily_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_daily_logs" ADD CONSTRAINT "production_daily_logs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_daily_logs" ADD CONSTRAINT "production_daily_logs_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_daily_logs" ADD CONSTRAINT "production_daily_logs_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_daily_logs" ADD CONSTRAINT "production_daily_logs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_daily_logs" ADD CONSTRAINT "production_daily_logs_corrects_id_production_daily_logs_id_fk" FOREIGN KEY ("corrects_id") REFERENCES "public"."production_daily_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_daily_logs" ADD CONSTRAINT "production_daily_logs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_defect_entries" ADD CONSTRAINT "production_defect_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_defect_entries" ADD CONSTRAINT "production_defect_entries_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_defect_entries" ADD CONSTRAINT "production_defect_entries_daily_log_id_production_daily_logs_id_fk" FOREIGN KEY ("daily_log_id") REFERENCES "public"."production_daily_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_daily_logs_wo_idx" ON "production_daily_logs" USING btree ("work_order_id","log_date");--> statement-breakpoint
CREATE INDEX "production_daily_logs_site_date_idx" ON "production_daily_logs" USING btree ("site_id","log_date");--> statement-breakpoint
CREATE UNIQUE INDEX "production_daily_logs_corrects_uq" ON "production_daily_logs" USING btree ("corrects_id");--> statement-breakpoint
CREATE INDEX "production_defect_entries_log_idx" ON "production_defect_entries" USING btree ("daily_log_id");
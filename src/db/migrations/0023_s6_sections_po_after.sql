ALTER TABLE "purchase_orders" DROP CONSTRAINT "ck_purchase_orders_sent";--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "section" text;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "source_goods_receipt_line_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "after_the_fact" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "after_the_fact_reason" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "source_goods_receipt_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_source_goods_receipt_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("source_goods_receipt_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_source_goods_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("source_goods_receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_purchase_order_lines_source_gr_line" ON "purchase_order_lines" USING btree ("source_goods_receipt_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_orders_source_receipt" ON "purchase_orders" USING btree ("source_goods_receipt_id") WHERE "purchase_orders"."source_goods_receipt_id" is not null and "purchase_orders"."status" <> 'cancelled';--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_section_ck" CHECK ("locations"."section" is null or "locations"."section" in ('raw_materials', 'packaging', 'finished_goods', 'qa_hold', 'returns', 'production', 'other'));--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "ck_purchase_orders_after_the_fact" CHECK ("purchase_orders"."after_the_fact" = ("purchase_orders"."source_goods_receipt_id" is not null) and (not "purchase_orders"."after_the_fact" or "purchase_orders"."after_the_fact_reason" is not null));--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "ck_purchase_orders_sent" CHECK ("purchase_orders"."status" not in ('sent','partially_received','received','closed') or "purchase_orders"."after_the_fact" or ("purchase_orders"."sent_at" is not null and "purchase_orders"."sent_by" is not null));
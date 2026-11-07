CREATE INDEX "movements_org_source_number_idx" ON "stock_movements" USING btree ("organization_id","source_document_number");--> statement-breakpoint
CREATE INDEX "batches_org_number_idx" ON "batches" USING btree ("organization_id","batch_number");--> statement-breakpoint
CREATE INDEX "so_org_number_idx" ON "sales_orders" USING btree ("organization_id","order_number");
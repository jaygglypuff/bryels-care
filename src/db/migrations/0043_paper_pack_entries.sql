ALTER TABLE "dispense_records" ADD COLUMN "entry_source" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "paper_record_id" uuid;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "entered_by" uuid;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD COLUMN "outage_reason" text;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD COLUMN "entry_source" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD COLUMN "paper_record_id" uuid;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD COLUMN "occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD COLUMN "entered_by" uuid;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD COLUMN "outage_reason" text;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD COLUMN "pack_id" uuid;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_paper_record_id_batch_paper_records_id_fk" FOREIGN KEY ("paper_record_id") REFERENCES "public"."batch_paper_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD CONSTRAINT "process_step_records_paper_record_id_batch_paper_records_id_fk" FOREIGN KEY ("paper_record_id") REFERENCES "public"."batch_paper_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_step_records" ADD CONSTRAINT "process_step_records_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispense_records_paper_idx" ON "dispense_records" USING btree ("paper_record_id") WHERE "dispense_records"."paper_record_id" is not null;--> statement-breakpoint
CREATE INDEX "process_step_records_paper_idx" ON "process_step_records" USING btree ("paper_record_id") WHERE "process_step_records"."paper_record_id" is not null;--> statement-breakpoint
CREATE INDEX "batch_paper_records_pack_idx" ON "batch_paper_records" USING btree ("pack_id") WHERE "batch_paper_records"."pack_id" is not null;--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_entry_source_ck" CHECK ("dispense_records"."entry_source" in ('system', 'paper'));--> statement-breakpoint
ALTER TABLE "dispense_records" ADD CONSTRAINT "dispense_records_paper_ck" CHECK ("dispense_records"."entry_source" <> 'paper' or ("dispense_records"."paper_record_id" is not null and "dispense_records"."occurred_at" is not null and "dispense_records"."entered_by" is not null));--> statement-breakpoint
ALTER TABLE "process_step_records" ADD CONSTRAINT "process_step_records_entry_source_ck" CHECK ("process_step_records"."entry_source" in ('system', 'paper'));--> statement-breakpoint
ALTER TABLE "process_step_records" ADD CONSTRAINT "process_step_records_paper_ck" CHECK ("process_step_records"."entry_source" <> 'paper' or ("process_step_records"."paper_record_id" is not null and "process_step_records"."occurred_at" is not null and "process_step_records"."entered_by" is not null));
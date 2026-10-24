CREATE TABLE "batch_amendments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"reopen_request_id" uuid NOT NULL,
	"amendment_no" integer NOT NULL,
	"section" text NOT NULL,
	"reference" text NOT NULL,
	"previous_value" text NOT NULL,
	"corrected_value" text NOT NULL,
	"reason" text NOT NULL,
	"supersedes_id" uuid,
	"idempotency_key" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_amendments_section_ck" CHECK ("batch_amendments"."section" in ('header', 'materials', 'process_steps', 'line_clearance', 'packaging_reconciliation', 'output_yield', 'qc', 'deviations', 'remarks', 'attachments', 'other')),
	CONSTRAINT "batch_amendments_reason_ck" CHECK (length(trim("batch_amendments"."reason")) >= 5)
);
--> statement-breakpoint
CREATE TABLE "batch_closures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"closure_no" integer NOT NULL,
	"from_state" text NOT NULL,
	"batch_state_transition_id" uuid,
	"generated_document_id" uuid NOT NULL,
	"checks" jsonb NOT NULL,
	"reservations_released" integer DEFAULT 0 NOT NULL,
	"note" text,
	"closed_by" uuid NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_closures_no_ck" CHECK ("batch_closures"."closure_no" >= 1),
	CONSTRAINT "batch_closures_from_ck" CHECK ("batch_closures"."from_state" in ('released', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "batch_paper_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"routing_step_id" uuid,
	"step_no" integer NOT NULL,
	"step_name" text NOT NULL,
	"record_mode" text NOT NULL,
	"page_no" integer NOT NULL,
	"paper_reference" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"generated_document_id" uuid,
	"file_attachment_id" uuid,
	"transcription_note" text,
	"transcribed_by" uuid,
	"transcribed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"issued_by" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_paper_records_status_ck" CHECK ("batch_paper_records"."status" in ('issued', 'attached', 'returned', 'reviewed', 'void')),
	CONSTRAINT "batch_paper_records_mode_ck" CHECK ("batch_paper_records"."record_mode" in ('electronic', 'paper_then_transcribe', 'paper_only')),
	CONSTRAINT "batch_paper_records_page_ck" CHECK ("batch_paper_records"."page_no" >= 1),
	CONSTRAINT "batch_paper_records_sod_ck" CHECK ("batch_paper_records"."reviewed_by" is null or "batch_paper_records"."transcribed_by" is null or "batch_paper_records"."reviewed_by" <> "batch_paper_records"."transcribed_by"),
	CONSTRAINT "batch_paper_records_attached_ck" CHECK ("batch_paper_records"."status" not in ('attached', 'reviewed') or ("batch_paper_records"."file_attachment_id" is not null and "batch_paper_records"."transcribed_by" is not null and "batch_paper_records"."transcribed_at" is not null)),
	CONSTRAINT "batch_paper_records_reviewed_ck" CHECK ("batch_paper_records"."status" <> 'reviewed' or ("batch_paper_records"."reviewed_by" is not null and "batch_paper_records"."reviewed_at" is not null)),
	CONSTRAINT "batch_paper_records_void_ck" CHECK ("batch_paper_records"."status" <> 'void' or ("batch_paper_records"."voided_by" is not null and "batch_paper_records"."voided_at" is not null and "batch_paper_records"."void_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "batch_reopen_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"closure_no" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"target_state" text NOT NULL,
	"reason" text NOT NULL,
	"amendment_scope" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"reopen_no" integer,
	"reopened_at" timestamp with time zone,
	"batch_state_transition_id" uuid,
	"idempotency_key" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_reopen_requests_status_ck" CHECK ("batch_reopen_requests"."status" in ('pending', 'reopened', 'rejected', 'withdrawn')),
	CONSTRAINT "batch_reopen_requests_target_ck" CHECK ("batch_reopen_requests"."target_state" in ('released', 'rejected', 'quarantined')),
	CONSTRAINT "batch_reopen_requests_reason_ck" CHECK (length(trim("batch_reopen_requests"."reason")) >= 10 and length(trim("batch_reopen_requests"."amendment_scope")) >= 5),
	CONSTRAINT "batch_reopen_requests_reopened_ck" CHECK (("batch_reopen_requests"."status" = 'reopened') = ("batch_reopen_requests"."reopen_no" is not null and "batch_reopen_requests"."reopened_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "batch_amendments" ADD CONSTRAINT "batch_amendments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_amendments" ADD CONSTRAINT "batch_amendments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_amendments" ADD CONSTRAINT "batch_amendments_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_amendments" ADD CONSTRAINT "batch_amendments_reopen_request_id_batch_reopen_requests_id_fk" FOREIGN KEY ("reopen_request_id") REFERENCES "public"."batch_reopen_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_amendments" ADD CONSTRAINT "batch_amendments_supersedes_id_batch_amendments_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."batch_amendments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_amendments" ADD CONSTRAINT "batch_amendments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_closures" ADD CONSTRAINT "batch_closures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_closures" ADD CONSTRAINT "batch_closures_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_closures" ADD CONSTRAINT "batch_closures_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_closures" ADD CONSTRAINT "batch_closures_batch_state_transition_id_batch_state_transitions_id_fk" FOREIGN KEY ("batch_state_transition_id") REFERENCES "public"."batch_state_transitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_closures" ADD CONSTRAINT "batch_closures_generated_document_id_generated_documents_id_fk" FOREIGN KEY ("generated_document_id") REFERENCES "public"."generated_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_closures" ADD CONSTRAINT "batch_closures_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_routing_step_id_routing_steps_id_fk" FOREIGN KEY ("routing_step_id") REFERENCES "public"."routing_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_generated_document_id_generated_documents_id_fk" FOREIGN KEY ("generated_document_id") REFERENCES "public"."generated_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_file_attachment_id_file_attachments_id_fk" FOREIGN KEY ("file_attachment_id") REFERENCES "public"."file_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_transcribed_by_users_id_fk" FOREIGN KEY ("transcribed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_paper_records" ADD CONSTRAINT "batch_paper_records_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_reopen_requests" ADD CONSTRAINT "batch_reopen_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_reopen_requests" ADD CONSTRAINT "batch_reopen_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_reopen_requests" ADD CONSTRAINT "batch_reopen_requests_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_reopen_requests" ADD CONSTRAINT "batch_reopen_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_reopen_requests" ADD CONSTRAINT "batch_reopen_requests_batch_state_transition_id_batch_state_transitions_id_fk" FOREIGN KEY ("batch_state_transition_id") REFERENCES "public"."batch_state_transitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "batch_amendments_batch_no_uq" ON "batch_amendments" USING btree ("batch_id","amendment_no");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_amendments_org_idem_uq" ON "batch_amendments" USING btree ("organization_id","idempotency_key") WHERE "batch_amendments"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "batch_closures_batch_no_uq" ON "batch_closures" USING btree ("batch_id","closure_no");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_paper_records_batch_page_uq" ON "batch_paper_records" USING btree ("batch_id","page_no");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_paper_records_org_idem_uq" ON "batch_paper_records" USING btree ("organization_id","idempotency_key") WHERE "batch_paper_records"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "batch_paper_records_batch_idx" ON "batch_paper_records" USING btree ("batch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_reopen_requests_one_pending_uq" ON "batch_reopen_requests" USING btree ("batch_id") WHERE "batch_reopen_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "batch_reopen_requests_reopen_no_uq" ON "batch_reopen_requests" USING btree ("batch_id","reopen_no") WHERE "batch_reopen_requests"."reopen_no" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "batch_reopen_requests_org_idem_uq" ON "batch_reopen_requests" USING btree ("organization_id","idempotency_key") WHERE "batch_reopen_requests"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "batch_reopen_requests_batch_idx" ON "batch_reopen_requests" USING btree ("batch_id");
CREATE TABLE "batch_pauses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"step_no" integer NOT NULL,
	"where_stopped" text NOT NULL,
	"note" text,
	"paused_by" uuid NOT NULL,
	"paused_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text,
	CONSTRAINT "ck_batch_pauses_where" CHECK (length(btrim("batch_pauses"."where_stopped")) >= 2)
);
--> statement-breakpoint
CREATE TABLE "bom_line_alternatives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bom_line_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"ratio" numeric(18, 6) DEFAULT '1' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_bom_line_alternatives_ratio" CHECK ("bom_line_alternatives"."ratio" > 0 and "bom_line_alternatives"."ratio" <= 10)
);
--> statement-breakpoint
CREATE TABLE "material_substitution_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"batch_material_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"substitute_material_id" uuid NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"idempotency_key" text,
	CONSTRAINT "ck_material_substitution_requests_status" CHECK ("material_substitution_requests"."status" in ('pending','approved','refused','withdrawn')),
	CONSTRAINT "ck_material_substitution_requests_qty" CHECK ("material_substitution_requests"."qty_base" > 0),
	CONSTRAINT "ck_material_substitution_requests_reason" CHECK (length(btrim("material_substitution_requests"."reason")) >= 5),
	CONSTRAINT "ck_material_substitution_requests_other" CHECK ("material_substitution_requests"."substitute_material_id" <> "material_substitution_requests"."material_id"),
	CONSTRAINT "ck_material_substitution_requests_decider" CHECK ("material_substitution_requests"."decided_by" is null or "material_substitution_requests"."decided_by" <> "material_substitution_requests"."requested_by"),
	CONSTRAINT "ck_material_substitution_requests_decided" CHECK (("material_substitution_requests"."status" in ('approved', 'refused')) = ("material_substitution_requests"."decided_by" is not null and "material_substitution_requests"."decided_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "qa_result_corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"test_result_id" uuid NOT NULL,
	"value" text NOT NULL,
	"conforms" boolean,
	"uom" text,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"new_result_id" uuid,
	"reopened" jsonb,
	"idempotency_key" text,
	CONSTRAINT "ck_qa_result_corrections_status" CHECK ("qa_result_corrections"."status" in ('pending','approved','refused','withdrawn')),
	CONSTRAINT "ck_qa_result_corrections_reason" CHECK (length(btrim("qa_result_corrections"."reason")) >= 5),
	CONSTRAINT "ck_qa_result_corrections_decider" CHECK ("qa_result_corrections"."decided_by" is null or "qa_result_corrections"."decided_by" <> "qa_result_corrections"."requested_by"),
	CONSTRAINT "ck_qa_result_corrections_decided" CHECK (("qa_result_corrections"."status" in ('approved', 'refused')) = ("qa_result_corrections"."decided_by" is not null and "qa_result_corrections"."decided_at" is not null)),
	CONSTRAINT "ck_qa_result_corrections_approved" CHECK ("qa_result_corrections"."status" <> 'approved' or "qa_result_corrections"."new_result_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ALTER COLUMN "work_order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ALTER COLUMN "substitute_lot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ALTER COLUMN "substitute_location_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD COLUMN "kind" text DEFAULT 'qa_lot' NOT NULL;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD COLUMN "reason_code" text;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD COLUMN "substitute_material_id" uuid;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD COLUMN "new_batch_material_id" uuid;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD COLUMN "requested_by" uuid;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "batch_pauses" ADD CONSTRAINT "batch_pauses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_pauses" ADD CONSTRAINT "batch_pauses_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_pauses" ADD CONSTRAINT "batch_pauses_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_pauses" ADD CONSTRAINT "batch_pauses_paused_by_users_id_fk" FOREIGN KEY ("paused_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_line_alternatives" ADD CONSTRAINT "bom_line_alternatives_bom_line_id_bom_lines_id_fk" FOREIGN KEY ("bom_line_id") REFERENCES "public"."bom_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_line_alternatives" ADD CONSTRAINT "bom_line_alternatives_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_substitution_requests" ADD CONSTRAINT "material_substitution_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_substitution_requests" ADD CONSTRAINT "material_substitution_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_substitution_requests" ADD CONSTRAINT "material_substitution_requests_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_substitution_requests" ADD CONSTRAINT "material_substitution_requests_batch_material_id_batch_materials_id_fk" FOREIGN KEY ("batch_material_id") REFERENCES "public"."batch_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_substitution_requests" ADD CONSTRAINT "material_substitution_requests_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_substitution_requests" ADD CONSTRAINT "material_substitution_requests_substitute_material_id_materials_id_fk" FOREIGN KEY ("substitute_material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_substitution_requests" ADD CONSTRAINT "material_substitution_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_substitution_requests" ADD CONSTRAINT "material_substitution_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_result_corrections" ADD CONSTRAINT "qa_result_corrections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_result_corrections" ADD CONSTRAINT "qa_result_corrections_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_result_corrections" ADD CONSTRAINT "qa_result_corrections_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_result_corrections" ADD CONSTRAINT "qa_result_corrections_test_result_id_test_results_id_fk" FOREIGN KEY ("test_result_id") REFERENCES "public"."test_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_result_corrections" ADD CONSTRAINT "qa_result_corrections_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_result_corrections" ADD CONSTRAINT "qa_result_corrections_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_result_corrections" ADD CONSTRAINT "qa_result_corrections_new_result_id_test_results_id_fk" FOREIGN KEY ("new_result_id") REFERENCES "public"."test_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batch_pauses_batch_idx" ON "batch_pauses" USING btree ("batch_id","paused_at");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_pauses_idem_uq" ON "batch_pauses" USING btree ("organization_id","idempotency_key") WHERE "batch_pauses"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "bom_line_alternatives_line_material_uq" ON "bom_line_alternatives" USING btree ("bom_line_id","material_id");--> statement-breakpoint
CREATE INDEX "material_substitution_requests_batch_idx" ON "material_substitution_requests" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "material_substitution_requests_site_status_idx" ON "material_substitution_requests" USING btree ("site_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "material_substitution_requests_one_pending_uq" ON "material_substitution_requests" USING btree ("batch_material_id") WHERE "material_substitution_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "material_substitution_requests_idem_uq" ON "material_substitution_requests" USING btree ("organization_id","idempotency_key") WHERE "material_substitution_requests"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "qa_result_corrections_batch_idx" ON "qa_result_corrections" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "qa_result_corrections_site_status_idx" ON "qa_result_corrections" USING btree ("site_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "qa_result_corrections_one_pending_uq" ON "qa_result_corrections" USING btree ("test_result_id") WHERE "qa_result_corrections"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "qa_result_corrections_idem_uq" ON "qa_result_corrections" USING btree ("organization_id","idempotency_key") WHERE "qa_result_corrections"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_substitute_material_id_materials_id_fk" FOREIGN KEY ("substitute_material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_new_batch_material_id_batch_materials_id_fk" FOREIGN KEY ("new_batch_material_id") REFERENCES "public"."batch_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "batch_material_substitutions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "batch_material_substitutions_idem_uq" ON "batch_material_substitutions" USING btree ("organization_id","idempotency_key") WHERE "batch_material_substitutions"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "ck_batch_material_substitutions_kind" CHECK ("batch_material_substitutions"."kind" in ('qa_lot','floor_lot','alternative','approved_other'));--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "ck_batch_material_substitutions_lot_kinds" CHECK ("batch_material_substitutions"."kind" not in ('qa_lot', 'floor_lot') or ("batch_material_substitutions"."substitute_lot_id" is not null and "batch_material_substitutions"."substitute_location_id" is not null));--> statement-breakpoint
ALTER TABLE "batch_material_substitutions" ADD CONSTRAINT "ck_batch_material_substitutions_swap" CHECK ("batch_material_substitutions"."kind" not in ('alternative', 'approved_other') or ("batch_material_substitutions"."substitute_material_id" is not null and "batch_material_substitutions"."new_batch_material_id" is not null));
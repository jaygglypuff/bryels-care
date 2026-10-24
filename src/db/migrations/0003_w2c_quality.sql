CREATE TABLE "deviation_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deviation_id" uuid NOT NULL,
	"quality_hold_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deviation_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"deviation_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deviations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"deviation_number" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"severity" text,
	"description" text NOT NULL,
	"step_ref" text,
	"batch_id" uuid,
	"lot_id" uuid,
	"process_step_record_id" uuid,
	"dispense_record_id" uuid,
	"inspection_id" uuid,
	"test_result_id" uuid,
	"raised_by" uuid NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"classified_by" uuid,
	"classified_at" timestamp with time zone,
	"investigation" text,
	"impact_assessment" text,
	"root_cause" text,
	"resolution" text,
	"release_permitted" boolean,
	"effectiveness_check_on" date,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_deviations_status" CHECK ("deviations"."status" in ('open','investigating','closed')),
	CONSTRAINT "ck_deviations_source" CHECK ("deviations"."source" in ('manual','cx_tol','cx_cal','in_process_check','yield','reconciliation','oos','other')),
	CONSTRAINT "ck_deviations_subject" CHECK (num_nonnulls("deviations"."batch_id", "deviations"."lot_id") >= 1),
	CONSTRAINT "ck_deviations_closed" CHECK (("deviations"."status" = 'closed') = ("deviations"."closed_by" is not null and "deviations"."closed_at" is not null and "deviations"."root_cause" is not null and "deviations"."resolution" is not null and "deviations"."release_permitted" is not null and "deviations"."severity" is not null)),
	CONSTRAINT "ck_deviations_closer_not_raiser" CHECK ("deviations"."closed_by" is null or "deviations"."closed_by" <> "deviations"."raised_by")
);
--> statement-breakpoint
CREATE TABLE "disposition_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"decision" text DEFAULT 'conditional_release' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"conditions" text NOT NULL,
	"review_date" date NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"disposition_id" uuid,
	CONSTRAINT "ck_disposition_requests_status" CHECK ("disposition_requests"."status" in ('pending','approved','rejected','cancelled')),
	CONSTRAINT "ck_disposition_requests_decision" CHECK ("disposition_requests"."decision" in ('conditional_release')),
	CONSTRAINT "ck_disposition_requests_sod" CHECK ("disposition_requests"."decided_by" is null or "disposition_requests"."decided_by" <> "disposition_requests"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "inspection_samples" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"inspection_id" uuid NOT NULL,
	"sample_no" integer NOT NULL,
	"lot_id" uuid NOT NULL,
	"container_id" uuid,
	"from_location_id" uuid NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"note" text,
	"sampled_by" uuid NOT NULL,
	"sampled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumption_movement_id" uuid,
	"idempotency_key" text,
	CONSTRAINT "ck_inspection_samples_qty" CHECK ("inspection_samples"."qty_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "inspection_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"inspection_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"inspection_number" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"inspection_kind" text NOT NULL,
	"inspection_plan_id" uuid NOT NULL,
	"lot_id" uuid,
	"batch_id" uuid,
	"process_step_record_id" uuid,
	"sampled_at" timestamp with time zone,
	"sampled_by" uuid,
	"sample_qty_base" numeric(18, 6),
	"sample_uom" text,
	"performed_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"outcome" text,
	"review_note" text,
	"cancel_reason" text,
	"due_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid NOT NULL,
	"idempotency_key" text,
	CONSTRAINT "ck_inspections_status" CHECK ("inspections"."status" in ('pending','in_progress','awaiting_review','approved','rejected','cancelled')),
	CONSTRAINT "ck_inspections_kind" CHECK ("inspections"."inspection_kind" in ('incoming','in_process','finished_product')),
	CONSTRAINT "ck_inspections_outcome" CHECK ("inspections"."outcome" is null or "inspections"."outcome" in ('pass','fail','conditional')),
	CONSTRAINT "ck_inspections_subject" CHECK (num_nonnulls("inspections"."lot_id", "inspections"."batch_id") >= 1),
	CONSTRAINT "ck_inspections_reviewer_not_performer" CHECK ("inspections"."reviewed_by" is null or "inspections"."performed_by" is null or "inspections"."reviewed_by" <> "inspections"."performed_by"),
	CONSTRAINT "ck_inspections_reviewed" CHECK (("inspections"."status" in ('approved','rejected')) = ("inspections"."reviewed_by" is not null and "inspections"."reviewed_at" is not null and "inspections"."outcome" is not null)),
	CONSTRAINT "ck_inspections_cancelled" CHECK ("inspections"."status" <> 'cancelled' or "inspections"."cancel_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "label_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"container_id" uuid,
	"lot_id" uuid,
	"location_id" uuid NOT NULL,
	"scan_payload" text NOT NULL,
	"verified_by" uuid NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_sequence" bigint,
	CONSTRAINT "ck_label_verifications_subject" CHECK (num_nonnulls("label_verifications"."container_id", "label_verifications"."lot_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "test_results" ALTER COLUMN "batch_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "inspection_id" uuid;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "inspection_plan_test_id" uuid;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "test_code" text;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "value_numeric" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "value_text" text;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "value_pass" boolean;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "uom" text;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "instrument_equipment_id" uuid;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "supersedes_id" uuid;--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "correction_reason" text;--> statement-breakpoint
ALTER TABLE "dispositions" ADD COLUMN "requested_by" uuid;--> statement-breakpoint
ALTER TABLE "dispositions" ADD COLUMN "conditions" text;--> statement-breakpoint
ALTER TABLE "dispositions" ADD COLUMN "review_date" date;--> statement-breakpoint
ALTER TABLE "dispositions" ADD COLUMN "inspection_id" uuid;--> statement-breakpoint
ALTER TABLE "deviation_holds" ADD CONSTRAINT "deviation_holds_deviation_id_deviations_id_fk" FOREIGN KEY ("deviation_id") REFERENCES "public"."deviations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_holds" ADD CONSTRAINT "deviation_holds_quality_hold_id_quality_holds_id_fk" FOREIGN KEY ("quality_hold_id") REFERENCES "public"."quality_holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_holds" ADD CONSTRAINT "deviation_holds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_state_transitions" ADD CONSTRAINT "deviation_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_state_transitions" ADD CONSTRAINT "deviation_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_state_transitions" ADD CONSTRAINT "deviation_state_transitions_deviation_id_deviations_id_fk" FOREIGN KEY ("deviation_id") REFERENCES "public"."deviations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_state_transitions" ADD CONSTRAINT "deviation_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_process_step_record_id_process_step_records_id_fk" FOREIGN KEY ("process_step_record_id") REFERENCES "public"."process_step_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_dispense_record_id_dispense_records_id_fk" FOREIGN KEY ("dispense_record_id") REFERENCES "public"."dispense_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_test_result_id_test_results_id_fk" FOREIGN KEY ("test_result_id") REFERENCES "public"."test_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_classified_by_users_id_fk" FOREIGN KEY ("classified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposition_requests" ADD CONSTRAINT "disposition_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposition_requests" ADD CONSTRAINT "disposition_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposition_requests" ADD CONSTRAINT "disposition_requests_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposition_requests" ADD CONSTRAINT "disposition_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposition_requests" ADD CONSTRAINT "disposition_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_samples" ADD CONSTRAINT "inspection_samples_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_samples" ADD CONSTRAINT "inspection_samples_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_samples" ADD CONSTRAINT "inspection_samples_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_samples" ADD CONSTRAINT "inspection_samples_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_samples" ADD CONSTRAINT "inspection_samples_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_samples" ADD CONSTRAINT "inspection_samples_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_samples" ADD CONSTRAINT "inspection_samples_sampled_by_users_id_fk" FOREIGN KEY ("sampled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_samples" ADD CONSTRAINT "inspection_samples_consumption_movement_id_stock_movements_id_fk" FOREIGN KEY ("consumption_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_state_transitions" ADD CONSTRAINT "inspection_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_state_transitions" ADD CONSTRAINT "inspection_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_state_transitions" ADD CONSTRAINT "inspection_state_transitions_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_state_transitions" ADD CONSTRAINT "inspection_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspection_plan_id_inspection_plans_id_fk" FOREIGN KEY ("inspection_plan_id") REFERENCES "public"."inspection_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_process_step_record_id_process_step_records_id_fk" FOREIGN KEY ("process_step_record_id") REFERENCES "public"."process_step_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_sampled_by_users_id_fk" FOREIGN KEY ("sampled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_verifications" ADD CONSTRAINT "label_verifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_verifications" ADD CONSTRAINT "label_verifications_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_verifications" ADD CONSTRAINT "label_verifications_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_verifications" ADD CONSTRAINT "label_verifications_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_verifications" ADD CONSTRAINT "label_verifications_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_verifications" ADD CONSTRAINT "label_verifications_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deviation_holds_pair" ON "deviation_holds" USING btree ("deviation_id","quality_hold_id");--> statement-breakpoint
CREATE INDEX "ix_deviation_holds_hold" ON "deviation_holds" USING btree ("quality_hold_id");--> statement-breakpoint
CREATE INDEX "ix_deviation_transitions_deviation" ON "deviation_state_transitions" USING btree ("deviation_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deviations_org_number" ON "deviations" USING btree ("organization_id","deviation_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_deviations_org_idem" ON "deviations" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_deviations_site_status" ON "deviations" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_deviations_batch" ON "deviations" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "ix_deviations_lot" ON "deviations" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "ix_deviations_test_result" ON "deviations" USING btree ("test_result_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_disposition_requests_batch_pending" ON "disposition_requests" USING btree ("batch_id") WHERE "disposition_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inspection_samples_no" ON "inspection_samples" USING btree ("inspection_id","sample_no");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inspection_samples_org_idem" ON "inspection_samples" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_inspection_transitions_inspection" ON "inspection_state_transitions" USING btree ("inspection_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inspections_org_number" ON "inspections" USING btree ("organization_id","inspection_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inspections_org_idem" ON "inspections" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inspections_batch_plan_live" ON "inspections" USING btree ("batch_id","inspection_plan_id") WHERE "inspections"."batch_id" is not null and "inspections"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inspections_lot_plan_live" ON "inspections" USING btree ("lot_id","inspection_plan_id") WHERE "inspections"."batch_id" is null and "inspections"."lot_id" is not null and "inspections"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "ix_inspections_site_status" ON "inspections" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_inspections_lot" ON "inspections" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "ix_inspections_batch" ON "inspections" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_label_verifications_container" ON "label_verifications" USING btree ("container_id") WHERE "label_verifications"."container_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_label_verifications_lot_location" ON "label_verifications" USING btree ("lot_id","location_id") WHERE "label_verifications"."container_id" is null;--> statement-breakpoint
CREATE INDEX "ix_label_verifications_location" ON "label_verifications" USING btree ("location_id");--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_inspection_plan_test_id_inspection_plan_tests_id_fk" FOREIGN KEY ("inspection_plan_test_id") REFERENCES "public"."inspection_plan_tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_instrument_equipment_id_equipment_id_fk" FOREIGN KEY ("instrument_equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_supersedes_id_test_results_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."test_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispositions" ADD CONSTRAINT "dispositions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_results_batch_idx" ON "test_results" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "test_results_inspection_idx" ON "test_results" USING btree ("inspection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_test_results_supersedes" ON "test_results" USING btree ("supersedes_id");--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "ck_test_results_subject" CHECK (num_nonnulls("test_results"."batch_id", "test_results"."inspection_id") >= 1);--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "ck_test_results_correction" CHECK (("test_results"."supersedes_id" is null) = ("test_results"."correction_reason" is null));--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "ck_test_results_plan_test" CHECK ("test_results"."inspection_id" is null or "test_results"."inspection_plan_test_id" is not null);--> statement-breakpoint
ALTER TABLE "dispositions" ADD CONSTRAINT "ck_dispositions_requester_not_decider" CHECK ("dispositions"."requested_by" is null or "dispositions"."requested_by" <> "dispositions"."decided_by");--> statement-breakpoint
ALTER TABLE "dispositions" ADD CONSTRAINT "ck_dispositions_conditional" CHECK ("dispositions"."decision" <> 'conditional_release' or ("dispositions"."conditions" is not null and "dispositions"."review_date" is not null and "dispositions"."requested_by" is not null));
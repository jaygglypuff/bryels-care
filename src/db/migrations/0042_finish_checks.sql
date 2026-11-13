CREATE TABLE "batch_finish_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"input" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"finish_key" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"reason" text,
	"idempotency_key" text,
	CONSTRAINT "ck_batch_finish_checks_status" CHECK ("batch_finish_checks"."status" in ('waiting','confirmed','returned','withdrawn')),
	CONSTRAINT "ck_batch_finish_checks_decider" CHECK ("batch_finish_checks"."decided_by" is null or "batch_finish_checks"."decided_by" <> "batch_finish_checks"."requested_by"),
	CONSTRAINT "ck_batch_finish_checks_decided" CHECK (("batch_finish_checks"."status" in ('confirmed', 'returned')) = ("batch_finish_checks"."decided_by" is not null and "batch_finish_checks"."decided_at" is not null)),
	CONSTRAINT "ck_batch_finish_checks_returned" CHECK ("batch_finish_checks"."status" <> 'returned' or length(btrim(coalesce("batch_finish_checks"."reason", ''))) >= 3)
);
--> statement-breakpoint
ALTER TABLE "batch_finish_checks" ADD CONSTRAINT "batch_finish_checks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_finish_checks" ADD CONSTRAINT "batch_finish_checks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_finish_checks" ADD CONSTRAINT "batch_finish_checks_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_finish_checks" ADD CONSTRAINT "batch_finish_checks_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_finish_checks" ADD CONSTRAINT "batch_finish_checks_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batch_finish_checks_batch_idx" ON "batch_finish_checks" USING btree ("batch_id","requested_at");--> statement-breakpoint
CREATE INDEX "batch_finish_checks_site_status_idx" ON "batch_finish_checks" USING btree ("site_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_finish_checks_one_waiting_uq" ON "batch_finish_checks" USING btree ("batch_id") WHERE "batch_finish_checks"."status" = 'waiting';--> statement-breakpoint
CREATE UNIQUE INDEX "batch_finish_checks_idem_uq" ON "batch_finish_checks" USING btree ("organization_id","idempotency_key") WHERE "batch_finish_checks"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "batch_finish_checks_finish_key_uq" ON "batch_finish_checks" USING btree ("finish_key");
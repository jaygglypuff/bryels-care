CREATE TABLE "batch_quality_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"record_reviewed" boolean NOT NULL,
	"exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"check_again_on" date,
	"override_reason" text,
	"tester_released" boolean DEFAULT false NOT NULL,
	"disposition_id" uuid,
	"idempotency_key" text NOT NULL,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_batch_quality_checks_decision" CHECK ("batch_quality_checks"."decision" in ('pass', 'not_yet', 'fail')),
	CONSTRAINT "ck_batch_quality_checks_reviewed" CHECK ("batch_quality_checks"."decision" <> 'pass' or "batch_quality_checks"."record_reviewed"),
	CONSTRAINT "ck_batch_quality_checks_reason" CHECK ("batch_quality_checks"."decision" = 'pass' or "batch_quality_checks"."reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "inspections" DROP CONSTRAINT "ck_inspections_reviewer_not_performer";--> statement-breakpoint
ALTER TABLE "batch_quality_checks" ADD CONSTRAINT "batch_quality_checks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_quality_checks" ADD CONSTRAINT "batch_quality_checks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_quality_checks" ADD CONSTRAINT "batch_quality_checks_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batch_quality_checks_batch_idx" ON "batch_quality_checks" USING btree ("batch_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_quality_checks_key_uq" ON "batch_quality_checks" USING btree ("organization_id","idempotency_key");
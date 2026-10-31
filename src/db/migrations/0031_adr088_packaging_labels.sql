ALTER TABLE "label_jobs" DROP CONSTRAINT "label_jobs_copies_ck";--> statement-breakpoint
ALTER TABLE "batch_materials" ALTER COLUMN "bom_line_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "output_lot_number" text;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "output_manufactured_on" text;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "output_expires_on" text;--> statement-breakpoint
ALTER TABLE "label_jobs" ADD CONSTRAINT "label_jobs_copies_ck" CHECK ("label_jobs"."copies" between 1 and 999);
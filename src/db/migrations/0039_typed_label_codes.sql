ALTER TABLE "pick_lines" DROP CONSTRAINT "ck_pick_lines_mode";--> statement-breakpoint
ALTER TABLE "label_verifications" ADD COLUMN "entry_mode" text DEFAULT 'scan' NOT NULL;--> statement-breakpoint
ALTER TABLE "batch_material_picks" ADD COLUMN "lot_entry_mode" text;--> statement-breakpoint
ALTER TABLE "pack_verification_scans" ADD COLUMN "entry_mode" text DEFAULT 'scan' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_verifications" ADD CONSTRAINT "ck_label_verifications_mode" CHECK ("label_verifications"."entry_mode" in ('scan','typed'));--> statement-breakpoint
ALTER TABLE "batch_material_picks" ADD CONSTRAINT "ck_batch_material_picks_lot_mode" CHECK ("batch_material_picks"."lot_entry_mode" is null or "batch_material_picks"."lot_entry_mode" in ('scan','typed'));--> statement-breakpoint
ALTER TABLE "pack_verification_scans" ADD CONSTRAINT "ck_pack_verification_scans_mode" CHECK ("pack_verification_scans"."entry_mode" in ('scan','typed'));--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "ck_pick_lines_mode" CHECK ("pick_lines"."entry_mode" in ('scan','typed','manual'));
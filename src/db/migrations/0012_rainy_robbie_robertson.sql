CREATE TABLE "device_registrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"device_key_hash" text NOT NULL,
	"label" text NOT NULL,
	"platform" text DEFAULT 'other' NOT NULL,
	"browser" text,
	"device_class" text DEFAULT 'floor_shared' NOT NULL,
	"is_managed" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"allowed_offline_workflows" text[] DEFAULT '{}'::text[] NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"registered_by" uuid,
	"registered_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_reference_refresh_at" timestamp with time zone,
	"reference_cursor" text,
	"max_clock_skew_seen_seconds" integer DEFAULT 0 NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid,
	"status_reason" text,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"removed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_device_registrations_status" CHECK ("device_registrations"."status" in ('pending','active','suspended','removed')),
	CONSTRAINT "ck_device_registrations_class" CHECK ("device_registrations"."device_class" in ('floor_shared','personal','managed_tablet')),
	CONSTRAINT "ck_device_registrations_platform" CHECK ("device_registrations"."platform" in ('android','ios','windows','macos','other')),
	CONSTRAINT "ck_device_registrations_workflows" CHECK ("device_registrations"."allowed_offline_workflows" <@ array['movement_request','dispensing','process_steps','stock_count','receiving','pick_pack']::text[]),
	CONSTRAINT "ck_device_registrations_registered" CHECK ("device_registrations"."status" not in ('active','suspended') or "device_registrations"."registered_by" is not null),
	CONSTRAINT "ck_device_registrations_removed" CHECK ("device_registrations"."status" <> 'removed' or ("device_registrations"."removed_reason" is not null and "device_registrations"."removed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "sync_commands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"device_registration_id" uuid,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"command_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"client_created_at" timestamp with time zone NOT NULL,
	"client_sequence" bigint,
	"auth_snapshot_issued_at" timestamp with time zone NOT NULL,
	"auth_snapshot_session_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_batch_id" uuid NOT NULL,
	"position_in_batch" integer DEFAULT 0 NOT NULL,
	"replayed_at" timestamp with time zone,
	"clock_skew_seconds" integer DEFAULT 0 NOT NULL,
	"is_clock_skew_flagged" boolean DEFAULT false NOT NULL,
	"depends_on_command_id" uuid,
	"status" text DEFAULT 'received' NOT NULL,
	"server_result" jsonb,
	"error_code" text,
	"error_message" text,
	"applied_at" timestamp with time zone,
	"applied_entity_type" text,
	"applied_entity_id" uuid,
	"applied_entity_number" text,
	"resolution_of_conflict_id" uuid,
	"created_by" uuid,
	"correlation_id" uuid NOT NULL,
	CONSTRAINT "ck_sync_commands_status" CHECK ("sync_commands"."status" in ('received','applied','rejected','conflict','superseded')),
	CONSTRAINT "ck_sync_commands_type" CHECK ("sync_commands"."command_type" ~ '^[a-z]+\.[a-z_]+\.[a-z_]+$')
);
--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"sync_command_id" uuid NOT NULL,
	"device_registration_id" uuid,
	"user_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"reason_code" text NOT NULL,
	"reason_message" text NOT NULL,
	"client_state" jsonb NOT NULL,
	"server_state" jsonb,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"related_entity_number" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"resolution_command_id" uuid,
	"escalated_entity_type" text,
	"escalated_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_sync_conflicts_reason" CHECK ("sync_conflicts"."reason_code" in ('validation_failed','permission_denied','site_not_allowed','state_changed','stock_not_eligible','insufficient_stock','out_of_tolerance','wrong_lot','duplicate_key_mismatch','dependency_failed','auth_snapshot_expired','session_revoked','count_closed','other')),
	CONSTRAINT "ck_sync_conflicts_status" CHECK ("sync_conflicts"."status" in ('open','resolved_applied','resolved_discarded','resolved_amended','escalated')),
	CONSTRAINT "ck_sync_conflicts_resolution_note" CHECK ("sync_conflicts"."status" = 'open' or ("sync_conflicts"."resolution_note" is not null and "sync_conflicts"."resolved_by" is not null and "sync_conflicts"."resolved_at" is not null)),
	CONSTRAINT "ck_sync_conflicts_escalation" CHECK (("sync_conflicts"."escalated_entity_type" is null) = ("sync_conflicts"."escalated_entity_id" is null)),
	CONSTRAINT "ck_sync_conflicts_escalated_kind" CHECK ("sync_conflicts"."escalated_entity_type" is null or "sync_conflicts"."escalated_entity_type" in ('deviation','stock_adjustment'))
);
--> statement-breakpoint
ALTER TABLE "device_registrations" ADD CONSTRAINT "device_registrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_registrations" ADD CONSTRAINT "device_registrations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_registrations" ADD CONSTRAINT "device_registrations_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_registrations" ADD CONSTRAINT "device_registrations_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_registrations" ADD CONSTRAINT "device_registrations_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_registrations" ADD CONSTRAINT "device_registrations_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_commands" ADD CONSTRAINT "sync_commands_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_commands" ADD CONSTRAINT "sync_commands_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_commands" ADD CONSTRAINT "sync_commands_device_registration_id_device_registrations_id_fk" FOREIGN KEY ("device_registration_id") REFERENCES "public"."device_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_commands" ADD CONSTRAINT "sync_commands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_commands" ADD CONSTRAINT "sync_commands_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_commands" ADD CONSTRAINT "sync_commands_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_sync_command_id_sync_commands_id_fk" FOREIGN KEY ("sync_command_id") REFERENCES "public"."sync_commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_device_registration_id_device_registrations_id_fk" FOREIGN KEY ("device_registration_id") REFERENCES "public"."device_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_resolution_command_id_sync_commands_id_fk" FOREIGN KEY ("resolution_command_id") REFERENCES "public"."sync_commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_registrations_org_key_uq" ON "device_registrations" USING btree ("organization_id","device_key_hash");--> statement-breakpoint
CREATE INDEX "device_registrations_site_status_idx" ON "device_registrations" USING btree ("site_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_commands_org_key_uq" ON "sync_commands" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_commands_device_sequence_uq" ON "sync_commands" USING btree ("device_registration_id","client_sequence") WHERE "sync_commands"."device_registration_id" is not null and "sync_commands"."client_sequence" is not null;--> statement-breakpoint
CREATE INDEX "sync_commands_site_status_idx" ON "sync_commands" USING btree ("site_id","status","received_at");--> statement-breakpoint
CREATE INDEX "sync_commands_user_idx" ON "sync_commands" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE INDEX "sync_commands_device_idx" ON "sync_commands" USING btree ("device_registration_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_conflicts_command_uq" ON "sync_conflicts" USING btree ("sync_command_id");--> statement-breakpoint
CREATE INDEX "sync_conflicts_site_status_idx" ON "sync_conflicts" USING btree ("site_id","status","created_at");--> statement-breakpoint
CREATE INDEX "sync_conflicts_user_status_idx" ON "sync_conflicts" USING btree ("user_id","status");
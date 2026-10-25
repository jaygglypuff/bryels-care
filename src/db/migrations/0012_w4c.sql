CREATE TABLE "capa_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"capa_id" uuid NOT NULL,
	"action_no" integer NOT NULL,
	"action_kind" text NOT NULL,
	"description" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"verification_method" text,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"completion_note" text,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"verification_note" text,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_capa_actions_kind" CHECK ("capa_actions"."action_kind" in ('corrective','preventive')),
	CONSTRAINT "ck_capa_actions_status" CHECK ("capa_actions"."status" in ('open','done','verified','cancelled')),
	CONSTRAINT "ck_capa_actions_done" CHECK ("capa_actions"."status" not in ('done', 'verified') or ("capa_actions"."completed_at" is not null and "capa_actions"."completed_by" is not null and "capa_actions"."completion_note" is not null)),
	CONSTRAINT "ck_capa_actions_verified" CHECK (("capa_actions"."status" = 'verified') = ("capa_actions"."verified_by" is not null and "capa_actions"."verified_at" is not null)),
	CONSTRAINT "ck_capa_actions_verifier" CHECK ("capa_actions"."verified_by" is null or "capa_actions"."verified_by" <> "capa_actions"."completed_by"),
	CONSTRAINT "ck_capa_actions_cancelled" CHECK ("capa_actions"."status" <> 'cancelled' or "capa_actions"."cancel_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "capa_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"capa_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"capa_number" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"source_kind" text NOT NULL,
	"deviation_id" uuid,
	"complaint_id" uuid,
	"source_reference" text,
	"title" text NOT NULL,
	"problem_statement" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"due_date" date,
	"root_cause" text,
	"corrective_action" text,
	"preventive_action" text,
	"effectiveness_criteria" text,
	"effectiveness_due_on" date,
	"effectiveness_result" text,
	"effectiveness_evidence" text,
	"effectiveness_checked_by" uuid,
	"effectiveness_checked_at" timestamp with time zone,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"closure_note" text,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid NOT NULL,
	"idempotency_key" text,
	CONSTRAINT "ck_capas_status" CHECK ("capas"."status" in ('open','in_progress','verification','closed','cancelled')),
	CONSTRAINT "ck_capas_source" CHECK ("capas"."source_kind" in ('deviation','complaint','audit','change_control','other')),
	CONSTRAINT "ck_capas_source_link" CHECK (("capas"."source_kind" <> 'deviation' or "capas"."deviation_id" is not null) and ("capas"."source_kind" <> 'complaint' or "capas"."complaint_id" is not null)),
	CONSTRAINT "ck_capas_effectiveness" CHECK ("capas"."effectiveness_result" is null or ("capas"."effectiveness_result" in ('effective','not_effective') and "capas"."effectiveness_checked_by" is not null and "capas"."effectiveness_checked_at" is not null and "capas"."effectiveness_evidence" is not null)),
	CONSTRAINT "ck_capas_closed" CHECK (("capas"."status" = 'closed') = ("capas"."closed_by" is not null and "capas"."closed_at" is not null and coalesce("capas"."effectiveness_result" = 'effective', false) and "capas"."root_cause" is not null)),
	CONSTRAINT "ck_capas_closer_not_submitter" CHECK ("capas"."closed_by" is null or "capas"."closed_by" is distinct from "capas"."submitted_by"),
	CONSTRAINT "ck_capas_cancelled" CHECK ("capas"."status" <> 'cancelled' or "capas"."cancel_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "change_control_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"change_control_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_controls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"change_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"justification" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"entity_label" text,
	"capa_id" uuid,
	"risk_level" text,
	"impact_assessment" text,
	"implementation_plan" text,
	"target_date" date,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"implemented_by" uuid,
	"implemented_at" timestamp with time zone,
	"implementation_note" text,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"closure_note" text,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid NOT NULL,
	"idempotency_key" text,
	CONSTRAINT "ck_change_controls_status" CHECK ("change_controls"."status" in ('draft','submitted','approved','rejected','implemented','closed','cancelled')),
	CONSTRAINT "ck_change_controls_entity_type" CHECK ("change_controls"."entity_type" in ('formula_revision','routing_revision','inspection_plan','work_instruction_revision','other')),
	CONSTRAINT "ck_change_controls_submitted" CHECK ("change_controls"."status" in ('draft', 'cancelled') or ("change_controls"."submitted_by" is not null and "change_controls"."submitted_at" is not null and "change_controls"."impact_assessment" is not null and "change_controls"."risk_level" is not null)),
	CONSTRAINT "ck_change_controls_implemented" CHECK ("change_controls"."status" not in ('implemented', 'closed') or ("change_controls"."implemented_by" is not null and "change_controls"."implemented_at" is not null and "change_controls"."implementation_note" is not null)),
	CONSTRAINT "ck_change_controls_closed" CHECK (("change_controls"."status" = 'closed') = ("change_controls"."closed_by" is not null and "change_controls"."closed_at" is not null)),
	CONSTRAINT "ck_change_controls_closer" CHECK ("change_controls"."closed_by" is null or "change_controls"."closed_by" <> "change_controls"."implemented_by"),
	CONSTRAINT "ck_change_controls_cancelled" CHECK ("change_controls"."status" <> 'cancelled' or "change_controls"."cancel_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "recall_case_containers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"recall_case_id" uuid NOT NULL,
	"container_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"shipment_id" uuid,
	"status_at_opening" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recall_case_customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"recall_case_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"dr_number" text NOT NULL,
	"qty_shipped_base" numeric(18, 6) NOT NULL,
	"qty_returned_base" numeric(18, 6) DEFAULT '0' NOT NULL,
	"qty_accounted_base" numeric(18, 6) DEFAULT '0' NOT NULL,
	"uom_base" text NOT NULL,
	"notified_at" timestamp with time zone,
	"notified_by" uuid,
	"notification_method" text,
	"acknowledged_at" timestamp with time zone,
	"accounted_note" text,
	"note" text,
	CONSTRAINT "ck_recall_case_customers_qty" CHECK ("recall_case_customers"."qty_shipped_base" >= 0 and "recall_case_customers"."qty_returned_base" >= 0 and "recall_case_customers"."qty_accounted_base" >= 0),
	CONSTRAINT "ck_recall_case_customers_ack" CHECK ("recall_case_customers"."acknowledged_at" is null or "recall_case_customers"."notified_at" is not null),
	CONSTRAINT "ck_recall_case_customers_accounted" CHECK ("recall_case_customers"."qty_accounted_base" = 0 or "recall_case_customers"."accounted_note" is not null)
);
--> statement-breakpoint
CREATE TABLE "recall_case_lots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"recall_case_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"trace_role" text NOT NULL,
	"status_at_opening" text NOT NULL,
	"on_hand_at_opening" numeric(18, 6) DEFAULT '0' NOT NULL,
	"uom_base" text NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"disposition_id" uuid,
	"marked_by" uuid,
	"marked_at" timestamp with time zone,
	"note" text,
	CONSTRAINT "ck_recall_case_lots_outcome" CHECK ("recall_case_lots"."outcome" in ('pending','recalled','already_recalled','not_marked')),
	CONSTRAINT "ck_recall_case_lots_role" CHECK ("recall_case_lots"."trace_role" in ('start', 'downstream')),
	CONSTRAINT "ck_recall_case_lots_marked" CHECK ("recall_case_lots"."outcome" <> 'recalled' or ("recall_case_lots"."disposition_id" is not null and "recall_case_lots"."marked_by" is not null and "recall_case_lots"."marked_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "recall_case_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"recall_case_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recall_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"origin_site_id" uuid,
	"recall_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"recall_kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"classification" text,
	"regulatory_notes" text,
	"complaint_id" uuid,
	"subject_code" text NOT NULL,
	"subject_kind" text NOT NULL,
	"trace_mode" text NOT NULL,
	"scope_as_of" timestamp with time zone NOT NULL,
	"hidden_at_opening" integer DEFAULT 0 NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"marked_by" uuid,
	"marked_at" timestamp with time zone,
	"recovery_started_at" timestamp with time zone,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"closure_report" text,
	"reconciliation_explanation" text,
	"cancel_reason" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_recall_cases_status" CHECK ("recall_cases"."status" in ('draft','submitted','approved','notifying','recovering','closed','cancelled')),
	CONSTRAINT "ck_recall_cases_kind" CHECK ("recall_cases"."recall_kind" in ('recall','withdrawal','mock')),
	CONSTRAINT "ck_recall_cases_mode" CHECK ("recall_cases"."trace_mode" in ('forward', 'reverse')),
	CONSTRAINT "ck_recall_cases_submitted" CHECK ("recall_cases"."status" in ('draft', 'cancelled') or ("recall_cases"."submitted_by" is not null and "recall_cases"."submitted_at" is not null)),
	CONSTRAINT "ck_recall_cases_approved" CHECK ("recall_cases"."status" not in ('approved', 'notifying', 'recovering', 'closed') or "recall_cases"."approved_at" is not null),
	CONSTRAINT "ck_recall_cases_closed" CHECK (("recall_cases"."status" = 'closed') = ("recall_cases"."closed_by" is not null and "recall_cases"."closed_at" is not null and "recall_cases"."closure_report" is not null)),
	CONSTRAINT "ck_recall_cases_cancelled" CHECK ("recall_cases"."status" <> 'cancelled' or "recall_cases"."cancel_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "maintenance_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"plan_number" text NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"trigger_kind" text NOT NULL,
	"interval_days" integer,
	"usage_metric" text,
	"usage_interval" numeric(18, 6),
	"lead_days" integer,
	"takes_equipment_down" boolean DEFAULT true NOT NULL,
	"responsible_user_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"next_due_on" date,
	"usage_since" timestamp with time zone DEFAULT now() NOT NULL,
	"last_completed_at" timestamp with time zone,
	"last_work_order_id" uuid,
	"status_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_maintenance_plans_trigger" CHECK ("maintenance_plans"."trigger_kind" in ('time','usage')),
	CONSTRAINT "ck_maintenance_plans_status" CHECK ("maintenance_plans"."status" in ('active','paused','retired')),
	CONSTRAINT "ck_maintenance_plans_time" CHECK ("maintenance_plans"."trigger_kind" <> 'time' or ("maintenance_plans"."interval_days" is not null and "maintenance_plans"."interval_days" > 0 and "maintenance_plans"."next_due_on" is not null and "maintenance_plans"."usage_metric" is null and "maintenance_plans"."usage_interval" is null)),
	CONSTRAINT "ck_maintenance_plans_usage" CHECK ("maintenance_plans"."trigger_kind" <> 'usage' or ("maintenance_plans"."usage_metric" in ('batches','hours') and "maintenance_plans"."usage_interval" is not null and "maintenance_plans"."usage_interval" > 0 and "maintenance_plans"."interval_days" is null and "maintenance_plans"."next_due_on" is null)),
	CONSTRAINT "ck_maintenance_plans_lead" CHECK ("maintenance_plans"."lead_days" is null or ("maintenance_plans"."lead_days" >= 0 and "maintenance_plans"."lead_days" <= 365)),
	CONSTRAINT "ck_maintenance_plans_reason" CHECK ("maintenance_plans"."status" = 'active' or "maintenance_plans"."status_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "maintenance_spare_parts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"equipment_id" uuid,
	"min_qty_base" numeric(18, 6),
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_maintenance_spare_parts" UNIQUE NULLS NOT DISTINCT("site_id","material_id","equipment_id"),
	CONSTRAINT "ck_maintenance_spare_parts_min" CHECK ("maintenance_spare_parts"."min_qty_base" is null or "maintenance_spare_parts"."min_qty_base" >= 0)
);
--> statement-breakpoint
CREATE TABLE "maintenance_work_order_parts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"from_location_id" uuid NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"uom_base" text NOT NULL,
	"stock_movement_id" uuid NOT NULL,
	"issued_by" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_mwo_parts_qty" CHECK ("maintenance_work_order_parts"."qty_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "maintenance_work_order_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_work_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"plan_id" uuid,
	"work_order_number" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_date" date,
	"assigned_to" uuid,
	"takes_equipment_down" boolean DEFAULT true NOT NULL,
	"reported_down" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"started_by" uuid,
	"hold_reason" text,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"work_done" text,
	"result" text,
	"service_record_id" uuid,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid NOT NULL,
	"idempotency_key" text,
	CONSTRAINT "ck_maintenance_wos_kind" CHECK ("maintenance_work_orders"."kind" in ('preventive','corrective','inspection')),
	CONSTRAINT "ck_maintenance_wos_status" CHECK ("maintenance_work_orders"."status" in ('open','in_progress','on_hold','completed','cancelled')),
	CONSTRAINT "ck_maintenance_wos_priority" CHECK ("maintenance_work_orders"."priority" in ('low','normal','high','urgent')),
	CONSTRAINT "ck_maintenance_wos_result" CHECK ("maintenance_work_orders"."result" is null or "maintenance_work_orders"."result" in ('completed','pass','fail')),
	CONSTRAINT "ck_maintenance_wos_started" CHECK ("maintenance_work_orders"."status" in ('open', 'cancelled') or ("maintenance_work_orders"."started_at" is not null and "maintenance_work_orders"."started_by" is not null)),
	CONSTRAINT "ck_maintenance_wos_completed" CHECK (("maintenance_work_orders"."status" = 'completed') = ("maintenance_work_orders"."completed_at" is not null and "maintenance_work_orders"."completed_by" is not null and "maintenance_work_orders"."work_done" is not null and "maintenance_work_orders"."result" is not null and "maintenance_work_orders"."service_record_id" is not null)),
	CONSTRAINT "ck_maintenance_wos_hold" CHECK ("maintenance_work_orders"."status" <> 'on_hold' or "maintenance_work_orders"."hold_reason" is not null),
	CONSTRAINT "ck_maintenance_wos_cancelled" CHECK ("maintenance_work_orders"."status" <> 'cancelled' or "maintenance_work_orders"."cancel_reason" is not null),
	CONSTRAINT "ck_maintenance_wos_preventive_plan" CHECK ("maintenance_work_orders"."kind" <> 'preventive' or "maintenance_work_orders"."plan_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "approval_rules" DROP CONSTRAINT "ck_approval_rules_document_type";--> statement-breakpoint
ALTER TABLE "capa_actions" ADD CONSTRAINT "capa_actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_actions" ADD CONSTRAINT "capa_actions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_actions" ADD CONSTRAINT "capa_actions_capa_id_capas_id_fk" FOREIGN KEY ("capa_id") REFERENCES "public"."capas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_actions" ADD CONSTRAINT "capa_actions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_actions" ADD CONSTRAINT "capa_actions_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_actions" ADD CONSTRAINT "capa_actions_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_actions" ADD CONSTRAINT "capa_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_state_transitions" ADD CONSTRAINT "capa_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_state_transitions" ADD CONSTRAINT "capa_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_state_transitions" ADD CONSTRAINT "capa_state_transitions_capa_id_capas_id_fk" FOREIGN KEY ("capa_id") REFERENCES "public"."capas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_state_transitions" ADD CONSTRAINT "capa_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_deviation_id_deviations_id_fk" FOREIGN KEY ("deviation_id") REFERENCES "public"."deviations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_effectiveness_checked_by_users_id_fk" FOREIGN KEY ("effectiveness_checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capas" ADD CONSTRAINT "capas_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_control_state_transitions" ADD CONSTRAINT "change_control_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_control_state_transitions" ADD CONSTRAINT "change_control_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_control_state_transitions" ADD CONSTRAINT "change_control_state_transitions_change_control_id_change_controls_id_fk" FOREIGN KEY ("change_control_id") REFERENCES "public"."change_controls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_control_state_transitions" ADD CONSTRAINT "change_control_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_controls" ADD CONSTRAINT "change_controls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_controls" ADD CONSTRAINT "change_controls_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_controls" ADD CONSTRAINT "change_controls_capa_id_capas_id_fk" FOREIGN KEY ("capa_id") REFERENCES "public"."capas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_controls" ADD CONSTRAINT "change_controls_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_controls" ADD CONSTRAINT "change_controls_implemented_by_users_id_fk" FOREIGN KEY ("implemented_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_controls" ADD CONSTRAINT "change_controls_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_controls" ADD CONSTRAINT "change_controls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_controls" ADD CONSTRAINT "change_controls_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_containers" ADD CONSTRAINT "recall_case_containers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_containers" ADD CONSTRAINT "recall_case_containers_recall_case_id_recall_cases_id_fk" FOREIGN KEY ("recall_case_id") REFERENCES "public"."recall_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_containers" ADD CONSTRAINT "recall_case_containers_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_containers" ADD CONSTRAINT "recall_case_containers_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_containers" ADD CONSTRAINT "recall_case_containers_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_customers" ADD CONSTRAINT "recall_case_customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_customers" ADD CONSTRAINT "recall_case_customers_recall_case_id_recall_cases_id_fk" FOREIGN KEY ("recall_case_id") REFERENCES "public"."recall_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_customers" ADD CONSTRAINT "recall_case_customers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_customers" ADD CONSTRAINT "recall_case_customers_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_customers" ADD CONSTRAINT "recall_case_customers_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_customers" ADD CONSTRAINT "recall_case_customers_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_customers" ADD CONSTRAINT "recall_case_customers_notified_by_users_id_fk" FOREIGN KEY ("notified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_lots" ADD CONSTRAINT "recall_case_lots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_lots" ADD CONSTRAINT "recall_case_lots_recall_case_id_recall_cases_id_fk" FOREIGN KEY ("recall_case_id") REFERENCES "public"."recall_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_lots" ADD CONSTRAINT "recall_case_lots_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_lots" ADD CONSTRAINT "recall_case_lots_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_lots" ADD CONSTRAINT "recall_case_lots_disposition_id_dispositions_id_fk" FOREIGN KEY ("disposition_id") REFERENCES "public"."dispositions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_lots" ADD CONSTRAINT "recall_case_lots_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_state_transitions" ADD CONSTRAINT "recall_case_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_state_transitions" ADD CONSTRAINT "recall_case_state_transitions_recall_case_id_recall_cases_id_fk" FOREIGN KEY ("recall_case_id") REFERENCES "public"."recall_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_case_state_transitions" ADD CONSTRAINT "recall_case_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_cases" ADD CONSTRAINT "recall_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_cases" ADD CONSTRAINT "recall_cases_origin_site_id_sites_id_fk" FOREIGN KEY ("origin_site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_cases" ADD CONSTRAINT "recall_cases_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_cases" ADD CONSTRAINT "recall_cases_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_cases" ADD CONSTRAINT "recall_cases_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_cases" ADD CONSTRAINT "recall_cases_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_cases" ADD CONSTRAINT "recall_cases_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recall_cases" ADD CONSTRAINT "recall_cases_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_spare_parts" ADD CONSTRAINT "maintenance_spare_parts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_spare_parts" ADD CONSTRAINT "maintenance_spare_parts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_spare_parts" ADD CONSTRAINT "maintenance_spare_parts_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_spare_parts" ADD CONSTRAINT "maintenance_spare_parts_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_spare_parts" ADD CONSTRAINT "maintenance_spare_parts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_order_parts" ADD CONSTRAINT "maintenance_work_order_parts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_order_parts" ADD CONSTRAINT "maintenance_work_order_parts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_order_parts" ADD CONSTRAINT "maintenance_work_order_parts_work_order_id_maintenance_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."maintenance_work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_order_parts" ADD CONSTRAINT "maintenance_work_order_parts_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_order_parts" ADD CONSTRAINT "maintenance_work_order_parts_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_order_parts" ADD CONSTRAINT "maintenance_work_order_parts_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_order_parts" ADD CONSTRAINT "maintenance_work_order_parts_stock_movement_id_stock_movements_id_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_order_parts" ADD CONSTRAINT "maintenance_work_order_parts_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_order_state_transitions" ADD CONSTRAINT "maintenance_work_order_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_order_state_transitions" ADD CONSTRAINT "maintenance_work_order_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_order_state_transitions" ADD CONSTRAINT "maintenance_work_order_state_transitions_work_order_id_maintenance_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."maintenance_work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_order_state_transitions" ADD CONSTRAINT "maintenance_work_order_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_plan_id_maintenance_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."maintenance_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_service_record_id_equipment_service_records_id_fk" FOREIGN KEY ("service_record_id") REFERENCES "public"."equipment_service_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ADD CONSTRAINT "maintenance_work_orders_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_capa_actions_no" ON "capa_actions" USING btree ("capa_id","action_no");--> statement-breakpoint
CREATE INDEX "ix_capa_actions_open_due" ON "capa_actions" USING btree ("site_id","status","due_date");--> statement-breakpoint
CREATE INDEX "ix_capa_transitions_capa" ON "capa_state_transitions" USING btree ("capa_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_capas_org_number" ON "capas" USING btree ("organization_id","capa_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_capas_org_idem" ON "capas" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_capas_site_status" ON "capas" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_capas_deviation" ON "capas" USING btree ("deviation_id");--> statement-breakpoint
CREATE INDEX "ix_capas_complaint" ON "capas" USING btree ("complaint_id");--> statement-breakpoint
CREATE INDEX "ix_change_control_transitions_cc" ON "change_control_state_transitions" USING btree ("change_control_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_change_controls_org_number" ON "change_controls" USING btree ("organization_id","change_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_change_controls_org_idem" ON "change_controls" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_change_controls_status" ON "change_controls" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ix_change_controls_entity" ON "change_controls" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_recall_case_containers" ON "recall_case_containers" USING btree ("recall_case_id","container_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_recall_case_customers" ON "recall_case_customers" USING btree ("recall_case_id","customer_id","shipment_id","lot_id");--> statement-breakpoint
CREATE INDEX "ix_recall_case_customers_case" ON "recall_case_customers" USING btree ("recall_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_recall_case_lots" ON "recall_case_lots" USING btree ("recall_case_id","lot_id");--> statement-breakpoint
CREATE INDEX "ix_recall_case_lots_lot" ON "recall_case_lots" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "ix_recall_case_transitions_case" ON "recall_case_state_transitions" USING btree ("recall_case_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_recall_cases_org_number" ON "recall_cases" USING btree ("organization_id","recall_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_recall_cases_org_idem" ON "recall_cases" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_recall_cases_status" ON "recall_cases" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_maintenance_plans_org_number" ON "maintenance_plans" USING btree ("organization_id","plan_number");--> statement-breakpoint
CREATE INDEX "ix_maintenance_plans_equipment" ON "maintenance_plans" USING btree ("equipment_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mwo_parts_movement" ON "maintenance_work_order_parts" USING btree ("stock_movement_id");--> statement-breakpoint
CREATE INDEX "ix_mwo_parts_wo" ON "maintenance_work_order_parts" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "ix_mwo_transitions_wo" ON "maintenance_work_order_state_transitions" USING btree ("work_order_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_maintenance_wos_org_number" ON "maintenance_work_orders" USING btree ("organization_id","work_order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_maintenance_wos_org_idem" ON "maintenance_work_orders" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_maintenance_wos_plan_live" ON "maintenance_work_orders" USING btree ("plan_id") WHERE "maintenance_work_orders"."plan_id" is not null and "maintenance_work_orders"."status" in ('open', 'in_progress', 'on_hold');--> statement-breakpoint
CREATE INDEX "ix_maintenance_wos_site_status" ON "maintenance_work_orders" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_maintenance_wos_equipment" ON "maintenance_work_orders" USING btree ("equipment_id","status");--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "ck_approval_rules_document_type" CHECK ("approval_rules"."document_type" in ('purchase_request','purchase_order','sales_order','quote','stock_adjustment','stock_count_variance','expense_claim','invoice','supplier_bill','credit_note','payment_record','dispense_exception','over_shipment','formula_revision','routing_revision','routing_revision_sequencing','work_instruction_revision','inspection_plan','disposition_conditional_release','recall_case','batch_reopen','work_order_release','leave_request','overtime_request','payroll_period','period_lock_unlock','setting_change_request','retention_action','supplier_return','equipment_override','payroll_period_reopen','price_list','change_control'));
CREATE TABLE "forecast_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"baseline_qty_base" numeric(18, 6),
	"baseline_method" text,
	"override_qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"baseline_snapshot" jsonb,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_forecast_overrides_status" CHECK ("forecast_overrides"."status" in ('submitted','approved','rejected','retired')),
	CONSTRAINT "ck_forecast_overrides_qty" CHECK ("forecast_overrides"."override_qty_base" >= 0),
	CONSTRAINT "ck_forecast_overrides_period" CHECK ("forecast_overrides"."period_end" > "forecast_overrides"."period_start")
);
--> statement-breakpoint
CREATE TABLE "material_reorder_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"min_stock_base" numeric(18, 6) NOT NULL,
	"safety_stock_base" numeric(18, 6) DEFAULT '0' NOT NULL,
	"preferred_supplier_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_material_reorder_policies_qty" CHECK ("material_reorder_policies"."min_stock_base" >= 0 and "material_reorder_policies"."safety_stock_base" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"material_id" uuid NOT NULL,
	"supplier_material_id" uuid,
	"purchase_request_line_id" uuid,
	"qty_entered" numeric(18, 6) NOT NULL,
	"uom_entered" text NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"unit_amount" numeric(18, 4) NOT NULL,
	"line_amount" numeric(18, 4) NOT NULL,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"expected_date" date,
	"qty_received_base" numeric(18, 6) DEFAULT '0' NOT NULL,
	"line_status" text DEFAULT 'open' NOT NULL,
	"short_closed_at" timestamp with time zone,
	"short_closed_by" uuid,
	"short_close_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_purchase_order_lines_qty" CHECK ("purchase_order_lines"."qty_entered" > 0 and "purchase_order_lines"."qty_base" > 0 and "purchase_order_lines"."qty_received_base" >= 0),
	CONSTRAINT "ck_purchase_order_lines_amount" CHECK ("purchase_order_lines"."unit_amount" >= 0 and "purchase_order_lines"."line_amount" >= 0),
	CONSTRAINT "ck_purchase_order_lines_status" CHECK ("purchase_order_lines"."line_status" in ('open','received','short_closed','cancelled')),
	CONSTRAINT "ck_purchase_order_lines_short" CHECK ("purchase_order_lines"."line_status" <> 'short_closed' or ("purchase_order_lines"."short_close_reason" is not null and "purchase_order_lines"."short_closed_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "purchase_order_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"po_number" text NOT NULL,
	"legacy_number" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"supplier_id" uuid NOT NULL,
	"ship_to_warehouse_id" uuid,
	"order_date" date NOT NULL,
	"expected_date" date,
	"promised_date" date,
	"payment_terms_days" integer,
	"subtotal_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"is_urgent" boolean DEFAULT false NOT NULL,
	"urgent_reason" text,
	"notes" text,
	"supplier_reference" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"sent_at" timestamp with time zone,
	"sent_by" uuid,
	"sent_to" text,
	"send_result" text,
	"generated_document_id" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"close_reason" text,
	"cancel_reason" text,
	"idempotency_key" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_purchase_orders_status" CHECK ("purchase_orders"."status" in ('draft','submitted','approved','sent','partially_received','received','closed','cancelled')),
	CONSTRAINT "ck_purchase_orders_amounts" CHECK ("purchase_orders"."subtotal_amount" >= 0 and "purchase_orders"."tax_amount" >= 0 and "purchase_orders"."total_amount" >= 0),
	CONSTRAINT "ck_purchase_orders_urgent" CHECK (not "purchase_orders"."is_urgent" or "purchase_orders"."urgent_reason" is not null),
	CONSTRAINT "ck_purchase_orders_sod" CHECK ("purchase_orders"."approved_by" is null or ("purchase_orders"."approved_by" <> "purchase_orders"."created_by" and ("purchase_orders"."submitted_by" is null or "purchase_orders"."approved_by" <> "purchase_orders"."submitted_by"))),
	CONSTRAINT "ck_purchase_orders_sent" CHECK ("purchase_orders"."status" not in ('sent','partially_received','received','closed') or ("purchase_orders"."sent_at" is not null and "purchase_orders"."sent_by" is not null)),
	CONSTRAINT "ck_purchase_orders_terms" CHECK ("purchase_orders"."payment_terms_days" is null or "purchase_orders"."payment_terms_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_request_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"purchase_request_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"material_id" uuid NOT NULL,
	"qty_entered" numeric(18, 6) NOT NULL,
	"uom_entered" text NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"estimated_unit_amount" numeric(18, 4),
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"suggested_supplier_id" uuid,
	"note" text,
	"converted_po_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_purchase_request_lines_qty" CHECK ("purchase_request_lines"."qty_entered" > 0 and "purchase_request_lines"."qty_base" > 0),
	CONSTRAINT "ck_purchase_request_lines_amount" CHECK ("purchase_request_lines"."estimated_unit_amount" is null or "purchase_request_lines"."estimated_unit_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_request_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"purchase_request_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"request_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"requested_by" uuid NOT NULL,
	"needed_by_date" date,
	"justification" text,
	"estimated_total_amount" numeric(18, 4),
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"reorder_suggestion_id" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"reject_reason" text,
	"cancel_reason" text,
	"idempotency_key" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_purchase_requests_status" CHECK ("purchase_requests"."status" in ('draft','submitted','approved','rejected','converted','cancelled')),
	CONSTRAINT "ck_purchase_requests_sod" CHECK ("purchase_requests"."approved_by" is null or ("purchase_requests"."approved_by" <> "purchase_requests"."requested_by" and ("purchase_requests"."submitted_by" is null or "purchase_requests"."approved_by" <> "purchase_requests"."submitted_by"))),
	CONSTRAINT "ck_purchase_requests_amount" CHECK ("purchase_requests"."estimated_total_amount" is null or "purchase_requests"."estimated_total_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reorder_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"suggested_qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"on_hand_base" numeric(18, 6),
	"reserved_base" numeric(18, 6),
	"open_po_qty_base" numeric(18, 6),
	"forecast_qty_base" numeric(18, 6),
	"min_stock_base" numeric(18, 6),
	"safety_stock_base" numeric(18, 6),
	"expiry_risk_qty_base" numeric(18, 6),
	"moq_base" numeric(18, 6),
	"lead_time_days" integer,
	"supplier_id" uuid,
	"need_by_date" date,
	"explanation" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"purchase_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_reorder_suggestions_qty" CHECK ("reorder_suggestions"."suggested_qty_base" > 0),
	CONSTRAINT "ck_reorder_suggestions_status" CHECK ("reorder_suggestions"."status" in ('open','accepted','dismissed','superseded')),
	CONSTRAINT "ck_reorder_suggestions_reviewed" CHECK ("reorder_suggestions"."status" not in ('accepted','dismissed') or ("reorder_suggestions"."reviewed_by" is not null and "reorder_suggestions"."review_note" is not null))
);
--> statement-breakpoint
CREATE TABLE "supplier_material_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"supplier_material_id" uuid NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"proposed_by" uuid NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text NOT NULL,
	"audit_date" date,
	"evidence_attachment_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	CONSTRAINT "ck_supplier_material_changes_action" CHECK ("supplier_material_changes"."action" in ('approve','suspend')),
	CONSTRAINT "ck_supplier_material_changes_status" CHECK ("supplier_material_changes"."status" in ('pending','approved','rejected','withdrawn')),
	CONSTRAINT "ck_supplier_material_changes_sod" CHECK ("supplier_material_changes"."decided_by" is null or "supplier_material_changes"."decided_by" <> "supplier_material_changes"."proposed_by"),
	CONSTRAINT "ck_supplier_material_changes_decided" CHECK ("supplier_material_changes"."status" in ('pending','withdrawn') or ("supplier_material_changes"."decided_by" is not null and "supplier_material_changes"."decided_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "supplier_return_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"supplier_return_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"lot_id" uuid NOT NULL,
	"container_id" uuid,
	"from_location_id" uuid NOT NULL,
	"qty_entered" numeric(18, 6) NOT NULL,
	"uom_entered" text NOT NULL,
	"qty_base" numeric(18, 6) NOT NULL,
	"base_uom" text NOT NULL,
	"credit_expected_amount" numeric(18, 4),
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"stock_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_supplier_return_lines_qty" CHECK ("supplier_return_lines"."qty_entered" > 0 and "supplier_return_lines"."qty_base" > 0),
	CONSTRAINT "ck_supplier_return_lines_amount" CHECK ("supplier_return_lines"."credit_expected_amount" is null or "supplier_return_lines"."credit_expected_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_return_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"supplier_return_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"return_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"supplier_id" uuid NOT NULL,
	"goods_receipt_id" uuid,
	"purchase_order_id" uuid,
	"reason_code" text NOT NULL,
	"reason_note" text,
	"supplier_rma_reference" text,
	"credit_expected_amount" numeric(18, 4),
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"posted_at" timestamp with time zone,
	"posted_by" uuid,
	"cancel_reason" text,
	"idempotency_key" text,
	"post_idempotency_key" text,
	"correlation_id" uuid,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_supplier_returns_status" CHECK ("supplier_returns"."status" in ('draft','submitted','approved','posted','cancelled')),
	CONSTRAINT "ck_supplier_returns_sod" CHECK ("supplier_returns"."approved_by" is null or ("supplier_returns"."approved_by" <> "supplier_returns"."created_by" and ("supplier_returns"."submitted_by" is null or "supplier_returns"."approved_by" <> "supplier_returns"."submitted_by"))),
	CONSTRAINT "ck_supplier_returns_poster" CHECK ("supplier_returns"."posted_by" is null or "supplier_returns"."approved_by" is null or "supplier_returns"."posted_by" <> "supplier_returns"."approved_by"),
	CONSTRAINT "ck_supplier_returns_posted" CHECK ("supplier_returns"."status" <> 'posted' or ("supplier_returns"."posted_at" is not null and "supplier_returns"."posted_by" is not null and "supplier_returns"."approved_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "accounting_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_code" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"locked_by" uuid,
	"locked_at" timestamp with time zone,
	"lock_reason" text,
	"lock_acknowledgements" jsonb,
	"unlocked_by" uuid,
	"unlocked_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_accounting_periods_status" CHECK ("accounting_periods"."status" in ('open','locked')),
	CONSTRAINT "ck_accounting_periods_code" CHECK ("accounting_periods"."period_code" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "ck_accounting_periods_dates" CHECK ("accounting_periods"."period_end" >= "accounting_periods"."period_start"),
	CONSTRAINT "ck_accounting_periods_locked" CHECK ("accounting_periods"."status" <> 'locked' or ("accounting_periods"."locked_by" is not null and "accounting_periods"."locked_at" is not null and "accounting_periods"."lock_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"credit_note_number" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"invoice_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_return_id" uuid,
	"reason_code" text NOT NULL,
	"reason" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"tax_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"voids_invoice" boolean DEFAULT false NOT NULL,
	"issue_date" date,
	"created_by" uuid NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"cancel_reason" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_credit_notes_status" CHECK ("credit_notes"."status" in ('draft','submitted','approved','issued','applied','voided','cancelled')),
	CONSTRAINT "ck_credit_notes_amount" CHECK ("credit_notes"."amount" > 0 and "credit_notes"."tax_amount" >= 0 and "credit_notes"."tax_amount" <= "credit_notes"."amount"),
	CONSTRAINT "ck_credit_notes_issued" CHECK ("credit_notes"."status" not in ('issued','applied','voided') or ("credit_notes"."credit_note_number" is not null and "credit_notes"."posted_by" is not null)),
	CONSTRAINT "ck_credit_notes_sod" CHECK ("credit_notes"."approved_by" is null or "credit_notes"."approved_by" <> "credit_notes"."submitted_by")
);
--> statement-breakpoint
CREATE TABLE "expense_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"claim_number" text NOT NULL,
	"claim_kind" text DEFAULT 'claim' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"claimant_user_id" uuid NOT NULL,
	"category_code" text NOT NULL,
	"description" text NOT NULL,
	"expense_date" date NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"receipt_attachment_id" uuid,
	"paid_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"cancel_reason" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_expense_claims_status" CHECK ("expense_claims"."status" in ('draft','submitted','approved','rejected','posted','paid','cancelled','voided')),
	CONSTRAINT "ck_expense_claims_kind" CHECK ("expense_claims"."claim_kind" in ('claim','request')),
	CONSTRAINT "ck_expense_claims_amount" CHECK ("expense_claims"."amount" > 0 and "expense_claims"."paid_amount" >= 0 and "expense_claims"."paid_amount" <= "expense_claims"."amount"),
	CONSTRAINT "ck_expense_claims_sod" CHECK ("expense_claims"."approved_by" is null or "expense_claims"."approved_by" <> "expense_claims"."claimant_user_id"),
	CONSTRAINT "ck_expense_claims_rejected" CHECK ("expense_claims"."status" <> 'rejected' or ("expense_claims"."rejected_by" is not null and "expense_claims"."rejection_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "finance_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"document_type" text NOT NULL,
	"document_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid NOT NULL,
	CONSTRAINT "ck_finance_state_transitions_type" CHECK ("finance_state_transitions"."document_type" in ('invoice','supplier_bill','payment_record','credit_note','expense_claim'))
);
--> statement-breakpoint
CREATE TABLE "financial_postings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"posting_type" text NOT NULL,
	"document_type" text NOT NULL,
	"document_id" uuid NOT NULL,
	"document_number" text NOT NULL,
	"accounting_period_id" uuid NOT NULL,
	"posting_date" date NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"tax_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"currency" char(3) NOT NULL,
	"direction" text NOT NULL,
	"customer_id" uuid,
	"supplier_id" uuid,
	"counterparty_user_id" uuid,
	"reversal_of_id" uuid,
	"reason" text,
	"idempotency_key" text,
	"correlation_id" uuid NOT NULL,
	"posted_by" uuid NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_financial_postings_type" CHECK ("financial_postings"."posting_type" in ('invoice_issue','bill_post','payment','credit_note','expense','reversal')),
	CONSTRAINT "ck_financial_postings_document_type" CHECK ("financial_postings"."document_type" in ('invoice','supplier_bill','payment_record','credit_note','expense_claim')),
	CONSTRAINT "ck_financial_postings_direction" CHECK ("financial_postings"."direction" in ('debit','credit')),
	CONSTRAINT "ck_financial_postings_amount" CHECK ("financial_postings"."amount" > 0 and "financial_postings"."tax_amount" >= 0),
	CONSTRAINT "ck_financial_postings_reversal" CHECK (("financial_postings"."posting_type" = 'reversal') = ("financial_postings"."reversal_of_id" is not null) and ("financial_postings"."posting_type" <> 'reversal' or "financial_postings"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"sales_order_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"description" text NOT NULL,
	"qty" numeric(18, 6) NOT NULL,
	"uom" text DEFAULT 'pcs' NOT NULL,
	"unit_amount" numeric(18, 4) NOT NULL,
	"tax_code" text,
	"tax_configuration_id" uuid,
	"tax_rate_pct" numeric(9, 4) DEFAULT '0' NOT NULL,
	"tax_inclusive" boolean DEFAULT false NOT NULL,
	"line_amount" numeric(18, 4) NOT NULL,
	"tax_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 4) NOT NULL,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	CONSTRAINT "ck_invoice_lines_qty" CHECK ("invoice_lines"."qty" > 0),
	CONSTRAINT "ck_invoice_lines_amounts" CHECK ("invoice_lines"."unit_amount" >= 0 and "invoice_lines"."line_amount" >= 0 and "invoice_lines"."tax_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"invoice_number" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"customer_id" uuid NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"bill_to_text" text,
	"customer_po_number" text,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"payment_terms_days" integer,
	"issue_date" date,
	"due_date" date,
	"subtotal_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"credited_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"tax_configuration_ref" text,
	"notes" text,
	"created_by" uuid NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"voided_by_credit_note_id" uuid,
	"cancel_reason" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_invoices_status" CHECK ("invoices"."status" in ('draft','submitted','approved','issued','partially_paid','paid','closed','voided','cancelled')),
	CONSTRAINT "ck_invoices_issued" CHECK ("invoices"."status" in ('draft','submitted','approved','cancelled') or ("invoices"."invoice_number" is not null and "invoices"."issue_date" is not null and "invoices"."due_date" is not null and "invoices"."posted_by" is not null)),
	CONSTRAINT "ck_invoices_amounts" CHECK ("invoices"."subtotal_amount" >= 0 and "invoices"."tax_amount" >= 0 and "invoices"."total_amount" >= 0 and "invoices"."paid_amount" >= 0 and "invoices"."credited_amount" >= 0),
	CONSTRAINT "ck_invoices_not_overpaid" CHECK ("invoices"."paid_amount" + "invoices"."credited_amount" <= "invoices"."total_amount"),
	CONSTRAINT "ck_invoices_sod" CHECK ("invoices"."approved_by" is null or "invoices"."approved_by" <> "invoices"."submitted_by"),
	CONSTRAINT "ck_invoices_voided" CHECK ("invoices"."status" <> 'voided' or ("invoices"."voided_by" is not null and "invoices"."void_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "payment_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"payment_record_id" uuid NOT NULL,
	"invoice_id" uuid,
	"supplier_bill_id" uuid,
	"expense_claim_id" uuid,
	"applied_amount" numeric(18, 4) NOT NULL,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"applied_on" date NOT NULL,
	"reversal_of_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_payment_applications_target" CHECK ((case when "payment_applications"."invoice_id" is not null then 1 else 0 end) + (case when "payment_applications"."supplier_bill_id" is not null then 1 else 0 end) + (case when "payment_applications"."expense_claim_id" is not null then 1 else 0 end) = 1),
	CONSTRAINT "ck_payment_applications_sign" CHECK (("payment_applications"."reversal_of_id" is null and "payment_applications"."applied_amount" > 0) or ("payment_applications"."reversal_of_id" is not null and "payment_applications"."applied_amount" < 0))
);
--> statement-breakpoint
CREATE TABLE "payment_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid,
	"payment_number" text NOT NULL,
	"direction" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"customer_id" uuid,
	"supplier_id" uuid,
	"claimant_user_id" uuid,
	"method" text NOT NULL,
	"reference" text,
	"bank_reference" text,
	"paid_on" date NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"withheld_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"applied_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"application_plan" jsonb,
	"notes" text,
	"created_by" uuid NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"cancel_reason" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_payment_records_status" CHECK ("payment_records"."status" in ('draft','submitted','approved','recorded','reconciled','voided','cancelled')),
	CONSTRAINT "ck_payment_records_direction" CHECK ("payment_records"."direction" in ('inbound','outbound')),
	CONSTRAINT "ck_payment_records_method" CHECK ("payment_records"."method" in ('cash','bank_transfer','cheque','gcash','provider','other')),
	CONSTRAINT "ck_payment_records_counterparty" CHECK ((case when "payment_records"."customer_id" is not null then 1 else 0 end) + (case when "payment_records"."supplier_id" is not null then 1 else 0 end) + (case when "payment_records"."claimant_user_id" is not null then 1 else 0 end) = 1),
	CONSTRAINT "ck_payment_records_direction_party" CHECK (("payment_records"."direction" = 'inbound') = ("payment_records"."customer_id" is not null)),
	CONSTRAINT "ck_payment_records_amounts" CHECK ("payment_records"."amount" > 0 and "payment_records"."withheld_amount" >= 0 and "payment_records"."applied_amount" >= 0 and "payment_records"."applied_amount" <= "payment_records"."amount" + "payment_records"."withheld_amount"),
	CONSTRAINT "ck_payment_records_posted" CHECK ("payment_records"."status" not in ('recorded','reconciled','voided') or "payment_records"."posted_by" is not null),
	CONSTRAINT "ck_payment_records_sod" CHECK ("payment_records"."approved_by" is null or "payment_records"."approved_by" <> "payment_records"."submitted_by")
);
--> statement-breakpoint
CREATE TABLE "period_unlock_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"accounting_period_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_period_unlock_requests_status" CHECK ("period_unlock_requests"."status" in ('pending','applied','rejected','cancelled')),
	CONSTRAINT "ck_period_unlock_requests_sod" CHECK ("period_unlock_requests"."decided_by" is null or "period_unlock_requests"."decided_by" <> "period_unlock_requests"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "supplier_bill_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"supplier_bill_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"charge_kind" text DEFAULT 'goods' NOT NULL,
	"material_id" uuid,
	"goods_receipt_line_id" uuid,
	"purchase_order_line_id" uuid,
	"description" text NOT NULL,
	"qty" numeric(18, 6) NOT NULL,
	"uom" text,
	"unit_amount" numeric(18, 4) NOT NULL,
	"tax_code" text,
	"tax_configuration_id" uuid,
	"tax_rate_pct" numeric(9, 4) DEFAULT '0' NOT NULL,
	"line_amount" numeric(18, 4) NOT NULL,
	"tax_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"match_result" text,
	"match_detail" jsonb,
	CONSTRAINT "ck_supplier_bill_lines_charge" CHECK ("supplier_bill_lines"."charge_kind" in ('goods','freight','duties','brokerage','other')),
	CONSTRAINT "ck_supplier_bill_lines_match" CHECK ("supplier_bill_lines"."match_result" is null or "supplier_bill_lines"."match_result" in ('matched','qty_variance','price_variance','no_po','no_receipt')),
	CONSTRAINT "ck_supplier_bill_lines_qty" CHECK ("supplier_bill_lines"."qty" > 0 and "supplier_bill_lines"."unit_amount" >= 0 and "supplier_bill_lines"."line_amount" >= 0 and "supplier_bill_lines"."tax_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_bills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"bill_number" text NOT NULL,
	"bill_kind" text DEFAULT 'bill' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_reference" text NOT NULL,
	"goods_receipt_id" uuid,
	"purchase_order_id" uuid,
	"category_code" text,
	"credit_for_bill_id" uuid,
	"replaces_document_id" uuid,
	"bill_date" date NOT NULL,
	"due_date" date,
	"payment_terms_days" integer,
	"currency" char(3) DEFAULT 'PHP' NOT NULL,
	"subtotal_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"match_summary" jsonb,
	"variance_approved_by" uuid,
	"variance_approved_at" timestamp with time zone,
	"variance_reason" text,
	"notes" text,
	"created_by" uuid NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"cancel_reason" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_supplier_bills_status" CHECK ("supplier_bills"."status" in ('draft','submitted','disputed','approved','posted','partially_paid','paid','closed','voided','cancelled')),
	CONSTRAINT "ck_supplier_bills_kind" CHECK ("supplier_bills"."bill_kind" in ('bill','credit','charge')),
	CONSTRAINT "ck_supplier_bills_amounts" CHECK ("supplier_bills"."subtotal_amount" >= 0 and "supplier_bills"."tax_amount" >= 0 and "supplier_bills"."total_amount" >= 0 and "supplier_bills"."paid_amount" >= 0 and "supplier_bills"."paid_amount" <= "supplier_bills"."total_amount"),
	CONSTRAINT "ck_supplier_bills_posted" CHECK ("supplier_bills"."status" not in ('posted','partially_paid','paid','closed','voided') or ("supplier_bills"."posted_by" is not null and "supplier_bills"."due_date" is not null)),
	CONSTRAINT "ck_supplier_bills_credit_ref" CHECK (("supplier_bills"."bill_kind" = 'credit') = ("supplier_bills"."credit_for_bill_id" is not null)),
	CONSTRAINT "ck_supplier_bills_sod" CHECK ("supplier_bills"."approved_by" is null or "supplier_bills"."approved_by" <> "supplier_bills"."submitted_by"),
	CONSTRAINT "ck_supplier_bills_variance_sod" CHECK ("supplier_bills"."variance_approved_by" is null or "supplier_bills"."variance_approved_by" <> "supplier_bills"."created_by")
);
--> statement-breakpoint
CREATE TABLE "tax_configurations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"version_no" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"rate_pct" numeric(9, 4) NOT NULL,
	"inclusive" boolean DEFAULT false NOT NULL,
	"applies_to" text DEFAULT 'sales' NOT NULL,
	"rounding" text DEFAULT 'line' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"status" text DEFAULT 'proposed' NOT NULL,
	"is_fictional" boolean DEFAULT false NOT NULL,
	"source_note" text,
	"proposed_by" uuid NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"retired_by" uuid,
	"retired_at" timestamp with time zone,
	"retire_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_tax_configurations_code" CHECK ("tax_configurations"."code" ~ '^[A-Z0-9_-]{1,20}$'),
	CONSTRAINT "ck_tax_configurations_kind" CHECK ("tax_configurations"."kind" in ('vat_output','vat_input','withholding_receivable','withholding_payable','exempt','zero_rated','other')),
	CONSTRAINT "ck_tax_configurations_applies" CHECK ("tax_configurations"."applies_to" in ('sales','purchases','expenses')),
	CONSTRAINT "ck_tax_configurations_rounding" CHECK ("tax_configurations"."rounding" in ('line','document')),
	CONSTRAINT "ck_tax_configurations_status" CHECK ("tax_configurations"."status" in ('proposed','approved','rejected','retired')),
	CONSTRAINT "ck_tax_configurations_rate" CHECK ("tax_configurations"."rate_pct" >= 0 and "tax_configurations"."rate_pct" <= 100),
	CONSTRAINT "ck_tax_configurations_dates" CHECK ("tax_configurations"."effective_to" is null or "tax_configurations"."effective_to" > "tax_configurations"."effective_from"),
	CONSTRAINT "ck_tax_configurations_reviewed" CHECK ("tax_configurations"."status" not in ('approved','retired') or ("tax_configurations"."reviewed_by" is not null and "tax_configurations"."reviewed_at" is not null)),
	CONSTRAINT "ck_tax_configurations_sod" CHECK ("tax_configurations"."reviewed_by" is null or "tax_configurations"."reviewed_by" <> "tax_configurations"."proposed_by")
);
--> statement-breakpoint
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
CREATE TABLE "customer_portal_tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"site_id" uuid NOT NULL,
	"catalog_mode" text DEFAULT 'all_priced' NOT NULL,
	"status_reason" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_portal_tenants_status_ck" CHECK ("customer_portal_tenants"."status" in ('active','suspended')),
	CONSTRAINT "customer_portal_tenants_catalog_ck" CHECK ("customer_portal_tenants"."catalog_mode" in ('all_priced','customer_price_list','curated')),
	CONSTRAINT "customer_portal_tenants_reason_ck" CHECK ("customer_portal_tenants"."status" <> 'suspended' or "customer_portal_tenants"."status_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "portal_catalog_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"portal_user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"portal_user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"stage" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"mfa_verified_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "portal_sessions_stage_ck" CHECK ("portal_sessions"."stage" in ('mfa_pending','active'))
);
--> statement-breakpoint
CREATE TABLE "portal_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text DEFAULT '!' NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"portal_role" text DEFAULT 'portal_buyer' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"totp_secret_enc" text,
	"totp_key_id" text,
	"totp_confirmed_at" timestamp with time zone,
	"totp_last_step" integer,
	"status_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_users_status_ck" CHECK ("portal_users"."status" in ('invited','active','locked','suspended')),
	CONSTRAINT "portal_users_role_ck" CHECK ("portal_users"."portal_role" in ('portal_buyer','portal_viewer'))
);
--> statement-breakpoint
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
CREATE TABLE "legal_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"hold_kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_label" text,
	"reason" text NOT NULL,
	"placed_by" uuid NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"release_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_legal_holds_kind" CHECK ("legal_holds"."hold_kind" in ('litigation','complaint','recall','audit','regulatory','other')),
	CONSTRAINT "ck_legal_holds_entity_type" CHECK ("legal_holds"."entity_type" in ('inventory_lot','batch','customer','complaint','sales_order','user')),
	CONSTRAINT "ck_legal_holds_release_sod" CHECK ("legal_holds"."released_by" is null or "legal_holds"."released_by" <> "legal_holds"."placed_by"),
	CONSTRAINT "ck_legal_holds_release_complete" CHECK (("legal_holds"."released_at" is null) = ("legal_holds"."released_by" is null) and ("legal_holds"."released_at" is null or "legal_holds"."release_note" is not null))
);
--> statement-breakpoint
CREATE TABLE "purge_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"trigger" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"requested_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"candidate_rows" integer DEFAULT 0 NOT NULL,
	"held_rows" integer DEFAULT 0 NOT NULL,
	"deleted_rows" integer DEFAULT 0 NOT NULL,
	"report" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_message" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_purge_runs_mode" CHECK ("purge_runs"."mode" in ('dry_run','execute')),
	CONSTRAINT "ck_purge_runs_trigger" CHECK ("purge_runs"."trigger" in ('manual','scheduled')),
	CONSTRAINT "ck_purge_runs_status" CHECK ("purge_runs"."status" in ('running','succeeded','failed')),
	CONSTRAINT "ck_purge_runs_dry_run_deletes_nothing" CHECK ("purge_runs"."mode" = 'execute' or "purge_runs"."deleted_rows" = 0)
);
--> statement-breakpoint
CREATE TABLE "restore_drills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"backup_run_id" uuid,
	"performed_at" timestamp with time zone NOT NULL,
	"performed_by" uuid NOT NULL,
	"witness_user_id" uuid,
	"target_environment" text NOT NULL,
	"source_key" text,
	"duration_seconds" integer NOT NULL,
	"measured_rto_seconds" integer NOT NULL,
	"dump_age_seconds" integer,
	"checksum_verified" boolean NOT NULL,
	"decrypt_succeeded" boolean NOT NULL,
	"row_counts_match" boolean,
	"migrations_current" boolean,
	"reconciliation_rows" integer,
	"result" text NOT NULL,
	"details" jsonb,
	"notes" text,
	"report_attachment_id" uuid,
	"signed_off_by" uuid,
	"signed_off_at" timestamp with time zone,
	"sign_off_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_restore_drills_result" CHECK ("restore_drills"."result" in ('passed','failed')),
	CONSTRAINT "ck_restore_drills_signoff_sod" CHECK ("restore_drills"."signed_off_by" is null or "restore_drills"."signed_off_by" <> "restore_drills"."performed_by"),
	CONSTRAINT "ck_restore_drills_signoff_complete" CHECK (("restore_drills"."signed_off_by" is null) = ("restore_drills"."signed_off_at" is null)),
	CONSTRAINT "ck_restore_drills_durations" CHECK ("restore_drills"."duration_seconds" >= 0 and "restore_drills"."measured_rto_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "retention_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"data_class" text NOT NULL,
	"target" text DEFAULT '*' NOT NULL,
	"retention_months" integer,
	"retention_days" integer,
	"basis" text NOT NULL,
	"minimum_months" integer,
	"action" text NOT NULL,
	"is_confirmed" boolean DEFAULT false NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"confirmation_note" text,
	"effective_from" date NOT NULL,
	"assumption_id" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_retention_policies_class" CHECK ("retention_policies"."data_class" in ('quality_batch','stock_ledger','financial','sales_customer','procurement','employee_personal','attendance','payroll','audit','identity','security','idempotency','sync','jobs_notifications','documents_generated','labels_generated','exports','attachments_other','backups','portal','master_data','master_data_shadow','platform_ops')),
	CONSTRAINT "ck_retention_policies_basis" CHECK ("retention_policies"."basis" in ('record_date','expiry_date','last_activity','employment_end','period_end','parent_record')),
	CONSTRAINT "ck_retention_policies_action" CHECK ("retention_policies"."action" in ('archive','anonymise','delete','keep')),
	CONSTRAINT "ck_retention_policies_period" CHECK (("retention_policies"."action" = 'keep') or (("retention_policies"."retention_months" is null) <> ("retention_policies"."retention_days" is null))),
	CONSTRAINT "ck_retention_policies_months_positive" CHECK ("retention_policies"."retention_months" is null or "retention_policies"."retention_months" > 0),
	CONSTRAINT "ck_retention_policies_days_positive" CHECK ("retention_policies"."retention_days" is null or "retention_policies"."retention_days" > 0),
	CONSTRAINT "ck_retention_policies_confirmed" CHECK ((not "retention_policies"."is_confirmed") or ("retention_policies"."confirmed_by" is not null and "retention_policies"."confirmed_at" is not null)),
	CONSTRAINT "ck_retention_policies_confirm_sod" CHECK ("retention_policies"."confirmed_by" is null or "retention_policies"."updated_by" is null or "retention_policies"."confirmed_by" <> "retention_policies"."updated_by")
);
--> statement-breakpoint
ALTER TABLE "approval_rules" DROP CONSTRAINT "ck_approval_rules_document_type";--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "source" text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "portal_user_id" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "purchase_order_line_id" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "purchase_order_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "requested_by" uuid;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "audit_date" date;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "evidence_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "moq_qty" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "moq_uom" text;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "unit_price" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "price_uom" text;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "currency" char(3);--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "price_effective_from" date;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_reorder_policies" ADD CONSTRAINT "material_reorder_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_reorder_policies" ADD CONSTRAINT "material_reorder_policies_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_reorder_policies" ADD CONSTRAINT "material_reorder_policies_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_reorder_policies" ADD CONSTRAINT "material_reorder_policies_preferred_supplier_id_suppliers_id_fk" FOREIGN KEY ("preferred_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_reorder_policies" ADD CONSTRAINT "material_reorder_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_supplier_material_id_supplier_materials_id_fk" FOREIGN KEY ("supplier_material_id") REFERENCES "public"."supplier_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_request_line_id_purchase_request_lines_id_fk" FOREIGN KEY ("purchase_request_line_id") REFERENCES "public"."purchase_request_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_short_closed_by_users_id_fk" FOREIGN KEY ("short_closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_state_transitions" ADD CONSTRAINT "purchase_order_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_state_transitions" ADD CONSTRAINT "purchase_order_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_state_transitions" ADD CONSTRAINT "purchase_order_state_transitions_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_state_transitions" ADD CONSTRAINT "purchase_order_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_ship_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("ship_to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_purchase_request_id_purchase_requests_id_fk" FOREIGN KEY ("purchase_request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_suggested_supplier_id_suppliers_id_fk" FOREIGN KEY ("suggested_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_state_transitions" ADD CONSTRAINT "purchase_request_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_state_transitions" ADD CONSTRAINT "purchase_request_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_state_transitions" ADD CONSTRAINT "purchase_request_state_transitions_purchase_request_id_purchase_requests_id_fk" FOREIGN KEY ("purchase_request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_state_transitions" ADD CONSTRAINT "purchase_request_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "reorder_suggestions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "reorder_suggestions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "reorder_suggestions_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "reorder_suggestions_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "reorder_suggestions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "reorder_suggestions_purchase_request_id_purchase_requests_id_fk" FOREIGN KEY ("purchase_request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_material_changes" ADD CONSTRAINT "supplier_material_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_material_changes" ADD CONSTRAINT "supplier_material_changes_supplier_material_id_supplier_materials_id_fk" FOREIGN KEY ("supplier_material_id") REFERENCES "public"."supplier_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_material_changes" ADD CONSTRAINT "supplier_material_changes_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_material_changes" ADD CONSTRAINT "supplier_material_changes_evidence_attachment_id_file_attachments_id_fk" FOREIGN KEY ("evidence_attachment_id") REFERENCES "public"."file_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_material_changes" ADD CONSTRAINT "supplier_material_changes_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_supplier_return_id_supplier_returns_id_fk" FOREIGN KEY ("supplier_return_id") REFERENCES "public"."supplier_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_stock_movement_id_stock_movements_id_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_state_transitions" ADD CONSTRAINT "supplier_return_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_state_transitions" ADD CONSTRAINT "supplier_return_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_state_transitions" ADD CONSTRAINT "supplier_return_state_transitions_supplier_return_id_supplier_returns_id_fk" FOREIGN KEY ("supplier_return_id") REFERENCES "public"."supplier_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_state_transitions" ADD CONSTRAINT "supplier_return_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_goods_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_unlocked_by_users_id_fk" FOREIGN KEY ("unlocked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_customer_return_id_customer_returns_id_fk" FOREIGN KEY ("customer_return_id") REFERENCES "public"."customer_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_claimant_user_id_users_id_fk" FOREIGN KEY ("claimant_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_receipt_attachment_id_file_attachments_id_fk" FOREIGN KEY ("receipt_attachment_id") REFERENCES "public"."file_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_state_transitions" ADD CONSTRAINT "finance_state_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_state_transitions" ADD CONSTRAINT "finance_state_transitions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_state_transitions" ADD CONSTRAINT "finance_state_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD CONSTRAINT "financial_postings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD CONSTRAINT "financial_postings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD CONSTRAINT "financial_postings_accounting_period_id_accounting_periods_id_fk" FOREIGN KEY ("accounting_period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD CONSTRAINT "financial_postings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD CONSTRAINT "financial_postings_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD CONSTRAINT "financial_postings_counterparty_user_id_users_id_fk" FOREIGN KEY ("counterparty_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_postings" ADD CONSTRAINT "financial_postings_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tax_configuration_id_tax_configurations_id_fk" FOREIGN KEY ("tax_configuration_id") REFERENCES "public"."tax_configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_applications" ADD CONSTRAINT "payment_applications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_applications" ADD CONSTRAINT "payment_applications_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_applications" ADD CONSTRAINT "payment_applications_payment_record_id_payment_records_id_fk" FOREIGN KEY ("payment_record_id") REFERENCES "public"."payment_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_applications" ADD CONSTRAINT "payment_applications_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_applications" ADD CONSTRAINT "payment_applications_supplier_bill_id_supplier_bills_id_fk" FOREIGN KEY ("supplier_bill_id") REFERENCES "public"."supplier_bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_applications" ADD CONSTRAINT "payment_applications_expense_claim_id_expense_claims_id_fk" FOREIGN KEY ("expense_claim_id") REFERENCES "public"."expense_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_applications" ADD CONSTRAINT "payment_applications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_claimant_user_id_users_id_fk" FOREIGN KEY ("claimant_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_unlock_requests" ADD CONSTRAINT "period_unlock_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_unlock_requests" ADD CONSTRAINT "period_unlock_requests_accounting_period_id_accounting_periods_id_fk" FOREIGN KEY ("accounting_period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_unlock_requests" ADD CONSTRAINT "period_unlock_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_unlock_requests" ADD CONSTRAINT "period_unlock_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_supplier_bill_id_supplier_bills_id_fk" FOREIGN KEY ("supplier_bill_id") REFERENCES "public"."supplier_bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_goods_receipt_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_tax_configuration_id_tax_configurations_id_fk" FOREIGN KEY ("tax_configuration_id") REFERENCES "public"."tax_configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_goods_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_variance_approved_by_users_id_fk" FOREIGN KEY ("variance_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_configurations" ADD CONSTRAINT "tax_configurations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_configurations" ADD CONSTRAINT "tax_configurations_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_configurations" ADD CONSTRAINT "tax_configurations_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_configurations" ADD CONSTRAINT "tax_configurations_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_configurations" ADD CONSTRAINT "tax_configurations_retired_by_users_id_fk" FOREIGN KEY ("retired_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "customer_portal_tenants" ADD CONSTRAINT "customer_portal_tenants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portal_tenants" ADD CONSTRAINT "customer_portal_tenants_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portal_tenants" ADD CONSTRAINT "customer_portal_tenants_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portal_tenants" ADD CONSTRAINT "customer_portal_tenants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_portal_tenants" ADD CONSTRAINT "customer_portal_tenants_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_catalog_items" ADD CONSTRAINT "portal_catalog_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_catalog_items" ADD CONSTRAINT "portal_catalog_items_tenant_id_customer_portal_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."customer_portal_tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_catalog_items" ADD CONSTRAINT "portal_catalog_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_catalog_items" ADD CONSTRAINT "portal_catalog_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_tenant_id_customer_portal_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."customer_portal_tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_portal_user_id_portal_users_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "public"."portal_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_portal_user_id_portal_users_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "public"."portal_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_tenant_id_customer_portal_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."customer_portal_tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_tenant_id_customer_portal_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."customer_portal_tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_placed_by_users_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purge_runs" ADD CONSTRAINT "purge_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purge_runs" ADD CONSTRAINT "purge_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_drills" ADD CONSTRAINT "restore_drills_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_drills" ADD CONSTRAINT "restore_drills_backup_run_id_backup_runs_id_fk" FOREIGN KEY ("backup_run_id") REFERENCES "public"."backup_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_drills" ADD CONSTRAINT "restore_drills_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_drills" ADD CONSTRAINT "restore_drills_witness_user_id_users_id_fk" FOREIGN KEY ("witness_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_drills" ADD CONSTRAINT "restore_drills_signed_off_by_users_id_fk" FOREIGN KEY ("signed_off_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_forecast_overrides_product" ON "forecast_overrides" USING btree ("site_id","product_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_forecast_overrides_approved" ON "forecast_overrides" USING btree ("site_id","product_id","period_start") WHERE "forecast_overrides"."status" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_material_reorder_policies" ON "material_reorder_policies" USING btree ("site_id","material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_order_lines_no" ON "purchase_order_lines" USING btree ("purchase_order_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_purchase_order_lines_material" ON "purchase_order_lines" USING btree ("material_id","line_status");--> statement-breakpoint
CREATE INDEX "ix_purchase_order_transitions_po" ON "purchase_order_state_transitions" USING btree ("purchase_order_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_orders_number" ON "purchase_orders" USING btree ("organization_id","po_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_orders_legacy" ON "purchase_orders" USING btree ("organization_id","legacy_number") WHERE "purchase_orders"."legacy_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_orders_idem" ON "purchase_orders" USING btree ("organization_id","idempotency_key") WHERE "purchase_orders"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "ix_purchase_orders_site_status" ON "purchase_orders" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_purchase_orders_supplier" ON "purchase_orders" USING btree ("supplier_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_request_lines_no" ON "purchase_request_lines" USING btree ("purchase_request_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_purchase_request_lines_material" ON "purchase_request_lines" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "ix_purchase_request_transitions_pr" ON "purchase_request_state_transitions" USING btree ("purchase_request_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_requests_number" ON "purchase_requests" USING btree ("organization_id","request_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchase_requests_idem" ON "purchase_requests" USING btree ("organization_id","idempotency_key") WHERE "purchase_requests"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "ix_purchase_requests_site_status" ON "purchase_requests" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_reorder_suggestions_site_status" ON "reorder_suggestions" USING btree ("site_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reorder_suggestions_open" ON "reorder_suggestions" USING btree ("site_id","material_id") WHERE "reorder_suggestions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "ix_supplier_material_changes_pair" ON "supplier_material_changes" USING btree ("supplier_material_id","proposed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_material_changes_pending" ON "supplier_material_changes" USING btree ("supplier_material_id") WHERE "supplier_material_changes"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_return_lines_no" ON "supplier_return_lines" USING btree ("supplier_return_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_supplier_return_lines_lot" ON "supplier_return_lines" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "ix_supplier_return_transitions_sr" ON "supplier_return_state_transitions" USING btree ("supplier_return_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_returns_number" ON "supplier_returns" USING btree ("organization_id","return_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_returns_idem" ON "supplier_returns" USING btree ("organization_id","idempotency_key") WHERE "supplier_returns"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_returns_post_idem" ON "supplier_returns" USING btree ("organization_id","post_idempotency_key") WHERE "supplier_returns"."post_idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "ix_supplier_returns_site_status" ON "supplier_returns" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_supplier_returns_supplier" ON "supplier_returns" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_accounting_periods_org_code" ON "accounting_periods" USING btree ("organization_id","period_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_credit_notes_org_number" ON "credit_notes" USING btree ("organization_id","credit_note_number") WHERE "credit_notes"."credit_note_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_credit_notes_org_idem" ON "credit_notes" USING btree ("organization_id","idempotency_key") WHERE "credit_notes"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "ix_credit_notes_invoice" ON "credit_notes" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "ix_credit_notes_site_status" ON "credit_notes" USING btree ("site_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_expense_claims_org_number" ON "expense_claims" USING btree ("organization_id","claim_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_expense_claims_org_idem" ON "expense_claims" USING btree ("organization_id","idempotency_key") WHERE "expense_claims"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "ix_expense_claims_site_status" ON "expense_claims" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_expense_claims_claimant" ON "expense_claims" USING btree ("claimant_user_id","status");--> statement-breakpoint
CREATE INDEX "ix_finance_state_transitions_document" ON "finance_state_transitions" USING btree ("document_type","document_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_financial_postings_reversal" ON "financial_postings" USING btree ("reversal_of_id") WHERE "financial_postings"."reversal_of_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_financial_postings_idem" ON "financial_postings" USING btree ("organization_id","idempotency_key") WHERE "financial_postings"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "ix_financial_postings_document" ON "financial_postings" USING btree ("document_type","document_id");--> statement-breakpoint
CREATE INDEX "ix_financial_postings_period" ON "financial_postings" USING btree ("accounting_period_id","posting_type");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invoice_lines_no" ON "invoice_lines" USING btree ("invoice_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invoices_org_number" ON "invoices" USING btree ("organization_id","invoice_number") WHERE "invoices"."invoice_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invoices_org_idem" ON "invoices" USING btree ("organization_id","idempotency_key") WHERE "invoices"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invoices_shipment_live" ON "invoices" USING btree ("shipment_id") WHERE "invoices"."status" not in ('cancelled','voided');--> statement-breakpoint
CREATE INDEX "ix_invoices_site_status" ON "invoices" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "ix_invoices_customer" ON "invoices" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "ix_payment_applications_payment" ON "payment_applications" USING btree ("payment_record_id");--> statement-breakpoint
CREATE INDEX "ix_payment_applications_invoice" ON "payment_applications" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "ix_payment_applications_bill" ON "payment_applications" USING btree ("supplier_bill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_applications_reversal" ON "payment_applications" USING btree ("reversal_of_id") WHERE "payment_applications"."reversal_of_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_records_org_number" ON "payment_records" USING btree ("organization_id","payment_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_records_org_idem" ON "payment_records" USING btree ("organization_id","idempotency_key") WHERE "payment_records"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "ix_payment_records_site_status" ON "payment_records" USING btree ("site_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_period_unlock_requests_pending" ON "period_unlock_requests" USING btree ("accounting_period_id") WHERE "period_unlock_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_bill_lines_no" ON "supplier_bill_lines" USING btree ("supplier_bill_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_supplier_bill_lines_gr_line" ON "supplier_bill_lines" USING btree ("goods_receipt_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_bills_org_number" ON "supplier_bills" USING btree ("organization_id","bill_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_bills_org_idem" ON "supplier_bills" USING btree ("organization_id","idempotency_key") WHERE "supplier_bills"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_bills_supplier_ref" ON "supplier_bills" USING btree ("supplier_id",lower("supplier_reference")) WHERE "supplier_bills"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "ix_supplier_bills_site_status" ON "supplier_bills" USING btree ("site_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tax_configurations_code_version" ON "tax_configurations" USING btree ("organization_id","code","version_no");--> statement-breakpoint
CREATE INDEX "ix_tax_configurations_lookup" ON "tax_configurations" USING btree ("organization_id","code","status","effective_from");--> statement-breakpoint
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
CREATE UNIQUE INDEX "customer_portal_tenants_customer_uq" ON "customer_portal_tenants" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_catalog_items_uq" ON "portal_catalog_items" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_invitations_token_uq" ON "portal_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "portal_invitations_user_idx" ON "portal_invitations" USING btree ("portal_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_sessions_token_uq" ON "portal_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "portal_sessions_user_idx" ON "portal_sessions" USING btree ("portal_user_id");--> statement-breakpoint
CREATE INDEX "portal_sessions_expires_idx" ON "portal_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_users_org_email_uq" ON "portal_users" USING btree ("organization_id",lower("email"));--> statement-breakpoint
CREATE INDEX "portal_users_tenant_idx" ON "portal_users" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_registrations_org_key_uq" ON "device_registrations" USING btree ("organization_id","device_key_hash");--> statement-breakpoint
CREATE INDEX "device_registrations_site_status_idx" ON "device_registrations" USING btree ("site_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_commands_org_key_uq" ON "sync_commands" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_commands_device_sequence_uq" ON "sync_commands" USING btree ("device_registration_id","client_sequence") WHERE "sync_commands"."device_registration_id" is not null and "sync_commands"."client_sequence" is not null;--> statement-breakpoint
CREATE INDEX "sync_commands_site_status_idx" ON "sync_commands" USING btree ("site_id","status","received_at");--> statement-breakpoint
CREATE INDEX "sync_commands_user_idx" ON "sync_commands" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE INDEX "sync_commands_device_idx" ON "sync_commands" USING btree ("device_registration_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_conflicts_command_uq" ON "sync_conflicts" USING btree ("sync_command_id");--> statement-breakpoint
CREATE INDEX "sync_conflicts_site_status_idx" ON "sync_conflicts" USING btree ("site_id","status","created_at");--> statement-breakpoint
CREATE INDEX "sync_conflicts_user_status_idx" ON "sync_conflicts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "legal_holds_entity_active_idx" ON "legal_holds" USING btree ("entity_type","entity_id") WHERE "legal_holds"."released_at" is null;--> statement-breakpoint
CREATE INDEX "legal_holds_org_idx" ON "legal_holds" USING btree ("organization_id","placed_at");--> statement-breakpoint
CREATE INDEX "purge_runs_org_time_idx" ON "purge_runs" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "purge_runs_idem_uq" ON "purge_runs" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "restore_drills_org_time_idx" ON "restore_drills" USING btree ("organization_id","performed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_policies_class_target_uq" ON "retention_policies" USING btree ("organization_id","data_class","target");--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_portal_user_id_portal_users_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "public"."portal_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_evidence_attachment_id_file_attachments_id_fk" FOREIGN KEY ("evidence_attachment_id") REFERENCES "public"."file_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movements_source_doc_idx" ON "stock_movements" USING btree ("source_document_type","source_document_id");--> statement-breakpoint
CREATE INDEX "sales_order_lines_order_idx" ON "sales_order_lines" USING btree ("sales_order_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_goods_receipt_lines_po_line" ON "goods_receipt_lines" USING btree ("purchase_order_line_id");--> statement-breakpoint
CREATE INDEX "ix_goods_receipts_po" ON "goods_receipts" USING btree ("purchase_order_id");--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "so_source_ck" CHECK ("sales_orders"."source" in ('internal','portal') and ("sales_orders"."source" = 'portal') = ("sales_orders"."portal_user_id" is not null));--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "ck_goods_receipts_po_kind" CHECK (("goods_receipts"."receipt_kind" = 'purchase_order') = ("goods_receipts"."purchase_order_id" is not null));--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "ck_supplier_materials_requested" CHECK (("supplier_materials"."requested_by" is null) = ("supplier_materials"."requested_at" is null));--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "ck_supplier_materials_sod" CHECK ("supplier_materials"."approved_by" is null or "supplier_materials"."requested_by" is null or "supplier_materials"."approved_by" <> "supplier_materials"."requested_by");--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "ck_supplier_materials_moq" CHECK ("supplier_materials"."moq_qty" is null or ("supplier_materials"."moq_qty" > 0 and "supplier_materials"."moq_uom" is not null));--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "ck_supplier_materials_price" CHECK ("supplier_materials"."unit_price" is null or ("supplier_materials"."unit_price" >= 0 and "supplier_materials"."price_uom" is not null and "supplier_materials"."currency" is not null));--> statement-breakpoint
ALTER TABLE "supplier_materials" ADD CONSTRAINT "ck_supplier_materials_lead_time" CHECK ("supplier_materials"."lead_time_days" is null or "supplier_materials"."lead_time_days" >= 0);--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "ck_approval_rules_document_type" CHECK ("approval_rules"."document_type" in ('purchase_request','purchase_order','sales_order','quote','stock_adjustment','stock_count_variance','expense_claim','invoice','supplier_bill','credit_note','payment_record','dispense_exception','over_shipment','formula_revision','routing_revision','routing_revision_sequencing','work_instruction_revision','inspection_plan','disposition_conditional_release','recall_case','batch_reopen','work_order_release','leave_request','overtime_request','payroll_period','period_lock_unlock','setting_change_request','retention_action','supplier_return','equipment_override','payroll_period_reopen','price_list','change_control'));
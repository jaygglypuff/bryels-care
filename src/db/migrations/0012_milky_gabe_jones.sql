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
CREATE INDEX "ix_tax_configurations_lookup" ON "tax_configurations" USING btree ("organization_id","code","status","effective_from");
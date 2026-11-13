CREATE TABLE "delivery_problem_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"goods_receipt_line_id" uuid NOT NULL,
	"purchase_order_line_id" uuid,
	"decision" text NOT NULL,
	"note" text NOT NULL,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text,
	CONSTRAINT "ck_delivery_problem_decisions_decision" CHECK ("delivery_problem_decisions"."decision" in ('send_more','money_back','close_rest'))
);
--> statement-breakpoint
DROP INDEX "uq_supplier_bills_supplier_ref";--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "given_to_customer_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "given_via" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "given_by" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "given_to_customer_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "given_via" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "given_by" uuid;--> statement-breakpoint
ALTER TABLE "delivery_problem_decisions" ADD CONSTRAINT "delivery_problem_decisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_problem_decisions" ADD CONSTRAINT "delivery_problem_decisions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_problem_decisions" ADD CONSTRAINT "delivery_problem_decisions_goods_receipt_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_problem_decisions" ADD CONSTRAINT "delivery_problem_decisions_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_problem_decisions" ADD CONSTRAINT "delivery_problem_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_delivery_problem_decisions_line" ON "delivery_problem_decisions" USING btree ("goods_receipt_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_delivery_problem_decisions_idem" ON "delivery_problem_decisions" USING btree ("organization_id","idempotency_key") WHERE "delivery_problem_decisions"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_given_by_users_id_fk" FOREIGN KEY ("given_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_given_by_users_id_fk" FOREIGN KEY ("given_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_supplier_bills_supplier_ref" ON "supplier_bills" USING btree ("supplier_id",lower("supplier_reference")) WHERE "supplier_bills"."status" not in ('cancelled', 'voided');--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_given_ck" CHECK (("quotes"."given_to_customer_at" is null) = ("quotes"."given_via" is null) and ("quotes"."given_via" is null or "quotes"."given_via" in ('email','print')));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "ck_invoices_given" CHECK (("invoices"."given_to_customer_at" is null) = ("invoices"."given_via" is null) and ("invoices"."given_via" is null or "invoices"."given_via" in ('email','print')));--> statement-breakpoint
-- ADR-131 (round 5 office fixes, bug B1 "Send to the supplier says Something went wrong although it was sent"): the
-- deferred same-person triggers of ADR-073 (src/db/sql/adr073.sql, extended by adr088.sql and adr117.sql) re-checked
-- every later UPDATE of a row, even when the checked columns did not change. A purchase order the owner made and
-- approved alone (ADR-073 override or ADR-088 own request, both accepted in that transaction) could then not be
-- changed by anyone afterwards: the send result written after the email, the supplier's answer, and receiving all
-- failed. Shipped inside the migration src/db/migrations/0041_adr131_custom_sql.sql (after its generated part; the
-- drift test checks the migration ends with this text). Idempotent. No trigger is dropped.
--
-- The rule is unchanged except: an UPDATE that changes none of the checked columns is accepted, because the pair was
-- already checked (and accepted, with its flag and audit) when it was written. Every INSERT, and every UPDATE that
-- writes any checked column, is checked exactly as before.
CREATE OR REPLACE FUNCTION bc_sod_distinct() RETURNS trigger AS $$
DECLARE
  r jsonb := to_jsonb(NEW);
  o jsonb;
  i int := 0;
  changed boolean := false;
BEGIN
  IF current_setting('bc.owner_override', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF current_setting('bc.self_approval', true) = 'on' AND TG_TABLE_NAME IN (
    'purchase_requests', 'purchase_orders', 'supplier_returns', 'stock_adjustments', 'price_lists',
    'customer_requirements', 'expense_claims', 'invoices', 'supplier_bills', 'payment_records', 'credit_notes',
    'formula_revisions', 'routing_revisions', 'work_instruction_revisions', 'inspection_plans'
  ) THEN
    RETURN NULL;
  END IF;
  IF current_setting('bc.owner_alone', true) = 'on' AND TG_TABLE_NAME IN (
    'formula_revisions', 'routing_revisions', 'work_instruction_revisions'
  ) THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    o := to_jsonb(OLD);
    WHILE i < TG_NARGS LOOP
      IF (r ->> TG_ARGV[i]) IS DISTINCT FROM (o ->> TG_ARGV[i]) THEN
        changed := true;
      END IF;
      i := i + 1;
    END LOOP;
    IF NOT changed THEN
      RETURN NULL;
    END IF;
    i := 0;
  END IF;
  WHILE i < TG_NARGS LOOP
    IF r ->> TG_ARGV[i] IS NOT NULL AND r ->> TG_ARGV[i] = r ->> TG_ARGV[i + 1] THEN
      RAISE EXCEPTION 'new row for relation "%" violates check constraint "%" (% must differ from %)', TG_TABLE_NAME, TG_NAME, TG_ARGV[i], TG_ARGV[i + 1]
        USING ERRCODE = 'check_violation', CONSTRAINT = TG_NAME, TABLE = TG_TABLE_NAME;
    END IF;
    i := i + 2;
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

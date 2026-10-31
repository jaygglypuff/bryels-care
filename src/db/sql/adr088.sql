-- ADR-088 §2 (top roles approve their own operational records): a guarded exception path in the deferred
-- same-person triggers of ADR-073 (src/db/sql/adr073.sql). Shipped as the Drizzle custom migration
-- src/db/migrations/<nnnn>_adr088_custom_sql.sql (verbatim copy, drift-tested). Idempotent.
--
-- The rule is unchanged except that a transaction carrying `bc.self_approval = on` may write the same person
-- in both columns of the OPERATIONAL tables listed below. src/lib/audit.ts sets the flag (transaction-local)
-- only when an Owner/Director or a Site Manager at the record's site approved their own record under the
-- setting approvals.top_roles_self_approve, writing `governance.self_approval.used` in the same transaction.
-- Quality release, holds, inspections, dispensing checks, process step checks, outputs, yields, packs and
-- every other table never read this flag: they still need a different person (or the ADR-073 owner override).
CREATE OR REPLACE FUNCTION bc_sod_distinct() RETURNS trigger AS $$
DECLARE
  r jsonb := to_jsonb(NEW);
  i int := 0;
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
  WHILE i < TG_NARGS LOOP
    IF r ->> TG_ARGV[i] IS NOT NULL AND r ->> TG_ARGV[i] = r ->> TG_ARGV[i + 1] THEN
      RAISE EXCEPTION 'new row for relation "%" violates check constraint "%" (% must differ from %)', TG_TABLE_NAME, TG_NAME, TG_ARGV[i], TG_ARGV[i + 1]
        USING ERRCODE = 'check_violation', CONSTRAINT = TG_NAME, TABLE = TG_TABLE_NAME;
    END IF;
    i := i + 2;
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

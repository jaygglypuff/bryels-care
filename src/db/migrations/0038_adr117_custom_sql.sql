-- ADR-117 (owner decision 2026-11-07, setting approvals.owner_approves_recipes_alone): the owner approves a recipe,
-- its steps or a how-to sheet alone. A guarded exception path in the deferred same-person triggers of ADR-073
-- (src/db/sql/adr073.sql, extended by src/db/sql/adr088.sql). Shipped as the Drizzle custom migration
-- src/db/migrations/<nnnn>_adr117_custom_sql.sql (verbatim copy, drift-tested). Idempotent. No trigger is dropped.
--
-- The rule is unchanged except that a transaction carrying `bc.owner_alone = on` may write the same person in both
-- columns of formula_revisions, routing_revisions and work_instruction_revisions only. src/lib/audit.ts sets the flag
-- (transaction-local) only when an Owner/Director with an organization-wide assignment decided approval steps of such
-- a revision alone under the setting, writing `governance.owner_alone.used` in the same transaction. Inspection plans,
-- quality release, holds, inspections, dispensing checks, process step checks and every other table never read it.
-- The ADR-073 and ADR-088 paths are kept as they were.
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
  IF current_setting('bc.owner_alone', true) = 'on' AND TG_TABLE_NAME IN (
    'formula_revisions', 'routing_revisions', 'work_instruction_revisions'
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

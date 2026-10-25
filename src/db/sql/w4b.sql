-- Wave 4 stream W4B (operational finance, ADR-020): SQL Drizzle cannot express.
-- Shipped as the Drizzle custom migration src/db/migrations/<nnnn>_w4b_custom_sql.sql (verbatim copy,
-- drift-tested); runs after the generated migration that creates the finance tables. Idempotent.
-- Defense in depth (ADR-006, docs/modules/finance.md §2.5): the finance services only insert into these
-- tables; a posted financial event, a payment application and a document transition are never edited or
-- deleted. Corrections are new rows (`reversal` postings, negative applications with reversal_of_id).

CREATE OR REPLACE FUNCTION w4b_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tg_financial_postings_append_only ON financial_postings;
--> statement-breakpoint
CREATE TRIGGER tg_financial_postings_append_only BEFORE UPDATE OR DELETE ON financial_postings
  FOR EACH ROW EXECUTE FUNCTION w4b_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_payment_applications_append_only ON payment_applications;
--> statement-breakpoint
CREATE TRIGGER tg_payment_applications_append_only BEFORE UPDATE OR DELETE ON payment_applications
  FOR EACH ROW EXECUTE FUNCTION w4b_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_finance_state_transitions_append_only ON finance_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_finance_state_transitions_append_only BEFORE UPDATE OR DELETE ON finance_state_transitions
  FOR EACH ROW EXECUTE FUNCTION w4b_forbid_mutation();

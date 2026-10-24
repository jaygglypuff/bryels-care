-- Custom SQL migration (drizzle-kit generate --custom). Verbatim copy of src/db/sql/w2c.sql;
-- tests/integration/quality/w2c-custom-sql.test.ts fails if the two differ.
-- Wave 2 stream W2C (QA release, genealogy, deviations): SQL Drizzle cannot express.
-- Shipped as the Drizzle custom migration src/db/migrations/0004_w2c_custom_sql.sql (verbatim copy,
-- drift-tested); runs after the generated migration that creates the W2C tables. Idempotent.
-- Defense in depth: the services in src/modules/quality never update or delete these rows.
-- docs/data-model.md §3.6 (test results are evidence; corrections append), §6.1 (transition logs).

CREATE OR REPLACE FUNCTION w2c_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tg_test_results_append_only ON test_results;
--> statement-breakpoint
CREATE TRIGGER tg_test_results_append_only BEFORE UPDATE OR DELETE ON test_results
  FOR EACH ROW EXECUTE FUNCTION w2c_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_dispositions_append_only ON dispositions;
--> statement-breakpoint
CREATE TRIGGER tg_dispositions_append_only BEFORE UPDATE OR DELETE ON dispositions
  FOR EACH ROW EXECUTE FUNCTION w2c_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_inspection_samples_append_only ON inspection_samples;
--> statement-breakpoint
CREATE TRIGGER tg_inspection_samples_append_only BEFORE UPDATE OR DELETE ON inspection_samples
  FOR EACH ROW EXECUTE FUNCTION w2c_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_inspection_state_transitions_append_only ON inspection_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_inspection_state_transitions_append_only BEFORE UPDATE OR DELETE ON inspection_state_transitions
  FOR EACH ROW EXECUTE FUNCTION w2c_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_deviation_state_transitions_append_only ON deviation_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_deviation_state_transitions_append_only BEFORE UPDATE OR DELETE ON deviation_state_transitions
  FOR EACH ROW EXECUTE FUNCTION w2c_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_deviation_holds_append_only ON deviation_holds;
--> statement-breakpoint
CREATE TRIGGER tg_deviation_holds_append_only BEFORE UPDATE OR DELETE ON deviation_holds
  FOR EACH ROW EXECUTE FUNCTION w2c_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_label_verifications_append_only ON label_verifications;
--> statement-breakpoint
CREATE TRIGGER tg_label_verifications_append_only BEFORE UPDATE OR DELETE ON label_verifications
  FOR EACH ROW EXECUTE FUNCTION w2c_forbid_mutation();
--> statement-breakpoint

-- A closed deviation is final: no field changes after closure (a correction needs a new deviation).
CREATE OR REPLACE FUNCTION tg_deviations_closed_final() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'deviations are never deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'deviation % is closed and cannot change', OLD.deviation_number USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_deviations_closed_final ON deviations;
--> statement-breakpoint
CREATE TRIGGER tg_deviations_closed_final BEFORE UPDATE OR DELETE ON deviations
  FOR EACH ROW EXECUTE FUNCTION tg_deviations_closed_final();

-- Custom SQL migration (drizzle-kit generate --custom). Verbatim copy of src/db/sql/w3f.sql;
-- its drift test fails if the two differ.
-- Wave 3 stream W3F (complaints, customer returns): SQL Drizzle cannot express.
-- Shipped as the Drizzle custom migration src/db/migrations/<nnnn>_w3f_custom_sql.sql (verbatim copy,
-- drift-tested); runs after the generated Wave 3 migration that creates the W3F tables. Idempotent.
-- Defense in depth: src/modules/quality/complaints.ts and src/modules/sales/returns.ts only insert
-- transition rows (docs/data-model.md §6.1 transition logs are append-only, like W2C's).

CREATE OR REPLACE FUNCTION w3f_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tg_complaint_state_transitions_append_only ON complaint_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_complaint_state_transitions_append_only BEFORE UPDATE OR DELETE ON complaint_state_transitions
  FOR EACH ROW EXECUTE FUNCTION w3f_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_customer_return_state_transitions_append_only ON customer_return_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_customer_return_state_transitions_append_only BEFORE UPDATE OR DELETE ON customer_return_state_transitions
  FOR EACH ROW EXECUTE FUNCTION w3f_forbid_mutation();

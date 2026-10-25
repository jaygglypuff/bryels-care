-- Custom SQL migration (drizzle-kit generate --custom). Verbatim copy of src/db/sql/w4c.sql;
-- its drift test fails if the two differ.
-- Wave 4 stream W4C (CAPA, change control, recall cases, equipment maintenance): SQL Drizzle cannot express.
-- Shipped as the Drizzle custom migration src/db/migrations/<nnnn>_w4c_custom_sql.sql (verbatim copy,
-- drift-tested); runs after the generated migration that creates the W4C tables. Idempotent.
-- Defense in depth: the services in src/modules/quality/{capa,change-control,recall-cases}.ts and
-- src/modules/maintenance only insert transition rows (docs/data-model.md §6.1 transition logs are
-- append-only, like W2C's and W3F's), and an issued spare part is evidence of a posted stock movement.

CREATE OR REPLACE FUNCTION w4c_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tg_capa_state_transitions_append_only ON capa_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_capa_state_transitions_append_only BEFORE UPDATE OR DELETE ON capa_state_transitions
  FOR EACH ROW EXECUTE FUNCTION w4c_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_change_control_state_transitions_append_only ON change_control_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_change_control_state_transitions_append_only BEFORE UPDATE OR DELETE ON change_control_state_transitions
  FOR EACH ROW EXECUTE FUNCTION w4c_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_recall_case_state_transitions_append_only ON recall_case_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_recall_case_state_transitions_append_only BEFORE UPDATE OR DELETE ON recall_case_state_transitions
  FOR EACH ROW EXECUTE FUNCTION w4c_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_maintenance_work_order_state_transitions_append_only ON maintenance_work_order_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_maintenance_work_order_state_transitions_append_only BEFORE UPDATE OR DELETE ON maintenance_work_order_state_transitions
  FOR EACH ROW EXECUTE FUNCTION w4c_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_maintenance_work_order_parts_append_only ON maintenance_work_order_parts;
--> statement-breakpoint
CREATE TRIGGER tg_maintenance_work_order_parts_append_only BEFORE UPDATE OR DELETE ON maintenance_work_order_parts
  FOR EACH ROW EXECUTE FUNCTION w4c_forbid_mutation();

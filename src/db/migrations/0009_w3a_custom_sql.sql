-- Custom SQL migration (drizzle-kit generate --custom). Verbatim copy of src/db/sql/w3a.sql;
-- its drift test fails if the two differ.
-- Wave 3 stream W3A (KPI engine, US-5-01): SQL Drizzle cannot express. Shipped as the Drizzle
-- custom migration <nnnn>_w3a_custom_sql.sql (verbatim copy, drift-tested in
-- tests/integration/analytics/kpi-reconciliation.test.ts); runs after the generated migration that
-- creates the W3A tables. Idempotent. Defense in depth: src/modules/analytics never updates or
-- deletes these rows (docs/analytics-kpis.md §1.4, §4.1: snapshots keep what was reported).

-- 1. KPI snapshots and reconciliation results are append-only: no UPDATE, no DELETE.
CREATE OR REPLACE FUNCTION w3a_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only (% refused); record a new row instead', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_kpi_snapshots_append_only ON kpi_snapshots;
--> statement-breakpoint
CREATE TRIGGER tg_kpi_snapshots_append_only BEFORE UPDATE OR DELETE ON kpi_snapshots
  FOR EACH ROW EXECUTE FUNCTION w3a_append_only();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_kpi_reconciliation_results_append_only ON kpi_reconciliation_results;
--> statement-breakpoint
CREATE TRIGGER tg_kpi_reconciliation_results_append_only BEFORE UPDATE OR DELETE ON kpi_reconciliation_results
  FOR EACH ROW EXECUTE FUNCTION w3a_append_only();
--> statement-breakpoint

-- 2. A KPI definition version never changes once written (A-KPI-17: a change is a new version).
DROP TRIGGER IF EXISTS tg_kpi_definitions_append_only ON kpi_definitions;
--> statement-breakpoint
CREATE TRIGGER tg_kpi_definitions_append_only BEFORE UPDATE OR DELETE ON kpi_definitions
  FOR EACH ROW EXECUTE FUNCTION w3a_append_only();

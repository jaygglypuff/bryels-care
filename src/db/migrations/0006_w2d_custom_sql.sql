-- Custom SQL migration (drizzle-kit generate --custom). Verbatim copy of src/db/sql/w2d.sql;
-- its drift test fails if the two differ.
-- Wave 2 stream W2D (BMR documents, closure, controlled reopen/amend, hybrid paper pages): SQL
-- Drizzle cannot express. Shipped as the Drizzle custom migration
-- src/db/migrations/0004_w2d_custom_sql.sql (verbatim copy, drift-tested); runs after the generated
-- migration that creates the W2D tables. Idempotent. Defense in depth: the services in
-- src/modules/production enforce the same rules first.
-- docs/data-model.md §6.2 (closed records are final; corrections are appended),
-- docs/reports-and-templates.md §2.5 (dispensing, outputs and dispositions are never paper-only).

-- 1. Closures and amendments are append-only: no UPDATE, no DELETE.
CREATE OR REPLACE FUNCTION w2d_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only (% refused); record a new row instead', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_batch_closures_append_only ON batch_closures;
--> statement-breakpoint
CREATE TRIGGER tg_batch_closures_append_only BEFORE UPDATE OR DELETE ON batch_closures
  FOR EACH ROW EXECUTE FUNCTION w2d_append_only();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_batch_amendments_append_only ON batch_amendments;
--> statement-breakpoint
CREATE TRIGGER tg_batch_amendments_append_only BEFORE UPDATE OR DELETE ON batch_amendments
  FOR EACH ROW EXECUTE FUNCTION w2d_append_only();
--> statement-breakpoint

-- 2. Reopen requests and paper pages are never deleted; a decided request and a reviewed or void
--    paper page do not change any more.
CREATE OR REPLACE FUNCTION w2d_final_rows() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_TABLE_NAME = 'batch_reopen_requests' AND OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'reopen request % is % and can no longer change', OLD.id, OLD.status USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_TABLE_NAME = 'batch_paper_records' AND OLD.status IN ('reviewed', 'void') THEN
    RAISE EXCEPTION 'paper page % is % and can no longer change', OLD.paper_reference, OLD.status USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_batch_reopen_requests_final ON batch_reopen_requests;
--> statement-breakpoint
CREATE TRIGGER tg_batch_reopen_requests_final BEFORE UPDATE OR DELETE ON batch_reopen_requests
  FOR EACH ROW EXECUTE FUNCTION w2d_final_rows();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_batch_paper_records_final ON batch_paper_records;
--> statement-breakpoint
CREATE TRIGGER tg_batch_paper_records_final BEFORE UPDATE OR DELETE ON batch_paper_records
  FOR EACH ROW EXECUTE FUNCTION w2d_final_rows();
--> statement-breakpoint

-- 3. Dispensing, output transfer and reconciliation steps are never recorded on paper only
--    (they must be system records for traceability and stock posting).
DO $$ BEGIN
  ALTER TABLE routing_steps ADD CONSTRAINT routing_steps_paper_only_kind_ck
    CHECK (record_mode <> 'paper_only' OR step_kind NOT IN ('dispensing', 'transfer', 'reconciliation'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

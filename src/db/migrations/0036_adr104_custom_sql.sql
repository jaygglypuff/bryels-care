-- ADR-104 floor decisions (migration 0035, shipped as <nnnn>_adr104_custom_sql, verbatim copy, drift-tested). Idempotent.
--
-- 1. Changes of what a batch line uses, and the "Stop for today" pauses, are append-only.
DROP TRIGGER IF EXISTS tg_batch_material_substitutions_append_only ON batch_material_substitutions;
--> statement-breakpoint
CREATE TRIGGER tg_batch_material_substitutions_append_only BEFORE UPDATE OR DELETE ON batch_material_substitutions
  FOR EACH ROW EXECUTE FUNCTION w1d_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_batch_pauses_append_only ON batch_pauses;
--> statement-breakpoint
CREATE TRIGGER tg_batch_pauses_append_only BEFORE UPDATE OR DELETE ON batch_pauses
  FOR EACH ROW EXECUTE FUNCTION w1d_forbid_mutation();
--> statement-breakpoint

-- 2. A request (another ingredient, a QA result correction) is never deleted; it is decided once (pending → approved,
--    refused or withdrawn) and what was asked never changes.
CREATE OR REPLACE FUNCTION tg_adr104_request_decided_once() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION '% row % is already %', TG_TABLE_NAME, OLD.id, OLD.status USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.requested_by <> OLD.requested_by OR NEW.requested_at <> OLD.requested_at OR NEW.reason <> OLD.reason OR NEW.batch_id <> OLD.batch_id THEN
    RAISE EXCEPTION 'What was asked in % cannot change', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_material_substitution_requests_decided_once ON material_substitution_requests;
--> statement-breakpoint
CREATE TRIGGER tg_material_substitution_requests_decided_once BEFORE UPDATE OR DELETE ON material_substitution_requests
  FOR EACH ROW EXECUTE FUNCTION tg_adr104_request_decided_once();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_qa_result_corrections_decided_once ON qa_result_corrections;
--> statement-breakpoint
CREATE TRIGGER tg_qa_result_corrections_decided_once BEFORE UPDATE OR DELETE ON qa_result_corrections
  FOR EACH ROW EXECUTE FUNCTION tg_adr104_request_decided_once();
--> statement-breakpoint

-- 3. A recipe line's approved alternatives change only while the recipe revision is draft (like its BOM lines).
--    A row removed with its draft line (ON DELETE CASCADE) finds no parent any more and is let through.
CREATE OR REPLACE FUNCTION tg_bom_line_alternatives_parent_draft() RETURNS trigger AS $$
DECLARE s text;
BEGIN
  SELECT fr.status INTO s FROM bom_lines bl JOIN formula_revisions fr ON fr.id = bl.formula_revision_id
   WHERE bl.id = coalesce(NEW.bom_line_id, OLD.bom_line_id);
  IF NOT FOUND AND TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  PERFORM w1d_assert_parent_draft(s, 'Approved alternatives of a recipe line');
  RETURN coalesce(NEW, OLD);
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_bom_line_alternatives_parent_draft ON bom_line_alternatives;
--> statement-breakpoint
CREATE TRIGGER tg_bom_line_alternatives_parent_draft BEFORE INSERT OR UPDATE OR DELETE ON bom_line_alternatives
  FOR EACH ROW EXECUTE FUNCTION tg_bom_line_alternatives_parent_draft();

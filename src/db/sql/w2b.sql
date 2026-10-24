-- Wave 2 W2B (batch execution): append-only ledgers and evidence tables.
-- production_postings is a ledger (docs/data-model.md §5.7): corrections are reversal rows.
-- process_step_readings and process_step_checklist_results are evidence: a correction is a new row
-- that supersedes the earlier one (supersedes_id), never an update or delete.
-- Uses w1d_forbid_mutation() from 0002_w1d_custom_sql.
DROP TRIGGER IF EXISTS tg_production_postings_append_only ON production_postings;
--> statement-breakpoint
CREATE TRIGGER tg_production_postings_append_only BEFORE UPDATE OR DELETE ON production_postings
  FOR EACH ROW EXECUTE FUNCTION w1d_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_process_step_readings_append_only ON process_step_readings;
--> statement-breakpoint
CREATE TRIGGER tg_process_step_readings_append_only BEFORE UPDATE OR DELETE ON process_step_readings
  FOR EACH ROW EXECUTE FUNCTION w1d_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_process_step_checklist_results_append_only ON process_step_checklist_results;
--> statement-breakpoint
CREATE TRIGGER tg_process_step_checklist_results_append_only BEFORE UPDATE OR DELETE ON process_step_checklist_results
  FOR EACH ROW EXECUTE FUNCTION w1d_forbid_mutation();

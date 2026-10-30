-- ADR-074 (stream S2): the production order daily log is append-only. A mistake is corrected by a new
-- production_daily_logs row naming the replaced row (corrects_id) with a reason, never by UPDATE or DELETE.
-- Uses w1d_forbid_mutation() from 0002_w1d_custom_sql. Idempotent.
DROP TRIGGER IF EXISTS tg_production_daily_logs_append_only ON production_daily_logs;
--> statement-breakpoint
CREATE TRIGGER tg_production_daily_logs_append_only BEFORE UPDATE OR DELETE ON production_daily_logs
  FOR EACH ROW EXECUTE FUNCTION w1d_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_production_defect_entries_append_only ON production_defect_entries;
--> statement-breakpoint
CREATE TRIGGER tg_production_defect_entries_append_only BEFORE UPDATE OR DELETE ON production_defect_entries
  FOR EACH ROW EXECUTE FUNCTION w1d_forbid_mutation();

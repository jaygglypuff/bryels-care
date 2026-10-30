-- ADR-080 §8 (stage G3): Check quality decisions are append-only evidence. A later decision is a new
-- batch_quality_checks row, never an UPDATE or DELETE. Uses w1d_forbid_mutation() from 0002_w1d_custom_sql. Idempotent.
DROP TRIGGER IF EXISTS tg_batch_quality_checks_append_only ON batch_quality_checks;
--> statement-breakpoint
CREATE TRIGGER tg_batch_quality_checks_append_only BEFORE UPDATE OR DELETE ON batch_quality_checks
  FOR EACH ROW EXECUTE FUNCTION w1d_forbid_mutation();
--> statement-breakpoint
-- ADR-080 §8 (QA review B2): the reviewer of an inspection must differ from the person who performed it,
-- except when the transaction carries `bc.tester_release = on` (set by the Check quality pass only when
-- the setting quality.release.tester_may_release allows it) or `bc.owner_override = on` (ADR-073). The CHECK
-- constraint of the same name is dropped by the generated migration; this deferred trigger replaces it.
CREATE OR REPLACE FUNCTION bc_inspection_reviewer_ck() RETURNS trigger AS $$
BEGIN
  IF current_setting('bc.tester_release', true) = 'on' OR current_setting('bc.owner_override', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF NEW.reviewed_by IS NOT NULL AND NEW.performed_by IS NOT NULL AND NEW.reviewed_by = NEW.performed_by THEN
    RAISE EXCEPTION 'new row for relation "%" violates check constraint "%" (reviewed_by must differ from performed_by)', TG_TABLE_NAME, TG_NAME
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_NAME, TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_inspections_reviewer_not_performer ON inspections;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_inspections_reviewer_not_performer AFTER INSERT OR UPDATE ON inspections
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_inspection_reviewer_ck();

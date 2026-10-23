-- Wave 1 stream W1D (production engineering master data): SQL Drizzle cannot express.
-- Shipped as the Drizzle custom migration src/db/migrations/0002_w1d_custom_sql.sql (verbatim copy,
-- drift-tested); runs after the generated migration that creates the W1D tables. Idempotent.
-- Defense in depth: the services in src/modules/masterdata enforce the same rules first.
-- docs/data-model.md §4.2 (child rows editable only while the parent revision is draft),
-- §4.3 (approved effective ranges never overlap), §4.4 (batch revision freeze), §3.1
-- (approval_decisions is append-only).

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- 1. Approved effective ranges of one parent never overlap (retired rows keep their range but
--    are excluded, because a retired revision can no longer be selected).
DO $$ BEGIN
  ALTER TABLE formula_revisions ADD CONSTRAINT formula_rev_no_overlap_ex
    EXCLUDE USING gist (formula_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&) WHERE (status = 'approved');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE routing_revisions ADD CONSTRAINT routing_rev_no_overlap_ex
    EXCLUDE USING gist (routing_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&) WHERE (status = 'approved');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE work_instruction_revisions ADD CONSTRAINT wi_rev_no_overlap_ex
    EXCLUDE USING gist (work_instruction_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&) WHERE (status = 'approved');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE inspection_plans ADD CONSTRAINT inspection_plans_no_overlap_ex
    EXCLUDE USING gist (organization_id WITH =, code WITH =, daterange(effective_from, effective_to, '[)') WITH &&) WHERE (status = 'approved');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
--> statement-breakpoint

-- 2. Child rows of a versioned record change only while the parent is draft.
CREATE OR REPLACE FUNCTION w1d_assert_parent_draft(parent_status text, what text) RETURNS void AS $$
BEGIN
  IF parent_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION '% can only change while the revision is draft (it is %)', what, coalesce(parent_status, 'missing')
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION tg_bom_lines_parent_draft() RETURNS trigger AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM formula_revisions WHERE id = coalesce(NEW.formula_revision_id, OLD.formula_revision_id);
  PERFORM w1d_assert_parent_draft(s, 'BOM lines');
  IF TG_OP = 'UPDATE' AND NEW.formula_revision_id <> OLD.formula_revision_id THEN
    SELECT status INTO s FROM formula_revisions WHERE id = OLD.formula_revision_id;
    PERFORM w1d_assert_parent_draft(s, 'BOM lines');
  END IF;
  RETURN coalesce(NEW, OLD);
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_bom_lines_parent_draft ON bom_lines;
--> statement-breakpoint
CREATE TRIGGER tg_bom_lines_parent_draft BEFORE INSERT OR UPDATE OR DELETE ON bom_lines
  FOR EACH ROW EXECUTE FUNCTION tg_bom_lines_parent_draft();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION tg_routing_steps_parent_draft() RETURNS trigger AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM routing_revisions WHERE id = coalesce(NEW.routing_revision_id, OLD.routing_revision_id);
  PERFORM w1d_assert_parent_draft(s, 'Routing steps');
  RETURN coalesce(NEW, OLD);
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_routing_steps_parent_draft ON routing_steps;
--> statement-breakpoint
CREATE TRIGGER tg_routing_steps_parent_draft BEFORE INSERT OR UPDATE OR DELETE ON routing_steps
  FOR EACH ROW EXECUTE FUNCTION tg_routing_steps_parent_draft();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION tg_routing_step_children_parent_draft() RETURNS trigger AS $$
DECLARE s text;
BEGIN
  SELECT rr.status INTO s FROM routing_steps rs JOIN routing_revisions rr ON rr.id = rs.routing_revision_id
   WHERE rs.id = coalesce(NEW.routing_step_id, OLD.routing_step_id);
  PERFORM w1d_assert_parent_draft(s, 'Step parameters and checklist items');
  RETURN coalesce(NEW, OLD);
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_routing_step_parameters_parent_draft ON routing_step_parameters;
--> statement-breakpoint
CREATE TRIGGER tg_routing_step_parameters_parent_draft BEFORE INSERT OR UPDATE OR DELETE ON routing_step_parameters
  FOR EACH ROW EXECUTE FUNCTION tg_routing_step_children_parent_draft();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_routing_step_checklist_items_parent_draft ON routing_step_checklist_items;
--> statement-breakpoint
CREATE TRIGGER tg_routing_step_checklist_items_parent_draft BEFORE INSERT OR UPDATE OR DELETE ON routing_step_checklist_items
  FOR EACH ROW EXECUTE FUNCTION tg_routing_step_children_parent_draft();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION tg_inspection_plan_tests_parent_draft() RETURNS trigger AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM inspection_plans WHERE id = coalesce(NEW.inspection_plan_id, OLD.inspection_plan_id);
  PERFORM w1d_assert_parent_draft(s, 'Inspection plan tests');
  RETURN coalesce(NEW, OLD);
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_inspection_plan_tests_parent_draft ON inspection_plan_tests;
--> statement-breakpoint
CREATE TRIGGER tg_inspection_plan_tests_parent_draft BEFORE INSERT OR UPDATE OR DELETE ON inspection_plan_tests
  FOR EACH ROW EXECUTE FUNCTION tg_inspection_plan_tests_parent_draft();
--> statement-breakpoint

-- 3. An approved or retired revision is immutable except for the controlled columns
--    (effective_to when superseded, status approved → retired).
CREATE OR REPLACE FUNCTION tg_revision_approved_immutable() RETURNS trigger AS $$
DECLARE o jsonb; n jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Only a draft revision can be deleted' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('approved', 'retired', 'rejected') THEN
    o := to_jsonb(OLD) - 'effective_to' - 'status';
    n := to_jsonb(NEW) - 'effective_to' - 'status';
    IF o <> n OR (NEW.status <> OLD.status AND NOT (OLD.status = 'approved' AND NEW.status = 'retired')) THEN
      RAISE EXCEPTION 'An approved revision is immutable; create a new revision instead' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_formula_revisions_immutable ON formula_revisions;
--> statement-breakpoint
CREATE TRIGGER tg_formula_revisions_immutable BEFORE UPDATE OR DELETE ON formula_revisions
  FOR EACH ROW EXECUTE FUNCTION tg_revision_approved_immutable();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_routing_revisions_immutable ON routing_revisions;
--> statement-breakpoint
CREATE TRIGGER tg_routing_revisions_immutable BEFORE UPDATE OR DELETE ON routing_revisions
  FOR EACH ROW EXECUTE FUNCTION tg_revision_approved_immutable();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_work_instruction_revisions_immutable ON work_instruction_revisions;
--> statement-breakpoint
CREATE TRIGGER tg_work_instruction_revisions_immutable BEFORE UPDATE OR DELETE ON work_instruction_revisions
  FOR EACH ROW EXECUTE FUNCTION tg_revision_approved_immutable();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_inspection_plans_immutable ON inspection_plans;
--> statement-breakpoint
CREATE TRIGGER tg_inspection_plans_immutable BEFORE UPDATE OR DELETE ON inspection_plans
  FOR EACH ROW EXECUTE FUNCTION tg_revision_approved_immutable();
--> statement-breakpoint

-- 4. approval_decisions is an append-only ledger.
CREATE OR REPLACE FUNCTION w1d_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_approval_decisions_append_only ON approval_decisions;
--> statement-breakpoint
CREATE TRIGGER tg_approval_decisions_append_only BEFORE UPDATE OR DELETE ON approval_decisions
  FOR EACH ROW EXECUTE FUNCTION w1d_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_equipment_state_transitions_append_only ON equipment_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_equipment_state_transitions_append_only BEFORE UPDATE OR DELETE ON equipment_state_transitions
  FOR EACH ROW EXECUTE FUNCTION w1d_forbid_mutation();
--> statement-breakpoint

-- 5. A batch keeps the revisions it was created with (AC-13): the revision columns and the
--    snapshot never change once the batch exists outside draft.
CREATE OR REPLACE FUNCTION tg_batches_freeze_revisions() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.formula_revision_id IS DISTINCT FROM OLD.formula_revision_id
    OR NEW.routing_revision_id IS DISTINCT FROM OLD.routing_revision_id
    OR NEW.inspection_plan_id IS DISTINCT FROM OLD.inspection_plan_id
    OR NEW.planned_size_g IS DISTINCT FROM OLD.planned_size_g
    OR NEW.formula_snapshot IS DISTINCT FROM OLD.formula_snapshot) THEN
    RAISE EXCEPTION 'Batch % keeps the revisions frozen at creation', OLD.batch_number USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_batches_freeze_revisions ON batches;
--> statement-breakpoint
CREATE TRIGGER tg_batches_freeze_revisions BEFORE UPDATE ON batches
  FOR EACH ROW EXECUTE FUNCTION tg_batches_freeze_revisions();

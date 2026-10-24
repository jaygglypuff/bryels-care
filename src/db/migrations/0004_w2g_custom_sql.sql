-- Custom SQL migration (drizzle-kit generate --custom). Verbatim copy of src/db/sql/w2g.sql;
-- tests/integration/masterdata/w2g-uom.test.ts fails if the two differ.
-- Wave 2 stream W2G (master data administration, US-1-20..US-1-24): SQL Drizzle cannot express.
-- Shipped as the Drizzle custom migration src/db/migrations/0004_w2g_custom_sql.sql (verbatim copy,
-- drift-tested in tests/integration/masterdata/w2g-uom.test.ts); runs after the generated migration
-- that creates the W2G tables. Idempotent. Defense in depth: src/modules/masterdata/uom.ts and
-- reason-codes.ts enforce the same rules first and return typed 422/409 errors.

-- 1. US-1-21 AC1 / S1-12: a conversion between different dimensions (g -> mL) needs a material
--    (density). Raised as UOM_DIMENSION_MISMATCH.
CREATE OR REPLACE FUNCTION tg_uom_conversions_dimension() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  d_from text;
  d_to text;
BEGIN
  SELECT dimension INTO d_from FROM uoms WHERE id = NEW.from_uom_id;
  SELECT dimension INTO d_to FROM uoms WHERE id = NEW.to_uom_id;
  IF d_from IS DISTINCT FROM d_to AND NEW.material_id IS NULL THEN
    RAISE EXCEPTION 'UOM_DIMENSION_MISMATCH: converting % to % needs a material density', d_from, d_to
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tg_uom_conversions_dimension ON uom_conversions;
--> statement-breakpoint

CREATE TRIGGER tg_uom_conversions_dimension
  BEFORE INSERT OR UPDATE OF from_uom_id, to_uom_id, material_id ON uom_conversions
  FOR EACH ROW EXECUTE FUNCTION tg_uom_conversions_dimension();
--> statement-breakpoint

-- 2. A decided conversion version is immutable; a change is a new version.
CREATE OR REPLACE FUNCTION tg_uom_conversions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('approved', 'retired', 'rejected') AND (
       NEW.from_uom_id IS DISTINCT FROM OLD.from_uom_id OR NEW.to_uom_id IS DISTINCT FROM OLD.to_uom_id
    OR NEW.factor IS DISTINCT FROM OLD.factor OR NEW.material_id IS DISTINCT FROM OLD.material_id
    OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
    RAISE EXCEPTION 'UOM_CONVERSION_IMMUTABLE: a decided conversion version cannot be changed; create a new version'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('retired', 'rejected') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'UOM_CONVERSION_IMMUTABLE: a % conversion version is final', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tg_uom_conversions_immutable ON uom_conversions;
--> statement-breakpoint

CREATE TRIGGER tg_uom_conversions_immutable
  BEFORE UPDATE ON uom_conversions
  FOR EACH ROW EXECUTE FUNCTION tg_uom_conversions_immutable();
--> statement-breakpoint

-- 3. Unit and reason codes are stored as text on lots, movements, adjustments, counts and
--    generated documents, so the code (and a unit's dimension) never changes once created.
CREATE OR REPLACE FUNCTION tg_master_code_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'CODE_IMMUTABLE: the code of % % cannot be changed', TG_TABLE_NAME, OLD.code USING ERRCODE = 'check_violation';
  END IF;
  -- Nested IF: plpgsql does not short-circuit AND, and reason_codes has no dimension column.
  IF TG_TABLE_NAME = 'uoms' THEN
    IF NEW.dimension IS DISTINCT FROM OLD.dimension THEN
      RAISE EXCEPTION 'CODE_IMMUTABLE: the dimension of unit % cannot be changed', OLD.code USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tg_uoms_code_immutable ON uoms;
--> statement-breakpoint

CREATE TRIGGER tg_uoms_code_immutable BEFORE UPDATE ON uoms FOR EACH ROW EXECUTE FUNCTION tg_master_code_immutable();
--> statement-breakpoint

DROP TRIGGER IF EXISTS tg_reason_codes_code_immutable ON reason_codes;
--> statement-breakpoint

CREATE TRIGGER tg_reason_codes_code_immutable BEFORE UPDATE ON reason_codes FOR EACH ROW EXECUTE FUNCTION tg_master_code_immutable();

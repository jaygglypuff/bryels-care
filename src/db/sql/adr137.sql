-- ADR-137: a material unit version is never rewritten. Its material, key, version, kind, name, amount and stock unit
-- stay as they were made; the only change allowed is retiring it (status active -> retired, with who, when and why).
-- A new size is a new version row (same unit_key, version_no + 1). Rows are never deleted.
CREATE OR REPLACE FUNCTION tg_material_units_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'material_units rows are never deleted (retire the unit instead)' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.material_id IS DISTINCT FROM OLD.material_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.unit_key IS DISTINCT FROM OLD.unit_key
     OR NEW.version_no IS DISTINCT FROM OLD.version_no
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.qty_per_unit IS DISTINCT FROM OLD.qty_per_unit
     OR NEW.base_uom IS DISTINCT FROM OLD.base_uom
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a material unit version cannot be changed; add a new version instead' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'retired' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a retired material unit stays retired' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_material_units_immutable ON material_units;
CREATE TRIGGER tg_material_units_immutable BEFORE UPDATE OR DELETE ON material_units
  FOR EACH ROW EXECUTE FUNCTION tg_material_units_immutable();

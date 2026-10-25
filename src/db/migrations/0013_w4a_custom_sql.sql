-- Wave 4 stream W4A (procurement): SQL Drizzle cannot express.
-- Shipped as the Drizzle custom migration src/db/migrations/<nnnn>_w4a_custom_sql.sql (verbatim copy,
-- drift-tested in tests/integration/procurement/w4a-schema.test.ts); runs after the generated migration
-- that creates the W4A tables. Idempotent.
-- The purchase request, purchase order and supplier return transition logs (docs/data-model.md §6.1)
-- are written only by the state machines in src/modules/procurement; the triggers make them
-- append-only like the W2C, W3F and W3I logs. Supplier material (ASL) decisions are history too.

CREATE OR REPLACE FUNCTION w4a_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tg_purchase_request_state_transitions_append_only ON purchase_request_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_purchase_request_state_transitions_append_only BEFORE UPDATE OR DELETE ON purchase_request_state_transitions
  FOR EACH ROW EXECUTE FUNCTION w4a_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_purchase_order_state_transitions_append_only ON purchase_order_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_purchase_order_state_transitions_append_only BEFORE UPDATE OR DELETE ON purchase_order_state_transitions
  FOR EACH ROW EXECUTE FUNCTION w4a_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_supplier_return_state_transitions_append_only ON supplier_return_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_supplier_return_state_transitions_append_only BEFORE UPDATE OR DELETE ON supplier_return_state_transitions
  FOR EACH ROW EXECUTE FUNCTION w4a_forbid_mutation();
--> statement-breakpoint

-- A decided ASL proposal is never edited or removed (W04-11 evidence); only a pending one may change status.
CREATE OR REPLACE FUNCTION w4a_supplier_material_change_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'decided supplier_material_changes rows are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_supplier_material_changes_guard ON supplier_material_changes;
--> statement-breakpoint
CREATE TRIGGER tg_supplier_material_changes_guard BEFORE UPDATE OR DELETE ON supplier_material_changes
  FOR EACH ROW EXECUTE FUNCTION w4a_supplier_material_change_guard();

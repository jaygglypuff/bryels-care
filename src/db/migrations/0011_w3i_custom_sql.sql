-- Custom SQL migration (drizzle-kit generate --custom). Verbatim copy of src/db/sql/w3i.sql;
-- its drift test fails if the two differ.
-- Wave 3 integration (W3D orders, W3E shipments): SQL Drizzle cannot express.
-- Shipped as the Drizzle custom migration src/db/migrations/<nnnn>_w3i_custom_sql.sql (verbatim copy,
-- drift-tested); runs after the generated Wave 3 migration. Idempotent.
-- The sales order and shipment transition logs (docs/data-model.md §6.1) are written only by
-- transitionOrder (src/modules/sales/orders.ts) and transitionShipment (src/modules/sales/fulfilment-state.ts);
-- the triggers make them append-only like the W2C and W3F logs.

CREATE OR REPLACE FUNCTION w3i_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tg_sales_order_state_transitions_append_only ON sales_order_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_sales_order_state_transitions_append_only BEFORE UPDATE OR DELETE ON sales_order_state_transitions
  FOR EACH ROW EXECUTE FUNCTION w3i_forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_shipment_state_transitions_append_only ON shipment_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_shipment_state_transitions_append_only BEFORE UPDATE OR DELETE ON shipment_state_transitions
  FOR EACH ROW EXECUTE FUNCTION w3i_forbid_mutation();

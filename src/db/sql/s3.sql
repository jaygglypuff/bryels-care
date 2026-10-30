-- ADR-075 (stream S3): deleting a never-submitted draft.
-- The state-transition history of sales orders, purchase requests and purchase orders stays
-- append-only. The one exception: inside a draft delete (src/lib/draft-delete.ts sets the
-- transaction-local flag bc.draft_delete = on), the creation row (from_state null -> draft) of the
-- record being deleted may go with it. Any other transition row (a submit, a return to draft, ...)
-- is still refused, so a record that was ever submitted can never be deleted. The deletion itself
-- is recorded in audit_events (<module>.<entity>.deleted with the row in `before`).
CREATE OR REPLACE FUNCTION adr075_transition_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('bc.draft_delete', true) = 'on' AND OLD.from_state IS NULL AND OLD.to_state = 'draft' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tg_sales_order_state_transitions_append_only ON sales_order_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_sales_order_state_transitions_append_only BEFORE UPDATE OR DELETE ON sales_order_state_transitions
  FOR EACH ROW EXECUTE FUNCTION adr075_transition_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_purchase_request_state_transitions_append_only ON purchase_request_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_purchase_request_state_transitions_append_only BEFORE UPDATE OR DELETE ON purchase_request_state_transitions
  FOR EACH ROW EXECUTE FUNCTION adr075_transition_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tg_purchase_order_state_transitions_append_only ON purchase_order_state_transitions;
--> statement-breakpoint
CREATE TRIGGER tg_purchase_order_state_transitions_append_only BEFORE UPDATE OR DELETE ON purchase_order_state_transitions
  FOR EACH ROW EXECUTE FUNCTION adr075_transition_guard();

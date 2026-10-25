-- ADR-073 (owner override): the same-person rules that were CHECK constraints become deferred constraint
-- triggers. Shipped as the Drizzle custom migration src/db/migrations/<nnnn>_adr073_custom_sql.sql (verbatim
-- copy, drift-tested); runs after the generated migration that drops the CHECK constraints. Idempotent.
--
-- The rule is unchanged (a row may not name the same person in both columns of a pair) except while the
-- transaction carries `bc.owner_override = on`, which src/lib/audit.ts sets (transaction-local) only when
-- the owner override let a step through, writing `governance.owner_override.used` in the same transaction.
-- The check runs at commit (DEFERRABLE INITIALLY DEFERRED) so the audit row may follow the change it records.
-- A violation raises SQLSTATE 23514 (check_violation) naming the former constraint, as the CHECK did.

CREATE OR REPLACE FUNCTION bc_sod_distinct() RETURNS trigger AS $$
DECLARE
  r jsonb := to_jsonb(NEW);
  i int := 0;
BEGIN
  IF current_setting('bc.owner_override', true) = 'on' THEN
    RETURN NULL;
  END IF;
  WHILE i < TG_NARGS LOOP
    IF r ->> TG_ARGV[i] IS NOT NULL AND r ->> TG_ARGV[i] = r ->> TG_ARGV[i + 1] THEN
      RAISE EXCEPTION 'new row for relation "%" violates check constraint "%" (% must differ from %)', TG_TABLE_NAME, TG_NAME, TG_ARGV[i], TG_ARGV[i + 1]
        USING ERRCODE = 'check_violation', CONSTRAINT = TG_NAME, TABLE = TG_TABLE_NAME;
    END IF;
    i := i + 2;
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS batch_outputs_sod_ck ON batch_outputs;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER batch_outputs_sod_ck AFTER INSERT OR UPDATE ON batch_outputs
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('checked_by', 'recorded_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS batch_paper_records_sod_ck ON batch_paper_records;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER batch_paper_records_sod_ck AFTER INSERT OR UPDATE ON batch_paper_records
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('reviewed_by', 'transcribed_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_capa_actions_verifier ON capa_actions;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_capa_actions_verifier AFTER INSERT OR UPDATE ON capa_actions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('verified_by', 'completed_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_credit_notes_sod ON credit_notes;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_credit_notes_sod AFTER INSERT OR UPDATE ON credit_notes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_disposition_requests_sod ON disposition_requests;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_disposition_requests_sod AFTER INSERT OR UPDATE ON disposition_requests
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('decided_by', 'requested_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_expense_claims_sod ON expense_claims;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_expense_claims_sod AFTER INSERT OR UPDATE ON expense_claims
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'claimant_user_id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_goods_receipt_lines_discrepancy_sod ON goods_receipt_lines;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_goods_receipt_lines_discrepancy_sod AFTER INSERT OR UPDATE ON goods_receipt_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('discrepancy_approved_by', 'discrepancy_recorded_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_invoices_sod ON invoices;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_invoices_sod AFTER INSERT OR UPDATE ON invoices
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_legacy_documents_verifier ON legacy_documents;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_legacy_documents_verifier AFTER INSERT OR UPDATE ON legacy_documents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('verified_by', 'indexed_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_legal_holds_release_sod ON legal_holds;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_legal_holds_release_sod AFTER INSERT OR UPDATE ON legal_holds
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('released_by', 'placed_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_numbering_rule_versions_sod ON numbering_rule_versions;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_numbering_rule_versions_sod AFTER INSERT OR UPDATE ON numbering_rule_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_packs_checker_not_packer ON packs;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_packs_checker_not_packer AFTER INSERT OR UPDATE ON packs
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('checked_by', 'packed_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_payment_records_sod ON payment_records;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_payment_records_sod AFTER INSERT OR UPDATE ON payment_records
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_period_unlock_requests_sod ON period_unlock_requests;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_period_unlock_requests_sod AFTER INSERT OR UPDATE ON period_unlock_requests
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('decided_by', 'requested_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_purchase_orders_sod ON purchase_orders;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_purchase_orders_sod AFTER INSERT OR UPDATE ON purchase_orders
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'created_by', 'approved_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_purchase_requests_sod ON purchase_requests;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_purchase_requests_sod AFTER INSERT OR UPDATE ON purchase_requests
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'requested_by', 'approved_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_quality_holds_closer_not_opener ON quality_holds;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_quality_holds_closer_not_opener AFTER INSERT OR UPDATE ON quality_holds
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('closed_by', 'opened_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_restore_drills_signoff_sod ON restore_drills;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_restore_drills_signoff_sod AFTER INSERT OR UPDATE ON restore_drills
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('signed_off_by', 'performed_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_retention_policies_confirm_sod ON retention_policies;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_retention_policies_confirm_sod AFTER INSERT OR UPDATE ON retention_policies
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('confirmed_by', 'updated_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_setting_change_requests_sod ON setting_change_requests;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_setting_change_requests_sod AFTER INSERT OR UPDATE ON setting_change_requests
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_setting_change_requests_sod_reject ON setting_change_requests;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_setting_change_requests_sod_reject AFTER INSERT OR UPDATE ON setting_change_requests
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('rejected_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_stock_adjustments_sod ON stock_adjustments;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_stock_adjustments_sod AFTER INSERT OR UPDATE ON stock_adjustments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'submitted_by', 'approved_by', 'created_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_supplier_bills_sod ON supplier_bills;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_supplier_bills_sod AFTER INSERT OR UPDATE ON supplier_bills
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_supplier_bills_variance_sod ON supplier_bills;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_supplier_bills_variance_sod AFTER INSERT OR UPDATE ON supplier_bills
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('variance_approved_by', 'created_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_supplier_material_changes_sod ON supplier_material_changes;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_supplier_material_changes_sod AFTER INSERT OR UPDATE ON supplier_material_changes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('decided_by', 'proposed_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_supplier_materials_sod ON supplier_materials;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_supplier_materials_sod AFTER INSERT OR UPDATE ON supplier_materials
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'requested_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_supplier_returns_sod ON supplier_returns;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_supplier_returns_sod AFTER INSERT OR UPDATE ON supplier_returns
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'created_by', 'approved_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS ck_tax_configurations_sod ON tax_configurations;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ck_tax_configurations_sod AFTER INSERT OR UPDATE ON tax_configurations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('reviewed_by', 'proposed_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS customer_requirements_sod_ck ON customer_requirements;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_requirements_sod_ck AFTER INSERT OR UPDATE ON customer_requirements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS dispense_records_exception_sod_ck ON dispense_records;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER dispense_records_exception_sod_ck AFTER INSERT OR UPDATE ON dispense_records
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('exception_approved_by', 'operator_id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS dispense_records_sod_ck ON dispense_records;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER dispense_records_sod_ck AFTER INSERT OR UPDATE ON dispense_records
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('checker_id', 'operator_id');
--> statement-breakpoint
DROP TRIGGER IF EXISTS document_template_versions_sod_ck ON document_template_versions;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER document_template_versions_sod_ck AFTER INSERT OR UPDATE ON document_template_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS equipment_override_sod_ck ON equipment_override_requests;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER equipment_override_sod_ck AFTER INSERT OR UPDATE ON equipment_override_requests
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'requested_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS equipment_service_reviewer_creator_ck ON equipment_service_records;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER equipment_service_reviewer_creator_ck AFTER INSERT OR UPDATE ON equipment_service_records
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('reviewed_by', 'created_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS formula_rev_sod_ck ON formula_revisions;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER formula_rev_sod_ck AFTER INSERT OR UPDATE ON formula_revisions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS inspection_plans_sod_ck ON inspection_plans;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER inspection_plans_sod_ck AFTER INSERT OR UPDATE ON inspection_plans
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS label_templates_sod_ck ON label_templates;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER label_templates_sod_ck AFTER INSERT OR UPDATE ON label_templates
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'updated_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS price_lists_sod_ck ON price_lists;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER price_lists_sod_ck AFTER INSERT OR UPDATE ON price_lists
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS process_step_records_sod_ck ON process_step_records;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER process_step_records_sod_ck AFTER INSERT OR UPDATE ON process_step_records
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('checked_by', 'conducted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS routing_rev_sod_ck ON routing_revisions;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER routing_rev_sod_ck AFTER INSERT OR UPDATE ON routing_revisions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS scrap_rework_sod_ck ON scrap_rework_records;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER scrap_rework_sod_ck AFTER INSERT OR UPDATE ON scrap_rework_records
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('decided_by', 'recorded_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS uom_conv_sod_ck ON uom_conversions;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER uom_conv_sod_ck AFTER INSERT OR UPDATE ON uom_conversions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS wi_rev_sod_ck ON work_instruction_revisions;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER wi_rev_sod_ck AFTER INSERT OR UPDATE ON work_instruction_revisions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'submitted_by');
--> statement-breakpoint
DROP TRIGGER IF EXISTS yield_records_sod_ck ON yield_records;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER yield_records_sod_ck AFTER INSERT OR UPDATE ON yield_records
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bc_sod_distinct('approved_by', 'recorded_by');

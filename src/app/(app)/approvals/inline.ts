/**
 * Approval kinds that can be decided straight from the "To approve" list (ADR-075), with the
 * plain-English label of the "no" button (some send the record back instead of rejecting it).
 * Other kinds open their record page.
 */
export const INLINE_DECISIONS: Record<string, { reject: string }> = {
  "approval.stock_adjustment": { reject: "Reject" },
  "approval.purchase_request": { reject: "Reject" },
  "approval.purchase_order": { reject: "Send back" },
  "approval.supplier_return": { reject: "Send back" },
  "approval.sales_order": { reject: "Send back" },
  "approval.quote": { reject: "Send back" },
  "approval.price_list": { reject: "Reject" },
  "approval.customer_requirement": { reject: "Reject" },
  "approval.customer_return": { reject: "" },
  "approval.invoice": { reject: "Send back" },
  "approval.expense_claim": { reject: "Reject" },
  "approval.change_control": { reject: "Reject" },
  "approval.import_job": { reject: "Reject" },
  // Approve only: a production order is not sent back; it is cancelled (with a reason) on its own page.
  "approval.production_order": { reject: "" },
};

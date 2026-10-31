/** Plain names for approval record types and conditions (ADR-088). The stored values are unchanged. */
export const DOC_TYPE_TEXT: Record<string, string> = {
  purchase_request: "Request to buy",
  purchase_order: "Order to a supplier",
  sales_order: "Customer order",
  quote: "Price offer (quotation)",
  stock_adjustment: "Stock correction",
  stock_count_variance: "Difference found in a stock count",
  expense_claim: "Expense claim",
  invoice: "Customer invoice",
  supplier_bill: "Supplier bill",
  credit_note: "Credit note",
  payment_record: "Payment",
  dispense_exception: "Weighing that was off",
  over_shipment: "Sending more than ordered",
  formula_revision: "Recipe change",
  routing_revision: "Change to the steps",
  routing_revision_sequencing: "Change to the order of steps",
  work_instruction_revision: "Change to work instructions",
  inspection_plan: "QA test plan",
  disposition_conditional_release: "OK with conditions (QA)",
  recall_case: "Product recall",
  batch_reopen: "Opening a finished batch again",
  work_order_release: "Production order",
  leave_request: "Leave request",
  overtime_request: "Overtime request",
  payroll_period: "Payroll period",
  period_lock_unlock: "Opening a closed month",
  setting_change_request: "Settings change",
  retention_action: "Deleting old records",
  supplier_return: "Return to a supplier",
  equipment_override: "Using a machine that is due for a check",
  payroll_period_reopen: "Opening a closed payroll",
  price_list: "Price list",
  change_control: "Change request (QA)",
};

export const BASIS_TEXT: Record<string, string> = {
  always: "Always",
  amount: "When the amount is",
  qty_base: "When the quantity is",
  variance_pct: "When the difference (%) is",
  discount_pct: "When the discount (%) is",
  credit_check_failed: "When the customer is over their credit limit",
};

export const docTypeText = (t: string) => DOC_TYPE_TEXT[t] ?? t.replace(/_/g, " ");
export const basisText = (b: string) => BASIS_TEXT[b] ?? b.replace(/_/g, " ");

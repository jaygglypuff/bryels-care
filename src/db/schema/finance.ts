import { sql } from "drizzle-orm";
import { boolean, char, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { MONEY, QTY, createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";
import { customers, products, materials } from "./masterdata";
import { salesOrderLines, salesOrders, shipments } from "./sales";
import { goodsReceiptLines, goodsReceipts, suppliers } from "./receiving";
import { customerReturns } from "./complaints";
import { fileAttachments } from "./files";

/**
 * Wave 4 W4B: operational finance support (ADR-020; docs/modules/finance.md; docs/data-model.md §3.9).
 * NOT a general ledger: `financial_postings` records each posted financial event (append-only, trigger in
 * src/db/sql/w4b.sql); `direction` is informational. Posted documents are never edited: corrections are
 * a reversal posting with reason (plus a replacement document). Money is numeric(18,4), never float.
 */

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));
const RATE = { precision: 9, scale: 4 } as const;

/* ------------------------------------------------------------------ periods (US-6-13) */

export const ACCOUNTING_PERIOD_STATUSES = ["open", "locked"] as const;

/**
 * Calendar-month accounting periods (A-FIN-02), created on demand the first time a document dates into
 * them (replaces the `finance.period_maintenance` job). Postings take the row FOR SHARE, the lock command
 * FOR UPDATE, so a lock and a posting into the same period serialize.
 */
export const accountingPeriods = pgTable(
  "accounting_periods",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    /** YYYY-MM */
    periodCode: text("period_code").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: text("status").notNull().default("open"),
    lockedBy: uuid("locked_by").references(() => users.id),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockReason: text("lock_reason"),
    /** Acknowledged pre-lock checklist items (open documents dated in the period, with reason). */
    lockAcknowledgements: jsonb("lock_acknowledgements"),
    unlockedBy: uuid("unlocked_by").references(() => users.id),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_accounting_periods_org_code").on(t.organizationId, t.periodCode),
    check("ck_accounting_periods_status", sql`${t.status} in (${inList(ACCOUNTING_PERIOD_STATUSES)})`),
    check("ck_accounting_periods_code", sql`${t.periodCode} ~ '^[0-9]{4}-[0-9]{2}$'`),
    check("ck_accounting_periods_dates", sql`${t.periodEnd} >= ${t.periodStart}`),
    check("ck_accounting_periods_locked", sql`${t.status} <> 'locked' or (${t.lockedBy} is not null and ${t.lockedAt} is not null and ${t.lockReason} is not null)`),
  ],
);

export const PERIOD_UNLOCK_STATUSES = ["pending", "applied", "rejected", "cancelled"] as const;

/**
 * Unlock of a locked period (finance.period_lock.void): the request is the finance approval (step 1 of
 * approval_rules `period_lock_unlock`), a different person gives the owner approval (step 2); the period
 * opens when the last step is approved (`finance.period_unlock_two_approvals`, A-W4B-04).
 */
export const periodUnlockRequests = pgTable(
  "period_unlock_requests",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    accountingPeriodId: uuid("accounting_period_id").notNull().references(() => accountingPeriods.id),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_period_unlock_requests_pending").on(t.accountingPeriodId).where(sql`${t.status} = 'pending'`),
    check("ck_period_unlock_requests_status", sql`${t.status} in (${inList(PERIOD_UNLOCK_STATUSES)})`),
  ],
);

/* ------------------------------------------------------------------ tax configuration (US-6-14) */

export const TAX_KINDS = ["vat_output", "vat_input", "withholding_receivable", "withholding_payable", "exempt", "zero_rated", "other"] as const;
export const TAX_APPLIES_TO = ["sales", "purchases", "expenses"] as const;
export const TAX_ROUNDING = ["line", "document"] as const;
export const TAX_CONFIG_STATUSES = ["proposed", "approved", "rejected", "retired"] as const;

/**
 * Tax codes and rates as reviewed data (docs/modules/finance.md §5, A-FIN-18). One row per version of a
 * code; a row is effective only once approved by a second person (`reviewed_by`, ≠ the proposer): until
 * then it shows "Pending accountant review" and no document can use it. No rate exists in code; seed rows
 * are FICTIONAL placeholders (`is_fictional`).
 */
export const taxConfigurations = pgTable(
  "tax_configurations",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    code: text("code").notNull(),
    versionNo: integer("version_no").notNull().default(1),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    ratePct: numeric("rate_pct", RATE).notNull(),
    inclusive: boolean("inclusive").notNull().default(false),
    appliesTo: text("applies_to").notNull().default("sales"),
    rounding: text("rounding").notNull().default("line"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    status: text("status").notNull().default("proposed"),
    isFictional: boolean("is_fictional").notNull().default(false),
    sourceNote: text("source_note"),
    proposedBy: uuid("proposed_by").notNull().references(() => users.id),
    proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    rejectedBy: uuid("rejected_by").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    retiredBy: uuid("retired_by").references(() => users.id),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    retireReason: text("retire_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_tax_configurations_code_version").on(t.organizationId, t.code, t.versionNo),
    index("ix_tax_configurations_lookup").on(t.organizationId, t.code, t.status, t.effectiveFrom),
    check("ck_tax_configurations_code", sql`${t.code} ~ '^[A-Z0-9_-]{1,20}$'`),
    check("ck_tax_configurations_kind", sql`${t.kind} in (${inList(TAX_KINDS)})`),
    check("ck_tax_configurations_applies", sql`${t.appliesTo} in (${inList(TAX_APPLIES_TO)})`),
    check("ck_tax_configurations_rounding", sql`${t.rounding} in (${inList(TAX_ROUNDING)})`),
    check("ck_tax_configurations_status", sql`${t.status} in (${inList(TAX_CONFIG_STATUSES)})`),
    check("ck_tax_configurations_rate", sql`${t.ratePct} >= 0 and ${t.ratePct} <= 100`),
    check("ck_tax_configurations_dates", sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`),
    // Saved without a reviewer = not effective (US-6-14); the reviewer is a second person.
    check("ck_tax_configurations_reviewed", sql`${t.status} not in ('approved','retired') or (${t.reviewedBy} is not null and ${t.reviewedAt} is not null)`),
  ],
);

/* ------------------------------------------------------------------ ledger */

export const POSTING_TYPES = ["invoice_issue", "bill_post", "payment", "credit_note", "expense", "reversal"] as const;
export const FINANCE_DOCUMENT_TYPES = ["invoice", "supplier_bill", "payment_record", "credit_note", "expense_claim"] as const;

/**
 * One posted financial event (docs/data-model.md §5.7). Append-only (src/db/sql/w4b.sql); a correction is
 * a `reversal` row pointing at the original (one reversal per posting). `posting_date` falls in an open
 * period (409 PERIOD_LOCKED otherwise).
 */
export const financialPostings = pgTable(
  "financial_postings",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    postingType: text("posting_type").notNull(),
    documentType: text("document_type").notNull(),
    documentId: uuid("document_id").notNull(),
    documentNumber: text("document_number").notNull(),
    accountingPeriodId: uuid("accounting_period_id").notNull().references(() => accountingPeriods.id),
    postingDate: date("posting_date").notNull(),
    amount: numeric("amount", MONEY).notNull(),
    taxAmount: numeric("tax_amount", MONEY).notNull().default("0"),
    currency: char("currency", { length: 3 }).notNull(),
    /** Informational until a general ledger is approved (ADR-020). */
    direction: text("direction").notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    counterpartyUserId: uuid("counterparty_user_id").references(() => users.id),
    reversalOfId: uuid("reversal_of_id"),
    reason: text("reason"),
    idempotencyKey: text("idempotency_key"),
    correlationId: uuid("correlation_id").notNull(),
    postedBy: uuid("posted_by").notNull().references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_financial_postings_reversal").on(t.reversalOfId).where(sql`${t.reversalOfId} is not null`),
    uniqueIndex("uq_financial_postings_idem").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    index("ix_financial_postings_document").on(t.documentType, t.documentId),
    index("ix_financial_postings_period").on(t.accountingPeriodId, t.postingType),
    check("ck_financial_postings_type", sql`${t.postingType} in (${inList(POSTING_TYPES)})`),
    check("ck_financial_postings_document_type", sql`${t.documentType} in (${inList(FINANCE_DOCUMENT_TYPES)})`),
    check("ck_financial_postings_direction", sql`${t.direction} in ('debit','credit')`),
    check("ck_financial_postings_amount", sql`${t.amount} > 0 and ${t.taxAmount} >= 0`),
    check("ck_financial_postings_reversal", sql`(${t.postingType} = 'reversal') = (${t.reversalOfId} is not null) and (${t.postingType} <> 'reversal' or ${t.reason} is not null)`),
  ],
);

/** State history of every finance document (docs/data-model.md §6.1 shape; one table for the five types). Append-only. */
export const financeStateTransitions = pgTable(
  "finance_state_transitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    documentType: text("document_type").notNull(),
    documentId: uuid("document_id").notNull(),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    correlationId: uuid("correlation_id").notNull(),
  },
  (t) => [
    index("ix_finance_state_transitions_document").on(t.documentType, t.documentId, t.occurredAt),
    check("ck_finance_state_transitions_type", sql`${t.documentType} in (${inList(FINANCE_DOCUMENT_TYPES)})`),
  ],
);

/* ------------------------------------------------------------------ receivables (US-6-10) */

export const INVOICE_STATUSES = ["draft", "submitted", "approved", "issued", "partially_paid", "paid", "closed", "voided", "cancelled"] as const;

/**
 * What a customer owes for one dispatched shipment (A-FIN-03). Lines and amounts are frozen at issue,
 * when the gapless INV number is allocated inside the posting (A-DM-05). `paid_amount` (payment
 * applications) and `credited_amount` (issued credit notes) are projections written in the same
 * transaction as the application; open amount = total − paid − credited.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    invoiceNumber: text("invoice_number"),
    status: text("status").notNull().default("draft"),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    salesOrderId: uuid("sales_order_id").notNull().references(() => salesOrders.id),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
    billToText: text("bill_to_text"),
    customerPoNumber: text("customer_po_number"),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    paymentTermsDays: integer("payment_terms_days"),
    issueDate: date("issue_date"),
    dueDate: date("due_date"),
    subtotalAmount: numeric("subtotal_amount", MONEY).notNull().default("0"),
    taxAmount: numeric("tax_amount", MONEY).notNull().default("0"),
    totalAmount: numeric("total_amount", MONEY).notNull().default("0"),
    paidAmount: numeric("paid_amount", MONEY).notNull().default("0"),
    creditedAmount: numeric("credited_amount", MONEY).notNull().default("0"),
    /** Snapshot of the tax configuration rows applied at issue (code v#, rate). */
    taxConfigurationRef: text("tax_configuration_ref"),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    postedBy: uuid("posted_by").references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    voidedByCreditNoteId: uuid("voided_by_credit_note_id"),
    cancelReason: text("cancel_reason"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_invoices_org_number").on(t.organizationId, t.invoiceNumber).where(sql`${t.invoiceNumber} is not null`),
    uniqueIndex("uq_invoices_org_idem").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    // V-FIN-DUP: one live invoice per shipment.
    uniqueIndex("uq_invoices_shipment_live").on(t.shipmentId).where(sql`${t.status} not in ('cancelled','voided')`),
    index("ix_invoices_site_status").on(t.siteId, t.status),
    index("ix_invoices_customer").on(t.customerId, t.status),
    check("ck_invoices_status", sql`${t.status} in (${inList(INVOICE_STATUSES)})`),
    check("ck_invoices_issued", sql`${t.status} in ('draft','submitted','approved','cancelled') or (${t.invoiceNumber} is not null and ${t.issueDate} is not null and ${t.dueDate} is not null and ${t.postedBy} is not null)`),
    check("ck_invoices_amounts", sql`${t.subtotalAmount} >= 0 and ${t.taxAmount} >= 0 and ${t.totalAmount} >= 0 and ${t.paidAmount} >= 0 and ${t.creditedAmount} >= 0`),
    check("ck_invoices_not_overpaid", sql`${t.paidAmount} + ${t.creditedAmount} <= ${t.totalAmount}`),
    check("ck_invoices_voided", sql`${t.status} <> 'voided' or (${t.voidedBy} is not null and ${t.voidReason} is not null)`),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: id(),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
    lineNo: integer("line_no").notNull(),
    salesOrderLineId: uuid("sales_order_line_id").notNull().references(() => salesOrderLines.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    description: text("description").notNull(),
    qty: numeric("qty", QTY).notNull(),
    uom: text("uom").notNull().default("pcs"),
    unitAmount: numeric("unit_amount", MONEY).notNull(),
    /** Tax code chosen for the line (configuration); the rate is resolved and frozen at issue. */
    taxCode: text("tax_code"),
    taxConfigurationId: uuid("tax_configuration_id").references(() => taxConfigurations.id),
    taxRatePct: numeric("tax_rate_pct", RATE).notNull().default("0"),
    taxInclusive: boolean("tax_inclusive").notNull().default(false),
    lineAmount: numeric("line_amount", MONEY).notNull(),
    taxAmount: numeric("tax_amount", MONEY).notNull().default("0"),
    totalAmount: numeric("total_amount", MONEY).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
  },
  (t) => [
    uniqueIndex("uq_invoice_lines_no").on(t.invoiceId, t.lineNo),
    check("ck_invoice_lines_qty", sql`${t.qty} > 0`),
    check("ck_invoice_lines_amounts", sql`${t.unitAmount} >= 0 and ${t.lineAmount} >= 0 and ${t.taxAmount} >= 0`),
  ],
);

export const CREDIT_NOTE_STATUSES = ["draft", "submitted", "approved", "issued", "applied", "voided", "cancelled"] as const;

/**
 * Reduces a customer's receivable on one issued invoice (return, pricing error, full void). Issue posts the
 * `credit_note` row, allocates the CN number and applies the amount to the invoice in one transaction.
 */
export const creditNotes = pgTable(
  "credit_notes",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    creditNoteNumber: text("credit_note_number"),
    status: text("status").notNull().default("draft"),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    customerReturnId: uuid("customer_return_id").references(() => customerReturns.id),
    reasonCode: text("reason_code").notNull(),
    reason: text("reason").notNull(),
    /** Gross amount credited (incl. the tax share). */
    amount: numeric("amount", MONEY).notNull(),
    /** Tax share, pro rata to the invoice's tax (A-W4B-07, for accountant review). */
    taxAmount: numeric("tax_amount", MONEY).notNull().default("0"),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    /** True: the credit voids the whole open amount of the invoice (R-08). */
    voidsInvoice: boolean("voids_invoice").notNull().default(false),
    issueDate: date("issue_date"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    postedBy: uuid("posted_by").references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    cancelReason: text("cancel_reason"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_credit_notes_org_number").on(t.organizationId, t.creditNoteNumber).where(sql`${t.creditNoteNumber} is not null`),
    uniqueIndex("uq_credit_notes_org_idem").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    index("ix_credit_notes_invoice").on(t.invoiceId),
    index("ix_credit_notes_site_status").on(t.siteId, t.status),
    check("ck_credit_notes_status", sql`${t.status} in (${inList(CREDIT_NOTE_STATUSES)})`),
    check("ck_credit_notes_amount", sql`${t.amount} > 0 and ${t.taxAmount} >= 0 and ${t.taxAmount} <= ${t.amount}`),
    check("ck_credit_notes_issued", sql`${t.status} not in ('issued','applied','voided') or (${t.creditNoteNumber} is not null and ${t.postedBy} is not null)`),
  ],
);

/* ------------------------------------------------------------------ payables (US-6-11) */

export const SUPPLIER_BILL_STATUSES = ["draft", "submitted", "disputed", "approved", "posted", "partially_paid", "paid", "closed", "voided", "cancelled"] as const;
export const SUPPLIER_BILL_KINDS = ["bill", "credit", "charge"] as const;
export const CHARGE_KINDS = ["goods", "freight", "duties", "brokerage", "other"] as const;
export const MATCH_RESULTS = ["matched", "qty_variance", "price_variance", "no_po", "no_receipt"] as const;

/**
 * What we owe a supplier (docs/modules/finance.md §3.2). Submit runs the three-way match per line; a
 * variance beyond tolerance puts the bill in `disputed` until the variance is approved, the purchase order
 * is amended (re-match) or a supplier credit is entered. `purchase_order_id` has no FK: the procurement
 * tables arrive with W4A (read through `registerPurchaseOrderMatchSource`).
 */
export const supplierBills = pgTable(
  "supplier_bills",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    billNumber: text("bill_number").notNull(),
    billKind: text("bill_kind").notNull().default("bill"),
    status: text("status").notNull().default("draft"),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    supplierReference: text("supplier_reference").notNull(),
    goodsReceiptId: uuid("goods_receipt_id").references(() => goodsReceipts.id),
    purchaseOrderId: uuid("purchase_order_id"),
    /** Non-stock category of a bill without a PO or receipt (setting finance.bill.no_po_categories, A-FIN-09). */
    categoryCode: text("category_code"),
    /** A supplier credit (bill_kind credit) reduces this bill's open amount. */
    creditForBillId: uuid("credit_for_bill_id"),
    replacesDocumentId: uuid("replaces_document_id"),
    billDate: date("bill_date").notNull(),
    dueDate: date("due_date"),
    paymentTermsDays: integer("payment_terms_days"),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    subtotalAmount: numeric("subtotal_amount", MONEY).notNull().default("0"),
    taxAmount: numeric("tax_amount", MONEY).notNull().default("0"),
    totalAmount: numeric("total_amount", MONEY).notNull().default("0"),
    paidAmount: numeric("paid_amount", MONEY).notNull().default("0"),
    /** Last three-way match: per-line results and the tolerances used. */
    matchSummary: jsonb("match_summary"),
    varianceApprovedBy: uuid("variance_approved_by").references(() => users.id),
    varianceApprovedAt: timestamp("variance_approved_at", { withTimezone: true }),
    varianceReason: text("variance_reason"),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    postedBy: uuid("posted_by").references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    cancelReason: text("cancel_reason"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_supplier_bills_org_number").on(t.organizationId, t.billNumber),
    uniqueIndex("uq_supplier_bills_org_idem").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    // V-FIN-DUP: the supplier's own number once per supplier (cancelled bills excluded).
    uniqueIndex("uq_supplier_bills_supplier_ref").on(t.supplierId, sql`lower(${t.supplierReference})`).where(sql`${t.status} <> 'cancelled'`),
    index("ix_supplier_bills_site_status").on(t.siteId, t.status),
    check("ck_supplier_bills_status", sql`${t.status} in (${inList(SUPPLIER_BILL_STATUSES)})`),
    check("ck_supplier_bills_kind", sql`${t.billKind} in (${inList(SUPPLIER_BILL_KINDS)})`),
    check("ck_supplier_bills_amounts", sql`${t.subtotalAmount} >= 0 and ${t.taxAmount} >= 0 and ${t.totalAmount} >= 0 and ${t.paidAmount} >= 0 and ${t.paidAmount} <= ${t.totalAmount}`),
    check("ck_supplier_bills_posted", sql`${t.status} not in ('posted','partially_paid','paid','closed','voided') or (${t.postedBy} is not null and ${t.dueDate} is not null)`),
    check("ck_supplier_bills_credit_ref", sql`(${t.billKind} = 'credit') = (${t.creditForBillId} is not null)`),
  ],
);

export const supplierBillLines = pgTable(
  "supplier_bill_lines",
  {
    id: id(),
    supplierBillId: uuid("supplier_bill_id").notNull().references(() => supplierBills.id),
    lineNo: integer("line_no").notNull(),
    chargeKind: text("charge_kind").notNull().default("goods"),
    materialId: uuid("material_id").references(() => materials.id),
    goodsReceiptLineId: uuid("goods_receipt_line_id").references(() => goodsReceiptLines.id),
    /** W4A purchase_order_lines.id (no FK across streams). */
    purchaseOrderLineId: uuid("purchase_order_line_id"),
    description: text("description").notNull(),
    qty: numeric("qty", QTY).notNull(),
    uom: text("uom"),
    unitAmount: numeric("unit_amount", MONEY).notNull(),
    taxCode: text("tax_code"),
    taxConfigurationId: uuid("tax_configuration_id").references(() => taxConfigurations.id),
    taxRatePct: numeric("tax_rate_pct", RATE).notNull().default("0"),
    lineAmount: numeric("line_amount", MONEY).notNull(),
    taxAmount: numeric("tax_amount", MONEY).notNull().default("0"),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    matchResult: text("match_result"),
    matchDetail: jsonb("match_detail"),
  },
  (t) => [
    uniqueIndex("uq_supplier_bill_lines_no").on(t.supplierBillId, t.lineNo),
    index("ix_supplier_bill_lines_gr_line").on(t.goodsReceiptLineId),
    check("ck_supplier_bill_lines_charge", sql`${t.chargeKind} in (${inList(CHARGE_KINDS)})`),
    check("ck_supplier_bill_lines_match", sql`${t.matchResult} is null or ${t.matchResult} in (${inList(MATCH_RESULTS)})`),
    check("ck_supplier_bill_lines_qty", sql`${t.qty} > 0 and ${t.unitAmount} >= 0 and ${t.lineAmount} >= 0 and ${t.taxAmount} >= 0`),
  ],
);

/* ------------------------------------------------------------------ expenses (US-6-12) */

export const EXPENSE_CLAIM_STATUSES = ["draft", "submitted", "approved", "rejected", "posted", "paid", "cancelled", "voided"] as const;

/**
 * Staff spend to reimburse (docs/modules/finance.md §3.3). The claimant is a user (no employees table
 * outside HR scope, A-W4B-06). Approval steps come from approval_rules `expense_claim`; the claimant never
 * approves; posting writes the `expense` row (claim becomes payable); an outbound payment pays it.
 */
export const expenseClaims = pgTable(
  "expense_claims",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    claimNumber: text("claim_number").notNull(),
    claimKind: text("claim_kind").notNull().default("claim"),
    status: text("status").notNull().default("draft"),
    claimantUserId: uuid("claimant_user_id").notNull().references(() => users.id),
    categoryCode: text("category_code").notNull(),
    description: text("description").notNull(),
    expenseDate: date("expense_date").notNull(),
    amount: numeric("amount", MONEY).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    receiptAttachmentId: uuid("receipt_attachment_id").references(() => fileAttachments.id),
    paidAmount: numeric("paid_amount", MONEY).notNull().default("0"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    rejectedBy: uuid("rejected_by").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    postedBy: uuid("posted_by").references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    cancelReason: text("cancel_reason"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_expense_claims_org_number").on(t.organizationId, t.claimNumber),
    uniqueIndex("uq_expense_claims_org_idem").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    index("ix_expense_claims_site_status").on(t.siteId, t.status),
    index("ix_expense_claims_claimant").on(t.claimantUserId, t.status),
    check("ck_expense_claims_status", sql`${t.status} in (${inList(EXPENSE_CLAIM_STATUSES)})`),
    check("ck_expense_claims_kind", sql`${t.claimKind} in ('claim','request')`),
    check("ck_expense_claims_amount", sql`${t.amount} > 0 and ${t.paidAmount} >= 0 and ${t.paidAmount} <= ${t.amount}`),
    // The claimant never approves (here and in the service); poster ≠ approver is the service's rule (A-PM-10).
    check("ck_expense_claims_rejected", sql`${t.status} <> 'rejected' or (${t.rejectedBy} is not null and ${t.rejectionReason} is not null)`),
  ],
);

/* ------------------------------------------------------------------ payments (US-6-12) */

export const PAYMENT_STATUSES = ["draft", "submitted", "approved", "recorded", "reconciled", "voided", "cancelled"] as const;
export const PAYMENT_METHODS = ["cash", "bank_transfer", "cheque", "gcash", "provider", "other"] as const;

/**
 * Money received (inbound, from a customer) or paid (outbound, to a supplier or a claimant). The system
 * never moves money: the record is the evidence of a payment made outside (bank, cash). Posting (`recorded`)
 * writes the `payment` row and the applications; a void reverses both.
 */
export const paymentRecords = pgTable(
  "payment_records",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    /** Site of the first applied document; null = organization-wide (visible to org-wide roles only). */
    siteId: uuid("site_id").references(() => sites.id),
    paymentNumber: text("payment_number").notNull(),
    direction: text("direction").notNull(),
    status: text("status").notNull().default("draft"),
    customerId: uuid("customer_id").references(() => customers.id),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    claimantUserId: uuid("claimant_user_id").references(() => users.id),
    method: text("method").notNull(),
    reference: text("reference"),
    bankReference: text("bank_reference"),
    paidOn: date("paid_on").notNull(),
    amount: numeric("amount", MONEY).notNull(),
    withheldAmount: numeric("withheld_amount", MONEY).notNull().default("0"),
    appliedAmount: numeric("applied_amount", MONEY).notNull().default("0"),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    /** Applications chosen at entry: [{ documentType, documentId, amount }]; null = oldest due first (A-FIN-07). */
    applicationPlan: jsonb("application_plan").$type<{ documentType: "invoice" | "supplier_bill" | "expense_claim"; documentId: string; amount: string }[] | null>(),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    postedBy: uuid("posted_by").references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    cancelReason: text("cancel_reason"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_payment_records_org_number").on(t.organizationId, t.paymentNumber),
    uniqueIndex("uq_payment_records_org_idem").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    index("ix_payment_records_site_status").on(t.siteId, t.status),
    check("ck_payment_records_status", sql`${t.status} in (${inList(PAYMENT_STATUSES)})`),
    check("ck_payment_records_direction", sql`${t.direction} in ('inbound','outbound')`),
    check("ck_payment_records_method", sql`${t.method} in (${inList(PAYMENT_METHODS)})`),
    check(
      "ck_payment_records_counterparty",
      sql`(case when ${t.customerId} is not null then 1 else 0 end) + (case when ${t.supplierId} is not null then 1 else 0 end) + (case when ${t.claimantUserId} is not null then 1 else 0 end) = 1`,
    ),
    check("ck_payment_records_direction_party", sql`(${t.direction} = 'inbound') = (${t.customerId} is not null)`),
    check("ck_payment_records_amounts", sql`${t.amount} > 0 and ${t.withheldAmount} >= 0 and ${t.appliedAmount} >= 0 and ${t.appliedAmount} <= ${t.amount} + ${t.withheldAmount}`),
    check("ck_payment_records_posted", sql`${t.status} not in ('recorded','reconciled','voided') or ${t.postedBy} is not null`),
  ],
);

/**
 * One application of a posted payment to an invoice, a bill or an expense claim. Append-only: a void
 * inserts a negative row pointing at the original (`reversal_of_id`), so history is never edited.
 */
export const paymentApplications = pgTable(
  "payment_applications",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    paymentRecordId: uuid("payment_record_id").notNull().references(() => paymentRecords.id),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    supplierBillId: uuid("supplier_bill_id").references(() => supplierBills.id),
    expenseClaimId: uuid("expense_claim_id").references(() => expenseClaims.id),
    appliedAmount: numeric("applied_amount", MONEY).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    appliedOn: date("applied_on").notNull(),
    reversalOfId: uuid("reversal_of_id"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("ix_payment_applications_payment").on(t.paymentRecordId),
    index("ix_payment_applications_invoice").on(t.invoiceId),
    index("ix_payment_applications_bill").on(t.supplierBillId),
    uniqueIndex("uq_payment_applications_reversal").on(t.reversalOfId).where(sql`${t.reversalOfId} is not null`),
    check(
      "ck_payment_applications_target",
      sql`(case when ${t.invoiceId} is not null then 1 else 0 end) + (case when ${t.supplierBillId} is not null then 1 else 0 end) + (case when ${t.expenseClaimId} is not null then 1 else 0 end) = 1`,
    ),
    check("ck_payment_applications_sign", sql`(${t.reversalOfId} is null and ${t.appliedAmount} > 0) or (${t.reversalOfId} is not null and ${t.appliedAmount} < 0)`),
  ],
);

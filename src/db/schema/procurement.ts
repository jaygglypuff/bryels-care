import { boolean, char, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { MONEY, QTY, createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";
import { inventoryLots, stockMovements } from "./inventory";
import { locations, materials, products, warehouses } from "./masterdata";
import { containers } from "./containers";
import { fileAttachments } from "./files";
import { goodsReceipts, supplierMaterials, suppliers } from "./receiving";

/**
 * Wave 4 W4A: procurement (E-6-01: US-6-01, US-6-02, US-6-03, US-6-21, US-6-04, US-6-20;
 * docs/data-model.md §3.4, §6.4, docs/process-maps.md W04, docs/analytics-kpis.md §6).
 *
 * Contract for finance (W4B supplier bills, three-way match): `purchase_order_lines` holds the ordered
 * quantity (`qty_base`, `base_uom`), the price (`unit_amount` per `uom_entered`, `line_amount`,
 * `currency`) and the received quantity (`qty_received_base`, a projection of posted
 * `goods_receipt_lines.qty_base` where `goods_receipt_lines.purchase_order_line_id` = the line);
 * `goods_receipts.purchase_order_id` links the receipt. Every state machine below has its transition
 * table in src/modules/procurement (`*_TRANSITIONS`) and an append-only `*_state_transitions` log.
 */

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

/* ------------------------------------------------------------------ approved supplier list (US-6-01) */

export const SUPPLIER_MATERIAL_CHANGE_ACTIONS = ["approve", "suspend"] as const;
export const SUPPLIER_MATERIAL_CHANGE_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;

/**
 * Proposals to put a supplier × material pair on the approved list or to suspend it (W04-11). Procurement
 * proposes (`masterdata.supplier.edit`); QA decides (`masterdata.supplier.approve`); the decider is never
 * the proposer (ck). The decided state is copied to `supplier_materials` (is_approved, requested_by,
 * approved_by) in the same transaction. One pending proposal per pair. History is never edited.
 */
export const supplierMaterialChanges = pgTable(
  "supplier_material_changes",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    supplierMaterialId: uuid("supplier_material_id").notNull().references(() => supplierMaterials.id),
    action: text("action").notNull(),
    status: text("status").notNull().default("pending"),
    proposedBy: uuid("proposed_by").notNull().references(() => users.id),
    proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note").notNull(),
    auditDate: date("audit_date"),
    evidenceAttachmentId: uuid("evidence_attachment_id").references(() => fileAttachments.id),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
  },
  (t) => [
    index("ix_supplier_material_changes_pair").on(t.supplierMaterialId, t.proposedAt),
    uniqueIndex("uq_supplier_material_changes_pending").on(t.supplierMaterialId).where(sql`${t.status} = 'pending'`),
    check("ck_supplier_material_changes_action", sql`${t.action} in (${inList(SUPPLIER_MATERIAL_CHANGE_ACTIONS)})`),
    check("ck_supplier_material_changes_status", sql`${t.status} in (${inList(SUPPLIER_MATERIAL_CHANGE_STATUSES)})`),
    check("ck_supplier_material_changes_sod", sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.proposedBy}`),
    check("ck_supplier_material_changes_decided", sql`${t.status} in ('pending','withdrawn') or (${t.decidedBy} is not null and ${t.decidedAt} is not null)`),
  ],
);

/* ------------------------------------------------------------------ purchase requests (US-6-02) */

export const PURCHASE_REQUEST_STATUSES = ["draft", "submitted", "approved", "rejected", "converted", "cancelled"] as const;

export const purchaseRequests = pgTable(
  "purchase_requests",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    requestNumber: text("request_number").notNull(),
    status: text("status").notNull().default("draft"),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    neededByDate: date("needed_by_date"),
    justification: text("justification"),
    /** Estimated value (Σ line estimates) used for the approval threshold; null when no line has an estimate. */
    estimatedTotalAmount: numeric("estimated_total_amount", MONEY),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    /** The reorder suggestion this request was accepted from (W04-01), if any. */
    reorderSuggestionId: uuid("reorder_suggestion_id"),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    rejectReason: text("reject_reason"),
    cancelReason: text("cancel_reason"),
    idempotencyKey: text("idempotency_key"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").references(() => users.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_purchase_requests_number").on(t.organizationId, t.requestNumber),
    uniqueIndex("uq_purchase_requests_idem").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    index("ix_purchase_requests_site_status").on(t.siteId, t.status),
    check("ck_purchase_requests_status", sql`${t.status} in (${inList(PURCHASE_REQUEST_STATUSES)})`),
    check("ck_purchase_requests_sod", sql`${t.approvedBy} is null or (${t.approvedBy} <> ${t.requestedBy} and (${t.submittedBy} is null or ${t.approvedBy} <> ${t.submittedBy}))`),
    check("ck_purchase_requests_amount", sql`${t.estimatedTotalAmount} is null or ${t.estimatedTotalAmount} >= 0`),
  ],
);

export const purchaseRequestLines = pgTable(
  "purchase_request_lines",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    purchaseRequestId: uuid("purchase_request_id").notNull().references(() => purchaseRequests.id),
    lineNo: integer("line_no").notNull(),
    materialId: uuid("material_id").notNull().references(() => materials.id),
    qtyEntered: numeric("qty_entered", QTY).notNull(),
    uomEntered: text("uom_entered").notNull(),
    qtyBase: numeric("qty_base", QTY).notNull(),
    baseUom: text("base_uom").notNull(),
    /** Estimated price per `uom_entered` (sensitive: masterdata.supplier_price.view). */
    estimatedUnitAmount: numeric("estimated_unit_amount", MONEY),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    suggestedSupplierId: uuid("suggested_supplier_id").references(() => suppliers.id),
    note: text("note"),
    /** Set when the line was converted into a PO line (status converted). */
    convertedPoLineId: uuid("converted_po_line_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_purchase_request_lines_no").on(t.purchaseRequestId, t.lineNo),
    index("ix_purchase_request_lines_material").on(t.materialId),
    check("ck_purchase_request_lines_qty", sql`${t.qtyEntered} > 0 and ${t.qtyBase} > 0`),
    check("ck_purchase_request_lines_amount", sql`${t.estimatedUnitAmount} is null or ${t.estimatedUnitAmount} >= 0`),
  ],
);

export const purchaseRequestStateTransitions = pgTable(
  "purchase_request_state_transitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    purchaseRequestId: uuid("purchase_request_id").notNull().references(() => purchaseRequests.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    correlationId: uuid("correlation_id").notNull(),
  },
  (t) => [index("ix_purchase_request_transitions_pr").on(t.purchaseRequestId, t.occurredAt)],
);

/* ------------------------------------------------------------------ purchase orders (US-6-02, US-6-03) */

/** docs/data-model.md §6.4; transition table PO_TRANSITIONS in src/modules/procurement/po-state.ts. */
export const PURCHASE_ORDER_STATUSES = ["draft", "submitted", "approved", "sent", "partially_received", "received", "closed", "cancelled"] as const;
export const PURCHASE_ORDER_LINE_STATUSES = ["open", "received", "short_closed", "cancelled"] as const;

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    poNumber: text("po_number").notNull(),
    legacyNumber: text("legacy_number"),
    status: text("status").notNull().default("draft"),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    shipToWarehouseId: uuid("ship_to_warehouse_id").references(() => warehouses.id),
    orderDate: date("order_date").notNull(),
    /** Header expected date = the latest line expected date (lead time from the supplier-material row). */
    expectedDate: date("expected_date"),
    /** Date the supplier promised when confirming (W04-06). */
    promisedDate: date("promised_date"),
    paymentTermsDays: integer("payment_terms_days"),
    /** Money (sensitive: masterdata.supplier_price.view). Tax is entered from the supplier quotation; no tax rule is computed here. */
    subtotalAmount: numeric("subtotal_amount", MONEY).notNull().default("0"),
    taxAmount: numeric("tax_amount", MONEY).notNull().default("0"),
    totalAmount: numeric("total_amount", MONEY).notNull().default("0"),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    isUrgent: boolean("is_urgent").notNull().default(false),
    urgentReason: text("urgent_reason"),
    notes: text("notes"),
    /** Supplier's order confirmation reference (W04-06). */
    supplierReference: text("supplier_reference"),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentBy: uuid("sent_by").references(() => users.id),
    /** sent_to email and outcome of the email adapter (captured | sent | failed | not_configured | download). */
    sentTo: text("sent_to"),
    sendResult: text("send_result"),
    /** Latest generated PO document (documents module, ADR-026). */
    generatedDocumentId: uuid("generated_document_id"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id),
    closeReason: text("close_reason"),
    cancelReason: text("cancel_reason"),
    idempotencyKey: text("idempotency_key"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").references(() => users.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_purchase_orders_number").on(t.organizationId, t.poNumber),
    uniqueIndex("uq_purchase_orders_legacy").on(t.organizationId, t.legacyNumber).where(sql`${t.legacyNumber} is not null`),
    uniqueIndex("uq_purchase_orders_idem").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    index("ix_purchase_orders_site_status").on(t.siteId, t.status),
    index("ix_purchase_orders_supplier").on(t.supplierId, t.status),
    check("ck_purchase_orders_status", sql`${t.status} in (${inList(PURCHASE_ORDER_STATUSES)})`),
    check("ck_purchase_orders_amounts", sql`${t.subtotalAmount} >= 0 and ${t.taxAmount} >= 0 and ${t.totalAmount} >= 0`),
    check("ck_purchase_orders_urgent", sql`not ${t.isUrgent} or ${t.urgentReason} is not null`),
    check("ck_purchase_orders_sod", sql`${t.approvedBy} is null or (${t.approvedBy} <> ${t.createdBy} and (${t.submittedBy} is null or ${t.approvedBy} <> ${t.submittedBy}))`),
    check("ck_purchase_orders_sent", sql`${t.status} not in ('sent','partially_received','received','closed') or (${t.sentAt} is not null and ${t.sentBy} is not null)`),
    check("ck_purchase_orders_terms", sql`${t.paymentTermsDays} is null or ${t.paymentTermsDays} >= 0`),
  ],
);

/**
 * PO lines. `qty_entered`/`uom_entered` are the ordered quantity in the purchase unit, `qty_base`/`base_uom`
 * the same in the material's base unit (ADR-010). `unit_amount` is the price per `uom_entered`;
 * `line_amount` = qty_entered × unit_amount (rounded to 4 places). `qty_received_base` is a projection of
 * posted receipt lines (receiving posts and reversals keep it in step, row-locked).
 */
export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id),
    lineNo: integer("line_no").notNull(),
    materialId: uuid("material_id").notNull().references(() => materials.id),
    supplierMaterialId: uuid("supplier_material_id").references(() => supplierMaterials.id),
    purchaseRequestLineId: uuid("purchase_request_line_id").references(() => purchaseRequestLines.id),
    qtyEntered: numeric("qty_entered", QTY).notNull(),
    uomEntered: text("uom_entered").notNull(),
    qtyBase: numeric("qty_base", QTY).notNull(),
    baseUom: text("base_uom").notNull(),
    unitAmount: numeric("unit_amount", MONEY).notNull(),
    lineAmount: numeric("line_amount", MONEY).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    expectedDate: date("expected_date"),
    qtyReceivedBase: numeric("qty_received_base", QTY).notNull().default("0"),
    lineStatus: text("line_status").notNull().default("open"),
    shortClosedAt: timestamp("short_closed_at", { withTimezone: true }),
    shortClosedBy: uuid("short_closed_by").references(() => users.id),
    shortCloseReason: text("short_close_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_purchase_order_lines_no").on(t.purchaseOrderId, t.lineNo),
    index("ix_purchase_order_lines_material").on(t.materialId, t.lineStatus),
    check("ck_purchase_order_lines_qty", sql`${t.qtyEntered} > 0 and ${t.qtyBase} > 0 and ${t.qtyReceivedBase} >= 0`),
    check("ck_purchase_order_lines_amount", sql`${t.unitAmount} >= 0 and ${t.lineAmount} >= 0`),
    check("ck_purchase_order_lines_status", sql`${t.lineStatus} in (${inList(PURCHASE_ORDER_LINE_STATUSES)})`),
    check("ck_purchase_order_lines_short", sql`${t.lineStatus} <> 'short_closed' or (${t.shortCloseReason} is not null and ${t.shortClosedBy} is not null)`),
  ],
);

export const purchaseOrderStateTransitions = pgTable(
  "purchase_order_state_transitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    correlationId: uuid("correlation_id").notNull(),
  },
  (t) => [index("ix_purchase_order_transitions_po").on(t.purchaseOrderId, t.occurredAt)],
);

/* ------------------------------------------------------------------ supplier returns (US-6-21) */

export const SUPPLIER_RETURN_STATUSES = ["draft", "submitted", "approved", "posted", "cancelled"] as const;

export const supplierReturns = pgTable(
  "supplier_returns",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    returnNumber: text("return_number").notNull(),
    status: text("status").notNull().default("draft"),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    goodsReceiptId: uuid("goods_receipt_id").references(() => goodsReceipts.id),
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id),
    /** Reason code of category `return` (masterdata reason codes, US-1-24). */
    reasonCode: text("reason_code").notNull(),
    reasonNote: text("reason_note"),
    supplierRmaReference: text("supplier_rma_reference"),
    /** Σ credit_expected_amount of the lines (approval basis `amount`); feeds the supplier bill dispute (W4B). */
    creditExpectedAmount: numeric("credit_expected_amount", MONEY),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: uuid("posted_by").references(() => users.id),
    cancelReason: text("cancel_reason"),
    idempotencyKey: text("idempotency_key"),
    postIdempotencyKey: text("post_idempotency_key"),
    correlationId: uuid("correlation_id"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").references(() => users.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_supplier_returns_number").on(t.organizationId, t.returnNumber),
    uniqueIndex("uq_supplier_returns_idem").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    uniqueIndex("uq_supplier_returns_post_idem").on(t.organizationId, t.postIdempotencyKey).where(sql`${t.postIdempotencyKey} is not null`),
    index("ix_supplier_returns_site_status").on(t.siteId, t.status),
    index("ix_supplier_returns_supplier").on(t.supplierId),
    check("ck_supplier_returns_status", sql`${t.status} in (${inList(SUPPLIER_RETURN_STATUSES)})`),
    check("ck_supplier_returns_sod", sql`${t.approvedBy} is null or (${t.approvedBy} <> ${t.createdBy} and (${t.submittedBy} is null or ${t.approvedBy} <> ${t.submittedBy}))`),
    check("ck_supplier_returns_poster", sql`${t.postedBy} is null or ${t.approvedBy} is null or ${t.postedBy} <> ${t.approvedBy}`),
    check("ck_supplier_returns_posted", sql`${t.status} <> 'posted' or (${t.postedAt} is not null and ${t.postedBy} is not null and ${t.approvedBy} is not null)`),
  ],
);

export const supplierReturnLines = pgTable(
  "supplier_return_lines",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    supplierReturnId: uuid("supplier_return_id").notNull().references(() => supplierReturns.id),
    lineNo: integer("line_no").notNull(),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    containerId: uuid("container_id").references(() => containers.id),
    fromLocationId: uuid("from_location_id").notNull().references(() => locations.id),
    qtyEntered: numeric("qty_entered", QTY).notNull(),
    uomEntered: text("uom_entered").notNull(),
    qtyBase: numeric("qty_base", QTY).notNull(),
    baseUom: text("base_uom").notNull(),
    creditExpectedAmount: numeric("credit_expected_amount", MONEY),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    stockMovementId: uuid("stock_movement_id").references(() => stockMovements.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_supplier_return_lines_no").on(t.supplierReturnId, t.lineNo),
    index("ix_supplier_return_lines_lot").on(t.lotId),
    check("ck_supplier_return_lines_qty", sql`${t.qtyEntered} > 0 and ${t.qtyBase} > 0`),
    check("ck_supplier_return_lines_amount", sql`${t.creditExpectedAmount} is null or ${t.creditExpectedAmount} >= 0`),
  ],
);

export const supplierReturnStateTransitions = pgTable(
  "supplier_return_state_transitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    supplierReturnId: uuid("supplier_return_id").notNull().references(() => supplierReturns.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    correlationId: uuid("correlation_id").notNull(),
  },
  (t) => [index("ix_supplier_return_transitions_sr").on(t.supplierReturnId, t.occurredAt)],
);

/* ------------------------------------------------------------------ reorder suggestions (US-6-04) */

/**
 * Per site × material reorder policy (W04-01 drivers). Values are configuration entered by procurement
 * (assumption A-W4A-05); a material without a policy gets no suggestion.
 */
export const materialReorderPolicies = pgTable(
  "material_reorder_policies",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    materialId: uuid("material_id").notNull().references(() => materials.id),
    /** Reorder point in base units: a suggestion is made when the projected stock falls below it. */
    minStockBase: numeric("min_stock_base", QTY).notNull(),
    safetyStockBase: numeric("safety_stock_base", QTY).notNull().default("0"),
    preferredSupplierId: uuid("preferred_supplier_id").references(() => suppliers.id),
    isActive: boolean("is_active").notNull().default(true),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_material_reorder_policies").on(t.siteId, t.materialId),
    check("ck_material_reorder_policies_qty", sql`${t.minStockBase} >= 0 and ${t.safetyStockBase} >= 0`),
  ],
);

export const REORDER_SUGGESTION_STATUSES = ["open", "accepted", "dismissed", "superseded"] as const;

/** docs/data-model.md §3.4 `reorder_suggestions`: persisted output of job procurement.reorder_suggest; never orders anything. */
export const reorderSuggestions = pgTable(
  "reorder_suggestions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    materialId: uuid("material_id").notNull().references(() => materials.id),
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    suggestedQtyBase: numeric("suggested_qty_base", QTY).notNull(),
    baseUom: text("base_uom").notNull(),
    onHandBase: numeric("on_hand_base", QTY),
    reservedBase: numeric("reserved_base", QTY),
    openPoQtyBase: numeric("open_po_qty_base", QTY),
    forecastQtyBase: numeric("forecast_qty_base", QTY),
    minStockBase: numeric("min_stock_base", QTY),
    safetyStockBase: numeric("safety_stock_base", QTY),
    expiryRiskQtyBase: numeric("expiry_risk_qty_base", QTY),
    moqBase: numeric("moq_base", QTY),
    leadTimeDays: integer("lead_time_days"),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    needByDate: date("need_by_date"),
    explanation: text("explanation").notNull(),
    status: text("status").notNull().default("open"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    purchaseRequestId: uuid("purchase_request_id").references(() => purchaseRequests.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("ix_reorder_suggestions_site_status").on(t.siteId, t.status),
    uniqueIndex("uq_reorder_suggestions_open").on(t.siteId, t.materialId).where(sql`${t.status} = 'open'`),
    check("ck_reorder_suggestions_qty", sql`${t.suggestedQtyBase} > 0`),
    check("ck_reorder_suggestions_status", sql`${t.status} in (${inList(REORDER_SUGGESTION_STATUSES)})`),
    check("ck_reorder_suggestions_reviewed", sql`${t.status} not in ('accepted','dismissed') or (${t.reviewedBy} is not null and ${t.reviewNote} is not null)`),
  ],
);

/* ------------------------------------------------------------------ forecast overrides (US-6-20) */

export const FORECAST_OVERRIDE_STATUSES = ["submitted", "approved", "rejected", "retired"] as const;

/**
 * docs/analytics-kpis.md §6.4 `forecast_overrides` (SKU = a `products` row in this build). An override is
 * submitted with a reason, stays `submitted` until a different user approves it, and never replaces the
 * stored baseline: `baseline_qty_base` keeps the forecast it overrides. At most one approved override per
 * product × site × period.
 */
export const forecastOverrides = pgTable(
  "forecast_overrides",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    baselineQtyBase: numeric("baseline_qty_base", QTY),
    baselineMethod: text("baseline_method"),
    overrideQtyBase: numeric("override_qty_base", QTY).notNull(),
    baseUom: text("base_uom").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("submitted"),
    /** Inputs shown when the override was entered (method, history length, metrics), schema forecast_snapshot/v1. */
    baselineSnapshot: jsonb("baseline_snapshot").$type<Record<string, unknown>>(),
    submittedBy: uuid("submitted_by").notNull().references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("ix_forecast_overrides_product").on(t.siteId, t.productId, t.periodStart),
    uniqueIndex("uq_forecast_overrides_approved").on(t.siteId, t.productId, t.periodStart).where(sql`${t.status} = 'approved'`),
    check("ck_forecast_overrides_status", sql`${t.status} in (${inList(FORECAST_OVERRIDE_STATUSES)})`),
    check("ck_forecast_overrides_qty", sql`${t.overrideQtyBase} >= 0`),
    check("ck_forecast_overrides_period", sql`${t.periodEnd} > ${t.periodStart}`),
  ],
);

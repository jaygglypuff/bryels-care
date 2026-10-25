import { boolean, char, check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { MONEY, QTY, createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";
import { locations, materials } from "./masterdata";
import { inventoryLots, stockMovements } from "./inventory";
import { fileAttachments } from "./files";
import { purchaseOrderLines, purchaseOrders } from "./procurement"; // Wave 4 W4A (lazy FK references only)

/* ------------------------------------------------------------------ suppliers (US-2-06) */

/**
 * Supplier master (organization-wide, docs/data-model.md §3.2).
 * qualityStatus: new | approved | conditional | suspended. A suspended supplier blocks receipt lines (V-ASL)
 * until procurement or qa_qc changes the status.
 */
export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    legacyNumber: text("legacy_number"),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    addressLine1: text("address_line1"),
    city: text("city"),
    country: text("country"),
    paymentTermsDays: integer("payment_terms_days"),
    defaultLeadTimeDays: integer("default_lead_time_days"),
    qualityStatus: text("quality_status").notNull().default("new"),
    qualityStatusReason: text("quality_status_reason"),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: createdAt(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
  },
  (t) => [
    uniqueIndex("uq_suppliers_org_code").on(t.organizationId, t.code),
    uniqueIndex("uq_suppliers_org_name").on(t.organizationId, sql`lower(${t.name})`),
    check("ck_suppliers_quality_status", sql`${t.qualityStatus} in ('new','approved','conditional','suspended')`),
    check("ck_suppliers_terms", sql`${t.paymentTermsDays} is null or ${t.paymentTermsDays} >= 0`),
    check("ck_suppliers_lead_time", sql`${t.defaultLeadTimeDays} is null or ${t.defaultLeadTimeDays} >= 0`),
  ],
);

/** Approved-supplier list rows. Created in Phase 2; the approval flow (masterdata.supplier.approve) is Phase 6. */
export const supplierMaterials = pgTable(
  "supplier_materials",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    materialId: uuid("material_id").notNull().references(() => materials.id),
    supplierPartNumber: text("supplier_part_number"),
    isApproved: boolean("is_approved").notNull().default(false),
    leadTimeDays: integer("lead_time_days"),
    createdAt: createdAt(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    updatedAt: updatedAt(),
    // Wave 4 W4A (US-6-01, W04-11): ASL decision columns (decided state; proposals in supplier_material_changes),
    // MOQ, price (sensitive: masterdata.supplier_price.view) per `price_uom`.
    requestedBy: uuid("requested_by").references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    auditDate: date("audit_date"),
    evidenceAttachmentId: uuid("evidence_attachment_id").references(() => fileAttachments.id),
    suspendedReason: text("suspended_reason"),
    moqQty: numeric("moq_qty", QTY),
    moqUom: text("moq_uom"),
    unitPrice: numeric("unit_price", MONEY),
    priceUom: text("price_uom"),
    currency: char("currency", { length: 3 }),
    priceEffectiveFrom: date("price_effective_from"),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("uq_supplier_materials_pair").on(t.supplierId, t.materialId),
    index("ix_supplier_materials_material").on(t.materialId),
    check("ck_supplier_materials_requested", sql`(${t.requestedBy} is null) = (${t.requestedAt} is null)`),
    check("ck_supplier_materials_sod", sql`${t.approvedBy} is null or ${t.requestedBy} is null or ${t.approvedBy} <> ${t.requestedBy}`),
    check("ck_supplier_materials_moq", sql`${t.moqQty} is null or (${t.moqQty} > 0 and ${t.moqUom} is not null)`),
    check("ck_supplier_materials_price", sql`${t.unitPrice} is null or (${t.unitPrice} >= 0 and ${t.priceUom} is not null and ${t.currency} is not null)`),
    check("ck_supplier_materials_lead_time", sql`${t.leadTimeDays} is null or ${t.leadTimeDays} >= 0`),
  ],
);

/* ------------------------------------------------------------------ goods receipts (US-2-07) */

/**
 * Goods receipt header. status: draft → posted → reversed; draft → cancelled (state machine in
 * src/modules/inventory/receiving-state.ts). Stock and lots exist only once posted. The number (rule GR)
 * is allocated in the posting transaction; drafts are identified by their UUID (data-model §9.3).
 * supplierName is the name as delivered; supplierId links the supplier master when it is known.
 */
export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    receiptNumber: text("receipt_number"),
    /** unplanned | purchase_order | opening_balance */
    receiptKind: text("receipt_kind").notNull().default("unplanned"),
    status: text("status").notNull().default("draft"),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    supplierName: text("supplier_name").notNull(),
    supplierDocumentNumber: text("supplier_document_number"),
    /** Reason code for an unplanned receipt (A-PROC-26). */
    unplannedReasonCode: text("unplanned_reason_code"),
    receivedBy: uuid("received_by").notNull().references(() => users.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    /** Client UUID of the create (or receive-and-post) command; a repeat returns this receipt. */
    idempotencyKey: text("idempotency_key"),
    correlationId: uuid("correlation_id"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: uuid("posted_by").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelReason: text("cancel_reason"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id),
    reversalReason: text("reversal_reason"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Wave 4 W4A (US-6-03): the purchase order delivered against (receipt_kind purchase_order). */
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id),
  },
  (t) => [
    index("ix_goods_receipts_po").on(t.purchaseOrderId),
    check("ck_goods_receipts_po_kind", sql`(${t.receiptKind} = 'purchase_order') = (${t.purchaseOrderId} is not null)`),
    uniqueIndex("uq_goods_receipts_org_number").on(t.organizationId, t.receiptNumber),
    uniqueIndex("uq_goods_receipts_org_idem").on(t.organizationId, t.idempotencyKey),
    index("ix_goods_receipts_site_status").on(t.siteId, t.status),
    index("ix_goods_receipts_supplier").on(t.supplierId),
    check("ck_goods_receipts_status", sql`${t.status} in ('draft','posted','cancelled','reversed')`),
    check("ck_goods_receipts_kind", sql`${t.receiptKind} in ('unplanned','purchase_order','opening_balance')`),
    check("ck_goods_receipts_number", sql`${t.status} in ('draft','cancelled') or ${t.receiptNumber} is not null`),
    check("ck_goods_receipts_posted", sql`${t.status} in ('draft','cancelled') or (${t.postedAt} is not null and ${t.postedBy} is not null)`),
    check("ck_goods_receipts_reversed", sql`${t.status} <> 'reversed' or (${t.reversedAt} is not null and ${t.reversalReason} is not null)`),
    check("ck_goods_receipts_cancelled", sql`${t.status} <> 'cancelled' or (${t.cancelledAt} is not null and ${t.cancelReason} is not null)`),
  ],
);

/**
 * One line per material delivered; posting creates one lot and one receipt movement per line.
 * qtyEntered/uomEntered are what the operator typed; qtyBase is in the material's base unit (ADR-010).
 */
export const goodsReceiptLines = pgTable(
  "goods_receipt_lines",
  {
    id: id(),
    goodsReceiptId: uuid("goods_receipt_id").notNull().references(() => goodsReceipts.id),
    lineNo: integer("line_no"),
    /** Set at posting. */
    lotId: uuid("lot_id").references(() => inventoryLots.id),
    materialId: uuid("material_id").notNull().references(() => materials.id),
    qtyEntered: numeric("qty_entered", QTY),
    uomEntered: text("uom_entered"),
    qtyBase: numeric("qty_base", QTY).notNull(),
    /** Put-away location at posting (receiving, quarantine or storage kind). */
    locationId: uuid("location_id").notNull().references(() => locations.id),
    supplierLotNumber: text("supplier_lot_number"),
    manufacturedOn: date("manufactured_on"),
    expiresOn: date("expires_on"),
    retestOn: date("retest_on"),
    containerCount: integer("container_count"),
    storageConditionsConfirmed: boolean("storage_conditions_confirmed").notNull().default(false),
    /** quarantine | released (released only when the material does not require incoming inspection). */
    initialQualityStatus: text("initial_quality_status").notNull().default("quarantine"),
    discrepancyKind: text("discrepancy_kind"),
    discrepancyNote: text("discrepancy_note"),
    discrepancyRecordedBy: uuid("discrepancy_recorded_by").references(() => users.id),
    discrepancyRecordedAt: timestamp("discrepancy_recorded_at", { withTimezone: true }),
    discrepancyApprovedBy: uuid("discrepancy_approved_by").references(() => users.id),
    discrepancyApprovedAt: timestamp("discrepancy_approved_at", { withTimezone: true }),
    discrepancyApprovalNote: text("discrepancy_approval_note"),
    /** Set at posting when the material requires a CoA and none was attached; cleared when one is attached. */
    documentMissing: boolean("document_missing").notNull().default(false),
    stockMovementId: uuid("stock_movement_id").references(() => stockMovements.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Wave 4 W4A (US-6-03): the PO line received; null = an unplanned line (also on a PO receipt). */
    purchaseOrderLineId: uuid("purchase_order_line_id").references(() => purchaseOrderLines.id),
  },
  (t) => [
    index("ix_goods_receipt_lines_po_line").on(t.purchaseOrderLineId),
    uniqueIndex("uq_goods_receipt_lines_no").on(t.goodsReceiptId, t.lineNo),
    index("ix_goods_receipt_lines_lot").on(t.lotId),
    check("ck_goods_receipt_lines_qty", sql`${t.qtyBase} > 0 and (${t.qtyEntered} is null or ${t.qtyEntered} > 0)`),
    check("ck_goods_receipt_lines_containers", sql`${t.containerCount} is null or ${t.containerCount} > 0`),
    check("ck_goods_receipt_lines_initial_status", sql`${t.initialQualityStatus} in ('quarantine','released')`),
    check(
      "ck_goods_receipt_lines_discrepancy_kind",
      sql`${t.discrepancyKind} is null or ${t.discrepancyKind} in ('short','over','damaged','wrong_item','missing_documents')`,
    ),
    check("ck_goods_receipt_lines_discrepancy_sod", sql`${t.discrepancyApprovedBy} is null or ${t.discrepancyApprovedBy} <> ${t.discrepancyRecordedBy}`),
    check("ck_goods_receipt_lines_dates", sql`${t.expiresOn} is null or ${t.manufacturedOn} is null or ${t.expiresOn} > ${t.manufacturedOn}`),
  ],
);

/* ------------------------------------------------------------------ supplier lot documents (US-2-08) */

/** CoA, SDS, specification or photo attached to a receipt line; lotId is filled when the line is posted. */
export const supplierLotDocuments = pgTable(
  "supplier_lot_documents",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    goodsReceiptLineId: uuid("goods_receipt_line_id").notNull().references(() => goodsReceiptLines.id),
    lotId: uuid("lot_id").references(() => inventoryLots.id),
    fileAttachmentId: uuid("file_attachment_id").notNull().references(() => fileAttachments.id),
    documentKind: text("document_kind").notNull(),
    documentNumber: text("document_number"),
    issuedOn: date("issued_on"),
    expiresOn: date("expires_on"),
    verifiedBy: uuid("verified_by").references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: createdAt(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
  },
  (t) => [
    uniqueIndex("uq_supplier_lot_documents_file").on(t.fileAttachmentId),
    index("ix_supplier_lot_documents_line").on(t.goodsReceiptLineId),
    index("ix_supplier_lot_documents_lot").on(t.lotId),
    check("ck_supplier_lot_documents_kind", sql`${t.documentKind} in ('coa','sds','specification','photo','other')`),
  ],
);

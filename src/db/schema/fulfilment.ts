import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { QTY, createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";
import { locations, products } from "./masterdata";
import { inventoryLots, stockMovements } from "./inventory";
import { containers } from "./containers";
import { salesOrderLines, salesOrders, shipments, stockAllocations } from "./sales";
import { documentTemplateVersions, generatedDocuments, labelTemplates } from "./documents";
import { fileAttachments } from "./files";
import { batches } from "./production";
import { batchOutputs } from "./execution";

/**
 * Wave 3 W3E: boxing and fulfilment (E-4-03, E-4-04; docs/data-model.md §3.7, docs/process-maps.md
 * W08, W09-05..10). Packs (boxing / verification sessions), pick lists and pick scans, shipment
 * lines (box → shipment, the genealogy edge to the customer), exception approvals, delivery receipts
 * and the shipment state history. Stock only moves at dispatch (`stock_movements` type shipment).
 */

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

export const PACK_STATUSES = ["open", "verified", "closed", "cancelled"] as const;
export const PACK_SOURCE_KINDS = ["batch_output", "sales_order", "repack"] as const;
export const PACK_VERIFICATION_MODES = ["all", "sample"] as const;
export const PACK_SCAN_RESULTS = ["ok", "not_in_pack", "unknown_box", "label_mismatch", "duplicate"] as const;

/**
 * A boxing / verification session (A-DM-29). `batch_output`: boxing at the end of a batch (boxes
 * inherit the lot's status, quarantine allowed); `sales_order`: packaging for an order or the pack
 * verification of a shipment (`pick_id`/`shipment_id`); `repack`: customer-specific carton count.
 * Verification by a checker who is not the packer (`checked_by <> packed_by`).
 */
export const packs = pgTable(
  "packs",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    packNumber: text("pack_number").notNull(),
    status: text("status").notNull().default("open"),
    sourceKind: text("source_kind").notNull(),
    batchId: uuid("batch_id").references(() => batches.id),
    batchOutputId: uuid("batch_output_id").references(() => batchOutputs.id),
    salesOrderId: uuid("sales_order_id").references(() => salesOrders.id),
    /** Pick and shipment of a W09-07 pack verification. */
    pickId: uuid("pick_id").references(() => picks.id),
    shipmentId: uuid("shipment_id").references(() => shipments.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    lotId: uuid("lot_id").references(() => inventoryLots.id),
    /** Where the boxes are packed (the lot's stock at this location is boxed). */
    locationId: uuid("location_id").references(() => locations.id),
    /** Approved customer requirement row the configuration came from (W3D table; no FK across streams). */
    customerRequirementId: uuid("customer_requirement_id"),
    labelTemplateId: uuid("label_template_id").references(() => labelTemplates.id),
    labelTemplateVersionId: uuid("label_template_version_id").references(() => documentTemplateVersions.id),
    unitsPerBox: integer("units_per_box").notNull(),
    expectedUnitsBase: numeric("expected_units_base", QTY),
    packedUnitsBase: numeric("packed_units_base", QTY).notNull().default("0"),
    boxCount: integer("box_count").notNull().default(0),
    /** Schema pack_config/v1: configuration frozen at start (units per box, source, marks, label template). */
    configSnapshot: jsonb("config_snapshot").notNull(),
    usedDefaultConfig: boolean("used_default_config").notNull().default(false),
    verificationMode: text("verification_mode").notNull().default("all"),
    verificationSampleSize: integer("verification_sample_size"),
    verificationFailureCount: integer("verification_failure_count").notNull().default(0),
    packedBy: uuid("packed_by").notNull().references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    checkedBy: uuid("checked_by").references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelReason: text("cancel_reason"),
    boxingNoteDocumentId: uuid("boxing_note_document_id").references(() => generatedDocuments.id),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("packs_org_number_uq").on(t.organizationId, t.packNumber),
    uniqueIndex("packs_org_idem_uq").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    /** One live verification pack per shipment. */
    uniqueIndex("packs_shipment_live_uq").on(t.shipmentId).where(sql`${t.shipmentId} is not null and ${t.status} <> 'cancelled'`),
    index("packs_site_status_idx").on(t.siteId, t.status),
    index("packs_lot_idx").on(t.lotId),
    check("ck_packs_status", sql`${t.status} in (${inList(PACK_STATUSES)})`),
    check("ck_packs_source_kind", sql`${t.sourceKind} in (${inList(PACK_SOURCE_KINDS)})`),
    check("ck_packs_verification_mode", sql`${t.verificationMode} in (${inList(PACK_VERIFICATION_MODES)})`),
    check(
      "ck_packs_source_ref",
      sql`(${t.sourceKind} <> 'batch_output' or ${t.batchOutputId} is not null) and (${t.sourceKind} <> 'sales_order' or ${t.salesOrderId} is not null)`,
    ),
    check("ck_packs_verified", sql`${t.status} not in ('verified','closed') or (${t.checkedBy} is not null and ${t.verifiedAt} is not null)`),
    check("ck_packs_cancelled", sql`${t.status} <> 'cancelled' or (${t.cancelledBy} is not null and ${t.cancelReason} is not null)`),
    check("ck_packs_units_per_box", sql`${t.unitsPerBox} > 0`),
  ],
);

export const PACK_BOX_STATUSES = ["packed", "removed", "repacked"] as const;

/** Boxes produced by a pack (one container per row), numbered 1..n within the pack. */
export const packBoxes = pgTable(
  "pack_boxes",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    packId: uuid("pack_id").notNull().references(() => packs.id),
    containerId: uuid("container_id").notNull().references(() => containers.id),
    boxNo: integer("box_no").notNull(),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    qtyBase: numeric("qty_base", QTY).notNull(),
    isPartial: boolean("is_partial").notNull().default(false),
    status: text("status").notNull().default("packed"),
    /** Repack: the box this one was repacked from (lineage is container_lineage; this is the printed summary). */
    sourceContainerIds: jsonb("source_container_ids"),
    removedReason: text("removed_reason"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("pack_boxes_pack_no_uq").on(t.packId, t.boxNo),
    uniqueIndex("pack_boxes_pack_container_uq").on(t.packId, t.containerId),
    index("pack_boxes_container_idx").on(t.containerId),
    check("ck_pack_boxes_status", sql`${t.status} in (${inList(PACK_BOX_STATUSES)})`),
    check("ck_pack_boxes_qty", sql`${t.qtyBase} > 0`),
    check("ck_pack_boxes_removed", sql`${t.status} <> 'removed' or ${t.removedReason} is not null`),
  ],
);

/** Each checker scan during verification (W08-04, W09-07); evidence, never edited. */
export const packVerificationScans = pgTable(
  "pack_verification_scans",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    packId: uuid("pack_id").notNull().references(() => packs.id),
    containerId: uuid("container_id").references(() => containers.id),
    lotId: uuid("lot_id").references(() => inventoryLots.id),
    qtyBase: numeric("qty_base", QTY),
    scanPayload: text("scan_payload").notNull(),
    scannedBy: uuid("scanned_by").notNull().references(() => users.id),
    scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
    deviceRegistrationId: uuid("device_registration_id"),
    result: text("result").notNull(),
    note: text("note"),
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    index("pack_verification_scans_pack_idx").on(t.packId, t.scannedAt),
    uniqueIndex("pack_verification_scans_idem_uq").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    check("ck_pack_verification_scans_result", sql`${t.result} in (${inList(PACK_SCAN_RESULTS)})`),
  ],
);

export const PICK_STATUSES = ["draft", "in_progress", "completed", "cancelled"] as const;

/** A pick list for one order (W09-06); its shipment is created with it in `draft`. */
export const picks = pgTable(
  "picks",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    pickNumber: text("pick_number").notNull(),
    status: text("status").notNull().default("in_progress"),
    salesOrderId: uuid("sales_order_id").notNull().references(() => salesOrders.id),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
    assignedTo: uuid("assigned_to").references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id),
    shortPickReason: text("short_pick_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelReason: text("cancel_reason"),
    idempotencyKey: text("idempotency_key"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("picks_org_number_uq").on(t.organizationId, t.pickNumber),
    uniqueIndex("picks_org_idem_uq").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    /** One open pick per order at a time. */
    uniqueIndex("picks_order_open_uq").on(t.salesOrderId).where(sql`${t.status} in ('draft','in_progress')`),
    index("picks_site_status_idx").on(t.siteId, t.status),
    check("ck_picks_status", sql`${t.status} in (${inList(PICK_STATUSES)})`),
    check("ck_picks_completed", sql`${t.status} <> 'completed' or (${t.completedAt} is not null and ${t.completedBy} is not null)`),
    check("ck_picks_cancelled", sql`${t.status} <> 'cancelled' or (${t.cancelledBy} is not null and ${t.cancelReason} is not null)`),
  ],
);

/** Each pick scan is a line; the scan payload is kept as evidence (manual entry needs a reason). */
export const pickLines = pgTable(
  "pick_lines",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    pickId: uuid("pick_id").notNull().references(() => picks.id),
    salesOrderLineId: uuid("sales_order_line_id").notNull().references(() => salesOrderLines.id),
    allocationId: uuid("allocation_id").notNull().references(() => stockAllocations.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    containerId: uuid("container_id").references(() => containers.id),
    fromLocationId: uuid("from_location_id").notNull().references(() => locations.id),
    qtyBase: numeric("qty_base", QTY).notNull(),
    baseUom: text("base_uom").notNull(),
    /** Box allocated originally when a same-lot substitute was scanned (audited). */
    substitutedForContainerId: uuid("substituted_for_container_id").references(() => containers.id),
    scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
    pickedBy: uuid("picked_by").notNull().references(() => users.id),
    scanPayload: text("scan_payload"),
    entryMode: text("entry_mode").notNull().default("scan"),
    manualEntryReason: text("manual_entry_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidReason: text("void_reason"),
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    index("pick_lines_pick_idx").on(t.pickId),
    index("pick_lines_allocation_idx").on(t.allocationId),
    uniqueIndex("pick_lines_idem_uq").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    /** A box is picked once per pick (V-DUP counts a duplicate scan once). */
    uniqueIndex("pick_lines_pick_box_uq").on(t.pickId, t.containerId).where(sql`${t.containerId} is not null and ${t.voidedAt} is null`),
    check("ck_pick_lines_qty", sql`${t.qtyBase} > 0`),
    check("ck_pick_lines_mode", sql`${t.entryMode} in ('scan','manual')`),
    check("ck_pick_lines_payload", sql`${t.scanPayload} is not null or ${t.entryMode} = 'manual'`),
    check("ck_pick_lines_manual_reason", sql`${t.entryMode} <> 'manual' or ${t.manualEntryReason} is not null`),
    check("ck_pick_lines_void", sql`(${t.voidedAt} is null) = (${t.voidReason} is null)`),
  ],
);

/**
 * What a shipment carries: one row per box (or loose quantity) and lot, built by the pack
 * verification scans. `stock_movement_id` is set by the dispatch posting; Σ qty_base equals the
 * shipment's `shipment` movements (AC-17 reconcile). The genealogy edge lot → box → shipment.
 */
export const shipmentLines = pgTable(
  "shipment_lines",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
    salesOrderLineId: uuid("sales_order_line_id").notNull().references(() => salesOrderLines.id),
    allocationId: uuid("allocation_id").references(() => stockAllocations.id),
    pickLineId: uuid("pick_line_id").references(() => pickLines.id),
    containerId: uuid("container_id").references(() => containers.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    fromLocationId: uuid("from_location_id").notNull().references(() => locations.id),
    qtyBase: numeric("qty_base", QTY).notNull(),
    baseUom: text("base_uom").notNull(),
    /** Added under an approved over-shipment exception (badge on the shipment and DR). */
    isOverShipment: boolean("is_over_shipment").notNull().default(false),
    stockMovementId: uuid("stock_movement_id").references(() => stockMovements.id),
    verifiedBy: uuid("verified_by").notNull().references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("shipment_lines_shipment_idx").on(t.shipmentId),
    index("shipment_lines_lot_idx").on(t.lotId),
    index("shipment_lines_container_idx").on(t.containerId),
    uniqueIndex("shipment_lines_box_uq").on(t.shipmentId, t.containerId).where(sql`${t.containerId} is not null`),
    uniqueIndex("shipment_lines_movement_uq").on(t.stockMovementId).where(sql`${t.stockMovementId} is not null`),
    check("ck_shipment_lines_qty", sql`${t.qtyBase} > 0`),
  ],
);

export const SHIPMENT_EXCEPTION_KINDS = ["over_shipment", "partial_shipment"] as const;

/** CX-SHIP approvals (W09-07, A-PROC-15): over-shipment or a partial shipment for a "full shipment" customer. */
export const shipmentExceptions = pgTable(
  "shipment_exceptions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
    kind: text("kind").notNull(),
    salesOrderLineId: uuid("sales_order_line_id").references(() => salesOrderLines.id),
    /** Over-shipment: the extra base quantity approved for the line. */
    extraQtyBase: numeric("extra_qty_base", QTY),
    reason: text("reason").notNull(),
    customerReference: text("customer_reference").notNull(),
    approvedBy: uuid("approved_by").notNull().references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("shipment_exceptions_shipment_idx").on(t.shipmentId),
    check("ck_shipment_exceptions_kind", sql`${t.kind} in (${inList(SHIPMENT_EXCEPTION_KINDS)})`),
    check("ck_shipment_exceptions_over", sql`${t.kind} <> 'over_shipment' or (${t.salesOrderLineId} is not null and ${t.extraQtyBase} > 0)`),
  ],
);

export const DELIVERY_RECEIPT_STATUSES = ["draft", "issued", "acknowledged", "voided"] as const;
export const ACKNOWLEDGMENT_KINDS = ["drawn", "photo", "name_only"] as const;

/**
 * The printed delivery receipt (W09-08/09). The DR number (rule DR) is allocated in the dispatch
 * transaction; a draft DR has no number and never changes stock. Acknowledgment is evidence of
 * receipt, not an electronic signature (A-RPT-14).
 */
export const deliveryReceipts = pgTable(
  "delivery_receipts",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
    drNumber: text("dr_number"),
    status: text("status").notNull().default("draft"),
    legacyNumber: text("legacy_number"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    issuedBy: uuid("issued_by").references(() => users.id),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    receivedByName: text("received_by_name"),
    receivedByPosition: text("received_by_position"),
    remarks: text("remarks"),
    acknowledgmentKind: text("acknowledgment_kind"),
    signatureAttachmentId: uuid("signature_attachment_id").references(() => fileAttachments.id),
    acknowledgedByUserId: uuid("acknowledged_by_user_id").references(() => users.id),
    generatedDocumentId: uuid("generated_document_id").references(() => generatedDocuments.id),
    copiesPrinted: integer("copies_printed").notNull().default(0),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidReason: text("void_reason"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("delivery_receipts_org_number_uq").on(t.organizationId, t.drNumber).where(sql`${t.drNumber} is not null`),
    uniqueIndex("delivery_receipts_org_legacy_uq").on(t.organizationId, t.legacyNumber).where(sql`${t.legacyNumber} is not null`),
    /** One live DR per shipment. */
    uniqueIndex("delivery_receipts_shipment_live_uq").on(t.shipmentId).where(sql`${t.status} <> 'voided'`),
    index("delivery_receipts_site_status_idx").on(t.siteId, t.status),
    check("ck_delivery_receipts_status", sql`${t.status} in (${inList(DELIVERY_RECEIPT_STATUSES)})`),
    check("ck_delivery_receipts_kind", sql`${t.acknowledgmentKind} is null or ${t.acknowledgmentKind} in (${inList(ACKNOWLEDGMENT_KINDS)})`),
    check("ck_delivery_receipts_issued", sql`${t.status} not in ('issued','acknowledged') or (${t.drNumber} is not null and ${t.issuedAt} is not null)`),
    check(
      "ck_delivery_receipts_ack",
      sql`${t.status} <> 'acknowledged' or (${t.acknowledgedAt} is not null and ${t.receivedByName} is not null and ${t.acknowledgmentKind} is not null and ${t.acknowledgedByUserId} is not null)`,
    ),
    check("ck_delivery_receipts_ack_image", sql`${t.acknowledgmentKind} is null or ${t.acknowledgmentKind} = 'name_only' or ${t.signatureAttachmentId} is not null`),
    check("ck_delivery_receipts_void", sql`${t.status} <> 'voided' or (${t.voidedAt} is not null and ${t.voidedBy} is not null and ${t.voidReason} is not null)`),
  ],
);

/** Shipment state history (docs/data-model.md §6.1 shape), one row per transition. */
export const shipmentStateTransitions = pgTable(
  "shipment_state_transitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    reason: text("reason"),
    correlationId: uuid("correlation_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shipment_state_transitions_shipment_idx").on(t.shipmentId, t.at)],
);

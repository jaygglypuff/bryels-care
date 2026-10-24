/**
 * Batch execution records (Wave 2 stream W2B; backlog E-3-04, US-3-09..13; docs/data-model.md §3.5,
 * §5.7; docs/process-maps.md W05-06..17). The batch header, ingredient lines, dispense records and
 * the step records themselves live in ./production.ts.
 *
 * - process_step_checklist_results: line-clearance answers (one current answer per item; a new
 *   answer supersedes, never overwrites).
 * - process_step_readings: process parameters against the frozen routing limits (append-only;
 *   corrections supersede).
 * - equipment_uses: which equipment a step used, with the availability evidence at the time and the
 *   CX-CAL override when one was needed (W13-03/04).
 * - packaging_reconciliations: packaging component issued − used − damaged − returned (W05-15).
 * - yield_records, scrap_rework_records: W05-16.
 * - batch_outputs, production_postings: W05-17; every stock change of a batch is a
 *   production_postings row 1:1 with a stock_movements row posted through postMovement.
 *
 * Limits, tolerances and thresholds are configuration approved by the company's process owners
 * and QA; nothing here asserts a quality rule.
 */
import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { QTY, createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";
import { locations, materials, products } from "./masterdata";
import { equipment, equipmentOverrideRequests, routingStepChecklistItems, routingStepParameters } from "./engineering";
import { inventoryLots, stockMovements } from "./inventory";
import { batchMaterials, batches, dispenseRecords, processStepRecords } from "./production";
import { fileAttachments } from "./files";

/* ------------------------------------------------------------------ line clearance (US-3-09) */

export const processStepChecklistResults = pgTable(
  "process_step_checklist_results",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    processStepRecordId: uuid("process_step_record_id").notNull().references(() => processStepRecords.id),
    routingStepChecklistItemId: uuid("routing_step_checklist_item_id").notNull().references(() => routingStepChecklistItems.id),
    /** Snapshot of the item as answered (the routing revision is frozen, this keeps the record self-contained). */
    itemNo: integer("item_no").notNull(),
    itemText: text("item_text").notNull(),
    isBlocking: boolean("is_blocking").notNull(),
    /** yes | no | na */
    answer: text("answer").notNull(),
    note: text("note"),
    photoAttachmentId: uuid("photo_attachment_id").references(() => fileAttachments.id),
    answeredBy: uuid("answered_by").notNull().references(() => users.id),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
    /** The earlier answer this one replaces (a "no" resolved after cleaning, a correction). */
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => processStepChecklistResults.id),
  },
  (t) => [
    index("checklist_results_record_idx").on(t.processStepRecordId),
    uniqueIndex("checklist_results_supersedes_uq").on(t.supersedesId).where(sql`${t.supersedesId} is not null`),
    check("checklist_results_answer_ck", sql`${t.answer} in ('yes', 'no', 'na')`),
    check("checklist_results_no_note_ck", sql`${t.answer} <> 'no' or ${t.note} is not null`),
  ],
);

/* ------------------------------------------------------------------ process readings (US-3-11) */

export const processStepReadings = pgTable(
  "process_step_readings",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    processStepRecordId: uuid("process_step_record_id").notNull().references(() => processStepRecords.id),
    routingStepParameterId: uuid("routing_step_parameter_id").notNull().references(() => routingStepParameters.id),
    /** Snapshot of the parameter definition used for the evaluation. */
    parameterCode: text("parameter_code").notNull(),
    parameterName: text("parameter_name").notNull(),
    valueKind: text("value_kind").notNull(),
    uom: text("uom"),
    minValue: numeric("min_value", QTY),
    targetValue: numeric("target_value", QTY),
    maxValue: numeric("max_value", QTY),
    valueNumeric: numeric("value_numeric", QTY),
    valueText: text("value_text"),
    valueBoolean: boolean("value_boolean"),
    /** Evaluated at save against the frozen limits; false blocks the step until CX-TOL with a deviation. */
    isWithinLimits: boolean("is_within_limits").notNull(),
    equipmentId: uuid("equipment_id").references(() => equipment.id),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => processStepReadings.id),
    correctionReason: text("correction_reason"),
  },
  (t) => [
    index("step_readings_record_idx").on(t.processStepRecordId),
    uniqueIndex("step_readings_supersedes_uq").on(t.supersedesId).where(sql`${t.supersedesId} is not null`),
    check("step_readings_one_value_ck", sql`num_nonnulls(${t.valueNumeric}, ${t.valueText}, ${t.valueBoolean}) = 1`),
    check("step_readings_kind_ck", sql`${t.valueKind} in ('numeric', 'text', 'boolean')`),
    check("step_readings_correction_ck", sql`${t.supersedesId} is null or ${t.correctionReason} is not null`),
  ],
);

/* ------------------------------------------------------------------ equipment use (W13-03/04) */

export const equipmentUses = pgTable(
  "equipment_uses",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    batchId: uuid("batch_id").notNull().references(() => batches.id),
    equipmentId: uuid("equipment_id").notNull().references(() => equipment.id),
    processStepRecordId: uuid("process_step_record_id").references(() => processStepRecords.id),
    operatorId: uuid("operator_id").notNull().references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Evidence snapshot at selection. */
    statusAtStart: text("status_at_start").notNull(),
    cleaningStatusAtStart: text("cleaning_status_at_start").notNull(),
    calibrationDueDateAtUse: date("calibration_due_date_at_use"),
    maintenanceDueDateAtUse: date("maintenance_due_date_at_use"),
    /** Reasons present when the equipment was not fully available (warnings or blocking reasons). */
    availabilityReasons: text("availability_reasons").array(),
    /** CX-CAL: the approved, unexpired override request that allowed the use. */
    overrideRequestId: uuid("override_request_id").references(() => equipmentOverrideRequests.id),
    exceptionApprovedBy: uuid("exception_approved_by").references(() => users.id),
    exceptionReason: text("exception_reason"),
    deviationId: uuid("deviation_id"),
  },
  (t) => [
    index("equipment_uses_batch_idx").on(t.batchId),
    index("equipment_uses_equipment_idx").on(t.equipmentId, t.startedAt),
    uniqueIndex("equipment_uses_open_uq").on(t.equipmentId, t.processStepRecordId).where(sql`${t.endedAt} is null`),
    check("equipment_uses_range_ck", sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
    check("equipment_uses_override_ck", sql`(${t.overrideRequestId} is null) = (${t.exceptionApprovedBy} is null) and (${t.exceptionApprovedBy} is null or ${t.exceptionReason} is not null)`),
  ],
);

/* ------------------------------------------------------------------ packaging (US-3-12) */

export const packagingReconciliations = pgTable(
  "packaging_reconciliations",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    batchId: uuid("batch_id").notNull().references(() => batches.id),
    processStepRecordId: uuid("process_step_record_id").notNull().references(() => processStepRecords.id),
    materialId: uuid("material_id").notNull().references(() => materials.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    fromLocationId: uuid("from_location_id").notNull().references(() => locations.id),
    baseUom: text("base_uom").notNull(),
    issuedQty: numeric("issued_qty", QTY).notNull(),
    usedQty: numeric("used_qty", QTY),
    damagedQty: numeric("damaged_qty", QTY),
    returnedQty: numeric("returned_qty", QTY),
    /** issued − used − damaged − returned, set when counted. */
    varianceQty: numeric("variance_qty", QTY),
    /** Allowed |variance| for this component (setting production.packaging.reconciliation_tolerance). */
    toleranceQty: numeric("tolerance_qty", QTY),
    isWithinTolerance: boolean("is_within_tolerance"),
    issuedBy: uuid("issued_by").notNull().references(() => users.id),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    countedBy: uuid("counted_by").references(() => users.id),
    countedAt: timestamp("counted_at", { withTimezone: true }),
    /** A recount replaces the earlier count. */
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => packagingReconciliations.id),
    correctionReason: text("correction_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    productionPostingId: uuid("production_posting_id"),
    deviationId: uuid("deviation_id"),
  },
  (t) => [
    index("packaging_reconciliations_batch_idx").on(t.batchId),
    uniqueIndex("packaging_reconciliations_supersedes_uq").on(t.supersedesId).where(sql`${t.supersedesId} is not null`),
    check("packaging_reconciliations_issued_ck", sql`${t.issuedQty} > 0`),
    check("packaging_reconciliations_nonneg_ck", sql`coalesce(${t.usedQty}, 0) >= 0 and coalesce(${t.damagedQty}, 0) >= 0 and coalesce(${t.returnedQty}, 0) >= 0`),
    check("packaging_reconciliations_returned_ck", sql`coalesce(${t.returnedQty}, 0) <= ${t.issuedQty}`),
    check("packaging_reconciliations_correction_ck", sql`${t.supersedesId} is null or ${t.correctionReason} is not null`),
  ],
);

/* ------------------------------------------------------------------ yield, scrap, rework (US-3-13) */

export const yieldRecords = pgTable(
  "yield_records",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    batchId: uuid("batch_id").notNull().references(() => batches.id),
    /** Expected output mass (g) frozen on the batch (batches.theoretical_yield_g). */
    theoreticalBase: numeric("theoretical_base", QTY).notNull(),
    /** Actual good output mass (g): units × product net mass. */
    actualBase: numeric("actual_base", QTY).notNull(),
    actualUnits: numeric("actual_units", QTY).notNull(),
    varianceBase: numeric("variance_base", QTY).notNull(),
    yieldPct: numeric("yield_pct", QTY).notNull(),
    variancePct: numeric("variance_pct", QTY).notNull(),
    /** Configured range at the time (setting production.yield.limits_pct). */
    minPct: numeric("min_pct", QTY).notNull(),
    maxPct: numeric("max_pct", QTY).notNull(),
    isWithinLimits: boolean("is_within_limits").notNull(),
    labelsIssued: integer("labels_issued"),
    labelsUsed: integer("labels_used"),
    labelsDestroyed: integer("labels_destroyed"),
    notes: text("notes"),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    /** Outside the range: approval (production.yield_record.approve, ≠ recorder) with a deviation. */
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalReason: text("approval_reason"),
    deviationId: uuid("deviation_id"),
    /** One current record per batch; a correction supersedes (the old row stays, is_current false). */
    isCurrent: boolean("is_current").notNull().default(true),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => yieldRecords.id),
    correctionReason: text("correction_reason"),
  },
  (t) => [
    uniqueIndex("yield_records_current_uq").on(t.batchId).where(sql`${t.isCurrent}`),
    check("yield_records_sod_ck", sql`${t.approvedBy} is null or ${t.approvedBy} <> ${t.recordedBy}`),
    check("yield_records_correction_ck", sql`${t.supersedesId} is null or ${t.correctionReason} is not null`),
    check("yield_records_labels_ck", sql`${t.labelsIssued} is null or coalesce(${t.labelsUsed}, 0) + coalesce(${t.labelsDestroyed}, 0) <= ${t.labelsIssued}`),
  ],
);

export const scrapReworkRecords = pgTable(
  "scrap_rework_records",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    batchId: uuid("batch_id").notNull().references(() => batches.id),
    /** scrap | rework */
    recordKind: text("record_kind").notNull(),
    /** Reason code from setting production.scrap_rework.reason_codes. */
    reasonCode: text("reason_code").notNull(),
    qty: numeric("qty", QTY).notNull(),
    uom: text("uom").notNull(),
    note: text("note"),
    /** recorded | approved | rejected (approval needed above the configured threshold) */
    status: text("status").notNull().default("recorded"),
    requiresApproval: boolean("requires_approval").notNull(),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    productionPostingId: uuid("production_posting_id"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
  },
  (t) => [
    index("scrap_rework_batch_idx").on(t.batchId),
    check("scrap_rework_kind_ck", sql`${t.recordKind} in ('scrap', 'rework')`),
    check("scrap_rework_status_ck", sql`${t.status} in ('recorded', 'approved', 'rejected')`),
    check("scrap_rework_qty_ck", sql`${t.qty} > 0`),
    check("scrap_rework_sod_ck", sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.recordedBy}`),
  ],
);

/* ------------------------------------------------------------------ outputs and postings (W05-17) */

export const batchOutputs = pgTable(
  "batch_outputs",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    batchId: uuid("batch_id").notNull().references(() => batches.id),
    lineNo: integer("line_no").notNull(),
    /** finished | intermediate | by_product | sample */
    outputKind: text("output_kind").notNull(),
    productId: uuid("product_id").references(() => products.id),
    materialId: uuid("material_id").references(() => materials.id),
    qtyBase: numeric("qty_base", QTY).notNull(),
    baseUom: text("base_uom").notNull(),
    /** Equivalent mass (g) for yield, when the output is counted in units. */
    massG: numeric("mass_g", QTY),
    toLocationId: uuid("to_location_id").notNull().references(() => locations.id),
    lotId: uuid("lot_id").references(() => inventoryLots.id),
    productionPostingId: uuid("production_posting_id"),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    checkedBy: uuid("checked_by").references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("batch_outputs_line_uq").on(t.batchId, t.lineNo),
    check("batch_outputs_kind_ck", sql`${t.outputKind} in ('finished', 'intermediate', 'by_product', 'sample')`),
    check("batch_outputs_item_ck", sql`num_nonnulls(${t.productId}, ${t.materialId}) = 1`),
    check("batch_outputs_qty_ck", sql`${t.qtyBase} > 0`),
    check("batch_outputs_sod_ck", sql`${t.checkedBy} is null or ${t.checkedBy} <> ${t.recordedBy}`),
  ],
);

/**
 * Batch-side ledger (docs/data-model.md §5.7): one consumption/output/scrap/reversal event of a
 * batch, 1:1 with a stock_movements row. Append-only (trigger in src/db/sql/w2b.sql).
 */
export const productionPostings = pgTable(
  "production_postings",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    batchId: uuid("batch_id").notNull().references(() => batches.id),
    /** consumption | output | scrap | rework_return | reversal */
    postingType: text("posting_type").notNull(),
    batchMaterialId: uuid("batch_material_id").references(() => batchMaterials.id),
    dispenseRecordId: uuid("dispense_record_id").references(() => dispenseRecords.id),
    packagingReconciliationId: uuid("packaging_reconciliation_id").references(() => packagingReconciliations.id),
    batchOutputId: uuid("batch_output_id").references(() => batchOutputs.id),
    processStepRecordId: uuid("process_step_record_id").references(() => processStepRecords.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    qtyBase: numeric("qty_base", QTY).notNull(),
    baseUom: text("base_uom").notNull(),
    stockMovementId: uuid("stock_movement_id").notNull().references(() => stockMovements.id),
    reversalOfId: uuid("reversal_of_id").references((): AnyPgColumn => productionPostings.id),
    postedBy: uuid("posted_by").notNull().references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("production_postings_movement_uq").on(t.stockMovementId),
    uniqueIndex("production_postings_reversal_uq").on(t.reversalOfId).where(sql`${t.reversalOfId} is not null`),
    index("production_postings_batch_idx").on(t.batchId, t.postingType),
    index("production_postings_lot_idx").on(t.lotId, t.postingType),
    check("production_postings_type_ck", sql`${t.postingType} in ('consumption', 'output', 'scrap', 'rework_return', 'reversal')`),
    check("production_postings_reversal_ck", sql`(${t.postingType} = 'reversal') = (${t.reversalOfId} is not null)`),
    check("production_postings_qty_ck", sql`${t.qtyBase} > 0`),
  ],
);

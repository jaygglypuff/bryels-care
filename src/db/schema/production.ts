import { type AnyPgColumn, boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { QTY, createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";
import { bomLines, formulaRevisions, locations, materials, products } from "./masterdata";
import { equipment, inspectionPlans, routingRevisions, routingSteps } from "./engineering";
import { inventoryLots } from "./inventory";

/**
 * Batch = execution record with a BMR.
 * status: draft → planned → materials_staged → in_process → awaiting_qc → quarantined →
 *         released | rejected | rework_approved → closed
 */
export const batches = pgTable(
  "batches",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    batchNumber: text("batch_number").notNull(),
    productId: uuid("product_id").notNull().references(() => products.id),
    formulaRevisionId: uuid("formula_revision_id").notNull().references(() => formulaRevisions.id),
    /** Approved routing revision effective on the planned start date, frozen at creation (W1D). */
    routingRevisionId: uuid("routing_revision_id").notNull().references(() => routingRevisions.id),
    /** Finished-product inspection plan effective at creation, when one exists (W1D). */
    inspectionPlanId: uuid("inspection_plan_id").references(() => inspectionPlans.id),
    /** Frozen copy of formula header, BOM lines, routing steps and plan refs at creation (batch snapshot rule). */
    formulaSnapshot: jsonb("formula_snapshot").notNull(),
    plannedSizeG: numeric("planned_size_g", QTY).notNull(),
    status: text("status").notNull().default("planned"),
    plannedStartOn: text("planned_start_on"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    actualOutputG: numeric("actual_output_g", QTY),
    actualUnits: numeric("actual_units", QTY),
    theoreticalYieldG: numeric("theoretical_yield_g", QTY),
    yieldPct: numeric("yield_pct", QTY),
    outputLotId: uuid("output_lot_id"),
    remarks: text("remarks"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("batches_site_status_idx").on(t.siteId, t.status)],
);

export const batchStateTransitions = pgTable("batch_state_transitions", {
  id: id(),
  batchId: uuid("batch_id").notNull().references(() => batches.id),
  fromState: text("from_state"),
  toState: text("to_state").notNull(),
  actorId: uuid("actor_id").notNull().references(() => users.id),
  reason: text("reason"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

/** Scaled ingredient requirement per batch, from the snapshot. */
export const batchMaterials = pgTable("batch_materials", {
  id: id(),
  batchId: uuid("batch_id").notNull().references(() => batches.id),
  bomLineId: uuid("bom_line_id").notNull().references(() => bomLines.id),
  lineNo: integer("line_no").notNull(),
  materialId: uuid("material_id").notNull().references(() => materials.id),
  theoreticalQtyG: numeric("theoretical_qty_g", QTY).notNull(),
  /** For an absolute-tolerance BOM line this is the equivalent percentage, for display only. */
  tolerancePct: numeric("tolerance_pct", QTY).notNull(),
  /** Absolute tolerance in g when the BOM line defines one; takes precedence over tolerancePct. */
  toleranceAbsG: numeric("tolerance_abs_g", QTY),
  dispensedQtyG: numeric("dispensed_qty_g", QTY).notNull().default("0"),
  /**
   * pending | partial | dispensed | exception (W2B, US-3-10). `partial` = one or more weighings
   * from split lots, total still below the tolerance window; `dispensed` = total within tolerance
   * (data-model "complete"); `exception` = accepted outside tolerance under CX-TOL.
   */
  status: text("status").notNull().default("pending"),
});

/**
 * One weighing: operator weighs, a different checker verifies (W05-07/08; US-3-10). Rows are never
 * edited after the check: a correction voids the row with a reason and a new row supersedes it.
 * checker_id is null until the checker signs (on the device with their own password, or from
 * their own session); the CHECK makes the operator unable to check their own weighing.
 */
export const dispenseRecords = pgTable(
  "dispense_records",
  {
    id: id(),
    batchMaterialId: uuid("batch_material_id").notNull().references(() => batchMaterials.id),
    /** Order of weighings of one ingredient line (split lots, re-weighs after a void). */
    sequence: integer("sequence").notNull().default(1),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    fromLocationId: uuid("from_location_id").notNull().references(() => locations.id),
    /** Net quantity in the material base unit (g). */
    actualQtyG: numeric("actual_qty_g", QTY).notNull(),
    /** What the operator typed (e.g. 3.7 kg) when it differs from the base unit (ADR-010). */
    enteredQty: numeric("entered_qty", QTY),
    enteredUom: text("entered_uom"),
    tareQtyG: numeric("tare_qty_g", QTY),
    grossQtyG: numeric("gross_qty_g", QTY),
    /** true = another lot follows for this line (split dispense); tolerance is judged on the line total. */
    isPartial: boolean("is_partial").notNull().default(false),
    /** Line total after this row is within the tolerance window (partial rows: not above the window). */
    isWithinTolerance: boolean("is_within_tolerance").notNull(),
    /** MVP free-text scale code; Wave 2 rows also carry equipment_id. */
    scaleCode: text("scale_code"),
    equipmentId: uuid("equipment_id").references(() => equipment.id),
    operatorId: uuid("operator_id").notNull().references(() => users.id),
    checkerId: uuid("checker_id").references(() => users.id),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    /** CX-TOL: qa_qc (production.over_tolerance_dispense.approve) accepted the weight; never the operator. */
    exceptionApprovedBy: uuid("exception_approved_by").references(() => users.id),
    exceptionReason: text("exception_reason"),
    /** Deviation opened for the exception (quality module, W2C). */
    deviationId: uuid("deviation_id"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => dispenseRecords.id),
    correctionReason: text("correction_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidReason: text("void_reason"),
    /** Set when the consumption movement for this weighing is posted (production_postings). */
    productionPostingId: uuid("production_posting_id"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dispense_records_line_seq_uq").on(t.batchMaterialId, t.sequence),
    uniqueIndex("dispense_records_supersedes_uq").on(t.supersedesId).where(sql`${t.supersedesId} is not null`),
    check("dispense_records_qty_ck", sql`${t.actualQtyG} > 0`),
    check("dispense_records_sod_ck", sql`${t.checkerId} is null or ${t.checkerId} <> ${t.operatorId}`),
    check("dispense_records_exception_sod_ck", sql`${t.exceptionApprovedBy} is null or (${t.exceptionApprovedBy} <> ${t.operatorId} and ${t.exceptionReason} is not null)`),
    check("dispense_records_correction_ck", sql`${t.supersedesId} is null or ${t.correctionReason} is not null`),
    check("dispense_records_void_ck", sql`${t.voidedAt} is null or (${t.voidedBy} is not null and ${t.voidReason} is not null)`),
  ],
);

/**
 * One record per routing step per batch (W05-06..17). status follows STEP_TRANSITIONS in
 * src/modules/production/execution.ts: in_progress → awaiting_check → completed (or
 * in_progress → completed when the step needs no checker); `blocked_reason` explains why an
 * in_progress step cannot complete (a "no" clearance answer, a reading outside limits, an open
 * reconciliation mismatch). Rows inserted before Wave 2 are completed records (default status).
 */
export const processStepRecords = pgTable(
  "process_step_records",
  {
    id: id(),
    batchId: uuid("batch_id").notNull().references(() => batches.id),
    routingStepId: uuid("routing_step_id").notNull().references(() => routingSteps.id),
    stepNo: integer("step_no").notNull(),
    name: text("name").notNull(),
    /** Snapshot of routing_steps.step_kind / area (null on MVP rows). */
    stepKind: text("step_kind"),
    area: text("area"),
    /** pending | in_progress | awaiting_check | completed | skipped */
    status: text("status").notNull().default("completed"),
    /** The person who conducted (performed) the step. */
    conductedBy: uuid("conducted_by").notNull().references(() => users.id),
    checkedBy: uuid("checked_by").references(() => users.id),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    /** MVP free-text readings; Wave 2 readings live in process_step_readings. */
    readings: text("readings"),
    notes: text("notes"),
    blockedReason: text("blocked_reason"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
    /** Hold/curing steps: earliest completion (started_at + routing min duration). */
    earliestCompletionAt: timestamp("earliest_completion_at", { withTimezone: true }),
    /** When the conductor finished the step (before the checker signs). */
    performedAt: timestamp("performed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** CX-TOL on the step (reading outside limits, early end of a hold, reconciliation mismatch). */
    exceptionApprovedBy: uuid("exception_approved_by").references(() => users.id),
    exceptionReason: text("exception_reason"),
    deviationId: uuid("deviation_id"),
  },
  (t) => [
    uniqueIndex("process_step_records_batch_step_uq").on(t.batchId, t.stepNo),
    check("process_step_records_status_ck", sql`${t.status} in ('pending', 'in_progress', 'awaiting_check', 'completed', 'skipped')`),
    check("process_step_records_sod_ck", sql`${t.checkedBy} is null or ${t.checkedBy} <> ${t.conductedBy}`),
    check("process_step_records_completed_ck", sql`${t.status} <> 'completed' or ${t.completedAt} is not null`),
    check("process_step_records_exception_ck", sql`${t.exceptionApprovedBy} is null or (${t.exceptionApprovedBy} <> ${t.conductedBy} and ${t.exceptionReason} is not null)`),
  ],
);

export const testResults = pgTable("test_results", {
  id: id(),
  batchId: uuid("batch_id").notNull().references(() => batches.id),
  testName: text("test_name").notNull(),
  specification: text("specification").notNull(),
  result: text("result").notNull(),
  passed: boolean("passed").notNull(),
  testedBy: uuid("tested_by").notNull().references(() => users.id),
  testedAt: timestamp("tested_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

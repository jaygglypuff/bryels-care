import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { QTY, createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";
import { bomLines, formulaRevisions, locations, materials, products, routingSteps } from "./masterdata";
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
    /** Frozen copy of formula header, BOM lines and steps at creation (batch snapshot rule). */
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
  tolerancePct: numeric("tolerance_pct", QTY).notNull(),
  dispensedQtyG: numeric("dispensed_qty_g", QTY).notNull().default("0"),
  /** pending | dispensed | exception */
  status: text("status").notNull().default("pending"),
});

/** One weighing: operator weighs, a different checker verifies. */
export const dispenseRecords = pgTable("dispense_records", {
  id: id(),
  batchMaterialId: uuid("batch_material_id").notNull().references(() => batchMaterials.id),
  lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
  fromLocationId: uuid("from_location_id").notNull().references(() => locations.id),
  actualQtyG: numeric("actual_qty_g", QTY).notNull(),
  isWithinTolerance: boolean("is_within_tolerance").notNull(),
  scaleCode: text("scale_code"),
  operatorId: uuid("operator_id").notNull().references(() => users.id),
  checkerId: uuid("checker_id").notNull().references(() => users.id),
  exceptionReason: text("exception_reason"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Checklist / process step completion with conductor and checker. */
export const processStepRecords = pgTable("process_step_records", {
  id: id(),
  batchId: uuid("batch_id").notNull().references(() => batches.id),
  routingStepId: uuid("routing_step_id").notNull().references(() => routingSteps.id),
  stepNo: integer("step_no").notNull(),
  name: text("name").notNull(),
  conductedBy: uuid("conducted_by").notNull().references(() => users.id),
  checkedBy: uuid("checked_by").references(() => users.id),
  readings: text("readings"),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
});

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

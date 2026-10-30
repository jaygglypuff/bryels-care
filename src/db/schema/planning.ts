import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { QTY, createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";
import { formulaRevisions, formulas, locations, materials, products } from "./masterdata";
import { routingRevisions } from "./engineering";
import { inventoryLots, stockMovements } from "./inventory";
import { salesOrderLines, salesOrders } from "./sales";
import { stockReservations } from "./reservations";
import { batchMaterials, batches } from "./production";
import { productionLines } from "./org";

/**
 * Production planning (Wave 2 W2A, backlog E-3-03 and E-5-07; docs/data-model.md §3.5, §6.3;
 * docs/process-maps.md W05-01..05).
 *
 * production_plans → production_plan_lines → work_orders → batches. A work order resolves the
 * approved effective formula and routing revisions at `planned` (V-REV) and reserves released lots
 * by FEFO at `released` (stock_reservations with demand_type = 'work_order'). Staging by scan moves
 * reserved lots to a production staging location and re-reserves them for the batch
 * (demand_type = 'batch'); every scan is one batch_material_stagings row and one ledger movement.
 */

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

/** Production lines: one table, owned by master data (W2G, src/db/schema/org.ts); W2A work orders reference it. */
export const PRODUCTION_PLAN_STATUSES = ["draft", "approved", "closed"] as const;

/** A planning period of a site built from demand (W05-01, FR-production-13). Optional approval gate (A-PROC-30). */
export const productionPlans = pgTable(
  "production_plans",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    planNumber: text("plan_number").notNull(),
    status: text("status").notNull().default("draft"),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    notes: text("notes"),
    /** `approval?` set (docs/data-model.md §1.3): SoD enforced by the service via approvals.sod.production_plan. */
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").notNull().references(() => users.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("production_plans_org_number_uq").on(t.organizationId, t.planNumber),
    index("production_plans_site_status_idx").on(t.siteId, t.status),
    check("ck_production_plans_status", sql`${t.status} in (${inList(PRODUCTION_PLAN_STATUSES)})`),
    check("ck_production_plans_period", sql`${t.periodStart} <= ${t.periodEnd}`),
  ],
);

export const PLAN_LINE_SOURCES = ["sales_order", "min_stock", "manual"] as const;

/**
 * One SKU need of a plan. Demand figures are frozen when the plan is built (what the planner saw);
 * material availability is recomputed live on the plan page. Converting the line creates a draft
 * work order linked by work_orders.production_plan_line_id; nothing is created automatically.
 */
export const productionPlanLines = pgTable(
  "production_plan_lines",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    productionPlanId: uuid("production_plan_id").notNull().references(() => productionPlans.id),
    lineNo: integer("line_no").notNull(),
    productId: uuid("product_id").notNull().references(() => products.id),
    source: text("source").notNull(),
    salesOrderId: uuid("sales_order_id").references(() => salesOrders.id),
    salesOrderLineId: uuid("sales_order_line_id").references(() => salesOrderLines.id),
    /** Demand in finished units (pcs) by source, frozen at build. */
    demandUnits: numeric("demand_units", QTY).notNull(),
    onHandUnits: numeric("on_hand_units", QTY).notNull().default("0"),
    availableUnits: numeric("available_units", QTY).notNull().default("0"),
    openWorkOrderUnits: numeric("open_work_order_units", QTY).notNull().default("0"),
    minStockUnits: numeric("min_stock_units", QTY),
    /** Planned quantity (units) the planner intends to make; defaults to the net requirement. */
    qtyUnits: numeric("qty_units", QTY).notNull(),
    targetDate: date("target_date").notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("production_plan_lines_plan_line_uq").on(t.productionPlanId, t.lineNo),
    check("ck_production_plan_lines_source", sql`${t.source} in (${inList(PLAN_LINE_SOURCES)})`),
    check("ck_production_plan_lines_qty", sql`${t.qtyUnits} > 0 and ${t.demandUnits} >= 0`),
  ],
);

/** Minimum finished-goods stock per SKU and site for planning (W05-01 "min-stock"; owner-maintained data, A-W2A-06). */
export const productMinStock = pgTable(
  "product_min_stock",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    minStockUnits: numeric("min_stock_units", QTY).notNull(),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("product_min_stock_site_product_uq").on(t.siteId, t.productId), check("ck_product_min_stock_qty", sql`${t.minStockUnits} >= 0`)],
);

export const WORK_ORDER_STATUSES = ["draft", "planned", "released", "in_progress", "completed", "closed", "cancelled"] as const;

/**
 * Planning record that batches execute (docs/data-model.md §3.5 `work_orders`, §6.3). Release
 * (`production.work_order.approve`, planned → released) is the approval and fills the approval
 * columns; separation of duties follows setting approvals.sod.work_order (A-PM-14).
 */
export const workOrders = pgTable(
  "work_orders",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    workOrderNumber: text("work_order_number").notNull(),
    status: text("status").notNull().default("draft"),
    productId: uuid("product_id").notNull().references(() => products.id),
    formulaId: uuid("formula_id").notNull().references(() => formulas.id),
    /** Resolved at `planned`: approved and effective on planned_start (V-REV). */
    formulaRevisionId: uuid("formula_revision_id").references(() => formulaRevisions.id),
    routingRevisionId: uuid("routing_revision_id").references(() => routingRevisions.id),
    productionLineId: uuid("production_line_id").references(() => productionLines.id),
    productionPlanLineId: uuid("production_plan_line_id").references(() => productionPlanLines.id),
    salesOrderId: uuid("sales_order_id").references(() => salesOrders.id),
    /** Total bulk quantity = batch_count × batch_size_base (base unit of the formula, g). */
    qtyPlannedBase: numeric("qty_planned_base", QTY).notNull(),
    baseUom: text("base_uom").notNull().default("g"),
    batchCount: integer("batch_count").notNull(),
    batchSizeBase: numeric("batch_size_base", QTY).notNull(),
    /** Finished units the planner aims for (informational; from a plan line or typed). */
    targetUnits: numeric("target_units", QTY),
    plannedStart: date("planned_start").notNull(),
    plannedEnd: date("planned_end").notNull(),
    /** ADR-080 (V2-2): the date the products are needed (customer order date, else typed). Late = before today and not Done. */
    neededBy: date("needed_by"),
    priority: integer("priority").notNull().default(5),
    assignedPlannerId: uuid("assigned_planner_id").references(() => users.id),
    assignedSupervisorId: uuid("assigned_supervisor_id").references(() => users.id),
    notes: text("notes"),
    /** Shortages found at release (material id → required/reserved/short); live figures are recomputed. */
    releaseShortages: jsonb("release_shortages"),
    releasedWithShortage: boolean("released_with_shortage").notNull().default(false),
    cancelReason: text("cancel_reason"),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").notNull().references(() => users.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("work_orders_org_number_uq").on(t.organizationId, t.workOrderNumber),
    index("work_orders_site_status_idx").on(t.siteId, t.status),
    index("work_orders_plan_line_idx").on(t.productionPlanLineId),
    check("ck_work_orders_status", sql`${t.status} in (${inList(WORK_ORDER_STATUSES)})`),
    check("ck_work_orders_qty", sql`${t.qtyPlannedBase} > 0 and ${t.batchSizeBase} > 0 and ${t.batchCount} > 0`),
    check("ck_work_orders_dates", sql`${t.plannedEnd} >= ${t.plannedStart}`),
    check("ck_work_orders_priority", sql`${t.priority} between 1 and 9`),
    check("ck_work_orders_revisions", sql`${t.status} in ('draft','cancelled') or (${t.formulaRevisionId} is not null and ${t.routingRevisionId} is not null)`),
    check("ck_work_orders_release", sql`${t.status} not in ('released','in_progress','completed','closed') or (${t.approvedBy} is not null and ${t.approvedAt} is not null)`),
    check("ck_work_orders_cancel", sql`${t.status} <> 'cancelled' or ${t.cancelReason} is not null`),
  ],
);

/** Shape of docs/data-model.md §6.1; written in the same transaction as the status change. */
export const workOrderStateTransitions = pgTable(
  "work_order_state_transitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    workOrderId: uuid("work_order_id").notNull().references(() => workOrders.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    correlationId: uuid("correlation_id").notNull(),
  },
  (t) => [index("work_order_transitions_wo_idx").on(t.workOrderId, t.occurredAt)],
);

/**
 * Controlled exception CX-MAT (docs/permissions-matrix.md §5.3): qa_qc lets staging use another
 * released lot of the SAME material instead of the reserved one. Records both lots and the reason;
 * a different material is never allowed. Append-only.
 */
export const batchMaterialSubstitutions = pgTable(
  "batch_material_substitutions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    batchId: uuid("batch_id").notNull().references((): AnyPgColumn => batches.id),
    batchMaterialId: uuid("batch_material_id").notNull().references((): AnyPgColumn => batchMaterials.id),
    workOrderId: uuid("work_order_id").notNull().references(() => workOrders.id),
    materialId: uuid("material_id").notNull().references(() => materials.id),
    expectedLotId: uuid("expected_lot_id").references(() => inventoryLots.id),
    substituteLotId: uuid("substitute_lot_id").notNull().references(() => inventoryLots.id),
    substituteLocationId: uuid("substitute_location_id").notNull().references(() => locations.id),
    qtyBase: numeric("qty_base", QTY).notNull(),
    reason: text("reason").notNull(),
    newReservationId: uuid("new_reservation_id").references(() => stockReservations.id),
    approvedBy: uuid("approved_by").notNull().references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("batch_material_substitutions_batch_idx").on(t.batchId),
    check("ck_batch_material_substitutions_qty", sql`${t.qtyBase} > 0`),
    check("ck_batch_material_substitutions_lots", sql`${t.expectedLotId} is null or ${t.expectedLotId} <> ${t.substituteLotId}`),
    check("ck_batch_material_substitutions_reason", sql`length(btrim(${t.reason})) >= 5`),
  ],
);

/**
 * One staging scan (W05-05): a reserved lot moved to the staging location for a batch ingredient.
 * Append-only; corrections are a reversal of the movement plus a new scan.
 */
export const batchMaterialStagings = pgTable(
  "batch_material_stagings",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    batchId: uuid("batch_id").notNull().references((): AnyPgColumn => batches.id),
    batchMaterialId: uuid("batch_material_id").notNull().references((): AnyPgColumn => batchMaterials.id),
    workOrderId: uuid("work_order_id").notNull().references(() => workOrders.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    fromLocationId: uuid("from_location_id").notNull().references(() => locations.id),
    toLocationId: uuid("to_location_id").notNull().references(() => locations.id),
    qtyBase: numeric("qty_base", QTY).notNull(),
    baseUom: text("base_uom").notNull(),
    movementId: uuid("movement_id").notNull().references(() => stockMovements.id),
    /** Reservation that now holds the staged quantity for the batch (demand_type = 'batch'). */
    batchReservationId: uuid("batch_reservation_id").references(() => stockReservations.id),
    substitutionId: uuid("substitution_id").references(() => batchMaterialSubstitutions.id),
    stagedBy: uuid("staged_by").notNull().references(() => users.id),
    stagedAt: timestamp("staged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("batch_material_stagings_batch_idx").on(t.batchId, t.batchMaterialId),
    index("batch_material_stagings_wo_idx").on(t.workOrderId),
    check("ck_batch_material_stagings_qty", sql`${t.qtyBase} > 0`),
    check("ck_batch_material_stagings_locations", sql`${t.fromLocationId} <> ${t.toLocationId}`),
  ],
);

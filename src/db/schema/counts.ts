import { boolean, check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { MONEY, QTY, createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";
import { locations, materials, products, warehouses } from "./masterdata";
import { inventoryLots, stockMovements } from "./inventory";
import { containers } from "./containers";

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

export const COUNT_KINDS = ["cycle", "full", "spot"] as const;
/** Stock count state machine values (`countMachine` in src/modules/inventory/counts.ts). */
export const COUNT_STATUSES = ["planned", "in_progress", "counted", "recount", "pending_approval", "approved", "posted", "cancelled"] as const;
/** Statuses during which the count's locations are frozen (V-FREEZE). */
export const COUNT_FROZEN_STATUSES = ["in_progress", "counted", "recount", "pending_approval", "approved"] as const;
export const COUNT_LINE_STATUSES = ["open", "counted", "recount_required", "final"] as const;
/** Variance reason codes (W03-07). Seeded vocabulary; the company's list replaces it when reason_codes ships. */
/** Count variance reasons are shared reason codes (category `count_variance`, src/modules/masterdata reason codes, US-1-24). */

/** A stock count plan (rule CNT). Expected quantities are snapshotted at release (frozen_at). */
export const stockCounts = pgTable(
  "stock_counts",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    countNumber: text("count_number").notNull(),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id),
    countKind: text("count_kind").notNull().default("cycle"),
    isBlind: boolean("is_blind").notNull().default(true),
    status: text("status").notNull().default("planned"),
    scheduledFor: date("scheduled_for"),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    releasedBy: uuid("released_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submittedBy: uuid("submitted_by").references(() => users.id),
    /** Final approval (the last required step). Step decisions are in approval_decisions (record_type stock_count). */
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvalNote: text("approval_note"),
    requiresSecondApproval: boolean("requires_second_approval").notNull().default(false),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: uuid("posted_by").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    uniqueIndex("stock_counts_org_number_uq").on(t.organizationId, t.countNumber),
    index("stock_counts_site_status_idx").on(t.siteId, t.status),
    check("ck_stock_counts_kind", sql`${t.countKind} in (${inList(COUNT_KINDS)})`),
    check("ck_stock_counts_status", sql`${t.status} in (${inList(COUNT_STATUSES)})`),
    check("ck_stock_counts_cancel_reason", sql`${t.status} <> 'cancelled' or ${t.cancelReason} is not null`),
  ],
);

/** Locations in the scope of a count; frozen while the count is active. */
export const stockCountScopes = pgTable(
  "stock_count_scopes",
  {
    id: id(),
    stockCountId: uuid("stock_count_id").notNull().references(() => stockCounts.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    locationId: uuid("location_id").notNull().references(() => locations.id),
  },
  (t) => [uniqueIndex("stock_count_scopes_uq").on(t.stockCountId, t.locationId), index("stock_count_scopes_location_idx").on(t.locationId)],
);

/** Assigned counters. The variance approver is never a counter (SoD). */
export const stockCountCounters = pgTable(
  "stock_count_counters",
  {
    id: id(),
    stockCountId: uuid("stock_count_id").notNull().references(() => stockCounts.id),
    userId: uuid("user_id").notNull().references(() => users.id),
  },
  (t) => [uniqueIndex("stock_count_counters_uq").on(t.stockCountId, t.userId)],
);

/**
 * One line per lot × location (expected snapshot, or an unexpected/unlabelled find). Quantities
 * counted are in stock_count_entries (append-only); the line holds the final result.
 */
export const stockCountLines = pgTable(
  "stock_count_lines",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    stockCountId: uuid("stock_count_id").notNull().references(() => stockCounts.id),
    locationId: uuid("location_id").notNull().references(() => locations.id),
    /** Null only for an unlabelled find (is_unlabelled). */
    lotId: uuid("lot_id").references(() => inventoryLots.id),
    containerId: uuid("container_id").references(() => containers.id),
    baseUom: text("base_uom"),
    expectedQtyBase: numeric("expected_qty_base", QTY).notNull().default("0"),
    isUnexpected: boolean("is_unexpected").notNull().default(false),
    isUnlabelled: boolean("is_unlabelled").notNull().default(false),
    description: text("description"),
    lineStatus: text("line_status").notNull().default("open"),
    finalQtyBase: numeric("final_qty_base", QTY),
    varianceQtyBase: numeric("variance_qty_base", QTY),
    variancePct: numeric("variance_pct", { precision: 12, scale: 4 }),
    varianceReasonCode: text("variance_reason_code"),
    varianceNote: text("variance_note"),
    autoApproved: boolean("auto_approved").notNull().default(false),
    adjustmentMovementId: uuid("adjustment_movement_id").references(() => stockMovements.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("stock_count_lines_count_idx").on(t.stockCountId),
    uniqueIndex("stock_count_lines_lot_location_uq").on(t.stockCountId, t.locationId, t.lotId).where(sql`${t.lotId} is not null`),
    check("ck_stock_count_lines_status", sql`${t.lineStatus} in (${inList(COUNT_LINE_STATUSES)})`),
    check("ck_stock_count_lines_unlabelled", sql`(${t.lotId} is null) = ${t.isUnlabelled}`),
    check("ck_stock_count_lines_expected", sql`${t.expectedQtyBase} >= 0`),
  ],
);

/** Every count and recount ever entered; never updated or deleted ("original counts never erased"). */
export const stockCountEntries = pgTable(
  "stock_count_entries",
  {
    id: id(),
    stockCountId: uuid("stock_count_id").notNull().references(() => stockCounts.id),
    stockCountLineId: uuid("stock_count_line_id").notNull().references(() => stockCountLines.id),
    /** count | recount */
    entryKind: text("entry_kind").notNull(),
    qtyBase: numeric("qty_base", QTY).notNull(),
    countedBy: uuid("counted_by").notNull().references(() => users.id),
    countedAt: timestamp("counted_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    index("stock_count_entries_line_idx").on(t.stockCountLineId),
    uniqueIndex("stock_count_entries_idem_uq").on(t.stockCountId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    check("ck_stock_count_entries_kind", sql`${t.entryKind} in ('count','recount')`),
    check("ck_stock_count_entries_qty", sql`${t.qtyBase} >= 0`),
  ],
);

export const ADJUSTMENT_STATUSES = ["draft", "submitted", "approved", "rejected", "posted", "cancelled"] as const;
/** Header reason codes for manual adjustments (seeded vocabulary; replaced by reason_codes later). */
/** Adjustment reasons are shared reason codes (category `adjustment`, US-1-24); no DB list, so the company can add codes. */

/** Approvable adjustment document (rule ADJ); posts one adjustment movement per line (A-DM-32). */
export const stockAdjustments = pgTable(
  "stock_adjustments",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    adjustmentNumber: text("adjustment_number").notNull(),
    status: text("status").notNull().default("draft"),
    reasonCode: text("reason_code").notNull(),
    reasonNote: text("reason_note"),
    totalValueAmount: numeric("total_value_amount", MONEY),
    currency: text("currency"),
    /** True when any line has no unit cost, so the value basis of the approval rule is unknown. */
    valueUnknown: boolean("value_unknown").notNull().default(false),
    requiresSecondApproval: boolean("requires_second_approval").notNull().default(false),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedBy: uuid("rejected_by").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    postedBy: uuid("posted_by").references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    idempotencyKey: text("idempotency_key"),
    correlationId: uuid("correlation_id"),
  },
  (t) => [
    uniqueIndex("stock_adjustments_org_number_uq").on(t.organizationId, t.adjustmentNumber),
    index("stock_adjustments_site_status_idx").on(t.siteId, t.status),
    check("ck_stock_adjustments_status", sql`${t.status} in (${inList(ADJUSTMENT_STATUSES)})`),
  ],
);

export const stockAdjustmentLines = pgTable(
  "stock_adjustment_lines",
  {
    id: id(),
    stockAdjustmentId: uuid("stock_adjustment_id").notNull().references(() => stockAdjustments.id),
    lineNo: integer("line_no").notNull(),
    /** Null only while a found-stock line waits for its new lot (created at posting). */
    lotId: uuid("lot_id").references(() => inventoryLots.id),
    locationId: uuid("location_id").notNull().references(() => locations.id),
    containerId: uuid("container_id").references(() => containers.id),
    direction: text("direction").notNull(),
    qtyBase: numeric("qty_base", QTY).notNull(),
    unitCostAmount: numeric("unit_cost_amount", MONEY),
    note: text("note"),
    /** Found stock without a lot: the lot to create at posting (inventory.lot.create), on QA hold. */
    newLotMaterialId: uuid("new_lot_material_id").references(() => materials.id),
    newLotProductId: uuid("new_lot_product_id").references(() => products.id),
    newLotExpiresOn: date("new_lot_expires_on"),
    newLotSupplierLotNumber: text("new_lot_supplier_lot_number"),
    stockMovementId: uuid("stock_movement_id").references(() => stockMovements.id),
  },
  (t) => [
    uniqueIndex("stock_adjustment_lines_uq").on(t.stockAdjustmentId, t.lineNo),
    check("ck_stock_adjustment_lines_direction", sql`${t.direction} in ('increase','decrease')`),
    check("ck_stock_adjustment_lines_qty", sql`${t.qtyBase} > 0`),
    check(
      "ck_stock_adjustment_lines_lot",
      sql`${t.lotId} is not null or (${t.direction} = 'increase' and num_nonnulls(${t.newLotMaterialId}, ${t.newLotProductId}) = 1)`,
    ),
  ],
);

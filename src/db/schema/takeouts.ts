import { sql } from "drizzle-orm";
import { boolean, check, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { QTY, createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";
import { customers, locations, products } from "./masterdata";
import { inventoryLots, stockMovements } from "./inventory";
import { containers } from "./containers";
import { stockAdjustments } from "./counts";

/**
 * ADR-138 "Take a few out" (owner 2026-11-21): small, unplanned outflows of finished goods (a few pieces sold on an
 * online shop, a free sample, a giveaway, the display shelf, staff use). One take-out = one entry with a reason and
 * one or more lines (product, lot, place, box, pieces); each posted line is one `issue` movement through `postMovement`.
 * Migration 0045.
 */

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

/** Why the pieces left. The channel list (Shopee, Lazada…) is organisation configuration, not this list. */
export const TAKEOUT_PURPOSES = ["sold_online", "customer_sample", "giveaway", "display", "staff_use", "other"] as const;
/** State machine `stock_takeout` (src/modules/inventory/takeout-rules.ts). A new entry starts posted or awaiting approval. */
export const TAKEOUT_STATUSES = ["awaiting_approval", "posted", "rejected", "cancelled", "reversed"] as const;

export const stockTakeouts = pgTable(
  "stock_takeouts",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    takeoutNumber: text("takeout_number").notNull(),
    status: text("status").notNull(),
    purpose: text("purpose").notNull(),
    /** Online shop channel code from setting `inventory.takeout.channels` (sold_online only). */
    channel: text("channel"),
    /** The platform's order number (optional, sold_online only). */
    platformOrderRef: text("platform_order_ref"),
    /** A sample for a known customer (customer_sample only); else a typed name. */
    customerId: uuid("customer_id").references(() => customers.id),
    recipientName: text("recipient_name"),
    note: text("note"),
    totalPieces: numeric("total_pieces", QTY).notNull(),
    /** Plain sentence of the limit that sent it for approval ("12 pieces on one line; up to 10 go straight out"). */
    approvalReason: text("approval_reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    correlationId: uuid("correlation_id"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    postedBy: uuid("posted_by").references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedBy: uuid("rejected_by").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    reversedBy: uuid("reversed_by").references(() => users.id),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reverseReason: text("reverse_reason"),
  },
  (t) => [
    uniqueIndex("stock_takeouts_org_number_uq").on(t.organizationId, t.takeoutNumber),
    uniqueIndex("stock_takeouts_org_idem_uq").on(t.organizationId, t.idempotencyKey),
    index("stock_takeouts_site_created_idx").on(t.siteId, t.createdAt),
    index("stock_takeouts_customer_idx").on(t.customerId).where(sql`${t.customerId} is not null`),
    index("stock_takeouts_creator_day_idx").on(t.createdBy, t.createdAt),
    check("ck_stock_takeouts_status", sql`${t.status} in (${inList(TAKEOUT_STATUSES)})`),
    check("ck_stock_takeouts_purpose", sql`${t.purpose} in (${inList(TAKEOUT_PURPOSES)})`),
    check("ck_stock_takeouts_channel", sql`(${t.purpose} = 'sold_online') = (${t.channel} is not null)`),
    check("ck_stock_takeouts_order_ref", sql`${t.platformOrderRef} is null or ${t.purpose} = 'sold_online'`),
    check("ck_stock_takeouts_recipient", sql`(${t.customerId} is null and ${t.recipientName} is null) or ${t.purpose} = 'customer_sample'`),
    check("ck_stock_takeouts_other_note", sql`${t.purpose} <> 'other' or coalesce(length(trim(${t.note})), 0) >= 3`),
    check("ck_stock_takeouts_pieces", sql`${t.totalPieces} > 0`),
    check("ck_stock_takeouts_posted", sql`${t.status} not in ('posted', 'reversed') or (${t.postedBy} is not null and ${t.postedAt} is not null)`),
    check("ck_stock_takeouts_rejected", sql`${t.status} <> 'rejected' or (${t.rejectedBy} is not null and ${t.rejectReason} is not null)`),
    check("ck_stock_takeouts_cancelled", sql`${t.status} <> 'cancelled' or (${t.cancelledBy} is not null and ${t.cancelReason} is not null)`),
    check("ck_stock_takeouts_reversed", sql`${t.status} <> 'reversed' or (${t.reversedBy} is not null and ${t.reverseReason} is not null)`),
    check("ck_stock_takeouts_approval", sql`${t.status} <> 'awaiting_approval' or ${t.approvalReason} is not null`),
  ],
);

/** One product line of a take-out: where the pieces come from. Posted lines link their issue (and reversal) movement. */
export const stockTakeoutLines = pgTable(
  "stock_takeout_lines",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    takeoutId: uuid("takeout_id").notNull().references(() => stockTakeouts.id),
    lineNo: integer("line_no").notNull(),
    productId: uuid("product_id").notNull().references(() => products.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    locationId: uuid("location_id").notNull().references(() => locations.id),
    /** Null = loose pieces at the place. */
    containerId: uuid("container_id").references(() => containers.id),
    qtyBase: numeric("qty_base", QTY).notNull(),
    baseUom: text("base_uom").notNull(),
    /** The box was sealed and this take-out opened it. */
    openedBox: boolean("opened_box").notNull().default(false),
    stockMovementId: uuid("stock_movement_id").references(() => stockMovements.id),
    reversalMovementId: uuid("reversal_movement_id").references(() => stockMovements.id),
  },
  (t) => [
    uniqueIndex("stock_takeout_lines_line_uq").on(t.takeoutId, t.lineNo),
    index("stock_takeout_lines_lot_idx").on(t.lotId),
    index("stock_takeout_lines_container_idx").on(t.containerId).where(sql`${t.containerId} is not null`),
    check("ck_stock_takeout_lines_qty", sql`${t.qtyBase} > 0`),
  ],
);

/**
 * "Count what's left" (ADR-138 §3): a quick count of an open box or of the loose pieces of one lot on a shelf. Equal =
 * a check only (it restarts the reminder clock); a difference creates and sends a stock fix (`stock_adjustments`,
 * the existing approval) and links it here. Append-only evidence.
 */
export const shelfChecks = pgTable(
  "shelf_checks",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    locationId: uuid("location_id").notNull().references(() => locations.id),
    containerId: uuid("container_id").references(() => containers.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    expectedQty: numeric("expected_qty", QTY).notNull(),
    countedQty: numeric("counted_qty", QTY).notNull(),
    baseUom: text("base_uom").notNull(),
    reasonCode: text("reason_code"),
    note: text("note"),
    stockAdjustmentId: uuid("stock_adjustment_id").references(() => stockAdjustments.id),
    countedBy: uuid("counted_by").notNull().references(() => users.id),
    countedAt: timestamp("counted_at", { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (t) => [
    uniqueIndex("shelf_checks_org_idem_uq").on(t.organizationId, t.idempotencyKey),
    index("shelf_checks_container_idx").on(t.containerId, t.countedAt),
    index("shelf_checks_location_lot_idx").on(t.locationId, t.lotId, t.countedAt),
    check("ck_shelf_checks_qty", sql`${t.expectedQty} >= 0 and ${t.countedQty} >= 0`),
    check("ck_shelf_checks_difference", sql`${t.expectedQty} = ${t.countedQty} or (${t.reasonCode} is not null and ${t.stockAdjustmentId} is not null)`),
  ],
);

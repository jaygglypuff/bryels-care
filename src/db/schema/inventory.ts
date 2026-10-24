import { type AnyPgColumn, check, date, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { QTY, createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";
import { locations, materials, products } from "./masterdata";

/**
 * A lot of a material or a finished product.
 * qualityStatus: quarantine | released | on_hold | rejected | expired | recalled
 */
export const inventoryLots = pgTable(
  "inventory_lots",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    lotNumber: text("lot_number").notNull(),
    /** material | product */
    itemKind: text("item_kind").notNull(),
    materialId: uuid("material_id").references(() => materials.id),
    productId: uuid("product_id").references(() => products.id),
    supplierName: text("supplier_name"),
    supplierLotNumber: text("supplier_lot_number"),
    manufacturedOn: date("manufactured_on"),
    expiresOn: date("expires_on"),
    /** Retest date: the expiry job puts released lots on hold when it is reached (US-2-10, A-PROC-36). */
    retestOn: date("retest_on"),
    qualityStatus: text("quality_status").notNull().default("quarantine"),
    /** Batch that produced this lot (finished goods and intermediates). */
    sourceBatchId: uuid("source_batch_id"),
    /** Lot this one was re-lotted from (inter-site transfer, US-2-14 AC2); a genealogy edge. */
    originLotId: uuid("origin_lot_id"),
    baseUom: text("base_uom").notNull(),
    /** Paper batch or legacy lot number of an opening lot (W3C, US-2-26); never a scan payload or a foreign key. */
    legacyNumber: text("legacy_number"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("lots_org_number_uq").on(t.organizationId, t.lotNumber),
    index("lots_site_status_idx").on(t.siteId, t.qualityStatus),
    uniqueIndex("lots_org_legacy_number_uq").on(t.organizationId, t.legacyNumber).where(sql`${t.legacyNumber} is not null`),
  ],
);

/** Projection of the ledger per lot × location, updated in the posting transaction (ADR-006). */
export const inventoryBalances = pgTable(
  "inventory_balances",
  {
    id: id(),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    locationId: uuid("location_id").notNull().references(() => locations.id),
    qtyBase: numeric("qty_base", QTY).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("balances_lot_location_uq").on(t.lotId, t.locationId),
    index("balances_site_idx").on(t.siteId),
    check("balances_qty_non_negative", sql`${t.qtyBase} >= 0`),
  ],
);

/**
 * Immutable stock ledger. movementType: receipt | issue | transfer | consumption | output |
 * adjustment | return | shipment | reversal. Corrections are reversals that link to the original
 * (one reversal per row at most) plus an optional replacement sharing the reversal's correlation id.
 * ck_stock_movements_locations encodes which side(s) each type moves (docs/data-model.md §5.1).
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    movementType: text("movement_type").notNull(),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    fromLocationId: uuid("from_location_id").references(() => locations.id),
    toLocationId: uuid("to_location_id").references(() => locations.id),
    qtyBase: numeric("qty_base", QTY).notNull(),
    baseUom: text("base_uom").notNull(),
    /** Quantity and unit as entered by the user (ADR-010); equal to the base pair when entered in base. */
    qtyEntered: numeric("qty_entered", QTY),
    enteredUom: text("entered_uom"),
    /** Lot quality status when the row was posted (stock card, exception evidence). */
    qualityStatusAtPosting: text("quality_status_at_posting"),
    /** Groups a reversal with its replacement (and any rows of one correction). */
    correlationId: uuid("correlation_id"),
    sourceDocumentType: text("source_document_type"),
    sourceDocumentId: uuid("source_document_id"),
    sourceDocumentNumber: text("source_document_number"),
    reason: text("reason"),
    reversalOfId: uuid("reversal_of_id").references((): AnyPgColumn => stockMovements.id),
    idempotencyKey: text("idempotency_key"),
    postedBy: uuid("posted_by").notNull().references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    meta: jsonb("meta"),
  },
  (t) => [
    index("movements_lot_idx").on(t.lotId),
    index("movements_site_time_idx").on(t.siteId, t.postedAt),
    uniqueIndex("movements_idem_uq").on(t.organizationId, t.idempotencyKey),
    uniqueIndex("movements_reversal_of_uq").on(t.reversalOfId).where(sql`${t.reversalOfId} is not null`),
    index("movements_correlation_idx").on(t.correlationId),
    check("ck_stock_movements_qty_positive", sql`${t.qtyBase} > 0`),
    check(
      "ck_stock_movements_type",
      sql`${t.movementType} in ('receipt','issue','transfer','consumption','output','adjustment','return','shipment','reversal')`,
    ),
    check(
      "ck_stock_movements_locations",
      sql`case ${t.movementType}
        when 'receipt' then ${t.fromLocationId} is null and ${t.toLocationId} is not null
        when 'output' then ${t.fromLocationId} is null and ${t.toLocationId} is not null
        when 'return' then ${t.fromLocationId} is null and ${t.toLocationId} is not null
        when 'issue' then ${t.fromLocationId} is not null and ${t.toLocationId} is null
        when 'consumption' then ${t.fromLocationId} is not null and ${t.toLocationId} is null
        when 'shipment' then ${t.fromLocationId} is not null and ${t.toLocationId} is null
        when 'transfer' then ${t.fromLocationId} is not null and ${t.toLocationId} is not null and ${t.fromLocationId} <> ${t.toLocationId}
        when 'adjustment' then (${t.fromLocationId} is null) <> (${t.toLocationId} is null)
        when 'reversal' then ${t.reversalOfId} is not null and (${t.fromLocationId} is not null or ${t.toLocationId} is not null)
        else false end`,
    ),
    check("ck_stock_movements_reversal_link", sql`(${t.movementType} = 'reversal') = (${t.reversalOfId} is not null)`),
  ],
);

// Goods receipts and their lines live in ./receiving.ts (Wave 1 W1B, US-2-07).

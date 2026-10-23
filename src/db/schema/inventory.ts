import { check, date, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    qualityStatus: text("quality_status").notNull().default("quarantine"),
    /** Batch that produced this lot (finished goods and intermediates). */
    sourceBatchId: uuid("source_batch_id"),
    /** Lot this one was re-lotted from (inter-site transfer, US-2-14 AC2); a genealogy edge. */
    originLotId: uuid("origin_lot_id"),
    baseUom: text("base_uom").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("lots_org_number_uq").on(t.organizationId, t.lotNumber),
    index("lots_site_status_idx").on(t.siteId, t.qualityStatus),
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
 * Immutable stock ledger. movementType: receipt | transfer | consumption | output | adjustment |
 * shipment | reversal. Corrections are reversals that link to the original.
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
    sourceDocumentType: text("source_document_type"),
    sourceDocumentId: uuid("source_document_id"),
    sourceDocumentNumber: text("source_document_number"),
    reason: text("reason"),
    reversalOfId: uuid("reversal_of_id"),
    idempotencyKey: text("idempotency_key"),
    postedBy: uuid("posted_by").notNull().references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    meta: jsonb("meta"),
  },
  (t) => [
    index("movements_lot_idx").on(t.lotId),
    index("movements_site_time_idx").on(t.siteId, t.postedAt),
    uniqueIndex("movements_idem_uq").on(t.organizationId, t.idempotencyKey),
  ],
);

/** Goods receipt header (one receipt can create several lots). */
export const goodsReceipts = pgTable("goods_receipts", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  siteId: uuid("site_id").notNull().references(() => sites.id),
  receiptNumber: text("receipt_number").notNull(),
  supplierName: text("supplier_name").notNull(),
  supplierDocumentNumber: text("supplier_document_number"),
  receivedBy: uuid("received_by").notNull().references(() => users.id),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
});

export const goodsReceiptLines = pgTable("goods_receipt_lines", {
  id: id(),
  goodsReceiptId: uuid("goods_receipt_id").notNull().references(() => goodsReceipts.id),
  lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
  materialId: uuid("material_id").notNull().references(() => materials.id),
  qtyBase: numeric("qty_base", QTY).notNull(),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  createdAt: createdAt(),
});

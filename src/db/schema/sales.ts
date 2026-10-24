import { check, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { MONEY, QTY, createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";
import { customers, locations, products } from "./masterdata";
import { inventoryLots } from "./inventory";
import { containers } from "./containers";

/** status: draft → confirmed → allocated → shipped (→ closed) | cancelled */
export const salesOrders = pgTable(
  "sales_orders",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    orderNumber: text("order_number").notNull(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    customerPoNumber: text("customer_po_number"),
    requestedDeliveryOn: text("requested_delivery_on"),
    status: text("status").notNull().default("draft"),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("so_site_status_idx").on(t.siteId, t.status)],
);

export const salesOrderLines = pgTable("sales_order_lines", {
  id: id(),
  salesOrderId: uuid("sales_order_id").notNull().references(() => salesOrders.id),
  lineNo: integer("line_no").notNull(),
  productId: uuid("product_id").notNull().references(() => products.id),
  qtyUnits: numeric("qty_units", QTY).notNull(),
  unitPrice: numeric("unit_price", MONEY).notNull().default("0"),
});

/**
 * FEFO allocation of released finished-goods stock to an order line, lot- and location-specific and,
 * when the stock is boxed, box-specific (W3E, US-4-09). status: open (holds stock) → fulfilled
 * (shipped by `fulfilled_shipment_id`) | released (with reason). Open allocations of open orders
 * reduce available-to-promise.
 */
export const stockAllocations = pgTable(
  "stock_allocations",
  {
    id: id(),
    salesOrderLineId: uuid("sales_order_line_id").notNull().references(() => salesOrderLines.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    locationId: uuid("location_id").notNull().references(() => locations.id),
    qtyUnits: numeric("qty_units", QTY).notNull(),
    createdAt: createdAt(),
    // Wave 3 W3E (US-4-09..12): box, life cycle and fulfilment link.
    containerId: uuid("container_id").references(() => containers.id),
    status: text("status").notNull().default("open"),
    fulfilledShipmentId: uuid("fulfilled_shipment_id"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: uuid("released_by").references(() => users.id),
    releaseReason: text("release_reason"),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (t) => [
    index("stock_allocations_line_idx").on(t.salesOrderLineId),
    index("stock_allocations_lot_location_idx").on(t.lotId, t.locationId),
    index("stock_allocations_container_idx").on(t.containerId),
    check("ck_stock_allocations_status", sql`${t.status} in ('open','fulfilled','released')`),
    check("ck_stock_allocations_qty", sql`${t.qtyUnits} > 0`),
    check("ck_stock_allocations_released", sql`${t.status} <> 'released' or ${t.releaseReason} is not null`),
  ],
);

/**
 * A shipment of an order (W09). Stock is issued at `dispatched` (§6.8), never by a draft DR.
 * status (W3E machine `shipmentMachine` in src/modules/sales/fulfilment-state.ts):
 * draft → picked → packed → dispatched → delivered (→ returned); draft/picked/packed → cancelled;
 * dispatched → reversed. Rows from before Wave 3 have no shipment number and default to dispatched.
 */
export const shipments = pgTable(
  "shipments",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    salesOrderId: uuid("sales_order_id").notNull().references(() => salesOrders.id),
    /** DR number, set by the dispatch posting (mirrors delivery_receipts.dr_number). */
    deliveryReceiptNumber: text("delivery_receipt_number"),
    carrier: text("carrier"),
    driverName: text("driver_name"),
    vehiclePlate: text("vehicle_plate"),
    packageCount: integer("package_count"),
    dispatchedBy: uuid("dispatched_by").references(() => users.id),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    receivedByName: text("received_by_name"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    // Wave 3 W3E (US-4-10..13)
    shipmentNumber: text("shipment_number"),
    status: text("status").notNull().default("dispatched"),
    shipToAddress: text("ship_to_address"),
    trackingNumber: text("tracking_number"),
    grossWeight: numeric("gross_weight", QTY),
    weightUom: text("weight_uom"),
    packedBy: uuid("packed_by").references(() => users.id),
    packedAt: timestamp("packed_at", { withTimezone: true }),
    overShipmentApprovedBy: uuid("over_shipment_approved_by").references(() => users.id),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id),
    reverseReason: text("reverse_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    idempotencyKey: text("idempotency_key"),
    correlationId: uuid("correlation_id"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("shipments_org_number_uq").on(t.organizationId, t.shipmentNumber).where(sql`${t.shipmentNumber} is not null`),
    uniqueIndex("shipments_org_idem_uq").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    index("shipments_order_idx").on(t.salesOrderId),
    index("shipments_site_status_idx").on(t.siteId, t.status),
    check("ck_shipments_status", sql`${t.status} in ('draft','picked','packed','dispatched','delivered','returned','cancelled','reversed')`),
    check(
      "ck_shipments_dispatched",
      sql`${t.status} not in ('dispatched','delivered','returned','reversed') or (${t.dispatchedAt} is not null and ${t.dispatchedBy} is not null and ${t.deliveryReceiptNumber} is not null)`,
    ),
    check("ck_shipments_package_count", sql`${t.packageCount} is null or ${t.packageCount} > 0`),
    check("ck_shipments_gross_weight", sql`${t.grossWeight} is null or ${t.grossWeight} > 0`),
    check("ck_shipments_reversed", sql`${t.status} <> 'reversed' or (${t.reversedAt} is not null and ${t.reverseReason} is not null)`),
  ],
);

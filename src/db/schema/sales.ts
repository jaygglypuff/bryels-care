import { index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { MONEY, QTY, createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";
import { customers, locations, products } from "./masterdata";
import { inventoryLots } from "./inventory";

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

/** FEFO allocation of released finished-goods stock to an order line. */
export const stockAllocations = pgTable("stock_allocations", {
  id: id(),
  salesOrderLineId: uuid("sales_order_line_id").notNull().references(() => salesOrderLines.id),
  lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
  locationId: uuid("location_id").notNull().references(() => locations.id),
  qtyUnits: numeric("qty_units", QTY).notNull(),
  createdAt: createdAt(),
});

/** Dispatching a shipment posts the stock issue (movement type shipment). */
export const shipments = pgTable("shipments", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  siteId: uuid("site_id").notNull().references(() => sites.id),
  salesOrderId: uuid("sales_order_id").notNull().references(() => salesOrders.id),
  deliveryReceiptNumber: text("delivery_receipt_number").notNull(),
  carrier: text("carrier"),
  driverName: text("driver_name"),
  vehiclePlate: text("vehicle_plate"),
  packageCount: integer("package_count"),
  dispatchedBy: uuid("dispatched_by").notNull().references(() => users.id),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }).notNull().defaultNow(),
  receivedByName: text("received_by_name"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
});

import { sql } from "drizzle-orm";
import { char, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { MONEY, QTY, createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";
import { customers, locations, products } from "./masterdata";
import { inventoryLots } from "./inventory";
import { customerAddresses, priceListLines, priceLists, quotes } from "./crm";
import { containers } from "./containers";

/** Sales order states (docs/data-model.md §6.5; transition table in src/modules/sales/orders.ts). */
export const SALES_ORDER_STATUSES = [
  "draft",
  "submitted",
  "pending_approval",
  "confirmed",
  "allocated",
  "picking",
  "packed",
  "partially_shipped",
  "shipped",
  "invoiced",
  "closed",
  "cancelled",
] as const;
export const CREDIT_CHECK_STATUSES = ["not_required", "pending", "passed", "failed", "overridden"] as const;
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

/**
 * status per SALES_ORDER_STATUSES. Wave 3 W3D columns (US-4-05): addresses, quote link, money totals
 * (sensitive: sales.price_list.view), the credit/approval check outcome and the `approval?` set
 * (SoD by setting approvals.sod.sales_order, A-PM-14).
 */
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
    // Wave 3 W3D (US-4-04, US-4-05)
    shipToAddressId: uuid("ship_to_address_id").references(() => customerAddresses.id),
    billToAddressId: uuid("bill_to_address_id").references(() => customerAddresses.id),
    /** Ship-to address text frozen at entry (printed on pick list / DR; the customer may move later). */
    shipToText: text("ship_to_text"),
    quoteId: uuid("quote_id").references(() => quotes.id),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    subtotalAmount: numeric("subtotal_amount", MONEY).notNull().default("0"),
    taxAmount: numeric("tax_amount", MONEY).notNull().default("0"),
    totalAmount: numeric("total_amount", MONEY).notNull().default("0"),
    creditCheckStatus: text("credit_check_status").notNull().default("pending"),
    /** Why approval is needed (codes + plain words, no credit figures) and the approval basis used. */
    approvalReasons: jsonb("approval_reasons").$type<{ code: string; message: string }[]>(),
    approvalBasis: jsonb("approval_basis").$type<Record<string, string | boolean>>(),
    /** Warnings found at submission (MOQ below requirement, lead time) when the policy only warns. */
    warnings: jsonb("warnings").$type<{ code: string; message: string }[]>(),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    cancelReason: text("cancel_reason"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("so_site_status_idx").on(t.siteId, t.status),
    index("so_customer_idx").on(t.customerId, t.status),
    check("so_status_ck", sql`${t.status} in (${inList(SALES_ORDER_STATUSES)})`),
    check("so_credit_check_ck", sql`${t.creditCheckStatus} in (${inList(CREDIT_CHECK_STATUSES)})`),
  ],
);

export const salesOrderLines = pgTable("sales_order_lines", {
  id: id(),
  salesOrderId: uuid("sales_order_id").notNull().references(() => salesOrders.id),
  lineNo: integer("line_no").notNull(),
  productId: uuid("product_id").notNull().references(() => products.id),
  qtyUnits: numeric("qty_units", QTY).notNull(),
  unitPrice: numeric("unit_price", MONEY).notNull().default("0"),
  // Wave 3 W3D (US-4-03, US-4-05): where the price came from and the requirements applied.
  /** price_list | quote | manual */
  priceSource: text("price_source").notNull().default("manual"),
  listUnitPrice: numeric("list_unit_price", MONEY),
  priceListId: uuid("price_list_id").references(() => priceLists.id),
  priceListLineId: uuid("price_list_line_id").references(() => priceListLines.id),
  discountPct: numeric("discount_pct", { precision: 9, scale: 4 }).notNull().default("0"),
  /** Approved customer requirement versions resolved at submission (ids + values, schema requirement_snapshot/v1). */
  requirementSnapshot: jsonb("requirement_snapshot").$type<Record<string, unknown>>(),
  /** Customer minimum remaining shelf life at dispatch for this line (from the approved requirement, else the customer default). */
  minRemainingShelfLifeDays: integer("min_remaining_shelf_life_days"),
  customerItemCode: text("customer_item_code"),
},
  // W4F load test (US-9-01): every order page, list and allocation reads lines by order; without it each read scanned the table.
  (t) => [index("sales_order_lines_order_idx").on(t.salesOrderId, t.lineNo)],
);

/** One row per sales order state change, written by transitionOrder (docs/data-model.md §6.1). */
export const salesOrderStateTransitions = pgTable(
  "sales_order_state_transitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    salesOrderId: uuid("sales_order_id").notNull().references(() => salesOrders.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    correlationId: uuid("correlation_id").notNull(),
  },
  (t) => [index("so_transitions_order_idx").on(t.salesOrderId, t.occurredAt)],
);

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

import { boolean, check, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { QTY, createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";
import { customers, locations, products } from "./masterdata";
import { inventoryLots, stockMovements } from "./inventory";
import { salesOrders, shipments } from "./sales";
import { containers } from "./containers";
import { deviations } from "./quality-ext";

/**
 * Wave 3 W3F: complaints, customer returns (E-4-05: US-4-15, US-4-16; docs/data-model.md §3.6, §3.8).
 * The recall explorer (US-4-17) is a query over the ledger (data-model §10) and has no tables.
 */

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

/* ------------------------------------------------------------------ complaints (US-4-15) */

/** Complaint state machine (`COMPLAINT_TRANSITIONS` in src/modules/quality/complaints-rules.ts). */
export const COMPLAINT_STATUSES = ["open", "investigating", "resolved", "closed"] as const;
/** How the complaint reached the company (capture aid, not a quality rule). */
export const COMPLAINT_CHANNELS = ["phone", "email", "visit", "sales_rep", "other"] as const;
/**
 * Result of checking the lot or box the customer named against the shipments recorded for that customer:
 * `verified` = shipped to this customer (shipment linked); `unverified` = the customer has no recorded
 * shipment yet (history before go-live); `mismatch` = recorded shipments exist but not of this lot
 * (accepted only when setting quality.complaint.require_shipment_match is off); `not_given` = no code.
 */
export const COMPLAINT_TRACE_MATCHES = ["verified", "unverified", "mismatch", "not_given"] as const;

/**
 * Customer complaint (W07-06, numbering CMP). `description` and `customer_response` are the customer-facing
 * texts; `internal_notes`, `investigation`, `root_cause` and `resolution` are internal and never printed on a
 * customer-facing document (docs/permissions-matrix.md §6 "Internal notes"). Category and severity come
 * from QA-configured lists (settings quality.complaint.categories / severity_levels).
 */
export const complaints = pgTable(
  "complaints",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    /** Site of the shipment or lot when known, else the site the complaint was logged at. */
    siteId: uuid("site_id").notNull().references(() => sites.id),
    complaintNumber: text("complaint_number").notNull(),
    status: text("status").notNull().default("open"),
    category: text("category").notNull(),
    severity: text("severity"),
    channel: text("channel").notNull().default("phone"),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    customerReference: text("customer_reference"),
    productId: uuid("product_id").references(() => products.id),
    lotId: uuid("lot_id").references(() => inventoryLots.id),
    containerId: uuid("container_id").references(() => containers.id),
    salesOrderId: uuid("sales_order_id").references(() => salesOrders.id),
    shipmentId: uuid("shipment_id").references(() => shipments.id),
    /** What the customer read from the label (lot or box code), kept verbatim. */
    reportedCode: text("reported_code"),
    traceMatch: text("trace_match").notNull().default("not_given"),
    description: text("description").notNull(),
    qtyAffected: numeric("qty_affected", QTY),
    sampleReturned: boolean("sample_returned").notNull().default(false),
    internalNotes: text("internal_notes"),
    investigation: text("investigation"),
    rootCause: text("root_cause"),
    resolution: text("resolution"),
    customerResponse: text("customer_response"),
    deviationId: uuid("deviation_id").references(() => deviations.id),
    /** Set when the classified severity is in quality.complaint.recall_review_severities (a prompt to QA and the owner, not a recall decision). */
    recallReviewFlagged: boolean("recall_review_flagged").notNull().default(false),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    receivedBy: uuid("received_by").notNull().references(() => users.id),
    classifiedBy: uuid("classified_by").references(() => users.id),
    classifiedAt: timestamp("classified_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").notNull().references(() => users.id),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_complaints_org_number").on(t.organizationId, t.complaintNumber),
    uniqueIndex("uq_complaints_org_idem").on(t.organizationId, t.idempotencyKey),
    index("ix_complaints_site_status").on(t.siteId, t.status),
    index("ix_complaints_customer").on(t.customerId),
    index("ix_complaints_lot").on(t.lotId),
    check("ck_complaints_status", sql`${t.status} in (${inList(COMPLAINT_STATUSES)})`),
    check("ck_complaints_channel", sql`${t.channel} in (${inList(COMPLAINT_CHANNELS)})`),
    check("ck_complaints_trace_match", sql`${t.traceMatch} in (${inList(COMPLAINT_TRACE_MATCHES)})`),
    check("ck_complaints_verified_shipment", sql`${t.traceMatch} <> 'verified' or ${t.shipmentId} is not null`),
    check("ck_complaints_qty", sql`${t.qtyAffected} is null or ${t.qtyAffected} > 0`),
    check("ck_complaints_resolved", sql`${t.status} not in ('resolved','closed') or (${t.resolution} is not null and ${t.resolvedBy} is not null and ${t.resolvedAt} is not null)`),
    check(
      "ck_complaints_closed",
      sql`(${t.status} = 'closed') = (${t.closedBy} is not null and ${t.closedAt} is not null and ${t.severity} is not null)`,
    ),
  ],
);

/** Records a complaint is linked to beyond its own columns (raised deviations, returns, further lots or boxes). */
export const COMPLAINT_LINK_KINDS = ["deviation", "customer_return", "lot", "container", "shipment"] as const;

export const complaintLinks = pgTable(
  "complaint_links",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    complaintId: uuid("complaint_id").notNull().references(() => complaints.id),
    linkKind: text("link_kind").notNull(),
    entityId: uuid("entity_id").notNull(),
    entityNumber: text("entity_number").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_complaint_links").on(t.complaintId, t.linkKind, t.entityId),
    index("ix_complaint_links_entity").on(t.linkKind, t.entityId),
    check("ck_complaint_links_kind", sql`${t.linkKind} in (${inList(COMPLAINT_LINK_KINDS)})`),
  ],
);

/** Complaint state log (data-model §6.1 shape). */
export const complaintStateTransitions = pgTable(
  "complaint_state_transitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    complaintId: uuid("complaint_id").notNull().references(() => complaints.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ix_complaint_transitions_complaint").on(t.complaintId, t.occurredAt)],
);

/* ------------------------------------------------------------------ customer returns (US-4-16) */

/** Customer return state machine (`RETURN_TRANSITIONS` in src/modules/sales/returns-rules.ts). */
export const CUSTOMER_RETURN_STATUSES = ["draft", "submitted", "approved", "received", "inspected", "closed", "cancelled"] as const;
export const RETURN_LINE_CONDITIONS = ["sellable", "damaged", "expired", "unknown"] as const;

/**
 * Customer return (W09-11, W07-09; numbering RT). Lines are scanned into a draft, submitted, approved
 * (sales.customer_return.approve, approver ≠ submitter while approvals.sod.customer_return is on) and
 * posted (sales.customer_return.post): each line becomes a new quarantine lot re-lotted from the shipped
 * lot (genealogy edge `returned`) and a `return` movement into a quarantine/recall location. QA then
 * dispositions the return lots through the normal lot decisions (W06); credit notes wait for Phase 6.
 */
export const customerReturns = pgTable(
  "customer_returns",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    returnNumber: text("return_number").notNull(),
    status: text("status").notNull().default("draft"),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    salesOrderId: uuid("sales_order_id").references(() => salesOrders.id),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
    complaintId: uuid("complaint_id").references(() => complaints.id),
    /** Shared reason code (reason_codes, category `return`). */
    reasonCode: text("reason_code").notNull(),
    reasonNote: text("reason_note"),
    /** Default destination for the lines (a quarantine/recall-class location of the site). */
    toLocationId: uuid("to_location_id").notNull().references(() => locations.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    /** Posting = physical receipt into quarantine (status received). */
    receivedBy: uuid("received_by").references(() => users.id),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    inspectedBy: uuid("inspected_by").references(() => users.id),
    inspectedAt: timestamp("inspected_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").notNull().references(() => users.id),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_customer_returns_org_number").on(t.organizationId, t.returnNumber),
    uniqueIndex("uq_customer_returns_org_idem").on(t.organizationId, t.idempotencyKey),
    index("ix_customer_returns_site_status").on(t.siteId, t.status),
    index("ix_customer_returns_shipment").on(t.shipmentId),
    check("ck_customer_returns_status", sql`${t.status} in (${inList(CUSTOMER_RETURN_STATUSES)})`),
    check("ck_customer_returns_submitted", sql`${t.status} in ('draft','cancelled') or (${t.submittedBy} is not null and ${t.submittedAt} is not null)`),
    check("ck_customer_returns_approved", sql`${t.status} not in ('approved','received','inspected','closed') or (${t.approvedBy} is not null and ${t.approvedAt} is not null)`),
    check("ck_customer_returns_received", sql`${t.status} not in ('received','inspected','closed') or (${t.receivedBy} is not null and ${t.receivedAt} is not null)`),
    check("ck_customer_returns_cancelled", sql`${t.status} <> 'cancelled' or ${t.cancelReason} is not null`),
  ],
);

export const customerReturnLines = pgTable(
  "customer_return_lines",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    customerReturnId: uuid("customer_return_id").notNull().references(() => customerReturns.id),
    lineNo: integer("line_no").notNull(),
    productId: uuid("product_id").references(() => products.id),
    /** The shipped lot the goods came from. */
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    /** The box scanned, when the goods came back in a labelled box. */
    containerId: uuid("container_id").references(() => containers.id),
    qtyBase: numeric("qty_base", QTY).notNull(),
    baseUom: text("base_uom").notNull(),
    condition: text("condition").notNull().default("unknown"),
    toLocationId: uuid("to_location_id").notNull().references(() => locations.id),
    /** The quarantine lot created at posting (origin_lot_id = lot_id). */
    returnLotId: uuid("return_lot_id").references(() => inventoryLots.id),
    stockMovementId: uuid("stock_movement_id").references(() => stockMovements.id),
    /** Raw scan payload (or the typed code) and whether it was typed by hand (audited, W09 exception path). */
    scanPayload: text("scan_payload"),
    manualEntry: boolean("manual_entry").notNull().default(false),
    note: text("note"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_customer_return_lines_no").on(t.customerReturnId, t.lineNo),
    // V-DUP: the same box is scanned once per return.
    uniqueIndex("uq_customer_return_lines_box").on(t.customerReturnId, t.containerId).where(sql`${t.containerId} is not null`),
    index("ix_customer_return_lines_lot").on(t.lotId),
    index("ix_customer_return_lines_return_lot").on(t.returnLotId),
    check("ck_customer_return_lines_qty", sql`${t.qtyBase} > 0`),
    check("ck_customer_return_lines_condition", sql`${t.condition} in (${inList(RETURN_LINE_CONDITIONS)})`),
    check("ck_customer_return_lines_posted", sql`(${t.stockMovementId} is null) = (${t.returnLotId} is null)`),
  ],
);

/** Customer return state log (data-model §6.1 shape). */
export const customerReturnStateTransitions = pgTable(
  "customer_return_state_transitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    customerReturnId: uuid("customer_return_id").notNull().references(() => customerReturns.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ix_customer_return_transitions_return").on(t.customerReturnId, t.occurredAt)],
);

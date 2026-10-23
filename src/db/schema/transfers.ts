import { check, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { QTY, createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";
import { locations } from "./masterdata";
import { inventoryLots, stockMovements } from "./inventory";
import { containers } from "./containers";

export const TRANSFER_KINDS = ["scan_move", "planned", "inter_site", "put_away", "status_location"] as const;
export const TRANSFER_STATUSES = ["draft", "in_progress", "completed", "cancelled"] as const;

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

/**
 * Source document behind source_document_type = 'transfer_request' (data-model §3.3). A scan-to-move
 * creates one with its lines and posts it in the same transaction. An undo by the actor (US-2-28)
 * leaves the request `completed` and records the undo columns; the ledger keeps both rows.
 */
export const transferRequests = pgTable(
  "transfer_requests",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    transferNumber: text("transfer_number").notNull(),
    transferKind: text("transfer_kind").notNull(),
    status: text("status").notNull().default("completed"),
    toSiteId: uuid("to_site_id").references(() => sites.id),
    containerId: uuid("container_id").references(() => containers.id),
    fromLocationId: uuid("from_location_id").references(() => locations.id),
    toLocationId: uuid("to_location_id").references(() => locations.id),
    reason: text("reason"),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    /** Session that posted the move; undo is allowed only from the same session (US-2-28 AC3). */
    sessionId: uuid("session_id"),
    idempotencyKey: text("idempotency_key"),
    /** Shared by every movement of the request (inter-site: the issue at A and the receipt at B). */
    correlationId: uuid("correlation_id").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: uuid("undone_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("transfer_requests_org_number_uq").on(t.organizationId, t.transferNumber),
    index("transfer_requests_site_time_idx").on(t.siteId, t.createdAt),
    index("transfer_requests_container_idx").on(t.containerId),
    check("ck_transfer_requests_kind", sql`${t.transferKind} in (${inList(TRANSFER_KINDS)})`),
    check("ck_transfer_requests_status", sql`${t.status} in (${inList(TRANSFER_STATUSES)})`),
    check("ck_transfer_requests_to_site", sql`(${t.transferKind} = 'inter_site') = (${t.toSiteId} is not null)`),
    check("ck_transfer_requests_undo", sql`(${t.undoneAt} is null) = (${t.undoneBy} is null)`),
  ],
);

export const transferRequestLines = pgTable(
  "transfer_request_lines",
  {
    id: id(),
    transferRequestId: uuid("transfer_request_id").notNull().references(() => transferRequests.id),
    lineNo: integer("line_no").notNull(),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    containerId: uuid("container_id").references(() => containers.id),
    fromLocationId: uuid("from_location_id").notNull().references(() => locations.id),
    toLocationId: uuid("to_location_id").notNull().references(() => locations.id),
    qtyBase: numeric("qty_base", QTY).notNull(),
    /** transfer movement (same site) or the issue at the source site (inter-site). */
    issueMovementId: uuid("issue_movement_id").references(() => stockMovements.id),
    /** inter-site only: the receipt at the destination site. */
    receiptMovementId: uuid("receipt_movement_id").references(() => stockMovements.id),
    /** inter-site only: the lot created at the destination site (origin_lot_id = lotId). */
    destinationLotId: uuid("destination_lot_id").references(() => inventoryLots.id),
    /** Undo by actor: the linked reversal movement. */
    reversalMovementId: uuid("reversal_movement_id").references(() => stockMovements.id),
    status: text("status").notNull().default("posted"),
  },
  (t) => [
    uniqueIndex("transfer_request_lines_uq").on(t.transferRequestId, t.lineNo),
    index("transfer_request_lines_lot_idx").on(t.lotId),
    check("ck_transfer_request_lines_status", sql`${t.status} in ('pending','posted','cancelled')`),
    check("ck_transfer_request_lines_qty", sql`${t.qtyBase} > 0`),
  ],
);

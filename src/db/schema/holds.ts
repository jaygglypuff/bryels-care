import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";
import { locations } from "./masterdata";
import { inventoryLots } from "./inventory";
import { dispositions } from "./quality";

/**
 * Quality hold on a lot or on a location (docs/data-model.md §3.6, §6.7; US-2-10).
 * status: open → investigating → closed (open → closed allowed). While open, every lot it names is
 * on_hold and the location (when named) refuses stock movements into it. Lifting is done by a
 * quality.hold.approve holder who is not the opener, with a resolution and a closing disposition.
 */
export const qualityHolds = pgTable(
  "quality_holds",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    holdNumber: text("hold_number").notNull(),
    status: text("status").notNull().default("open"),
    lotId: uuid("lot_id").references(() => inventoryLots.id),
    locationId: uuid("location_id").references(() => locations.id),
    reasonCode: text("reason_code").notNull(),
    reason: text("reason").notNull(),
    openedBy: uuid("opened_by").notNull().references(() => users.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    /** released | rejected (rework and recalled arrive with Phase 3 and Phase 6 flows). */
    resolution: text("resolution"),
    closeReason: text("close_reason"),
    closedBy: uuid("closed_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").notNull().references(() => users.id),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_quality_holds_org_number").on(t.organizationId, t.holdNumber),
    uniqueIndex("uq_quality_holds_org_idem").on(t.organizationId, t.idempotencyKey),
    index("ix_quality_holds_site_status").on(t.siteId, t.status),
    index("ix_quality_holds_lot").on(t.lotId),
    index("ix_quality_holds_location").on(t.locationId),
    check("ck_quality_holds_status", sql`${t.status} in ('open','investigating','closed')`),
    check("ck_quality_holds_scope", sql`num_nonnulls(${t.lotId}, ${t.locationId}) >= 1`),
    check("ck_quality_holds_resolution", sql`${t.resolution} is null or ${t.resolution} in ('released','rejected','rework','recalled')`),
    check("ck_quality_holds_closed", sql`(${t.status} = 'closed') = (${t.closedBy} is not null and ${t.closedAt} is not null and ${t.resolution} is not null)`),
  ],
);

/** Each lot a hold put on hold, with its status before the hold and the dispositions that placed and closed it. */
export const qualityHoldLots = pgTable(
  "quality_hold_lots",
  {
    id: id(),
    qualityHoldId: uuid("quality_hold_id").notNull().references(() => qualityHolds.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    previousStatus: text("previous_status").notNull(),
    holdDispositionId: uuid("hold_disposition_id").references(() => dispositions.id),
    closingDispositionId: uuid("closing_disposition_id").references(() => dispositions.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("uq_quality_hold_lots_pair").on(t.qualityHoldId, t.lotId), index("ix_quality_hold_lots_lot").on(t.lotId)],
);

/** State transition log of quality holds (data-model §6.1 shape). */
export const qualityHoldStateTransitions = pgTable(
  "quality_hold_state_transitions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    qualityHoldId: uuid("quality_hold_id").notNull().references(() => qualityHolds.id),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ix_quality_hold_transitions_hold").on(t.qualityHoldId, t.occurredAt)],
);

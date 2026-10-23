import { boolean, check, index, numeric, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { QTY, createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";
import { locations } from "./masterdata";
import { inventoryLots } from "./inventory";

/** Allowed container kinds (data-model §3.3). `loose` = an unpackaged counted unit at the opening load. */
export const CONTAINER_KINDS = ["box", "carton", "pallet", "drum", "tote", "sack", "bag", "bottle", "loose"] as const;
/** Container state machine values (`containerMachine` in src/modules/inventory/containers.ts). */
export const CONTAINER_STATUSES = ["open", "sealed", "in_transit", "shipped", "empty", "void"] as const;
export const CONTAINER_OPERATIONS = ["split", "merge", "repack"] as const;

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

/**
 * A box / carton / pallet with a unique number (rule BOX, scan BC:BOX:<number>). Status is the
 * container's own life cycle; quality status is always the lot's (boxes inherit it, never copy it).
 */
export const containers = pgTable(
  "containers",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    containerNumber: text("container_number").notNull(),
    containerKind: text("container_kind").notNull().default("box"),
    status: text("status").notNull().default("open"),
    currentLocationId: uuid("current_location_id").references(() => locations.id),
    parentContainerId: uuid("parent_container_id").references((): AnyPgColumn => containers.id),
    packedAt: timestamp("packed_at", { withTimezone: true }),
    packedBy: uuid("packed_by").references(() => users.id),
    isPartial: boolean("is_partial").notNull().default(false),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("containers_org_number_uq").on(t.organizationId, t.containerNumber),
    index("containers_site_location_idx").on(t.siteId, t.currentLocationId),
    check("ck_containers_kind", sql`${t.containerKind} in (${inList(CONTAINER_KINDS)})`),
    check("ck_containers_status", sql`${t.status} in (${inList(CONTAINER_STATUSES)})`),
  ],
);

/** Current contents of a container; history is in stock_movements.meta.containerId and container_lineage. */
export const containerContents = pgTable(
  "container_contents",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    containerId: uuid("container_id").notNull().references(() => containers.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    qtyBase: numeric("qty_base", QTY).notNull().default("0"),
    baseUom: text("base_uom").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("container_contents_container_lot_uq").on(t.containerId, t.lotId),
    index("container_contents_lot_idx").on(t.lotId),
    check("ck_container_contents_qty", sql`${t.qtyBase} >= 0`),
  ],
);

/** Append-only lineage ledger: one row per parent → child edge and lot of a split, merge or repack. */
export const containerLineage = pgTable(
  "container_lineage",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    operation: text("operation").notNull(),
    /** Groups the edges written by one command. */
    operationId: uuid("operation_id").notNull(),
    parentContainerId: uuid("parent_container_id").notNull().references(() => containers.id),
    childContainerId: uuid("child_container_id").notNull().references(() => containers.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    qtyBase: numeric("qty_base", QTY).notNull(),
    reason: text("reason"),
    performedBy: uuid("performed_by").notNull().references(() => users.id),
    performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("container_lineage_parent_idx").on(t.parentContainerId),
    index("container_lineage_child_idx").on(t.childContainerId),
    check("ck_container_lineage_operation", sql`${t.operation} in (${inList(CONTAINER_OPERATIONS)})`),
    check("ck_container_lineage_not_self", sql`${t.parentContainerId} <> ${t.childContainerId}`),
    check("ck_container_lineage_qty", sql`${t.qtyBase} > 0`),
  ],
);

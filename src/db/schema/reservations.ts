import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { QTY, createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";
import { customers, locations, materials, products } from "./masterdata";
import { inventoryLots } from "./inventory";
import { containers } from "./containers";

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

export const RESERVATION_DEMAND_TYPES = ["sales_order_line", "work_order", "batch", "transfer_request", "manual"] as const;
export const RESERVATION_STATUSES = ["active", "converted", "released", "expired", "cancelled"] as const;

/**
 * Soft hold on specific stock (lot- and location-specific, A-DM-22). Active reservations reduce
 * available-to-promise. A reservation past expires_at counts as expired even before the sweep marks it.
 */
export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    reservationNumber: text("reservation_number").notNull(),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    locationId: uuid("location_id").notNull().references(() => locations.id),
    containerId: uuid("container_id").references(() => containers.id),
    qtyBase: numeric("qty_base", QTY).notNull(),
    baseUom: text("base_uom").notNull(),
    demandType: text("demand_type").notNull(),
    demandId: uuid("demand_id"),
    /** Human reference for the demand (order number, batch number, or free text for manual holds). */
    demandReference: text("demand_reference").notNull(),
    status: text("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: uuid("released_by").references(() => users.id),
    releasedReason: text("released_reason"),
    idempotencyKey: text("idempotency_key"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("stock_reservations_org_number_uq").on(t.organizationId, t.reservationNumber),
    index("stock_reservations_lot_location_idx").on(t.lotId, t.locationId),
    index("stock_reservations_site_status_idx").on(t.siteId, t.status),
    index("stock_reservations_demand_idx").on(t.demandType, t.demandId),
    check("ck_stock_reservations_qty", sql`${t.qtyBase} > 0`),
    check("ck_stock_reservations_demand_type", sql`${t.demandType} in (${inList(RESERVATION_DEMAND_TYPES)})`),
    check("ck_stock_reservations_status", sql`${t.status} in (${inList(RESERVATION_STATUSES)})`),
    check("ck_stock_reservations_release", sql`${t.status} in ('active','expired','converted') or ${t.releasedReason} is not null`),
  ],
);

export const ALLOCATION_RULE_SCOPES = ["default", "material_kind", "material", "product", "customer"] as const;
export const ALLOCATION_STRATEGIES = ["fefo", "fifo"] as const;

/**
 * FEFO/FIFO rule catalogue (A-PRD-16, Q-B-07). Precedence: customer > product or material >
 * material kind > organization default > built-in FEFO (expiry first, lots without expiry FIFO).
 * Rules are company policy: confirmed by the process owners, never hard-coded.
 */
export const allocationRules = pgTable(
  "allocation_rules",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    scope: text("scope").notNull(),
    materialKind: text("material_kind"),
    materialId: uuid("material_id").references(() => materials.id),
    productId: uuid("product_id").references(() => products.id),
    customerId: uuid("customer_id").references(() => customers.id),
    strategy: text("strategy").notNull().default("fefo"),
    /** Optional minimum remaining shelf life (days) a candidate lot must have under this rule. */
    minShelfLifeDays: integer("min_shelf_life_days"),
    isActive: boolean("is_active").notNull().default(true),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("allocation_rules_org_scope_idx").on(t.organizationId, t.scope),
    check("ck_allocation_rules_scope", sql`${t.scope} in (${inList(ALLOCATION_RULE_SCOPES)})`),
    check("ck_allocation_rules_strategy", sql`${t.strategy} in (${inList(ALLOCATION_STRATEGIES)})`),
    check(
      "ck_allocation_rules_scope_ref",
      sql`(${t.scope} = 'default' and num_nonnulls(${t.materialKind}, ${t.materialId}, ${t.productId}, ${t.customerId}) = 0)
       or (${t.scope} = 'material_kind' and ${t.materialKind} is not null and num_nonnulls(${t.materialId}, ${t.productId}, ${t.customerId}) = 0)
       or (${t.scope} = 'material' and ${t.materialId} is not null and num_nonnulls(${t.materialKind}, ${t.productId}, ${t.customerId}) = 0)
       or (${t.scope} = 'product' and ${t.productId} is not null and num_nonnulls(${t.materialKind}, ${t.materialId}, ${t.customerId}) = 0)
       or (${t.scope} = 'customer' and ${t.customerId} is not null and num_nonnulls(${t.materialKind}, ${t.materialId}) = 0)`,
    ),
  ],
);

/**
 * Inventory policy settings (organization- or site-scoped key/value). Keys and defaults live in
 * src/modules/inventory/policy.ts; a missing row means the registry default applies. Interim home
 * until the platform settings table (data-model §3.1) ships.
 */
export const inventorySettings = pgTable(
  "inventory_settings",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [unique("inventory_settings_uq").on(t.organizationId, t.siteId, t.key).nullsNotDistinct()],
);

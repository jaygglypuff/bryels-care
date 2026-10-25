/**
 * Master data administration (Wave 2 stream W2G; backlog E-1-08, US-1-20..US-1-24;
 * docs/data-model.md §3.1, §3.2): departments, production lines, warehouse special-location
 * designations, units of measure and versioned conversions, SKUs and the shared reason-code list.
 *
 * Organization-structure rows are deactivated, never deleted (`is_active` / `status`). Codes are
 * scan-grammar safe (`^[A-Z0-9][A-Z0-9._-]{0,63}$`, src/lib/scan) where they can appear on a
 * label. The dimension rule of `uom_conversions` is also enforced by the trigger
 * `tg_uom_conversions_dimension` in src/db/sql/w2g.sql.
 */
import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { QTY, createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";
import { locations, materials, products, warehouses } from "./masterdata";

const SCAN_CODE_CK = `'^[A-Z0-9][A-Z0-9._-]{0,63}$'`;

/* ------------------------------------------------------------------ organization structure */

/** Departments of a site, e.g. Production, Warehouse, QA (printed on the BMR header via the line). */
export const departments = pgTable(
  "departments",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("departments_site_code_uq").on(t.siteId, t.code), check("departments_code_ck", sql.raw(`code ~ ${SCAN_CODE_CK}`))],
);

/** Production lines of a site; equipment links to a line through equipment.production_line_id. */
export const productionLines = pgTable(
  "production_lines",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    departmentId: uuid("department_id").references(() => departments.id),
    /** active | down | inactive (US-1-20; state machine LINE_TRANSITIONS in src/modules/masterdata/lines.ts) */
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("production_lines_site_code_uq").on(t.siteId, t.code),
    check("production_lines_status_ck", sql`${t.status} in ('active', 'down', 'inactive')`),
    check("production_lines_code_ck", sql.raw(`code ~ ${SCAN_CODE_CK}`)),
  ],
);

/**
 * Special-location designation per warehouse (US-1-20 AC1): which location receives, stages,
 * quarantines, holds, rejects and isolates recalled stock. One location per role per warehouse;
 * the location's kind must match the role (service check).
 */
export const SPECIAL_LOCATION_ROLES = ["receiving", "staging", "quarantine", "hold", "rejected", "recall"] as const;
export const warehouseSpecialLocations = pgTable(
  "warehouse_special_locations",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id),
    role: text("role").notNull(),
    locationId: uuid("location_id").notNull().references(() => locations.id),
    designatedBy: uuid("designated_by").references(() => users.id),
    designatedAt: timestamp("designated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("warehouse_special_locations_uq").on(t.warehouseId, t.role),
    check("warehouse_special_locations_role_ck", sql`${t.role} in ('receiving', 'staging', 'quarantine', 'hold', 'rejected', 'recall')`),
  ],
);

/* ------------------------------------------------------------------ units of measure (ADR-010) */

export const UOM_DIMENSIONS = ["mass", "volume", "count", "length"] as const;

/** Units of measure; one base unit per dimension (g, mL, pcs). Codes are immutable (stored as text on lots and movements). */
export const uoms = pgTable(
  "uoms",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    dimension: text("dimension").notNull(),
    isBase: boolean("is_base").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uoms_org_code_uq").on(t.organizationId, t.code),
    uniqueIndex("uoms_one_base_per_dimension_uq").on(t.organizationId, t.dimension).where(sql`${t.isBase}`),
    check("uoms_dimension_ck", sql`${t.dimension} in ('mass', 'volume', 'count', 'length')`),
    check("uoms_code_ck", sql`${t.code} ~ '^[A-Za-z][A-Za-z0-9_]{0,15}$'`),
  ],
);

/**
 * Versioned conversions: qty_to = qty_from × factor. A conversion between different dimensions
 * (g → mL) needs a material (density) — service rule plus trigger tg_uom_conversions_dimension.
 * status: pending_approval → approved | rejected; approved → retired (superseded by the next
 * approved version). The approver must differ from the submitter (second user, US-1-21).
 */
export const uomConversions = pgTable(
  "uom_conversions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    fromUomId: uuid("from_uom_id").notNull().references(() => uoms.id),
    toUomId: uuid("to_uom_id").notNull().references(() => uoms.id),
    factor: numeric("factor", { precision: 24, scale: 12 }).notNull(),
    materialId: uuid("material_id").references(() => materials.id),
    revisionNo: integer("revision_no").notNull().default(1),
    status: text("status").notNull().default("pending_approval"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => uomConversions.id),
    changeReason: text("change_reason"),
    /** Reference data installed by the system (seed), not entered by a person. */
    isSystem: boolean("is_system").notNull().default(false),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uom_conv_approved_generic_uq").on(t.organizationId, t.fromUomId, t.toUomId).where(sql`${t.status} = 'approved' and ${t.materialId} is null`),
    uniqueIndex("uom_conv_approved_material_uq").on(t.organizationId, t.fromUomId, t.toUomId, t.materialId).where(sql`${t.status} = 'approved' and ${t.materialId} is not null`),
    uniqueIndex("uom_conv_pending_generic_uq").on(t.organizationId, t.fromUomId, t.toUomId).where(sql`${t.status} = 'pending_approval' and ${t.materialId} is null`),
    uniqueIndex("uom_conv_pending_material_uq").on(t.organizationId, t.fromUomId, t.toUomId, t.materialId).where(sql`${t.status} = 'pending_approval' and ${t.materialId} is not null`),
    index("uom_conv_material_idx").on(t.materialId),
    check("uom_conv_factor_ck", sql`${t.factor} > 0`),
    check("uom_conv_distinct_ck", sql`${t.fromUomId} <> ${t.toUomId}`),
    check("uom_conv_status_ck", sql`${t.status} in ('pending_approval', 'approved', 'rejected', 'retired')`),
    check("uom_conv_approved_ck", sql`${t.status} not in ('approved', 'retired') or (${t.approvedAt} is not null and (${t.approvedBy} is not null or ${t.isSystem}))`),
  ],
);

/* ------------------------------------------------------------------ SKUs (US-1-22) */

/** Sellable / packable variant of a product (scan BC:SKU:<code>). Packaging configuration beyond these basics is Phase 4. */
export const skus = pgTable(
  "skus",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    variantLabel: text("variant_label"),
    packFormat: text("pack_format"),
    netContentQty: numeric("net_content_qty", QTY),
    netContentUomId: uuid("net_content_uom_id").references(() => uoms.id),
    uomBaseId: uuid("uom_base_id").notNull().references(() => uoms.id),
    unitsPerBox: integer("units_per_box"),
    boxesPerPallet: integer("boxes_per_pallet"),
    gtin: text("gtin"),
    shelfLifeDays: integer("shelf_life_days"),
    retestDays: integer("retest_days"),
    storageConditions: text("storage_conditions"),
    allocationRule: text("allocation_rule").notNull().default("fefo"),
    /** draft | active | discontinued (SKU_TRANSITIONS in src/modules/masterdata/products.ts) */
    status: text("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("skus_org_code_uq").on(t.organizationId, t.code),
    index("skus_product_idx").on(t.productId),
    check("skus_code_ck", sql.raw(`code ~ ${SCAN_CODE_CK}`)),
    check("skus_status_ck", sql`${t.status} in ('draft', 'active', 'discontinued')`),
    check("skus_allocation_ck", sql`${t.allocationRule} in ('fefo', 'fifo')`),
    check("skus_pack_ck", sql`coalesce(${t.unitsPerBox}, 1) > 0 and coalesce(${t.boxesPerPallet}, 1) > 0`),
    check("skus_days_ck", sql`coalesce(${t.shelfLifeDays}, 1) > 0 and coalesce(${t.retestDays}, 1) > 0`),
    check("skus_net_content_ck", sql`${t.netContentQty} is null or (${t.netContentQty} > 0 and ${t.netContentUomId} is not null)`),
    check("skus_gtin_ck", sql`${t.gtin} is null or ${t.gtin} ~ '^[0-9]{8,14}$'`),
  ],
);

/* ------------------------------------------------------------------ reason codes (US-1-24) */

export const REASON_CATEGORIES = [
  "adjustment",
  "transfer",
  "receipt",
  "disposition",
  "sample",
  "scrap",
  "rework",
  "return",
  "count_variance",
  "hold",
  "reprint",
  "deviation",
  "reversal",
  "exception",
  "cancel",
  "downtime",
  "audit",
] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

/**
 * One shared, controlled reason list (docs/data-model.md §3.2). Codes are immutable because
 * history stores them as text; a deactivated code stays readable on old records but cannot be
 * chosen for new ones. requires_approval is read by the approval services.
 */
export const reasonCodes = pgTable(
  "reason_codes",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    appliesTo: text("applies_to").array().notNull(),
    requiresNote: boolean("requires_note").notNull().default(false),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(100),
    isActive: boolean("is_active").notNull().default(true),
    /** Installed with the reference data (seed); content still owned by the company. */
    isSystem: boolean("is_system").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("reason_codes_org_code_uq").on(t.organizationId, t.code),
    index("reason_codes_applies_to_idx").using("gin", t.appliesTo),
    check("reason_codes_code_ck", sql`${t.code} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check("reason_codes_applies_to_ck", sql.raw(`cardinality(applies_to) >= 1 and applies_to <@ array[${REASON_CATEGORIES.map((c) => `'${c}'`).join(", ")}]::text[]`)),
  ],
);

import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, date, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { QTY, createdAt, id } from "./_common";
import { organizations, sites, users } from "./identity";

export const warehouses = pgTable(
  "warehouses",
  {
    id: id(),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("warehouses_site_code_uq").on(t.siteId, t.code)],
);

/** kind: receiving | storage | quarantine | hold | rejected | production | shipping */
export const locations = pgTable(
  "locations",
  {
    id: id(),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("locations_site_code_uq").on(t.siteId, t.code)],
);

/** Raw materials, intermediates and packaging. Base unit is g, mL or pcs. */
export const materials = pgTable(
  "materials",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    inciName: text("inci_name"),
    /** raw_material | intermediate | packaging */
    materialKind: text("material_kind").notNull().default("raw_material"),
    baseUom: text("base_uom").notNull().default("g"),
    shelfLifeDays: integer("shelf_life_days"),
    storageConditions: text("storage_conditions"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("materials_org_code_uq").on(t.organizationId, t.code)],
);

/** Finished goods (SKU level for the MVP). */
export const products = pgTable(
  "products",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    skuCode: text("sku_code").notNull(),
    name: text("name").notNull(),
    family: text("family").notNull(),
    baseUom: text("base_uom").notNull().default("pcs"),
    /** Net mass per unit in grams, used to convert batch mass to units. */
    unitNetMassG: numeric("unit_net_mass_g", QTY).notNull(),
    unitsPerBox: integer("units_per_box").notNull().default(24),
    shelfLifeDays: integer("shelf_life_days").notNull().default(730),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("products_org_sku_uq").on(t.organizationId, t.skuCode)],
);

export const formulas = pgTable(
  "formulas",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("formulas_org_code_uq").on(t.organizationId, t.code)],
);

/**
 * Versioned formula content (docs/data-model.md §3.2, §4; US-3-01).
 * status: draft → pending_approval → approved | rejected; approved → retired (state machine in
 * src/modules/masterdata/versioning.ts). An approved revision is immutable; a change is a new
 * revision. effective_from inclusive, effective_to exclusive (null = open-ended). "Superseded" is
 * a derived label (approved with effective_to in the past), never a stored state.
 * Approval is two steps (qa_qc, then site_manager/owner_director) recorded in approval_decisions;
 * approved_by holds the final step. Overlap of approved ranges is blocked in the service under a
 * formula row lock and by the exclusion constraint in src/db/sql/w1d.sql.
 */
export const formulaRevisions = pgTable(
  "formula_revisions",
  {
    id: id(),
    formulaId: uuid("formula_id").notNull().references(() => formulas.id),
    revisionNo: integer("revision_no").notNull(),
    status: text("status").notNull().default("draft"),
    referenceBatchSizeG: numeric("reference_batch_size_g", QTY).notNull(),
    theoreticalYieldPct: numeric("theoretical_yield_pct", QTY).notNull().default("100"),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => formulaRevisions.id),
    changeSummary: text("change_summary"),
    createdBy: uuid("created_by").references(() => users.id),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("formula_rev_uq").on(t.formulaId, t.revisionNo),
    /** At most one open (draft or pending) revision per formula. */
    uniqueIndex("formula_rev_one_open_uq").on(t.formulaId).where(sql`${t.status} in ('draft', 'pending_approval')`),
    check("formula_rev_status_ck", sql`${t.status} in ('draft', 'pending_approval', 'approved', 'rejected', 'retired')`),
    check("formula_rev_sod_ck", sql`${t.approvedBy} is null or ${t.approvedBy} is distinct from ${t.submittedBy}`),
    check("formula_rev_effective_ck", sql`${t.status} not in ('approved', 'retired') or (${t.effectiveFrom} is not null and ${t.approvedBy} is not null)`),
    check("formula_rev_range_ck", sql`${t.effectiveTo} is null or ${t.effectiveFrom} is null or ${t.effectiveTo} > ${t.effectiveFrom}`),
    check("formula_rev_size_ck", sql`${t.referenceBatchSizeG} > 0`),
    check("formula_rev_yield_ck", sql`${t.theoreticalYieldPct} > 0 and ${t.theoreticalYieldPct} <= 100`),
  ],
);

/**
 * Ingredient lines per revision (quantities per reference batch size). Exactly one of
 * tolerance_pct / tolerance_abs_g (A-DM-17, A-PROC-03: no system default; seed values are
 * fictional placeholders). Editable only while the parent revision is draft (service + trigger
 * tg_bom_lines_parent_draft in src/db/sql/w1d.sql).
 */
export const bomLines = pgTable(
  "bom_lines",
  {
    id: id(),
    formulaRevisionId: uuid("formula_revision_id").notNull().references(() => formulaRevisions.id),
    lineNo: integer("line_no").notNull(),
    materialId: uuid("material_id").notNull().references(() => materials.id),
    quantityG: numeric("quantity_g", QTY).notNull(),
    tolerancePct: numeric("tolerance_pct", QTY),
    toleranceAbsG: numeric("tolerance_abs_g", QTY),
    /** e.g. oils, lye, additives */
    phaseCode: text("phase_code"),
    /** proportional | fixed */
    scaling: text("scaling").notNull().default("proportional"),
    isCritical: boolean("is_critical").notNull().default(true),
    requiresChecker: boolean("requires_checker").notNull().default(true),
  },
  (t) => [
    uniqueIndex("bom_lines_rev_line_uq").on(t.formulaRevisionId, t.lineNo),
    check("bom_lines_tolerance_one_ck", sql`num_nonnulls(${t.tolerancePct}, ${t.toleranceAbsG}) = 1`),
    check("bom_lines_tolerance_non_negative_ck", sql`coalesce(${t.tolerancePct}, 0) >= 0 and coalesce(${t.toleranceAbsG}, 0) >= 0`),
    check("bom_lines_qty_ck", sql`${t.quantityG} > 0`),
    check("bom_lines_scaling_ck", sql`${t.scaling} in ('proportional', 'fixed')`),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    shipToAddress: text("ship_to_address").notNull(),
    /** Minimum remaining shelf life required at shipment, in days. */
    minShelfLifeDays: integer("min_shelf_life_days").notNull().default(180),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("customers_org_code_uq").on(t.organizationId, t.code)],
);

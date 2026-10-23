import { boolean, integer, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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

/** status: draft | pending_approval | approved | superseded. Batches snapshot the revision used. */
export const formulaRevisions = pgTable(
  "formula_revisions",
  {
    id: id(),
    formulaId: uuid("formula_id").notNull().references(() => formulas.id),
    revisionNo: integer("revision_no").notNull(),
    status: text("status").notNull().default("draft"),
    referenceBatchSizeG: numeric("reference_batch_size_g", QTY).notNull(),
    theoreticalYieldPct: numeric("theoretical_yield_pct", QTY).notNull().default("100"),
    submittedBy: uuid("submitted_by").references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("formula_rev_uq").on(t.formulaId, t.revisionNo)],
);

/** Ingredient lines. tolerancePct is a placeholder until process owners approve real limits (A-PROC-03). */
export const bomLines = pgTable("bom_lines", {
  id: id(),
  formulaRevisionId: uuid("formula_revision_id").notNull().references(() => formulaRevisions.id),
  lineNo: integer("line_no").notNull(),
  materialId: uuid("material_id").notNull().references(() => materials.id),
  quantityG: numeric("quantity_g", QTY).notNull(),
  tolerancePct: numeric("tolerance_pct", QTY).notNull(),
});

/** Routing / checklist steps of a formula revision (from the paper BMR's 7 steps). */
export const routingSteps = pgTable("routing_steps", {
  id: id(),
  formulaRevisionId: uuid("formula_revision_id").notNull().references(() => formulaRevisions.id),
  stepNo: integer("step_no").notNull(),
  name: text("name").notNull(),
  /** clearance | weighing | process | packaging | transfer */
  stepKind: text("step_kind").notNull(),
  instruction: text("instruction"),
  requiresChecker: boolean("requires_checker").notNull().default(true),
});

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

import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { QTY, createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";
import { LOCATION_SECTIONS } from "../../lib/location-sections";

export const warehouses = pgTable(
  "warehouses",
  {
    id: id(),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** raw_materials | packaging | finished_goods | general (W2G, US-1-20) */
    warehouseKind: text("warehouse_kind").notNull().default("general"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("warehouses_site_code_uq").on(t.siteId, t.code),
    check("warehouses_kind_ck", sql`${t.warehouseKind} in ('raw_materials', 'packaging', 'finished_goods', 'general')`),
  ],
);

/**
 * kind (location class): receiving | staging | storage | quarantine | hold | rejected | recall |
 * production | shipping. status: active | blocked (no movements in or out) | inactive
 * (deactivated; is_active mirrors status <> 'inactive'). parent_location_id builds the
 * zone → rack → bin tree (W2G, US-1-20).
 * section (S6, ADR-077): the warehouse section an operator sees (LOCATION_SECTIONS); null = derived
 * from kind and warehouse kind (src/modules/inventory/sections.ts `sectionOf`).
 */
export { LOCATION_SECTIONS };

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
    parentLocationId: uuid("parent_location_id").references((): AnyPgColumn => locations.id),
    status: text("status").notNull().default("active"),
    isPickable: boolean("is_pickable").notNull().default(true),
    section: text("section"),
  },
  (t) => [
    uniqueIndex("locations_site_code_uq").on(t.siteId, t.code),
    check("locations_section_ck", sql`${t.section} is null or ${t.section} in (${sql.raw(LOCATION_SECTIONS.map((x) => `'${x}'`).join(", "))})`),
    index("locations_parent_idx").on(t.parentLocationId),
    check("locations_status_ck", sql`${t.status} in ('active', 'blocked', 'inactive')`),
    check("locations_active_status_ck", sql`${t.isActive} = (${t.status} <> 'inactive')`),
    check("locations_kind_ck", sql`${t.kind} in ('receiving', 'staging', 'storage', 'quarantine', 'hold', 'rejected', 'recall', 'production', 'shipping')`),
  ],
);

/**
 * Raw materials, intermediates, packaging and consumables. base_uom is the code of a base unit in
 * `uoms` (g, mL, pcs; validated by the W2G service). material_kind raw_material = class "raw" of
 * docs/data-model.md §3.2. status: draft | active | blocked | discontinued (MATERIAL_TRANSITIONS
 * in src/modules/masterdata/materials.ts).
 */
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
    /** A lot of this material cannot be released until a CoA is attached (US-2-08; set by QA, A-W1B-03). */
    requiresCoa: boolean("requires_coa").notNull().default(false),
    /** false = lots are created released at receipt (QA-configured "release on receipt" class, A-PROC-10). */
    requiresIncomingInspection: boolean("requires_incoming_inspection").notNull().default(true),
    // W2G (US-1-23) basic fields
    commonName: text("common_name"),
    retestDays: integer("retest_days"),
    allergenNotes: text("allergen_notes"),
    hazardNotes: text("hazard_notes"),
    allocationRule: text("allocation_rule").notNull().default("fefo"),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    // ADR-076: grouping, usual brand and standard pack size.
    /** Code of an active value of the editable list `material_category` (lookup_values); null = not grouped. */
    category: text("category"),
    /** Usual brand bought (a default; each receipt line records the brand actually delivered). */
    brand: text("brand"),
    /** Standard pack (e.g. 18 L tin, 25 kg bag): default quantity when receiving and ordering. Unit converts to base_uom. */
    standardPackQty: numeric("standard_pack_qty", QTY),
    standardPackUom: text("standard_pack_uom"),
  },
  (t) => [
    uniqueIndex("materials_org_code_uq").on(t.organizationId, t.code),
    check("materials_standard_pack_ck", sql`(${t.standardPackQty} is null) = (${t.standardPackUom} is null) and (${t.standardPackQty} is null or ${t.standardPackQty} > 0)`),
    check("materials_kind_ck", sql`${t.materialKind} in ('raw_material', 'intermediate', 'packaging', 'consumable')`),
    check("materials_status_ck", sql`${t.status} in ('draft', 'active', 'blocked', 'discontinued')`),
    check("materials_allocation_ck", sql`${t.allocationRule} in ('fefo', 'fifo')`),
  ],
);

/**
 * Finished goods (SKU level for the MVP: batches and order lines point here). sku_code is the
 * product code (column name kept from the MVP). Sellable/packable variants live in `skus`
 * (src/db/schema/org.ts). status: draft | active | discontinued (W2G, US-1-22).
 */
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
    status: text("status").notNull().default("active"),
    storageConditions: text("storage_conditions"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("products_org_sku_uq").on(t.organizationId, t.skuCode), check("products_status_ck", sql`${t.status} in ('draft', 'active', 'discontinued')`)],
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
    // Wave 3 W3D (US-4-01): profile, terms and credit. `ship_to_address`, `contact_*` above mirror the
    // default ship-to address and the primary contact (customer_addresses / customer_contacts in crm.ts)
    // so documents built before Wave 3 keep working. Credit and tax fields are sensitive
    // (finance.credit_terms.view); `tax_identifier` format is configuration for qualified review.
    status: text("status").notNull().default("active"),
    segment: text("segment"),
    currency: text("currency").notNull().default("PHP"),
    paymentTermsDays: integer("payment_terms_days"),
    creditLimitAmount: numeric("credit_limit_amount", { precision: 18, scale: 4 }),
    defaultLeadTimeDays: integer("default_lead_time_days"),
    taxIdentifier: text("tax_identifier"),
    notesInternal: text("notes_internal"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("customers_org_code_uq").on(t.organizationId, t.code),
    check("customers_status_ck", sql`${t.status} in ('prospect', 'active', 'on_hold', 'inactive')`),
    check("customers_credit_ck", sql`coalesce(${t.creditLimitAmount}, 0) >= 0 and coalesce(${t.paymentTermsDays}, 0) >= 0 and coalesce(${t.defaultLeadTimeDays}, 0) >= 0`),
  ],
);

/**
 * ADR-076: editable dropdown lists ("Master data → Lists"). One row per option of a list. The lists
 * themselves (keys, titles, default options, where they are used) are defined in code
 * (src/modules/masterdata/lookups.ts, LOOKUP_LISTS); lists that drive program logic (statuses, state
 * machines, location kinds, material class) are never stored here. `code` is the stored value and never
 * changes (trigger in src/db/sql/s4.sql); `label` is what people see and may be renamed. An option in
 * use is deactivated, never deleted. While an organization has no rows for a list, the shipped
 * defaults stand in; the first change writes the defaults as rows.
 */
export const LOOKUP_LIST_KEYS = ["product_family", "material_category", "customer_segment", "supplier_category"] as const;

export const lookupValues = pgTable(
  "lookup_values",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    listKey: text("list_key").notNull(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(100),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => users.id),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("uq_lookup_values_org_list_code").on(t.organizationId, t.listKey, t.code),
    uniqueIndex("uq_lookup_values_org_list_label").on(t.organizationId, t.listKey, sql`lower(${t.label})`),
    index("ix_lookup_values_org_list_sort").on(t.organizationId, t.listKey, t.sortOrder),
    check("ck_lookup_values_list_key", sql`${t.listKey} in (${sql.raw(LOOKUP_LIST_KEYS.map((k) => `'${k}'`).join(","))})`),
    check("ck_lookup_values_code", sql`length(${t.code}) between 1 and 40`),
    check("ck_lookup_values_label", sql`length(btrim(${t.label})) between 1 and 60`),
    check("ck_lookup_values_sort", sql`${t.sortOrder} between 0 and 9999`),
  ],
);

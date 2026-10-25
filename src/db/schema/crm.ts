import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, char, check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { MONEY, QTY, createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";
import { customers, products } from "./masterdata";
import { fileAttachments } from "./files";
import { labelTemplates } from "./documents";

/**
 * Customer master and commercial records (Wave 3 W3D, backlog E-4-01 / E-4-02, US-4-01..US-4-06;
 * docs/data-model.md §3.2 customers, §3.7 quotes / price lists, §4 versioned records).
 *
 * - `customer_addresses`, `customer_contacts`: soft-deletable master data. Exactly one default
 *   ship-to and one default bill-to per customer (partial unique indexes below; the service never
 *   leaves a customer without one).
 * - `customer_requirements`: versioned (`ver`), one parent = (customer, product or all products,
 *   requirement kind). Only an `approved` version effective on the date applies; approver differs
 *   from submitter (CHECK). Orders snapshot the ids they used.
 * - `artwork_versions`: register of label artwork versions referenced by `label_artwork` requirements.
 * - `customer_item_codes`: customer SKU mapping (the code the customer uses for our product).
 * - `price_lists` / `price_list_lines`: versioned customer or general price lists with quantity
 *   breaks; approval through `approval_rules` (document type `price_list`), approver differs from
 *   submitter (CHECK). Effective-dated: approved ranges of one code never overlap (service, under
 *   a lock of the first version row).
 * - `quotes` / `quote_lines`: quotations (numbering `QT`), approval per `approval_rules` (`quote`,
 *   discount threshold), convertible to a draft sales order. This file does not import the sales
 *   schema (sales.ts imports it), so `quotes.converted_sales_order_id` is a plain uuid; the
 *   foreign key lives on `sales_orders.quote_id`.
 */

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

export const CUSTOMER_STATUSES = ["prospect", "active", "on_hold", "inactive"] as const;
/** Customer segment (fictional demo scenarios: pharmacy chain, salon, distributor, online reseller). */
export const CUSTOMER_SEGMENTS = ["pharmacy_chain", "salon_spa", "distributor", "online_reseller", "retail_store", "other"] as const;
export const VERSION_STATES = ["draft", "pending_approval", "approved", "rejected", "retired"] as const;
export const REQUIREMENT_KINDS = [
  "label_artwork",
  "carton_count",
  "coa_required",
  "moq",
  "lead_time",
  "packaging",
  "document",
  "lot_age_max_days",
  "min_remaining_shelf_life_days",
  "full_shipment_required",
  "shipping_marks",
  "other",
] as const;
export const QUOTE_STATUSES = ["draft", "pending_approval", "sent", "accepted", "rejected", "expired", "converted", "voided"] as const;

export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    label: text("label").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    province: text("province"),
    postalCode: text("postal_code"),
    country: char("country", { length: 2 }).notNull().default("PH"),
    contactName: text("contact_name"),
    phone: text("phone"),
    isDefaultShipTo: boolean("is_default_ship_to").notNull().default(false),
    isDefaultBillTo: boolean("is_default_bill_to").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("customer_addresses_customer_idx").on(t.customerId),
    uniqueIndex("customer_addresses_default_ship_uq").on(t.customerId).where(sql`${t.isDefaultShipTo} and ${t.deletedAt} is null`),
    uniqueIndex("customer_addresses_default_bill_uq").on(t.customerId).where(sql`${t.isDefaultBillTo} and ${t.deletedAt} is null`),
    check("customer_addresses_default_live_ck", sql`${t.deletedAt} is null or not (${t.isDefaultShipTo} or ${t.isDefaultBillTo})`),
  ],
);

export const customerContacts = pgTable(
  "customer_contacts",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    roleLabel: text("role_label"),
    isPrimary: boolean("is_primary").notNull().default(false),
    anonymisedAt: timestamp("anonymised_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("customer_contacts_customer_idx").on(t.customerId),
    uniqueIndex("customer_contacts_primary_uq").on(t.customerId).where(sql`${t.isPrimary} and ${t.deletedAt} is null`),
  ],
);

/** Customer SKU mapping: the customer's own item code for one of our products. */
export const customerItemCodes = pgTable(
  "customer_item_codes",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    customerItemCode: text("customer_item_code").notNull(),
    customerDescription: text("customer_description"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("customer_item_codes_product_uq").on(t.customerId, t.productId),
    uniqueIndex("customer_item_codes_code_uq").on(t.customerId, t.customerItemCode),
  ],
);

/** Label artwork versions (customer-specific or house artwork) referenced by `label_artwork` requirements. */
export const artworkVersions = pgTable(
  "artwork_versions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    /** Null = house artwork used for several customers. */
    customerId: uuid("customer_id").references(() => customers.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    artworkCode: text("artwork_code").notNull(),
    versionLabel: text("version_label").notNull(),
    description: text("description"),
    fileAttachmentId: uuid("file_attachment_id").references(() => fileAttachments.id),
    /** active | retired (a retired version can no longer be chosen for a new requirement version). */
    status: text("status").notNull().default("active"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    retiredBy: uuid("retired_by").references(() => users.id),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("artwork_versions_code_uq").on(t.organizationId, t.artworkCode, t.versionLabel),
    check("artwork_versions_status_ck", sql`${t.status} in ('active', 'retired')`),
  ],
);

export const customerRequirements = pgTable(
  "customer_requirements",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    /** Null = all products of the customer. */
    productId: uuid("product_id").references(() => products.id),
    requirementKind: text("requirement_kind").notNull(),
    valueNumeric: numeric("value_numeric", QTY),
    valueText: text("value_text"),
    artworkVersionId: uuid("artwork_version_id").references(() => artworkVersions.id),
    labelTemplateId: uuid("label_template_id").references(() => labelTemplates.id),
    versionNo: integer("version_no").notNull(),
    status: text("status").notNull().default("draft"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => customerRequirements.id),
    changeSummary: text("change_summary"),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("customer_requirements_customer_idx").on(t.customerId, t.requirementKind),
    uniqueIndex("customer_requirements_version_uq").on(t.customerId, sql`coalesce(${t.productId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.requirementKind, t.versionNo),
    uniqueIndex("customer_requirements_one_open_uq")
      .on(t.customerId, sql`coalesce(${t.productId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.requirementKind)
      .where(sql`${t.status} in ('draft', 'pending_approval')`),
    check("customer_requirements_kind_ck", sql`${t.requirementKind} in (${inList(REQUIREMENT_KINDS)})`),
    check("customer_requirements_status_ck", sql`${t.status} in (${inList(VERSION_STATES)})`),
    check("customer_requirements_dates_ck", sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`),
    check("customer_requirements_value_ck", sql`num_nonnulls(${t.valueNumeric}, ${t.valueText}, ${t.artworkVersionId}, ${t.labelTemplateId}) >= 1`),
  ],
);

export const priceLists = pgTable(
  "price_lists",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** customer = one customer's list; general = default for customers without their own. */
    partyKind: text("party_kind").notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    versionNo: integer("version_no").notNull(),
    status: text("status").notNull().default("draft"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => priceLists.id),
    changeSummary: text("change_summary"),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("price_lists_code_version_uq").on(t.organizationId, t.code, t.versionNo),
    uniqueIndex("price_lists_one_open_uq").on(t.organizationId, t.code).where(sql`${t.status} in ('draft', 'pending_approval')`),
    index("price_lists_customer_idx").on(t.customerId, t.status),
    check("price_lists_kind_ck", sql`(${t.partyKind} = 'customer' and ${t.customerId} is not null) or (${t.partyKind} = 'general' and ${t.customerId} is null)`),
    check("price_lists_status_ck", sql`${t.status} in (${inList(VERSION_STATES)})`),
    check("price_lists_dates_ck", sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`),
  ],
);

export const priceListLines = pgTable(
  "price_list_lines",
  {
    id: id(),
    priceListId: uuid("price_list_id").notNull().references(() => priceLists.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    /** Quantity break: this price applies from this many pieces (0 = from the first piece). */
    minQtyUnits: numeric("min_qty_units", QTY).notNull().default("0"),
    unitAmount: numeric("unit_amount", MONEY).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
  },
  (t) => [
    uniqueIndex("price_list_lines_uq").on(t.priceListId, t.productId, t.minQtyUnits),
    check("price_list_lines_amount_ck", sql`${t.unitAmount} >= 0 and ${t.minQtyUnits} >= 0`),
  ],
);

export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    quoteNumber: text("quote_number").notNull(),
    status: text("status").notNull().default("draft"),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    shipToAddressId: uuid("ship_to_address_id").references(() => customerAddresses.id),
    priceListId: uuid("price_list_id").references(() => priceLists.id),
    validUntil: date("valid_until").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    subtotalAmount: numeric("subtotal_amount", MONEY).notNull().default("0"),
    taxAmount: numeric("tax_amount", MONEY).notNull().default("0"),
    totalAmount: numeric("total_amount", MONEY).notNull().default("0"),
    /** Largest line discount against the price list (%), the basis of the `quote` approval rules. */
    maxDiscountPct: numeric("max_discount_pct", { precision: 9, scale: 4 }).notNull().default("0"),
    notesCustomer: text("notes_customer"),
    notesInternal: text("notes_internal"),
    convertedSalesOrderId: uuid("converted_sales_order_id"),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid("status_changed_by").notNull().references(() => users.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("quotes_org_number_uq").on(t.organizationId, t.quoteNumber),
    index("quotes_site_status_idx").on(t.siteId, t.status),
    index("quotes_customer_idx").on(t.customerId),
    check("quotes_status_ck", sql`${t.status} in (${inList(QUOTE_STATUSES)})`),
    check("quotes_converted_ck", sql`(${t.status} = 'converted') = (${t.convertedSalesOrderId} is not null)`),
  ],
);

export const quoteLines = pgTable(
  "quote_lines",
  {
    id: id(),
    quoteId: uuid("quote_id").notNull().references(() => quotes.id),
    lineNo: integer("line_no").notNull(),
    productId: uuid("product_id").notNull().references(() => products.id),
    qtyUnits: numeric("qty_units", QTY).notNull(),
    /** Price list amount at entry (null when the product has no list price). */
    listUnitAmount: numeric("list_unit_amount", MONEY),
    unitAmount: numeric("unit_amount", MONEY).notNull(),
    discountPct: numeric("discount_pct", { precision: 9, scale: 4 }).notNull().default("0"),
    currency: char("currency", { length: 3 }).notNull().default("PHP"),
    priceListLineId: uuid("price_list_line_id").references(() => priceListLines.id),
  },
  (t) => [uniqueIndex("quote_lines_line_uq").on(t.quoteId, t.lineNo), check("quote_lines_qty_ck", sql`${t.qtyUnits} > 0 and ${t.unitAmount} >= 0`)],
);

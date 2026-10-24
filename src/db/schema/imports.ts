import { boolean, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { MONEY, QTY, createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";
import { locations, materials, products } from "./masterdata";
import { inventoryLots, stockMovements } from "./inventory";
import { fileAttachments } from "./files";
import { goodsReceipts } from "./receiving";
import { uoms } from "./org";

/**
 * Wave 3 W3C: import wizard, master-data and opening-stock imports, go-live loader and the legacy
 * document index (US-5-08, US-5-09, US-2-25, US-2-26; docs/data-model.md §3.10,
 * docs/data-migration-plan.md §9). One engine serves the wizard and the command-line loader.
 */

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

/**
 * Every import kind of docs/data-migration-plan.md §9.2 plus the W3C additions `uom_conversions` and
 * `reason_codes`. The check lists the whole vocabulary so a later stream adds a handler, not a migration;
 * which kinds are available in a release is decided by the handler registry (src/modules/imports/kinds).
 */
export const IMPORT_KIND_VALUES = [
  "attendance",
  "materials",
  "skus",
  "suppliers",
  "customers",
  "price_lists",
  "locations",
  "uom_conversions",
  "reason_codes",
  "legacy_documents",
  "opening_stock",
  "open_sales_orders",
  "open_purchase_orders",
  "employees",
  "equipment",
  "other",
] as const;

/** Import job state machine values (`IMPORT_JOB_TRANSITIONS` in src/modules/imports/state.ts). */
export const IMPORT_JOB_STATUSES = ["uploaded", "validating", "validated", "under_review", "submitted", "approved", "posting", "posted", "failed", "rejected", "voided"] as const;

/** Row outcomes (docs/data-migration-plan.md §7, §8): accepted, hold (created but blocked), duplicate, possible duplicate, rejected; failed = posting error. */
export const IMPORT_ROW_RESULTS = ["pending", "accepted", "hold", "duplicate", "possible_duplicate", "rejected", "failed"] as const;
/** Custodian decisions on a tier 2/3 duplicate candidate (§8). */
export const IMPORT_ROW_DECISIONS = ["same_as_existing", "new_record", "reject"] as const;

/**
 * Saved column mappings (`import_mappings` + `ver`, docs/data-model.md §3.10). A new save of the same
 * code is a new version; the job keeps the version it used, so a later change never alters an old job.
 * definition: { columns: { <template column>: <file header> | null }, dateFormat, decimalSeparator, thousandsSeparator }.
 */
export const importMappings = pgTable(
  "import_mappings",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    importKind: text("import_kind").notNull(),
    version: integer("version").notNull().default(1),
    definition: jsonb("definition").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_import_mappings_code_version").on(t.organizationId, t.code, t.version),
    uniqueIndex("uq_import_mappings_current").on(t.organizationId, t.code).where(sql`${t.isCurrent}`),
    index("ix_import_mappings_kind").on(t.organizationId, t.importKind),
    check("ck_import_mappings_kind", sql`${t.importKind} in (${inList(IMPORT_KIND_VALUES)})`),
    check("ck_import_mappings_code", sql`${t.code} ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'`),
    check("ck_import_mappings_version", sql`${t.version} >= 1`),
  ],
);

/**
 * One uploaded file of one import kind for one site (number rule IMP). The original file and its
 * SHA-256 are kept (file_attachment_id); rows live in import_job_rows with the raw values untouched.
 */
export const importJobs = pgTable(
  "import_jobs",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    importNumber: text("import_number").notNull(),
    importKind: text("import_kind").notNull(),
    status: text("status").notNull().default("uploaded"),
    /** wizard | loader (the US-2-25 command line). */
    source: text("source").notNull().default("wizard"),
    fileAttachmentId: uuid("file_attachment_id").notNull().references(() => fileAttachments.id),
    fileName: text("file_name").notNull(),
    fileFormat: text("file_format").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Headers of the file in order (mapping step). */
    headers: jsonb("headers").notNull(),
    /** Parser notes shown at the mapping step, e.g. "12 cells had formulas; their last calculated values were used". */
    fileNotes: jsonb("file_notes"),
    importMappingId: uuid("import_mapping_id").references(() => importMappings.id),
    /** Snapshot of the mapping used by the last validation (never changes when the profile changes). */
    mapping: jsonb("mapping"),
    /** Increases with every validation or posting run; part of the background job key. */
    runNo: integer("run_no").notNull().default(0),
    rowsTotal: integer("rows_total").notNull().default(0),
    rowsAccepted: integer("rows_accepted").notNull().default(0),
    rowsHold: integer("rows_hold").notNull().default(0),
    rowsDuplicate: integer("rows_duplicate").notNull().default(0),
    rowsPossibleDuplicate: integer("rows_possible_duplicate").notNull().default(0),
    rowsRejected: integer("rows_rejected").notNull().default(0),
    rowsWarned: integer("rows_warned").notNull().default(0),
    rowsCreated: integer("rows_created").notNull().default(0),
    rowsFailed: integer("rows_failed").notNull().default(0),
    errorFileAttachmentId: uuid("error_file_attachment_id").references(() => fileAttachments.id),
    reuploadReason: text("reupload_reason"),
    failureMessage: text("failure_message"),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    postedBy: uuid("posted_by").references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    rejectedBy: uuid("rejected_by").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    correlationId: uuid("correlation_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_import_jobs_number").on(t.organizationId, t.importNumber),
    uniqueIndex("uq_import_jobs_idem").on(t.organizationId, t.idempotencyKey),
    index("ix_import_jobs_site_status").on(t.siteId, t.status),
    index("ix_import_jobs_checksum").on(t.organizationId, t.importKind, t.siteId, t.checksumSha256),
    check("ck_import_jobs_kind", sql`${t.importKind} in (${inList(IMPORT_KIND_VALUES)})`),
    check("ck_import_jobs_status", sql`${t.status} in (${inList(IMPORT_JOB_STATUSES)})`),
    check("ck_import_jobs_source", sql`${t.source} in ('wizard','loader')`),
    check("ck_import_jobs_format", sql`${t.fileFormat} in ('csv','xlsx')`),
    check("ck_import_jobs_sod", sql`${t.approvedBy} is null or ${t.submittedBy} is not null`),
    check("ck_import_jobs_posted", sql`${t.status} not in ('posted','voided') or (${t.postedAt} is not null and ${t.postedBy} is not null)`),
    check("ck_import_jobs_voided", sql`${t.status} <> 'voided' or (${t.voidedAt} is not null and ${t.voidReason} is not null)`),
    check("ck_import_jobs_rejected", sql`${t.status} <> 'rejected' or ${t.rejectReason} is not null`),
  ],
);

/** One source row: raw cells as in the file, the normalised values, the outcome and the created entity (crosswalk, §6 rule 4). */
export const importJobRows = pgTable(
  "import_job_rows",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    importJobId: uuid("import_job_id").notNull().references(() => importJobs.id),
    /** 1-based data row number (the header is row 0); spreadsheets show it as rowNo + 1. */
    rowNo: integer("row_no").notNull(),
    raw: jsonb("raw").notNull(),
    values: jsonb("values"),
    result: text("result").notNull().default("pending"),
    errorMessage: text("error_message"),
    /** [{ field, message }] */
    errors: jsonb("errors"),
    warnings: jsonb("warnings"),
    /** Rows with the same key post in the same chunk (one lot per material × supplier lot × expiry). */
    groupKey: text("group_key"),
    /** The dry run created the record in a blocked state (e.g. an opening lot on hold): the row's outcome is `hold`. */
    holdOnPost: boolean("hold_on_post").notNull().default(false),
    duplicateTier: integer("duplicate_tier"),
    matchEntityType: text("match_entity_type"),
    matchEntityId: uuid("match_entity_id"),
    matchLabel: text("match_label"),
    decision: text("decision"),
    decisionNote: text("decision_note"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdEntityType: text("created_entity_type"),
    createdEntityId: uuid("created_entity_id"),
    createdEntityLabel: text("created_entity_label"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_import_job_rows_row").on(t.importJobId, t.rowNo),
    index("ix_import_job_rows_result").on(t.importJobId, t.result),
    index("ix_import_job_rows_entity").on(t.createdEntityType, t.createdEntityId),
    check("ck_import_job_rows_result", sql`${t.result} in (${inList(IMPORT_ROW_RESULTS)})`),
    check("ck_import_job_rows_decision", sql`${t.decision} is null or ${t.decision} in (${inList(IMPORT_ROW_DECISIONS)})`),
    check("ck_import_job_rows_decided", sql`(${t.decision} is null) = (${t.decidedBy} is null)`),
    check("ck_import_job_rows_tier", sql`${t.duplicateTier} is null or ${t.duplicateTier} in (1, 2, 3)`),
    check("ck_import_job_rows_posted", sql`(${t.createdEntityId} is null) = (${t.postedAt} is null)`),
  ],
);

/**
 * One counted lot line of an opening-balance goods receipt (`goods_receipts.receipt_kind = 'opening_balance'`).
 * Kept apart from goods_receipt_lines because opening stock also covers finished goods (product lots)
 * and lots without expiry or supplier lot (A-MIG-06), which the supplier receipt rules refuse.
 */
export const openingBalanceLines = pgTable(
  "opening_balance_lines",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    goodsReceiptId: uuid("goods_receipt_id").notNull().references(() => goodsReceipts.id),
    importJobId: uuid("import_job_id").notNull().references(() => importJobs.id),
    importJobRowId: uuid("import_job_row_id").notNull().references(() => importJobRows.id),
    lineNo: integer("line_no").notNull(),
    /** material | product */
    itemKind: text("item_kind").notNull(),
    materialId: uuid("material_id").references(() => materials.id),
    productId: uuid("product_id").references(() => products.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    locationId: uuid("location_id").notNull().references(() => locations.id),
    qtyEntered: numeric("qty_entered", QTY).notNull(),
    uomEntered: text("uom_entered").notNull(),
    qtyBase: numeric("qty_base", QTY).notNull(),
    baseUom: text("base_uom").notNull(),
    countSheetRef: text("count_sheet_ref").notNull(),
    countedBy: text("counted_by").notNull(),
    checkedBy: text("checked_by").notNull(),
    /** Status the lot was created with (A-MIG-06): quarantine | on_hold | expired. */
    initialQualityStatus: text("initial_quality_status").notNull(),
    holdReasonCode: text("hold_reason_code"),
    holdReasonNote: text("hold_reason_note"),
    qualityStatusClaimed: text("quality_status_claimed"),
    containerCount: integer("container_count").notNull().default(0),
    unitCost: numeric("unit_cost", MONEY),
    currency: text("currency"),
    notes: text("notes"),
    stockMovementId: uuid("stock_movement_id").notNull().references(() => stockMovements.id),
    reversalMovementId: uuid("reversal_movement_id").references(() => stockMovements.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_opening_balance_lines_no").on(t.goodsReceiptId, t.lineNo),
    uniqueIndex("uq_opening_balance_lines_row").on(t.importJobRowId),
    index("ix_opening_balance_lines_lot").on(t.lotId),
    check("ck_opening_balance_lines_item", sql`(${t.itemKind} = 'material' and ${t.materialId} is not null and ${t.productId} is null) or (${t.itemKind} = 'product' and ${t.productId} is not null and ${t.materialId} is null)`),
    check("ck_opening_balance_lines_qty", sql`${t.qtyBase} > 0 and ${t.qtyEntered} > 0`),
    check("ck_opening_balance_lines_status", sql`${t.initialQualityStatus} in ('quarantine','on_hold','expired')`),
    check("ck_opening_balance_lines_counter", sql`lower(${t.countedBy}) <> lower(${t.checkedBy})`),
    check("ck_opening_balance_lines_hold_reason", sql`${t.initialQualityStatus} <> 'on_hold' or ${t.holdReasonCode} is not null`),
  ],
);

/**
 * Scanned historical records (paper BMRs, DRs, invoices, test records) indexed by header fields
 * (docs/data-model.md §3.10, A-DM-09). Never a batch and never a ledger row; finished-goods opening
 * lots link to it by legacy number. The index is checked against the scan by a second person.
 */
export const LEGACY_DOCUMENT_KINDS = ["bmr", "dr", "invoice", "test_record", "other"] as const;
export const LEGACY_DISPOSITIONS = ["approved", "disapproved", "unknown"] as const;

export const legacyDocuments = pgTable(
  "legacy_documents",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    documentNumber: text("document_number").notNull(),
    legacyKind: text("legacy_kind").notNull(),
    legacyNumber: text("legacy_number").notNull(),
    productId: uuid("product_id").references(() => products.id),
    formulaNumber: text("formula_number"),
    batchSizeQty: numeric("batch_size_qty", QTY),
    batchSizeUomId: uuid("batch_size_uom_id").references(() => uoms.id),
    startDate: date("start_date"),
    endDate: date("end_date"),
    expiryDate: date("expiry_date"),
    disposition: text("disposition"),
    qaName: text("qa_name"),
    remarks: text("remarks"),
    fileAttachmentId: uuid("file_attachment_id").notNull().references(() => fileAttachments.id),
    importJobId: uuid("import_job_id").references(() => importJobs.id),
    importJobRowId: uuid("import_job_row_id").references(() => importJobRows.id),
    indexedBy: uuid("indexed_by").notNull().references(() => users.id),
    indexedAt: timestamp("indexed_at", { withTimezone: true }).notNull().defaultNow(),
    verifiedBy: uuid("verified_by").references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidReason: text("void_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_legacy_documents_number").on(t.organizationId, t.documentNumber),
    uniqueIndex("uq_legacy_documents_legacy").on(t.organizationId, t.legacyKind, t.legacyNumber).where(sql`${t.voidedAt} is null`),
    index("ix_legacy_documents_product").on(t.productId, t.startDate),
    index("ix_legacy_documents_legacy_number").on(t.organizationId, t.legacyNumber),
    check("ck_legacy_documents_kind", sql`${t.legacyKind} in (${inList(LEGACY_DOCUMENT_KINDS)})`),
    check("ck_legacy_documents_disposition", sql`${t.disposition} is null or ${t.disposition} in (${inList(LEGACY_DISPOSITIONS)})`),
    check("ck_legacy_documents_batch_size", sql`${t.batchSizeQty} is null or ${t.batchSizeQty} > 0`),
    check("ck_legacy_documents_dates", sql`${t.endDate} is null or ${t.startDate} is null or ${t.endDate} >= ${t.startDate}`),
    check("ck_legacy_documents_verifier", sql`${t.verifiedBy} is null or ${t.verifiedBy} <> ${t.indexedBy}`),
    check("ck_legacy_documents_verified", sql`(${t.verifiedBy} is null) = (${t.verifiedAt} is null)`),
    check("ck_legacy_documents_voided", sql`(${t.voidedAt} is null) = (${t.voidReason} is null)`),
  ],
);

/**
 * Old spreadsheet names of a material (docs/data-model.md §3.2, migration plan §8): written when the
 * custodian decides a possible duplicate is the "same as existing" material, so old names still resolve.
 */
export const materialAliases = pgTable(
  "material_aliases",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    materialId: uuid("material_id").notNull().references(() => materials.id),
    alias: text("alias").notNull(),
    source: text("source").notNull().default("import"),
    importJobRowId: uuid("import_job_row_id").references(() => importJobRows.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("uq_material_aliases_alias").on(t.organizationId, sql`lower(${t.alias})`), index("ix_material_aliases_material").on(t.materialId), check("ck_material_aliases_source", sql`${t.source} in ('import','manual')`)],
);

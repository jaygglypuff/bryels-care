import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common";
import { organizations, sites, users } from "./identity";

/**
 * Documents, labels and print stations (E-2-03; docs/data-model.md §3.2 label_templates,
 * §3.3 label_jobs, §3.10 document_templates / document_template_versions / generated_documents;
 * docs/reports-and-templates.md §1, §8).
 *
 * The database stores configuration (versioned JSON definitions bound to code renderers), never
 * HTML (A-RPT-01). Generated documents freeze the dataset they were rendered from so a reprint
 * reproduces the same content, and record the template version, hash, who and when.
 */

/** Kinds from docs/data-model.md §3.10; a template can only get a valid version when a renderer exists for its kind. */
export const DOCUMENT_TEMPLATE_KINDS = [
  "bmr", "dispensing_sheet", "traveler", "boxing_note", "delivery_receipt", "pick_list", "label", "stock_card",
  "goods_receipt", "count_sheet", "variance_report", "hold_notice", "coa", "deviation_report", "traceability_report",
  "supplier_return", "purchase_order", "quotation", "order_confirmation", "invoice", "statement", "payslip",
  "attendance_exception_report", "recall_notice", "return_receipt", "report", "test_page", "other",
] as const;

const inList = (col: AnyPgColumn, values: readonly string[]) => sql`${col} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;

export const documentTemplates = pgTable(
  "document_templates",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    /** Null = all sites. */
    siteId: uuid("site_id").references(() => sites.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    templateKind: text("template_kind").notNull(),
    pageSize: text("page_size").notNull().default("A4"),
    orientation: text("orientation").notNull().default("portrait"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("document_templates_org_code_uq").on(t.organizationId, t.code),
    check("document_templates_kind_ck", inList(t.templateKind, DOCUMENT_TEMPLATE_KINDS)),
    check("document_templates_page_size_ck", inList(t.pageSize, ["A4", "Letter", "label"])),
    check("document_templates_orientation_ck", inList(t.orientation, ["portrait", "landscape"])),
    check("document_templates_code_ck", sql`${t.code} ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'`),
  ],
);

/** status: draft → pending_approval → approved → retired (docs/data-model.md §4.2, reports §11.1). */
export const TEMPLATE_VERSION_STATUSES = ["draft", "pending_approval", "approved", "retired"] as const;

export const documentTemplateVersions = pgTable(
  "document_template_versions",
  {
    id: id(),
    documentTemplateId: uuid("document_template_id").notNull().references(() => documentTemplates.id),
    versionNo: integer("version_no").notNull(),
    status: text("status").notNull().default("draft"),
    /** Schema document_template/v1: renderer id + version and JSON configuration; never HTML. */
    definition: jsonb("definition").notNull(),
    /** sha256 of the canonical JSON of `definition`; printed in the footer. */
    definitionChecksum: text("definition_checksum").notNull(),
    changeNote: text("change_note"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    retiredBy: uuid("retired_by").references(() => users.id),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    retireReason: text("retire_reason"),
  },
  (t) => [
    uniqueIndex("document_template_versions_no_uq").on(t.documentTemplateId, t.versionNo),
    /** One effective (approved) version per template at a time; approving the next one retires it. */
    uniqueIndex("document_template_versions_one_approved_uq").on(t.documentTemplateId).where(sql`${t.status} = 'approved'`),
    check("document_template_versions_status_ck", inList(t.status, TEMPLATE_VERSION_STATUSES)),
    check("document_template_versions_sod_ck", sql`${t.approvedBy} is null or ${t.submittedBy} is null or ${t.approvedBy} <> ${t.submittedBy}`),
    check("document_template_versions_approved_ck", sql`${t.status} <> 'approved' or (${t.approvedBy} is not null and ${t.approvedAt} is not null and ${t.effectiveFrom} is not null)`),
    check("document_template_versions_retired_ck", sql`${t.status} <> 'retired' or (${t.retiredBy} is not null and ${t.retiredAt} is not null)`),
  ],
);

export const LABEL_APPLIES_TO = ["material", "wip", "finished_good", "carton", "pallet", "location", "equipment", "sample"] as const;
export const LABEL_SYMBOLOGIES = ["qr", "code128", "ean13"] as const;
/** status: draft → approved → retired; editing an approved template's physical settings returns it to draft. */
export const LABEL_TEMPLATE_STATUSES = ["draft", "approved", "retired"] as const;

/** Physical label configuration; its layout is a document_templates row of kind `label`. */
export const labelTemplates = pgTable(
  "label_templates",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    documentTemplateId: uuid("document_template_id").notNull().references(() => documentTemplates.id),
    appliesTo: text("applies_to").notNull(),
    symbology: text("symbology").notNull().default("qr"),
    copiesDefault: integer("copies_default").notNull().default(1),
    /** Schema label_fields/v1: which optional fields print. */
    fields: jsonb("fields"),
    mediaWidthMm: numeric("media_width_mm", { precision: 6, scale: 1 }).notNull(),
    mediaHeightMm: numeric("media_height_mm", { precision: 6, scale: 1 }).notNull(),
    dpi: integer("dpi").notNull().default(203),
    status: text("status").notNull().default("draft"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    updatedAt: updatedAt(),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("label_templates_org_code_uq").on(t.organizationId, t.code),
    check("label_templates_applies_to_ck", inList(t.appliesTo, LABEL_APPLIES_TO)),
    check("label_templates_symbology_ck", inList(t.symbology, LABEL_SYMBOLOGIES)),
    check("label_templates_status_ck", inList(t.status, LABEL_TEMPLATE_STATUSES)),
    check("label_templates_copies_ck", sql`${t.copiesDefault} between 1 and 99`),
    check("label_templates_media_ck", sql`${t.mediaWidthMm} between 20 and 220 and ${t.mediaHeightMm} between 15 and 300`),
    check("label_templates_dpi_ck", sql`${t.dpi} in (203, 300, 600)`),
    check("label_templates_sod_ck", sql`${t.approvedBy} is null or ${t.approvedBy} <> ${t.updatedBy}`),
    check("label_templates_code_ck", sql`${t.code} ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'`),
  ],
);

/**
 * A print station: the PC or tablet next to a label printer that prints jobs queued from phones
 * (docs/reports-and-templates.md §8.5, A-RPT-09). No active station at a site = "Label printing
 * isn't set up" (setup-required state).
 */
export const printStations = pgTable(
  "print_stations",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** The printer as named on the station's operating system (shown to the person printing). */
    printerName: text("printer_name").notNull(),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("print_stations_site_code_uq").on(t.siteId, t.code),
    check("print_stations_code_ck", sql`${t.code} ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'`),
  ],
);

export const GENERATED_DOCUMENT_STATUSES = ["rendering", "ready", "failed", "superseded", "void"] as const;

/** One row per render: first generation, reprint, regeneration. Never deleted. */
export const generatedDocuments = pgTable(
  "generated_documents",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").references(() => sites.id),
    documentTemplateVersionId: uuid("document_template_version_id").notNull().references(() => documentTemplateVersions.id),
    documentKind: text("document_kind").notNull(),
    sourceEntityType: text("source_entity_type").notNull(),
    sourceEntityId: uuid("source_entity_id").notNull(),
    sourceRevisionAt: timestamp("source_revision_at", { withTimezone: true }).notNull(),
    /** Rule DOC (DOC-{YY}-{SEQ}); printed with the QR BC:DOC:<number>. */
    documentNumber: text("document_number").notNull(),
    status: text("status").notNull().default("rendering"),
    supersededById: uuid("superseded_by_id").references((): AnyPgColumn => generatedDocuments.id),
    /** Counts first generations per source record and kind; reprints inherit it. */
    recordRevisionNo: integer("record_revision_no").notNull(),
    sourceState: text("source_state"),
    watermark: text("watermark"),
    /** `html` = browser print of the stored-dataset render (Phase 2); `pdf` = stored PDF (PDF_RENDERER=chromium). */
    outputFormat: text("output_format").notNull().default("html"),
    /** Frozen dataset the renderer reads; the renderer never touches the database. */
    dataset: jsonb("dataset").notNull(),
    /** sha256 of the rendered output (HTML body for `html`, file bytes for `pdf`). */
    checksumSha256: text("checksum_sha256"),
    pageCount: integer("page_count"),
    /** → file_attachments when PDF storage ships (FK added with that table). */
    fileAttachmentId: uuid("file_attachment_id"),
    errorMessage: text("error_message"),
    generatedBy: uuid("generated_by").notNull().references(() => users.id),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    renderedAt: timestamp("rendered_at", { withTimezone: true }),
    backgroundJobId: uuid("background_job_id"),
    reprintOfId: uuid("reprint_of_id").references((): AnyPgColumn => generatedDocuments.id),
    reprintNo: integer("reprint_no").notNull().default(0),
    reprintReasonCode: text("reprint_reason_code"),
    reprintNote: text("reprint_note"),
    parameters: jsonb("parameters"),
    idempotencyKey: text("idempotency_key"),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
  },
  (t) => [
    uniqueIndex("generated_documents_org_number_uq").on(t.organizationId, t.documentNumber),
    uniqueIndex("generated_documents_org_idem_uq").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    uniqueIndex("generated_documents_revision_uq")
      .on(t.sourceEntityType, t.sourceEntityId, t.documentKind, t.recordRevisionNo)
      .where(sql`${t.reprintOfId} is null`),
    index("generated_documents_source_idx").on(t.sourceEntityType, t.sourceEntityId),
    check("generated_documents_status_ck", inList(t.status, GENERATED_DOCUMENT_STATUSES)),
    check("generated_documents_format_ck", inList(t.outputFormat, ["html", "pdf"])),
    check("generated_documents_ready_ck", sql`${t.status} <> 'ready' or (${t.checksumSha256} is not null and (${t.outputFormat} = 'html' or ${t.fileAttachmentId} is not null))`),
    check("generated_documents_reprint_ck", sql`(${t.reprintOfId} is null and ${t.reprintNo} = 0) or (${t.reprintOfId} is not null and ${t.reprintNo} > 0 and ${t.reprintReasonCode} is not null)`),
    check("generated_documents_void_ck", sql`${t.status} <> 'void' or (${t.voidedBy} is not null and ${t.voidedAt} is not null and ${t.voidReason} is not null)`),
  ],
);

export const LABEL_JOB_STATUSES = ["queued", "rendering", "ready", "printed", "failed", "cancelled"] as const;
export const LABEL_JOB_ENTITY_TYPES = ["inventory_lot", "container", "location", "batch", "inspection_sample", "equipment"] as const;

/** A print request for 1..n copies of a label for one entity; reprints are audited. */
export const labelJobs = pgTable(
  "label_jobs",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    siteId: uuid("site_id").notNull().references(() => sites.id),
    labelTemplateId: uuid("label_template_id").notNull().references(() => labelTemplates.id),
    documentTemplateVersionId: uuid("document_template_version_id").notNull().references(() => documentTemplateVersions.id),
    printStationId: uuid("print_station_id").notNull().references(() => printStations.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    /** The encoded value at request time (lot number, location code, …). */
    entityNumber: text("entity_number").notNull(),
    copies: integer("copies").notNull(),
    status: text("status").notNull().default("queued"),
    printerName: text("printer_name"),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    generatedDocumentId: uuid("generated_document_id").references(() => generatedDocuments.id),
    reprintOfId: uuid("reprint_of_id").references((): AnyPgColumn => labelJobs.id),
    reprintNo: integer("reprint_no").notNull().default(0),
    reprintReasonCode: text("reprint_reason_code"),
    reprintNote: text("reprint_note"),
    idempotencyKey: text("idempotency_key"),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    printedBy: uuid("printed_by").references(() => users.id),
    printedAt: timestamp("printed_at", { withTimezone: true }),
    /** → device_registrations (FK added in P7). */
    stationDeviceRegistrationId: uuid("station_device_registration_id"),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidReason: text("void_reason"),
  },
  (t) => [
    uniqueIndex("label_jobs_org_idem_uq").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    index("label_jobs_station_status_idx").on(t.printStationId, t.status),
    index("label_jobs_entity_idx").on(t.entityType, t.entityId),
    check("label_jobs_status_ck", inList(t.status, LABEL_JOB_STATUSES)),
    check("label_jobs_entity_type_ck", inList(t.entityType, LABEL_JOB_ENTITY_TYPES)),
    check("label_jobs_copies_ck", sql`${t.copies} between 1 and 99`),
    check("label_jobs_reprint_ck", sql`(${t.reprintOfId} is null and ${t.reprintNo} = 0) or (${t.reprintOfId} is not null and ${t.reprintNo} > 0 and ${t.reprintReasonCode} is not null)`),
    check("label_jobs_void_ck", sql`(${t.voidedAt} is null and ${t.voidedBy} is null and ${t.voidReason} is null) or (${t.voidedAt} is not null and ${t.voidedBy} is not null and ${t.voidReason} is not null)`),
    check("label_jobs_printed_ck", sql`${t.status} <> 'printed' or (${t.printedBy} is not null and ${t.printedAt} is not null)`),
  ],
);

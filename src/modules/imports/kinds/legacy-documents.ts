import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { LEGACY_DISPOSITIONS, LEGACY_DOCUMENT_KINDS, fileAttachments, legacyDocuments, products, uoms } from "@/db/schema";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import type { ExistingMatch, ImportKindHandler } from "./types";

/**
 * `legacy_documents` (docs/data-migration-plan.md §7.11, P2, A-DM-09): scanned paper BMRs and other
 * historical records, indexed by the header fields as printed. The scans (PDF or photos, validated like
 * every upload, docs/security.md §4.6) are uploaded to the import first; each row names its file. A row
 * for a kind + legacy number that is already indexed is a duplicate (one document per paper record).
 * Indexed by the uploader; a second person verifies the index against the scan (`verified_by`).
 */
type LegacyValues = {
  legacyKind: (typeof LEGACY_DOCUMENT_KINDS)[number];
  legacyNumber: string;
  productCode: string | null;
  formulaNumber: string | null;
  batchSize: string | null;
  batchSizeUom: string | null;
  startDate: string | null;
  endDate: string | null;
  expiryDate: string | null;
  disposition: (typeof LEGACY_DISPOSITIONS)[number] | null;
  qaName: string | null;
  remarks: string | null;
  fileName: string;
};

export const legacyDocumentsKind: ImportKindHandler<LegacyValues> = {
  kind: "legacy_documents",
  label: "Legacy documents (scanned BMRs)",
  description: "Scanned paper batch records and other historical documents, indexed for the lot page and search.",
  creates: "legacy_document",
  entityPermissions: ["documents.file_attachment.create"],
  availability: { available: true },
  needsScans: true,
  columns: [
    { key: "kind", label: "Kind", required: true, hint: `${LEGACY_DOCUMENT_KINDS.join(", ")}.`, aliases: ["legacy_kind", "document_kind"] },
    { key: "legacy_number", label: "Legacy number", required: true, hint: "Paper batch or document number.", aliases: ["batch_number", "document_number"] },
    { key: "product_code", label: "Product code", hint: "Product code in the system." },
    { key: "formula_number", label: "Formula number", hint: "As printed." },
    { key: "batch_size", label: "Batch size", hint: "Number." },
    { key: "batch_size_uom", label: "Batch size unit", hint: "Unit code, e.g. g or kg." },
    { key: "start_date", label: "Start date", hint: "Date format of the mapping." },
    { key: "end_date", label: "End date", hint: "Not before the start date." },
    { key: "expiry_date", label: "Expiry date", hint: "As printed." },
    { key: "disposition", label: "Disposition", hint: "approved, disapproved or unknown." },
    { key: "qa_name", label: "QA name", hint: "As written on the record (personal data)." },
    { key: "remarks", label: "Remarks", hint: "Optional." },
    { key: "file_name", label: "Scan file name", required: true, hint: "Name of an uploaded scan of this import (PDF, JPEG, PNG)." },
  ],
  exampleRows: [
    {
      kind: "bmr",
      legacy_number: "PB-2025-0142",
      product_code: "ACS-135",
      formula_number: "F-ACS-01",
      batch_size: "17600",
      batch_size_uom: "g",
      start_date: "03/02/2025",
      end_date: "05/02/2025",
      expiry_date: "05/02/2027",
      disposition: "approved",
      qa_name: "Sample QA Reviewer (fictional)",
      remarks: "",
      file_name: "PB-2025-0142.pdf",
    },
  ],
  normalize(r) {
    const legacyKind = r.oneOf("kind", LEGACY_DOCUMENT_KINDS, { required: true, synonyms: { batch_record: "bmr", delivery_receipt: "dr", test: "test_record" } });
    const legacyNumber = r.text("legacy_number", { required: true, max: 80 });
    const fileName = r.text("file_name", { required: true, max: 200 });
    const v: LegacyValues = {
      legacyKind: legacyKind ?? "bmr",
      legacyNumber: legacyNumber ?? "",
      productCode: r.code("product_code"),
      formulaNumber: r.text("formula_number", { max: 80 }),
      batchSize: r.decimal("batch_size", { positive: true }),
      batchSizeUom: r.text("batch_size_uom", { max: 16 }),
      startDate: r.date("start_date"),
      endDate: r.date("end_date"),
      expiryDate: r.date("expiry_date"),
      disposition: r.oneOf("disposition", LEGACY_DISPOSITIONS),
      qaName: r.text("qa_name", { max: 120 }),
      remarks: r.text("remarks", { max: 1000 }),
      fileName: fileName ?? "",
    };
    if (v.startDate && v.endDate && v.endDate < v.startDate) r.error("end_date", "The end date is before the start date.");
    if (v.batchSize && !v.batchSizeUom) r.error("batch_size_uom", "Give the unit of the batch size.");
    const blank = [
      ["product", v.productCode],
      ["start date", v.startDate],
      ["disposition", v.disposition],
      ["QA name", v.qaName],
    ].filter(([, x]) => !x);
    if (v.legacyKind === "bmr" && blank.length) r.warn(`Blank header field(s) on the record: ${blank.map(([n]) => n).join(", ")} (F-04). Index what the paper shows.`);
    if (!legacyKind || !legacyNumber || !fileName) return null;
    return { values: v, tier1Key: `${v.legacyKind}:${v.legacyNumber.toUpperCase()}` };
  },
  async findExisting(tx, ctx, _job, rows) {
    const nums = [...new Set(rows.map((r) => r.values.legacyNumber))];
    const found = nums.length
      ? await tx
          .select({ id: legacyDocuments.id, kind: legacyDocuments.legacyKind, legacyNumber: legacyDocuments.legacyNumber, documentNumber: legacyDocuments.documentNumber })
          .from(legacyDocuments)
          .where(and(eq(legacyDocuments.organizationId, ctx.organizationId), inArray(legacyDocuments.legacyNumber, nums), isNull(legacyDocuments.voidedAt)))
      : [];
    const out = new Map<number, ExistingMatch>();
    for (const { rowNo, values } of rows) {
      const d = found.find((x) => x.kind === values.legacyKind && x.legacyNumber.toUpperCase() === values.legacyNumber.toUpperCase());
      if (d) out.set(rowNo, { tier: 1, entityType: "legacy_document", entityId: d.id, label: d.documentNumber, message: `${values.legacyKind.toUpperCase()} ${values.legacyNumber} is already indexed as ${d.documentNumber}; attach extra pages to it instead of a new document.` });
    }
    return out;
  },
  async create(k, v) {
    const { tx, ctx, job } = k;
    const [scan] = await tx
      .select()
      .from(fileAttachments)
      .where(and(eq(fileAttachments.organizationId, ctx.organizationId), eq(fileAttachments.attachmentKind, "legacy_document"), isNull(fileAttachments.deletedAt), sql`lower(${fileAttachments.fileName}) = lower(${v.fileName})`, eq(fileAttachments.entityId, job.id)))
      .limit(1);
    if (!scan) {
      const [used] = await tx
        .select({ id: fileAttachments.id })
        .from(fileAttachments)
        .innerJoin(legacyDocuments, eq(legacyDocuments.fileAttachmentId, fileAttachments.id))
        .where(and(eq(legacyDocuments.importJobId, job.id), sql`lower(${fileAttachments.fileName}) = lower(${v.fileName})`))
        .limit(1);
      throw new DomainError("validation", used ? `Scan ${v.fileName} is already used by another row of this import.` : `No uploaded scan is named ${v.fileName}. Upload the scans to this import first.`, { field: "file_name" });
    }
    let productId: string | null = null;
    if (v.productCode) {
      const [p] = await tx.select({ id: products.id }).from(products).where(and(eq(products.organizationId, ctx.organizationId), eq(products.skuCode, v.productCode))).limit(1);
      if (!p) throw new DomainError("validation", `Product ${v.productCode} does not exist.`, { field: "product_code" });
      productId = p.id;
    }
    let batchSizeUomId: string | null = null;
    if (v.batchSizeUom) {
      const [u] = await tx.select({ id: uoms.id }).from(uoms).where(and(eq(uoms.organizationId, ctx.organizationId), eq(uoms.code, v.batchSizeUom))).limit(1);
      if (!u) throw new DomainError("validation", `Unit ${v.batchSizeUom} is not in the unit list.`, { field: "batch_size_uom" });
      batchSizeUomId = u.id;
    }
    ctx.require("documents.file_attachment.create");
    const documentNumber = await nextNumber(tx, ctx.organizationId, "LDOC");
    const [doc] = await tx
      .insert(legacyDocuments)
      .values({
        organizationId: ctx.organizationId,
        siteId: job.siteId,
        documentNumber,
        legacyKind: v.legacyKind,
        legacyNumber: v.legacyNumber,
        productId,
        formulaNumber: v.formulaNumber,
        batchSizeQty: v.batchSize,
        batchSizeUomId,
        startDate: v.startDate,
        endDate: v.endDate,
        expiryDate: v.expiryDate,
        disposition: v.disposition,
        qaName: v.qaName,
        remarks: v.remarks,
        fileAttachmentId: scan.id,
        importJobId: job.id,
        importJobRowId: k.row.id,
        indexedBy: job.uploadedBy,
      })
      .returning();
    await tx.update(fileAttachments).set({ entityType: "legacy_document", entityId: doc.id }).where(eq(fileAttachments.id, scan.id));
    await audit(tx, ctx, {
      action: "documents.legacy_document.indexed",
      entityType: "legacy_document",
      entityId: doc.id,
      entityNumber: documentNumber,
      siteId: job.siteId,
      after: { legacyKind: v.legacyKind, legacyNumber: v.legacyNumber, productCode: v.productCode, importJob: job.importNumber, fileName: scan.fileName, sha256: scan.checksumSha256 },
    });
    return { entityType: "legacy_document", entityId: doc.id, label: documentNumber, warnings: ["A second person must verify the index against the scan."] };
  },
  async voidPosted({ ctx, tx, job, reason }) {
    const docs = await tx.select().from(legacyDocuments).where(and(eq(legacyDocuments.importJobId, job.id), isNull(legacyDocuments.voidedAt))).for("update");
    const now = new Date();
    for (const d of docs) {
      await tx.update(legacyDocuments).set({ voidedAt: now, voidedBy: ctx.userId, voidReason: reason }).where(eq(legacyDocuments.id, d.id));
      await audit(tx, ctx, { action: "documents.legacy_document.voided", entityType: "legacy_document", entityId: d.id, entityNumber: d.documentNumber, siteId: d.siteId, reason, before: { voided: false }, after: { voided: true, importJob: job.importNumber } });
    }
    return { voidedDocuments: docs.length };
  },
};

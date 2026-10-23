import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db, type Tx } from "@/db/client";
import { fileAttachments, goodsReceiptLines, goodsReceipts, materials, supplierLotDocuments, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { objectKey, requireStorage, signDownloadUrl, storageFor, validateUpload, verifyDownloadSignature } from "@/lib/storage";
import { isUuid } from "./lots";

/**
 * Supplier lot documents and receipt attachments (US-2-08): CoA, SDS, specification and photos on a
 * receipt line, and the photo of the supplier's delivery document on the receipt header.
 */
export const SUPPLIER_DOCUMENT_KINDS = ["coa", "sds", "specification", "photo", "other"] as const;
export type SupplierDocumentKind = (typeof SUPPLIER_DOCUMENT_KINDS)[number];
export const SUPPLIER_DOCUMENT_LABELS: Record<SupplierDocumentKind, string> = {
  coa: "Certificate of analysis (CoA)",
  sds: "Safety data sheet (SDS)",
  specification: "Specification",
  photo: "Photo",
  other: "Other document",
};

type AttachmentEntity = "goods_receipt" | "goods_receipt_line";

/** Resolves the receipt that owns an entity inside the caller's sites (never leaks other sites). */
async function owningReceipt(q: Tx | typeof db, ctx: AuthContext, entityType: string, entityId: string) {
  if (!isUuid(entityId)) throw new DomainError("not_found", "Record not found in your sites.");
  let receiptId = entityId;
  let line: typeof goodsReceiptLines.$inferSelect | null = null;
  if (entityType === "goods_receipt_line") {
    const [l] = await q.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.id, entityId)).limit(1);
    if (!l) throw new DomainError("not_found", "Record not found in your sites.");
    line = l;
    receiptId = l.goodsReceiptId;
  } else if (entityType !== "goods_receipt") {
    throw new DomainError("not_found", "Record not found in your sites.");
  }
  const [gr] = await q.select().from(goodsReceipts).where(and(eq(goodsReceipts.id, receiptId), eq(goodsReceipts.organizationId, ctx.organizationId))).limit(1);
  if (!gr || !ctx.allowedSiteIds.includes(gr.siteId)) throw new DomainError("not_found", "Record not found in your sites.");
  ctx.requireSite(gr.siteId);
  return { gr, line };
}

export type UploadInput = {
  entityType: AttachmentEntity;
  entityId: string;
  documentKind: SupplierDocumentKind;
  documentNumber?: string | null;
  fileName: string;
  declaredType: string;
  bytes: Uint8Array;
  idempotencyKey: string;
};

/**
 * Stores an uploaded file and links it (W01-03). Validation per docs/security.md §4.6 happens before
 * anything is written; the object key is opaque. A repeated idempotency key returns the first upload.
 */
export async function uploadReceiptDocument(ctx: AuthContext, input: UploadInput) {
  ctx.require("documents.file_attachment.create");
  ctx.require("procurement.supplier_lot_document.create");
  if (!isUuid(input.idempotencyKey)) throw new DomainError("validation", "The upload is missing its key. Reload the page and try again.");
  if (!(SUPPLIER_DOCUMENT_KINDS as readonly string[]).includes(input.documentKind)) throw new DomainError("validation", "Choose the document type.", { field: "documentKind" });
  if (input.entityType === "goods_receipt" && input.documentKind !== "photo" && input.documentKind !== "other") {
    throw new DomainError("validation", "Attach certificates to the receipt line of the material they belong to.", { field: "documentKind" });
  }
  const documentNumber = (input.documentNumber ?? "").trim() || null;
  if (documentNumber && documentNumber.length > 80) throw new DomainError("validation", "Document number is too long (max 80).", { field: "documentNumber" });

  const { gr } = await owningReceipt(db, ctx, input.entityType, input.entityId);
  if (gr.status !== "draft" && gr.status !== "posted") throw new DomainError("state", `The receipt is ${gr.status}; documents can no longer be attached.`);

  const [dup] = await db
    .select({ id: fileAttachments.id })
    .from(fileAttachments)
    .where(and(eq(fileAttachments.organizationId, ctx.organizationId), eq(fileAttachments.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (dup) return { attachmentId: dup.id, replayed: true };

  const storage = requireStorage();
  const file = validateUpload({ fileName: input.fileName, declaredType: input.declaredType, bytes: input.bytes });
  const attachmentId = uuidv7();
  const key = objectKey(ctx.organizationId, attachmentId);
  const checksum = createHash("sha256").update(file.bytes).digest("hex");
  await storage.put(key, file.bytes, file.contentType);

  return db.transaction(async (tx) => {
    // Re-check scope and state inside the transaction (the receipt may have changed meanwhile).
    const { gr: g, line } = await owningReceipt(tx, ctx, input.entityType, input.entityId);
    if (g.status !== "draft" && g.status !== "posted") throw new DomainError("state", `The receipt is ${g.status}; documents can no longer be attached.`);
    const inserted = await tx
      .insert(fileAttachments)
      .values({
        id: attachmentId,
        organizationId: ctx.organizationId,
        siteId: g.siteId,
        storageDriver: storage.driver,
        bucketKey: key,
        fileName: file.fileName,
        contentType: file.contentType,
        sizeBytes: file.bytes.length,
        checksumSha256: checksum,
        entityType: input.entityType,
        entityId: input.entityId,
        attachmentKind: input.documentKind,
        idempotencyKey: input.idempotencyKey,
        createdBy: ctx.userId,
      })
      .onConflictDoNothing()
      .returning({ id: fileAttachments.id });
    if (!inserted.length) {
      const [first] = await tx.select({ id: fileAttachments.id }).from(fileAttachments).where(and(eq(fileAttachments.organizationId, ctx.organizationId), eq(fileAttachments.idempotencyKey, input.idempotencyKey)));
      return { attachmentId: first.id, replayed: true };
    }
    if (line) {
      await tx.insert(supplierLotDocuments).values({
        organizationId: ctx.organizationId,
        siteId: g.siteId,
        goodsReceiptLineId: line.id,
        lotId: line.lotId,
        fileAttachmentId: attachmentId,
        documentKind: input.documentKind,
        documentNumber,
        createdBy: ctx.userId,
      });
      if (input.documentKind === "coa" && line.documentMissing) {
        await tx.update(goodsReceiptLines).set({ documentMissing: false, updatedAt: new Date() }).where(eq(goodsReceiptLines.id, line.id));
      }
    }
    await audit(tx, ctx, {
      action: "documents.file_attachment.uploaded",
      entityType: "file_attachment",
      entityId: attachmentId,
      entityNumber: g.receiptNumber,
      siteId: g.siteId,
      after: { parent: input.entityType, parentId: input.entityId, kind: input.documentKind, documentNumber, fileName: file.fileName, contentType: file.contentType, sizeBytes: file.bytes.length, sha256: checksum, metadataStripped: file.metadataStripped },
    });
    return { attachmentId, replayed: false };
  });
}

async function loadAttachment(q: Tx | typeof db, ctx: AuthContext, attachmentId: string) {
  if (!isUuid(attachmentId)) throw new DomainError("not_found", "File not found.");
  const [a] = await q.select().from(fileAttachments).where(and(eq(fileAttachments.id, attachmentId), eq(fileAttachments.organizationId, ctx.organizationId))).limit(1);
  if (!a || !a.entityType || !a.entityId) throw new DomainError("not_found", "File not found.");
  const { gr, line } = await owningReceipt(q, ctx, a.entityType, a.entityId).catch(() => {
    throw new DomainError("not_found", "File not found.");
  });
  return { a, gr, line };
}

function requireViewFile(ctx: AuthContext) {
  ctx.require("documents.file_attachment.view");
  if (!ctx.can("procurement.goods_receipt.view") && !ctx.can("procurement.supplier_lot_document.view")) ctx.require("procurement.supplier_lot_document.view");
}

/** Issues a 5-minute download link bound to the requesting user (docs/security.md §4.8). */
export async function issueDownloadUrl(ctx: AuthContext, attachmentId: string) {
  requireViewFile(ctx);
  const { a } = await loadAttachment(db, ctx, attachmentId);
  if (a.deletedAt) throw new DomainError("not_found", "File not found.");
  return { url: signDownloadUrl(a.id, ctx.userId), fileName: a.fileName };
}

/**
 * Redeems a signed link: the signature must be valid, unexpired and issued to this user, and the user
 * must still be allowed to see the parent record. Writes documents.file_attachment.downloaded.
 */
export async function redeemDownload(ctx: AuthContext, attachmentId: string, params: { exp?: string | null; sig?: string | null }) {
  requireViewFile(ctx);
  if (!verifyDownloadSignature(attachmentId, ctx.userId, params)) throw new DomainError("forbidden", "This download link has expired or was issued to someone else. Open the record again to get a new link.");
  const { a, gr } = await loadAttachment(db, ctx, attachmentId);
  if (a.deletedAt) throw new DomainError("not_found", "File not found.");
  if (a.virusScanStatus === "blocked") throw new DomainError("forbidden", "This file is quarantined and cannot be downloaded.");
  const storage = storageFor(a.storageDriver);
  await audit(db, ctx, {
    action: "documents.file_attachment.downloaded",
    entityType: "file_attachment",
    entityId: a.id,
    entityNumber: gr.receiptNumber,
    siteId: gr.siteId,
    after: { fileName: a.fileName, parent: a.entityType, parentId: a.entityId },
  });
  if (storage.presignDownload) {
    return { kind: "redirect" as const, url: storage.presignDownload(a.bucketKey, { fileName: a.fileName, contentType: a.contentType, expiresIn: 60 }) };
  }
  return { kind: "bytes" as const, bytes: await storage.get(a.bucketKey), fileName: a.fileName, contentType: a.contentType };
}

/** Voids (soft-deletes) an attachment with a reason; the stored object is kept for retention. */
export async function voidAttachment(ctx: AuthContext, input: { attachmentId: string; reason: string }) {
  ctx.require("documents.file_attachment.void");
  const reason = (input.reason ?? "").trim();
  if (reason.length < 5) throw new DomainError("validation", "Give a reason of at least 5 characters.", { field: "reason" });
  return db.transaction(async (tx) => {
    const { a, gr, line } = await loadAttachment(tx, ctx, input.attachmentId);
    if (a.deletedAt) throw new DomainError("state", "This file is already removed.");
    await tx.update(fileAttachments).set({ deletedAt: new Date(), deletedBy: ctx.userId, deleteReason: reason }).where(eq(fileAttachments.id, a.id));
    if (line && line.lotId) {
      // Removing the last CoA of a material that requires one flags the line again.
      const [m] = await tx.select({ requiresCoa: materials.requiresCoa }).from(materials).where(eq(materials.id, line.materialId));
      if (m?.requiresCoa) {
        const [other] = await tx
          .select({ id: supplierLotDocuments.id })
          .from(supplierLotDocuments)
          .innerJoin(fileAttachments, eq(fileAttachments.id, supplierLotDocuments.fileAttachmentId))
          .where(and(eq(supplierLotDocuments.goodsReceiptLineId, line.id), eq(supplierLotDocuments.documentKind, "coa"), isNull(fileAttachments.deletedAt)))
          .limit(1);
        if (!other) await tx.update(goodsReceiptLines).set({ documentMissing: true, updatedAt: new Date() }).where(eq(goodsReceiptLines.id, line.id));
      }
    }
    await audit(tx, ctx, {
      action: "documents.file_attachment.removed",
      entityType: "file_attachment",
      entityId: a.id,
      entityNumber: gr.receiptNumber,
      siteId: gr.siteId,
      reason,
      before: { fileName: a.fileName, kind: a.attachmentKind },
    });
    return { attachmentId: a.id };
  });
}

/** Supplier documents of a lot for QA (lot decision page). */
export async function listLotDocuments(ctx: AuthContext, lotId: string) {
  if (!ctx.can("procurement.supplier_lot_document.view") && !ctx.can("quality.disposition.view")) ctx.require("procurement.supplier_lot_document.view");
  if (!isUuid(lotId)) return [];
  const rows = await db
    .select({
      id: fileAttachments.id,
      fileName: fileAttachments.fileName,
      contentType: fileAttachments.contentType,
      sizeBytes: fileAttachments.sizeBytes,
      documentKind: supplierLotDocuments.documentKind,
      documentNumber: supplierLotDocuments.documentNumber,
      createdAt: fileAttachments.createdAt,
      uploadedBy: users.displayName,
      siteId: supplierLotDocuments.siteId,
    })
    .from(supplierLotDocuments)
    .innerJoin(fileAttachments, eq(fileAttachments.id, supplierLotDocuments.fileAttachmentId))
    .innerJoin(users, eq(users.id, fileAttachments.createdBy))
    .where(and(eq(supplierLotDocuments.lotId, lotId), eq(supplierLotDocuments.organizationId, ctx.organizationId), isNull(fileAttachments.deletedAt)))
    .orderBy(asc(fileAttachments.createdAt));
  return rows.filter((r) => ctx.allowedSiteIds.includes(r.siteId));
}

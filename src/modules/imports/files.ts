import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db, type DbOrTx } from "@/db/client";
import { fileAttachments, importJobs, legacyDocuments } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { objectKey, requireStorage, signDownloadUrl, storageFor, verifyDownloadSignature } from "@/lib/storage";

/**
 * Files of the import area (docs/security.md §4.6, §4.8): original upload and error files (kind `import`,
 * owned by the import job) and legacy scans (kind `legacy_document`, owned by the job until indexed, then
 * by the legacy document). Objects live under opaque keys; downloads use 5-minute links bound to the
 * user, are re-checked against the parent's permission and site, are served as attachments and audited.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function storeObject(ctx: AuthContext, bytes: Uint8Array, contentType: string) {
  const storage = requireStorage();
  const id = uuidv7();
  const key = objectKey(ctx.organizationId, id);
  await storage.put(key, bytes, contentType);
  return { id, key, driver: storage.driver, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function insertAttachment(
  q: DbOrTx,
  ctx: AuthContext,
  o: { id: string; key: string; driver: "local" | "s3"; siteId: string; fileName: string; contentType: string; size: number; sha256: string; entityType: string; entityId: string; kind: "import" | "legacy_document"; idempotencyKey?: string | null },
) {
  await q.insert(fileAttachments).values({
    id: o.id,
    organizationId: ctx.organizationId,
    siteId: o.siteId,
    storageDriver: o.driver,
    bucketKey: o.key,
    fileName: o.fileName,
    contentType: o.contentType,
    sizeBytes: o.size,
    checksumSha256: o.sha256,
    entityType: o.entityType,
    entityId: o.entityId,
    attachmentKind: o.kind,
    idempotencyKey: o.idempotencyKey ?? null,
    createdBy: ctx.userId,
  });
}

/** Resolves an attachment of the import area and checks the reader may see its parent. */
async function loadImportFile(ctx: AuthContext, attachmentId: string) {
  if (!UUID_RE.test(attachmentId)) throw new DomainError("not_found", "File not found.");
  const [a] = await db.select().from(fileAttachments).where(and(eq(fileAttachments.id, attachmentId), eq(fileAttachments.organizationId, ctx.organizationId))).limit(1);
  if (!a || a.deletedAt || !a.entityId) throw new DomainError("not_found", "File not found.");
  if (a.entityType === "import_job") {
    ctx.require("platform.import_job.view");
    const [job] = await db.select({ siteId: importJobs.siteId, number: importJobs.importNumber }).from(importJobs).where(eq(importJobs.id, a.entityId)).limit(1);
    if (!job || !ctx.allowedSiteIds.includes(job.siteId)) throw new DomainError("not_found", "File not found.");
    return { a, siteId: job.siteId, number: job.number };
  }
  if (a.entityType === "legacy_document") {
    ctx.require("documents.legacy_document.view");
    ctx.require("documents.file_attachment.view");
    const [d] = await db.select({ siteId: legacyDocuments.siteId, number: legacyDocuments.documentNumber }).from(legacyDocuments).where(eq(legacyDocuments.id, a.entityId)).limit(1);
    if (!d || (d.siteId && !ctx.allowedSiteIds.includes(d.siteId))) throw new DomainError("not_found", "File not found.");
    return { a, siteId: d.siteId, number: d.number };
  }
  throw new DomainError("not_found", "File not found.");
}

/** A 5-minute link to /api/v1/imports/files/<id> bound to the requesting user. */
export async function issueImportFileUrl(ctx: AuthContext, attachmentId: string) {
  const { a } = await loadImportFile(ctx, attachmentId);
  const signed = signDownloadUrl(a.id, ctx.userId);
  return { url: signed.replace("/api/v1/files/", "/api/v1/imports/files/"), fileName: a.fileName };
}

export async function redeemImportFile(ctx: AuthContext, attachmentId: string, params: { exp?: string | null; sig?: string | null }) {
  if (!verifyDownloadSignature(attachmentId, ctx.userId, params)) throw new DomainError("forbidden", "This download link has expired or was issued to someone else. Open the page again to get a new link.");
  const { a, siteId, number } = await loadImportFile(ctx, attachmentId);
  if (a.virusScanStatus === "blocked") throw new DomainError("forbidden", "This file is quarantined and cannot be downloaded.");
  const storage = storageFor(a.storageDriver);
  await audit(db, ctx, { action: "documents.file_attachment.downloaded", entityType: "file_attachment", entityId: a.id, entityNumber: number, siteId, after: { fileName: a.fileName, parent: a.entityType, parentId: a.entityId } });
  if (storage.presignDownload) return { kind: "redirect" as const, url: storage.presignDownload(a.bucketKey, { fileName: a.fileName, contentType: a.contentType, expiresIn: 60 }) };
  return { kind: "bytes" as const, bytes: await storage.get(a.bucketKey), fileName: a.fileName, contentType: a.contentType };
}

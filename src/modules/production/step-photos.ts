import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { fileAttachments } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { objectKey, requireStorage, validateUpload } from "@/lib/storage";
import { findStep, performPermission } from "./execution";
import { lockBatch } from "./shared";

/**
 * ADR-137 "Take a photo" on a step: the photo a checklist item asks for (a custom step's photo field, the "Take a photo"
 * block, a line clearance item that needs a photo). Stored like any file (checked type and size, SHA-256, object storage)
 * and linked to the batch; the checklist answer then points at it (`process_step_checklist_results.photo_attachment_id`).
 * Who may: the person who may do the step, at the batch's site. Idempotent by key.
 */
export async function attachStepPhoto(ctx: AuthContext, input: { batchId: string; stepNo: number; itemId: string; fileName: string; declaredType: string; bytes: Uint8Array; idempotencyKey: string }) {
  if (!/^[0-9A-Za-z-]{8,100}$/.test(input.idempotencyKey)) throw new DomainError("validation", "The photo is missing its key. Reload the page and try again.");
  const [dup] = await db.select({ id: fileAttachments.id }).from(fileAttachments).where(and(eq(fileAttachments.organizationId, ctx.organizationId), eq(fileAttachments.idempotencyKey, input.idempotencyKey))).limit(1);
  if (dup) return { attachmentId: dup.id, replayed: true };
  const file = validateUpload({ fileName: input.fileName || "photo.jpg", declaredType: input.declaredType, bytes: input.bytes });
  if (!file.contentType.startsWith("image/")) throw new DomainError("validation", "Take a photo (a picture file).", { field: `photo-${input.itemId}` });
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    const step = findStep(batch, input.stepNo);
    const perm = performPermission(step.stepKind);
    ctx.require(perm === "production.dispense_record.create" ? "production.process_step_record.create" : perm);
    if (!ctx.canAt(perm === "production.dispense_record.create" ? "production.process_step_record.create" : perm, batch.siteId)) ctx.requireSite(batch.siteId);
    const item = (step.checklistItems ?? []).find((c) => c.id === input.itemId);
    if (!item) throw new DomainError("validation", "This photo is not asked for on this step.");
    const storage = requireStorage();
    const attachmentId = uuidv7();
    const bucketKey = objectKey(ctx.organizationId, attachmentId);
    const checksum = createHash("sha256").update(file.bytes).digest("hex");
    await storage.put(bucketKey, file.bytes, file.contentType);
    await tx.insert(fileAttachments).values({
      id: attachmentId,
      organizationId: ctx.organizationId,
      siteId: batch.siteId,
      storageDriver: storage.driver,
      bucketKey,
      fileName: file.fileName,
      contentType: file.contentType,
      sizeBytes: file.bytes.length,
      checksumSha256: checksum,
      entityType: "batch",
      entityId: batch.id,
      attachmentKind: "photo",
      idempotencyKey: input.idempotencyKey,
      createdBy: ctx.userId,
    });
    await audit(tx, ctx, {
      action: "documents.file_attachment.uploaded",
      entityType: "file_attachment",
      entityId: attachmentId,
      entityNumber: batch.batchNumber,
      siteId: batch.siteId,
      after: { parent: "batch", parentId: batch.id, kind: "step_photo", stepNo: step.stepNo, item: item.text, fileName: file.fileName, contentType: file.contentType, sizeBytes: file.bytes.length, sha256: checksum },
    });
    return { attachmentId, replayed: false };
  });
}

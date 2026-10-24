import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db, type DbOrTx, type Tx } from "@/db/client";
import { batchPaperRecords, batches, fileAttachments, routingSteps, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime, fmtQty } from "@/lib/qty";
import { getSetting } from "@/lib/settings";
import { objectKey, requireStorage, signDownloadUrl, storageFor, validateUpload, verifyDownloadSignature } from "@/lib/storage";
import { generateForSource, type BmrPaperPageData } from "@/modules/documents";
import { PAPER_PAGE_KIND, bmrTemplateFor, visibleBatch } from "./bmr";
import { type FormulaSnapshot, lockBatch } from "./shared";

/**
 * Hybrid paper record pages (US-3-20; docs/reports-and-templates.md §2.5, A-RPT-06, A-PROC-37).
 *
 * issued   blank page printed for a step (a generated document with its own DOC number and QR)
 * attached the completed page is scanned and uploaded by the person who transcribed it into the system
 * reviewed a different person confirmed the transcription against the scan (reviewer ≠ transcriber)
 * returned the reviewer found a mismatch; correct the electronic record and attach again
 * void     an issued page that was not used (spoiled, printed twice), with a reason
 *
 * Both records are kept: the scan and the electronic step record. Pages that are not reviewed
 * block the batch from leaving awaiting_qc and from closure; a `paper_then_transcribe` step needs
 * at least one reviewed page.
 */

export const PAPER_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  issued: ["attached", "void"],
  attached: ["reviewed", "returned"],
  returned: ["attached", "void"],
  reviewed: [],
  void: [],
};

function assertPaperTransition(from: string, to: string, ref: string) {
  if (!(PAPER_STATUS_TRANSITIONS[from] ?? []).includes(to)) throw new DomainError("state", `Paper page ${ref} is ${from}; it cannot become ${to}.`);
}

/** Batch states in which paper pages can be issued and attached (not after QA has started the final decision path). */
const OPEN_STATES = ["planned", "materials_staged", "in_process", "awaiting_qc", "quarantined", "rework_approved", "released", "rejected"];

/** Step kinds that may never be recorded on paper only (system records for traceability and stock). */
export const NEVER_PAPER_ONLY_STEP_KINDS = ["dispensing", "transfer", "reconciliation"] as const;

async function loadPaper(tx: DbOrTx, ctx: AuthContext, id: string, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("not_found", "Paper page not found in your sites.");
  const q = tx.select().from(batchPaperRecords).where(and(eq(batchPaperRecords.id, id), eq(batchPaperRecords.organizationId, ctx.organizationId))).limit(1);
  const [p] = lock ? await q.for("update") : await q;
  if (!p || !ctx.allowedSiteIds.includes(p.siteId)) throw new DomainError("not_found", "Paper page not found in your sites.");
  return p;
}

/** Issues a blank paper page for a routing step of the batch and generates its printable document. */
export async function issuePaperPage(ctx: AuthContext, input: { batchId: string; stepNo: number; idempotencyKey: string }) {
  ctx.require("production.batch.edit");
  ctx.require("documents.generated_document.create");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  const key = `paper-issue:${input.idempotencyKey}`;
  return db.transaction(async (tx) => {
    const [replay] = await tx.select().from(batchPaperRecords).where(and(eq(batchPaperRecords.organizationId, ctx.organizationId), eq(batchPaperRecords.idempotencyKey, key))).limit(1);
    if (replay) return { paperRecordId: replay.id, reference: replay.paperReference, documentId: replay.generatedDocumentId, replayed: true };
    await visibleBatch(tx, ctx, input.batchId);
    const b = await lockBatch(tx, ctx, input.batchId);
    if (!OPEN_STATES.includes(b.status)) throw new DomainError("state", `Batch ${b.batchNumber} is ${b.status.replace(/_/g, " ")}; paper pages can no longer be issued.`);
    const snap = b.formulaSnapshot as FormulaSnapshot;
    const step = snap.steps.find((s) => s.stepNo === Number(input.stepNo));
    if (!step) throw new DomainError("validation", "Choose a step of this batch's routing.", { field: "stepNo" });
    const [rs] = await tx.select({ mode: routingSteps.recordMode }).from(routingSteps).where(eq(routingSteps.id, step.routingStepId)).limit(1);
    const mode = rs?.mode ?? "electronic";
    const [m] = await tx.select({ n: max(batchPaperRecords.pageNo) }).from(batchPaperRecords).where(eq(batchPaperRecords.batchId, b.id));
    const pageNo = (m?.n ?? 0) + 1;
    const reference = `${b.batchNumber}-P${String(pageNo).padStart(2, "0")}`;
    const id = uuidv7();

    const resolved = await bmrTemplateFor(tx, ctx, { id: b.id, siteId: b.siteId, createdAt: b.createdAt }, PAPER_PAGE_KIND);
    if (!resolved) {
      const code = await getSetting(tx, ctx.organizationId, "documents.bmr.paper_page_template_code", b.siteId);
      throw new DomainError("setup_required", `No approved paper page template (${code}) is available. Ask QA to approve one under Admin → Document templates.`);
    }
    const { product, siteCode } = await visibleBatch(tx, ctx, b.id);
    const data: BmrPaperPageData = {
      schema: "bmr_paper_page/v1",
      batch: {
        id: b.id,
        number: b.batchNumber,
        productName: product.name,
        productCode: product.skuCode,
        formulaLabel: `${snap.formulaCode} rev ${snap.revisionNo}`,
        routingLabel: snap.routing ? `${snap.routing.routingCode} rev ${snap.routing.revisionNo}` : null,
        siteCode,
        batchSizeText: fmtQty(b.plannedSizeG, "g", 0),
      },
      page: {
        reference,
        pageNo,
        stepNo: step.stepNo,
        stepName: step.name,
        kindLabel: step.stepKind.replace(/_/g, " "),
        mode: mode.replace(/_/g, " "),
        instruction: step.instruction ?? null,
        workInstruction: step.workInstruction ? `${step.workInstruction.code} rev ${step.workInstruction.revisionNo}` : null,
        parameters: (step.parameters ?? []).map((p) => ({
          name: p.name,
          uom: p.uom,
          limits: [p.minValue ? `min ${p.minValue}` : null, p.targetValue ? `target ${p.targetValue}` : null, p.maxValue ? `max ${p.maxValue}` : null].filter(Boolean).join(" · ") || "—",
        })),
        checklist: (step.checklistItems ?? []).map((c) => ({ itemNo: c.itemNo, text: c.text })),
        issuedBy: ctx.displayName,
        issuedAt: fmtDateTime(new Date()),
      },
      notice: "Limits and procedure text are configuration to be verified by authorized personnel before production use.",
    };
    const doc = await generateForSource(tx, ctx, {
      resolved,
      documentKind: PAPER_PAGE_KIND,
      source: { type: "batch", id: b.id, revisionAt: new Date(), state: b.status },
      siteId: b.siteId,
      data,
      watermark: null,
      idempotencyKey: `paper-doc:${input.idempotencyKey}`,
      parameters: { paperRecordId: id, reference },
      supersedePrevious: false,
    });
    await tx.insert(batchPaperRecords).values({
      id,
      organizationId: ctx.organizationId,
      siteId: b.siteId,
      batchId: b.id,
      routingStepId: step.routingStepId,
      stepNo: step.stepNo,
      stepName: step.name,
      recordMode: mode,
      pageNo,
      paperReference: reference,
      status: "issued",
      generatedDocumentId: doc.id,
      issuedBy: ctx.userId,
      idempotencyKey: key,
    });
    await audit(tx, ctx, {
      action: "production.batch_paper_record.issued",
      entityType: "batch_paper_record",
      entityId: id,
      entityNumber: b.batchNumber,
      siteId: b.siteId,
      after: { reference, stepNo: step.stepNo, step: step.name, recordMode: mode, documentNumber: doc.documentNumber },
    });
    return { paperRecordId: id, reference, documentId: doc.id, replayed: false };
  });
}

export type AttachPaperInput = { paperRecordId: string; fileName: string; declaredType: string; bytes: Uint8Array; transcriptionNote?: string | null; idempotencyKey: string };

/**
 * Uploads the scan of a completed page; the uploader declares that they transcribed it into the
 * system (transcribed_by). Storage must be configured (setup-required state otherwise).
 */
export async function attachPaperScan(ctx: AuthContext, input: AttachPaperInput) {
  ctx.require("documents.file_attachment.create");
  ctx.require("production.batch.edit");
  if (!/^[0-9a-f-]{36}$/i.test(input.idempotencyKey)) throw new DomainError("validation", "The upload is missing its key. Reload the page and try again.");
  const note = input.transcriptionNote?.trim() || null;
  if (note && note.length > 1000) throw new DomainError("validation", "The note is too long (max 1000).", { field: "transcriptionNote" });
  const p0 = await loadPaper(db, ctx, input.paperRecordId);
  assertPaperTransition(p0.status, "attached", p0.paperReference);
  const [dup] = await db.select({ id: fileAttachments.id }).from(fileAttachments).where(and(eq(fileAttachments.organizationId, ctx.organizationId), eq(fileAttachments.idempotencyKey, input.idempotencyKey))).limit(1);
  if (dup) return { attachmentId: dup.id, replayed: true };

  const storage = requireStorage();
  const file = validateUpload({ fileName: input.fileName, declaredType: input.declaredType, bytes: input.bytes });
  const attachmentId = uuidv7();
  const bucketKey = objectKey(ctx.organizationId, attachmentId);
  const checksum = createHash("sha256").update(file.bytes).digest("hex");
  await storage.put(bucketKey, file.bytes, file.contentType);

  return db.transaction(async (tx) => {
    const p = await loadPaper(tx, ctx, input.paperRecordId, true);
    ctx.requireSite(p.siteId);
    assertPaperTransition(p.status, "attached", p.paperReference);
    const [b] = await tx.select({ number: batches.batchNumber }).from(batches).where(eq(batches.id, p.batchId)).limit(1);
    await tx.insert(fileAttachments).values({
      id: attachmentId,
      organizationId: ctx.organizationId,
      siteId: p.siteId,
      storageDriver: storage.driver,
      bucketKey,
      fileName: file.fileName,
      contentType: file.contentType,
      sizeBytes: file.bytes.length,
      checksumSha256: checksum,
      entityType: "batch_paper_record",
      entityId: p.id,
      attachmentKind: "paper_record_page",
      idempotencyKey: input.idempotencyKey,
      createdBy: ctx.userId,
    });
    const now = new Date();
    await tx
      .update(batchPaperRecords)
      .set({ status: "attached", fileAttachmentId: attachmentId, transcribedBy: ctx.userId, transcribedAt: now, transcriptionNote: note, reviewedBy: null, reviewedAt: null, updatedAt: now })
      .where(eq(batchPaperRecords.id, p.id));
    await audit(tx, ctx, {
      action: "documents.file_attachment.uploaded",
      entityType: "file_attachment",
      entityId: attachmentId,
      entityNumber: b.number,
      siteId: p.siteId,
      after: { parent: "batch_paper_record", parentId: p.id, kind: "paper_record_page", fileName: file.fileName, contentType: file.contentType, sizeBytes: file.bytes.length, sha256: checksum },
    });
    await audit(tx, ctx, {
      action: "production.batch_paper_record.transcribed",
      entityType: "batch_paper_record",
      entityId: p.id,
      entityNumber: b.number,
      siteId: p.siteId,
      before: { status: p.status },
      after: { status: "attached", reference: p.paperReference, sha256: checksum.slice(0, 8), note },
    });
    return { attachmentId, replayed: false };
  });
}

/** Reviewer (≠ transcriber) confirms the transcription or returns the page with a reason. */
export async function reviewPaperRecord(ctx: AuthContext, input: { paperRecordId: string; decision: "confirm" | "return"; note?: string | null }) {
  ctx.require("production.process_step_record.approve");
  const note = input.note?.trim() || null;
  if (input.decision === "return" && (!note || note.length < 5)) throw new DomainError("validation", "Say what does not match (at least 5 characters).", { field: "note" });
  return db.transaction(async (tx) => {
    const p = await loadPaper(tx, ctx, input.paperRecordId, true);
    ctx.requireSite(p.siteId);
    const to = input.decision === "confirm" ? "reviewed" : "returned";
    assertPaperTransition(p.status, to, p.paperReference);
    if (p.transcribedBy === ctx.userId) throw new DomainError("separation_of_duties", "You transcribed this page, so another person must review it.");
    const now = new Date();
    await tx
      .update(batchPaperRecords)
      .set(to === "reviewed" ? { status: to, reviewedBy: ctx.userId, reviewedAt: now, reviewNote: note, updatedAt: now } : { status: to, reviewNote: note, updatedAt: now })
      .where(eq(batchPaperRecords.id, p.id));
    const [b] = await tx.select({ number: batches.batchNumber }).from(batches).where(eq(batches.id, p.batchId)).limit(1);
    await audit(tx, ctx, {
      action: to === "reviewed" ? "production.batch_paper_record.reviewed" : "production.batch_paper_record.returned",
      entityType: "batch_paper_record",
      entityId: p.id,
      entityNumber: b.number,
      siteId: p.siteId,
      reason: note,
      before: { status: p.status },
      after: { status: to, reference: p.paperReference },
    });
    return { status: to };
  });
}

/** Voids an unused page (issued or returned) with a reason; the record and its document are kept. */
export async function voidPaperPage(ctx: AuthContext, input: { paperRecordId: string; reason: string }) {
  ctx.require("production.batch.edit");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) throw new DomainError("validation", "Give a reason (at least 5 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const p = await loadPaper(tx, ctx, input.paperRecordId, true);
    ctx.requireSite(p.siteId);
    assertPaperTransition(p.status, "void", p.paperReference);
    const now = new Date();
    await tx.update(batchPaperRecords).set({ status: "void", voidedBy: ctx.userId, voidedAt: now, voidReason: reason, updatedAt: now }).where(eq(batchPaperRecords.id, p.id));
    const [b] = await tx.select({ number: batches.batchNumber }).from(batches).where(eq(batches.id, p.batchId)).limit(1);
    await audit(tx, ctx, { action: "production.batch_paper_record.voided", entityType: "batch_paper_record", entityId: p.id, entityNumber: b.number, siteId: p.siteId, reason, before: { status: p.status }, after: { status: "void" } });
  });
}

export type PaperBlocker = { code: "paper_unreviewed" | "paper_missing"; message: string };

/**
 * What stops a batch from leaving awaiting_qc or closing (§2.5): pages that are issued, attached
 * or returned but not reviewed, and `paper_then_transcribe` steps without a reviewed page.
 */
export async function paperRecordBlockers(q: DbOrTx, batchId: string): Promise<PaperBlocker[]> {
  const [b] = await q.select({ snap: batches.formulaSnapshot }).from(batches).where(eq(batches.id, batchId)).limit(1);
  if (!b) return [];
  const pages = await q.select().from(batchPaperRecords).where(eq(batchPaperRecords.batchId, batchId)).orderBy(asc(batchPaperRecords.pageNo));
  const out: PaperBlocker[] = pages
    .filter((p) => ["issued", "attached", "returned"].includes(p.status))
    .map((p) => ({ code: "paper_unreviewed" as const, message: `Paper page ${p.paperReference} (step ${p.stepNo}, ${p.stepName}) is ${p.status}, not reviewed.` }));
  const snap = b.snap as FormulaSnapshot;
  const ids = snap.steps.map((s) => s.routingStepId);
  if (ids.length) {
    const modes = await q.select({ id: routingSteps.id, mode: routingSteps.recordMode }).from(routingSteps).where(inArray(routingSteps.id, ids));
    for (const s of snap.steps) {
      if (modes.find((m) => m.id === s.routingStepId)?.mode !== "paper_then_transcribe") continue;
      if (!pages.some((p) => p.stepNo === s.stepNo && p.status === "reviewed")) {
        out.push({ code: "paper_missing", message: `Step ${s.stepNo} (${s.name}) is recorded on paper and has no reviewed paper page yet.` });
      }
    }
  }
  return out;
}

/**
 * Guard for the awaiting_qc exit (docs/data-model.md §6.2): call inside the transaction that moves
 * the batch out of awaiting_qc. 409 with the blocking pages listed.
 */
export async function assertPaperRecordsReviewed(tx: Tx | DbOrTx, batchId: string, batchNumber: string) {
  const blockers = await paperRecordBlockers(tx, batchId);
  if (blockers.length) {
    throw new DomainError("state", `Batch ${batchNumber} has paper pages that are not reviewed: ${blockers.map((b) => b.message).join(" ")}`, { blockers });
  }
}

/** Paper pages of a batch for the closure page, with people's names. */
export async function listPaperRecords(ctx: AuthContext, batchId: string) {
  await visibleBatch(db, ctx, batchId);
  const rows = await db
    .select({ p: batchPaperRecords, fileName: fileAttachments.fileName, sha: fileAttachments.checksumSha256 })
    .from(batchPaperRecords)
    .leftJoin(fileAttachments, eq(fileAttachments.id, batchPaperRecords.fileAttachmentId))
    .where(and(eq(batchPaperRecords.batchId, batchId), eq(batchPaperRecords.organizationId, ctx.organizationId)))
    .orderBy(asc(batchPaperRecords.pageNo));
  const ids = [...new Set(rows.flatMap((r) => [r.p.issuedBy, r.p.transcribedBy, r.p.reviewedBy, r.p.voidedBy]).filter((x): x is string => !!x))];
  const people = ids.length ? await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, ids)) : [];
  const nm = (id: string | null) => (id ? (people.find((u) => u.id === id)?.name ?? "Unknown user") : null);
  return rows.map((r) => ({
    ...r.p,
    fileName: r.fileName,
    sha8: r.sha?.slice(0, 8) ?? null,
    issuedByName: nm(r.p.issuedBy),
    transcribedByName: nm(r.p.transcribedBy),
    reviewedByName: nm(r.p.reviewedBy),
    voidedByName: nm(r.p.voidedBy),
  }));
}

/** A 5-minute, user-bound link to the scan (docs/security.md §4.8). */
export async function paperScanDownloadUrl(ctx: AuthContext, paperRecordId: string) {
  ctx.require("documents.file_attachment.view");
  const p = await loadPaper(db, ctx, paperRecordId);
  if (!p.fileAttachmentId) throw new DomainError("not_found", "No scan is attached to this page.");
  await visibleBatch(db, ctx, p.batchId);
  const signed = signDownloadUrl(p.fileAttachmentId, ctx.userId);
  return signed.replace(`/api/v1/files/${p.fileAttachmentId}`, `/api/v1/production/paper-records/${p.id}/file`);
}

/** Redeems a signed link for the scan of a paper page; audited as documents.file_attachment.downloaded. */
export async function redeemPaperScan(ctx: AuthContext, paperRecordId: string, params: { exp?: string | null; sig?: string | null }) {
  ctx.require("documents.file_attachment.view");
  const p = await loadPaper(db, ctx, paperRecordId);
  await visibleBatch(db, ctx, p.batchId);
  if (!p.fileAttachmentId || !verifyDownloadSignature(p.fileAttachmentId, ctx.userId, params)) {
    throw new DomainError("forbidden", "This download link has expired or was issued to someone else. Open the batch again to get a new link.");
  }
  const [a] = await db.select().from(fileAttachments).where(eq(fileAttachments.id, p.fileAttachmentId)).limit(1);
  if (!a || a.deletedAt) throw new DomainError("not_found", "File not found.");
  const storage = storageFor(a.storageDriver);
  const [b] = await db.select({ number: batches.batchNumber }).from(batches).where(eq(batches.id, p.batchId)).limit(1);
  await audit(db, ctx, { action: "documents.file_attachment.downloaded", entityType: "file_attachment", entityId: a.id, entityNumber: b.number, siteId: p.siteId, after: { fileName: a.fileName, parent: "batch_paper_record", parentId: p.id } });
  if (storage.presignDownload) return { kind: "redirect" as const, url: storage.presignDownload(a.bucketKey, { fileName: a.fileName, contentType: a.contentType, expiresIn: 60 }) };
  return { kind: "bytes" as const, bytes: await storage.get(a.bucketKey), fileName: a.fileName, contentType: a.contentType };
}


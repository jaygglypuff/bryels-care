import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { type DbOrTx, db } from "@/db/client";
import { fileAttachments, processStepChecklistResults, processStepRecords } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { type SnapshotStep, type StepRecord, assertCheckerFor, findStep, finishStep, openStep, stepLabel } from "./execution";
import { idempotent, lockBatch } from "./shared";

export type ClearanceAnswer = { itemId: string; answer: "yes" | "no" | "na"; note?: string | null; photoAttachmentId?: string | null };

export type SubmitChecklistInput = {
  batchId: string;
  stepNo: number;
  answers: ClearanceAnswer[];
  notes?: string | null;
  idempotencyKey?: string | null;
};

/** Current answer per checklist item of a step record (the latest row that nothing supersedes). */
export async function currentChecklistAnswers(q: DbOrTx, recordId: string) {
  const rows = await q.select().from(processStepChecklistResults).where(eq(processStepChecklistResults.processStepRecordId, recordId));
  const superseded = new Set(rows.map((r) => r.supersedesId).filter(Boolean));
  return rows.filter((r) => !superseded.has(r.id));
}

/**
 * Open items that keep a checklist step from completing: unanswered items, and "no" answers on
 * blocking items (W05-06/10/14: any "no" blocks until resolved or a deviation is raised).
 */
export async function checklistBlockers(q: DbOrTx, step: SnapshotStep, rec: StepRecord | null): Promise<string[]> {
  const items = step.checklistItems ?? [];
  if (!items.length) return [];
  const answers = rec ? await currentChecklistAnswers(q, rec.id) : [];
  const out: string[] = [];
  for (const it of items) {
    const a = answers.find((x) => x.routingStepChecklistItemId === it.id);
    if (!a) out.push(`Answer item ${it.itemNo}: ${it.text}`);
    else if (a.answer === "no" && it.isBlocking) out.push(`Item ${it.itemNo} answered "no": ${it.text}. Resolve it and answer again, or raise a deviation.`);
  }
  return out;
}

/**
 * Line clearance / checklist step (US-3-09, W05-06/10/14): records one answer per configured item
 * (a re-submission supersedes the earlier answer, never overwrites it). When every blocking item is
 * "yes" or "n/a" the step finishes: completed with a co-signed checker, otherwise waiting for the
 * checker. A "no" on a blocking item keeps the step in progress with the reason shown. The first
 * signed clearance moves the batch materials_staged → in_process (execution.finishStep).
 */
export async function submitChecklist(ctx: AuthContext, input: SubmitChecklistInput, signers: { checker?: AuthContext | null } = {}) {
  ctx.require("production.line_clearance.create");
  if (!Array.isArray(input.answers) || input.answers.length === 0) throw new DomainError("validation", "Answer the checklist items.");
  for (const a of input.answers) {
    if (!["yes", "no", "na"].includes(a.answer)) throw new DomainError("validation", "Each answer must be yes, no or n/a.");
    if (a.answer === "no" && !(a.note ?? "").trim()) {
      throw new DomainError("validation", 'Explain every "no" answer (what was found and what you did).', { fieldErrors: { [`note-${a.itemId}`]: "Explain this answer." } });
    }
    if ((a.note ?? "").length > 500) throw new DomainError("validation", "Notes can have at most 500 characters.");
  }
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, ctx, input.batchId);
    const { result } = await idempotent(tx, ctx, input.idempotencyKey, "production.line_clearance.submit", async () => {
      const step = findStep(batch, input.stepNo);
      const items = step.checklistItems ?? [];
      if (!items.length) throw new DomainError("validation", `${stepLabel(step)} has no checklist items in its routing revision.`);
      if (signers.checker) assertCheckerFor(signers.checker, ctx.userId, step.stepKind, batch.siteId);
      const rec = await openStep(tx, ctx, batch, step);
      const current = await currentChecklistAnswers(tx, rec.id);
      const photoIds = input.answers.map((a) => a.photoAttachmentId).filter((x): x is string => !!x);
      if (photoIds.length) {
        const found = await tx
          .select({ id: fileAttachments.id })
          .from(fileAttachments)
          .where(and(inArray(fileAttachments.id, photoIds), eq(fileAttachments.organizationId, ctx.organizationId)));
        if (found.length !== new Set(photoIds).size) throw new DomainError("validation", "A photo was not found. Upload it again.");
      }
      let written = 0;
      for (const a of input.answers) {
        const item = items.find((i) => i.id === a.itemId);
        if (!item) throw new DomainError("validation", "An answered item is not part of this step's checklist.");
        const prev = current.find((c) => c.routingStepChecklistItemId === item.id);
        const note = a.note?.trim() || null;
        if (prev && prev.answer === a.answer && (prev.note ?? null) === note && !a.photoAttachmentId) continue; // unchanged
        if (item.requiresPhoto && !a.photoAttachmentId && !prev?.photoAttachmentId) {
          throw new DomainError("validation", `Item ${item.itemNo} needs a photo.`, { fieldErrors: { [`photo-${item.id}`]: "Add a photo." } });
        }
        await tx.insert(processStepChecklistResults).values({
          organizationId: ctx.organizationId,
          siteId: batch.siteId,
          processStepRecordId: rec.id,
          routingStepChecklistItemId: item.id,
          itemNo: item.itemNo,
          itemText: item.text,
          isBlocking: item.isBlocking,
          answer: a.answer,
          note,
          photoAttachmentId: a.photoAttachmentId ?? prev?.photoAttachmentId ?? null,
          answeredBy: ctx.userId,
          supersedesId: prev?.id ?? null,
        });
        written += 1;
      }
      await audit(tx, ctx, {
        action: "production.line_clearance.answered",
        entityType: "process_step_record",
        entityId: rec.id,
        entityNumber: batch.batchNumber,
        siteId: batch.siteId,
        after: { stepNo: step.stepNo, name: step.name, area: step.area ?? null, answers: input.answers.map((a) => ({ item: items.find((i) => i.id === a.itemId)?.itemNo, answer: a.answer })), changed: written },
      });
      const blockers = await checklistBlockers(tx, step, rec);
      if (blockers.length) {
        await tx.update(processStepRecords).set({ blockedReason: blockers.join(" ") }).where(eq(processStepRecords.id, rec.id));
        return { stepNo: step.stepNo, name: step.name, status: "in_progress" as const, blocked: true, blockers };
      }
      const fin = await finishStep(tx, ctx, batch, step, rec, { checker: signers.checker ?? null, notes: input.notes });
      return { stepNo: step.stepNo, name: step.name, status: fin.status, blocked: false, blockers: [] as string[] };
    });
    return result;
  });
}

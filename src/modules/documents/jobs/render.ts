import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { generatedDocuments, labelJobs } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { defineJob } from "@/modules/platform/job-definition";
import { renderInTx } from "../generated";

/**
 * Job `documents.render` (docs/architecture.md §8 job registry; ADR-015, ADR-016 as amended by ADR-026).
 *
 * Renders a `generated_documents` row from its frozen dataset and pinned template version,
 * records sha256 and page count, and moves a linked label job to `ready` (or `failed` with the
 * error). Idempotent: a row that is already ready/superseded/void is left unchanged, so a
 * duplicate or retried job never repeats anything. Idempotency key: `documents.render:<id>`.
 *
 * The web request path renders synchronously through the same `renderInTx`, so the system works
 * without the worker; the worker uses this job for retries and, from Phase 3, for PDF output.
 * Runs on behalf of the user who enqueued it (their current access, actor `system:documents.render`),
 * with no extra permissions: it only reads the frozen dataset built under that user's scope.
 */
export const code = "documents.render" as const;

export const payloadSchema = z.object({ generatedDocumentId: z.uuid() }).strict();
export type RenderJobPayload = z.infer<typeof payloadSchema>;

export async function renderGeneratedDocument(ctx: AuthContext, payload: RenderJobPayload): Promise<{ status: string; generatedDocumentId: string; changed: boolean }> {
  const { generatedDocumentId } = payloadSchema.parse(payload);
  return db.transaction(async (tx) => {
    const [doc] = await tx.select().from(generatedDocuments).where(eq(generatedDocuments.id, generatedDocumentId)).limit(1);
    if (!doc || doc.organizationId !== ctx.organizationId || (doc.siteId && !ctx.allowedSiteIds.includes(doc.siteId))) {
      throw new DomainError("not_found", "Document not found in the sites of the user who requested the render.");
    }
    if (doc.status !== "rendering" && doc.status !== "failed") return { status: doc.status, generatedDocumentId, changed: false };
    const after = await renderInTx(tx, ctx, doc.id);
    const [job] = await tx.select().from(labelJobs).where(eq(labelJobs.generatedDocumentId, doc.id)).limit(1);
    if (job && ["queued", "rendering", "failed"].includes(job.status)) {
      await tx
        .update(labelJobs)
        .set({ status: after.status === "ready" ? "ready" : "failed", errorMessage: after.errorMessage, attempts: job.attempts + 1 })
        .where(eq(labelJobs.id, job.id));
    }
    return { status: after.status, generatedDocumentId, changed: true };
  });
}

export const documentsRenderJob = defineJob<RenderJobPayload>({
  code,
  title: "Render a generated document",
  description: "Renders a document or label from its frozen dataset and pinned template version; marks a linked label job ready or failed.",
  payload: payloadSchema,
  keyTuple: (p) => [p.generatedDocumentId],
  maxAttempts: 3,
  run: (run, payload) => renderGeneratedDocument(run.ctx, payload),
});

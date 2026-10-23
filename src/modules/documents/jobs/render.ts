import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { generatedDocuments, labelJobs, users } from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import { renderInTx } from "../generated";

/**
 * Job `documents.render` (docs/architecture.md §8 job registry; ADR-015, ADR-016).
 *
 * Renders a `generated_documents` row from its frozen dataset and pinned template version,
 * records sha256 and page count, and moves a linked label job to `ready` (or `failed` with the
 * error). Idempotent: a row that is already ready/superseded/void is left unchanged, so a
 * duplicate or retried job never repeats anything. Idempotency key: `documents.render:<id>`.
 *
 * The web request path renders synchronously through the same `renderInTx`, so the system works
 * without the worker; the worker uses this handler for retries and, from Phase 3, for PDF output.
 * Runs as the generating user ("on behalf of"), with no extra permissions: it only reads the
 * frozen dataset that was built under that user's scope at request time.
 */
export const code = "documents.render" as const;

export const payloadSchema = z.object({ generatedDocumentId: z.string().uuid() });
export type RenderJobPayload = z.infer<typeof payloadSchema>;

export const idempotencyKey = (p: RenderJobPayload) => `${code}:${p.generatedDocumentId}`;

export async function handler(payload: unknown): Promise<{ status: string; generatedDocumentId: string; changed: boolean }> {
  const { generatedDocumentId } = payloadSchema.parse(payload);
  return db.transaction(async (tx) => {
    const [doc] = await tx.select().from(generatedDocuments).where(eq(generatedDocuments.id, generatedDocumentId)).limit(1);
    if (!doc) return { status: "missing", generatedDocumentId, changed: false };
    if (doc.status !== "rendering" && doc.status !== "failed") return { status: doc.status, generatedDocumentId, changed: false };
    const [u] = await tx.select({ id: users.id, displayName: users.displayName, email: users.email }).from(users).where(eq(users.id, doc.generatedBy)).limit(1);
    const site = doc.siteId ? [{ id: doc.siteId, code: "", name: "" }] : [];
    const systemCtx = new AuthContext(u.id, doc.organizationId, u.displayName, u.email, [`system:${code}`], new Set(), site, doc.siteId ?? "");
    const after = await renderInTx(tx, systemCtx, doc.id);
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

export const renderJob = { code, handler, payloadSchema, idempotencyKey };
export default renderJob;

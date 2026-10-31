import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { batchRecordHref, nextBatchScreen } from "@/modules/production";
import { Forbidden } from "../../../../forbidden";
import { pickBatch } from "../flow-shared";

export const dynamic = "force-dynamic";

/**
 * "Continue this batch" (one path for production work, 2026-10-31): a server redirect to the batch's
 * next production flow screen (nextBatchScreen: materials, Start check, weigh, step, check, curing,
 * Finish, Check quality). A batch with nothing left to do opens its read-only batch record. Used by the
 * board, the scanner, the batch record's NextStep and old bookmarks.
 */
export default async function ContinuePage({ params, searchParams }: { params: Promise<{ workOrderId: string }>; searchParams: Promise<{ batch?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Forbidden what="production batches" />;
  const { workOrderId } = await params;
  const { batch: batchParam } = await searchParams;
  let target: string;
  try {
    const { batch, backHref } = await pickBatch(ctx, workOrderId, batchParam, (f) => f.status !== "planned");
    if (!batch) redirect(backHref);
    const next = nextBatchScreen(batch);
    target = next.href ?? batchRecordHref(batch.batchId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  redirect(target);
}

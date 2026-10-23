"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { requestBalanceRebuild, requestReconciliation } from "@/modules/inventory";
import { cancelJob, retryJob } from "@/modules/platform";

/** Thin adapters: the services check permissions, site scope and state; we only report the outcome. */
async function run(fn: () => Promise<string>, anchor: string) {
  let target: string;
  try {
    const msg = await fn();
    target = `/admin/diagnostics?ok=${encodeURIComponent(msg)}#${anchor}`;
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    target = `/admin/diagnostics?error=${encodeURIComponent(e.message)}#${anchor}`;
  }
  revalidatePath("/admin/diagnostics");
  redirect(target);
}

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function retryJobAction(fd: FormData) {
  const ctx = await requireContext();
  await run(async () => {
    const j = await retryJob(ctx, s(fd, "jobId"), s(fd, "reason") || null);
    return `Job ${j.jobKind} is queued again.`;
  }, "jobs");
}

export async function cancelJobAction(fd: FormData) {
  const ctx = await requireContext();
  await run(async () => {
    const j = await cancelJob(ctx, s(fd, "jobId"), s(fd, "reason") || null);
    return `Job ${j.jobKind} was cancelled.`;
  }, "jobs");
}

export async function runReconciliationAction() {
  const ctx = await requireContext();
  await run(async () => {
    const { created } = await requestReconciliation(ctx, { siteId: ctx.currentSiteId });
    return created ? `Reconciliation for ${ctx.currentSite.code} is queued; the worker runs it shortly.` : "A reconciliation for this minute is already queued.";
  }, "reconciliation");
}

export async function rebuildBalancesAction(fd: FormData) {
  const ctx = await requireContext();
  await run(async () => {
    const { created } = await requestBalanceRebuild(ctx, { siteId: ctx.currentSiteId, reconciliationRunId: s(fd, "runId") || null, reason: s(fd, "reason") });
    return created ? "Balance rebuild queued. Its result appears in this card when the worker has run it." : "This rebuild was already requested.";
  }, "reconciliation");
}

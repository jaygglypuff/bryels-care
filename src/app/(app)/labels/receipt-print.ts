import "server-only";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { activeStationsAt, approvedLabelTemplatesFor, createLabelJobsForLots } from "@/modules/documents";
import { getReceipt } from "@/modules/inventory";

/**
 * "Print labels" from a receipt goes straight to the print preview (usability test 2026-10-30).
 * When label printing is set up (a label printer at the site, an approved raw-material label size), one label job per
 * lot is made with one label per container (the receipt's container count, else 1) and the preview of
 * all of them opens and the print window opens by itself (ADR-099). Otherwise the receipt's label page explains what is missing.
 * Each lot keeps its own idempotency key (`gr:<receipt>:<template>:<lot>`), so pressing again never makes
 * a second set of labels: the same jobs open again.
 */
export async function receiptLabelsTarget(ctx: AuthContext, receiptId: string, opts: { posted?: boolean } = {}): Promise<string> {
  const choose = `/print/lot-label/receipt/${receiptId}${opts.posted ? "?posted=1" : ""}`;
  if (!ctx.can("inventory.label_job.create")) return `/inventory/receive/${receiptId}${opts.posted ? "?posted=1" : ""}`;
  const gr = await getReceipt(ctx, receiptId);
  if (gr.siteId !== ctx.currentSiteId || gr.lines.length === 0) return choose;
  const [stations, templates] = await Promise.all([activeStationsAt(db, ctx.organizationId, gr.siteId), approvedLabelTemplatesFor(db, ctx.organizationId, gr.siteId, "material")]);
  if (stations.length === 0 || templates.length === 0) return choose;
  const tpl = templates[0];
  const lots = gr.lines.map((l) => ({ lotId: l.lotId, copies: Math.min(Math.max(l.containerCount ?? 1, 1), 99) }));
  const out = await createLabelJobsForLots(ctx, lots, tpl.id, 1, `gr:${gr.id}:${tpl.id}`, null);
  return previewHref(gr.id, out, opts.posted);
}

/** Same, but never throws: after a receipt is saved, a label problem must not look like a failed save. */
export async function receiptLabelsTargetSafe(ctx: AuthContext, receiptId: string, opts: { posted?: boolean } = {}): Promise<string> {
  try {
    return await receiptLabelsTarget(ctx, receiptId, opts);
  } catch {
    return `/print/lot-label/receipt/${receiptId}${opts.posted ? "?posted=1" : ""}`;
  }
}

/** The preview URL for the jobs made from a receipt; lots skipped because they already had labels are named on the page. */
export function previewHref(receiptId: string, out: { lotId: string; jobId?: string; error?: string; code?: string }[], posted?: boolean): string {
  const jobs = out.filter((o) => o.jobId).map((o) => o.jobId!);
  const had = out.filter((o) => !o.jobId && o.code === "conflict").map((o) => o.lotId);
  const failed = out.filter((o) => !o.jobId && o.code !== "conflict").map((o) => o.lotId);
  const q = new URLSearchParams();
  if (jobs.length) q.set("jobs", jobs.join(","));
  if (had.length) q.set("had", had.join(","));
  if (failed.length) q.set("failed", failed.join(","));
  if (posted) q.set("posted", "1");
  if (jobs.length) q.set("auto", "1");
  return `/print/labels/receipt/${receiptId}?${q.toString()}`;
}

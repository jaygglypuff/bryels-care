import { notFound } from "next/navigation";
import { Forbidden } from "@/app/(app)/forbidden";
import { ReceiptJobsForm } from "@/app/(app)/labels/forms";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { activeStationsAt, approvedLabelTemplatesFor, labelHistory } from "@/modules/documents";
import { db } from "@/db/client";
import { getReceipt } from "@/modules/inventory";
import { LinkButton } from "@/ui/core";
import { Banner } from "@/ui/status";

export const metadata = { title: "Receipt labels" };
export const dynamic = "force-dynamic";

/** W01-07: one label job per received lot, sent to the site's print station. */
export default async function ReceiptLabelsPage({ params, searchParams }: { params: Promise<{ grId: string }>; searchParams: Promise<{ posted?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.label_job.create")) return <div className="p-6"><Forbidden what="label printing" /></div>;
  const { grId } = await params;
  const { posted } = await searchParams;
  let gr: Awaited<ReturnType<typeof getReceipt>>;
  try {
    gr = await getReceipt(ctx, grId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const site = ctx.allowedSites.find((s) => s.id === gr.siteId);
  const [stations, templates, printed] = await Promise.all([
    activeStationsAt(db, ctx.organizationId, gr.siteId),
    approvedLabelTemplatesFor(db, ctx.organizationId, gr.siteId, "material"),
    Promise.all(gr.lines.map((l) => labelHistory(ctx, "inventory_lot", l.lotId))),
  ]);
  const alreadyLabelled = printed.filter((h) => h.some((j) => !j.voidedAt && j.status !== "cancelled")).length;
  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[18px] font-semibold">Labels · {gr.receiptNumber}</h1>
          <p className="text-[13px] text-muted">{gr.lines.length} {gr.lines.length === 1 ? "lot" : "lots"}: {gr.lines.map((l) => l.lotNumber).join(", ")}</p>
        </div>
        <div className="flex gap-2">
          <LinkButton href={`/inventory/receive/${gr.id}`} variant="secondary" size="lg">Back</LinkButton>
          <LinkButton href="/labels" variant="secondary" size="lg">Print station</LinkButton>
        </div>
      </div>
      {posted && (
        <Banner tone="ok" title={`Receipt ${gr.receiptNumber} posted`}>
          {gr.lines.length} new {gr.lines.length === 1 ? "lot is" : "lots are"} waiting for the quality check. Print the labels now, stick one on every container and leave them in the hold area.
        </Banner>
      )}
      {gr.siteId !== ctx.currentSiteId ? (
        <Banner tone="info" title={`This receipt is at ${site?.code}`}>Switch site to print its labels.</Banner>
      ) : stations.length === 0 ? (
        <Banner tone="info" title={`Label printing isn't set up for ${site?.code} yet`}>Ask an administrator to add a print station for this site.</Banner>
      ) : templates.length === 0 ? (
        <Banner tone="info" title="No approved raw material label template">QA must approve a label template before labels can print.</Banner>
      ) : (
        <section className="rounded-[24px] bg-surface p-5 shadow-[var(--shadow-card)]">
          {alreadyLabelled > 0 && <p className="mb-3 text-[13px] text-[var(--warn-fg)]">{alreadyLabelled} of these lots already have labels; those are skipped. Use Reprint on the label job for a lost or damaged label.</p>}
          <ReceiptJobsForm
            grId={gr.id}
            lots={gr.lines.map((l) => ({ lotId: l.lotId, lotNumber: l.lotNumber, materialName: l.materialName, containerCount: l.containerCount ?? null }))}
            templates={templates.map((t) => ({ id: t.id, code: t.code, name: t.name, media: `${Number(t.mediaWidthMm)} × ${Number(t.mediaHeightMm)} mm`, copiesDefault: t.copiesDefault }))}
            stations={stations.map((s) => ({ id: s.id, code: s.code, name: s.name, printerName: s.printerName }))}
          />
        </section>
      )}
    </main>
  );
}

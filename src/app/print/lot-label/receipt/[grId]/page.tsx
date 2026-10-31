import { notFound } from "next/navigation";
import { Forbidden } from "@/app/(app)/forbidden";
import { ReceiptJobsForm } from "@/app/(app)/labels/forms";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { activeStationsAt, approvedLabelTemplatesFor, labelHistory } from "@/modules/documents";
import { db } from "@/db/client";
import { getReceipt } from "@/modules/inventory";
import { ArrowLeft } from "lucide-react";
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
  const labelledNames = [...new Set(gr.lines.filter((_, i) => printed[i].some((j) => !j.voidedAt && j.status !== "cancelled")).map((l) => l.materialName))];
  const labelledText = labelledNames.length <= 1 ? (labelledNames[0] ?? "") : `${labelledNames.slice(0, -1).join(", ")} and ${labelledNames.at(-1)}`;
  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-4">
      <a href={`/inventory/receive/${gr.id}`} className="inline-flex min-h-[44px] items-center gap-2 text-[15px] font-semibold text-primary-text hover:underline">
        <ArrowLeft size={18} aria-hidden /> Back to receipt {gr.receiptNumber}
      </a>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[18px] font-semibold">Labels · {gr.receiptNumber}</h1>
          <p className="text-[13px] text-muted">{gr.lines.length} {gr.lines.length === 1 ? "lot" : "lots"}: {gr.lines.map((l) => l.lotNumber).join(", ")}</p>
        </div>
        <LinkButton href="/labels" variant="secondary" size="lg">Print station</LinkButton>
      </div>
      {posted && (
        <Banner tone="ok" title={`Receipt ${gr.receiptNumber} saved`}>
          {gr.lines.length} new {gr.lines.length === 1 ? "lot waits" : "lots wait"} for the quality check. Print the labels now, stick one on every sack and leave them in the hold area.
        </Banner>
      )}
      {gr.siteId !== ctx.currentSiteId ? (
        <Banner tone="info" title={`This receipt is at ${site?.code}`}>Switch site to print its labels.</Banner>
      ) : stations.length === 0 ? (
        <Banner tone="info" title={`Label printing isn't set up for ${site?.code} yet`}>Ask an administrator to add a print station for this site.</Banner>
      ) : templates.length === 0 ? (
        <Banner tone="info" title="No label size is ready yet">QA must approve a raw material label before labels can print.</Banner>
      ) : (
        <section className="rounded-[24px] bg-surface p-5 shadow-[var(--shadow-card)]">
          {labelledText && <p className="mb-3 text-[14px] text-[var(--warn-fg)]">{labelledText} already {labelledNames.length === 1 ? "has" : "have"} labels — not printed again. For a lost or damaged label, use Reprint on the print station.</p>}
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

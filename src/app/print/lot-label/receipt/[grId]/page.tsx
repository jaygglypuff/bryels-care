import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Forbidden } from "@/app/(app)/forbidden";
import { ReceiptJobsForm } from "@/app/(app)/labels/forms";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { activeStationsAt, approvedLabelTemplatesFor, labelHistory, labelPreviewOrNull } from "@/modules/documents";
import { db } from "@/db/client";
import { getReceipt } from "@/modules/inventory";
import { LabelPreview } from "@/ui/labels";
import { Banner } from "@/ui/status";

export const metadata = { title: "Labels for this delivery" };
export const dynamic = "force-dynamic";

/**
 * Labels of a delivery when "Print labels" could not go straight to printing (W01-07, ADR-099): it says
 * what is missing (label printer, approved label), or lets the user change how many labels per item and the
 * label size. Shows the label first so the user knows which label this is.
 */
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
  const [stations, templates, printed, preview] = await Promise.all([
    activeStationsAt(db, ctx.organizationId, gr.siteId),
    approvedLabelTemplatesFor(db, ctx.organizationId, gr.siteId, "material"),
    Promise.all(gr.lines.map((l) => labelHistory(ctx, "inventory_lot", l.lotId))),
    gr.lines[0] ? labelPreviewOrNull(ctx, { entityType: "inventory_lot", entityId: gr.lines[0].lotId }) : Promise.resolve(null),
  ]);
  const labelledNames = [...new Set(gr.lines.filter((_, i) => printed[i].some((j) => !j.voidedAt && j.status !== "cancelled")).map((l) => l.materialName))];
  const labelledText = labelledNames.length <= 1 ? (labelledNames[0] ?? "") : `${labelledNames.slice(0, -1).join(", ")} and ${labelledNames.at(-1)}`;
  return (
    <main className="mx-auto grid max-w-xl gap-4 px-4 py-4">
      <a href={`/inventory/receive/${gr.id}`} className="inline-flex min-h-[44px] items-center gap-2 text-[16px] font-semibold text-primary-text hover:underline">
        <ArrowLeft size={18} aria-hidden /> Back to the delivery
      </a>
      <h1 className="text-[22px] font-semibold">Labels for this delivery</h1>
      {posted && (
        <Banner tone="ok" title="Delivery saved">
          {gr.lines.length} new {gr.lines.length === 1 ? "lot waits" : "lots wait"} for the quality check. Print the labels, stick one on every sack and leave them in the hold area.
        </Banner>
      )}
      {gr.siteId !== ctx.currentSiteId ? (
        <Banner tone="info" title={`This delivery is at ${site?.name ?? site?.code}`}>Switch site in the top bar to print its labels.</Banner>
      ) : stations.length === 0 ? (
        <Banner tone="info" title={`Label printing is not set up for ${site?.name ?? site?.code} yet`}>Ask the administrator to add a label printer (Settings › Labels and printouts).</Banner>
      ) : templates.length === 0 ? (
        <Banner tone="info" title="No label is approved yet">QA must approve a raw material label first (Settings › Labels and printouts).</Banner>
      ) : (
        <>
          {preview?.options[0] && <LabelPreview kind="sack" data={preview.options[0].face} sentence={`This is the label. ${preview.options.length > 1 ? "Other sizes are below. " : ""}Stick one on each sack or drum.`} />}
          <section className="rounded-[20px] border border-line bg-surface p-5">
            {labelledText && <p className="mb-3 text-[15px] text-[var(--warn-fg)]">{labelledText} already {labelledNames.length === 1 ? "has" : "have"} labels, so they are not printed again. Lost one? Open the lot and print it again with a reason.</p>}
            <ReceiptJobsForm
              grId={gr.id}
              lots={gr.lines.map((l) => ({ lotId: l.lotId, lotNumber: l.lotNumber, materialName: l.materialName, containerCount: l.containerCount ?? null }))}
              templates={templates.map((t) => ({ id: t.id, code: t.code, name: t.name, media: `${Number(t.mediaWidthMm)} × ${Number(t.mediaHeightMm)} mm`, copiesDefault: t.copiesDefault }))}
            />
          </section>
        </>
      )}
    </main>
  );
}

import { notFound } from "next/navigation";
import { Forbidden } from "@/app/(app)/forbidden";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { renderForDisplay } from "@/modules/documents";
import { currentDeliveryReceiptDocument } from "@/modules/sales";
import { LinkButton } from "@/ui/core";
import { Banner } from "@/ui/status";
import { PrintButton } from "./print-button";

export const metadata = { title: "Delivery receipt" };
export const dynamic = "force-dynamic";

/**
 * Delivery receipt of a shipment (US-4-12, T-13): the current recorded DR document (draft before
 * dispatch, issued after, ACKNOWLEDGED after receipt), re-rendered from its frozen dataset and
 * printed only when the hash matches. One page per copy; never prices. Reprints go through the
 * document record (reason required).
 */
export default async function DeliveryReceiptPage({ params }: { params: Promise<{ shipmentId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.delivery_receipt.view") || !ctx.can("documents.generated_document.view")) return <div className="p-6"><Forbidden what="delivery receipts" /></div>;
  const { shipmentId } = await params;
  let data: Awaited<ReturnType<typeof currentDeliveryReceiptDocument>>;
  try {
    data = await currentDeliveryReceiptDocument(ctx, shipmentId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const { shipment, dr, document } = data;
  const render = document ? await renderForDisplay(document) : null;
  const ok = render?.integrity === "ok";
  return (
    <main>
      <div className="no-print mx-auto max-w-3xl space-y-3 px-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold">Delivery receipt {dr?.drNumber ?? (dr?.status === "draft" ? "(draft)" : shipment.deliveryReceiptNumber ?? "")}</h1>
            <p className="text-[13px] text-muted">{document ? `${document.documentNumber} · ${document.watermark ?? "issued"} · print at 100 % on A4, one page per copy.` : "No recorded delivery receipt document yet."}</p>
          </div>
          <div className="flex gap-2">
            <LinkButton href={`/sales/shipments/${shipment.id}`} variant="secondary" size="lg">Back</LinkButton>
            {document && <LinkButton href={`/documents/${document.id}`} variant="secondary" size="lg">Reprint…</LinkButton>}
            {ok && <PrintButton />}
          </div>
        </div>
        {!document && (
          <Banner tone="warn" title="Nothing to print yet">
            {shipment.status === "packed" ? "Generate the draft delivery receipt from the shipment page." : "Generate the delivery receipt from the shipment page (a template must be approved first)."}
          </Banner>
        )}
        {render && !ok && <Banner tone="bad" title="This document can't be reproduced exactly">Do not print; ask an administrator. {render.error ?? ""}</Banner>}
      </div>
      {ok && render?.css && render.body && (
        <>
          <style>{render.css}</style>
          <div dangerouslySetInnerHTML={{ __html: render.body }} />
        </>
      )}
    </main>
  );
}

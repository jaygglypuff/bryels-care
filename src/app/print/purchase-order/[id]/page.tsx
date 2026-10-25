import { notFound } from "next/navigation";
import { Forbidden } from "@/app/(app)/forbidden";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { renderForDisplay } from "@/modules/documents";
import { currentPurchaseOrderDocument } from "@/modules/procurement";
import { LinkButton } from "@/ui/core";
import { Banner } from "@/ui/status";
import { PrintButton } from "../../delivery-receipt/[shipmentId]/print-button";

export const metadata = { title: "Purchase order" };
export const dynamic = "force-dynamic";

/**
 * Printable purchase order (US-6-02, W04-06; browser print per ADR-026): the current recorded PO
 * document, re-rendered from its frozen dataset and printable only when the hash matches. The supplier
 * copy prints prices and role titles, never personal names. Reprints go through the document record.
 */
export default async function PurchaseOrderPrint({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_order.view") || !ctx.can("masterdata.supplier_price.view") || !ctx.can("documents.generated_document.view")) return <div className="p-6"><Forbidden what="printing purchase orders" /></div>;
  const { id } = await params;
  let data: Awaited<ReturnType<typeof currentPurchaseOrderDocument>>;
  try {
    data = await currentPurchaseOrderDocument(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const { po, document } = data;
  const render = document ? await renderForDisplay(document) : null;
  const ok = render?.integrity === "ok";
  return (
    <main>
      <div className="no-print mx-auto max-w-3xl space-y-3 px-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold">Purchase order {po.poNumber}</h1>
            <p className="text-[13px] text-muted">{document ? `${document.documentNumber} · print at 100 % on A4.` : "No recorded purchase order document yet."}</p>
          </div>
          <div className="flex gap-2">
            <LinkButton href={`/procurement/orders/${po.id}`} variant="secondary" size="lg">Back</LinkButton>
            {document && <LinkButton href={`/documents/${document.id}`} variant="secondary" size="lg">Reprint…</LinkButton>}
            {ok && <PrintButton />}
          </div>
        </div>
        {!document && <Banner tone="warn" title="Nothing to print yet">The PO document is recorded when the order is sent (or with "Record the PO document" on the order page).</Banner>}
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

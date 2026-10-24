import { notFound } from "next/navigation";
import { Forbidden } from "@/app/(app)/forbidden";
import { generatePickListAction } from "@/app/(app)/sales/fulfilment-actions";
import { Cmd } from "@/app/(app)/sales/fulfilment-forms";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { renderForDisplay } from "@/modules/documents";
import { getPick, latestPickListDocument } from "@/modules/sales";
import { LinkButton } from "@/ui/core";
import { Banner } from "@/ui/status";
import { PrintButton } from "../../lot-label/print-button";

export const metadata = { title: "Pick list" };
export const dynamic = "force-dynamic";

/**
 * Pick list print (US-4-10, docs/reports-and-templates.md §6): the latest recorded pick list of the
 * pick, re-rendered from its frozen dataset and printed only when the hash matches. No prices, no box
 * barcodes (the picker scans the physical label); the BC:DOC code opens the record.
 */
export default async function PickListPrintPage({ params }: { params: Promise<{ pickId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.pick.view") || !ctx.can("documents.generated_document.view")) return <div className="p-6"><Forbidden what="pick lists" /></div>;
  const { pickId } = await params;
  let v: Awaited<ReturnType<typeof getPick>>;
  try {
    v = await getPick(ctx, pickId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const doc = await latestPickListDocument(ctx, v.pick.id);
  const render = doc ? await renderForDisplay(doc) : null;
  const ok = render?.integrity === "ok";
  return (
    <main>
      <div className="no-print mx-auto max-w-3xl space-y-3 px-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold">Pick list {v.pick.pickNumber}</h1>
            <p className="text-[13px] text-muted">{doc ? `${doc.documentNumber} · recorded ${doc.generatedAt.toLocaleString("en-PH", { timeZone: "Asia/Manila" })}` : "Not recorded yet"} · {v.order.orderNumber}</p>
          </div>
          <div className="flex gap-2">
            <LinkButton href={`/sales/picking/${v.pick.id}`} variant="secondary" size="lg">Back</LinkButton>
            {ok && <PrintButton />}
          </div>
        </div>
        {ctx.can("documents.generated_document.create") && (
          <Cmd action={generatePickListAction} fields={{ pickId: v.pick.id }} label={doc ? "Record the current list again" : "Record the pick list"} variant="secondary" />
        )}
        {!doc && <Banner tone="info" title="Record the list to print it">The printed list is always a recorded document (number, template version, checksum).</Banner>}
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

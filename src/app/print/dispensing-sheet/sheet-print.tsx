import { notFound } from "next/navigation";
import { Forbidden } from "@/app/(app)/forbidden";
import { generateSheetAction } from "@/app/(app)/production/work-orders/actions";
import { CommandForm } from "@/app/(app)/production/work-orders/command-form";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getGeneratedDocument, renderForDisplay, type GeneratedDocumentDetail } from "@/modules/documents";
import { batchSheets, canSeeStaging, type BatchSheetKind } from "@/modules/production";
import { LinkButton } from "@/ui/core";
import { Banner } from "@/ui/status";
import { PrintButton } from "../lot-label/print-button";

/**
 * Print page of a batch's dispensing sheet or traveler (US-3-08): shows the chosen (or latest)
 * recorded document, hash-checked against its frozen dataset, or offers to generate one. Browser
 * print (ADR-026); reprints go through the document page with a reason.
 */
export async function SheetPrint({ batchId, kind, docId }: { batchId: string; kind: BatchSheetKind; docId?: string }) {
  const ctx = await requireContext();
  if (!canSeeStaging(ctx) || !ctx.can("documents.generated_document.view")) return <div className="p-6"><Forbidden what="production documents" /></div>;
  const word = kind === "traveler" ? "traveler" : "dispensing sheet";
  let sheets: Awaited<ReturnType<typeof batchSheets>>;
  try {
    sheets = (await batchSheets(ctx, batchId)).filter((s) => s.kind === kind);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const chosen = sheets.find((s) => s.id === docId) ?? sheets.find((s) => s.status === "ready") ?? null;
  let d: GeneratedDocumentDetail | null = null;
  if (chosen) d = await getGeneratedDocument(ctx, chosen.id);
  const render = d && d.status !== "rendering" && d.status !== "failed" ? await renderForDisplay(d) : null;
  const ok = render?.integrity === "ok";
  return (
    <main>
      <div className="no-print mx-auto max-w-3xl space-y-3 px-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold capitalize">{d ? `${word} ${d.documentNumber}` : word}</h1>
            <p className="text-[13px] text-muted">{d ? `${d.template.code} v${d.template.versionNo} · ${d.watermark ?? "no watermark"} · print at 100 % on A4.` : "No sheet has been generated for this batch yet."}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/production/staging/${batchId}`} variant="secondary" size="lg">Back</LinkButton>
            {d && <LinkButton href={`/documents/${d.id}`} variant="secondary" size="lg">Reprint / history</LinkButton>}
            {ok && d?.status === "ready" && <PrintButton />}
          </div>
        </div>
        {ctx.can("documents.generated_document.create") && (
          <CommandForm action={generateSheetAction} fields={{ batchId, kind }} label={d ? `Generate a new ${word}` : `Generate ${word}`} variant={d ? "secondary" : "cta"} size="sm" pendingText="Generating…" />
        )}
        {d && d.status !== "ready" && <Banner tone="warn" title={`This document is ${d.status}`}>{d.status === "void" ? d.voidReason : "Print the current document instead."}</Banner>}
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

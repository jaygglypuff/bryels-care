import { notFound } from "next/navigation";
import { Forbidden } from "@/app/(app)/forbidden";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getGeneratedDocument, renderForDisplay, type GeneratedDocumentDetail } from "@/modules/documents";
import { LinkButton } from "@/ui/core";
import { Banner } from "@/ui/status";
import { PrintButton } from "../../lot-label/print-button";

export const metadata = { title: "Print document" };
export const dynamic = "force-dynamic";

/** Prints a generated document from its stored dataset (hash-checked). Browser print = "Save as PDF" too. */
export default async function PrintDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("documents.generated_document.view")) return <div className="p-6"><Forbidden what="documents" /></div>;
  const { id } = await params;
  let d: GeneratedDocumentDetail;
  try {
    d = await getGeneratedDocument(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const render = d.status === "rendering" || d.status === "failed" ? null : await renderForDisplay(d);
  const ok = render?.integrity === "ok";
  return (
    <main>
      <div className="no-print mx-auto max-w-3xl space-y-3 px-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold">{d.documentNumber}</h1>
            <p className="text-[13px] text-muted">{d.template.code} v{d.template.versionNo} · {d.watermark ?? "no watermark"} · print at 100 % on A4.</p>
          </div>
          <div className="flex gap-2">
            <LinkButton href={`/documents/${d.id}`} variant="secondary" size="lg">Back</LinkButton>
            {ok && d.status === "ready" && <PrintButton />}
          </div>
        </div>
        {d.status !== "ready" && <Banner tone="warn" title={`This document is ${d.status}`}>{d.status === "void" ? d.voidReason : "Print the current document instead."}</Banner>}
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

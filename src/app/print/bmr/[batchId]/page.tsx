import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { renderForDisplay } from "@/modules/documents";
import { type BmrPrintView, bmrPrintView } from "@/modules/production";
import { GenerateBmrForm } from "./generate-form";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Batch Manufacturing Record" };
export const dynamic = "force-dynamic";

/**
 * BMR print page (US-3-18; docs/reports-and-templates.md §1.4, §2.6, ADR-016 as amended by ADR-026).
 *
 * Shows the batch's recorded BMR (numbered, hashed, rendered by the template engine from its
 * frozen dataset) ready for the browser's print dialog, or, when the batch has changed since the
 * last generation, a live preview that cannot be printed until it is generated. Void and
 * superseded documents stay viewable with an overlay word; reprints go through the document
 * record (reason mandatory).
 */

type Props = { params: Promise<{ batchId: string }>; searchParams: Promise<{ doc?: string }> };

function Message({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto max-w-lg p-10 text-center">
      <h1 className="text-[18px] font-semibold">{title}</h1>
      <p className="mt-2 text-[13px] text-[#5b5951]">{body}</p>
      <Link href="/production" className="mt-4 inline-block text-[13px] text-[#23703f] underline">
        Back to batches
      </Link>
    </main>
  );
}

type Doc = BmrPrintView["documents"][number];

const OVERLAY: Record<string, string> = { void: "VOID", superseded: "SUPERSEDED" };

export default async function BmrPrintPage({ params, searchParams }: Props) {
  const { batchId } = await params;
  const { doc: docId } = await searchParams;
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Message title="You don't have access" body="Your role does not include viewing batch records." />;
  let view: BmrPrintView;
  try {
    view = await bmrPrintView(ctx, batchId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return <Message title="Batch not found" body="It does not exist or belongs to a site you are not assigned to." />;
    if (e instanceof DomainError) return <Message title="The BMR can't be shown" body={e.message} />;
    throw e;
  }

  const bmrDocs = view.documents.filter((d) => d.documentKind === "bmr");
  const paperDocs = view.documents.filter((d) => d.documentKind === "bmr_paper_page");
  const requested: Doc | null = docId ? (view.documents.find((d) => d.id === docId) ?? null) : null;
  const shown: Doc | null = requested ?? (!view.stale && view.current ? (view.documents.find((d) => d.id === view.current!.id) ?? null) : null);
  const render = shown && shown.status !== "rendering" && shown.status !== "failed" ? await renderForDisplay(shown) : null;
  const ok = render?.integrity === "ok";
  const overlay = shown ? OVERLAY[shown.status] : undefined;
  const root = shown ? (shown.reprintOfId ? view.documents.find((d) => d.id === shown.reprintOfId) : shown) : null;
  const generateLabel = view.current ? "Generate new BMR revision" : "Generate BMR";

  return (
    <div className="bmr-print-root min-h-screen bg-[#e9e7e1] pb-10 pt-4 text-[#111]">
      <style>{`
        @media print {
          .bmr-print-root { background: #fff !important; padding: 0 !important; min-height: 0 !important; }
          .bmr-preview { display: none !important; }
          .bmr-preview-print-msg { display: block !important; }
        }
        .bmr-preview-print-msg { display: none; font: 600 14pt Inter, Arial, sans-serif; padding: 20mm; }
        .bmr-overlay { position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font: 900 72pt/1 Inter, Arial, sans-serif; color: rgba(198, 40, 40, .22); pointer-events: none; z-index: 5; white-space: nowrap; }
        @media print { .bmr-overlay { position: fixed; top: 45%; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      `}</style>

      <div className="no-print mx-auto mb-3 flex max-w-[210mm] flex-col gap-3 px-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href={`/production/${view.batch.id}`} className="text-[#23703f] underline">
              ← Batch {view.batch.number}
            </Link>
            <Link href={`/production/${view.batch.id}/closure`} className="text-[#23703f] underline">
              Closure and paper pages
            </Link>
          </div>
          <span>
            Batch state: <b>{view.batch.statusLabel}</b> · BMR watermark now: <b>{view.watermark}</b>
          </span>
        </div>

        {!view.template && (
          <div role="alert" className="rounded-[12px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-3 py-2 text-[13px] text-[var(--warn-fg)]">
            <b>BMR printing isn&apos;t set up.</b> No approved BMR template ({view.templateCode}) exists. Ask QA to approve one under Admin → Document templates.
          </div>
        )}

        {shown ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-line bg-white px-3 py-2 text-[13px]">
            <span className="min-w-0">
              <b>{shown.documentNumber}</b> · Rev {shown.recordRevisionNo}
              {shown.reprintNo ? ` · Reprint ${shown.reprintNo}` : ""} · {shown.watermark ?? "no watermark"} · {shown.status} · generated {fmtDateTime(shown.generatedAt)} by {shown.generatedByName}
            </span>
            <span className="flex flex-wrap gap-2">
              {ok && shown.status === "ready" && <PrintButton />}
              {ctx.can("documents.generated_document.view") && root && (
                <Link href={`/documents/${root.id}`} className="inline-flex min-h-[44px] items-center rounded-[10px] border border-line px-3 text-[14px]">
                  Record, reprint with reason
                </Link>
              )}
            </span>
          </div>
        ) : null}

        {view.stale && !requested && (
          <div className="rounded-[12px] border border-line bg-white px-3 py-3 text-[13px]">
            <p className="mb-2">
              {view.current ? (
                <>
                  The batch changed after <b>{view.current.documentNumber}</b> was generated. Below is a <b>preview</b> of the current record; generate a new revision to print it.{" "}
                  <Link href={`/print/bmr/${view.batch.id}?doc=${view.current.id}`} className="text-[#23703f] underline">
                    Show {view.current.documentNumber}
                  </Link>
                </>
              ) : (
                <>
                  No BMR has been generated for this batch yet. Below is a <b>preview</b>; generate the BMR to get a numbered, hashed copy you can print.
                </>
              )}
            </p>
            {view.canGenerate && view.template ? <GenerateBmrForm batchId={view.batch.id} label={generateLabel} /> : !view.canGenerate ? <p className="text-muted">Your role cannot generate documents; ask a site manager or QA.</p> : null}
          </div>
        )}

        {render && !ok && (
          <div role="alert" className="rounded-[12px] border border-[var(--bad-bd)] bg-[var(--bad-bg)] px-3 py-2 text-[13px] text-[var(--bad-fg)]">
            <b>This document can&apos;t be reproduced exactly.</b> Do not print it; ask an administrator. {render.error ?? ""}
          </div>
        )}
        {shown && shown.status !== "ready" && (
          <div role="status" className="rounded-[12px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-3 py-2 text-[13px] text-[var(--warn-fg)]">
            This document is <b>{shown.status}</b>
            {shown.status === "void" && shown.voidReason ? `: ${shown.voidReason}` : ""}. It stays on record but must not be used.
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        {ok && render?.css && render.body ? (
          <div style={{ position: "relative" }}>
            {overlay && (
              <div className="bmr-overlay" aria-hidden>
                {overlay}
              </div>
            )}
            <style>{render.css}</style>
            <div dangerouslySetInnerHTML={{ __html: render.body }} />
          </div>
        ) : !requested && view.preview ? (
          <>
            <div className="bmr-preview">
              <style>{view.preview.css}</style>
              <div dangerouslySetInnerHTML={{ __html: view.preview.body }} />
            </div>
            <p className="bmr-preview-print-msg">This is an unrecorded preview. Generate the BMR on the screen before printing.</p>
          </>
        ) : !shown && !view.preview ? (
          <p className="no-print mx-auto max-w-[210mm] px-3 text-[13px]">Nothing to show yet.</p>
        ) : null}
      </div>

      {(bmrDocs.length > 0 || paperDocs.length > 0) && (
        <section className="no-print mx-auto mt-4 max-w-[210mm] rounded-[16px] border border-line bg-white px-4 py-3 text-[13px]">
          <h2 className="mb-2 text-[14px] font-semibold">Documents of this batch</h2>
          <ul className="divide-y divide-line">
            {[...bmrDocs, ...paperDocs].map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={d.documentKind === "bmr" ? `/print/bmr/${view.batch.id}?doc=${d.id}` : `/print/documents/${d.id}`} className="text-[#23703f] underline">
                  {d.documentNumber} · {d.documentKind === "bmr" ? "BMR" : "Paper page"} rev {d.recordRevisionNo}
                  {d.reprintNo ? ` · reprint ${d.reprintNo}` : ""}
                </Link>
                <span className="text-muted">
                  {d.watermark ?? "—"} · {d.status} · {d.generatedByName}, {fmtDateTime(d.generatedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

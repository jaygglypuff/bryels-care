import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Forbidden } from "@/app/(app)/forbidden";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { labelJobForPrint } from "@/modules/documents";
import { getReceipt } from "@/modules/inventory";
import { LinkButton } from "@/ui/core";
import { Banner } from "@/ui/status";
import { PrintButton } from "../../../lot-label/print-button";
import { ReceiptPrintedForm } from "./printed-form";

export const metadata = { title: "Print labels" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
const ids = (v: string | undefined) => (v ?? "").split(",").filter((x) => UUID.test(x)).slice(0, 50);

function names(list: string[]): string {
  const u = [...new Set(list)];
  return u.length <= 1 ? (u[0] ?? "") : `${u.slice(0, -1).join(", ")} and ${u.at(-1)}`;
}

/**
 * Print preview of all the labels made from one receipt (usability test 2026-10-30): one sentence
 * says what was sent and what was skipped ("Labels sent to the printer: 4. Coconut Oil already had
 * labels — not printed again."), one Print button prints them all, and a clear Back link returns to
 * the receipt. Only jobs of this receipt's lots are shown; each is re-rendered from its stored dataset
 * and hash-checked like the single-job print route.
 */
export default async function ReceiptLabelsPreview({ params, searchParams }: { params: Promise<{ grId: string }>; searchParams: Promise<{ jobs?: string; had?: string; failed?: string; posted?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.label_job.view")) return <div className="p-6"><Forbidden what="label printing" /></div>;
  const { grId } = await params;
  const sp = await searchParams;
  let gr: Awaited<ReturnType<typeof getReceipt>>;
  try {
    gr = await getReceipt(ctx, grId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const byLot = new Map(gr.lines.map((l) => [l.lotId, l]));
  const loaded = await Promise.all(
    ids(sp.jobs).map((id) =>
      labelJobForPrint(ctx, id).catch((e) => {
        if (e instanceof DomainError && e.code === "not_found") return null;
        throw e;
      }),
    ),
  );
  const jobs = loaded.filter((r): r is NonNullable<typeof r> => !!r && byLot.has(r.job.entityId));
  const printable = jobs.filter((r) => r.render && r.render.integrity === "ok" && !r.job.voidedAt && ["ready", "printed"].includes(r.job.status) && r.render.css && r.render.body);
  const toPrint = printable.filter((r) => r.job.status === "ready");
  const labelCount = printable.reduce((a, r) => a + r.job.copies, 0);
  const had = names(ids(sp.had).map((l) => byLot.get(l)?.materialName ?? "").filter(Boolean));
  const failed = names(ids(sp.failed).map((l) => byLot.get(l)?.materialName ?? "").filter(Boolean));
  const notOk = jobs.filter((r) => !printable.includes(r));
  const css = [...new Set(printable.map((r) => r.render!.css!))].join("\n");
  const sentence = [labelCount > 0 ? `Labels sent to the printer: ${labelCount}.` : "No new labels were made.", had ? `${had} already had labels — not printed again.` : ""].filter(Boolean).join(" ");

  return (
    <main>
      <div className="no-print mx-auto max-w-xl space-y-3 px-4 pt-4">
        <a href={`/inventory/receive/${gr.id}`} className="inline-flex min-h-[44px] items-center gap-2 text-[15px] font-semibold text-primary-text hover:underline">
          <ArrowLeft size={18} aria-hidden /> Back to receipt {gr.receiptNumber}
        </a>
        <h1 className="text-[20px] font-semibold">Labels · {gr.receiptNumber}</h1>
        {sp.posted && <Banner tone="ok" title={`Receipt ${gr.receiptNumber} saved`}>{gr.lines.length} new {gr.lines.length === 1 ? "lot waits" : "lots wait"} for the quality check. Stick one label on every sack and leave them in the hold area.</Banner>}
        <p className="rounded-[14px] border border-line bg-surface px-4 py-3 text-[16px] font-medium" role="status" data-testid="labels-summary">
          {sentence}
        </p>
        {failed && (
          <Banner tone="warn" title={`No labels for ${failed}`}>
            Something went wrong for {failed}. <a className="font-medium underline" href={`/print/lot-label/receipt/${gr.id}`}>Try again</a>.
          </Banner>
        )}
        {notOk.length > 0 && <Banner tone="warn" title="Some labels cannot be printed">{notOk.map((r) => r.job.entityNumber).join(", ")}: open the print station to see why.</Banner>}
        {printable.length > 0 && (
          <>
            <p className="text-[13px] text-muted">In the print dialog choose the label printer and &quot;Actual size&quot; (100 %). One label per page.</p>
            <div className="flex flex-wrap gap-2">
              <PrintButton label={`Print ${labelCount} ${labelCount === 1 ? "label" : "labels"}`} />
              <LinkButton href="/labels" variant="secondary" size="lg">Print station</LinkButton>
            </div>
            {toPrint.length > 0 && ctx.can("inventory.label_job.create") && <ReceiptPrintedForm jobIds={toPrint.map((r) => r.job.id)} receiptId={gr.id} />}
            {toPrint.length === 0 && <Banner tone="ok" title="Already recorded as printed">Printing again from here is not recorded. For a lost or damaged label use Reprint on the print station, with a reason.</Banner>}
          </>
        )}
      </div>
      {printable.length > 0 && (
        <>
          <style>{css}</style>
          {printable.map((r) => (
            <div key={r.job.id} className={r.job.status === "printed" ? "no-print" : undefined} dangerouslySetInnerHTML={{ __html: r.render!.body! }} />
          ))}
        </>
      )}
    </main>
  );
}

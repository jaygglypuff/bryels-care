import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Forbidden } from "@/app/(app)/forbidden";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { labelJobForPrint } from "@/modules/documents";
import { getReceipt } from "@/modules/inventory";
import { LinkButton } from "@/ui/core";
import { LabelFace, LabelSheet, LABEL_KIND_WORDS, labelCountWords } from "@/ui/labels";
import { Banner } from "@/ui/status";
import { AutoPrint, PrintedCheck, PrintNow } from "../../print-bits";

export const metadata = { title: "Print labels" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
const ids = (v: string | undefined) => (v ?? "").split(",").filter((x) => UUID.test(x)).slice(0, 50);

function names(list: string[]): string {
  const u = [...new Set(list)];
  return u.length <= 1 ? (u[0] ?? "") : `${u.slice(0, -1).join(", ")} and ${u.at(-1)}`;
}

/**
 * Labels of one delivery (ADR-090, ADR-099): one block per item ("Coconut Oil — 4 labels") showing THE label,
 * one green "Print N labels" for all of them, then "Did they come out right?". On paper only the labels print,
 * one per page, each at its own size. Lots that already had labels are named, not printed again.
 */
export default async function ReceiptLabelsPreview({ params, searchParams }: { params: Promise<{ grId: string }>; searchParams: Promise<{ jobs?: string; had?: string; failed?: string; posted?: string; auto?: string }> }) {
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
  const shown = jobs.filter((r) => r.face && !r.job.voidedAt && ["ready", "printed"].includes(r.job.status));
  const toPrint = ctx.can("inventory.label_job.create") ? shown.filter((r) => r.job.status === "ready") : [];
  const printedAlready = shown.filter((r) => r.job.status === "printed");
  const labelCount = toPrint.reduce((a, r) => a + r.job.copies, 0);
  const had = names(ids(sp.had).map((l) => byLot.get(l)?.materialName ?? "").filter(Boolean));
  const failed = names(ids(sp.failed).map((l) => byLot.get(l)?.materialName ?? "").filter(Boolean));
  const notOk = jobs.filter((r) => !shown.includes(r));
  const back = `/inventory/receive/${gr.id}`;
  const stick = LABEL_KIND_WORDS.sack.stick;
  const caption = (r: (typeof shown)[number]) => (
    <p>
      <strong className="text-fg">{byLot.get(r.job.entityId)?.materialName ?? r.job.entityName}</strong> · {labelCountWords(r.job.copies)}, all like this · {r.face!.widthMm} × {r.face!.heightMm} mm
    </p>
  );

  return (
    <main className="min-h-dvh pb-10">
      <div className="no-print mx-auto grid max-w-2xl gap-4 px-4 pt-4">
        <a href={back} className="inline-flex min-h-[44px] items-center gap-2 text-[16px] font-semibold text-primary-text hover:underline">
          <ArrowLeft size={18} aria-hidden /> Back to the delivery
        </a>
        <div>
          <h1 className="text-[22px] font-semibold leading-tight">{labelCount > 0 ? `Print ${labelCountWords(labelCount)}` : "Labels"} for this delivery</h1>
          <p className="mt-1 text-[16px] text-fg-2">{stick} The label says what is inside, so anyone can scan it.</p>
        </div>
        {sp.posted && <Banner tone="ok" title="Delivery saved">{gr.lines.length} new {gr.lines.length === 1 ? "lot waits" : "lots wait"} for the quality check. Print the labels, stick them on, and leave the sacks in the hold area.</Banner>}
        {had && <p className="rounded-[14px] border border-line bg-surface px-4 py-3 text-[15px]" data-testid="labels-summary">{had} already {had.includes(" and ") ? "have" : "has"} labels, so they are not printed again. Lost one? Open the lot and print it again with a reason.</p>}
        {failed && (
          <Banner tone="warn" title={`No labels for ${failed}`}>
            Something went wrong for {failed}. <a className="font-medium underline" href={`/print/lot-label/receipt/${gr.id}`}>Try again</a>.
          </Banner>
        )}
        {notOk.length > 0 && <Banner tone="warn" title="Some labels cannot be printed">{notOk.map((r) => r.job.entityName ?? r.job.entityNumber).join(", ")}: open the lot to print a new label.</Banner>}
        {toPrint.length > 0 && (
          <div className="grid gap-2">
            <PrintNow label={`Print ${labelCountWords(labelCount)}`} />
            <p className="text-[14px] text-fg-2">
              In the print window pick the label printer and <strong>Actual size / 100 %</strong>. <strong>Save as PDF</strong> looks exactly like this.
            </p>
          </div>
        )}
        {shown.length === 0 && !had && <Banner tone="info" title="No labels to print">Go back to the delivery and press Print labels.</Banner>}
      </div>

      {toPrint.length > 0 && (
        <div className="mx-auto mt-4 max-w-2xl px-4">
          <LabelSheet faces={toPrint.map((r) => r.face!)} captions={toPrint.map(caption)} />
        </div>
      )}
      {printedAlready.length > 0 && (
        <div className="no-print mx-auto mt-6 grid max-w-2xl gap-3 px-4">
          <h2 className="text-[17px] font-semibold">Already printed</h2>
          {printedAlready.map((r) => (
            <div key={r.job.id} className="grid justify-items-center gap-2">
              <div className="w-full text-[15px] text-fg-2">{caption(r)}</div>
              <LabelFace face={r.face!} />
            </div>
          ))}
          <LinkButton href={back} variant="secondary" size="lg">Back to the delivery</LinkButton>
        </div>
      )}

      {toPrint.length > 0 && (
        <div className="no-print mx-auto mt-4 grid max-w-2xl gap-4 px-4">
          <PrintedCheck jobIds={toPrint.map((r) => r.job.id)} receiptId={gr.id} count={labelCount} stick={stick} back={back} />
        </div>
      )}
      <AutoPrint enabled={toPrint.length > 0 && sp.auto === "1"} />
    </main>
  );
}

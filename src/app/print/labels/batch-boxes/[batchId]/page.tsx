import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Forbidden } from "@/app/(app)/forbidden";
import { markBatchBoxJobsPrintedAction } from "@/app/(app)/production/orders/[workOrderId]/flow-actions";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { labelJobForPrint } from "@/modules/documents";
import { batchBoxPrintJobs, continueHref } from "@/modules/production";
import { LinkButton } from "@/ui/core";
import { LabelFace, LabelSheet, labelCountWords } from "@/ui/labels";
import { Banner } from "@/ui/status";
import { AutoPrint, PrintedCheck, PrintNow } from "../../print-bits";

export const metadata = { title: "Print box labels" };
export const dynamic = "force-dynamic";

/**
 * Box labels of one batch (ADR-104 §2, ADR-099 print page): every box label of the current box plan ("Box 3 of 13
 * · 24 pieces"), one green "Print 13 labels", then "Did they all come out right?". On paper only the labels print,
 * one per page at the label size. Labels already printed are shown, not printed again (reprint with a reason).
 */
export default async function BatchBoxLabelsPage({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<{ auto?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.label_job.view") || !ctx.can("production.batch.view")) return <div className="p-6"><Forbidden what="label printing" /></div>;
  const { batchId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) notFound();
  let data: Awaited<ReturnType<typeof batchBoxPrintJobs>>;
  try {
    data = await batchBoxPrintJobs(ctx, batchId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const boxes = data.boxes;
  const loaded = await Promise.all(
    boxes.map(async (b) => ({
      box: b,
      r: b.jobId
        ? await labelJobForPrint(ctx, b.jobId).catch((e) => {
            if (e instanceof DomainError && e.code === "not_found") return null;
            throw e;
          })
        : null,
    })),
  );
  const shown = loaded.filter((x) => x.r?.face && !x.r.job.voidedAt && ["ready", "printed"].includes(x.r.job.status));
  const toPrint = ctx.can("inventory.label_job.create") ? shown.filter((x) => x.r!.job.status === "ready") : [];
  // Round 5 problem 3: one print trip. Piece labels waiting to print come first, in the same print job, when they
  // are the same size as the box labels (one page size per print job); otherwise a link to print them next.
  const pieces = ctx.can("inventory.label_job.create")
    ? (await Promise.all(data.pieceJobs.filter((j) => j.status === "ready").map((j) => labelJobForPrint(ctx, j.id).catch(() => null)))).filter((x) => !!x?.face && !x.job.voidedAt)
    : [];
  const boxSize = toPrint[0]?.r?.face ? `${toPrint[0].r.face.widthMm}x${toPrint[0].r.face.heightMm}` : null;
  const sameSize = pieces.filter((x) => !boxSize || `${x!.face!.widthMm}x${x!.face!.heightMm}` === boxSize);
  const otherSize = pieces.filter((x) => !sameSize.includes(x));
  const pieceCount = sameSize.reduce((t, x) => t + (x!.job.copies ?? 1), 0);
  const printed = shown.filter((x) => x.r!.job.status === "printed");
  const back = continueHref({ batchId, workOrderId: data.workOrderId });
  const caption = (x: (typeof shown)[number]) => (
    <p>
      <strong className="text-fg">Box {x.box.boxNo} of {x.box.boxCount}</strong> · {x.box.pieces} pieces · {x.r!.face!.widthMm} × {x.r!.face!.heightMm} mm
    </p>
  );
  return (
    <main className="min-h-dvh pb-10">
      <div className="no-print mx-auto grid max-w-2xl gap-4 px-4 pt-4">
        <a href={back} className="inline-flex min-h-[44px] items-center gap-2 text-[16px] font-semibold text-primary-text hover:underline">
          <ArrowLeft size={18} aria-hidden /> Back to the batch
        </a>
        <div>
          <h1 className="text-[22px] font-semibold leading-tight">{toPrint.length > 0 ? `Print ${toPrint.length} box ${toPrint.length === 1 ? "label" : "labels"}` : "Box labels"}</h1>
          <p className="mt-1 text-[16px] text-fg-2">Stick one label on each box. Each label shows its own box number and how many pieces are inside. Scan a box label to open the box.</p>
        </div>
        {boxes.length === 0 && <Banner tone="info" title="No box labels yet">Go back to the packaging step, say how many pieces you packed and press Print box labels.</Banner>}
        {toPrint.length + sameSize.length > 0 && (
          <div className="grid gap-2">
            <PrintNow label={`Print ${labelCountWords(toPrint.length + pieceCount)}`} />
            {pieceCount > 0 && <p className="text-[15px] text-fg" data-testid="one-print-trip">First {pieceCount} piece {pieceCount === 1 ? "label" : "labels"}, then {toPrint.length} box {toPrint.length === 1 ? "label" : "labels"}, in one go.</p>}
            <p className="text-[14px] text-fg-2">
              In the print window pick the label printer and <strong>Actual size / 100 %</strong>. <strong>Save as PDF</strong> looks exactly like this.
            </p>
          </div>
        )}
        {otherSize.length > 0 && (
          <Banner tone="info" title="Piece labels print on another size">
            {otherSize.map((x) => (
              <a key={x!.job.id} href={`/print/labels/${x!.job.id}?back=${encodeURIComponent(back)}`} className="mr-3 inline-flex min-h-[44px] items-center font-semibold text-primary-text underline">
                Print {x!.job.copies} piece labels
              </a>
            ))}
          </Banner>
        )}
      </div>
      {toPrint.length + sameSize.length > 0 && (
        <div className="mx-auto mt-4 max-w-2xl px-4">
          <LabelSheet
            faces={[...sameSize.map((x) => x!.face!), ...toPrint.map((x) => x.r!.face!)]}
            captions={[...sameSize.map((x) => <p key={x!.job.id}><strong className="text-fg">{x!.job.copies} piece labels</strong> (all look like this)</p>), ...toPrint.map(caption)]}
          />
        </div>
      )}
      {printed.length > 0 && (
        <div className="no-print mx-auto mt-6 grid max-w-2xl gap-3 px-4">
          <h2 className="text-[17px] font-semibold">Already printed</h2>
          {printed.map((x) => (
            <div key={x.box.boxId} className="grid justify-items-center gap-2">
              <div className="w-full text-[15px] text-fg-2">{caption(x)}</div>
              <LabelFace face={x.r!.face!} />
            </div>
          ))}
          <LinkButton href={back} variant="secondary" size="lg">Back to the batch</LinkButton>
        </div>
      )}
      {toPrint.length + sameSize.length > 0 && (
        <div className="no-print mx-auto mt-4 grid max-w-2xl gap-4 px-4">
          <PrintedCheck jobIds={[...sameSize.map((x) => x!.job.id), ...toPrint.map((x) => x.r!.job.id)]} count={toPrint.length + pieceCount} stick={pieceCount > 0 ? "Stick one label on each piece, then one label on each box." : "Stick one label on each box."} back={back} jobsAction={markBatchBoxJobsPrintedAction} />
        </div>
      )}
      <AutoPrint enabled={toPrint.length + sameSize.length > 0 && sp.auto === "1"} />
    </main>
  );
}

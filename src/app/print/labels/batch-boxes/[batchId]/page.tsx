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
        {toPrint.length > 0 && (
          <div className="grid gap-2">
            <PrintNow label={`Print ${labelCountWords(toPrint.length)}`} />
            <p className="text-[14px] text-fg-2">
              In the print window pick the label printer and <strong>Actual size / 100 %</strong>. <strong>Save as PDF</strong> looks exactly like this.
            </p>
          </div>
        )}
      </div>
      {toPrint.length > 0 && (
        <div className="mx-auto mt-4 max-w-2xl px-4">
          <LabelSheet faces={toPrint.map((x) => x.r!.face!)} captions={toPrint.map(caption)} />
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
      {toPrint.length > 0 && (
        <div className="no-print mx-auto mt-4 grid max-w-2xl gap-4 px-4">
          <PrintedCheck jobIds={toPrint.map((x) => x.r!.job.id)} count={toPrint.length} stick="Stick one label on each box." back={back} jobsAction={markBatchBoxJobsPrintedAction} />
        </div>
      )}
      <AutoPrint enabled={toPrint.length > 0 && sp.auto === "1"} />
    </main>
  );
}

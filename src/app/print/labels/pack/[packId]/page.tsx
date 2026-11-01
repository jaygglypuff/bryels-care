import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Forbidden } from "@/app/(app)/forbidden";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtQty } from "@/lib/qty";
import { labelJobForPrint } from "@/modules/documents";
import { getPack } from "@/modules/sales";
import { LinkButton } from "@/ui/core";
import { isOldLayout, LabelSheet, LABEL_KIND_WORDS, labelCountWords, OLD_LAYOUT_NOTE, plainPrinter } from "@/ui/labels";
import { Banner } from "@/ui/status";
import { AutoPrint, PrintedCheck, PrintNow } from "../../print-bits";

export const metadata = { title: "Print box labels" };
export const dynamic = "force-dynamic";

/**
 * Box labels of one boxing, printed where the boxing happens (ADR-099; re-audit B N9, replaces "sent to the
 * print station" + "Not printed yet"). Shows every box label made but not printed yet, one green
 * "Print N labels", then "Did they come out right?". On paper only the labels print, one per page, at the
 * label's size. A printed box label is not printed again from here: open the box and reprint with a reason.
 */
export default async function PrintPackLabelsPage({ params, searchParams }: { params: Promise<{ packId: string }>; searchParams: Promise<{ auto?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.label_job.view") || !ctx.can("inventory.pack.view")) return <div className="p-6"><Forbidden what="label printing" /></div>;
  const { packId } = await params;
  const sp = await searchParams;
  let v: Awaited<ReturnType<typeof getPack>>;
  try {
    v = await getPack(ctx, packId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const back = `/warehouse/packs/${v.pack.id}`;
  const uom = v.baseUom ?? "pcs";
  const live = v.boxes.filter((b) => b.status === "packed");
  const waiting = live.filter((b) => b.labelJobId && b.labelStatus === "ready");
  const loaded = await Promise.all(
    waiting.map(async (b) => {
      const r = await labelJobForPrint(ctx, b.labelJobId!).catch((e) => {
        if (e instanceof DomainError && e.code === "not_found") return null;
        throw e;
      });
      return r && r.face && !r.job.voidedAt && r.job.status === "ready" ? { box: b, r } : null;
    }),
  );
  const canPrint = ctx.can("inventory.label_job.create");
  const toPrint = canPrint ? loaded.filter((x): x is NonNullable<typeof x> => !!x) : [];
  const count = toPrint.reduce((a, x) => a + x.r.job.copies, 0);
  const printer = toPrint[0]?.r.job.printerName ?? null;
  const stick = LABEL_KIND_WORDS.box.stick;
  const printed = live.filter((b) => b.labelStatus === "printed").length;

  return (
    <main className="min-h-dvh pb-10">
      <div className="no-print mx-auto grid max-w-2xl gap-4 px-4 pt-4">
        <a href={back} className="inline-flex min-h-[44px] items-center gap-2 text-[16px] font-semibold text-primary-text hover:underline">
          <ArrowLeft size={18} aria-hidden /> Back to the boxing
        </a>
        <div>
          <h1 className="text-[22px] font-semibold leading-tight">{count > 0 ? `Print ${labelCountWords(count)}` : "Box labels"}: {v.productName}</h1>
          <p className="mt-1 text-[16px] text-fg-2">{stick}</p>
        </div>
        {!canPrint && <Banner tone="info" title="Your job cannot print labels">Ask the warehouse lead.</Banner>}
        {canPrint && toPrint.length === 0 && (
          <Banner tone="info" title={printed > 0 ? "Every box label is printed" : "No box labels to print"}>
            {printed > 0 ? "Lost or damaged one? Open the box and print it again with a reason." : "Go back to the boxing and pack a box first."}
          </Banner>
        )}
        {toPrint.length > 0 && (
          <div className="grid gap-2">
            <PrintNow label={`Print ${labelCountWords(count)}`} />
            <p className="text-[14px] text-fg-2">
              In the print window pick <strong>{plainPrinter(printer)}</strong> and <strong>Actual size / 100 %</strong>. <strong>Save as PDF</strong> looks exactly like this.
            </p>
            {toPrint.some((x) => isOldLayout(x.r.render?.rendererVersion)) && <p className="text-[14px] text-fg-2" data-testid="old-layout-note">{OLD_LAYOUT_NOTE}</p>}
          </div>
        )}
      </div>

      {toPrint.length > 0 && (
        <div className="mx-auto mt-4 max-w-2xl px-4">
          <LabelSheet
            screen="all"
            faces={toPrint.map((x) => x.r.face!)}
            captions={toPrint.map((x) => (
              <p key={x.box.id}>
                <strong className="text-fg">Box {x.box.boxNo}</strong> · {fmtQty(x.box.qtyBase, uom, uom === "pcs" ? 0 : 3)}
                {x.box.isPartial ? " · part box" : ""} · {x.r.face!.widthMm} × {x.r.face!.heightMm} mm
              </p>
            ))}
          />
        </div>
      )}

      <div className="no-print mx-auto mt-4 grid max-w-2xl gap-4 px-4">
        {toPrint.length > 0 ? (
          <PrintedCheck jobIds={toPrint.map((x) => x.r.job.id)} count={count} stick={stick} back={back} />
        ) : (
          <LinkButton href={back} variant="secondary" size="lg">
            Back to the boxing
          </LinkButton>
        )}
      </div>
      <AutoPrint enabled={toPrint.length > 0 && sp.auto === "1"} />
    </main>
  );
}

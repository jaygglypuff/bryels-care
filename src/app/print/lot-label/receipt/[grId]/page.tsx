import { notFound } from "next/navigation";
import { Forbidden } from "@/app/(app)/forbidden";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getReceipt } from "@/modules/inventory/receiving";
import { LinkButton } from "@/ui/core";
import { LABEL_CSS, LotLabel } from "../../label";
import { PrintButton } from "../../print-button";

export const metadata = { title: "Receipt labels" };

export default async function ReceiptLabelsPage({ params }: { params: Promise<{ grId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.label.print")) return <div className="p-6"><Forbidden what="label printing" /></div>;
  const { grId } = await params;
  let gr: Awaited<ReturnType<typeof getReceipt>>;
  try {
    gr = await getReceipt(ctx, grId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  return (
    <main>
      <style>{LABEL_CSS}</style>
      <div className="no-print mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 px-4 pt-6">
        <div>
          <h1 className="text-[18px] font-semibold">Labels · {gr.receiptNumber}</h1>
          <p className="text-[13px] text-muted">{gr.lines.length} {gr.lines.length === 1 ? "label" : "labels"}, 100 × 50 mm, one per page. Quantity is the received quantity of each lot.</p>
        </div>
        <div className="flex gap-2">
          <LinkButton href={`/inventory/receive/${gr.id}`} variant="secondary" size="lg">Back</LinkButton>
          <PrintButton label={`Print ${gr.lines.length}`} />
        </div>
      </div>
      <div className="lbl-sheet">
        {gr.lines.map((l) => (
          <LotLabel
            key={l.id}
            d={{
              lotNumber: l.lotNumber,
              itemName: l.materialName,
              itemCode: l.materialCode,
              supplierLotNumber: l.supplierLotNumber,
              receivedOn: gr.receivedAt,
              expiresOn: l.expiresOn,
              qualityStatus: l.qualityStatus,
              qtyBase: l.qtyBase,
              baseUom: l.baseUom,
            }}
          />
        ))}
      </div>
    </main>
  );
}

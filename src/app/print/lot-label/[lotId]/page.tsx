import { notFound } from "next/navigation";
import { Forbidden } from "@/app/(app)/forbidden";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D } from "@/lib/qty";
import { getLotDetail, type LotDetail } from "@/modules/inventory/lots";
import { LinkButton } from "@/ui/core";
import { LABEL_CSS, LotLabel } from "../label";
import { PrintButton } from "../print-button";

export const metadata = { title: "Lot label" };

export default async function LotLabelPage({ params }: { params: Promise<{ lotId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.label.print")) return <div className="p-6"><Forbidden what="label printing" /></div>;
  const { lotId } = await params;
  let lot: LotDetail;
  try {
    lot = await getLotDetail(ctx, lotId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const onHand = lot.balances.reduce((a, b) => a.plus(b.qtyBase), D(0));
  return (
    <main>
      <style>{LABEL_CSS}</style>
      <div className="no-print mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 px-4 pt-6">
        <div>
          <h1 className="text-[18px] font-semibold">Label · {lot.lotNumber}</h1>
          <p className="text-[13px] text-muted">100 × 50 mm, one label per page. Quantity shown is the current on-hand total; status is as of printing.</p>
        </div>
        <div className="flex gap-2">
          <LinkButton href={`/inventory/${lot.id}`} variant="secondary" size="lg">Back</LinkButton>
          <PrintButton />
        </div>
      </div>
      <div className="lbl-sheet">
        <LotLabel
          d={{
            lotNumber: lot.lotNumber,
            itemName: lot.itemName,
            itemCode: lot.itemCode,
            supplierLotNumber: lot.supplierLotNumber,
            receivedOn: lot.receipt?.receivedAt ?? lot.createdAt,
            expiresOn: lot.expiresOn,
            qualityStatus: lot.qualityStatus,
            qtyBase: onHand.toString(),
            baseUom: lot.baseUom,
          }}
        />
      </div>
    </main>
  );
}

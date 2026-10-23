import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getLotDetail, type LotDetail } from "@/modules/inventory/lots";
import { Card, PageHeader } from "@/ui/core";
import { Banner, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../../forbidden";
import { EditLotForm } from "./edit-form";

export const metadata = { title: "Correct lot details" };

export default async function EditLotPage({ params }: { params: Promise<{ lotId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.edit")) return <Forbidden what="correcting lot details" />;
  const { lotId } = await params;
  let lot: LotDetail;
  try {
    lot = await getLotDetail(ctx, lotId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="Correct lot details"
        subtitle={<><Link href={`/inventory/${lot.id}`} className="font-mono text-primary-text hover:underline">{lot.lotNumber}</Link> · {lot.itemName}</>}
        actions={<StatusChip status={lot.qualityStatus} />}
      />
      <Banner tone="info" title="Quality status is not edited here">Only QA can change the status, by recording a decision. Changing the expiry does not release or block the lot by itself; the expiry rules apply to the new date.</Banner>
      <Card>
        <EditLotForm lotId={lot.id} v={{ manufacturedOn: lot.manufacturedOn, expiresOn: lot.expiresOn, supplierLotNumber: lot.supplierLotNumber }} />
      </Card>
    </div>
  );
}

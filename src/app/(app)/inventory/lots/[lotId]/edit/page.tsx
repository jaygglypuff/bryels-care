import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getLotDetail, type LotDetail } from "@/modules/inventory/lots";
import { Card, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { RecordNo } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { LotStatusChip } from "@/ui/inventory/bits";
import { Forbidden } from "../../../../forbidden";
import { EditLotForm } from "./edit-form";

export const metadata = { title: "Fix lot details" };

/** Fix a lot's dates or the supplier's code (grade-5, ADR-088). The old and new values go to the audit trail. */
export default async function EditLotPage({ params }: { params: Promise<{ lotId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.edit")) return <Forbidden what="fixing lot details" />;
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
        title={`Fix details: ${lot.itemName}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            Lot <RecordNo>{lot.lotNumber}</RecordNo> <LotStatusChip status={lot.qualityStatus} expiresOn={lot.expiresOn} />
          </span>
        }
        actions={<LinkButton href={`/inventory/${lot.id}`} variant="secondary">Back to the lot</LinkButton>}
      />
      <PageIntro>This screen is for fixing a date or the supplier&apos;s code that was typed wrong when the lot came in. The old and new values are kept in the history.</PageIntro>
      <Banner tone="info" title="QA status is not changed here">Only QA can say OK or not OK. A new expiry date does not make the lot OK or not OK by itself; the expiry rules use the new date.</Banner>
      <Card>
        <EditLotForm lotId={lot.id} v={{ manufacturedOn: lot.manufacturedOn, expiresOn: lot.expiresOn, supplierLotNumber: lot.supplierLotNumber, brand: lot.brand, isMaterial: lot.itemKind === "material" }} />
      </Card>
    </div>
  );
}

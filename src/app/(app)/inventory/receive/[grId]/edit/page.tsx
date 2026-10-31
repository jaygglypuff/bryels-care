import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getReceiptDocument, receivingFormData, type ReceiptDocument } from "@/modules/inventory/receiving";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../../forbidden";
import { ReceiveForm } from "../../receive-form";

export const metadata = { title: "Change the delivery (not finished)" };

export default async function EditReceiptPage({ params }: { params: Promise<{ grId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.goods_receipt.create") || !ctx.can("procurement.goods_receipt.view")) return <Forbidden what="editing receipts" />;
  const { grId } = await params;
  let gr: ReceiptDocument;
  try {
    gr = await getReceiptDocument(ctx, grId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  if (gr.status !== "draft" || gr.siteId !== ctx.currentSiteId) {
    return (
      <EmptyState title={gr.status !== "draft" ? "This delivery is already saved" : "Switch to the delivery's site to change it"} action={<LinkButton href={`/inventory/receive/${gr.id}`} variant="secondary">Back to the delivery</LinkButton>}>
        A saved delivery is never changed. If it is wrong, undo it (kept on record) and write it down again.
      </EmptyState>
    );
  }
  const data = await receivingFormData(ctx);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Change the delivery (not finished)" subtitle={`${ctx.currentSite.name} · ${gr.supplierName}`} />
      <PageIntro>This screen is for fixing a delivery that is not saved yet: add or change items, amounts and dates, then save it to stock.</PageIntro>
      <ReceiveForm
        idempotencyKey={randomUUID()}
        materials={data.materials}
        locations={data.locations}
        suppliers={data.suppliers}
        reasonCodes={data.reasonCodes}
        defaultLocationId={data.locations[0]?.id ?? ""}
        canPost={ctx.can("procurement.goods_receipt.post")}
        printLabels={ctx.can("inventory.label_job.create")}
        initial={{
          receiptId: gr.id,
          supplierName: gr.supplierName,
          supplierDocumentNumber: gr.supplierDocumentNumber ?? "",
          unplannedReasonCode: gr.unplannedReasonCode ?? "",
          notes: gr.notes ?? "",
          lines: gr.lines.map((l) => ({
            lineId: l.id,
            materialId: l.materialId,
            qty: new Decimal(l.qtyEntered ?? l.qtyBase).toString(),
            uom: l.uomEntered ?? l.baseUom,
            supplierLotNumber: l.supplierLotNumber ?? "",
            brand: l.brand ?? "",
            manufacturedOn: l.manufacturedOn ?? "",
            expiresOn: l.expiresOn ?? "",
            retestOn: l.retestOn ?? "",
            containerCount: l.containerCount ? String(l.containerCount) : "",
            storageConditionsConfirmed: l.storageConditionsConfirmed,
            locationId: l.locationId,
            discrepancyKind: l.discrepancyKind ?? "",
            discrepancyNote: l.discrepancyNote ?? "",
          })),
        }}
      />
    </div>
  );
}

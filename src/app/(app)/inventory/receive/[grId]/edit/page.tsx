import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getReceiptDocument, receivingFormData, type ReceiptDocument } from "@/modules/inventory/receiving";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../../forbidden";
import { ReceiveForm } from "../../receive-form";

export const metadata = { title: "Edit receipt draft" };

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
      <EmptyState title={gr.status !== "draft" ? "This receipt is no longer a draft" : "Switch to the receipt's site to edit it"} action={<LinkButton href={`/inventory/receive/${gr.id}`} variant="secondary">Back to the receipt</LinkButton>}>
        Posted receipts are corrected by reversal, never edited.
      </EmptyState>
    );
  }
  const data = await receivingFormData(ctx);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Edit receipt draft" subtitle={`${ctx.currentSite.code} · ${gr.supplierName}`} />
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

import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Printer } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getReceipt } from "@/modules/inventory/receiving";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { Banner, StatusChip } from "@/ui/status";
import { fmtLotQty } from "@/ui/inventory/bits";
import { Forbidden } from "../../../forbidden";

export const metadata = { title: "Goods receipt" };

export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ grId: string }>; searchParams: Promise<{ posted?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="goods receipts" />;
  const { grId } = await params;
  const { posted } = await searchParams;
  let gr: Awaited<ReturnType<typeof getReceipt>>;
  try {
    gr = await getReceipt(ctx, grId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const actions = (
    <>
      {ctx.can("inventory.label.print") && (
        <LinkButton href={`/print/lot-label/receipt/${gr.id}`} target="_blank" variant={posted ? "cta" : "secondary"} size="lg">
          <Printer size={18} /> Print labels ({gr.lines.length})
        </LinkButton>
      )}
      {ctx.can("inventory.receipt.post") && (
        <LinkButton href="/inventory/receive" variant="secondary" size="lg">
          Receive more
        </LinkButton>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={gr.receiptNumber} subtitle={<><Link href="/inventory" className="text-primary-text hover:underline">Lots & stock</Link> · goods receipt from {gr.supplierName}</>} />
      {posted && (
        <Banner tone="ok" title={`Receipt ${gr.receiptNumber} posted`}>
          <span className="inline-flex items-center gap-1"><CheckCircle2 size={14} /> {gr.lines.length} new {gr.lines.length === 1 ? "lot is" : "lots are"} in quarantine. Label every container, then QA can release them.</span>
        </Banner>
      )}
      <div className="flex flex-wrap gap-2">{actions}</div>

      <Card>
        <CardTitle>Created lots</CardTitle>
        <ul className="space-y-2">
          {gr.lines.map((l) => (
            <li key={l.id}>
              <Link href={`/inventory/${l.lotId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-line p-3 hover:bg-surface-2">
                <div className="min-w-0">
                  <p className="font-mono text-[18px] font-semibold text-primary-text" data-testid="created-lot">{l.lotNumber}</p>
                  <p className="text-[13px]">{l.materialName} <span className="text-muted">· {l.materialCode} · supplier lot {l.supplierLotNumber ?? "—"}</span></p>
                  <p className="text-[12px] text-muted">Expires {fmtDate(l.expiresOn)} · at {l.locationCode} ({l.locationName})</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-semibold tabular">{fmtLotQty(l.qtyBase, l.baseUom)}</span>
                  <StatusChip status={l.qualityStatus} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle>Receipt</CardTitle>
        <Dl
          items={[
            ["Receipt no.", gr.receiptNumber],
            ["Supplier", gr.supplierName],
            ["Supplier document", gr.supplierDocumentNumber ?? "—"],
            ["Received", fmtDateTime(gr.receivedAt)],
            ["Received by", gr.receivedByName],
            ["Notes", gr.notes ?? "—"],
          ]}
        />
      </Card>
    </div>
  );
}

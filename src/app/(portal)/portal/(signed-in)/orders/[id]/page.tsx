import Link from "next/link";
import { notFound } from "next/navigation";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getPortalOrder, requirePortalContext } from "@/modules/portal";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { PortalStatus, money, pcs } from "../../portal-ui";

export const metadata = { title: "Order" };

const NEXT_STEP: Record<string, string> = {
  draft: "Bryel's Care is reviewing your order. We will contact you if anything needs to change.",
  submitted: "Bryel's Care is reviewing your order.",
  pending_approval: "Your order is being reviewed by Bryel's Care before it is confirmed. You do not need to do anything.",
  confirmed: "Your order is confirmed and will be prepared for delivery.",
  allocated: "Your goods are reserved and being prepared.",
  picking: "Your goods are being picked.",
  packed: "Your goods are packed and waiting for dispatch.",
  partially_shipped: "Part of your order is on its way; the rest follows.",
  shipped: "Your order is on its way. The delivery receipt is below.",
};

/** One order of the customer: status words, timeline, lines at the agreed prices, shipments and DR links. */
export default async function PortalOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ placed?: string }> }) {
  const ctx = await requirePortalContext();
  const { id } = await params;
  const { placed } = await searchParams;
  let o: Awaited<ReturnType<typeof getPortalOrder>>;
  try {
    o = await getPortalOrder(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && (e.code === "not_found" || e.code === "forbidden")) notFound();
    throw e;
  }
  return (
    <>
      <PageHeader
        title={`Order ${o.orderNumber}`}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><PortalStatus status={o.status} label={o.statusLabel} /> placed {fmtDate(o.placedAt)}{o.fromPortal ? " in the portal" : " by our sales team"}</span>}
        actions={
          <>
            <LinkButton href="/portal/orders" variant="secondary">All orders</LinkButton>
            {o.canReorder && <LinkButton href={`/portal/order?from=${o.id}`} variant="cta">Reorder</LinkButton>}
          </>
        }
      />
      {placed && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title={`Thank you. Order ${o.orderNumber} was sent to Bryel's Care.`}>{o.statusLabel === "Confirmed" ? "It is confirmed." : "It is under review; this page shows when it is confirmed."}</Banner>
        </div>
      )}
      {NEXT_STEP[o.status] && !placed && (
        <div className="mb-4">
          <Banner tone="info" title={o.statusLabel}>{NEXT_STEP[o.status]}</Banner>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Products</CardTitle>
            <ul className="flex flex-col divide-y divide-line">
              {o.lines.map((l) => (
                <li key={l.lineNo} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium">{l.name}</p>
                    <p className="text-[12px] text-muted">
                      <span className="font-mono">{l.sku}</span>
                      {l.customerItemCode ? ` · your code ${l.customerItemCode}` : ""}
                    </p>
                  </div>
                  <div className="ml-auto text-right text-[13px] tabular">
                    <p className="font-medium">{money(l.lineTotal, o.currency)}</p>
                    <p className="text-[12px] text-muted">
                      {pcs(l.qty)} × {money(l.unitPrice, o.currency)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <dl className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-[13px] tabular">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{money(o.subtotalAmount, o.currency)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd>{money(o.taxAmount, o.currency)}</dd></div>
              <div className="flex justify-between text-[15px] font-semibold"><dt>Total</dt><dd>{money(o.totalAmount, o.currency)}</dd></div>
            </dl>
          </Card>
          <Card>
            <CardTitle>Shipments</CardTitle>
            {o.shipments.length === 0 ? (
              <p className="text-[13px] text-muted">Nothing dispatched yet. The delivery receipt appears here when the goods leave our warehouse.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {o.shipments.map((s, i) => (
                  <li key={s.shipmentNumber ?? i} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13px]">
                    <div className="min-w-0">
                      <p className="font-medium">{s.deliveryReceiptNumber ? `DR ${s.deliveryReceiptNumber}` : (s.shipmentNumber ?? "Shipment")}</p>
                      <p className="text-[12px] text-muted">
                        {s.deliveredAt ? `delivered ${fmtDateTime(s.deliveredAt)}` : `dispatched ${fmtDateTime(s.dispatchedAt)}`}
                        {s.carrier ? ` · ${s.carrier}` : ""}
                        {s.trackingNumber ? ` · tracking ${s.trackingNumber}` : ""}
                      </p>
                    </div>
                    {s.documentHref && (
                      <Link href={s.documentHref} className="font-medium text-primary-text hover:underline">
                        View delivery receipt
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Details</CardTitle>
            <Dl
              items={[
                ["Deliver by", fmtDate(o.requestedDeliveryOn)],
                ["Your PO", o.customerPoNumber ?? "—"],
                ["Deliver to", o.shipTo ?? "—"],
              ]}
            />
          </Card>
          <Card>
            <CardTitle>Progress</CardTitle>
            <ol className="flex flex-col gap-2 text-[13px]">
              {o.timeline.map((t, i) => (
                <li key={`${t.label}-${i}`} className="border-l-2 border-[var(--brand-300)] pl-3">
                  <span className="font-medium">{t.label}</span>
                  <span className="block text-[12px] text-muted">{fmtDateTime(t.at)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}

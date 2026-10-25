import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime, fmtQty } from "@/lib/qty";
import { listShipments, unacknowledgedDeliveryReceipts } from "@/modules/sales";
import { Card, CardTitle, EmptyState, PageHeader } from "@/ui/core";
import { Banner, StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { Help } from "@/ui/help/help";

export const metadata = { title: "Dispatch" };

/** Dock view (W09-08/09): verified shipments ready to dispatch and delivery receipts awaiting acknowledgment. */
export default async function DispatchPage() {
  const ctx = await requireContext();
  if (!ctx.can("sales.shipment.view")) return <Forbidden what="shipments" />;
  const [packed, picked, dispatched] = await Promise.all([listShipments(ctx, { status: "packed" }), listShipments(ctx, { status: "picked" }), listShipments(ctx, { status: "dispatched" })]);
  const overdue = ctx.can("sales.delivery_receipt.view") ? await unacknowledgedDeliveryReceipts(ctx) : [];
  return (
    <>
      <PageHeader title="Dispatch" subtitle={`${ctx.currentSite.code} · stock is issued when a shipment is dispatched, never when a draft DR is printed`} actions={<><Help screen="sales.fulfilment" /></>} />
      {overdue.length > 0 && <div className="mb-4"><Banner tone="warn" title={`${overdue.length} delivery receipt(s) not acknowledged`}>{overdue.map((o) => `${o.drNumber ?? o.shipmentNumber} (${o.customerName}, ${o.days} days)`).join("; ")}</Banner></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[
          { title: "Ready to dispatch (packed)", rows: packed, empty: "Verified shipments appear here." },
          { title: "Waiting for pack verification", rows: picked, empty: "Picked shipments appear here." },
          { title: "Dispatched, awaiting acknowledgment", rows: dispatched, empty: "Nothing out for delivery." },
        ].map((col) => (
          <Card key={col.title}>
            <CardTitle>{col.title}</CardTitle>
            {col.rows.length === 0 ? (
              <EmptyState title="Nothing here">{col.empty}</EmptyState>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {col.rows.map((s) => (
                  <li key={s.id} className="py-3">
                    <Link href={`/sales/shipments/${s.id}`} className="font-medium text-primary-text hover:underline">{s.shipmentNumber ?? s.deliveryReceiptNumber}</Link> <StatusChip status={s.status} />
                    <p className="text-[13px] text-fg-2">{s.orderNumber} · {s.customerName} · {s.boxes} box(es) · {fmtQty(s.units, "pcs", 0)}</p>
                    {s.dispatchedAt && <p className="text-[12px] text-muted">DR {s.deliveryReceiptNumber} · {fmtDateTime(s.dispatchedAt)}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

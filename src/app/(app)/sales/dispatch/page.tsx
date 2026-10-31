import { requireContext } from "@/lib/auth/context";
import { fmtDateTime, fmtQty } from "@/lib/qty";
import { listShipments, unacknowledgedDeliveryReceipts } from "@/modules/sales";
import { EmptyState, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { ShipChip } from "../orders/sales-ui";
import { Help } from "@/ui/help/help";

export const metadata = { title: "Send out" };

/**
 * Loading dock (W09-08/09), phone first: deliveries ready to send out first (the warehouse's next job), then
 * those waiting for the second check of the box, then those out on the road waiting for proof of delivery.
 */
export default async function DispatchPage() {
  const ctx = await requireContext();
  if (!ctx.can("sales.shipment.view")) return <Forbidden what="deliveries" />;
  const [packed, picked, dispatched] = await Promise.all([listShipments(ctx, { status: "packed" }), listShipments(ctx, { status: "picked" }), listShipments(ctx, { status: "dispatched" })]);
  const overdue = ctx.can("sales.delivery_receipt.view") ? await unacknowledgedDeliveryReceipts(ctx) : [];
  const groups = [
    { title: "Ready to send out", rows: packed, empty: "Nothing ready. Deliveries show here after the second check of the box.", action: "Send out" },
    { title: "Waiting for the second check of the box", rows: picked, empty: "Nothing waiting for the second check.", action: "Check" },
    { title: "Sent out: waiting for proof of delivery", rows: dispatched, empty: "Nothing on the road.", action: "Proof" },
  ];
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Send out" subtitle={ctx.currentSite.name} actions={<Help screen="sales.fulfilment" />} />
      <PageIntro>This screen is for the loading dock: what is ready to go on the truck, and what still needs the signed delivery receipt back. Stock leaves the shelf only when you tap Send out.</PageIntro>
      {overdue.length > 0 && (
        <div className="mb-4">
          <Banner tone="warn" title={`${overdue.length} delivery receipt(s) not signed back yet`}>
            {overdue.slice(0, 3).map((o) => `${o.customerName} (${o.days} days)`).join("; ")}{overdue.length > 3 ? ` and ${overdue.length - 3} more` : ""}. Ask the driver for the signed copy.
          </Banner>
        </div>
      )}
      <div className="flex flex-col gap-5">
        {groups.map((g) => (
          <section key={g.title} aria-label={g.title}>
            <h2 className="mb-2 text-[16px] font-semibold">
              {g.title} <span className="text-[13px] font-normal text-muted">({g.rows.length})</span>
            </h2>
            {g.rows.length === 0 ? (
              <EmptyState title="Nothing here">{g.empty}</EmptyState>
            ) : (
              <PlainList label={g.title}>
                {g.rows.map((s) => (
                  <PlainRow
                    key={s.id}
                    href={s.status === "picked" ? `/sales/packing/${s.id}` : `/sales/shipments/${s.id}`}
                    title={s.customerName}
                    code={[s.shipmentNumber, s.deliveryReceiptNumber].filter(Boolean).join(" · ")}
                    status={<ShipChip status={s.status} />}
                    facts={
                      <>
                        {s.boxes} box(es) · {fmtQty(s.units, "pcs", 0)}
                        {s.dispatchedAt ? ` · sent ${fmtDateTime(s.dispatchedAt)}` : ""}
                      </>
                    }
                    aside={<span className="text-[14px] font-semibold text-primary-text">{g.action}</span>}
                  />
                ))}
              </PlainList>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { fulfilmentForOrder } from "@/modules/sales";
import { Card, CardTitle, LinkButton } from "@/ui/core";
import { ShipChip } from "../orders/sales-ui";
import { releaseAllocationsAction, startPickAction } from "../fulfilment-actions";
import { Cmd, ReasonCmd } from "../fulfilment-forms";

/**
 * W3E fulfilment summary on the order page (server component): the next step for the order's state
 * (start or continue the pick, verify, dispatch) and its shipments with their DR state.
 * `data`: the page's own fulfilmentForOrder result (no second read). `hideNext`: the record header
 * page's "What to do next" already shows Get from shelf / Continue, and "⋯ More" has "Let the stock go", so the panel shows only the shipments.
 */
export async function FulfilmentPanel({ orderId, data, hideNext = false }: { orderId: string; data?: Awaited<ReturnType<typeof fulfilmentForOrder>>; hideNext?: boolean }) {
  const ctx = await requireContext();
  const f = data !== undefined ? data : await fulfilmentForOrder(ctx, orderId);
  if (!f) return null;
  const o = f.order;
  const pickable = ["allocated", "partially_shipped"].includes(o.status) && f.openAllocations > 0 && !f.openPick;
  const releasable = !hideNext && ["allocated", "partially_shipped"].includes(o.status) && f.openAllocations > 0 && !f.openPick && ctx.can("inventory.allocation.void");
  const showStart = !hideNext && pickable && ctx.can("sales.pick.create");
  const showContinue = !hideNext && !!f.openPick;
  if (!showStart && !showContinue && f.shipments.length === 0 && !releasable) return null;
  return (
    <Card>
      <CardTitle>Sending out</CardTitle>
      <div className="flex flex-col gap-3">
        {showStart && (
          <Cmd action={startPickAction} fields={{ orderId: o.id }} label="Get from shelf" pending="Starting…" variant="cta" size="lg">
            <p className="text-[13px] text-fg-2">Scan every box that was set aside. Stock leaves only when it is sent out.</p>
          </Cmd>
        )}
        {showContinue && f.openPick && <LinkButton href={`/sales/picking/${f.openPick.id}`} variant="primary">Continue getting from shelf</LinkButton>}
        {releasable && <ReasonCmd action={releaseAllocationsAction} fields={{ orderId: o.id }} label="Let the stock go" placeholder="e.g. Customer postponed the delivery" />}
        {f.shipments.length > 0 && (
          <ul className="flex flex-col divide-y divide-line text-[13px]">
            {f.shipments.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/sales/shipments/${s.id}`} className="min-h-[44px] content-center font-medium text-primary-text hover:underline">
                  {s.dispatchedAt ? `Sent ${fmtDateTime(s.dispatchedAt)}` : "Open the shipment"} <span className="font-mono text-[12px] text-muted">{s.shipmentNumber ?? s.deliveryReceiptNumber}</span>
                </Link>
                <ShipChip status={s.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

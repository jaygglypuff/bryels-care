import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { fulfilmentForOrder } from "@/modules/sales";
import { Card, CardTitle, LinkButton } from "@/ui/core";
import { StatusChip } from "@/ui/status";
import { releaseAllocationsAction, startPickAction } from "../fulfilment-actions";
import { Cmd, ReasonCmd } from "../fulfilment-forms";

/**
 * W3E fulfilment summary on the order page (server component): the next step for the order's state
 * (start or continue the pick, verify, dispatch) and its shipments with their DR state.
 */
export async function FulfilmentPanel({ orderId }: { orderId: string }) {
  const ctx = await requireContext();
  const f = await fulfilmentForOrder(ctx, orderId);
  if (!f) return null;
  const o = f.order;
  const pickable = ["allocated", "partially_shipped"].includes(o.status) && f.openAllocations > 0 && !f.openPick;
  const releasable = ["allocated", "partially_shipped"].includes(o.status) && f.openAllocations > 0 && !f.openPick && ctx.can("inventory.allocation.void");
  if (!pickable && !f.openPick && f.shipments.length === 0 && !releasable) return null;
  return (
    <Card>
      <CardTitle>Fulfilment</CardTitle>
      <div className="flex flex-col gap-3">
        {pickable && ctx.can("sales.pick.create") && (
          <Cmd action={startPickAction} fields={{ orderId: o.id }} label="Start pick list" pending="Starting…" variant="cta" size="lg">
            <p className="text-[13px] text-fg-2">Scan every allocated box (or the lot with a quantity for loose units). Stock moves only at dispatch.</p>
          </Cmd>
        )}
        {f.openPick && <LinkButton href={`/sales/picking/${f.openPick.id}`} variant="primary">Continue pick {f.openPick.pickNumber}</LinkButton>}
        {releasable && <ReasonCmd action={releaseAllocationsAction} fields={{ orderId: o.id }} label="Release allocation" placeholder="e.g. Customer postponed the delivery" />}
        {f.shipments.length > 0 && (
          <ul className="flex flex-col divide-y divide-line text-[13px]">
            {f.shipments.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/sales/shipments/${s.id}`} className="font-medium text-primary-text hover:underline">{s.shipmentNumber ?? s.deliveryReceiptNumber}</Link>
                <span className="inline-flex items-center gap-2"><StatusChip status={s.status} />{s.deliveryReceiptNumber ? `DR ${s.deliveryReceiptNumber}` : ""} {s.dispatchedAt ? fmtDateTime(s.dispatchedAt) : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

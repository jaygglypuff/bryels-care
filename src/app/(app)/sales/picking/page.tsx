import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { pickQueue } from "@/modules/sales";
import { EmptyState, PageHeader } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Forbidden } from "../../forbidden";
import { startPickAction } from "../fulfilment-actions";
import { Cmd } from "../fulfilment-forms";
import { ShipChip } from "../orders/sales-ui";
import { Help } from "@/ui/help/help";

export const metadata = { title: "To get from shelf" };

/**
 * W09-06 queue, phone first (warehouse staff, ADR-088): what is being got from the shelf now, then the orders
 * whose stock is set aside, oldest delivery date first. The first one has the one green button; each row is a
 * big target. Finished lists fold away.
 */
export default async function PickingPage() {
  const ctx = await requireContext();
  if (!ctx.can("sales.pick.view")) return <Forbidden what="getting orders from the shelf" />;
  const q = await pickQueue(ctx);
  const canStart = ctx.can("sales.pick.create");
  const waiting = q.ready.filter((o) => !q.open.some((p) => p.orderNumber === o.orderNumber));
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="To get from shelf" subtitle={ctx.currentSite.name} actions={<Help screen="sales.fulfilment" />} />
      <PageIntro>This screen is for the warehouse: the customer orders to get from the shelf. Tap one, then scan each box as you take it.</PageIntro>

      {q.open.length > 0 && (
        <section aria-label="Being got from the shelf now" className="mb-5">
          <h2 className="mb-2 text-[16px] font-semibold">Started: finish these first</h2>
          <PlainList label="Started">
            {q.open.map((p) => (
              <PlainRow
                key={p.id}
                href={`/sales/picking/${p.id}`}
                title={p.customerName}
                code={p.pickNumber}
                status={<ShipChip status="in_progress" />}
                facts={`Started ${fmtDateTime(p.startedAt)} by ${p.assignedName ?? "—"}`}
                aside={<span className="text-[14px] font-semibold text-primary-text">Continue</span>}
              />
            ))}
          </PlainList>
        </section>
      )}

      <section aria-label="Ready to get from the shelf" className="mb-5">
        <h2 className="mb-2 text-[16px] font-semibold">Ready to get from the shelf</h2>
        {waiting.length === 0 ? (
          <EmptyState title="Nothing to get from the shelf">Orders show here when the office has set the stock aside for them. If you expect one, ask the sales team.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {waiting.map((o, i) => (
              <li key={o.id} className="rounded-[16px] border border-line bg-surface p-4">
                <Link href={`/sales/${o.id}`} className="flex min-h-[48px] items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] font-semibold text-fg">{o.customerName}</span>
                    <span className="block text-[14px] text-fg-2">
                      Deliver by {fmtDate(o.requestedDeliveryOn)} <span className="font-mono text-[12px] text-muted">· {o.orderNumber}</span>
                    </span>
                  </span>
                  <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
                </Link>
                {canStart && (
                  <div className="mt-3 [&_button]:min-h-[52px] [&_button]:w-full">
                    <Cmd action={startPickAction} fields={{ orderId: o.id }} label="Get from shelf" pending="Starting…" variant={i === 0 ? "cta" : "secondary"} size="lg" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {q.recent.length > 0 && (
        <MoreDetails title="Finished recently">
          <PlainList label="Finished recently">
            {q.recent.map((p) => (
              <PlainRow key={p.id} href={`/sales/picking/${p.id}`} title={p.customerName} code={p.pickNumber} status={<ShipChip status={p.status} />} facts={p.completedAt ? `Finished ${fmtDateTime(p.completedAt)}` : undefined} />
            ))}
          </PlainList>
        </MoreDetails>
      )}
    </div>
  );
}

import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { pickQueue } from "@/modules/sales";
import { Card, CardTitle, EmptyState, PageHeader, Table, Td } from "@/ui/core";
import { StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { startPickAction } from "../fulfilment-actions";
import { Cmd } from "../fulfilment-forms";
import { Help } from "@/ui/help/help";

export const metadata = { title: "Picking" };

/** W09-06 pick queue: allocated orders ready to pick and the open picks of the current site. */
export default async function PickingPage() {
  const ctx = await requireContext();
  if (!ctx.can("sales.pick.view")) return <Forbidden what="pick lists" />;
  const q = await pickQueue(ctx);
  const canStart = ctx.can("sales.pick.create");
  return (
    <>
      <PageHeader title="Picking" subtitle={`${ctx.currentSite.code} · scan every allocated box or lot at the shelf`} actions={<><Help screen="sales.fulfilment" /></>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Ready to pick</CardTitle>
          {q.ready.length === 0 ? (
            <EmptyState title="Nothing to pick">Orders appear here once their stock is allocated.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {q.ready.map((o) => {
                const open = q.open.find((p) => p.orderNumber === o.orderNumber);
                return (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <Link href={`/sales/${o.id}`} className="font-medium text-primary-text hover:underline">{o.orderNumber}</Link> <StatusChip status={o.status} />
                      <p className="text-[13px] text-fg-2">{o.customerName} · due {fmtDate(o.requestedDeliveryOn)}</p>
                    </div>
                    {open ? (
                      <Link href={`/sales/picking/${open.id}`} className="text-[14px] font-medium text-primary-text hover:underline">Continue {open.pickNumber}</Link>
                    ) : canStart ? (
                      <Cmd action={startPickAction} fields={{ orderId: o.id }} label="Start pick" pending="Starting…" size="sm" />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Open picks</CardTitle>
          {q.open.length === 0 ? (
            <EmptyState title="No open picks">Start a pick from an allocated order.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {q.open.map((p) => (
                <li key={p.id} className="py-3">
                  <Link href={`/sales/picking/${p.id}`} className="font-medium text-primary-text hover:underline">{p.pickNumber}</Link> · {p.orderNumber}
                  <p className="text-[13px] text-fg-2">{p.customerName} · started {fmtDateTime(p.startedAt)} by {p.assignedName ?? "—"}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card className="mt-4">
        <CardTitle>Recent picks</CardTitle>
        {q.recent.length === 0 ? (
          <EmptyState title="No picks yet" />
        ) : (
          <Table head={["Pick", "Order", "Customer", "Status", "Completed"]}>
            {q.recent.map((p) => (
              <tr key={p.id}>
                <Td><Link href={`/sales/picking/${p.id}`} className="text-primary-text hover:underline">{p.pickNumber}</Link></Td>
                <Td>{p.orderNumber}</Td>
                <Td>{p.customerName}</Td>
                <Td><StatusChip status={p.status} /></Td>
                <Td>{fmtDateTime(p.completedAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

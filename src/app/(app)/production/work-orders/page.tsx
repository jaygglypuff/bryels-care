import Link from "next/link";
import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtMass } from "@/lib/qty";
import { listWorkOrders, WORK_ORDER_STATUSES } from "@/modules/production";
import { Card, EmptyState, LinkButton, PageHeader, Select, Table, Td } from "@/ui/core";
import { Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { Help } from "@/ui/help/help";

export const metadata: Metadata = { title: "Work orders" };
export const dynamic = "force-dynamic";

const WORD: Record<string, string> = { in_progress: "In progress", completed: "Completed", released: "Released" };

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.work_order.view")) return <Forbidden what="work orders" />;
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const rows = await listWorkOrders(ctx, { status, q: sp.q });
  return (
    <div>
      <PageHeader
        title="Work orders"
        subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name} · plan, release with material reservation, then create batches`}
        actions={
          <>
            <Help screen="production.work_order" />
            <LinkButton href="/production/board" variant="secondary">Board</LinkButton>
            {ctx.can("production.work_order.create") && <LinkButton href="/production/work-orders/new" variant="cta">New work order</LinkButton>}
          </>
        }
      />
      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <label className="flex min-w-[160px] flex-col gap-1 text-[13px] font-medium">
          Status
          <Select name="status" defaultValue={status}>
            <option value="open">Open (draft to in progress)</option>
            <option value="all">All</option>
            {WORK_ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </Select>
        </label>
        <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[13px] font-medium sm:max-w-xs">
          Search
          <input name="q" defaultValue={sp.q ?? ""} placeholder="WO number or product" className="min-h-[44px] rounded-[14px] border border-line-strong bg-surface px-3.5 text-[14px]" />
        </label>
        <button className="min-h-[44px] rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2" type="submit">Filter</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No work orders match" action={ctx.can("production.work_order.create") ? <LinkButton href="/production/work-orders/new">Create a work order</LinkButton> : undefined}>
          A work order says what to make, how much, when and on which line. Batches are created from it once it is planned.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-2.5 md:hidden">
            {rows.map((r) => (
              <Link key={r.id} href={`/production/work-orders/${r.id}`} className="block rounded-[16px] border border-line bg-surface p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[13px] font-semibold">{r.workOrderNumber}</span>
                  <StatusChip status={r.status} label={WORD[r.status]} />
                </div>
                <p className="mt-1 text-[14px] font-medium">{r.productName}</p>
                <p className="text-[12px] text-muted">
                  {r.batchCount} × {fmtMass(r.batchSizeBase)} · {fmtDate(r.plannedStart)} – {fmtDate(r.plannedEnd)}
                </p>
                {r.releasedWithShortage && <div className="mt-1"><Chip tone="warn">Released with shortage</Chip></div>}
              </Link>
            ))}
          </div>
          <Card className="hidden p-0 sm:p-0 md:block">
            <Table head={["Work order", "Product", "Batches", "Quantity", "Line", "Planned", "Status"]}>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2/60">
                  <Td>
                    <Link href={`/production/work-orders/${r.id}`} className="whitespace-nowrap font-mono font-semibold text-primary-text hover:underline">{r.workOrderNumber}</Link>
                  </Td>
                  <Td>{r.productName}</Td>
                  <Td className="whitespace-nowrap">{r.batchesTotal} of {r.batchCount} created · {r.batchesStarted} started</Td>
                  <Td className="whitespace-nowrap">{fmtMass(r.qtyPlannedBase)}</Td>
                  <Td>{r.lineCode ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{fmtDate(r.plannedStart)} – {fmtDate(r.plannedEnd)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <StatusChip status={r.status} label={WORD[r.status]} />
                      {r.releasedWithShortage && <Chip tone="warn">Shortage</Chip>}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

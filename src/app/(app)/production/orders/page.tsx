import Link from "next/link";
import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtMass } from "@/lib/qty";
import { listProductionOrders, PRODUCTION_ORDER_LABEL, PRODUCTION_ORDER_STATUSES } from "@/modules/production";
import { EmptyState, LinkButton, PageHeader, cx } from "@/ui/core";
import { Help } from "@/ui/help/help";
import { Forbidden } from "../../forbidden";
import { OrderStatusChip } from "./parts";

export const metadata: Metadata = { title: "Production orders" };
export const dynamic = "force-dynamic";

/** Production orders (ADR-074): one card per order with its simple status. iPad-first: cards, no wide table. */
export default async function ProductionOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.work_order.view")) return <Forbidden what="production orders" />;
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const rows = await listProductionOrders(ctx, { status, q: sp.q });
  const filters: [string, string][] = [["open", "Open"], ...PRODUCTION_ORDER_STATUSES.map((s): [string, string] => [s, PRODUCTION_ORDER_LABEL[s]]), ["all", "All"]];
  return (
    <div>
      <PageHeader
        title="Production orders"
        subtitle={`${ctx.currentSite.name} · what to make, from ordering to done`}
        actions={
          <>
            <Help screen="production.production_order" />
            {ctx.can("production.daily_log.view") && <LinkButton href="/production/defects" variant="secondary">Defects</LinkButton>}
            {ctx.can("production.work_order.create") && <LinkButton href="/production/orders/new" variant="cta">New production order</LinkButton>}
          </>
        }
      />
      <nav className="mb-4 flex gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1" aria-label="Filter by status">
        {filters.map(([k, label]) => (
          <Link key={k} href={`?status=${k}`} aria-current={k === status ? "page" : undefined} className={cx("min-h-[40px] whitespace-nowrap rounded-full px-4 py-2 text-[14px] font-medium", k === status ? "bg-primary text-white" : "text-fg hover:bg-surface-2")}>
            {label}
          </Link>
        ))}
      </nav>
      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <input type="hidden" name="status" value={status} />
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[13px] font-medium sm:max-w-sm">
          Search
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Order number or product" className="min-h-[44px] rounded-[14px] border border-line-strong bg-surface px-3.5 text-[14px]" />
        </label>
        <button className="min-h-[44px] rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2" type="submit">Search</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No production orders here" action={ctx.can("production.work_order.create") ? <LinkButton href="/production/orders/new">Create a production order</LinkButton> : undefined}>
          A production order says what to make, how much and when. Approve it, start it, record each day, and finish it.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <Link key={r.id} href={`/production/orders/${r.id}`} className="block min-w-0 rounded-[18px] border border-line bg-surface p-4 hover:shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[13px] font-semibold">{r.number}</span>
                <OrderStatusChip status={r.status} label={r.statusLabel} />
              </div>
              <p className="mt-1.5 text-[16px] font-medium">{r.productName}</p>
              <p className="text-[13px] text-muted">
                {fmtMass(r.quantityG)}
                {r.batchCount > 1 ? ` in ${r.batchCount} batches` : ""} · {fmtDate(r.plannedStart)}
                {r.plannedEnd !== r.plannedStart ? ` – ${fmtDate(r.plannedEnd)}` : ""}
              </p>
            </Link>
          ))}
        </div>
      )}
      <p className="mt-6 text-[13px] text-muted">
        Need the detailed view? <Link href="/production/work-orders" className="underline">Work orders</Link> and the <Link href="/production/board" className="underline">board</Link> show the same orders with every step.
      </p>
    </div>
  );
}

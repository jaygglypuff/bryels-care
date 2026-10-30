import Link from "next/link";
import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { listProductionOrderBoard, listProductionOrders, PRODUCTION_ORDER_LABEL, type ProductionOrderRow } from "@/modules/production";
import { EmptyState, LinkButton, PageHeader, cx } from "@/ui/core";
import { Help } from "@/ui/help/help";
import { Forbidden } from "../../forbidden";
import { ActionButton, NeededBy, OrderStatusChip, OrderWarning } from "./parts";

export const metadata: Metadata = { title: "Production orders" };
export const dynamic = "force-dynamic";

/** Status pills (ADR-080 §1): Open first, then the five statuses; Failed, Cancelled and All under More details. */
const MAIN_FILTERS: [string, string][] = [
  ["open", "Open"],
  ["draft", PRODUCTION_ORDER_LABEL.draft],
  ["approved", PRODUCTION_ORDER_LABEL.approved],
  ["in_progress", PRODUCTION_ORDER_LABEL.in_progress],
  ["quality_check", PRODUCTION_ORDER_LABEL.quality_check],
  ["done", PRODUCTION_ORDER_LABEL.done],
];
const MORE_FILTERS: [string, string][] = [
  ["failed", PRODUCTION_ORDER_LABEL.failed],
  ["cancelled", PRODUCTION_ORDER_LABEL.cancelled],
  ["all", "All"],
];

function OrderCard({ r }: { r: ProductionOrderRow }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[18px] border border-line bg-surface p-4">
      <Link href={`/production/orders/${r.id}`} className="block min-w-0 hover:underline">
        <p className="text-[18px] font-semibold leading-snug">{r.productName}</p>
      </Link>
      <p className="text-[14px] text-fg-2">
        <span className="font-medium text-fg">{r.piecesText}</span>
        {r.piecesWord === "made" ? " made" : ""}
        <span className="ml-2 font-mono text-[12px] text-muted">{r.number}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <OrderStatusChip status={r.status} label={r.statusLabel} subtitle={r.subtitle} warn={r.warn} />
        <OrderWarning text={r.warning} />
        {r.batchesNote && <span className="text-[13px] text-muted">{r.batchesNote}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <NeededBy date={r.neededBy} late={r.late} />
        {r.salesOrderNumber && <span className="text-[13px] text-muted">For {r.salesOrderNumber}</span>}
        {/* ADR-082: who makes it */}
        <span className={cx("rounded-full px-2.5 py-0.5 text-[12.5px] font-medium", r.assignedToMe ? "bg-primary-soft text-primary-text" : "bg-surface-2 text-fg-2")}>
          {r.assignedToMe ? "Assigned to you" : r.assigneeName ? `Assigned to ${r.assigneeName}` : "Anyone can take it"}
        </span>
      </div>
      <div className="mt-auto pt-1">
        <ActionButton a={r.nextAction} size="md" />
        {r.nextAction.kind === "none" && (
          <Link href={`/production/orders/${r.id}`} className="text-[14px] font-medium text-primary-text underline">
            Open
          </Link>
        )}
      </div>
    </div>
  );
}

/** Production orders (ADR-074, ADR-080): one card per order with status v2, pieces, needed-by and one next-action button. iPad-first: cards, no wide table. */
export default async function ProductionOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; view?: string; mine?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.work_order.view")) return <Forbidden what="production orders" />;
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const canCreate = ctx.can("production.work_order.create");
  const operator = !canCreate && !ctx.can("production.work_order.approve");
  const board = sp.view === "board" && !operator;
  // ADR-082: operators see their own orders and the unassigned ones unless they ask for all.
  const mine = sp.mine === "1" || (operator && sp.mine !== "0");
  const rows = board ? [] : await listProductionOrders(ctx, { status, q: sp.q, mine });
  const columns = board ? await listProductionOrderBoard(ctx) : [];
  const moreActive = MORE_FILTERS.some(([k]) => k === status);
  return (
    <div>
      <PageHeader
        title={operator ? "My work" : "Production orders"}
        subtitle={`${ctx.currentSite.name} · what to make, from ordering to done`}
        actions={
          <>
            <Help screen="production.production_order" />
            {!operator && (
              <LinkButton href={board ? "/production/orders" : "/production/orders?view=board"} variant="secondary">
                {board ? "List" : "Board"}
              </LinkButton>
            )}
            {canCreate && <LinkButton href="/production/orders/new" variant="cta">New order</LinkButton>}
          </>
        }
      />
      {board ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {columns.map((c) => (
            <section key={c.key} className="min-w-0 rounded-[18px] bg-surface-2/60 p-2.5" aria-label={c.label}>
              <h2 className="mb-2 px-1.5 text-[14px] font-semibold">
                {c.label} <span className="font-normal text-muted">({c.rows.length})</span>
              </h2>
              {c.rows.length === 0 && <p className="px-1.5 pb-2 text-[13px] text-muted">Nothing here.</p>}
              {"groups" in c && c.groups
                ? c.groups.map((g) =>
                    g.rows.length > 0 ? (
                      <div key={g.label} className="mb-2">
                        <h3 className="mb-1.5 px-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">{g.label}</h3>
                        <div className="space-y-2">{g.rows.map((r) => <OrderCard key={r.id} r={r} />)}</div>
                      </div>
                    ) : null,
                  )
                : <div className="space-y-2">{c.rows.map((r) => <OrderCard key={r.id} r={r} />)}</div>}
            </section>
          ))}
        </div>
      ) : (
        <>
          <nav className="mb-3 flex flex-wrap gap-1.5" aria-label="Whose orders">
            {[["1", operator ? "Mine and open" : "Mine and unassigned"], ["0", "Everyone's"]].map(([v, label]) => {
              const active = (v === "1") === mine;
              return (
                <Link key={v} href={`?status=${status}&mine=${v}`} aria-current={active ? "page" : undefined} className={cx("min-h-[44px] whitespace-nowrap rounded-full border px-4 py-2.5 text-[14px] font-medium", active ? "border-transparent bg-cta text-white" : "border-line bg-surface text-fg-2 hover:bg-surface-2")}>
                  {label}
                </Link>
              );
            })}
          </nav>
          <nav className="mb-3 flex flex-wrap gap-1.5" aria-label="Filter by status">
            {MAIN_FILTERS.map(([k, label]) => (
              <Link key={k} href={`?status=${k}${mine !== operator ? `&mine=${mine ? 1 : 0}` : ""}`} aria-current={k === status ? "page" : undefined} className={cx("min-h-[48px] whitespace-nowrap rounded-full border px-4 py-3 text-[14px] font-medium", k === status ? "border-transparent bg-primary text-white" : "border-line bg-surface text-fg hover:bg-surface-2")}>
                {label}
              </Link>
            ))}
          </nav>
          <details className="mb-4 rounded-[14px] border border-line bg-surface-2/40 px-3.5 py-1" open={moreActive || !!sp.q}>
            <summary className="min-h-[44px] cursor-pointer py-2.5 text-[14px] font-medium">More details</summary>
            <div className="flex flex-col gap-3 pb-3">
              <nav className="flex flex-wrap gap-1.5" aria-label="More filters">
                {MORE_FILTERS.map(([k, label]) => (
                  <Link key={k} href={`?status=${k}`} aria-current={k === status ? "page" : undefined} className={cx("min-h-[44px] whitespace-nowrap rounded-full border px-4 py-2.5 text-[14px] font-medium", k === status ? "border-transparent bg-primary text-white" : "border-line bg-surface text-fg hover:bg-surface-2")}>
                    {label}
                  </Link>
                ))}
              </nav>
              <form className="flex flex-wrap items-end gap-2" method="get">
                <input type="hidden" name="status" value={status} />
                <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[13px] font-medium sm:max-w-sm">
                  Search
                  <input name="q" defaultValue={sp.q ?? ""} placeholder="Order number or product" className="min-h-[44px] rounded-[14px] border border-line-strong bg-surface px-3.5 text-[14px]" />
                </label>
                <button className="min-h-[44px] rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2" type="submit">Search</button>
              </form>
            </div>
          </details>
          {rows.length === 0 ? (
            status === "open" && !sp.q ? (
              operator ? (
                <EmptyState title="Nothing to make right now">Orders assigned to you, and approved orders nobody has taken yet, appear here.</EmptyState>
              ) : (
                <EmptyState title="No production orders yet" action={canCreate ? <LinkButton href="/production/orders/new">New order</LinkButton> : undefined}>
                  A production order says what to make, how many and by when. Approve it, make it, write each day, and finish it.
                </EmptyState>
              )
            ) : (
              <EmptyState title="No orders here" action={<LinkButton href="/production/orders" variant="secondary">Show all open</LinkButton>}>
                No production order matches this filter.
              </EmptyState>
            )
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((r) => (
                <OrderCard key={r.id} r={r} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listOrders, orderCounts, orderDaysLate, ordersAwaitingApproval, salesBusinessDate } from "@/modules/sales";
import { Plus, Search } from "lucide-react";
import { Card, EmptyState, Input, Kpi, LinkButton, PageHeader, Table, Td, buttonClass, cx } from "@/ui/core";
import { Banner } from "@/ui/status";
import { LateChip, Money, SalesStatus, linesSummary } from "./orders/sales-ui";
import { Forbidden } from "../forbidden";
import { Help } from "@/ui/help/help";

export const metadata = { title: "Customer orders" };

const TABS = [
  { key: "", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "pending_approval", label: "Pending approval" },
  { key: "confirmed", label: "Confirmed" },
  { key: "allocated", label: "Stock reserved" },
  { key: "shipped", label: "Shipped" },
] as const;

/** The list shows the newest orders (W4F load test, docs/load-test-report.md §5); the order report and the export cover the rest. */
const LIST_LIMIT = 200;

export default async function SalesOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.sales_order.view")) return <Forbidden what="customer orders" />;
  const { status = "", q = "" } = await searchParams;
  const active = TABS.some((t) => t.key === status) ? status : "";
  const query = q.trim().slice(0, 200);
  // The sales module searches on the server (orderSearchWords): every word must match the customer,
  // a product on the order, or the order number.
  const [orders, counts, awaiting] = await Promise.all([listOrders(ctx, active || undefined, LIST_LIMIT, { q: query }), orderCounts(ctx), ordersAwaitingApproval(ctx)]);
  const withQ = (href: string) => (query ? `${href}${href.includes("?") ? "&" : "?"}q=${encodeURIComponent(query)}` : href);
  const mine = awaiting.filter((a) => a.siteId === ctx.currentSiteId);
  const today = salesBusinessDate();
  const late = new Map(orders.map((o) => [o.id, orderDaysLate(o, today)]));
  const lateCount = [...late.values()].filter((d) => d > 0).length;

  return (
    <>
      <PageHeader
        title="Customer orders"
        subtitle={ctx.currentSite.name}
        actions={
          <>
            <Help screen="sales.order" />
            <LinkButton href="/sales/board" variant="secondary">Board</LinkButton>
            {ctx.can("sales.sales_order.create") ? (
              <LinkButton href="/sales/new" variant="cta">
                <Plus size={16} aria-hidden /> New customer order
              </LinkButton>
            ) : null}
          </>
        }
      />
      {ctx.can("sales.sales_order.approve") && mine.length > 0 && (
        <div className="mb-4">
          <Banner tone="warn" title={`${mine.length} order${mine.length === 1 ? "" : "s"} waiting for approval`} action={<LinkButton href="/sales?status=pending_approval" variant="secondary" size="sm">Review</LinkButton>}>
            {mine.slice(0, 3).map((a) => `${a.orderNumber} ${a.customerName}: ${a.reasons.map((r) => r.message.toLowerCase()).join(", ")}`).join(" · ")}
          </Banner>
        </div>
      )}

      {lateCount > 0 && (
        <div className="mb-4">
          <Banner tone="bad" title={`${lateCount} order${lateCount === 1 ? " is" : "s are"} late`}>
            The customer asked for delivery before today and the goods have not been shipped yet. Late orders are marked in red below.
          </Banner>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Draft" value={counts.draft ?? 0} hint={`${counts.pending_approval ?? 0} pending approval`} href="/sales?status=draft" />
        <Kpi label="Confirmed" value={counts.confirmed ?? 0} hint="Stock not yet reserved" tone={(counts.confirmed ?? 0) > 0 ? "warn" : "neutral"} href="/sales?status=confirmed" />
        <Kpi label="Stock reserved" value={counts.allocated ?? 0} hint="Ready to pick" href="/sales?status=allocated" />
        <Kpi label="Shipped" value={counts.shipped ?? 0} hint="Sent to the customer" tone="good" href="/sales?status=shipped" />
      </div>

      <form role="search" action="/sales" className="mb-3 flex gap-2">
        {active && <input type="hidden" name="status" value={active} />}
        <div className="relative min-w-0 flex-1 sm:max-w-[420px]">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" name="q" defaultValue={query} placeholder="Customer, product or order number" aria-label="Search customer orders" className="pl-10" />
        </div>
        <button type="submit" className={buttonClass("secondary", "md")}>
          Search
        </button>
        {query && (
          <Link href={active ? `/sales?status=${active}` : "/sales"} className={buttonClass("ghost", "md")}>
            Clear
          </Link>
        )}
      </form>

      <nav aria-label="Filter by status" className="mb-4 flex gap-1 overflow-x-auto rounded-[12px] border border-line bg-surface p-1">
        {TABS.map((t) => {
          const n = t.key ? (counts[t.key] ?? 0) : counts.all;
          const isActive = t.key === active;
          return (
            <Link
              key={t.key || "all"}
              href={withQ(t.key ? `/sales?status=${t.key}` : "/sales")}
              aria-current={isActive ? "page" : undefined}
              className={cx(
                "inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[13px] font-medium",
                isActive ? "bg-primary-soft text-primary-text" : "text-fg-2 hover:bg-surface-2",
              )}
            >
              {t.label}
              {/* Tab counts are the site's totals; while searching they would not match the list, so they are hidden. */}
              {!query && <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular text-muted">{n}</span>}
            </Link>
          );
        })}
      </nav>

      {query && (
        <p className="mb-2 text-[13px] text-muted" role="status">
          {orders.length === 0 ? "No orders" : `${orders.length} ${orders.length === 1 ? "order" : "orders"}`} matching “{query}”
          {active ? ` with status ${(TABS.find((t) => t.key === active)?.label ?? active).toLowerCase()}` : ""}.
        </p>
      )}
      {orders.length >= LIST_LIMIT && <p className="mb-2 text-[13px] text-muted">Showing the newest {LIST_LIMIT} orders. Filter by status, or use the order report for the full list.</p>}
      {orders.length === 0 ? (
        <EmptyState
          title={query ? "No orders match your search" : active ? `No ${(TABS.find((t) => t.key === active)?.label ?? active).toLowerCase()} orders` : "No customer orders yet"}
          action={ctx.can("sales.sales_order.create") ? <LinkButton href="/sales/new">Create an order</LinkButton> : undefined}
        >
          {query ? "Try fewer or other words: a customer name, a product, or an order number." : <>Orders for {ctx.currentSite.name} appear here. Switch site in the top bar to see other sites.</>}
        </EmptyState>
      ) : (
        <>
          {/* Phone and tablet: cards (a seven-column table does not fit below 1024 px). */}
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden">
            {orders.map((o) => {
              const daysLate = late.get(o.id) ?? 0;
              return (
                <li key={o.id} className="min-w-0">
                  <Link href={`/sales/${o.id}`} className="block h-full">
                    <Card className="flex h-full flex-col gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="whitespace-nowrap font-semibold text-fg">{o.orderNumber}</span>
                        <SalesStatus status={o.status} />
                      </div>
                      <p className="text-[15px] font-medium text-fg">{o.customerName}</p>
                      <p className="text-[13px] text-fg-2">{linesSummary(o.lines)}</p>
                      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-[13px] tabular">
                        <span className="inline-flex flex-wrap items-center gap-2 text-muted">
                          Deliver by {fmtDate(o.requestedDeliveryOn)}
                          <LateChip days={daysLate} />
                        </span>
                        <Money className="font-semibold text-fg" value={o.value} />
                      </div>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
          {/* Desktop: table */}
          <Table className="hidden lg:block" head={["Order", "Customer", "Deliver by", "Products", "Value", "Status"]}>
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-surface-2">
                <Td className="whitespace-nowrap">
                  <Link href={`/sales/${o.id}`} className="font-medium text-primary-text hover:underline">
                    {o.orderNumber}
                  </Link>
                  {o.customerPoNumber && <span className="block text-[12px] text-muted" title="Customer PO number">{o.customerPoNumber}</span>}
                </Td>
                <Td>{o.customerName}</Td>
                <Td>
                  <span className="whitespace-nowrap">{fmtDate(o.requestedDeliveryOn)}</span>
                  {(late.get(o.id) ?? 0) > 0 && (
                    <span className="mt-1 block">
                      <LateChip days={late.get(o.id) ?? 0} />
                    </span>
                  )}
                </Td>
                <Td className="text-fg-2">{linesSummary(o.lines)}</Td>
                <Td className="whitespace-nowrap font-medium">
                  <Money value={o.value} />
                </Td>
                <Td>
                  <SalesStatus status={o.status} />
                </Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}

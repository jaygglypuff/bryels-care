import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listOrders, orderCounts, orderDaysLate, ordersAwaitingApproval, salesBusinessDate } from "@/modules/sales";
import { Plus, Search } from "lucide-react";
import { EmptyState, Input, Kpi, LinkButton, PageHeader, buttonClass } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { LateChip, Money, SalesStatus, linesSummary } from "./orders/sales-ui";
import { Forbidden } from "../forbidden";
import { Help } from "@/ui/help/help";

export const metadata = { title: "Customer orders" };

const TABS = [
  { key: "", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "pending_approval", label: "Waiting for approval" },
  { key: "confirmed", label: "Confirmed" },
  { key: "allocated", label: "Set aside" },
  { key: "shipped", label: "Sent out" },
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
  const canCreate = ctx.can("sales.sales_order.create");
  const tabLabel = (TABS.find((t) => t.key === active)?.label ?? active).toLowerCase();

  return (
    <>
      <PageHeader
        title="Customer orders"
        subtitle={ctx.currentSite.name}
        actions={
          <>
            {canCreate ? (
              <LinkButton href="/sales/new" variant="cta">
                <Plus size={16} aria-hidden /> New customer order
              </LinkButton>
            ) : null}
            <MoreMenu>
              <div className="flex flex-col gap-2">
                <LinkButton href="/sales/board" variant="secondary">See orders as a board</LinkButton>
                <Help screen="sales.order" />
              </div>
            </MoreMenu>
          </>
        }
      />
      <PageIntro>This screen is for the orders customers give us: who ordered what, by when, and where each order is now. Tap an order to see what to do next.</PageIntro>
      {ctx.can("sales.sales_order.approve") && mine.length > 0 && (
        <div className="mb-4">
          <Banner tone="warn" title={`${mine.length} order${mine.length === 1 ? "" : "s"} waiting for your approval`} action={<LinkButton href="/sales?status=pending_approval" variant="secondary" size="sm">Look at them</LinkButton>}>
            {mine.slice(0, 3).map((a) => `${a.customerName}: ${a.reasons.map((r) => r.message.toLowerCase()).join(", ")}`).join(" · ")}
          </Banner>
        </div>
      )}

      {lateCount > 0 && (
        <div className="mb-4">
          <Banner tone="bad" title={`${lateCount} order${lateCount === 1 ? " is" : "s are"} late`}>
            The customer wanted it before today and it has not been sent out yet. Late orders are marked in red below.
          </Banner>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Draft" value={counts.draft ?? 0} hint={`${counts.pending_approval ?? 0} waiting for approval`} href="/sales?status=draft" />
        <Kpi label="Confirmed" value={counts.confirmed ?? 0} hint="Stock not set aside yet" tone={(counts.confirmed ?? 0) > 0 ? "warn" : "neutral"} href="/sales?status=confirmed" />
        <Kpi label="Set aside" value={counts.allocated ?? 0} hint="Ready to get from shelf" href="/sales?status=allocated" />
        <Kpi label="Sent out" value={counts.shipped ?? 0} hint="On the way or delivered" tone="good" href="/sales?status=shipped" />
      </div>

      <form role="search" action="/sales" className="mb-3 flex flex-wrap gap-2">
        {active && <input type="hidden" name="status" value={active} />}
        <div className="relative min-w-0 flex-1 basis-[220px] sm:max-w-[420px]">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" name="q" defaultValue={query} placeholder="Customer or product name" aria-label="Search customer orders" className="pl-10" />
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

      {/* Tab counts are the site's totals; while searching they would not match the list, so they are hidden. */}
      <FilterTabs
        label="Filter by status"
        active={active}
        tabs={TABS.map((t) => [t.key, query ? t.label : `${t.label} (${t.key ? (counts[t.key] ?? 0) : counts.all})`, withQ(t.key ? `/sales?status=${t.key}` : "/sales")] as const)}
      />

      {query && (
        <p className="mb-2 text-[13px] text-muted" role="status">
          {orders.length === 0 ? "No orders" : `${orders.length} ${orders.length === 1 ? "order" : "orders"}`} matching “{query}”{active ? ` (${tabLabel})` : ""}.
        </p>
      )}
      {orders.length >= LIST_LIMIT && <p className="mb-2 text-[13px] text-muted">Showing the newest {LIST_LIMIT} orders. Choose a status above to see others.</p>}
      {orders.length === 0 ? (
        <EmptyState
          title={query ? "No orders match your search" : active ? `No orders here (${tabLabel})` : "No customer orders yet"}
          action={canCreate ? <LinkButton href="/sales/new">New customer order</LinkButton> : undefined}
        >
          {query
            ? "Try fewer or other words: part of the customer's name or a product."
            : canCreate
              ? <>When a customer orders, tap New customer order. Orders for {ctx.currentSite.name} show here (switch site in the top bar for others).</>
              : <>Orders for {ctx.currentSite.name} show here. The sales team enters them; ask them if one is missing.</>}
        </EmptyState>
      ) : (
        <PlainList label="Customer orders">
          {orders.map((o) => {
            const daysLate = late.get(o.id) ?? 0;
            return (
              <PlainRow
                key={o.id}
                href={`/sales/${o.id}`}
                title={o.customerName}
                code={o.orderNumber}
                status={
                  <>
                    <SalesStatus status={o.status} />
                    <LateChip days={daysLate} />
                  </>
                }
                tone={daysLate > 0 ? "bad" : undefined}
                facts={
                  <>
                    {linesSummary(o.lines)} · deliver by {fmtDate(o.requestedDeliveryOn)}
                  </>
                }
                aside={<Money className="text-[15px] font-semibold tabular text-fg" value={o.value} />}
              />
            );
          })}
        </PlainList>
      )}
    </>
  );
}

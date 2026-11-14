import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listOrders, orderCounts, orderDaysLate, ordersAwaitingApproval, salesBusinessDate } from "@/modules/sales";
import { Plus } from "lucide-react";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { CellCode, DataTable, ListToolbar, MobileRow, TableFooter, Tabs, ToolbarSearch, readSort, sortRows, type Column } from "@/ui/kit";
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

export default async function SalesOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; sort?: string; dir?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.sales_order.view")) return <Forbidden what="customer orders" permission="sales.sales_order.view" />;
  const sp = await searchParams;
  const { status = "", q = "" } = sp;
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

  const sort = readSort(sp, ["number", "customer", "deliver", "value"], { key: "", dir: "desc" });
  const sorted =
    sort.key === "number" ? sortRows(orders, sort.dir, (o) => o.orderNumber)
    : sort.key === "customer" ? sortRows(orders, sort.dir, (o) => o.customerName)
    : sort.key === "deliver" ? sortRows(orders, sort.dir, (o) => o.requestedDeliveryOn)
    : sort.key === "value" ? sortRows(orders, sort.dir, (o) => o.value ?? null)
    : orders;
  const listHref = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ status: active || undefined, q: query || undefined, sort: sort.key || undefined, dir: sort.key ? sort.dir : undefined, ...over })) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/sales?${qs}` : "/sales";
  };
  const columns: Column<(typeof orders)[number]>[] = [
    { key: "number", header: "Order", sortable: true, cell: (o) => <CellCode>{o.orderNumber}</CellCode>, className: "w-[1%]" },
    { key: "customer", header: "Customer", sortable: true, primary: true, cell: (o) => o.customerName },
    { key: "what", header: "What they ordered", hideBelow: "lg", cell: (o) => <span className="text-fg-2">{linesSummary(o.lines)}</span> },
    { key: "status", header: "Status", cell: (o) => <span className="inline-flex flex-wrap items-center gap-1"><SalesStatus status={o.status} /><LateChip days={late.get(o.id) ?? 0} /></span> },
    { key: "deliver", header: "Deliver by", sortable: true, cell: (o) => <span className="whitespace-nowrap text-fg-2">{fmtDate(o.requestedDeliveryOn)}</span> },
    { key: "value", header: "Value", sortable: true, align: "right", cell: (o) => <Money className="font-medium text-fg" value={o.value} /> },
  ];

  return (
    <>
      <PageHeader
        title="Customer orders"
        subtitle={`${ctx.currentSite.name} · ${counts.all ?? 0} ${counts.all === 1 ? "order" : "orders"}`}
        actions={
          <>
            <MoreMenu>
              <div className="flex flex-col gap-2">
                <LinkButton href="/sales/board" variant="secondary">See orders as a board</LinkButton>
                <Help screen="sales.order" />
              </div>
            </MoreMenu>
            {canCreate ? (
              <LinkButton href="/sales/new" variant="cta">
                <Plus size={16} aria-hidden /> New customer order
              </LinkButton>
            ) : null}
          </>
        }
      />
      {/* ADR-136: this sentence is shown in the "?" panel (About this screen) where the frame has its Help button. */}
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

      {/* ADR-136: one toolbar: status tabs with their counts (no stat cards repeating them) and the search box. */}
      <ListToolbar
        tabs={
          <Tabs
            bare
            label="Filter by status"
            active={active}
            // Tab counts are the site's totals; while searching they would not match the list, so they are hidden.
            items={TABS.map((t) => ({ key: t.key, label: t.label, href: withQ(t.key ? `/sales?status=${t.key}` : "/sales"), count: query ? null : t.key ? (counts[t.key] ?? 0) : counts.all }))}
          />
        }
      >
        <ToolbarSearch action="/sales" keep={{ status: active || undefined }} defaultValue={query} placeholder="Customer or product name" label="Search customer orders" clearHref={active ? `/sales?status=${active}` : "/sales"} />
      </ListToolbar>

      {query && (
        <p className="mb-2 text-[13px] text-muted" role="status">
          {orders.length === 0 ? "No orders" : `${orders.length} ${orders.length === 1 ? "order" : "orders"}`} matching “{query}”{active ? ` (${tabLabel})` : ""}.
        </p>
      )}
      {orders.length === 0 ? (
        <EmptyState
          title={query ? "No orders match your search" : active ? `No orders here (${tabLabel})` : "No customer orders yet"}
          action={canCreate ? <LinkButton href="/sales/new">New customer order</LinkButton> : undefined}
        >
          {query
            ? "Try fewer or other words: part of the customer's name or a product."
            : canCreate
              ? <>When a customer orders, press New customer order. Orders for {ctx.currentSite.name} show here, with who ordered what, by when and where each order is now (switch site in the top bar for others).</>
              : <>Orders for {ctx.currentSite.name} show here. The sales team enters them; ask them if one is missing.</>}
        </EmptyState>
      ) : (
        <DataTable
          label="Customer orders"
          testId="sales-orders"
          rows={sorted}
          columns={columns}
          rowKey={(o) => o.id}
          rowHref={(o) => `/sales/${o.id}`}
          rowTone={(o) => ((late.get(o.id) ?? 0) > 0 ? "bad" : null)}
          sort={{ key: sort.key, dir: sort.dir, href: (key, dir) => listHref({ sort: key, dir }) }}
          mobile={(o) => (
            <MobileRow
              href={`/sales/${o.id}`}
              title={o.customerName}
              status={<><SalesStatus status={o.status} /><LateChip days={late.get(o.id) ?? 0} /></>}
              meta={<>{linesSummary(o.lines)} · deliver by {fmtDate(o.requestedDeliveryOn)} · <span className="font-mono text-[12px] text-muted">{o.orderNumber}</span></>}
              aside={<Money value={o.value} />}
              tone={(late.get(o.id) ?? 0) > 0 ? "bad" : null}
            />
          )}
          footer={<TableFooter count={orders.length} noun={["order", "orders"]} note={orders.length >= LIST_LIMIT ? `the newest ${LIST_LIMIT}; choose a status to see others` : undefined} />}
        />
      )}
    </>
  );
}

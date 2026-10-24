import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtQty } from "@/lib/qty";
import { listOrders, orderCounts, ordersAwaitingApproval } from "@/modules/sales";
import { Card, EmptyState, Kpi, LinkButton, PageHeader, Table, Td, cx } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Money, SalesStatus } from "./orders/sales-ui";
import { Forbidden } from "../forbidden";

export const metadata = { title: "Sales orders" };

const TABS = [
  { key: "", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "pending_approval", label: "Pending approval" },
  { key: "confirmed", label: "Confirmed" },
  { key: "allocated", label: "Allocated" },
  { key: "shipped", label: "Shipped" },
] as const;

export default async function SalesOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.sales_order.view")) return <Forbidden what="sales orders" />;
  const { status = "" } = await searchParams;
  const active = TABS.some((t) => t.key === status) ? status : "";
  const [orders, counts, awaiting] = await Promise.all([listOrders(ctx, active || undefined), orderCounts(ctx), ordersAwaitingApproval(ctx)]);
  const mine = awaiting.filter((a) => a.siteId === ctx.currentSiteId);

  return (
    <>
      <PageHeader
        title="Sales orders"
        subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name} · draft → submitted → confirmed (or pending approval) → allocated → shipped`}
        actions={
          <>
            <LinkButton href="/sales/board" variant="secondary">Board</LinkButton>
            {ctx.can("sales.sales_order.create") ? <LinkButton href="/sales/new" variant="cta">New order</LinkButton> : null}
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

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Draft" value={counts.draft ?? 0} hint={`${counts.pending_approval ?? 0} pending approval`} href="/sales?status=draft" />
        <Kpi label="Confirmed" value={counts.confirmed ?? 0} hint="Waiting for allocation" tone={(counts.confirmed ?? 0) > 0 ? "warn" : "neutral"} href="/sales?status=confirmed" />
        <Kpi label="Allocated" value={counts.allocated ?? 0} hint="Ready to pick and dispatch" href="/sales?status=allocated" />
        <Kpi label="Shipped" value={counts.shipped ?? 0} hint="Delivery receipt issued" tone="good" href="/sales?status=shipped" />
      </div>

      <nav aria-label="Filter by status" className="mb-4 flex gap-1 overflow-x-auto rounded-[12px] border border-line bg-surface p-1">
        {TABS.map((t) => {
          const n = t.key ? (counts[t.key] ?? 0) : counts.all;
          const isActive = t.key === active;
          return (
            <Link
              key={t.key || "all"}
              href={t.key ? `/sales?status=${t.key}` : "/sales"}
              aria-current={isActive ? "page" : undefined}
              className={cx(
                "inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[13px] font-medium",
                isActive ? "bg-primary-soft text-primary-text" : "text-fg-2 hover:bg-surface-2",
              )}
            >
              {t.label}
              <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular text-muted">{n}</span>
            </Link>
          );
        })}
      </nav>

      {orders.length === 0 ? (
        <EmptyState
          title={active ? `No ${active} orders` : "No sales orders yet"}
          action={ctx.can("sales.sales_order.create") ? <LinkButton href="/sales/new">Create an order</LinkButton> : undefined}
        >
          Orders for {ctx.currentSite.name} appear here. Switch site in the top bar to see other sites.
        </EmptyState>
      ) : (
        <>
          {/* Phone: cards */}
          <ul className="flex flex-col gap-3 sm:hidden">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/sales/${o.id}`}>
                  <Card className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-fg">{o.orderNumber}</span>
                      <SalesStatus status={o.status} />
                    </div>
                    <p className="text-[14px] text-fg">{o.customerName}</p>
                    <p className="text-[12px] text-muted">
                      {o.lines.map((l) => `${l.sku} × ${fmtQty(l.qty, "", 0)}`).join(" · ")}
                    </p>
                    <div className="flex justify-between text-[13px] tabular">
                      <span className="text-muted">Deliver {fmtDate(o.requestedDeliveryOn)}</span>
                      <Money className="font-medium" value={o.value} />
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          {/* Tablet / desktop: table */}
          <Table className="hidden sm:block" head={["Order", "Customer", "PO number", "Requested delivery", "Lines", "Value", "Status"]}>
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-surface-2">
                <Td>
                  <Link href={`/sales/${o.id}`} className="font-medium text-primary-text hover:underline">
                    {o.orderNumber}
                  </Link>
                </Td>
                <Td>{o.customerName}</Td>
                <Td>{o.customerPoNumber ?? "—"}</Td>
                <Td>{fmtDate(o.requestedDeliveryOn)}</Td>
                <Td className="text-fg-2">{o.lines.map((l) => `${l.sku} × ${fmtQty(l.qty, "", 0)}`).join(", ")}</Td>
                <Td className="font-medium">
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

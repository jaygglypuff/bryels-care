import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import type { AuthContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import type { Customer360 } from "@/modules/sales";
import { Card, Dl, LinkButton, cx } from "@/ui/core";
import { Money, OrderChip, SalesStatus } from "../orders/sales-ui";

export type PanelTab = "orders" | "history" | "details";
export const PANEL_TABS: { key: PanelTab; label: string }[] = [
  { key: "orders", label: "Orders" },
  { key: "history", label: "What happened" },
  { key: "details", label: "Details" },
];

const RECENT = 5;

/**
 * The right side of the customers split view (mockup panel 6): the selected customer with Orders /
 * History / Details, totals and recent orders. Read only; every figure comes from `getCustomer360`
 * (site-scoped orders, masked prices) and `customerOutstanding` (invoices, finance only).
 */
export function CustomerPanel({
  ctx,
  d,
  outstanding,
  tab,
  hrefFor,
  backHref,
}: {
  ctx: AuthContext;
  d: Customer360;
  outstanding: string | undefined;
  tab: PanelTab;
  hrefFor: (tab: PanelTab) => string;
  backHref: string;
}) {
  const c = d.customer;
  const seesOrders = ctx.can("sales.sales_order.view");
  const last = d.orders.reduce<Date | null>((m, o) => (!m || o.createdAt > m ? o.createdAt : m), null);
  const since = new Date(c.createdAt).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "Asia/Manila" });
  // History: the orders placed plus the changes on the customer record, newest first.
  const history = [
    ...d.orders.map((o) => ({ id: `o-${o.id}`, at: new Date(o.createdAt), text: `Order ${o.orderNumber} entered`, sub: null as string | null, href: `/sales/${o.id}` })),
    ...d.history.map((h) => ({ id: h.id, at: new Date(h.occurredAt), text: plainAction(h.action), sub: h.actor, href: null as string | null })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 25);

  return (
    <Card className="min-w-0">
      <Link href={backHref} className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 text-[14px] font-medium text-primary-text hover:underline lg:hidden">
        <ArrowLeft size={16} aria-hidden /> All customers
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[22px] font-semibold leading-tight text-fg">{c.name}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span>Customer since {since}</span>
            <SalesStatus status={c.status} />
            <span className="font-mono text-[12px] text-muted">{c.code}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ctx.can("sales.sales_order.create") && (
            <LinkButton href={`/sales/new?customer=${c.id}`} variant="cta">
              <Plus size={16} aria-hidden /> New order for this customer
            </LinkButton>
          )}
          <LinkButton href={`/sales/customers/${c.id}`} variant="secondary">
            See everything
          </LinkButton>
        </div>
      </div>

      <nav aria-label="Customer sections" className="mt-4 flex gap-1 border-b border-line">
        {PANEL_TABS.map((t) => (
          <Link
            key={t.key}
            href={hrefFor(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={cx("-mb-px inline-flex min-h-[44px] items-center border-b-2 px-3 text-[14px] font-medium", tab === t.key ? "border-primary text-primary-text" : "border-transparent text-fg-2 hover:text-fg")}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "orders" && (
        <div className="mt-4">
          {!seesOrders ? (
            <p className="text-[14px] text-muted">Your role does not include customer orders.</p>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-2">
                <Total label="Total orders" value={d.orders.length.toLocaleString("en-PH")} />
                <Total label="Owes us" value={outstanding === undefined ? <span className="text-[13px] font-normal text-muted">Finance only</span> : <Money value={outstanding} />} />
                <Total label="Last order" value={last ? fmtDate(last) : "—"} />
              </dl>
              <h3 className="mt-5 text-[15px] font-semibold text-fg">Recent orders</h3>
              {d.orders.length === 0 ? (
                <p className="mt-2 text-[14px] text-muted">No orders yet. Tap &quot;New order for this customer&quot; when they order.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line rounded-[14px] border border-line">
                  {[...d.orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, RECENT).map((o) => (
                    <li key={o.id}>
                      <Link href={`/sales/${o.id}`} className="flex min-h-[52px] flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 hover:bg-surface-2">
                        <span className="min-w-0">
                          <span className="font-medium text-fg">{fmtDate(o.createdAt)}</span>
                          <span className="block font-mono text-[12px] text-muted">{o.orderNumber}</span>
                        </span>
                        <span className="flex items-center gap-3">
                          <Money className="font-medium tabular" value={o.value} />
                          <OrderChip status={o.status} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {d.orders.length > 0 && (
                <LinkButton href={`/sales?q=${encodeURIComponent(c.name)}`} variant="secondary" className="mt-3 w-full">
                  View all orders
                </LinkButton>
              )}
            </>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="mt-4">
          {history.length === 0 ? (
            <p className="text-[14px] text-muted">Nothing recorded yet.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {history.map((h) => (
                <li key={h.id} className="border-l-2 border-line pl-3 text-[14px]">
                  {h.href ? (
                    <Link href={h.href} className="font-medium text-primary-text hover:underline">
                      {h.text}
                    </Link>
                  ) : (
                    <span className="font-medium text-fg">{h.text}</span>
                  )}
                  <span className="block text-[12px] text-muted">
                    {fmtDateTime(h.at)}
                    {h.sub ? ` · ${h.sub}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {tab === "details" && (
        <div className="mt-4">
          <Dl
            items={[
              ["Phone", c.phone ?? "—"],
              ["Deliver to", c.shipToAddress],
              ["Contact person", c.contactName ?? "—"],
              ["E-mail", c.email ?? "—"],
              ["Shortest shelf life allowed", `${c.minShelfLifeDays} days left when sent out`],
              ["Customer number", c.code],
              ...(d.credit
                ? ([
                    ["Most they may owe", <Money key="l" value={d.credit.limit} />],
                    ["Days to pay", d.credit.paymentTermsDays != null ? `${d.credit.paymentTermsDays} days` : "—"],
                  ] as [string, React.ReactNode][])
                : []),
            ]}
          />
          <p className="mt-3 text-[13px] text-muted">
            Addresses, contacts, special rules and prices are on{" "}
            <Link href={`/sales/customers/${c.id}`} className="font-medium text-primary-text hover:underline">
              the customer page
            </Link>
            .
          </p>
        </div>
      )}
    </Card>
  );
}

function Total({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[14px] border border-line bg-surface p-3">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="mt-1 break-words text-[16px] font-semibold tabular text-fg sm:text-[18px]">{value}</dd>
    </div>
  );
}

/** "sales.customer.credit_terms_changed" → "Credit terms changed". */
function plainAction(action: string): string {
  const s = action.split(".").slice(2).join(" ").replace(/_/g, " ") || action;
  const entity = action.split(".")[1]?.replace(/_/g, " ") ?? "";
  const text = entity && entity !== "customer" ? `${entity} ${s}` : s;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

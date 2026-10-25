import Link from "next/link";
import { fmtDate } from "@/lib/qty";
import { listPortalDocuments, listPortalOrders, requirePortalContext } from "@/modules/portal";
import { Card, CardTitle, EmptyState, Kpi, LinkButton, PageHeader } from "@/ui/core";
import { OrderCards } from "./portal-ui";

export const metadata = { title: "Customer portal" };

const OPEN = new Set(["draft", "submitted", "pending_approval", "confirmed", "allocated", "picking", "packed", "partially_shipped"]);
const REVIEW = new Set(["draft", "submitted", "pending_approval"]);

/** Portal home: what is open, what is under review, the latest orders and documents. */
export default async function PortalHome() {
  const ctx = await requirePortalContext();
  const orders = ctx.can("portal.order.view") ? await listPortalOrders(ctx, { limit: 50 }) : [];
  const allDocs = ctx.can("portal.document.view") || ctx.can("portal.quote.view") ? await listPortalDocuments(ctx) : [];
  const docs = allDocs.slice(0, 4);
  const open = orders.filter((o) => OPEN.has(o.status));
  const review = orders.filter((o) => REVIEW.has(o.status));
  const last = orders[0];
  return (
    <>
      <PageHeader
        title={`Hello, ${ctx.displayName.split(" ")[0]}`}
        subtitle={`${ctx.customerName} · customer portal`}
        actions={
          ctx.can("portal.order.create") ? (
            <>
              {last && (
                <LinkButton href={`/portal/order?from=${last.id}`} variant="secondary">
                  Reorder {last.orderNumber}
                </LinkButton>
              )}
              <LinkButton href="/portal/order" variant="cta">
                Place an order
              </LinkButton>
            </>
          ) : null
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi label="Open orders" value={open.length} href="/portal/orders" />
        <Kpi label="Under review" value={review.length} hint={review.length ? "Bryel's Care is checking these" : "Nothing waiting"} tone={review.length ? "warn" : "good"} href="/portal/orders" />
        <div className="col-span-2 sm:col-span-1">
          <Kpi label="Documents" value={allDocs.length} hint="Quotations and delivery receipts" href="/portal/documents" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardTitle action={<Link href="/portal/orders" className="text-[13px] font-medium text-primary-text hover:underline">All orders</Link>}>Latest orders</CardTitle>
          {orders.length === 0 ? (
            <EmptyState title="No orders yet" action={ctx.can("portal.order.create") ? <LinkButton href="/portal/order">Place your first order</LinkButton> : undefined}>
              Orders you place here, and orders our sales team enters for you, appear in this list.
            </EmptyState>
          ) : (
            <OrderCards orders={orders.slice(0, 5)} />
          )}
        </Card>
        <Card>
          <CardTitle action={<Link href="/portal/documents" className="text-[13px] font-medium text-primary-text hover:underline">All documents</Link>}>Latest documents</CardTitle>
          {docs.length === 0 ? (
            <p className="text-[13px] text-muted">No documents yet. Delivery receipts appear when an order is dispatched; quotations when our sales team sends one.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {docs.map((d) => (
                <li key={`${d.kind}:${d.id}`} className="py-2">
                  <Link href={d.href} className="font-medium text-primary-text hover:underline">
                    {d.title}
                  </Link>
                  <span className="block text-[12px] text-muted">
                    {fmtDate(d.date)}
                    {d.reference ? ` · ${d.reference}` : ""}
                    {d.statusLabel ? ` · ${d.statusLabel}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

import { listPortalOrders, requirePortalContext } from "@/modules/portal";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { OrderCards } from "../portal-ui";

export const metadata = { title: "My orders" };

/** Order status tracking (US-8-02): every order of the customer, newest first. */
export default async function PortalOrdersPage() {
  const ctx = await requirePortalContext();
  if (!ctx.can("portal.order.view")) {
    return (
      <>
        <PageHeader title="My orders" />
        <Banner tone="info" title="Your portal account cannot see orders">Ask your Bryel&apos;s Care sales representative.</Banner>
      </>
    );
  }
  const orders = await listPortalOrders(ctx);
  return (
    <>
      <PageHeader
        title="My orders"
        subtitle={`${ctx.customerName} · orders placed here and orders our sales team entered for you`}
        actions={ctx.can("portal.order.create") ? <LinkButton href="/portal/order" variant="cta">Place an order</LinkButton> : null}
      />
      {orders.length === 0 ? (
        <EmptyState title="No orders yet" action={ctx.can("portal.order.create") ? <LinkButton href="/portal/order">Place your first order</LinkButton> : undefined}>
          When you place an order it appears here with its status: under review, confirmed, being prepared, shipped.
        </EmptyState>
      ) : (
        <OrderCards orders={orders} />
      )}
    </>
  );
}

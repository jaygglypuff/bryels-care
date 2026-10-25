import { DomainError } from "@/lib/errors";
import { manilaToday } from "@/modules/sales";
import { portalAddresses, portalCatalogue, reorderCart, requirePortalContext } from "@/modules/portal";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { OrderForm } from "./order-form";

export const metadata = { title: "Place an order" };

/**
 * Place an order (US-8-02): the approved catalogue with the customer's prices; `?from=<order>` prefills
 * the quantities of an earlier order (reorder from history) at today's prices. The server prices every
 * line again from the approved price lists; nothing typed here can change a price.
 */
export default async function PortalOrderPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const ctx = await requirePortalContext();
  if (!ctx.can("portal.order.create") || !ctx.can("portal.catalog.view")) {
    return (
      <>
        <PageHeader title="Place an order" />
        <Banner tone="info" title="Your portal account can view orders but not place them">
          Ask your Bryel&apos;s Care sales representative if you should be able to order here.
        </Banner>
      </>
    );
  }
  const { from } = await searchParams;
  const [catalogue, addresses] = await Promise.all([portalCatalogue(ctx), portalAddresses(ctx)]);
  let prefill: Awaited<ReturnType<typeof reorderCart>> | null = null;
  let prefillMissing = false;
  if (from) {
    try {
      prefill = await reorderCart(ctx, from);
    } catch (e) {
      if (!(e instanceof DomainError && e.code === "not_found")) throw e;
      prefillMissing = true;
    }
  }
  return (
    <>
      <PageHeader title={prefill ? `Reorder ${prefill.fromOrderNumber}` : "Place an order"} subtitle="Your approved products at your agreed prices. Bryel's Care confirms every order; some need a review first." />
      {prefillMissing && (
        <div className="mb-4">
          <Banner tone="warn" title="That order could not be found">Start a new order below.</Banner>
        </div>
      )}
      {prefill && prefill.unavailable.length > 0 && (
        <div className="mb-4">
          <Banner tone="warn" title="Some products are no longer in your catalogue">
            {prefill.unavailable.map((u) => `${u.sku} ${u.name}`).join(", ")}. Contact your sales representative about them.
          </Banner>
        </div>
      )}
      {catalogue.length === 0 ? (
        <EmptyState title="Your catalogue is empty" action={<LinkButton href="/portal" variant="secondary">Back to home</LinkButton>}>
          No products are approved for ordering in the portal yet. Your Bryel&apos;s Care sales representative sets up your catalogue and prices.
        </EmptyState>
      ) : (
        <OrderForm
          catalogue={catalogue}
          addresses={addresses}
          today={manilaToday()}
          prefill={prefill ? Object.fromEntries(prefill.lines.map((l) => [l.productId, l.qty])) : {}}
        />
      )}
    </>
  );
}

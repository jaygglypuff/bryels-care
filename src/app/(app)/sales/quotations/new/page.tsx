import { requireContext } from "@/lib/auth/context";
import { getSetting } from "@/lib/settings";
import { db } from "@/db/client";
import { canSeePrices, customerOptions, manilaToday, priceBook, quoteProductOptions } from "@/modules/sales";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import type { PriceBooks } from "../../new/order-form";
import { QuoteForm } from "../quote-form";

export const metadata = { title: "New price offer" };

const plus = (d: string, n: number) => {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.quote.create")) return <Forbidden what="making price offers" />;
  if (!canSeePrices(ctx)) return <Forbidden what="price offers (they show prices)" />;
  const { customer } = await searchParams;
  const [customers, products, days] = await Promise.all([customerOptions(ctx), quoteProductOptions(ctx), getSetting(db, ctx.organizationId, "sales.quote.validity_days")]);
  const books: PriceBooks = {};
  for (const c of customers) books[c.id] = await priceBook(ctx, c.id);
  const today = manilaToday();
  return (
    <>
      <PageHeader title="New price offer" subtitle={ctx.currentSite.name} actions={<LinkButton href="/sales/quotations" variant="ghost">Back to price offers</LinkButton>} />
      <PageIntro>This screen is for a price offer (quotation) to a customer. Choose the customer and the products; the usual prices fill in. You can give a lower price; a big discount needs approval.</PageIntro>
      {customers.length === 0 ? (
        <EmptyState title="No customers yet" action={ctx.can("masterdata.customer.create") ? <LinkButton href="/sales/customers/new">New customer</LinkButton> : undefined}>
          Add the customer first (name, phone and address), then come back here.
        </EmptyState>
      ) : (
        <QuoteForm customers={customers} products={products} priceBooks={books} today={today} defaultValidUntil={plus(today, days)} initialCustomerId={customers.some((c) => c.id === customer) ? customer : undefined} />
      )}
    </>
  );
}

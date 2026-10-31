import { requireContext } from "@/lib/auth/context";
import { canSeePrices, customerOptions, manilaToday, priceBook, productAvailability } from "@/modules/sales";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../forbidden";
import { NewOrderForm, type PriceBooks } from "./order-form";
import { Help } from "@/ui/help/help";

export const metadata = { title: "New customer order" };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.sales_order.create")) return <Forbidden what="entering customer orders" />;
  const { customer } = await searchParams;
  const [customers, products] = await Promise.all([customerOptions(ctx), productAvailability(ctx)]);
  const prices = canSeePrices(ctx);
  const books: PriceBooks = {};
  if (prices) for (const c of customers) books[c.id] = await priceBook(ctx, c.id);
  return (
    <>
      <PageHeader title="New customer order" subtitle={ctx.currentSite.name} actions={<><LinkButton href="/sales" variant="ghost">Back to orders</LinkButton><Help screen="sales.order" /></>} />
      <PageIntro>This screen is for a new order from a customer, in three steps: who it is for, which products, then check and save. The usual prices fill in by themselves.</PageIntro>
      {customers.length === 0 ? (
        <EmptyState title="No customers yet" action={ctx.can("masterdata.customer.create") ? <LinkButton href="/sales/customers/new">New customer</LinkButton> : undefined}>
          Add the customer first (name, phone and address), then come back here.
        </EmptyState>
      ) : products.length === 0 ? (
        <EmptyState title="No products yet">Products are added under Master data → Products. Ask the owner or the person who sets up products.</EmptyState>
      ) : (
        <NewOrderForm
          customers={customers}
          products={products}
          today={manilaToday()}
          initialCustomerId={customers.some((c) => c.id === customer) ? customer : undefined}
          siteName={ctx.currentSite.name}
          priceBooks={books}
          pricesVisible={prices}
        />
      )}
    </>
  );
}

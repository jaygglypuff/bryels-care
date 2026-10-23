import { requireContext } from "@/lib/auth/context";
import { customerOptions, manilaToday, productAvailability } from "@/modules/sales";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { NewOrderForm } from "./order-form";

export const metadata = { title: "New order" };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.sales_order.create")) return <Forbidden what="creating sales orders" />;
  const { customer } = await searchParams;
  const [customers, products] = await Promise.all([customerOptions(ctx), productAvailability(ctx)]);
  return (
    <>
      <PageHeader title="New order" subtitle={`Creates a draft order at ${ctx.currentSite.code} · ${ctx.currentSite.name}. Confirm it on the next screen.`} />
      {customers.length === 0 ? (
        <EmptyState title="No customers yet" action={ctx.can("masterdata.customer.create") ? <LinkButton href="/sales/customers/new">Add a customer</LinkButton> : undefined}>
          Add the customer before entering an order.
        </EmptyState>
      ) : products.length === 0 ? (
        <EmptyState title="No products defined">Products are set up under Master data.</EmptyState>
      ) : (
        <NewOrderForm
          customers={customers}
          products={products}
          today={manilaToday()}
          initialCustomerId={customers.some((c) => c.id === customer) ? customer : undefined}
          siteName={ctx.currentSite.name}
        />
      )}
    </>
  );
}

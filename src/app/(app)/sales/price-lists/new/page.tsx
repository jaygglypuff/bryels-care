import { requireContext } from "@/lib/auth/context";
import { manilaToday, priceListFormOptions } from "@/modules/sales";
import { PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { PriceListForm } from "../price-list-form";

export const metadata = { title: "New price list" };

export default async function NewPriceListPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.price_list.edit")) return <Forbidden what="editing price lists" />;
  const { customer } = await searchParams;
  const opts = await priceListFormOptions(ctx);
  return (
    <>
      <PageHeader title="New price list" subtitle="Saved as a draft. Nothing applies until finance or the owner approves it." />
      <PriceListForm customers={opts.customers} products={opts.products} today={manilaToday()} initialCustomerId={opts.customers.some((c) => c.id === customer) ? customer : undefined} />
    </>
  );
}

import { requireContext } from "@/lib/auth/context";
import { manilaToday, priceListFormOptions } from "@/modules/sales";
import { LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { PriceListForm } from "../price-list-form";

export const metadata = { title: "Set new prices" };

export default async function NewPriceListPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.price_list.edit")) return <Forbidden what="changing prices" />;
  const { customer } = await searchParams;
  const opts = await priceListFormOptions(ctx);
  return (
    <>
      <PageHeader title="Set new prices" actions={<LinkButton href="/sales/price-lists" variant="ghost">Back to prices</LinkButton>} />
      <PageIntro>This screen is for new selling prices, for everyone or for one customer. They are saved as a draft; nothing changes until finance or the owner approves them.</PageIntro>
      <PriceListForm customers={opts.customers} products={opts.products} today={manilaToday()} initialCustomerId={opts.customers.some((c) => c.id === customer) ? customer : undefined} />
    </>
  );
}

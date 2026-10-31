import Decimal from "decimal.js";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getPriceList, manilaToday, priceListFormOptions } from "@/modules/sales";
import { LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../../forbidden";
import { PriceListForm } from "../../price-list-form";

export const metadata = { title: "Change draft prices" };

export default async function EditPriceListPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.price_list.edit")) return <Forbidden what="changing prices" />;
  const { id } = await params;
  let d: Awaited<ReturnType<typeof getPriceList>>;
  try {
    d = await getPriceList(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const pl = d.priceList;
  if (pl.status !== "draft") {
    return (
      <>
        <PageHeader title="Change prices" />
        <PageIntro>This screen is for changing draft prices. These prices are already sent or approved, so they cannot be changed here.</PageIntro>
        <Banner tone="info" title="Only a draft can be changed" action={<LinkButton href={`/sales/price-lists/${pl.id}`} variant="secondary">Back</LinkButton>}>
          Open the prices and choose ⋯ More → Start new prices from these.
        </Banner>
      </>
    );
  }
  const opts = await priceListFormOptions(ctx);
  return (
    <>
      <PageHeader title={`Change draft prices for ${d.customer?.name ?? "everyone"}`} actions={<LinkButton href={`/sales/price-lists/${pl.id}`} variant="ghost">Back</LinkButton>} />
      <PageIntro>This screen is for changing prices that are still a draft. Save, then send them for approval.</PageIntro>
      <PriceListForm
        customers={opts.customers}
        products={opts.products}
        today={manilaToday()}
        initial={{
          priceListId: pl.id,
          code: pl.code,
          name: pl.name,
          partyKind: pl.partyKind as "customer" | "general",
          customerId: pl.customerId ?? "",
          effectiveFrom: pl.effectiveFrom,
          changeSummary: pl.changeSummary ?? "",
          lines: d.lines.map((l) => ({ productId: l.productId, minQtyUnits: String(Number(l.minQtyUnits)), unitAmount: new Decimal(l.unitAmount).toFixed(2) })),
        }}
      />
    </>
  );
}

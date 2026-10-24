import Decimal from "decimal.js";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getPriceList, manilaToday, priceListFormOptions } from "@/modules/sales";
import { LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../../forbidden";
import { PriceListForm } from "../../price-list-form";

export const metadata = { title: "Edit price list" };

export default async function EditPriceListPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.price_list.edit")) return <Forbidden what="editing price lists" />;
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
        <PageHeader title={`${pl.code} v${pl.versionNo}`} />
        <Banner tone="info" title="Only a draft can be edited" action={<LinkButton href={`/sales/price-lists/${pl.id}`} variant="secondary">Back</LinkButton>}>
          Start a new version from the list page to change approved prices.
        </Banner>
      </>
    );
  }
  const opts = await priceListFormOptions(ctx);
  return (
    <>
      <PageHeader title={`Edit ${pl.code} v${pl.versionNo}`} subtitle="Draft version." actions={<LinkButton href={`/sales/price-lists/${pl.id}`} variant="secondary">Back</LinkButton>} />
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

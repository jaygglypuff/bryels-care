import Decimal from "decimal.js";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { customerOptions, getQuote, manilaToday, priceBook, quoteProductOptions } from "@/modules/sales";
import { LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../../forbidden";
import { QuoteForm } from "../../quote-form";

export const metadata = { title: "Change price offer" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.quote.edit") || !ctx.can("sales.quote.create")) return <Forbidden what="changing price offers" />;
  const { id } = await params;
  let d: Awaited<ReturnType<typeof getQuote>>;
  try {
    d = await getQuote(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const q = d.quote;
  if (q.status !== "draft") {
    return (
      <>
        <PageHeader title="Change price offer" />
        <PageIntro>This screen is for changing a draft price offer. This one was already sent, so it cannot be changed.</PageIntro>
        <Banner tone="info" title="Only a draft can be changed" action={<LinkButton href={`/sales/quotations/${q.id}`} variant="secondary">Back</LinkButton>}>
          Cancel it (⋯ More) and make a new price offer if the prices changed.
        </Banner>
      </>
    );
  }
  const [customers, products] = await Promise.all([customerOptions(ctx), quoteProductOptions(ctx)]);
  const book = await priceBook(ctx, q.customerId);
  return (
    <>
      <PageHeader title={`Change price offer for ${d.customer.name}`} actions={<LinkButton href={`/sales/quotations/${q.id}`} variant="ghost">Back</LinkButton>} />
      <PageIntro>This screen is for changing a draft price offer: products, amounts and prices. Save, then send it.</PageIntro>
      <QuoteForm
        customers={customers.filter((c) => c.id === q.customerId)}
        products={products}
        priceBooks={{ [q.customerId]: book }}
        today={manilaToday()}
        defaultValidUntil={q.validUntil}
        initial={{
          quoteId: q.id,
          customerId: q.customerId,
          validUntil: q.validUntil,
          shipToAddressId: q.shipToAddressId ?? "",
          notesCustomer: q.notesCustomer ?? "",
          notesInternal: q.notesInternal ?? "",
          lines: d.lines.map((l) => ({ productId: l.productId, qtyUnits: new Decimal(l.qtyUnits).toString(), unitPrice: l.unitAmount && l.listUnitAmount && new Decimal(l.unitAmount).eq(l.listUnitAmount) ? "" : l.unitAmount ? new Decimal(l.unitAmount).toFixed(2) : "" })),
        }}
      />
    </>
  );
}

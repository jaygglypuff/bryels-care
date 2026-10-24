import Decimal from "decimal.js";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { customerOptions, getQuote, manilaToday, priceBook, quoteProductOptions } from "@/modules/sales";
import { LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../../forbidden";
import { QuoteForm } from "../../quote-form";

export const metadata = { title: "Edit quotation" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.quote.edit") || !ctx.can("sales.quote.create")) return <Forbidden what="editing quotations" />;
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
        <PageHeader title={`Edit ${q.quoteNumber}`} />
        <Banner tone="info" title="Only a draft can be edited" action={<LinkButton href={`/sales/quotations/${q.id}`} variant="secondary">Back</LinkButton>}>
          Void it and issue a new quotation if the terms changed.
        </Banner>
      </>
    );
  }
  const [customers, products] = await Promise.all([customerOptions(ctx), quoteProductOptions(ctx)]);
  const book = await priceBook(ctx, q.customerId);
  return (
    <>
      <PageHeader title={`Edit ${q.quoteNumber}`} actions={<LinkButton href={`/sales/quotations/${q.id}`} variant="secondary">Back</LinkButton>} />
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

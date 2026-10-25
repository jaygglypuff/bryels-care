import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { creditNoteReasons, creditableReturns, getInvoice } from "@/modules/finance";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { Money } from "../../finance-ui";
import { CreditNoteForm } from "./credit-note-form";

export const metadata = { title: "New credit note" };

export default async function NewCreditNotePage({ searchParams }: { searchParams: Promise<{ invoiceId?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.credit_note.create")) return <Forbidden what="credit notes" />;
  const { invoiceId } = await searchParams;
  if (!invoiceId) {
    return (
      <>
        <PageHeader title="New credit note" />
        <EmptyState title="Choose the invoice first" action={<LinkButton href="/finance/invoices?status=issued">Open issued invoices</LinkButton>}>
          A credit note always belongs to one issued invoice.
        </EmptyState>
      </>
    );
  }
  let d: Awaited<ReturnType<typeof getInvoice>>;
  try {
    d = await getInvoice(ctx, invoiceId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const i = d.invoice;
  const returns = await creditableReturns(ctx, i.id);
  const reasons = await creditNoteReasons(ctx.organizationId);
  const canVoid = Number(i.paidAmount) === 0 && Number(i.creditedAmount) === 0;
  return (
    <>
      <PageHeader title={`Credit note for ${i.invoiceNumber ?? "invoice"}`} subtitle={d.customer.name} actions={<LinkButton href={`/finance/invoices/${i.id}`} variant="secondary">Back to invoice</LinkButton>} />
      {!["issued", "partially_paid"].includes(i.status) ? (
        <EmptyState title="This invoice cannot take a credit">Only an issued invoice with an open amount can be credited.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <CreditNoteForm invoiceId={i.id} reasons={reasons} returns={returns.map((r) => ({ id: r.id, label: `${r.returnNumber} (${r.status})` }))} canVoid={canVoid} />
          <Card>
            <CardTitle>Invoice</CardTitle>
            <Dl items={[["Total", <Money key="t" value={i.totalAmount} />], ["Open", <Money key="o" value={i.openAmount} />], ["Tax", <Money key="x" value={i.taxAmount} />]]} />
            <p className="mt-3 text-[12px] text-muted">The tax share of a credit is pro rata to the invoice&apos;s tax (placeholder treatment for the accountant to confirm).</p>
          </Card>
        </div>
      )}
    </>
  );
}

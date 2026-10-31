import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { creditNoteReasons, creditableReturns, getInvoice } from "@/modules/finance";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { Money } from "../../finance-ui";
import { CreditNoteForm } from "./credit-note-form";

export const metadata = { title: "Give a credit (money back)" };

/** New credit note on one sent invoice: why and how much; the credit number is made when it is saved to the books. */
export default async function NewCreditNotePage({ searchParams }: { searchParams: Promise<{ invoiceId?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.credit_note.create")) return <Forbidden what="credits (money back)" />;
  const { invoiceId } = await searchParams;
  if (!invoiceId) {
    return (
      <>
        <PageHeader title="Give a credit (money back)" />
        <PageIntro>This screen is for lowering what a customer owes on one invoice. Open the invoice first.</PageIntro>
        <EmptyState title="Pick the invoice first" action={<LinkButton href="/finance/invoices?status=issued">Invoices not paid yet</LinkButton>}>
          A credit always belongs to one sent invoice. Open it and choose ⋯ More → “Give a credit (money back)”.
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
      <PageHeader title={`Money back for ${d.customer.name}`} subtitle={`On invoice ${i.invoiceNumber ?? "—"}`} actions={<LinkButton href={`/finance/invoices/${i.id}`} variant="secondary">Back to the invoice</LinkButton>} />
      <PageIntro>This screen is for lowering what {d.customer.name} owes on this invoice: say why and how much. A second person approves it, then finance saves it to the books.</PageIntro>
      {!["issued", "partially_paid"].includes(i.status) ? (
        <EmptyState title="This invoice cannot get a credit" action={<LinkButton href={`/finance/invoices/${i.id}`} variant="secondary">Back to the invoice</LinkButton>}>
          Only an invoice that was sent and is not fully paid can get money back. Ask finance if this looks wrong.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <CreditNoteForm invoiceId={i.id} reasons={reasons} returns={returns.map((r) => ({ id: r.id, label: `Return ${r.returnNumber} (${r.status})` }))} canVoid={canVoid} openAmount={i.openAmount} />
          <Card>
            <CardTitle>The invoice</CardTitle>
            <Dl items={[["Total", <Money key="t" value={i.totalAmount} />], ["Still to pay", <Money key="o" value={i.openAmount} />], ["Tax in it", <Money key="x" value={i.taxAmount} />]]} />
            <p className="mt-3 text-[13px] text-muted">The tax part of a credit follows the invoice&apos;s tax share (for the accountant to confirm).</p>
          </Card>
        </div>
      )}
    </>
  );
}

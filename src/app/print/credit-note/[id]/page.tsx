import { notFound } from "next/navigation";
import { Logo } from "@/ui/brand";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtMoney } from "@/lib/qty";
import { getCreditNote } from "@/modules/finance";
import { EmptyState } from "@/ui/core";
import { PrintButton } from "../../delivery-receipt/[shipmentId]/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Credit note" };

const COMPANY = { address: "Lot 7 Sampaguita Road, North Fields Industrial Park, Laguna (demo address)", phone: "+63 2 8000 0000 (demo)" };

/** Printable credit note (US-6-12; printed once issued, so the figures are posted and immutable). */
export default async function CreditNotePrint({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.credit_note.view"))
    return (
      <main className="mx-auto max-w-xl p-6">
        <EmptyState title="You don't have access">Printing a credit note needs the credit note view permission.</EmptyState>
      </main>
    );
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d: Awaited<ReturnType<typeof getCreditNote>>;
  try {
    d = await getCreditNote(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const c = d.creditNote;
  if (!c.creditNoteNumber) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <EmptyState title="Not issued yet">A credit note can be printed once it is issued.</EmptyState>
      </main>
    );
  }
  return (
    <main className="min-h-dvh bg-[#e9e7e1] py-6 print:bg-white print:py-0">
      <style>{`@page { size: A4 portrait; margin: 15mm; }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3 px-4">
        <a href={`/finance/credit-notes/${c.id}`} className="text-[14px] text-primary-text hover:underline">
          ← Back to {c.creditNoteNumber}
        </a>
        <PrintButton />
      </div>
      <article className="print-page relative mx-auto w-full max-w-[210mm] bg-white p-[15mm] text-[12px] leading-snug text-black shadow-sm print:p-0 print:shadow-none">
        {c.status === "voided" && <p className="pointer-events-none absolute inset-x-0 top-[40%] text-center text-[64px] font-bold tracking-widest text-black/10">VOIDED</p>}
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-4">
          <div>
            <Logo tagline className="mb-2 h-[48px] w-auto" />
            <p>{COMPANY.address}</p>
            <p>{COMPANY.phone}</p>
          </div>
          <div className="text-right">
            <p className="text-[18px] font-bold uppercase tracking-wide">Credit note</p>
            <p className="mt-1 text-[14px] font-semibold">{c.creditNoteNumber}</p>
            <p>Date: {fmtDate(c.issueDate)}</p>
            <p>Against invoice {d.invoice.invoiceNumber}</p>
          </div>
        </header>
        <section className="border-b border-black py-4">
          <p className="text-[10px] font-bold uppercase tracking-wide">Customer</p>
          <p className="text-[13px] font-semibold">{d.customer.name}</p>
          <p>{d.customer.address}</p>
        </section>
        <table className="mt-4 w-full border-collapse">
          <tbody>
            <tr className="border-b border-[#ccc]">
              <td className="py-2 pr-2">
                {d.reasonLabel}: {c.reason}
                {d.customerReturn ? ` (return ${d.customerReturn.number})` : ""}
              </td>
              <td className="py-2 text-right">{fmtMoney(D(c.amount).minus(c.taxAmount))}</td>
            </tr>
            {Number(c.taxAmount) > 0 && (
              <tr>
                <td className="py-1 pr-2 text-right">Tax share</td>
                <td className="py-1 text-right">{fmtMoney(c.taxAmount)}</td>
              </tr>
            )}
            <tr>
              <td className="py-1 pr-2 text-right text-[13px] font-bold">Total credited ({c.currency})</td>
              <td className="py-1 text-right text-[13px] font-bold">{fmtMoney(c.amount)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-6 text-[10px] text-[#555]">Credit note issued by the operational system; its statutory treatment is confirmed by the company&apos;s accountant. Demo document — fictional data.</p>
      </article>
    </main>
  );
}

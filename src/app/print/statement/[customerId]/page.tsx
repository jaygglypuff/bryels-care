import { notFound } from "next/navigation";
import { Logo } from "@/ui/brand";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtMoney } from "@/lib/qty";
import { AGING_BUCKETS, AGING_LABEL, customerStatement } from "@/modules/finance";
import { EmptyState } from "@/ui/core";
import { PrintButton } from "../../delivery-receipt/[shipmentId]/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Statement of account" };

const COMPANY = { address: "Lot 7 Sampaguita Road, North Fields Industrial Park, Laguna (demo address)", phone: "+63 2 8000 0000 (demo)" };

/** Printable open-item statement of account (US-6-10 R-05; finance.invoice.export). */
export default async function StatementPrint({ params, searchParams }: { params: Promise<{ customerId: string }>; searchParams: Promise<{ asOf?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.invoice.export"))
    return (
      <main className="mx-auto max-w-xl p-6">
        <EmptyState title="You don't have access">Printing statements needs the invoice export permission.</EmptyState>
      </main>
    );
  const { customerId } = await params;
  const { asOf } = await searchParams;
  let st: Awaited<ReturnType<typeof customerStatement>>;
  try {
    st = await customerStatement(ctx, customerId, { asOf });
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  return (
    <main className="min-h-dvh bg-[#e9e7e1] py-6 print:bg-white print:py-0">
      <style>{`@page { size: A4 portrait; margin: 15mm; } @media print { thead { display: table-header-group; } tr { break-inside: avoid; } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3 px-4">
        <a href={`/finance/statements/${st.customer.id}?asOf=${st.asOf}`} className="text-[14px] text-primary-text hover:underline">
          ← Back to the statement
        </a>
        <PrintButton />
      </div>
      <article className="print-page mx-auto w-full max-w-[210mm] bg-white p-[15mm] text-[12px] leading-snug text-black shadow-sm print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-4">
          <div>
            <Logo tagline className="mb-2 h-[48px] w-auto" />
            <p>{COMPANY.address}</p>
            <p>{COMPANY.phone}</p>
          </div>
          <div className="text-right">
            <p className="text-[18px] font-bold uppercase tracking-wide">Statement of account</p>
            <p className="mt-1">As of {fmtDate(st.asOf)}</p>
          </div>
        </header>
        <section className="border-b border-black py-4">
          <p className="text-[13px] font-semibold">{st.customer.name}</p>
          <p>{st.customer.address}</p>
          {st.customer.contactName && <p>Attn: {st.customer.contactName}</p>}
        </section>
        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1.5 pr-2">Invoice</th>
              <th className="py-1.5 pr-2">Date</th>
              <th className="py-1.5 pr-2">Due</th>
              <th className="py-1.5 pr-2 text-right">Total</th>
              <th className="py-1.5 pr-2 text-right">Paid / credited</th>
              <th className="py-1.5 text-right">Open</th>
            </tr>
          </thead>
          <tbody>
            {st.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-3 text-center">
                  No open invoices.
                </td>
              </tr>
            ) : (
              st.items.map((i) => (
                <tr key={i.id} className="border-b border-[#ccc]">
                  <td className="py-1.5 pr-2">{i.invoiceNumber}</td>
                  <td className="py-1.5 pr-2">{fmtDate(i.issueDate)}</td>
                  <td className="py-1.5 pr-2">
                    {fmtDate(i.dueDate)}
                    {i.daysOverdue ? ` (${i.daysOverdue} days overdue)` : ""}
                  </td>
                  <td className="py-1.5 pr-2 text-right">{fmtMoney(i.total)}</td>
                  <td className="py-1.5 pr-2 text-right">{fmtMoney(i.paid)}</td>
                  <td className="py-1.5 text-right">{fmtMoney(i.open)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              {AGING_BUCKETS.map((b) => (
                <th key={b} className="py-1.5 pr-2 text-right">
                  {AGING_LABEL[b]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {AGING_BUCKETS.map((b) => (
                <td key={b} className="py-1.5 pr-2 text-right">
                  {fmtMoney(st.buckets[b])}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <div className="mt-4 ml-auto w-72">
          <p className="flex justify-between">
            <span>Total open</span>
            <span>{fmtMoney(st.totalOpen)}</span>
          </p>
          <p className="flex justify-between">
            <span>Payments on account</span>
            <span>− {fmtMoney(st.unappliedOnAccount)}</span>
          </p>
          <p className="flex justify-between border-t border-black pt-1 text-[13px] font-bold">
            <span>Balance due ({st.currency})</span>
            <span>{fmtMoney(st.balanceDue)}</span>
          </p>
        </div>
        <p className="mt-6 text-[10px] text-[#555]">Open-item statement from the operational system; your accountant&apos;s books remain the record. Demo document — fictional data.</p>
      </article>
    </main>
  );
}

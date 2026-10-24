import { notFound } from "next/navigation";
import { Logo } from "@/ui/brand";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/qty";
import { getQuote } from "@/modules/sales";
import { EmptyState } from "@/ui/core";
import { PrintButton } from "../../delivery-receipt/[shipmentId]/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quotation" };

/** Demo company block; the real address, TIN and statutory wording are accountant-validated configuration (A-RPT-12). */
const COMPANY = { address: "Lot 7 Sampaguita Road, North Fields Industrial Park, Laguna (demo address)", phone: "+63 2 8000 0000 (demo)" };

/** Printable quotation (US-4-04, browser print per ADR-026). Needs prices: sales.quote.view + sales.price_list.view. */
export default async function QuotationPrint({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.quote.view") || !ctx.can("sales.price_list.view"))
    return (
      <main className="mx-auto max-w-xl p-6">
        <EmptyState title="You don't have access">Printing a quotation needs quotation and price permissions.</EmptyState>
      </main>
    );
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d: Awaited<ReturnType<typeof getQuote>>;
  try {
    d = await getQuote(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const q = d.quote;
  if (!["sent", "accepted", "converted"].includes(q.status)) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <EmptyState title="Not issued yet">A quotation can be printed once it is issued (sent).</EmptyState>
      </main>
    );
  }
  return (
    <main className="min-h-dvh bg-[#e9e7e1] py-6 print:bg-white print:py-0">
      <style>{`@page { size: A4 portrait; margin: 15mm; } @media print { thead { display: table-header-group; } tr { break-inside: avoid; } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3 px-4">
        <a href={`/sales/quotations/${q.id}`} className="text-[14px] text-primary-text hover:underline">
          ← Back to {q.quoteNumber}
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
            <p className="text-[18px] font-bold uppercase tracking-wide">Quotation</p>
            <p className="mt-1 text-[14px] font-semibold">{q.quoteNumber}</p>
            <p>Date: {fmtDate(q.sentAt ?? q.createdAt)}</p>
            <p>Valid until: {fmtDate(q.validUntil)}</p>
          </div>
        </header>
        <section className="border-b border-black py-4">
          <p className="text-[10px] font-bold uppercase tracking-wide">Prepared for</p>
          <p className="text-[13px] font-semibold">{d.customer.name}</p>
          <p>{d.shipTo?.text ?? d.customer.shipToAddress}</p>
          {d.customer.contactName && <p>Attn: {d.customer.contactName}</p>}
        </section>
        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1.5 pr-2">#</th>
              <th className="py-1.5 pr-2">Item</th>
              <th className="py-1.5 pr-2 text-right">Qty</th>
              <th className="py-1.5 pr-2 text-right">Unit price</th>
              <th className="py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id} className="border-b border-[#ccc]">
                <td className="py-1.5 pr-2">{l.lineNo}</td>
                <td className="py-1.5 pr-2">
                  {l.sku} · {l.productName}
                </td>
                <td className="py-1.5 pr-2 text-right">{fmtQty(l.qtyUnits, "pcs", 0)}</td>
                <td className="py-1.5 pr-2 text-right">{fmtMoney(l.unitAmount)}</td>
                <td className="py-1.5 text-right">{fmtMoney(l.value)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="pt-2 text-right font-semibold">
                Subtotal
              </td>
              <td className="pt-2 text-right">{fmtMoney(q.subtotalAmount)}</td>
            </tr>
            {q.taxAmount && Number(q.taxAmount) > 0 && (
              <tr>
                <td colSpan={4} className="text-right">
                  Tax (rate set by the company&apos;s accountant)
                </td>
                <td className="text-right">{fmtMoney(q.taxAmount)}</td>
              </tr>
            )}
            <tr>
              <td colSpan={4} className="text-right text-[13px] font-bold">
                Total ({q.currency})
              </td>
              <td className="text-right text-[13px] font-bold">{fmtMoney(q.totalAmount)}</td>
            </tr>
          </tfoot>
        </table>
        {q.notesCustomer && <p className="mt-4">{q.notesCustomer}</p>}
        <p className="mt-6 text-[10px] text-[#555]">Prices in {q.currency}. Delivery terms, taxes and statutory wording follow the company&apos;s configured document template (to be validated by the accountant). Demo document — fictional data.</p>
      </article>
    </main>
  );
}

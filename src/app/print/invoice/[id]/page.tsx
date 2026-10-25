import { notFound } from "next/navigation";
import { Logo } from "@/ui/brand";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtMoney, fmtQty } from "@/lib/qty";
import { getInvoice } from "@/modules/finance";
import { EmptyState } from "@/ui/core";
import { PrintButton } from "../../delivery-receipt/[shipmentId]/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoice" };

/** Demo company block; the real address, TIN and statutory wording are accountant-validated configuration (A-RPT-12, A-FIN-28). */
const COMPANY = { address: "Lot 7 Sampaguita Road, North Fields Industrial Park, Laguna (demo address)", phone: "+63 2 8000 0000 (demo)" };

/**
 * Printable invoice (US-6-10, browser print per ADR-026). Printed only once issued: the posted lines and
 * amounts are immutable, so every print shows the same figures. Labelled "Billing invoice" until the
 * accountant confirms whether this document is the official tax invoice (A-FIN-28, Q-FIN-03).
 */
export default async function InvoicePrint({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.invoice.view"))
    return (
      <main className="mx-auto max-w-xl p-6">
        <EmptyState title="You don't have access">Printing an invoice needs the invoice view permission.</EmptyState>
      </main>
    );
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d: Awaited<ReturnType<typeof getInvoice>>;
  try {
    d = await getInvoice(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const i = d.invoice;
  if (!i.invoiceNumber) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <EmptyState title="Not issued yet">An invoice can be printed once it is issued (numbered and posted).</EmptyState>
      </main>
    );
  }
  return (
    <main className="min-h-dvh bg-[#e9e7e1] py-6 print:bg-white print:py-0">
      <style>{`@page { size: A4 portrait; margin: 15mm; } @media print { thead { display: table-header-group; } tr { break-inside: avoid; } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3 px-4">
        <a href={`/finance/invoices/${i.id}`} className="text-[14px] text-primary-text hover:underline">
          ← Back to {i.invoiceNumber}
        </a>
        <PrintButton />
      </div>
      <article className="print-page relative mx-auto w-full max-w-[210mm] bg-white p-[15mm] text-[12px] leading-snug text-black shadow-sm print:p-0 print:shadow-none">
        {i.status === "voided" && <p className="pointer-events-none absolute inset-x-0 top-[40%] text-center text-[64px] font-bold tracking-widest text-black/10">VOIDED</p>}
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-4">
          <div>
            <Logo tagline className="mb-2 h-[48px] w-auto" />
            <p>{COMPANY.address}</p>
            <p>{COMPANY.phone}</p>
          </div>
          <div className="text-right">
            <p className="text-[18px] font-bold uppercase tracking-wide">Billing invoice</p>
            <p className="mt-1 text-[14px] font-semibold">{i.invoiceNumber}</p>
            <p>Date: {fmtDate(i.issueDate)}</p>
            <p>Due: {fmtDate(i.dueDate)}</p>
            {i.paymentTermsDays !== null && <p>Terms: {i.paymentTermsDays} days</p>}
          </div>
        </header>
        <section className="grid grid-cols-2 gap-6 border-b border-black py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide">Bill to</p>
            <p className="text-[13px] font-semibold">{d.customer.name}</p>
            <p>{i.billToText}</p>
            {d.customer.taxIdentifier && <p>TIN: {d.customer.taxIdentifier}</p>}
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide">References</p>
            <p>Sales order {d.order.orderNumber}</p>
            {i.customerPoNumber && <p>Your PO {i.customerPoNumber}</p>}
            {d.shipment.drNumber && <p>Delivery receipt {d.shipment.drNumber}</p>}
          </div>
        </section>
        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1.5 pr-2">#</th>
              <th className="py-1.5 pr-2">Item</th>
              <th className="py-1.5 pr-2 text-right">Qty</th>
              <th className="py-1.5 pr-2 text-right">Unit price</th>
              <th className="py-1.5 pr-2 text-right">Tax</th>
              <th className="py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id} className="border-b border-[#ccc]">
                <td className="py-1.5 pr-2">{l.lineNo}</td>
                <td className="py-1.5 pr-2">{l.description}</td>
                <td className="py-1.5 pr-2 text-right">{fmtQty(l.qty, l.uom, 0)}</td>
                <td className="py-1.5 pr-2 text-right">{fmtMoney(l.unitAmount)}</td>
                <td className="py-1.5 pr-2 text-right">{l.taxCode ? `${Number(l.taxRatePct)} %` : "—"}</td>
                <td className="py-1.5 text-right">{fmtMoney(l.lineAmount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="pt-2 text-right font-semibold">
                Subtotal
              </td>
              <td className="pt-2 text-right">{fmtMoney(i.subtotalAmount)}</td>
            </tr>
            {Number(i.taxAmount) > 0 && (
              <tr>
                <td colSpan={5} className="text-right">
                  Tax (rates configured by the company&apos;s accountant)
                </td>
                <td className="text-right">{fmtMoney(i.taxAmount)}</td>
              </tr>
            )}
            <tr>
              <td colSpan={5} className="text-right text-[13px] font-bold">
                Total ({i.currency})
              </td>
              <td className="text-right text-[13px] font-bold">{fmtMoney(i.totalAmount)}</td>
            </tr>
            {(Number(i.paidAmount) > 0 || Number(i.creditedAmount) > 0) && (
              <tr>
                <td colSpan={5} className="text-right">
                  Paid and credited
                </td>
                <td className="text-right">{fmtMoney(D(i.paidAmount).plus(i.creditedAmount))}</td>
              </tr>
            )}
          </tfoot>
        </table>
        {i.notes && <p className="mt-4">{i.notes}</p>}
        <p className="mt-6 text-[10px] text-[#555]">
          Billing invoice issued by the operational system. Whether this document is the official tax invoice, its registered series and its statutory wording are confirmed by the company&apos;s accountant (configuration). Demo document — fictional data.
        </p>
      </article>
    </main>
  );
}

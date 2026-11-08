import { notFound } from "next/navigation";
import Decimal from "decimal.js";
import { Logo } from "@/ui/brand";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/qty";
import { getOrder, manilaToday } from "@/modules/sales";
import { orderCanShipFrom } from "@/modules/production";
import { EmptyState } from "@/ui/core";
import { LineName } from "@/ui/line-name";
import { PrintButton } from "../../delivery-receipt/[shipmentId]/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Order confirmation" };

/** Demo company block; the real address, TIN and statutory wording are accountant-validated configuration (A-RPT-12). */
const COMPANY = { address: "Lot 7 Sampaguita Road, North Fields Industrial Park, Laguna (demo address)", phone: "+63 2 8000 0000 (demo)" };
const CONFIRMED = ["confirmed", "allocated", "picking", "packed", "partially_shipped", "shipped", "invoiced"];

/**
 * ADR-131 (C-office problem 3): the printable order confirmation for the customer (browser print, ADR-026): what, how
 * many, price, deliver by and "Can ship from". Needs `sales.sales_order.view`; prices only for people who may see them.
 */
export default async function OrderConfirmationPrint({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.sales_order.view"))
    return (
      <main className="mx-auto max-w-xl p-6">
        <EmptyState title="You don't have access">Printing an order confirmation needs customer order permissions.</EmptyState>
      </main>
    );
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d: Awaited<ReturnType<typeof getOrder>>;
  try {
    d = await getOrder(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const o = d.order;
  if (!CONFIRMED.includes(o.status)) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <EmptyState title="Not confirmed yet">An order confirmation can be printed once the order is confirmed.</EmptyState>
      </main>
    );
  }
  const ship = await orderCanShipFrom(ctx, o.id).catch(() => null);
  const shipText = !ship ? "—" : ship.date ? (ship.date === manilaToday() ? `${fmtDate(ship.date)} (in stock)` : fmtDate(ship.date)) : "To be confirmed";
  const lines = d.lines.filter((l) => new Decimal(l.qtyUnits).gt(0));
  return (
    <main className="min-h-dvh bg-[#e9e7e1] py-6 print:bg-white print:py-0">
      <style>{`@page { size: A4 portrait; margin: 15mm; } @media print { thead { display: table-header-group; } tr { break-inside: avoid; } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3 px-4">
        <a href={`/sales/${o.id}`} className="text-[14px] text-primary-text hover:underline">
          ← Back to {o.orderNumber}
        </a>
        <PrintButton />
      </div>
      <article className="print-page mx-auto w-full max-w-[210mm] bg-white p-[15mm] text-[12px] leading-snug text-black shadow-sm print:p-0 print:shadow-none" data-testid="order-confirmation-print">
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-4">
          <div>
            <Logo tagline className="mb-2 h-[48px] w-auto" />
            <p>{COMPANY.address}</p>
            <p>{COMPANY.phone}</p>
          </div>
          <div className="text-right">
            <p className="text-[18px] font-bold uppercase tracking-wide">Order confirmation</p>
            <p className="mt-1 text-[14px] font-semibold">{o.orderNumber}</p>
            <p>Date: {fmtDate(manilaToday())}</p>
            {o.customerPoNumber && <p>Your order no.: {o.customerPoNumber}</p>}
          </div>
        </header>
        <section className="grid grid-cols-2 gap-4 border-b border-black py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide">For</p>
            <p className="text-[13px] font-semibold">{d.customer.name}</p>
            <p>{o.shipToText ?? d.customer.shipToAddress}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide">Delivery</p>
            <p>Deliver by: {fmtDate(o.requestedDeliveryOn)}</p>
            <p className="font-semibold">Can ship from: {shipText}</p>
          </div>
        </section>
        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1.5 pr-2">#</th>
              <th className="py-1.5 pr-2">Item</th>
              <th className="py-1.5 pr-2 text-right">Qty</th>
              {d.total !== undefined && <th className="py-1.5 pr-2 text-right">Unit price</th>}
              {d.total !== undefined && <th className="py-1.5 text-right">Amount</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-[#ccc]">
                <td className="py-1.5 pr-2">{l.lineNo}</td>
                <td className="py-1.5 pr-2">
                  <LineName name={l.productName} code={l.sku} print />
                </td>
                <td className="py-1.5 pr-2 text-right">{fmtQty(l.qtyUnits, "pcs", 0)}</td>
                {d.total !== undefined && <td className="py-1.5 pr-2 text-right">{l.unitPrice ? fmtMoney(l.unitPrice) : "—"}</td>}
                {d.total !== undefined && <td className="py-1.5 text-right">{l.value ? fmtMoney(l.value) : "—"}</td>}
              </tr>
            ))}
          </tbody>
          {d.total !== undefined && (
            <tfoot>
              <tr>
                <td colSpan={4} className="pt-2 text-right text-[13px] font-bold">
                  Total ({o.currency})
                </td>
                <td className="pt-2 text-right text-[13px] font-bold">{fmtMoney(d.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
        <p className="mt-6 text-[10px] text-[#555]">“Can ship from” is our best estimate today; we will tell you if it changes. Taxes and statutory wording follow the company&apos;s configured document template (to be validated by the accountant). Demo document — fictional data.</p>
      </article>
    </main>
  );
}

import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getReturnReceipt } from "@/modules/sales";
import { Logo } from "@/ui/brand";
import { EmptyState } from "@/ui/core";
import { PrintButton } from "../../delivery-receipt/[shipmentId]/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Return receipt" };

/**
 * Return receipt (W07-09 / W09-11 "Return receipt"; browser print, ADR-026): what was received back,
 * from which delivery receipt, into which quarantine lot. Customer-facing; no prices, no QA notes.
 * Wording is a placeholder for the company to confirm (A-W3F-07).
 */
export default async function ReturnReceiptPrint({ params }: { params: Promise<{ returnId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.customer_return.view"))
    return (
      <main className="mx-auto max-w-xl p-6">
        <EmptyState title="You don't have access">Your role does not include viewing customer returns.</EmptyState>
      </main>
    );
  const { returnId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(returnId)) notFound();
  let r: Awaited<ReturnType<typeof getReturnReceipt>>;
  try {
    r = await getReturnReceipt(ctx, returnId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const h = r.header;
  return (
    <main className="min-h-dvh bg-[#e9e7e1] py-6 print:bg-white print:py-0">
      <style>{`@page { size: A4 portrait; margin: 15mm; } @media print { thead { display: table-header-group; } tr { break-inside: avoid; } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3 px-4">
        <a href={`/sales/returns/${h.id}`} className="text-[14px] text-primary-text hover:underline">
          ← Back to {h.returnNumber}
        </a>
        <PrintButton />
      </div>
      <article className="print-page mx-auto w-full max-w-[210mm] bg-white p-[15mm] text-[12px] leading-snug text-black shadow-sm print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-4">
          <div>
            <Logo tagline className="mb-2 h-[48px] w-auto" />
            <p>{r.organizationName}</p>
            <p className="text-[11px]">Received at {h.siteCode}</p>
          </div>
          <div className="text-right">
            <p className="text-[18px] font-bold uppercase tracking-wide">Return receipt</p>
            <p className="mt-1 text-[14px] font-semibold">{h.returnNumber}</p>
            <p>Date: {h.receivedAt ? fmtDate(h.receivedAt) : "not yet received"}</p>
          </div>
        </header>
        <section className="grid grid-cols-2 gap-6 border-b border-black py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide">Returned by</p>
            <p className="text-[13px] font-semibold">{h.customerName}</p>
            <p>{r.customerAddress}</p>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <span className="font-bold">Delivery receipt</span>
            <span>{h.drNumber}</span>
            <span className="font-bold">Sales order</span>
            <span>{h.orderNumber ?? "—"}</span>
            <span className="font-bold">Reason</span>
            <span>{h.reasonName}</span>
            <span className="font-bold">Received</span>
            <span>{h.receivedAt ? fmtDateTime(h.receivedAt) : "—"}</span>
          </div>
        </section>
        <table className="mt-4 w-full border-collapse text-left">
          <thead>
            <tr className="border-y border-black text-[10px] uppercase">
              <th className="py-1.5 pr-2">#</th>
              <th className="py-1.5 pr-2">Product</th>
              <th className="py-1.5 pr-2">Lot shipped</th>
              <th className="py-1.5 pr-2">Box</th>
              <th className="py-1.5 pr-2">Condition</th>
              <th className="py-1.5 text-right">Quantity</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.id} className="border-b border-[#999]">
                <td className="py-1.5 pr-2">{l.lineNo}</td>
                <td className="py-1.5 pr-2">{l.productName ?? "—"}</td>
                <td className="py-1.5 pr-2 font-mono">{l.lotNumber}</td>
                <td className="py-1.5 pr-2 font-mono">{l.boxNumber ?? "—"}</td>
                <td className="py-1.5 pr-2">{l.conditionLabel}</td>
                <td className="py-1.5 text-right tabular">
                  {fmtQty(l.qtyBase, "", l.baseUom === "pcs" ? 0 : 3)} {l.baseUom}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4">The goods above were received into quarantine for inspection. Acceptance, replacement or credit follows the company&apos;s review and is confirmed separately.</p>
        <section className="mt-8 grid grid-cols-2 gap-10">
          <div>
            <p className="text-[10px] font-bold uppercase">Received by</p>
            <p className="mt-8 border-t border-black pt-1">{h.receivedByName ?? ""}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase">Customer / driver</p>
            <p className="mt-8 border-t border-black pt-1">&nbsp;</p>
          </div>
        </section>
        <footer className="mt-8 border-t border-[#999] pt-2 text-[9px] text-[#444]">
          <p>
            {h.returnNumber} · Printed {fmtDateTime(new Date())} by {ctx.displayName}. Placeholder wording pending company review (A-W3F-07).
          </p>
        </footer>
      </article>
    </main>
  );
}

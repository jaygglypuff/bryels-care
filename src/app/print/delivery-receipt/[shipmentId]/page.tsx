import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getDeliveryReceipt } from "@/modules/sales";
import { EmptyState } from "@/ui/core";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Delivery receipt" };

/** Demo company block; the real address, TIN and statutory wording are accountant-validated configuration (A-RPT-12). */
const COMPANY = { address: "Lot 7 Sampaguita Road, North Fields Industrial Park, Laguna (demo address)", phone: "+63 2 8000 0000 (demo)" };

export default async function DeliveryReceiptPrint({ params }: { params: Promise<{ shipmentId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.shipment.view"))
    return (
      <main className="mx-auto max-w-xl p-6">
        <EmptyState title="You don't have access">Your role does not include viewing delivery receipts.</EmptyState>
      </main>
    );
  const { shipmentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(shipmentId)) notFound();
  let dr: Awaited<ReturnType<typeof getDeliveryReceipt>>;
  try {
    dr = await getDeliveryReceipt(ctx, shipmentId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const { shipment: s, order, customer, site, organizationName, items, totalQty } = dr;
  const qr = await QRCode.toString(`BC:DOC:${s.deliveryReceiptNumber}`, { type: "svg", margin: 0 });

  return (
    <main className="min-h-dvh bg-[#e9e7e1] py-6 print:bg-white print:py-0">
      <style>{`
        @page { size: A4 portrait; margin: 15mm; }
        @media print { thead { display: table-header-group; } tr, .keep { break-inside: avoid; } }
      `}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3 px-4">
        <a href={`/sales/${order.id}`} className="text-[14px] text-primary-text hover:underline">
          ← Back to {order.orderNumber}
        </a>
        <PrintButton />
      </div>
      <article className="print-page mx-auto w-full max-w-[210mm] bg-white p-[15mm] text-[12px] leading-snug text-black shadow-sm print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-4">
          <div>
            <p className="text-[18px] font-bold">Bryel&apos;s Care</p>
            <p>{organizationName}</p>
            <p>{COMPANY.address}</p>
            <p>{COMPANY.phone}</p>
            <p className="mt-1 text-[11px]">Dispatched from {site.code} · {site.name}</p>
          </div>
          <div className="flex items-start gap-4 text-right">
            <div>
              <p className="text-[18px] font-bold uppercase tracking-wide">Delivery Receipt</p>
              <p className="mt-1 text-[14px] font-semibold">{s.deliveryReceiptNumber}</p>
              <p>Date: {fmtDate(s.dispatchedAt)}</p>
            </div>
            <div className="size-[26mm] shrink-0" aria-label={`QR code BC:DOC:${s.deliveryReceiptNumber}`} dangerouslySetInnerHTML={{ __html: qr }} />
          </div>
        </header>

        <section className="grid grid-cols-2 gap-6 border-b border-black py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide">Deliver to</p>
            <p className="text-[13px] font-semibold">{customer.name}</p>
            <p>{customer.shipToAddress}</p>
            {customer.contactName && <p>Attn: {customer.contactName}{customer.phone ? ` · ${customer.phone}` : ""}</p>}
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <span className="font-bold">Sales order</span>
            <span>{order.orderNumber}</span>
            <span className="font-bold">Customer PO</span>
            <span>{order.customerPoNumber ?? "—"}</span>
            <span className="font-bold">Customer code</span>
            <span>{customer.code}</span>
            <span className="font-bold">Dispatched</span>
            <span>{fmtDateTime(s.dispatchedAt)}</span>
          </div>
        </section>

        <table className="mt-4 w-full border-collapse text-left">
          <thead>
            <tr className="border-y border-black text-[10px] uppercase">
              <th className="py-1.5 pr-2">#</th>
              <th className="py-1.5 pr-2">SKU</th>
              <th className="py-1.5 pr-2">Product</th>
              <th className="py-1.5 pr-2">Lot number</th>
              <th className="py-1.5 pr-2">Expiry</th>
              <th className="py-1.5 text-right">Qty (pcs)</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-3 text-center">No posted items found for this shipment.</td>
              </tr>
            ) : (
              items.map((i, n) => (
                <tr key={i.movementId} className="border-b border-[#999]">
                  <td className="py-1.5 pr-2">{n + 1}</td>
                  <td className="py-1.5 pr-2 font-semibold">{i.sku}</td>
                  <td className="py-1.5 pr-2">{i.productName}</td>
                  <td className="py-1.5 pr-2 font-mono">{i.lotNumber}</td>
                  <td className="py-1.5 pr-2">{fmtDate(i.expiresOn)}</td>
                  <td className="py-1.5 text-right tabular">{fmtQty(i.qty, "", 0)}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-b-2 border-black font-bold">
              <td colSpan={5} className="py-1.5">Total ({items.length} line{items.length === 1 ? "" : "s"})</td>
              <td className="py-1.5 text-right tabular">{fmtQty(totalQty, "", 0)}</td>
            </tr>
          </tfoot>
        </table>

        <section className="keep mt-4 grid grid-cols-4 gap-4 border-b border-black pb-4">
          <div>
            <p className="text-[10px] font-bold uppercase">Carrier</p>
            <p>{s.carrier ?? "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase">Driver</p>
            <p>{s.driverName ?? "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase">Vehicle plate</p>
            <p>{s.vehiclePlate ?? "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase">Packages</p>
            <p>{s.packageCount ?? "—"}</p>
          </div>
        </section>

        <section className="keep mt-6 grid grid-cols-2 gap-10">
          <div>
            <p className="text-[10px] font-bold uppercase">Released by</p>
            <p className="mt-8 border-t border-black pt-1">{dr.dispatcher}</p>
          </div>
          <div>
            <p className="font-semibold">Received the above in good order and condition.</p>
            <div className="mt-3 grid grid-cols-[auto_1fr] items-end gap-x-2 gap-y-4">
              <span>Received by:</span>
              <span className="min-h-[18px] border-b border-black">{s.receivedByName ?? ""}</span>
              <span>Signature:</span>
              <span className="min-h-[18px] border-b border-black" />
              <span>Date:</span>
              <span className="min-h-[18px] border-b border-black">{s.deliveredAt ? fmtDateTime(s.deliveredAt) : ""}</span>
            </div>
          </div>
        </section>

        <footer className="mt-8 border-t border-[#999] pt-2 text-[9px] text-[#444]">
          <p>
            {s.deliveryReceiptNumber} · {order.orderNumber} · Printed {fmtDateTime(new Date())} by {ctx.displayName}. Prices are not shown on delivery receipts (A-RPT-12). This document is not an official
            receipt or invoice; statutory wording is pending accountant review.
          </p>
        </footer>
      </article>
    </main>
  );
}

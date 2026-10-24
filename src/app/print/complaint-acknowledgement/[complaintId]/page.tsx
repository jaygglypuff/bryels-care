import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getComplaintAcknowledgement } from "@/modules/quality";
import { Logo } from "@/ui/brand";
import { EmptyState } from "@/ui/core";
import { PrintButton } from "../../delivery-receipt/[shipmentId]/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Complaint acknowledgement" };

/**
 * Customer-facing complaint acknowledgement (W07-06; browser print, ADR-026). It renders only the
 * whitelisted fields of toCustomerFacing(): internal notes, the investigation, the root cause, the
 * internal resolution and the severity never reach this page. Wording is a placeholder for the
 * company's customer-service and QA leads to replace (A-W3F-07).
 */
export default async function ComplaintAcknowledgementPrint({ params }: { params: Promise<{ complaintId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.complaint.view"))
    return (
      <main className="mx-auto max-w-xl p-6">
        <EmptyState title="You don't have access">Your role does not include viewing complaints.</EmptyState>
      </main>
    );
  const { complaintId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(complaintId)) notFound();
  let a: Awaited<ReturnType<typeof getComplaintAcknowledgement>>;
  try {
    a = await getComplaintAcknowledgement(ctx, complaintId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const d = a.document;
  return (
    <main className="min-h-dvh bg-[#e9e7e1] py-6 print:bg-white print:py-0">
      <style>{`@page { size: A4 portrait; margin: 15mm; }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3 px-4">
        <a href={`/quality/complaints/${complaintId}`} className="text-[14px] text-primary-text hover:underline">
          ← Back to {d.complaintNumber}
        </a>
        <PrintButton />
      </div>
      <article className="print-page mx-auto w-full max-w-[210mm] bg-white p-[15mm] text-[12px] leading-snug text-black shadow-sm print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-4">
          <div>
            <Logo tagline className="mb-2 h-[48px] w-auto" />
            <p>{a.organizationName}</p>
            {a.site && <p className="text-[11px]">{a.site.name}</p>}
          </div>
          <div className="text-right">
            <p className="text-[18px] font-bold uppercase tracking-wide">Complaint acknowledgement</p>
            <p className="mt-1 text-[14px] font-semibold">{d.complaintNumber}</p>
            <p>Date: {fmtDate(a.generatedAt)}</p>
          </div>
        </header>
        <section className="grid grid-cols-2 gap-6 border-b border-black py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide">To</p>
            <p className="text-[13px] font-semibold">{d.customerName}</p>
            <p>{d.customerAddress}</p>
            {a.contactName && <p>Attn: {a.contactName}</p>}
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <span className="font-bold">Received</span>
            <span>{fmtDateTime(d.receivedAt)}</span>
            <span className="font-bold">Your reference</span>
            <span>{d.customerReference ?? "—"}</span>
            <span className="font-bold">Status</span>
            <span>{d.statusWord}</span>
          </div>
        </section>
        <section className="border-b border-black py-4">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <span className="font-bold">Product</span>
            <span>{d.productName ?? "—"}</span>
            <span className="font-bold">Lot / box on the label</span>
            <span className="font-mono">{d.reportedCode ?? d.lotNumber ?? "—"}</span>
            <span className="font-bold">Subject</span>
            <span>{d.categoryLabel}</span>
            <span className="font-bold">Quantity concerned</span>
            <span>{d.qtyAffected ?? "—"}</span>
            <span className="font-bold">Sample returned</span>
            <span>{d.sampleReturned ? "Yes, received" : "No"}</span>
          </div>
          <p className="mt-3 text-[10px] font-bold uppercase">What you told us</p>
          <p className="whitespace-pre-wrap">{d.description}</p>
        </section>
        <section className="py-4">
          <p className="text-[10px] font-bold uppercase">Our reply</p>
          <p className="whitespace-pre-wrap">{d.customerResponse ?? "Thank you for letting us know. We have recorded your complaint and are looking into it; we will contact you with our findings."}</p>
        </section>
        <footer className="mt-8 border-t border-[#999] pt-2 text-[9px] text-[#444]">
          <p>
            {d.complaintNumber} · Printed {fmtDateTime(a.generatedAt)} by {ctx.displayName}. Placeholder wording pending review by the company&apos;s customer service and QA (A-W3F-07).
          </p>
        </footer>
      </article>
    </main>
  );
}

import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listInvoices, shipmentsAwaitingInvoice } from "@/modules/finance";
import { Card, CardTitle, EmptyState, PageHeader, buttonClass } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { FinanceStatus, Money, ResponsiveList, StatusTabs } from "../finance-ui";
import { CreateInvoiceButton } from "./forms";

export const metadata = { title: "Invoices" };

const TABS = [
  ["", "All"],
  ["draft", "Draft"],
  ["submitted", "To approve"],
  ["approved", "To issue"],
  ["issued", "Issued"],
  ["partially_paid", "Partly paid"],
  ["overdue", "Overdue"],
  ["paid", "Paid"],
  ["voided", "Voided"],
] as const;

/** US-6-10: invoices of the caller's sites and the dispatched shipments still to invoice. */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.invoice.view")) return <Forbidden what="invoices" />;
  const { status = "" } = await searchParams;
  const rows = await listInvoices(ctx, status === "overdue" ? { overdue: true } : { status: status || undefined });
  const awaiting = await shipmentsAwaitingInvoice(ctx);
  const canCreate = ctx.can("finance.invoice.create");
  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="One invoice per dispatched shipment: draft → approval → issue (numbered, posted) → paid. Corrections are credit notes or reversals, never edits."
        actions={
          ctx.can("finance.invoice.export") ? (
            <Link className={buttonClass("secondary")} href="/finance/statements">
              Customer statements
            </Link>
          ) : undefined
        }
      />
      <Card className="mb-4">
        <CardTitle>Shipments awaiting invoice</CardTitle>
        {awaiting.length === 0 ? (
          <p className="text-[13px] text-muted">No shipments awaiting invoice. Dispatched shipments appear here until their invoice is created.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {awaiting.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                <span className="min-w-0">
                  <span className="font-medium">{s.shipmentNumber ?? `DR ${s.drNumber}`}</span> · {s.customerName} · order {s.orderNumber} · dispatched {fmtDate(s.dispatchedAt)}
                </span>
                {canCreate ? <CreateInvoiceButton shipmentId={s.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <StatusTabs base="/finance/invoices" current={status} tabs={TABS} />
      {rows.length === 0 ? (
        <EmptyState title={status ? "No invoices in this state" : "No invoices yet"}>Create the first invoice from a dispatched shipment above.</EmptyState>
      ) : (
        <ResponsiveList
          rows={rows}
          rowKey={(r) => r.id}
          head={["Invoice", "Customer", "Shipment", "Issued", "Due", "Total", "Open", "Status"]}
          cells={(r) => [
            <Link key="n" className="font-medium text-primary-text hover:underline" href={`/finance/invoices/${r.id}`}>
              {r.invoiceNumber ?? "Draft"}
            </Link>,
            r.customerName,
            r.shipmentNumber ?? "—",
            fmtDate(r.issueDate),
            fmtDate(r.dueDate),
            <Money key="t" value={r.totalAmount} />,
            <Money key="o" value={r.openAmount} />,
            <span key="s" className="inline-flex gap-1">
              <FinanceStatus status={r.status} />
              {r.overdue && <FinanceStatus status="overdue" />}
            </span>,
          ]}
          mobile={(r) => (
            <Link href={`/finance/invoices/${r.id}`}>
              <Card className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{r.invoiceNumber ?? "Draft"}</span>
                  <FinanceStatus status={r.overdue ? "overdue" : r.status} />
                </div>
                <p className="text-[13px]">{r.customerName}</p>
                <div className="flex justify-between text-[12px] text-muted">
                  <span>{r.dueDate ? `due ${fmtDate(r.dueDate)}` : `shipment ${r.shipmentNumber ?? "—"}`}</span>
                  <Money value={r.openAmount} />
                </div>
              </Card>
            </Link>
          )}
        />
      )}
    </>
  );
}

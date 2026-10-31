import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listInvoices, shipmentsAwaitingInvoice } from "@/modules/finance";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Forbidden } from "../../forbidden";
import { FinanceStatus, RowAmount, StatusTabs } from "../finance-ui";
import { CreateInvoiceButton } from "./forms";

export const metadata = { title: "Invoices" };

const TABS = [
  ["", "All"],
  ["draft", "Drafts"],
  ["submitted", "To approve"],
  ["approved", "To save to the books"],
  ["issued", "Not paid yet"],
  ["partially_paid", "Part paid"],
  ["overdue", "Late"],
  ["paid", "Paid"],
] as const;

/** US-6-10: invoices (money customers owe us) and the deliveries still to invoice. Customer first, amount right. */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.invoice.view")) return <Forbidden what="invoices" />;
  const { status = "" } = await searchParams;
  const rows = await listInvoices(ctx, status === "overdue" ? { overdue: true } : { status: status || undefined });
  const awaiting = await shipmentsAwaitingInvoice(ctx);
  const canCreate = ctx.can("finance.invoice.create");
  const row = (s: (typeof awaiting)[number]) => (
    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">{s.customerName}</span>
        <span className="text-[13px] text-fg-2">
          Sent {fmtDate(s.dispatchedAt)} <span className="font-mono text-[12px] text-muted">· {s.shipmentNumber ?? `DR ${s.drNumber}`}</span>
        </span>
      </span>
      {canCreate ? <CreateInvoiceButton shipmentId={s.id} /> : null}
    </li>
  );
  return (
    <>
      <PageHeader title="Invoices" actions={<LinkButton href="/finance/statements" variant="secondary">Customer statements</LinkButton>} />
      <PageIntro>This screen is for the money customers owe us: one invoice for each delivery. A mistake on a sent invoice is fixed with a credit (money back), never by changing it.</PageIntro>
      {awaiting.length > 0 && canCreate && <NextStep text={`Next: ${awaiting.length} delivery(ies) went out without an invoice. Make the invoice for each.`} action={{ label: "Show them", href: "#to-invoice" }} />}
      {awaiting.length > 0 && (
        <Card className="mb-4">
          <span id="to-invoice" className="block scroll-mt-24" />
          <CardTitle>Deliveries without an invoice</CardTitle>
          <ul className="flex flex-col divide-y divide-line">{awaiting.slice(0, 3).map(row)}</ul>
          {awaiting.length > 3 && (
            <details>
              <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[14px] font-medium text-primary-text">Show the other {awaiting.length - 3}</summary>
              <ul className="flex flex-col divide-y divide-line">{awaiting.slice(3).map(row)}</ul>
            </details>
          )}
        </Card>
      )}
      <StatusTabs base="/finance/invoices" current={status} tabs={TABS} />
      {rows.length === 0 ? (
        <EmptyState title={status ? "No invoices here" : "No invoices yet"}>
          {awaiting.length ? "Make an invoice from a delivery above." : "Invoices are made from deliveries that went out to customers. When a delivery leaves, it shows here."}
        </EmptyState>
      ) : (
        <PlainList label="Invoices">
          {rows.map((r) => (
            <PlainRow
              key={r.id}
              testId="invoice-row"
              href={`/finance/invoices/${r.id}`}
              title={r.customerName}
              code={r.invoiceNumber ?? "no number yet"}
              tone={r.overdue ? "bad" : undefined}
              status={
                <>
                  <FinanceStatus status={r.status} />
                  {r.overdue && <FinanceStatus status="overdue" />}
                </>
              }
              facts={r.dueDate ? `Due ${fmtDate(r.dueDate)}` : r.issueDate ? `Sent ${fmtDate(r.issueDate)}` : `Delivery ${r.shipmentNumber ?? "—"}`}
              aside={<RowAmount value={Number(r.openAmount) > 0 && r.openAmount !== r.totalAmount ? r.openAmount : r.totalAmount} note={Number(r.openAmount) > 0 && r.openAmount !== r.totalAmount ? "still to pay" : undefined} />}
            />
          ))}
        </PlainList>
      )}
    </>
  );
}

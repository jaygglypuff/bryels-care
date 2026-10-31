import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { PAYMENT_METHOD_LABEL, listPayments } from "@/modules/finance";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Forbidden } from "../../forbidden";
import { FinanceStatus, RowAmount, StatusTabs } from "../finance-ui";

export const metadata = { title: "Payments" };

const TABS = [
  ["", "All"],
  ["draft", "Drafts"],
  ["submitted", "To approve"],
  ["approved", "To save to the books"],
  ["recorded", "In the books"],
  ["voided", "Cancelled"],
] as const;

/** US-6-12: money in and money out. The system never moves money; a record is the evidence. Name first, amount right. */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.payment_record.view")) return <Forbidden what="payments" />;
  const { status = "" } = await searchParams;
  const rows = await listPayments(ctx, { status: status || undefined });
  const canCreate = ctx.can("finance.payment_record.create");
  return (
    <>
      <PageHeader title="Payments" actions={canCreate ? <LinkButton href="/finance/payments/new" variant="cta">Record a payment</LinkButton> : undefined} />
      <PageIntro>This screen is for money in (customers paying us) and money out (paying suppliers and paying people back). Each payment pays the oldest invoices or bills first unless you choose.</PageIntro>
      <StatusTabs base="/finance/payments" current={status} tabs={TABS} />
      {rows.length === 0 ? (
        <EmptyState title={status ? "No payments here" : "No payments yet"} action={canCreate ? <LinkButton href="/finance/payments/new" variant="secondary">Record a payment</LinkButton> : undefined}>
          When money comes in or goes out, write it down with “Record a payment”, or from the invoice or bill it pays.
        </EmptyState>
      ) : (
        <PlainList label="Payments">
          {rows.map((r) => (
            <PlainRow
              key={r.id}
              testId="payment-row"
              href={`/finance/payments/${r.id}`}
              title={
                <span className="inline-flex items-center gap-1">
                  {r.direction === "inbound" ? <ArrowDownLeft size={16} className="text-[var(--ok-fg)]" aria-label="Money in" /> : <ArrowUpRight size={16} className="text-[var(--warn-fg)]" aria-label="Money out" />}
                  {r.counterpartyName}
                </span>
              }
              code={r.paymentNumber}
              status={<FinanceStatus status={r.status} />}
              facts={`${r.direction === "inbound" ? "Money in" : "Money out"} · ${fmtDate(r.paidOn)} · ${PAYMENT_METHOD_LABEL[r.method as keyof typeof PAYMENT_METHOD_LABEL] ?? r.method}`}
              aside={<RowAmount value={r.amount} note={Number(r.unapplied) > 0 ? `₱${Number(r.unapplied).toLocaleString("en-PH", { minimumFractionDigits: 2 })} kept for later` : undefined} />}
            />
          ))}
        </PlainList>
      )}
    </>
  );
}

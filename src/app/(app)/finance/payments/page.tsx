import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { PAYMENT_METHOD_LABEL, listPayments } from "@/modules/finance";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { FinanceStatus, Money, ResponsiveList, StatusTabs } from "../finance-ui";

export const metadata = { title: "Payments" };

const TABS = [
  ["", "All"],
  ["draft", "Draft"],
  ["submitted", "To approve"],
  ["approved", "To record"],
  ["recorded", "Recorded"],
  ["voided", "Voided"],
] as const;

/** US-6-12: money received and paid. The system never moves money; a record is the evidence. */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.payment_record.view")) return <Forbidden what="payments" />;
  const { status = "" } = await searchParams;
  const rows = await listPayments(ctx, { status: status || undefined });
  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Receipts from customers and payments to suppliers and claimants, applied to open documents (oldest due first unless chosen)."
        actions={ctx.can("finance.payment_record.create") ? <LinkButton href="/finance/payments/new" variant="cta">Record a payment</LinkButton> : undefined}
      />
      <StatusTabs base="/finance/payments" current={status} tabs={TABS} />
      {rows.length === 0 ? (
        <EmptyState title={status ? "No payments in this state" : "No payments yet"}>Payments appear here once recorded.</EmptyState>
      ) : (
        <ResponsiveList
          rows={rows}
          rowKey={(r) => r.id}
          head={["Payment", "Direction", "Counterparty", "Paid on", "Method", "Amount", "Unapplied", "Status"]}
          cells={(r) => [
            <Link key="n" className="font-medium text-primary-text hover:underline" href={`/finance/payments/${r.id}`}>
              {r.paymentNumber}
            </Link>,
            r.direction === "inbound" ? "Money in" : "Money out",
            r.counterpartyName,
            fmtDate(r.paidOn),
            PAYMENT_METHOD_LABEL[r.method as keyof typeof PAYMENT_METHOD_LABEL] ?? r.method,
            <Money key="a" value={r.amount} />,
            <Money key="u" value={r.unapplied} />,
            <FinanceStatus key="s" status={r.status} />,
          ]}
          mobile={(r) => (
            <Link href={`/finance/payments/${r.id}`}>
              <Card className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{r.paymentNumber}</span>
                  <FinanceStatus status={r.status} />
                </div>
                <p className="text-[13px]">
                  {r.direction === "inbound" ? "From" : "To"} {r.counterpartyName}
                </p>
                <div className="flex justify-between text-[12px] text-muted">
                  <span>{fmtDate(r.paidOn)}</span>
                  <Money value={r.amount} />
                </div>
              </Card>
            </Link>
          )}
        />
      )}
    </>
  );
}

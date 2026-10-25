import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { EXPENSE_STATUS_LABEL, listExpenseClaims } from "@/modules/finance";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { FinanceStatus, Money, ResponsiveList, StatusTabs } from "../finance-ui";

export const metadata = { title: "Expense claims" };

/** US-6-12: own claims (self-service), claims to approve, and all claims for finance. */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  const canOwn = ctx.can("finance.expense_claim.create");
  const canOthers = ctx.can("finance.expense_claim.view") || ctx.can("finance.expense_claim.approve");
  if (!canOwn && !canOthers) return <Forbidden what="expense claims" />;
  const { status = canOthers ? "to_approve" : "mine" } = await searchParams;
  const scope = status === "to_approve" ? "to_approve" : status === "mine" ? "mine" : "all";
  const rows = await listExpenseClaims(ctx, { scope, status: EXPENSE_STATUS_LABEL[status] ? status : undefined });
  const tabs: [string, string][] = [
    ...(canOwn ? ([["mine", "My claims"]] as [string, string][]) : []),
    ...(canOthers ? ([["to_approve", "To approve"], ["all", "All"], ["approved", "Approved (to post)"], ["posted", "Posted (to pay)"], ["paid", "Paid"]] as [string, string][]) : []),
  ];
  return (
    <>
      <PageHeader
        title="Expense claims"
        subtitle="Claim what you spent for the company. The site manager approves; above PHP 5,000 finance approves too (placeholder limits). You never approve your own claim."
        actions={canOwn ? <LinkButton href="/finance/expenses/new" variant="cta">New claim</LinkButton> : undefined}
      />
      <StatusTabs base="/finance/expenses" current={status} tabs={tabs} />
      {rows.length === 0 ? (
        <EmptyState title={scope === "to_approve" ? "Nothing waiting for your approval" : "No claims here"}>{canOwn ? "Create a claim with the receipt photo or PDF." : "Claims of your sites appear here."}</EmptyState>
      ) : (
        <ResponsiveList
          rows={rows}
          rowKey={(r) => r.id}
          head={["Claim", "Claimant", "Site", "Date", "Category", "Amount", "Status"]}
          cells={(r) => [
            <Link key="n" className="font-medium text-primary-text hover:underline" href={`/finance/expenses/${r.id}`}>
              {r.claimNumber}
            </Link>,
            r.claimantName,
            r.siteCode,
            fmtDate(r.expenseDate),
            r.categoryCode.replace(/_/g, " "),
            <Money key="a" value={r.amount} />,
            <FinanceStatus key="s" status={r.status} label={EXPENSE_STATUS_LABEL[r.status]} />,
          ]}
          mobile={(r) => (
            <Link href={`/finance/expenses/${r.id}`}>
              <Card className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{r.claimNumber}</span>
                  <FinanceStatus status={r.status} label={EXPENSE_STATUS_LABEL[r.status]} />
                </div>
                <p className="text-[13px]">
                  {r.claimantName} · {r.categoryCode.replace(/_/g, " ")}
                </p>
                <Money value={r.amount} className="text-[12px] text-muted" />
              </Card>
            </Link>
          )}
        />
      )}
    </>
  );
}

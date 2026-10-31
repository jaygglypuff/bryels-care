import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { EXPENSE_STATUS_LABEL, listExpenseClaims } from "@/modules/finance";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Forbidden } from "../../forbidden";
import { CLAIM_WORD, FinanceStatus, RowAmount, StatusTabs } from "../finance-ui";

export const metadata = { title: "Expense claims" };

/** US-6-12: own claims (self-service), claims to approve, and all claims for finance. Person first, amount right. */
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
    ...(canOthers ? ([["to_approve", "To approve"], ["approved", "To save to the books"], ["posted", "To pay back"], ["paid", "Paid back"], ["all", "All"]] as [string, string][]) : []),
  ];
  return (
    <>
      <PageHeader title="Expense claims" actions={canOwn ? <LinkButton href="/finance/expenses/new" variant="cta">Claim money I spent</LinkButton> : undefined} />
      <PageIntro>This screen is for getting back money you spent for the company. Add the receipt photo; the manager approves, and finance too for bigger amounts (the limits are settings the owner checks). Nobody approves their own claim.</PageIntro>
      {scope === "to_approve" && rows.length > 0 && <NextStep text={`Next: ${rows.length} claim(s) wait for your approval.`} action={{ label: "Open the first", href: `/finance/expenses/${rows[0].id}` }} />}
      <StatusTabs base="/finance/expenses" current={status} tabs={tabs} />
      {rows.length === 0 ? (
        <EmptyState title={scope === "to_approve" ? "Nothing waiting for your approval" : "No claims here"} action={canOwn ? <LinkButton href="/finance/expenses/new" variant="secondary">Claim money I spent</LinkButton> : undefined}>
          {canOwn ? "Spent your own money for the company? Tap “Claim money I spent” and add a photo of the receipt." : "Claims from your sites show here."}
        </EmptyState>
      ) : (
        <PlainList label="Expense claims">
          {rows.map((r) => (
            <PlainRow
              key={r.id}
              testId="claim-row"
              href={`/finance/expenses/${r.id}`}
              title={r.claimantName}
              code={r.claimNumber}
              status={<FinanceStatus status={r.status} label={CLAIM_WORD[r.status] ?? EXPENSE_STATUS_LABEL[r.status]} />}
              facts={`${r.categoryCode.replace(/_/g, " ")} · spent ${fmtDate(r.expenseDate)} · ${r.siteCode}`}
              aside={<RowAmount value={r.amount} />}
            />
          ))}
        </PlainList>
      )}
    </>
  );
}

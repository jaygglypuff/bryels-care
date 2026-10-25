import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtMoney } from "@/lib/qty";
import { AGING_BUCKETS, AGING_LABEL, listExpenseClaims, payablesSummary, receivablesSummary, shipmentsAwaitingInvoice } from "@/modules/finance";
import { Card, CardTitle, EmptyState, Kpi, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../forbidden";
import { FINANCE_SCOPE_NOTE } from "./finance-ui";

export const metadata = { title: "Finance" };

/** Finance overview (ADR-020 operational finance support): receivables, payables and what needs action. */
export default async function FinancePage() {
  const ctx = await requireContext();
  const canInv = ctx.can("finance.invoice.view");
  const canBills = ctx.can("finance.supplier_bill.view");
  const canClaims = ctx.can("finance.expense_claim.create") || ctx.can("finance.expense_claim.view") || ctx.can("finance.expense_claim.approve");
  if (!canInv && !canBills && !canClaims && !ctx.can("finance.period_lock.view") && !ctx.can("finance.tax_config.view")) return <Forbidden what="finance" />;
  const rec = canInv ? await receivablesSummary(ctx) : null;
  const pay = canBills ? await payablesSummary(ctx) : null;
  const awaiting = canInv ? await shipmentsAwaitingInvoice(ctx) : [];
  const toApprove = ctx.can("finance.expense_claim.approve") ? (await listExpenseClaims(ctx, { scope: "to_approve" })).length : 0;
  const links: [string, string, boolean][] = [
    ["Invoices", "/finance/invoices", canInv],
    ["Statements", "/finance/statements", canInv],
    ["Payments", "/finance/payments", ctx.can("finance.payment_record.view")],
    ["Credit notes", "/finance/credit-notes", ctx.can("finance.credit_note.view")],
    ["Supplier bills", "/finance/bills", canBills],
    ["Expense claims", "/finance/expenses", canClaims],
    ["Periods and locks", "/finance/periods", ctx.can("finance.period_lock.view")],
    ["Tax configuration", "/finance/tax", ctx.can("finance.tax_config.view")],
  ];
  return (
    <>
      <PageHeader title="Finance" subtitle={FINANCE_SCOPE_NOTE} />
      {rec && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Receivables outstanding" value={fmtMoney(rec.outstanding)} hint="Issued and partly paid invoices (actual)" href="/finance/invoices?status=issued" />
          <Kpi label="Overdue" value={fmtMoney(rec.overdue)} tone={Number(rec.overdue) > 0 ? "bad" : "good"} hint="Open amount past the due date" href="/finance/invoices?status=overdue" />
          <Kpi label="To approve" value={rec.counts.submitted ?? 0} hint="Invoices waiting for approval" href="/finance/invoices?status=submitted" />
          <Kpi label="Shipments to invoice" value={awaiting.length} hint="Dispatched, no invoice yet" href="/finance/invoices" />
        </div>
      )}
      {pay && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label="Payables outstanding" value={fmtMoney(pay.outstanding)} hint={`${pay.openCount} posted bills`} href="/finance/bills?status=posted" />
          <Kpi label="Payables past due" value={fmtMoney(pay.overdue)} tone={Number(pay.overdue) > 0 ? "warn" : "good"} href="/finance/bills" />
          <Kpi label="Bills in dispute" value={pay.disputed} tone={pay.disputed ? "warn" : "good"} hint="Three-way match variance" href="/finance/bills?status=disputed" />
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {rec ? (
          <Card>
            <CardTitle>Receivables aging (as of today)</CardTitle>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {AGING_BUCKETS.map((b) => (
                <li key={b} className="rounded-[12px] border border-line px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{AGING_LABEL[b]}</p>
                  <p className="mt-1 font-semibold tabular-nums">{fmtMoney(rec.buckets[b])}</p>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState title="Receivables are not part of your role">Your finance pages are listed on the right.</EmptyState>
        )}
        <Card>
          <CardTitle>Finance pages</CardTitle>
          <ul className="flex flex-col gap-1.5 text-[14px]">
            {links
              .filter((l) => l[2])
              .map(([label, href]) => (
                <li key={href}>
                  <Link className="text-primary-text hover:underline" href={href}>
                    {label}
                  </Link>
                  {href === "/finance/expenses" && toApprove > 0 ? <span className="text-muted"> · {toApprove} to approve</span> : null}
                </li>
              ))}
          </ul>
          {ctx.can("finance.expense_claim.create") && (
            <div className="mt-3">
              <LinkButton href="/finance/expenses/new" variant="secondary">
                New expense claim
              </LinkButton>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

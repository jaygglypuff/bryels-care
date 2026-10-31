import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { fmtMoney } from "@/lib/qty";
import { AGING_BUCKETS, listExpenseClaims, payablesSummary, receivablesSummary, shipmentsAwaitingInvoice } from "@/modules/finance";
import { Card, CardTitle, EmptyState, Kpi, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { Forbidden } from "../forbidden";
import { FINANCE_SCOPE_NOTE, LATE_WORD } from "./finance-ui";

export const metadata = { title: "Money" };

/** Finance home (ADR-020 operational finance support): money customers owe us, money we owe, and what needs action. */
export default async function FinancePage() {
  const ctx = await requireContext();
  const canInv = ctx.can("finance.invoice.view");
  const canBills = ctx.can("finance.supplier_bill.view");
  const canClaims = ctx.can("finance.expense_claim.create") || ctx.can("finance.expense_claim.view") || ctx.can("finance.expense_claim.approve");
  if (!canInv && !canBills && !canClaims && !ctx.can("finance.period_lock.view") && !ctx.can("finance.tax_config.view")) return <Forbidden what="money screens" />;
  const rec = canInv ? await receivablesSummary(ctx) : null;
  const pay = canBills ? await payablesSummary(ctx) : null;
  const awaiting = canInv ? await shipmentsAwaitingInvoice(ctx) : [];
  const toApprove = ctx.can("finance.expense_claim.approve") ? (await listExpenseClaims(ctx, { scope: "to_approve" })).length : 0;
  const links: [string, string, string, boolean][] = [
    ["Invoices", "What customers must pay us", "/finance/invoices", canInv],
    ["Customer statements", "One customer's unpaid invoices on one page", "/finance/statements", canInv],
    ["Payments", "Money in and money out", "/finance/payments", ctx.can("finance.payment_record.view")],
    ["Credits (money back)", "Lower what a customer owes", "/finance/credit-notes", ctx.can("finance.credit_note.view")],
    ["Supplier bills", "What we must pay suppliers", "/finance/bills", canBills],
    ["Expense claims", toApprove > 0 ? `${toApprove} waiting for your approval` : "Money people spent for the company", "/finance/expenses", canClaims],
    ["Close the month", "Stop changes to a finished month", "/finance/periods", ctx.can("finance.period_lock.view")],
    ["Tax rates", "Rates the accountant gave us", "/finance/tax", ctx.can("finance.tax_config.view")],
  ];
  const toInvoice = awaiting.length;
  const invToApprove = rec?.counts.submitted ?? 0;
  const next =
    toInvoice && ctx.can("finance.invoice.create")
      ? { text: `Next: ${toInvoice} delivery(ies) went out without an invoice.`, action: { label: "Make the invoices", href: "/finance/invoices" } }
      : invToApprove && ctx.can("finance.invoice.approve")
        ? { text: `Next: ${invToApprove} invoice(s) wait for approval.`, action: { label: "Open them", href: "/finance/invoices?status=submitted" } }
        : toApprove
          ? { text: `Next: ${toApprove} expense claim(s) wait for your approval.`, action: { label: "Open them", href: "/finance/expenses?status=to_approve" } }
          : rec && Number(rec.overdue) > 0
            ? { text: `Customers are late paying ${fmtMoney(rec.overdue)}.`, action: { label: "See who is late", href: "/finance/statements" } }
            : null;
  return (
    <>
      <PageHeader title="Money" subtitle={FINANCE_SCOPE_NOTE} />
      <PageIntro>This screen is for the company&apos;s money: what customers owe us, what we owe suppliers, and what is waiting for you.</PageIntro>
      {next && <NextStep text={next.text} action={next.action} />}
      {rec && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Money customers owe us" value={fmtMoney(rec.outstanding)} hint="Invoices sent, not fully paid" href="/finance/invoices?status=issued" />
          <Kpi label="Of that, late" value={fmtMoney(rec.overdue)} tone={Number(rec.overdue) > 0 ? "bad" : "good"} hint="Past the day it was due" href="/finance/invoices?status=overdue" />
          <Kpi label="Invoices to approve" value={invToApprove} href="/finance/invoices?status=submitted" />
          <Kpi label="Deliveries without an invoice" value={toInvoice} hint="Sent to the customer, no invoice yet" href="/finance/invoices" />
        </div>
      )}
      {pay && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label="Money we owe suppliers" value={fmtMoney(pay.outstanding)} hint={`${pay.openCount} supplier bill(s) to pay`} href="/finance/bills?status=posted" />
          <Kpi label="Of that, we are late" value={fmtMoney(pay.overdue)} tone={Number(pay.overdue) > 0 ? "warn" : "good"} href="/finance/bills" />
          <Kpi label="Supplier bills that do not match" value={pay.disputed} tone={pay.disputed ? "warn" : "good"} hint="Bill differs from the order or the delivery" href="/finance/bills?status=disputed" />
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        {rec ? (
          <Card>
            <CardTitle>How late customers are (today)</CardTitle>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {AGING_BUCKETS.map((b) => (
                <li key={b} className="rounded-[12px] border border-line px-3 py-2">
                  <p className="text-[12px] font-semibold text-muted">{LATE_WORD[b] ?? b}</p>
                  <p className="mt-1 font-semibold tabular-nums">{fmtMoney(rec.buckets[b])}</p>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <EmptyState title="Customer money is not part of your job here">Your money screens are in the “Money screens” list. Questions? Ask finance.</EmptyState>
        )}
        <Card>
          <CardTitle>Money screens</CardTitle>
          <ul className="flex flex-col divide-y divide-line">
            {links
              .filter((l) => l[3])
              .map(([label, what, href]) => (
                <li key={href}>
                  <Link className="flex min-h-[52px] items-center gap-2 py-2 hover:bg-surface-2" href={href}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium text-fg">{label}</span>
                      <span className="block text-[13px] text-fg-2">{what}</span>
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
          </ul>
          {ctx.can("finance.expense_claim.create") && (
            <div className="mt-3">
              <LinkButton href="/finance/expenses/new" variant="secondary">
                Claim money I spent
              </LinkButton>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listSupplierBills } from "@/modules/finance";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { FinanceStatus, Money, ResponsiveList, StatusTabs } from "../finance-ui";

export const metadata = { title: "Supplier bills" };

const TABS = [
  ["", "All"],
  ["draft", "Draft"],
  ["disputed", "In dispute"],
  ["submitted", "To approve"],
  ["approved", "To post"],
  ["posted", "Posted"],
  ["partially_paid", "Partly paid"],
  ["paid", "Paid"],
] as const;

/** US-6-11: what we owe suppliers, matched against receipts (and purchase orders once connected). */
export default async function BillsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.supplier_bill.view")) return <Forbidden what="supplier bills" />;
  const { status = "" } = await searchParams;
  const rows = await listSupplierBills(ctx, { status: status || undefined });
  return (
    <>
      <PageHeader
        title="Supplier bills"
        subtitle="Enter the supplier's bill against a posted goods receipt; the three-way match runs at submission and parks variances in dispute."
        actions={ctx.can("finance.supplier_bill.create") ? <LinkButton href="/finance/bills/new" variant="cta">Enter a bill</LinkButton> : undefined}
      />
      <StatusTabs base="/finance/bills" current={status} tabs={TABS} />
      {rows.length === 0 ? (
        <EmptyState title={status ? "No bills in this state" : "No supplier bills yet"}>Bills appear here once entered.</EmptyState>
      ) : (
        <ResponsiveList
          rows={rows}
          rowKey={(r) => r.id}
          head={["Bill", "Supplier", "Supplier ref.", "Receipt", "Bill date", "Due", "Total", "Status"]}
          cells={(r) => [
            <Link key="n" className="font-medium text-primary-text hover:underline" href={`/finance/bills/${r.id}`}>
              {r.billNumber}
            </Link>,
            r.supplierName,
            r.supplierReference,
            r.receiptNumber ?? (r.categoryCode ? `No PO · ${r.categoryCode}` : r.billKind === "credit" ? "Supplier credit" : "—"),
            fmtDate(r.billDate),
            fmtDate(r.dueDate),
            <Money key="t" value={r.totalAmount} />,
            <FinanceStatus key="s" status={r.status} />,
          ]}
          mobile={(r) => (
            <Link href={`/finance/bills/${r.id}`}>
              <Card className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{r.billNumber}</span>
                  <FinanceStatus status={r.status} />
                </div>
                <p className="text-[13px]">
                  {r.supplierName} · {r.supplierReference}
                </p>
                <Money value={r.totalAmount} className="text-[12px] text-muted" />
              </Card>
            </Link>
          )}
        />
      )}
    </>
  );
}

import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listSupplierBills } from "@/modules/finance";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Forbidden } from "../../forbidden";
import { FinanceStatus, RowAmount, StatusTabs } from "../finance-ui";

export const metadata = { title: "Supplier bills" };

const TABS = [
  ["", "All"],
  ["draft", "Drafts"],
  ["disputed", "Does not match"],
  ["submitted", "To approve"],
  ["approved", "To save to the books"],
  ["posted", "To pay"],
  ["partially_paid", "Part paid"],
  ["paid", "Paid"],
] as const;

/** US-6-11: supplier bills (money we owe), checked against the order and the delivery. Supplier first, amount right. */
export default async function BillsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.supplier_bill.view")) return <Forbidden what="supplier bills" />;
  const { status = "" } = await searchParams;
  const rows = await listSupplierBills(ctx, { status: status || undefined });
  const canCreate = ctx.can("finance.supplier_bill.create");
  const disputed = status ? [] : rows.filter((r) => r.status === "disputed");
  return (
    <>
      <PageHeader title="Supplier bills" actions={canCreate ? <LinkButton href="/finance/bills/new" variant="cta">Enter a supplier bill</LinkButton> : undefined} />
      <PageIntro>This screen is for the money we owe suppliers. Type in each supplier bill; the system checks the bill against the order and the delivery before anyone approves it.</PageIntro>
      {disputed.length > 0 && <NextStep text={`Next: ${disputed.length} supplier bill(s) do not match the order or the delivery. Check them.`} action={{ label: "Show them", href: "/finance/bills?status=disputed" }} />}
      <StatusTabs base="/finance/bills" current={status} tabs={TABS} />
      {rows.length === 0 ? (
        <EmptyState title={status ? "No supplier bills here" : "No supplier bills yet"} action={canCreate ? <LinkButton href="/finance/bills/new" variant="secondary">Enter a supplier bill</LinkButton> : undefined}>
          When a supplier sends a bill, type it in with “Enter a supplier bill”. Questions? Ask finance.
        </EmptyState>
      ) : (
        <PlainList label="Supplier bills">
          {rows.map((r) => (
            <PlainRow
              key={r.id}
              testId="bill-row"
              href={`/finance/bills/${r.id}`}
              title={r.supplierName}
              code={r.billNumber}
              tone={r.status === "disputed" ? "bad" : undefined}
              status={<FinanceStatus status={r.status} label={r.billKind === "credit" && r.status === "posted" ? "In the books" : undefined} />}
              facts={`${r.billKind === "credit" ? "Money back from supplier · " : ""}their bill ${r.supplierReference} · ${r.dueDate ? `due ${fmtDate(r.dueDate)}` : `dated ${fmtDate(r.billDate)}`}${r.categoryCode ? ` · ${r.categoryCode.replace(/_/g, " ")}` : ""}`}
              aside={<RowAmount value={r.totalAmount} />}
            />
          ))}
        </PlainList>
      )}
    </>
  );
}

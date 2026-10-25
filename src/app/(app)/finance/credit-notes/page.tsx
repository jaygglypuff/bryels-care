import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listCreditNotes } from "@/modules/finance";
import { Card, EmptyState, PageHeader } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { FinanceStatus, Money, ResponsiveList, StatusTabs } from "../finance-ui";

export const metadata = { title: "Credit notes" };

const TABS = [
  ["", "All"],
  ["draft", "Draft"],
  ["submitted", "To approve"],
  ["approved", "To issue"],
  ["applied", "Applied"],
  ["voided", "Voided"],
] as const;

export default async function CreditNotesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.credit_note.view")) return <Forbidden what="credit notes" />;
  const { status = "" } = await searchParams;
  const rows = await listCreditNotes(ctx, { status: status || undefined });
  return (
    <>
      <PageHeader title="Credit notes" subtitle="Reduce what a customer owes on an issued invoice (returns, pricing errors, full void). Start one from the invoice." />
      <StatusTabs base="/finance/credit-notes" current={status} tabs={TABS} />
      {rows.length === 0 ? (
        <EmptyState title={status ? "No credit notes in this state" : "No credit notes yet"}>Open an issued invoice and choose “Create credit note”.</EmptyState>
      ) : (
        <ResponsiveList
          rows={rows}
          rowKey={(r) => r.id}
          head={["Credit note", "Customer", "Invoice", "Issued", "Amount", "Status"]}
          cells={(r) => [
            <Link key="n" className="font-medium text-primary-text hover:underline" href={`/finance/credit-notes/${r.id}`}>
              {r.creditNoteNumber ?? "Draft"}
            </Link>,
            r.customerName,
            r.invoiceNumber ?? "—",
            fmtDate(r.issueDate),
            <Money key="a" value={r.amount} />,
            <FinanceStatus key="s" status={r.status} />,
          ]}
          mobile={(r) => (
            <Link href={`/finance/credit-notes/${r.id}`}>
              <Card className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{r.creditNoteNumber ?? "Draft"}</span>
                  <FinanceStatus status={r.status} />
                </div>
                <p className="text-[13px]">
                  {r.customerName} · {r.invoiceNumber}
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

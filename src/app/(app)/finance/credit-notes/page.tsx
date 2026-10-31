import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listCreditNotes } from "@/modules/finance";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Forbidden } from "../../forbidden";
import { FinanceStatus, RowAmount, StatusTabs } from "../finance-ui";

export const metadata = { title: "Credits (money back)" };

const TABS = [
  ["", "All"],
  ["draft", "Drafts"],
  ["submitted", "To approve"],
  ["approved", "To save to the books"],
  ["applied", "Done"],
  ["voided", "Cancelled"],
] as const;

/** Credit notes as "Credits (money back)": customer first, amount right, number small and grey. */
export default async function CreditNotesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.credit_note.view")) return <Forbidden what="credits (money back)" />;
  const { status = "" } = await searchParams;
  const rows = await listCreditNotes(ctx, { status: status || undefined });
  return (
    <>
      <PageHeader title="Credits (money back)" actions={<LinkButton href="/finance/invoices?status=issued" variant="secondary">Invoices not paid yet</LinkButton>} />
      <PageIntro>This screen is for lowering what a customer owes on a sent invoice: goods came back, a price was wrong, or the whole invoice was a mistake. Start a credit from the invoice (⋯ More there).</PageIntro>
      <StatusTabs base="/finance/credit-notes" current={status} tabs={TABS} />
      {rows.length === 0 ? (
        <EmptyState title={status ? "No credits here" : "No credits yet"} action={<LinkButton href="/finance/invoices?status=issued" variant="secondary">Open an invoice</LinkButton>}>
          Open a sent invoice and choose ⋯ More → “Give a credit (money back)”.
        </EmptyState>
      ) : (
        <PlainList label="Credits (money back)">
          {rows.map((r) => (
            <PlainRow
              key={r.id}
              testId="credit-row"
              href={`/finance/credit-notes/${r.id}`}
              title={r.customerName}
              code={r.creditNoteNumber ?? "no number yet"}
              status={<FinanceStatus status={r.status} />}
              facts={`On invoice ${r.invoiceNumber ?? "—"}${r.issueDate ? ` · ${fmtDate(r.issueDate)}` : ""}`}
              aside={<RowAmount value={r.amount} />}
            />
          ))}
        </PlainList>
      )}
    </>
  );
}

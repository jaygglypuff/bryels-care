import { requireContext } from "@/lib/auth/context";
import { statementCustomers } from "@/modules/finance";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Forbidden } from "../../forbidden";
import { RowAmount } from "../finance-ui";

export const metadata = { title: "Customer statements" };

/** R-05: pick a customer for a statement of what they still owe, with how late each invoice is. */
export default async function StatementsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("finance.invoice.view")) return <Forbidden what="customer statements" />;
  const { q } = await searchParams;
  const rows = await statementCustomers(ctx);
  const needle = (q ?? "").trim().toLowerCase();
  const shown = (needle ? rows.filter((r) => r.name.toLowerCase().includes(needle) || r.code.toLowerCase().includes(needle)) : rows).sort((a, b) => Number(b.open) - Number(a.open));
  return (
    <>
      <PageHeader title="Customer statements" actions={<LinkButton href="/finance/invoices" variant="secondary">Invoices</LinkButton>} />
      <PageIntro>This screen is for seeing, per customer, what they still owe us and how late it is — one page you can print and send them.</PageIntro>
      {rows.length === 0 ? (
        <EmptyState title="No sent invoices yet">Customers show here once one of their invoices is saved to the books. Questions? Ask finance.</EmptyState>
      ) : (
        <>
          <form method="get" role="search" className="mb-3 flex flex-wrap items-center gap-2">
            <label htmlFor="st-q" className="sr-only">Find a customer</label>
            <input id="st-q" name="q" defaultValue={q ?? ""} placeholder="Type part of the customer's name" autoComplete="off" className="min-h-[44px] min-w-0 flex-1 rounded-[12px] border border-line bg-surface px-3 text-[15px]" />
            <button type="submit" className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 text-[14px] font-medium hover:bg-surface-2">Find</button>
          </form>
          {shown.length === 0 ? (
            <EmptyState title="No customer with that name">Try fewer letters.</EmptyState>
          ) : (
            <PlainList label="Customers">
              {shown.map((r) => (
                <PlainRow key={r.id} testId="statement-row" href={`/finance/statements/${r.id}`} title={r.name} code={r.code} facts={Number(r.open) > 0 ? "Still owes us" : "Owes nothing"} aside={<RowAmount value={r.open} />} />
              ))}
            </PlainList>
          )}
        </>
      )}
    </>
  );
}

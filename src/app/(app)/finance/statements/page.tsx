import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { statementCustomers } from "@/modules/finance";
import { Card, EmptyState, PageHeader } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { Money, ResponsiveList } from "../finance-ui";

export const metadata = { title: "Customer statements" };

/** R-05: pick a customer for an open-item statement of account. */
export default async function StatementsPage() {
  const ctx = await requireContext();
  if (!ctx.can("finance.invoice.view")) return <Forbidden what="customer statements" />;
  const rows = await statementCustomers(ctx);
  return (
    <>
      <PageHeader title="Customer statements" subtitle="Open items with aging per customer, as of a date (A-FIN-06: open-item statements, monthly and on demand)." />
      {rows.length === 0 ? (
        <EmptyState title="No issued invoices yet">Statements list the customers with issued invoices in your sites.</EmptyState>
      ) : (
        <ResponsiveList
          rows={rows}
          rowKey={(r) => r.id}
          head={["Customer", "Code", "Open amount"]}
          cells={(r) => [
            <Link key="c" className="font-medium text-primary-text hover:underline" href={`/finance/statements/${r.id}`}>
              {r.name}
            </Link>,
            r.code,
            <Money key="o" value={r.open} />,
          ]}
          mobile={(r) => (
            <Link href={`/finance/statements/${r.id}`}>
              <Card className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.name}</span>
                <Money value={r.open} />
              </Card>
            </Link>
          )}
        />
      )}
    </>
  );
}

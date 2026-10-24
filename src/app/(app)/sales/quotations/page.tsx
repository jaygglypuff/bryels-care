import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listQuotes } from "@/modules/sales";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td, buttonClass, cx } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { Money, SalesStatus } from "../orders/sales-ui";

export const metadata = { title: "Quotations" };

const TABS = [
  ["", "All"],
  ["draft", "Draft"],
  ["pending_approval", "Pending approval"],
  ["sent", "Sent"],
  ["accepted", "Accepted"],
  ["converted", "Converted"],
] as const;

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.quote.view")) return <Forbidden what="quotations" />;
  const { status = "" } = await searchParams;
  const rows = await listQuotes(ctx, { status: status || undefined });
  return (
    <>
      <PageHeader
        title="Quotations"
        subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name} · draft → sent (or pending approval above the discount threshold) → accepted → converted to an order`}
        actions={
          <>
            {ctx.can("sales.quote.export") && (
              <a className={buttonClass("secondary")} href={`/api/v1/sales/quotations/export?format=csv${status ? `&status=${status}` : ""}`}>
                Export CSV
              </a>
            )}
            {ctx.can("sales.quote.create") && <LinkButton href="/sales/quotations/new" variant="cta">New quotation</LinkButton>}
          </>
        }
      />
      <nav aria-label="Filter by status" className="mb-4 flex gap-1 overflow-x-auto rounded-[12px] border border-line bg-surface p-1">
        {TABS.map(([k, l]) => (
          <Link key={k || "all"} href={k ? `/sales/quotations?status=${k}` : "/sales/quotations"} aria-current={k === status ? "page" : undefined} className={cx("inline-flex min-h-[40px] items-center whitespace-nowrap rounded-[9px] px-3 text-[13px] font-medium", k === status ? "bg-primary-soft text-primary-text" : "text-fg-2 hover:bg-surface-2")}>
            {l}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState title={status ? "No quotations in this state" : "No quotations yet"} action={ctx.can("sales.quote.create") ? <LinkButton href="/sales/quotations/new">Create a quotation</LinkButton> : undefined}>
          Quotations of {ctx.currentSite.name} appear here.
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-3 sm:hidden">
            {rows.map((q) => (
              <li key={q.id}>
                <Link href={`/sales/quotations/${q.id}`}>
                  <Card className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{q.quoteNumber}</span>
                      <SalesStatus status={q.status} />
                    </div>
                    <p className="text-[13px]">{q.customerName}</p>
                    <div className="flex justify-between text-[12px] text-muted">
                      <span>valid until {fmtDate(q.validUntil)}</span>
                      <Money value={q.totalAmount} />
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <Table className="hidden sm:block" head={["Quotation", "Customer", "Valid until", "Total", "Status"]}>
            {rows.map((q) => (
              <tr key={q.id} className="hover:bg-surface-2">
                <Td>
                  <Link className="font-medium text-primary-text hover:underline" href={`/sales/quotations/${q.id}`}>
                    {q.quoteNumber}
                  </Link>
                </Td>
                <Td>{q.customerName}</Td>
                <Td>{fmtDate(q.validUntil)}</Td>
                <Td className="font-medium">
                  <Money value={q.totalAmount} />
                </Td>
                <Td>
                  <SalesStatus status={q.status} />
                </Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}

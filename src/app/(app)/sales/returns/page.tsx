import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { RETURN_STATUS_LABEL, listCustomerReturns, type CustomerReturnStatus } from "@/modules/sales";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td, cx } from "@/ui/core";
import { Help } from "@/ui/help/help";
import { Forbidden } from "../../forbidden";
import { ReturnStatusChip } from "./_ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["active", "In progress"],
  ["closed", "Closed"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
] as const;

export default async function ReturnsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.customer_return.view")) return <Forbidden what="customer returns" />;
  const { status = "active" } = await searchParams;
  const rows = await listCustomerReturns(ctx, { status });
  return (
    <>
      <PageHeader
        title="Customer returns"
        subtitle="Returned boxes are scanned against the delivery receipt, approved, and received into quarantine for QA to disposition."
        actions={<><Help screen="sales.return" />{ctx.can("sales.customer_return.create") ? <LinkButton href="/sales/returns/new" variant="cta">New return</LinkButton> : undefined}</>}
      />
      <Card>
        <nav className="mb-3 flex flex-wrap gap-2" aria-label="Filter returns">
          {FILTERS.map(([v, label]) => (
            <Link key={v} href={`/sales/returns?status=${v}`} className={cx("rounded-full border px-3 py-1 text-[13px]", status === v ? "border-ring bg-primary-soft font-medium" : "border-line hover:bg-surface-2")}>
              {label}
            </Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          <EmptyState title="No returns here" action={ctx.can("sales.customer_return.create") ? <LinkButton href="/sales/returns/new" variant="secondary">New return</LinkButton> : undefined}>
            Open a return from the delivery receipt when a customer sends goods back.
          </EmptyState>
        ) : (
          <Table head={["Return", "Status", "Customer", "Delivery receipt", "Lines", "Opened", "Received"]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap font-medium">
                  <Link className="text-primary-text hover:underline" href={`/sales/returns/${r.id}`}>
                    {r.number}
                  </Link>
                  <div className="text-[12px] text-muted">{r.siteCode}</div>
                </Td>
                <Td>
                  <ReturnStatusChip status={r.status} label={RETURN_STATUS_LABEL[r.status as CustomerReturnStatus]} />
                </Td>
                <Td>{r.customerName}</Td>
                <Td className="whitespace-nowrap">
                  {r.drNumber}
                  <div className="text-[12px] text-muted">{r.orderNumber}</div>
                </Td>
                <Td>
                  {r.lineCount} <span className="text-[12px] text-muted">({r.totalQty})</span>
                </Td>
                <Td className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</Td>
                <Td className="whitespace-nowrap">{r.receivedAt ? fmtDateTime(r.receivedAt) : "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

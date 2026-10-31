import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listCustomerReturns } from "@/modules/sales";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Help } from "@/ui/help/help";
import { Forbidden } from "../../forbidden";
import { ReturnStatusChip } from "./_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer returns" };

const FILTERS = [
  ["active", "Not finished"],
  ["closed", "Done"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
] as const;

export default async function ReturnsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.customer_return.view")) return <Forbidden what="customer returns" />;
  const { status = "active" } = await searchParams;
  const rows = await listCustomerReturns(ctx, { status });
  const canCreate = ctx.can("sales.customer_return.create");
  return (
    <>
      <PageHeader
        title="Customer returns"
        actions={
          <>
            {canCreate ? <LinkButton href="/sales/returns/new" variant="cta">New customer return</LinkButton> : undefined}
            <Help screen="sales.return" />
          </>
        }
      />
      <PageIntro>This screen is for goods a customer sends back. Each box is scanned, approved, and kept apart until QA says what happens to it.</PageIntro>
      <FilterTabs label="Filter customer returns" active={status} tabs={FILTERS.map(([v, label]) => [v, label, `/sales/returns?status=${v}`] as const)} />
      {rows.length === 0 ? (
        <EmptyState title="No customer returns here" action={canCreate ? <LinkButton href="/sales/returns/new">New customer return</LinkButton> : undefined}>
          {canCreate ? "When a customer sends goods back, tap New customer return and choose the delivery they came from." : "When a customer sends goods back, the warehouse or sales team records it here."}
        </EmptyState>
      ) : (
        <PlainList label="Customer returns">
          {rows.map((r) => (
            <PlainRow
              key={r.id}
              href={`/sales/returns/${r.id}`}
              title={r.customerName}
              code={[r.number, r.drNumber, r.orderNumber].filter(Boolean).join(" · ")}
              status={<ReturnStatusChip status={r.status} />}
              facts={
                <>
                  {r.lineCount} item(s), {r.totalQty} · started {fmtDateTime(r.createdAt)}
                  {r.receivedAt ? ` · back in ${fmtDateTime(r.receivedAt)}` : ""} · {r.siteCode}
                </>
              }
            />
          ))}
        </PlainList>
      )}
    </>
  );
}

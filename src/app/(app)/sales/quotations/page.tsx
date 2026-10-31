import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listQuotes } from "@/modules/sales";
import { EmptyState, LinkButton, PageHeader, buttonClass } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Forbidden } from "../../forbidden";
import { Money, SalesStatus } from "../orders/sales-ui";

export const metadata = { title: "Price offers" };

const TABS = [
  ["", "All"],
  ["draft", "Draft"],
  ["pending_approval", "Waiting for approval"],
  ["sent", "Sent to customer"],
  ["accepted", "Customer said yes"],
  ["converted", "Made into an order"],
] as const;

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("sales.quote.view")) return <Forbidden what="price offers" />;
  const { status = "" } = await searchParams;
  const rows = await listQuotes(ctx, { status: status || undefined });
  const canCreate = ctx.can("sales.quote.create");
  return (
    <>
      <PageHeader
        title="Price offers"
        subtitle={ctx.currentSite.name}
        actions={
          <>
            {canCreate && <LinkButton href="/sales/quotations/new" variant="cta">New price offer</LinkButton>}
            {ctx.can("sales.quote.export") && (
              <MoreMenu>
                <a className={buttonClass("secondary")} href={`/api/v1/sales/quotations/export?format=csv${status ? `&status=${status}` : ""}`}>
                  Download the list (CSV)
                </a>
              </MoreMenu>
            )}
          </>
        }
      />
      <PageIntro>This screen is for price offers (quotations): the prices we promise a customer before they order. When the customer says yes, it becomes an order in one tap.</PageIntro>
      <FilterTabs label="Filter by status" active={status} tabs={TABS.map(([k, l]) => [k, l, k ? `/sales/quotations?status=${k}` : "/sales/quotations"] as const)} />
      {rows.length === 0 ? (
        <EmptyState title={status ? "No price offers here" : "No price offers yet"} action={canCreate ? <LinkButton href="/sales/quotations/new">New price offer</LinkButton> : undefined}>
          {canCreate ? "Tap New price offer, choose the customer and the products; the usual prices fill in." : "The sales team makes price offers. Ask them if one is missing."}
        </EmptyState>
      ) : (
        <PlainList label="Price offers">
          {rows.map((q) => (
            <PlainRow
              key={q.id}
              href={`/sales/quotations/${q.id}`}
              title={q.customerName}
              code={q.quoteNumber}
              status={<SalesStatus status={q.status} />}
              facts={`Good until ${fmtDate(q.validUntil)}`}
              aside={<Money className="text-[15px] font-semibold tabular text-fg" value={q.totalAmount} />}
            />
          ))}
        </PlainList>
      )}
    </>
  );
}

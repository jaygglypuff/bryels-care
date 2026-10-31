import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listPurchaseRequests } from "@/modules/procurement";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Forbidden } from "../../forbidden";
import { Amount, PrChip, SubNav, money } from "../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Requests to buy" };

const FILTERS = [
  ["open", "Not done"],
  ["submitted", "To approve"],
  ["approved", "Approved"],
  ["converted", "Ordered"],
  ["rejected", "Not approved"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
] as const;

/** Requests to buy (purchase requests): what is wanted first, who asked, estimate on the right, number small and grey. */
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.purchase_request.view")) return <Forbidden what="requests to buy" />;
  const { status = "open" } = await searchParams;
  const rows = await listPurchaseRequests(ctx, { status });
  const prices = ctx.can("masterdata.supplier_price.view");
  const canCreate = ctx.can("procurement.purchase_request.create");
  return (
    <>
      <PageHeader title="Requests to buy" actions={canCreate ? <LinkButton href="/procurement/requests/new" variant="cta">Ask to buy something</LinkButton> : undefined} />
      <PageIntro>This screen is for asking the company to buy something. The manager approves it, then purchasing orders it from a supplier.</PageIntro>
      <SubNav />
      <Card>
        <FilterTabs label="Filter requests" active={status} tabs={FILTERS.map(([v, l]) => [v, l, `/procurement/requests?status=${v}`] as const)} />
        {rows.length === 0 ? (
          <EmptyState title="No requests here" action={canCreate ? <LinkButton href="/procurement/requests/new" variant="secondary">Ask to buy something</LinkButton> : undefined}>
            Need an item? Tap “Ask to buy something”. Requests also come from the “Running low” list.
          </EmptyState>
        ) : (
          <PlainList label="Requests to buy">
            {rows.map((r) => (
              <PlainRow
                key={r.id}
                testId="pr-row"
                href={`/procurement/requests/${r.id}`}
                title={r.items || "No items yet"}
                code={r.number}
                status={<PrChip status={r.status} />}
                facts={`Asked by ${r.requestedByName}${r.neededByDate ? ` · needed by ${fmtDate(r.neededByDate)}` : ""} · ${r.siteCode}`}
                aside={prices && r.estimatedTotalAmount ? <Amount>{money(r.estimatedTotalAmount)}</Amount> : undefined}
              />
            ))}
          </PlainList>
        )}
      </Card>
    </>
  );
}

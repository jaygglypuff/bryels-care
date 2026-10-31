import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listRecallCases } from "@/modules/quality";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Forbidden } from "../../forbidden";
import { RecallStatusChip } from "../capa/_ui";

const KIND_WORD: Record<string, string> = { recall: "Product recall", withdrawal: "Take off the shelves (withdrawal)", mock: "Practice recall (drill)" };


export const dynamic = "force-dynamic";

const FILTERS = [
  ["active", "Not done"],
  ["submitted", "Waiting for approval"],
  ["closed", "Closed"],
  ["all", "All"],
] as const;

/** Recall cases (US-6-18, ux-system §9.14): recalls, withdrawals and mock recall drills. */
export default async function RecallCasesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.recall_case.view")) return <Forbidden what="product recalls" />;
  const { status = "active" } = await searchParams;
  const rows = await listRecallCases(ctx, { status });
  return (
    <>
      <PageHeader
        title="Product recalls"
        actions={ctx.can("quality.genealogy.view") ? <LinkButton href="/quality/recall" variant="cta">Start from a product</LinkButton> : undefined}
      />
      <PageIntro>This screen is for QA and the owner: when a product must come back from customers. Two people approve, then the stock is stopped, customers are told and the products are counted back.</PageIntro>
      <Card>
        <FilterTabs label="Filter product recalls" active={status} tabs={FILTERS.map(([v, l]) => [v, l, `/quality/recalls?status=${v}`] as const)} />
        {rows.length === 0 ? (
          <EmptyState title="No product recalls here" action={ctx.can("quality.genealogy.view") ? <LinkButton href="/quality/recall" variant="secondary">Who received it</LinkButton> : undefined}>
            Start from the product: “Who received it” lists every customer, then “Start a product recall”. A practice recall (drill) is a good way to learn it. Questions? Ask the QA lead.
          </EmptyState>
        ) : (
          <PlainList label="Product recalls">
            {rows.map((r) => (
              <PlainRow
                key={r.id}
                href={`/quality/recalls/${r.id}`}
                title={r.title}
                code={r.number}
                status={<RecallStatusChip status={r.status} />}
                facts={
                  <>
                    {KIND_WORD[r.kind] ?? r.kindLabel} · {r.lots} lot(s) · {r.notified} of {r.customers} customer(s) told · {r.openedByName}, {fmtDateTime(r.openedAt)}
                  </>
                }
              />
            ))}
          </PlainList>
        )}
      </Card>
    </>
  );
}

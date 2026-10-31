import { Search } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listComplaints } from "@/modules/quality";
import { Card, EmptyState, Input, LinkButton, PageHeader, buttonClass } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Help } from "@/ui/help/help";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { ComplaintStatusChip, TraceMatchChip } from "./_ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["active", "Not closed"],
  ["closed", "Closed"],
  ["all", "All"],
] as const;

export default async function ComplaintsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.complaint.view")) return <Forbidden what="complaints" />;
  const { status = "active", q = "" } = await searchParams;
  const rows = await listComplaints(ctx, { status, q });
  return (
    <>
      <PageHeader
        title="Customer complaints"
        actions={<><Help screen="quality.complaint" />{ctx.can("quality.complaint.create") ? <LinkButton href="/quality/complaints/new" variant="cta">Write down a complaint</LinkButton> : undefined}</>}
      />
      <PageIntro>This screen is for sales and QA: write down what a customer complains about, then QA finds out why and answers.</PageIntro>
      <Card>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <FilterTabs label="Filter complaints" active={status} tabs={FILTERS.map(([v, l]) => [v, l, `/quality/complaints?status=${v}${q ? `&q=${encodeURIComponent(q)}` : ""}`] as const)} />
          <form method="get" action="/quality/complaints" className="flex min-w-0 gap-2">
            <input type="hidden" name="status" value={status} />
            <Input name="q" defaultValue={q} placeholder="Customer, product or number" aria-label="Search complaints" className="min-w-0" />
            <button type="submit" className={buttonClass("secondary")} aria-label="Search">
              <Search size={16} />
            </button>
          </form>
        </div>
        {rows.length === 0 ? (
          <EmptyState title={q ? "No complaint matches" : "No complaints here"} action={ctx.can("quality.complaint.create") ? <LinkButton href="/quality/complaints/new" variant="secondary">Write down a complaint</LinkButton> : undefined}>
            {q ? "Try another customer name, product or number." : "When a customer calls or writes about a problem, sales or QA write it down here. Questions? Ask the QA lead."}
          </EmptyState>
        ) : (
          <PlainList label="Complaints">
            {rows.map((r) => (
              <PlainRow
                key={r.id}
                href={`/quality/complaints/${r.id}`}
                title={`${r.customerName}: ${r.categoryLabel}`}
                code={r.number}
                tone={r.recallReviewFlagged ? "bad" : undefined}
                status={
                  <>
                    <ComplaintStatusChip status={r.status} />
                    {r.recallReviewFlagged && <Chip tone="bad">Check if a recall is needed</Chip>}
                  </>
                }
                facts={
                  <>
                    {r.productName ?? "Product not known"}
                    {r.lotNumber ? ` · lot ${r.lotNumber}` : ""} · {r.severity ? `how serious: ${r.severity}` : "not rated yet"} · {fmtDateTime(r.receivedAt)}
                    <span className="ml-1 inline-block align-middle">
                      <TraceMatchChip match={r.traceMatch} />
                    </span>
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

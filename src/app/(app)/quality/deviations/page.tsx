import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { DEVIATION_SOURCE_LABEL, listDeviations, type DeviationSource } from "@/modules/quality";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { DeviationStatusChip } from "../_ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["active", "Not closed"],
  ["closed", "Closed"],
  ["all", "All"],
] as const;

export default async function DeviationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.deviation.view")) return <Forbidden what="deviations" />;
  const { status = "active" } = await searchParams;
  const rows = await listDeviations(ctx, { status });
  const exportStatus = status === "active" ? "active" : status;
  return (
    <>
      <PageHeader
        title="Problem reports"
        subtitle={ctx.currentSite.name}
        actions={
          ctx.can("quality.deviation.export") ? (
            <MoreMenu>
              <div className="flex flex-col gap-2">
                <a className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2" href={`/api/v1/quality/deviations/export?status=${exportStatus}&format=csv`}>
                  Download (CSV)
                </a>
                <a className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2" href={`/api/v1/quality/deviations/export?status=${exportStatus}&format=xlsx`}>
                  Download (Excel)
                </a>
              </div>
            </MoreMenu>
          ) : undefined
        }
      />
      <PageIntro>This screen is for QA: every time something did not go as planned (a weighing, a step, a test). While a report is open, its batch or lot cannot be made OK to use.</PageIntro>
      <Card>
        <FilterTabs label="Filter problem reports" active={status} tabs={FILTERS.map(([v, l]) => [v, l, `/quality/deviations?status=${v}`] as const)} />
        {rows.length === 0 ? (
          <EmptyState title="No problem reports here" action={<LinkButton href="/production" variant="secondary">Batches</LinkButton>}>
            To report a problem, open the batch or lot it is about and use ⋯ More → Report a problem. Reports also appear by themselves when a supervisor approves a weighing or reading outside the limits.
          </EmptyState>
        ) : (
          <PlainList label="Problem reports">
            {rows.map((r) => (
              <PlainRow
                key={r.id}
                href={`/quality/deviations/${r.id}`}
                title={r.description.length > 90 ? `${r.description.slice(0, 90)}…` : r.description}
                code={r.number}
                tone={r.status === "open" ? "bad" : undefined}
                status={
                  <>
                    <DeviationStatusChip status={r.status} />
                    {r.status === "closed" && r.releasePermitted === false && <Chip tone="rej">May not be made OK</Chip>}
                  </>
                }
                facts={
                  <>
                    {r.batchNumber ? `Batch ${r.batchNumber}` : `Lot ${r.lotNumber}`}
                    {r.stepRef ? ` · ${r.stepRef}` : ""} · {r.raisedByName}, {fmtDateTime(r.raisedAt)} · {r.severity ? `how serious: ${r.severity}` : "not rated yet"} · {DEVIATION_SOURCE_LABEL[r.source as DeviationSource] ?? r.source}
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

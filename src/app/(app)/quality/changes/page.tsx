import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { listChangeControls } from "@/modules/quality";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Forbidden } from "../../forbidden";
import { ChangeStatusChip } from "../capa/_ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["active", "Not done"],
  ["submitted", "Waiting for approval"],
  ["approved", "Approved – to do"],
  ["closed", "Closed"],
  ["all", "All"],
] as const;

/** Change control register (US-6-18): proposals to change formula, routing, inspection-plan or work-instruction revisions. */
export default async function ChangesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.change_control.view")) return <Forbidden what="change requests" />;
  const { status = "active" } = await searchParams;
  const rows = await listChangeControls(ctx, { status });
  return (
    <>
      <PageHeader
        title="Change requests"
        actions={ctx.can("quality.change_control.create") ? <LinkButton href="/quality/changes/new" variant="cta">Ask for a change</LinkButton> : undefined}
      />
      <PageIntro>This screen is for QA and managers: before a recipe, its steps or its tests change, someone asks for the change, says what it affects, and it is approved.</PageIntro>
      <Card>
        <FilterTabs label="Filter change requests" active={status} tabs={FILTERS.map(([v, l]) => [v, l, `/quality/changes?status=${v}`] as const)} />
        {rows.length === 0 ? (
          <EmptyState title="No change requests here">Ask for a change before you change a recipe, its steps or its tests. QA approves it; then the new version gets its own approval. Questions? Ask the QA lead.</EmptyState>
        ) : (
          <PlainList label="Change requests">
            {rows.map((r) => (
              <PlainRow
                key={r.id}
                href={`/quality/changes/${r.id}`}
                title={r.title}
                code={r.number}
                status={<ChangeStatusChip status={r.status} />}
                facts={
                  <>
                    {r.entityTypeLabel.replace("Formula revision", "Recipe").replace("Routing revision", "Steps").replace("Inspection plan revision", "Quality checks for this item").replace("Work instruction revision", "Work instruction")}
                    {r.entityLabel ? ` (${r.entityLabel})` : ""} · {r.riskLevel ? `risk: ${r.riskLevel}` : "risk not rated"}
                    {r.targetDate ? ` · by ${fmtDate(r.targetDate)}` : ""} · {r.createdByName}, {fmtDateTime(r.createdAt)}
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

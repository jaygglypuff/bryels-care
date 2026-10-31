import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { flowHref } from "@/modules/production";
import { inspectionCandidates, listInspections } from "@/modules/quality";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Explain, PageIntro } from "@/ui/guide";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { InspectionStatusChip } from "../_ui";
import { StartInspectionButton } from "../w2c-forms";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["open", "Not finished"],
  ["approved", "Checked"],
  ["rejected", "Not accepted"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
] as const;

export default async function InspectionsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.inspection.view")) return <Forbidden what="inspections" />;
  const { status = "open" } = await searchParams;
  const [rows, candidates] = await Promise.all([listInspections(ctx, { status }), inspectionCandidates(ctx)]);
  const canStart = ctx.can("quality.inspection.create");

  return (
    <>
      <PageHeader title="Quality tests" subtitle={ctx.currentSite.name} actions={<LinkButton href="/quality" variant="secondary">Check a batch or delivery</LinkButton>} />
      <PageIntro>
        This screen is for QA: the tests on deliveries and batches. Take a sample, type the results, then a second QA person checks them.
      </PageIntro>
      <div className="-mt-3 mb-4"><Explain term="quality_check" /></div>
      <div className="flex flex-col gap-5">
        {candidates.batches.length > 0 && (
          <Card>
            <CardTitle>Batches waiting for their tests to start</CardTitle>
            <ul className="flex flex-col divide-y divide-line">
              {candidates.batches.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link className="font-medium text-primary-text hover:underline" href={`/quality/batches/${b.id}`}>
                      {b.productName}
                    </Link>
                    <p className="font-mono text-[12px] text-muted">{b.number}</p>
                  </div>
                  {canStart && <StartInspectionButton batchId={b.id} />}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {candidates.steps.length > 0 && (
          <Card>
            <CardTitle>Production steps waiting for a QA check</CardTitle>
            <p className="mb-2 text-[13px] text-muted">Production cannot go on with the step until a second QA person accepts an OK check.</p>
            <ul className="flex flex-col divide-y divide-line">
              {candidates.steps.map((st) => (
                <li key={st.processStepRecordId} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link className="font-medium text-primary-text hover:underline" href={flowHref({ batchId: st.batchId, workOrderId: st.workOrderId }, `step/${st.stepNo}`)}>
                      Step {st.stepNo}: {st.stepName}
                    </Link>
                    <p className="font-mono text-[12px] text-muted">{st.batchNumber}</p>
                  </div>
                  {ctx.can("quality.inspection.approve") && <StartInspectionButton batchId={st.batchId} processStepRecordId={st.processStepRecordId} />}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <FilterTabs label="Filter quality checks" active={status} tabs={FILTERS.map(([v, l]) => [v, l, `/quality/inspections?status=${v}`] as const)} />
          {rows.length === 0 ? (
            <EmptyState title="No quality checks here">A check starts from a delivery waiting for QA (open it from Check a batch or delivery) or by itself when a batch is finished. Questions? Ask the QA lead.</EmptyState>
          ) : (
            <PlainList label="Quality checks">
              {rows.map((r) => (
                <PlainRow
                  key={r.id}
                  href={`/quality/inspections/${r.id}`}
                  title={r.itemName ?? r.batchNumber ?? r.lotNumber}
                  code={r.number}
                  tone={r.overdue ? "warn" : undefined}
                  status={
                    <>
                      <InspectionStatusChip status={r.status} outcome={r.outcome} />
                      {r.planIsPlaceholder && <Chip tone="warn">Demo test list</Chip>}
                      {r.overdue && <Chip tone="bad">Late</Chip>}
                    </>
                  }
                  facts={
                    <>
                      {r.kind === "incoming" ? "Delivery" : r.kind === "in_process" ? "Production step, batch" : "Batch"} {r.batchNumber ?? r.lotNumber} · {r.liveResults} of {r.requiredTests} tests typed{r.dueAt ? ` · due ${fmtDateTime(r.dueAt)}` : ""}
                    </>
                  }
                />
              ))}
            </PlainList>
          )}
        </Card>
      </div>
    </>
  );
}

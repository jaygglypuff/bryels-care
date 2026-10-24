import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { inspectionCandidates, listInspections } from "@/modules/quality";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader, Table, Td, cx } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { InspectionStatusChip } from "../_ui";
import { StartInspectionButton } from "../w2c-forms";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["open", "Open"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
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
      <PageHeader
        title="Inspections"
        subtitle={`${ctx.currentSite.code} · sampling, test results against the approved inspection plan, and review by a second QA user`}
        actions={<LinkButton href="/quality" variant="secondary">QA queue</LinkButton>}
      />
      <div className="flex flex-col gap-5">
        {candidates.batches.length > 0 && (
          <Card>
            <CardTitle>Batches waiting for their inspection to start</CardTitle>
            <ul className="flex flex-col divide-y divide-line">
              {candidates.batches.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link className="font-medium text-primary-text hover:underline" href={`/quality/batches/${b.id}`}>
                      {b.number}
                    </Link>
                    <p className="text-[13px] text-muted">
                      {b.productName} · plan {b.planCode} rev {b.planRevision} · {b.status.replace(/_/g, " ")}
                    </p>
                  </div>
                  {canStart && <StartInspectionButton batchId={b.id} />}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <nav className="mb-3 flex flex-wrap gap-2" aria-label="Filter inspections">
            {FILTERS.map(([v, label]) => (
              <Link key={v} href={`/quality/inspections?status=${v}`} className={cx("rounded-full border px-3 py-1 text-[13px]", status === v ? "border-ring bg-primary-soft font-medium" : "border-line hover:bg-surface-2")}>
                {label}
              </Link>
            ))}
          </nav>
          {rows.length === 0 ? (
            <EmptyState title="No inspections here">Inspections start from a quarantined material lot (lot page) or a batch with an approved inspection plan.</EmptyState>
          ) : (
            <Table head={["Inspection", "Subject", "Plan", "Status", "Results", "Due"]}>
              {rows.map((r) => (
                <tr key={r.id} className={cx(r.overdue && "bg-[var(--warn-bg)]")}>
                  <Td className="whitespace-nowrap font-medium">
                    <Link className="text-primary-text hover:underline" href={`/quality/inspections/${r.id}`}>
                      {r.number}
                    </Link>
                    <div className="text-[12px] text-muted">{r.kind.replace(/_/g, " ")}</div>
                  </Td>
                  <Td>
                    {r.batchNumber ?? r.lotNumber}
                    <div className="text-[12px] text-muted">{r.itemName}</div>
                  </Td>
                  <Td>
                    {r.planCode} rev {r.planRevision}
                    {r.planIsPlaceholder && (
                      <div className="mt-0.5">
                        <Chip tone="warn">Placeholder spec</Chip>
                      </div>
                    )}
                  </Td>
                  <Td>
                    <InspectionStatusChip status={r.status} outcome={r.outcome} />
                  </Td>
                  <Td>
                    {r.liveResults} / {r.requiredTests} required
                  </Td>
                  <Td className="whitespace-nowrap">
                    {fmtDateTime(r.dueAt)}
                    {r.overdue && <div className="text-[12px] font-medium text-[var(--warn-fg)]">Overdue</div>}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

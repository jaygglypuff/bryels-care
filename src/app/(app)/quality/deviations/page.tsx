import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { DEVIATION_SOURCE_LABEL, listDeviations, type DeviationSource } from "@/modules/quality";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td, cx } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { DeviationStatusChip } from "../_ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["active", "Open and investigating"],
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
        title="Deviations"
        subtitle={`${ctx.currentSite.code} · departures from the process, raised from a step, lot or batch; open deviations block release`}
        actions={
          ctx.can("quality.deviation.export") ? (
            <>
              <a className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2" href={`/api/v1/quality/deviations/export?status=${exportStatus}&format=csv`}>
                Export CSV
              </a>
              <a className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2" href={`/api/v1/quality/deviations/export?status=${exportStatus}&format=xlsx`}>
                Export XLSX
              </a>
            </>
          ) : undefined
        }
      />
      <Card>
        <nav className="mb-3 flex flex-wrap gap-2" aria-label="Filter deviations">
          {FILTERS.map(([v, label]) => (
            <Link key={v} href={`/quality/deviations?status=${v}`} className={cx("rounded-full border px-3 py-1 text-[13px]", status === v ? "border-ring bg-primary-soft font-medium" : "border-line hover:bg-surface-2")}>
              {label}
            </Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          <EmptyState title="No deviations here" action={<LinkButton href="/production" variant="secondary">Batches</LinkButton>}>
            Raise a deviation from a batch, lot or inspection page; automatic ones appear when an exception is approved.
          </EmptyState>
        ) : (
          <Table head={["Deviation", "Status", "Severity", "Subject", "What happened", "Raised"]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap font-medium">
                  <Link className="text-primary-text hover:underline" href={`/quality/deviations/${r.id}`}>
                    {r.number}
                  </Link>
                  <div className="text-[12px] text-muted">{DEVIATION_SOURCE_LABEL[r.source as DeviationSource] ?? r.source}</div>
                </Td>
                <Td>
                  <DeviationStatusChip status={r.status} />
                  {r.status === "closed" && r.releasePermitted === false && (
                    <div className="mt-0.5">
                      <Chip tone="rej">Release not permitted</Chip>
                    </div>
                  )}
                </Td>
                <Td>{r.severity ?? <span className="text-muted">Not classified</span>}</Td>
                <Td>
                  {r.batchNumber ?? r.lotNumber}
                  {r.stepRef && <div className="text-[12px] text-muted">{r.stepRef}</div>}
                </Td>
                <Td className="max-w-[320px] text-[13px] text-fg-2">{r.description}</Td>
                <Td className="whitespace-nowrap">
                  {fmtDateTime(r.raisedAt)}
                  <div className="text-[12px] text-muted">{r.raisedByName}</div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDate, fmtDateTime, fmtMass, fmtQty } from "@/lib/qty";
import { type BatchListRow, listBatches, progressLabel } from "@/modules/production";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { StatusChip } from "@/ui/status";
import { Forbidden } from "../forbidden";
import { PageIntro } from "@/ui/guide";

export const metadata: Metadata = { title: "Batch records" };

const COLUMNS: { key: string; title: string; statuses: string[]; hint: string }[] = [
  { key: "planned", title: "Planned", statuses: ["draft", "planned"], hint: "Waiting to start" },
  { key: "in_process", title: "In process", statuses: ["materials_staged", "in_process"], hint: "Weighing and processing" },
  { key: "awaiting_qc", title: "Quality check", statuses: ["awaiting_qc", "quarantined", "rework_approved"], hint: "Output waiting for QA check, QA to decide" },
  { key: "released", title: "Released", statuses: ["released"], hint: "Approved by QA" },
];

function BatchCard({ b }: { b: BatchListRow }) {
  const total = b.stepsTotal;
  const pct = total ? Math.round((Math.min(b.stepsDone, total) / total) * 100) : 0;
  return (
    <Link
      href={`/production/${b.id}`}
      className="block rounded-[14px] border border-line bg-surface p-3.5 transition-shadow hover:shadow-sm focus-visible:shadow-sm"
      data-testid="batch-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="whitespace-nowrap font-mono text-[13px] font-semibold text-fg">{b.batchNumber}</p>
        <StatusChip status={b.status} />
      </div>
      <p className="mt-1 text-[14px] font-medium text-fg">{b.productName}</p>
      <p className="text-[12px] text-muted tabular">
        {fmtQty(D(b.plannedSizeG).div(1000), "kg", 1)} · {b.formulaCode} rev {b.revisionNo}
      </p>
      <div className="mt-2.5">
        <div className="flex items-center justify-between text-[12px] text-fg-2">
          <span>{progressLabel(b.status, b.stepsDone, total)}</span>
          <span className="tabular text-muted">{b.stepsDone}/{total}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <p className="mt-2 text-[12px] text-muted">
        {b.startedAt ? `Started ${fmtDateTime(b.startedAt)}` : b.plannedStartOn ? `Planned start ${fmtDate(b.plannedStartOn)}` : "Not scheduled"}
      </p>
    </Link>
  );
}

/**
 * Batch records (read-only, one path for production work 2026-10-31): every batch at the site, each
 * opening its batch record (what happened). Work on a batch is done from My work / Production orders;
 * a batch is made by approving a production order, so there is no "New batch" here any more.
 */
export default async function BatchesPage() {
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Forbidden what="production batches" />;
  const rows = await listBatches(ctx);
  const closedOrRejected = rows.filter((r) => r.status === "rejected" || r.status === "closed");

  return (
    <div>
      <PageHeader
        title="Batch records"
        subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name} · ${rows.length} batch${rows.length === 1 ? "" : "es"}`}
        actions={ctx.can("production.work_order.view") ? <LinkButton href="/production/orders" variant="secondary">Production orders</LinkButton> : undefined}
      />
      <PageIntro>Every batch at this site. Open one to see its record: who did each step, the numbers, materials and checks. To work on a batch, open My work or Production orders.</PageIntro>

      {rows.length === 0 ? (
        <EmptyState
          title="No batches at this site yet"
          action={ctx.can("production.work_order.create") ? <LinkButton href="/production/orders/new">New production order</LinkButton> : undefined}
        >
          A batch is made when a production order is approved. It then appears here with its record.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {COLUMNS.map((col) => {
              const items = rows.filter((r) => col.statuses.includes(r.status));
              return (
                <section key={col.key} className="flex min-w-0 flex-col rounded-[16px] border border-line bg-surface-2/60 p-3" aria-label={col.title}>
                  <header className="mb-2.5 flex items-baseline justify-between px-1">
                    <h2 className="text-[13px] font-semibold text-fg">{col.title}</h2>
                    <span className="text-[12px] text-muted tabular">{items.length}</span>
                  </header>
                  <div className="flex flex-col gap-2.5">
                    {items.length === 0 ? <p className="px-1 py-4 text-center text-[12px] text-muted">{col.hint}: none</p> : items.map((b) => <BatchCard key={b.id} b={b} />)}
                  </div>
                </section>
              );
            })}
          </div>

          <details className="mt-4 rounded-[16px] border border-line bg-surface p-4">
            <summary className="cursor-pointer text-[14px] font-medium text-fg">Rejected and closed ({closedOrRejected.length})</summary>
            {closedOrRejected.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">No rejected or closed batches.</p>
            ) : (
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                {closedOrRejected.map((b) => (
                  <BatchCard key={b.id} b={b} />
                ))}
              </div>
            )}
          </details>

          <Card className="mt-6 hidden md:block">
            <h2 className="mb-3 text-[15px] font-semibold">All batches</h2>
            <Table head={["Batch", "Product", "Formula", "Planned size", "Status", "Progress", "Started", "Completed", "Yield"]}>
              {rows.map((b) => (
                <tr key={b.id} className="hover:bg-surface-2/60">
                  <Td>
                    <Link href={`/production/${b.id}`} className="whitespace-nowrap font-mono font-semibold text-primary-text hover:underline">
                      {b.batchNumber}
                    </Link>
                  </Td>
                  <Td>{b.productName}</Td>
                  <Td className="whitespace-nowrap">
                    {b.formulaCode} rev {b.revisionNo}
                  </Td>
                  <Td className="whitespace-nowrap">{fmtMass(b.plannedSizeG)}</Td>
                  <Td>
                    <StatusChip status={b.status} />
                  </Td>
                  <Td className="whitespace-nowrap">{progressLabel(b.status, b.stepsDone, b.stepsTotal)}</Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(b.startedAt)}</Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(b.completedAt)}</Td>
                  <Td className="whitespace-nowrap">{b.yieldPct ? `${fmtQty(b.yieldPct, "%", 1)}` : "—"}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtMass } from "@/lib/qty";
import { canSeeStaging, listBatchesToStage } from "@/modules/production";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { Help } from "@/ui/help/help";

export const metadata: Metadata = { title: "Stage materials" };
export const dynamic = "force-dynamic";

export default async function StagingQueuePage() {
  const ctx = await requireContext();
  if (!canSeeStaging(ctx)) return <Forbidden what="material staging" />;
  const rows = await listBatchesToStage(ctx);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Stage materials" subtitle={`${ctx.currentSite.code} · batches of released work orders · pick reserved lots to the staging area by scan`} actions={<><Help screen="production.staging" /></>} />
      {rows.length === 0 ? (
        <EmptyState title="Nothing to stage" action={ctx.can("production.work_order.view") ? <LinkButton href="/production/work-orders" variant="secondary">Work orders</LinkButton> : undefined}>
          A batch appears here when its work order is released (materials reserved) and the batch is created.
        </EmptyState>
      ) : (
        <div className="grid gap-2.5">
          {rows.map((r) => (
            <Link key={r.id} href={`/production/staging/${r.id}`} className="block rounded-[16px] border border-line bg-surface p-4 hover:shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[14px] font-semibold">{r.batchNumber}</span>
                <StatusChip status={r.status} />
              </div>
              <p className="mt-1 text-[14px] font-medium">{r.productName}</p>
              <p className="text-[12px] text-muted">
                {r.workOrderNumber} · {fmtMass(r.plannedSizeG)} · start {fmtDate(r.plannedStartOn)}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Chip tone={r.linesStaged >= r.lines ? "ok" : "info"}>
                  {r.linesStaged} of {r.lines} ingredients staged
                </Chip>
                {!["released", "in_progress"].includes(r.workOrderStatus) && <Chip tone="warn">Work order {r.workOrderStatus.replace(/_/g, " ")}</Chip>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

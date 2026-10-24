import Link from "next/link";
import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtMass } from "@/lib/qty";
import { listWorkOrders } from "@/modules/production";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { workOrderCommandAction } from "../work-orders/actions";
import { CommandForm } from "../work-orders/command-form";

export const metadata: Metadata = { title: "New batch" };
export const dynamic = "force-dynamic";

/**
 * Batches come from planned or released work orders (US-3-06, W05-03): the batch freezes the
 * work order's formula and routing revisions, so there is no free-standing batch form any more.
 */
export default async function NewBatchPage() {
  const ctx = await requireContext();
  if (!ctx.can("production.batch.create")) return <Forbidden what="creating batches" />;
  const rows = ctx.can("production.work_order.view") ? (await listWorkOrders(ctx, { status: "open" })).filter((w) => ["planned", "released", "in_progress"].includes(w.status) && w.batchesTotal < w.batchCount) : [];
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New batch" subtitle={`${ctx.currentSite.code} · batches are created from a planned or released work order`} />
      {rows.length === 0 ? (
        <EmptyState title="No work order is waiting for batches" action={ctx.can("production.work_order.create") ? <LinkButton href="/production/work-orders/new">New work order</LinkButton> : <LinkButton href="/production/work-orders" variant="secondary">Work orders</LinkButton>}>
          Plan a work order first: planning resolves the approved formula and routing revisions that every batch then freezes.
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {rows.map((w) => (
            <div key={w.id} className="rounded-[16px] border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/production/work-orders/${w.id}`} className="font-mono text-[14px] font-semibold text-primary-text hover:underline">{w.workOrderNumber}</Link>
                <StatusChip status={w.status} />
              </div>
              <p className="mt-1 text-[14px] font-medium">{w.productName}</p>
              <p className="mb-3 text-[12px] text-muted">
                {w.batchesTotal} of {w.batchCount} batches · {fmtMass(w.batchSizeBase)} each · {fmtDate(w.plannedStart)} – {fmtDate(w.plannedEnd)}
              </p>
              <CommandForm action={workOrderCommandAction} fields={{ workOrderId: w.id, command: "create_batch" }} label={`Create batch ${w.batchesTotal + 1}`} variant="cta" size="sm" pendingText="Creating…" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { listMaintenanceWorkOrders } from "@/modules/maintenance";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { KIND_WORD, PriorityChip, WoStatusChip } from "../_ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["live", "Not done"],
  ["mine", "Mine"],
  ["completed", "Done"],
  ["all", "All"],
] as const;

/** Maintenance work orders (US-6-19): corrective, inspection and preventive work, newest first. */
export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("maintenance.work_order.view")) return <Forbidden what="repair jobs" />;
  const { status = "live" } = await searchParams;
  const rows = await listMaintenanceWorkOrders(ctx, status === "mine" ? { status: "live", mine: true } : { status });
  return (
    <>
      <PageHeader title="Repair jobs" actions={ctx.can("maintenance.work_order.create") ? <LinkButton href="/maintenance/work-orders/new" variant="cta">Report a broken machine</LinkButton> : undefined} />
      <PageIntro>This screen is for technicians: every repair, check and regular maintenance job. When a job is done, the machine&apos;s history is written by itself.</PageIntro>
      <Card>
        <FilterTabs label="Filter repair jobs" active={status} tabs={FILTERS.map(([v, l]) => [v, l, `/maintenance/work-orders?status=${v}`] as const)} />
        {rows.length === 0 ? (
          <EmptyState title="No repair jobs here">When a machine breaks, press “Report a broken machine”. Regular maintenance jobs are made from the maintenance that is due. Questions? Ask the maintenance lead.</EmptyState>
        ) : (
          <PlainList label="Repair jobs">
            {rows.map((w) => (
              <PlainRow
                key={w.id}
                href={`/maintenance/work-orders/${w.id}`}
                title={`${w.equipmentName}: ${w.title}`}
                code={w.workOrderNumber}
                tone={w.overdue ? "bad" : undefined}
                status={
                  <>
                    <WoStatusChip status={w.status} />
                    <PriorityChip priority={w.priority} />
                    {w.overdue && <Chip tone="bad">Late</Chip>}
                  </>
                }
                facts={
                  <>
                    {KIND_WORD[w.kind] ?? w.kindLabel} · {w.assigneeName ?? "nobody yet"}
                    {w.dueDate ? ` · by ${fmtDate(w.dueDate)}` : ""} · reported {fmtDateTime(w.createdAt)} · {w.siteCode}
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

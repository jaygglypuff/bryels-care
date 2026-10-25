import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { listMaintenanceWorkOrders } from "@/modules/maintenance";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { PriorityChip, WoStatusChip, tabCls } from "../_ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["live", "Open"],
  ["mine", "Assigned to me"],
  ["completed", "Completed"],
  ["all", "All"],
] as const;

/** Maintenance work orders (US-6-19): corrective, inspection and preventive work, newest first. */
export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("maintenance.work_order.view")) return <Forbidden what="maintenance work orders" />;
  const { status = "live" } = await searchParams;
  const rows = await listMaintenanceWorkOrders(ctx, status === "mine" ? { status: "live", mine: true } : { status });
  return (
    <>
      <PageHeader title="Maintenance work orders" subtitle="Breakdowns, inspections and preventive maintenance; completing one writes the equipment's service record" actions={ctx.can("maintenance.work_order.create") ? <LinkButton href="/maintenance/work-orders/new">Report a problem</LinkButton> : undefined} />
      <Card>
        <nav className="mb-3 flex flex-wrap gap-2" aria-label="Filter work orders">
          {FILTERS.map(([v, label]) => (
            <Link key={v} href={`/maintenance/work-orders?status=${v}`} className={tabCls(status === v)}>
              {label}
            </Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          <EmptyState title="No work orders here">Report a problem when equipment breaks down; PM work orders are raised from their plan.</EmptyState>
        ) : (
          <Table head={["Work order", "Equipment", "Kind", "State", "Priority", "Technician", "Due", "Raised"]}>
            {rows.map((w) => (
              <tr key={w.id}>
                <Td className="whitespace-nowrap font-medium">
                  <Link className="text-primary-text hover:underline" href={`/maintenance/work-orders/${w.id}`}>
                    {w.workOrderNumber}
                  </Link>
                  <div className="max-w-[220px] text-[12px] text-muted">{w.title}</div>
                </Td>
                <Td>
                  {w.equipmentCode} <span className="text-muted">{w.siteCode}</span>
                </Td>
                <Td>
                  {w.kindLabel}
                  {w.planNumber && <div className="text-[12px] text-muted">{w.planNumber}</div>}
                </Td>
                <Td>
                  <WoStatusChip status={w.status} />
                </Td>
                <Td>
                  <PriorityChip priority={w.priority} />
                </Td>
                <Td>{w.assigneeName ?? <span className="text-muted">Unassigned</span>}</Td>
                <Td className="whitespace-nowrap">
                  {w.dueDate ? fmtDate(w.dueDate) : "—"}
                  {w.overdue && (
                    <div className="mt-0.5">
                      <Chip tone="bad">Overdue</Chip>
                    </div>
                  )}
                </Td>
                <Td className="whitespace-nowrap">{fmtDateTime(w.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

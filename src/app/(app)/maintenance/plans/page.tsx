import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listMaintenancePlans } from "@/modules/maintenance";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { DueChip, tabCls } from "../_ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  ["live", "Active and paused"],
  ["active", "Active"],
  ["retired", "Retired"],
  ["all", "All"],
] as const;

/** PM plans (US-6-19): time- or usage-based, most urgent first. */
export default async function PlansPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("maintenance.plan.view")) return <Forbidden what="PM plans" />;
  const { status = "live" } = await searchParams;
  const rows = await listMaintenancePlans(ctx, { status });
  return (
    <>
      <PageHeader title="PM plans" subtitle="Preventive maintenance by time or by usage; an overdue plan blocks the equipment when its blocking rule says so" actions={ctx.can("maintenance.plan.create") ? <LinkButton href="/maintenance/plans/new">New PM plan</LinkButton> : undefined} />
      <Card>
        <nav className="mb-3 flex flex-wrap gap-2" aria-label="Filter plans">
          {FILTERS.map(([v, label]) => (
            <Link key={v} href={`/maintenance/plans?status=${v}`} className={tabCls(status === v)}>
              {label}
            </Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          <EmptyState title="No PM plans here" action={ctx.can("maintenance.plan.create") ? <LinkButton href="/maintenance/plans/new" variant="secondary">New PM plan</LinkButton> : undefined}>
            Create a plan for each piece of equipment that needs preventive maintenance (interval from the manufacturer or the maintenance lead).
          </EmptyState>
        ) : (
          <Table head={["Plan", "Equipment", "Basis", "Next due", "State", "Work order"]}>
            {rows.map((p) => (
              <tr key={p.id}>
                <Td className="whitespace-nowrap font-medium">
                  <Link className="text-primary-text hover:underline" href={`/maintenance/plans/${p.id}`}>
                    {p.planNumber}
                  </Link>
                  <div className="text-[12px] text-muted">{p.title}</div>
                </Td>
                <Td>
                  {p.equipmentCode} <span className="text-muted">{p.siteCode}</span>
                </Td>
                <Td>{p.triggerKind === "time" ? `Every ${p.intervalDays} days` : `Every ${Number(p.usageInterval)} ${p.usageUnit}`}</Td>
                <Td className="whitespace-nowrap">{p.triggerKind === "time" ? fmtDate(p.nextDueOn) : `${p.usage ?? 0} of ${Number(p.usageInterval)} used`}</Td>
                <Td>{p.status === "active" ? <DueChip state={p.dueState} /> : <Chip tone="neu">{p.status}</Chip>}</Td>
                <Td>{p.liveWorkOrder ? <Link className="text-primary-text hover:underline" href={`/maintenance/work-orders/${p.liveWorkOrder.id}`}>{p.liveWorkOrder.number}</Link> : <span className="text-muted">—</span>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

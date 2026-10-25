import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listMaintenancePlans, listMaintenanceWorkOrders, listSpareParts } from "@/modules/maintenance";
import { Card, CardTitle, EmptyState, Kpi, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../forbidden";
import { DueChip, PriorityChip, WoStatusChip } from "./_ui";

export const dynamic = "force-dynamic";

/** Maintenance overview (US-6-19): PM plans due or overdue, live work orders, spare parts below minimum. */
export default async function MaintenancePage() {
  const ctx = await requireContext();
  const canPlans = ctx.can("maintenance.plan.view");
  const canWos = ctx.can("maintenance.work_order.view");
  if (!canPlans && !canWos) return <Forbidden what="maintenance" />;
  const due = canPlans ? await listMaintenancePlans(ctx, { due: true }) : [];
  const wos = canWos ? await listMaintenanceWorkOrders(ctx, { status: "live" }) : [];
  const parts = ctx.can("maintenance.spare_part.view") ? (await listSpareParts(ctx)).filter((p) => p.belowMin) : [];
  const overdue = due.filter((p) => p.dueState === "overdue").length;
  return (
    <>
      <PageHeader
        title="Maintenance"
        subtitle="Preventive maintenance plans and work orders on the equipment register; overdue PM and work in progress block the equipment"
        actions={
          <>
            {ctx.can("maintenance.work_order.create") && <LinkButton href="/maintenance/work-orders/new">Report a problem</LinkButton>}
            {ctx.can("maintenance.plan.create") && (
              <LinkButton href="/maintenance/plans/new" variant="secondary">
                New PM plan
              </LinkButton>
            )}
          </>
        }
      />
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {canPlans && <Kpi label="PM overdue" value={overdue} tone={overdue ? "bad" : "good"} hint={overdue ? "Equipment blocked by its rule" : "Nothing overdue"} href="/maintenance/plans" />}
          {canPlans && <Kpi label="PM due soon" value={due.length - overdue} tone={due.length - overdue ? "warn" : "neutral"} href="/maintenance/plans" />}
          {canWos && <Kpi label="Open work orders" value={wos.length} href="/maintenance/work-orders" />}
          {canWos && <Kpi label="Equipment down" value={new Set(wos.filter((w) => w.equipmentStatus !== "in_service").map((w) => w.equipmentId)).size} tone="neutral" href="/maintenance/work-orders" />}
        </div>

        {canPlans && (
          <Card>
            <CardTitle action={<Link className="text-[13px] text-primary-text hover:underline" href="/maintenance/plans">All plans</Link>}>PM due</CardTitle>
            {due.length === 0 ? (
              <EmptyState title="No PM due">Every active plan is within its interval.</EmptyState>
            ) : (
              <Table head={["Plan", "Equipment", "Due", "State", "Work order"]}>
                {due.map((p) => (
                  <tr key={p.id}>
                    <Td className="whitespace-nowrap font-medium">
                      <Link className="text-primary-text hover:underline" href={`/maintenance/plans/${p.id}`}>
                        {p.planNumber}
                      </Link>
                      <div className="text-[12px] text-muted">{p.title}</div>
                    </Td>
                    <Td>
                      {p.equipmentCode} <span className="text-muted">{p.equipmentName}</span>
                    </Td>
                    <Td className="whitespace-nowrap">{p.triggerKind === "time" ? fmtDate(p.nextDueOn) : `${p.usage ?? 0} of ${Number(p.usageInterval)} ${p.usageUnit}`}</Td>
                    <Td>
                      <DueChip state={p.dueState} />
                    </Td>
                    <Td>{p.liveWorkOrder ? <Link className="text-primary-text hover:underline" href={`/maintenance/work-orders/${p.liveWorkOrder.id}`}>{p.liveWorkOrder.number}</Link> : <span className="text-muted">None yet</span>}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        )}

        {canWos && (
          <Card>
            <CardTitle action={<Link className="text-[13px] text-primary-text hover:underline" href="/maintenance/work-orders">All work orders</Link>}>Open work orders</CardTitle>
            {wos.length === 0 ? (
              <EmptyState title="No open work orders">Report a problem when equipment breaks down, or raise the PM work order from a due plan.</EmptyState>
            ) : (
              <Table head={["Work order", "Equipment", "State", "Priority", "Technician", "Due"]}>
                {wos.map((w) => (
                  <tr key={w.id}>
                    <Td className="whitespace-nowrap font-medium">
                      <Link className="text-primary-text hover:underline" href={`/maintenance/work-orders/${w.id}`}>
                        {w.workOrderNumber}
                      </Link>
                      <div className="text-[12px] text-muted">{w.title}</div>
                    </Td>
                    <Td>
                      {w.equipmentCode}
                      {w.equipmentStatus !== "in_service" && (
                        <div className="mt-0.5">
                          <Chip tone="bad">{w.equipmentStatus.replace(/_/g, " ")}</Chip>
                        </div>
                      )}
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
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        )}

        {parts.length > 0 && (
          <Card>
            <CardTitle action={<Link className="text-[13px] text-primary-text hover:underline" href="/maintenance/spare-parts">Spare parts</Link>}>Spare parts below minimum</CardTitle>
            <ul className="flex flex-col gap-1 text-[14px]">
              {parts.map((p) => (
                <li key={p.id}>
                  {p.materialCode} {p.materialName}: {Number(p.onHand)} {p.baseUom} on hand, minimum {Number(p.minQtyBase)}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getMaintenancePlan } from "@/modules/maintenance";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { DueChip, WoStatusChip } from "../../_ui";
import { EditPlanForm, PlanStatusForm, PlanWorkOrderForm } from "../../forms";

export const dynamic = "force-dynamic";

/** PM plan detail: due state, the live work order, history of completed PM, edit, pause / retire. */
export default async function PlanPage({ params, searchParams }: { params: Promise<{ planId: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("maintenance.plan.view")) return <Forbidden what="PM plans" />;
  const { planId } = await params;
  const sp = await searchParams;
  let v: Awaited<ReturnType<typeof getMaintenancePlan>>;
  try {
    v = await getMaintenancePlan(ctx, planId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="PM plan not found" action={<LinkButton href="/maintenance/plans" variant="secondary">PM plans</LinkButton>}>
          This plan does not exist or is not at one of your sites.
        </EmptyState>
      );
    }
    throw e;
  }
  const p = v.plan;
  return (
    <>
      <PageHeader title={p.planNumber} subtitle={`${p.title} · ${p.equipmentCode} ${p.equipmentName} · ${p.siteCode}`} actions={<LinkButton href="/maintenance/plans" variant="secondary">PM plans</LinkButton>} />
      <div className="flex flex-col gap-5">
        {sp.created && <Banner tone="ok" title={`PM plan ${p.planNumber} created`}>{p.triggerKind === "time" ? "The equipment's next maintenance date follows this plan." : "Usage is counted from production's equipment uses since now."}</Banner>}
        {p.dueState === "overdue" && <Banner tone="bad" title="Preventive maintenance overdue">The equipment shows a “maintenance due” reason; with blocking rule “block” it cannot be selected for production until the PM is completed.</Banner>}
        <Card>
          <CardTitle action={p.status === "active" ? <DueChip state={p.dueState} /> : <Chip tone="neu">{p.status}</Chip>}>Plan</CardTitle>
          <Dl
            items={[
              ["Equipment", <Link key="e" className="text-primary-text hover:underline" href={`/masterdata/equipment/${p.equipmentId}`}>{p.equipmentCode}</Link>],
              ["Basis", p.triggerKind === "time" ? `Every ${p.intervalDays} days` : `Every ${Number(p.usageInterval)} ${p.usageUnit} of use`],
              ["Next due", p.triggerKind === "time" ? fmtDate(p.nextDueOn) : `${p.usage ?? 0} of ${Number(p.usageInterval)} ${p.usageUnit} used since ${fmtDateTime(p.usageSince)}`],
              ["Last completed", p.lastCompletedAt ? fmtDateTime(p.lastCompletedAt) : "—"],
              ["Responsible", p.responsibleName ?? "—"],
              ["Equipment down during PM", p.takesEquipmentDown ? "Yes" : "No"],
              ["Status note", p.statusReason ?? "—"],
            ]}
          />
          {p.instructions && <p className="mt-4 whitespace-pre-wrap rounded-[12px] border border-line bg-surface-2 p-3 text-[14px]">{p.instructions}</p>}
        </Card>

        <Card>
          <CardTitle>Work order</CardTitle>
          {p.liveWorkOrder ? (
            <p className="flex flex-wrap items-center gap-2 text-[14px]">
              <Link className="font-medium text-primary-text hover:underline" href={`/maintenance/work-orders/${p.liveWorkOrder.id}`}>
                {p.liveWorkOrder.number}
              </Link>
              <WoStatusChip status={p.liveWorkOrder.status} />
            </p>
          ) : v.can.createWorkOrder ? (
            <PlanWorkOrderForm planId={p.id} technicians={v.technicians} defaultAssignee={p.responsibleUserId} defaultDue={p.nextDueOn} />
          ) : (
            <p className="text-[13px] text-muted">{p.status === "active" ? "Raising the PM work order needs maintenance.work_order.create." : "The plan is not active."}</p>
          )}
        </Card>

        {v.can.edit && (
          <Card>
            <CardTitle>Change the plan</CardTitle>
            <EditPlanForm plan={p} technicians={v.technicians} />
            <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
              {p.status === "active" && <PlanStatusForm planId={p.id} to="paused" label="Pause plan" />}
              {p.status === "paused" && <PlanStatusForm planId={p.id} to="active" label="Resume plan" />}
              <PlanStatusForm planId={p.id} to="retired" label="Retire plan" />
            </div>
          </Card>
        )}

        <Card>
          <CardTitle>History</CardTitle>
          {v.history.length === 0 ? (
            <p className="text-[13px] text-muted">No work orders yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[13px]">
              {v.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2">
                  <Link className="text-primary-text hover:underline" href={`/maintenance/work-orders/${h.id}`}>
                    {h.workOrderNumber}
                  </Link>
                  <WoStatusChip status={h.status} />
                  {h.completedAt && (
                    <span className="text-muted">
                      {fmtDateTime(h.completedAt)} · {h.completedByName} · {h.result}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

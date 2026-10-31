import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getMaintenancePlan } from "@/modules/maintenance";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { DueChip, WoStatusChip } from "../../_ui";
import { EditPlanForm, PlanStatusForm, PlanWorkOrderForm } from "../../forms";

export const dynamic = "force-dynamic";

/** PM plan detail: due state, the live work order, history of completed PM, edit, pause / retire. */
export default async function PlanPage({ params, searchParams }: { params: Promise<{ planId: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("maintenance.plan.view")) return <Forbidden what="regular maintenance" />;
  const { planId } = await params;
  const sp = await searchParams;
  let v: Awaited<ReturnType<typeof getMaintenancePlan>>;
  try {
    v = await getMaintenancePlan(ctx, planId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Not found" action={<LinkButton href="/maintenance/plans" variant="secondary">All regular maintenance</LinkButton>}>
          This regular maintenance does not exist or is not at one of your sites. Ask the maintenance lead.
        </EmptyState>
      );
    }
    throw e;
  }
  const p = v.plan;
  return (
    <>
      <PageHeader
        title={`${p.equipmentName}: ${p.title}`}
        subtitle={
          <>
            Regular maintenance · {p.siteCode} · <RecordNo>{p.planNumber}</RecordNo>
          </>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-3">
              <LinkButton href="/maintenance/plans" variant="secondary">
                All regular maintenance
              </LinkButton>
              {v.can.edit && p.status === "active" && <PlanStatusForm planId={p.id} to="paused" label="Pause it" />}
              {v.can.edit && p.status === "paused" && <PlanStatusForm planId={p.id} to="active" label="Start it again" />}
              {v.can.edit && p.status !== "retired" && <PlanStatusForm planId={p.id} to="retired" label="Stop using it" />}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for the technician: what to do on this machine, how often, and when it is next due.</PageIntro>
      {p.liveWorkOrder ? (
        <NextStep text="There is a job for this maintenance." action={{ label: "Open the job", href: `/maintenance/work-orders/${p.liveWorkOrder.id}` }} />
      ) : v.can.createWorkOrder && ["due", "overdue", "due_soon"].includes(p.dueState) ? (
        <NextStep text={`Next: make the job for this maintenance (${p.dueState === "overdue" ? "late" : "due"}).`} action={{ label: "Make the job", href: "#job" }} />
      ) : null}

      <div className="flex flex-col gap-5">
        {sp.created && <Banner tone="ok" title="Regular maintenance saved">{p.triggerKind === "time" ? "The machine's next maintenance date follows this." : "Use is counted from production from now on."}</Banner>}
        {p.dueState === "overdue" && <Banner tone="bad" title="This maintenance is late">The machine shows “maintenance due”; if its rule says “block”, production cannot choose it until the maintenance is done.</Banner>}
        <Card>
          <CardTitle action={p.status === "active" ? <DueChip state={p.dueState} /> : <Chip tone="neu">{p.status === "paused" ? "Paused" : "No longer used"}</Chip>}>What and how often</CardTitle>
          <Dl
            items={[
              ["Machine", <Link key="e" className="text-primary-text hover:underline" href={`/masterdata/equipment/${p.equipmentId}`}>{p.equipmentName} <span className="font-mono text-[12px] text-muted">{p.equipmentCode}</span></Link>],
              ["How often", p.triggerKind === "time" ? `Every ${p.intervalDays} days` : `Every ${Number(p.usageInterval)} ${p.usageUnit} of use`],
              ["Next due", p.triggerKind === "time" ? fmtDate(p.nextDueOn) : `${p.usage ?? 0} of ${Number(p.usageInterval)} ${p.usageUnit} used since ${fmtDateTime(p.usageSince)}`],
              ["Last done", p.lastCompletedAt ? fmtDateTime(p.lastCompletedAt) : "—"],
              ["Who does it", p.responsibleName ?? "—"],
              ["Machine stopped while it is done", p.takesEquipmentDown ? "Yes" : "No"],
              ["Note", p.statusReason ?? "—"],
            ]}
          />
          {p.instructions && <p className="mt-4 whitespace-pre-wrap rounded-[12px] border border-line bg-surface-2 p-3 text-[14px]">{p.instructions}</p>}
        </Card>

        <Card>
          <span id="job" className="block scroll-mt-24" />
          <CardTitle>The job</CardTitle>
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
            <p className="text-[13px] text-muted">{p.status === "active" ? "The maintenance lead or a technician makes the job." : "This maintenance is paused or no longer used."}</p>
          )}
        </Card>

        {v.can.edit && (
          <Card>
            <MoreDetails title="Change what to do or how often">
              <EditPlanForm plan={p} technicians={v.technicians} />
            </MoreDetails>
          </Card>
        )}

        <Card>
          <CardTitle>Done before</CardTitle>
          {v.history.length === 0 ? (
            <p className="text-[13px] text-muted">No job yet.</p>
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
                      {fmtDateTime(h.completedAt)} · {h.completedByName} · {h.result === "fail" ? "still not working" : h.result === "pass" ? "check OK" : "done, works"}
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

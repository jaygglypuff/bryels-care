import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getMaintenanceWorkOrder, issuablePartStock } from "@/modules/maintenance";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { WhoCanHelp } from "@/ui/who-can-help";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { EQUIPMENT_WORD, KIND_WORD, PriorityChip, WoStatusChip, woWord } from "../../_ui";
import { AssignForm, CompleteForm, IssuePartForm, TransitionForm } from "../../forms";

export const dynamic = "force-dynamic";

/** Maintenance work order: state machine actions, equipment availability, spare parts issued, history. */
export default async function WorkOrderPage({ params, searchParams }: { params: Promise<{ workOrderId: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("maintenance.work_order.view")) return <Forbidden what="repair jobs" />;
  const { workOrderId } = await params;
  const sp = await searchParams;
  let v: Awaited<ReturnType<typeof getMaintenanceWorkOrder>>;
  try {
    v = await getMaintenanceWorkOrder(ctx, workOrderId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Repair job not found" action={<LinkButton href="/maintenance/work-orders" variant="secondary">All repair jobs</LinkButton>}>
          This job does not exist or is not at one of your sites. Ask the maintenance lead.
        </EmptyState>
      );
    }
    throw e;
  }
  const w = v.workOrder;
  const stock = v.can.issueParts ? await issuablePartStock(ctx, w.id) : [];
  return (
    <>
      <PageHeader
        title={`${v.equipment.name}: ${w.title}`}
        subtitle={
          <>
            {KIND_WORD[w.kind] ?? w.kindLabel} · {v.equipment.siteCode} · <RecordNo>{w.workOrderNumber}</RecordNo>
          </>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-3">
              <LinkButton href="/maintenance/work-orders" variant="secondary">
                All repair jobs
              </LinkButton>
              {v.can.hold && <TransitionForm workOrderId={w.id} to="on_hold" label="Pause the job" needsReason />}
              {v.can.cancel && (
                <div className="border-t border-line pt-3">
                  <TransitionForm workOrderId={w.id} to="cancelled" label="Cancel the job" needsReason />
                </div>
              )}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for the technician: start the job, take spare parts if needed, and say when it is done.</PageIntro>
      {v.can.start ? (
        <NextStep text={w.status === "on_hold" ? "Next: go on with the job." : "Next: start the job when you begin the work."} action={{ label: w.status === "on_hold" ? "Go on" : "Start", href: "#work" }} />
      ) : v.can.complete ? (
        <NextStep text="Next: when the machine is fixed, write what you did." action={{ label: "The job is done", href: "#work" }} />
      ) : ["open", "in_progress", "on_hold"].includes(w.status) ? (
        <>
          <NextStep text="The job is not done yet." waitingFor={w.assigneeName ? `Waiting for ${w.assigneeName} (technician).` : "Waiting for a technician."} />
          <div className="-mt-2 mb-4">
            <WhoCanHelp permission="maintenance.work_order.edit" siteId={w.siteId} hideEmails lead="Technicians: " />
          </div>
        </>
      ) : null}

      <div className="flex flex-col gap-5">
        {sp.created && <Banner tone="ok" title="Sent to the technician">{w.reportedDown ? "Nobody can use the machine until the job is done." : "The technician starts it when the work begins."}</Banner>}
        <Card>
          <CardTitle action={<WoStatusChip status={w.status} />}>The job</CardTitle>
          {w.description && <p className="mb-4 whitespace-pre-wrap text-[14px]">{w.description}</p>}
          <Dl
            items={[
              ["Kind", KIND_WORD[w.kind] ?? w.kindLabel],
              ["Regular maintenance", v.plan ? <Link key="p" className="text-primary-text hover:underline" href={`/maintenance/plans/${v.plan.id}`}>{v.plan.number}</Link> : "—"],
              ["How urgent", <PriorityChip key="pr" priority={w.priority} />],
              ["Technician", w.assigneeName ?? "Nobody yet"],
              ["Do it by", w.dueDate ? fmtDate(w.dueDate) : "—"],
              ["Reported", `${w.createdByName}, ${fmtDateTime(w.createdAt)}`],
              ["Started", w.startedAt ? `${w.startedByName}, ${fmtDateTime(w.startedAt)}` : "—"],
              ["Done", w.completedAt ? `${w.completedByName}, ${fmtDateTime(w.completedAt)} · ${w.result === "fail" ? "still not working" : "works"}` : w.status === "cancelled" ? `Cancelled: ${w.cancelReason}` : "—"],
              ["Paused because", w.holdReason ?? "—"],
            ]}
          />
          {w.workDone && <p className="mt-4 whitespace-pre-wrap text-[14px]">What was done: {w.workDone}</p>}
        </Card>

        <Card>
          <CardTitle>The machine</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-[14px]">
            <Link className="font-medium text-primary-text hover:underline" href={`/masterdata/equipment/${v.equipment.id}`}>
              {v.equipment.name} <span className="font-mono text-[12px] font-normal text-muted">{v.equipment.code}</span>
            </Link>
            <Chip tone={v.equipment.status === "in_service" ? "ok" : "bad"}>{EQUIPMENT_WORD[v.equipment.status] ?? v.equipment.status.replace(/_/g, " ")}</Chip>
            {v.availability && (v.availability.usable ? <Chip tone="ok">Production may use it</Chip> : <Chip tone="bad">Blocked: {v.availability.blockingReasons.map((r) => r.detail).join("; ")}</Chip>)}
          </div>
          <p className="mt-2 text-[12px] text-muted">
            Next maintenance {v.equipment.maintenanceDueDate ? fmtDate(v.equipment.maintenanceDueDate) : "not set"}. {w.takesEquipmentDown ? "When the job starts, nobody can use the machine; when it is done and works, it can be used again." : "The machine can still be used during this job."}
          </p>
        </Card>

        {(v.can.start || v.can.complete || v.can.assign) && (
          <Card>
            <span id="work" className="block scroll-mt-24" />
            <CardTitle>Do the job</CardTitle>
            {v.can.start && <TransitionForm workOrderId={w.id} to="in_progress" label={w.status === "on_hold" ? "Go on with the job" : "Start the job"} />}
            {v.can.complete && (
              <div className={v.can.start ? "mt-4 border-t border-line pt-4" : ""}>
                <CompleteForm workOrderId={w.id} kind={w.kind} />
              </div>
            )}
            {w.status === "in_progress" && !v.can.complete && <p className="mt-3 text-[13px] text-muted">Only a technician can say the job is done.</p>}
            {v.can.assign && (
              <div className="mt-4 border-t border-line pt-4">
                <MoreDetails title="Change who does it, by when, how urgent">
                  <AssignForm workOrderId={w.id} technicians={v.technicians} current={w} />
                </MoreDetails>
              </div>
            )}
          </Card>
        )}

        <Card>
          <CardTitle>Spare parts</CardTitle>
          {v.parts.length === 0 ? (
            <p className="text-[13px] text-muted">No parts taken yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[14px]">
              {v.parts.map((p) => (
                <li key={p.id}>
                  {Number(p.qtyBase)} {p.uomBase} {p.materialName} from {p.locationCode} <span className="font-mono text-[12px] text-muted">lot {p.lotNumber}</span>
                  <span className="text-[12px] text-muted">
                    {" "}
                    · {fmtDateTime(p.issuedAt)} · {p.issuedByName}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {v.can.issueParts && (
            <div className="mt-4 border-t border-line pt-4">
              {stock.length === 0 ? (
                <p className="text-[13px] text-muted">
                  No spare part that is OK to use is in stock at this site. <Link className="text-primary-text hover:underline" href="/maintenance/spare-parts">Spare parts list</Link>
                </p>
              ) : (
                <MoreDetails title="Take a spare part for this job">
                  <IssuePartForm workOrderId={w.id} stock={stock.map((s) => ({ ...s, qty: String(s.qty) }))} />
                </MoreDetails>
              )}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>What happened</CardTitle>
          <ol className="flex flex-col divide-y divide-line text-[13px]">
            {v.timeline.map((t, i) => (
              <li key={i} className="py-1.5">
                <span className="text-muted">{fmtDateTime(t.at)}</span> · <span className="font-medium">{t.by}</span>: {t.from ? `${woWord(t.from)} → ` : ""}
                {woWord(t.to)}
                {t.reason ? <span className="text-fg-2"> — “{t.reason}”</span> : ""}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}

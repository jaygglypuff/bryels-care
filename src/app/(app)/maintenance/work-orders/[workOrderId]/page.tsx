import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getMaintenanceWorkOrder, issuablePartStock } from "@/modules/maintenance";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { PriorityChip, WoStatusChip } from "../../_ui";
import { AssignForm, CompleteForm, IssuePartForm, TransitionForm } from "../../forms";

export const dynamic = "force-dynamic";

/** Maintenance work order: state machine actions, equipment availability, spare parts issued, history. */
export default async function WorkOrderPage({ params, searchParams }: { params: Promise<{ workOrderId: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("maintenance.work_order.view")) return <Forbidden what="maintenance work orders" />;
  const { workOrderId } = await params;
  const sp = await searchParams;
  let v: Awaited<ReturnType<typeof getMaintenanceWorkOrder>>;
  try {
    v = await getMaintenanceWorkOrder(ctx, workOrderId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Work order not found" action={<LinkButton href="/maintenance/work-orders" variant="secondary">Work orders</LinkButton>}>
          This work order does not exist or is not at one of your sites.
        </EmptyState>
      );
    }
    throw e;
  }
  const w = v.workOrder;
  const stock = v.can.issueParts ? await issuablePartStock(ctx, w.id) : [];
  return (
    <>
      <PageHeader title={w.workOrderNumber} subtitle={`${w.title} · ${v.equipment.code} ${v.equipment.name} · ${v.equipment.siteCode}`} actions={<LinkButton href="/maintenance/work-orders" variant="secondary">Work orders</LinkButton>} />
      <div className="flex flex-col gap-5">
        {sp.created && <Banner tone="ok" title={`Work order ${w.workOrderNumber} raised`}>{w.reportedDown ? "The equipment is out of service until the work order is completed." : "Start it when the work begins."}</Banner>}
        <Card>
          <CardTitle action={<WoStatusChip status={w.status} />}>Work order</CardTitle>
          {w.description && <p className="mb-4 whitespace-pre-wrap text-[14px]">{w.description}</p>}
          <Dl
            items={[
              ["Kind", w.kindLabel],
              ["Plan", v.plan ? <Link key="p" className="text-primary-text hover:underline" href={`/maintenance/plans/${v.plan.id}`}>{v.plan.number}</Link> : "—"],
              ["Priority", <PriorityChip key="pr" priority={w.priority} />],
              ["Technician", w.assigneeName ?? "Unassigned"],
              ["Due", w.dueDate ? fmtDate(w.dueDate) : "—"],
              ["Raised", `${fmtDateTime(w.createdAt)} · ${w.createdByName}`],
              ["Started", w.startedAt ? `${fmtDateTime(w.startedAt)} · ${w.startedByName}` : "—"],
              ["Completed", w.completedAt ? `${fmtDateTime(w.completedAt)} · ${w.completedByName} · ${w.result}` : w.status === "cancelled" ? `Cancelled: ${w.cancelReason}` : "—"],
              ["On hold because", w.holdReason ?? "—"],
            ]}
          />
          {w.workDone && <p className="mt-4 whitespace-pre-wrap text-[14px]">Work done: {w.workDone}</p>}
        </Card>

        <Card>
          <CardTitle>Equipment</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-[14px]">
            <Link className="font-medium text-primary-text hover:underline" href={`/masterdata/equipment/${v.equipment.id}`}>
              {v.equipment.code}
            </Link>
            <StatusChip status={v.equipment.status} label={v.equipment.status.replace(/_/g, " ")} />
            {v.availability && (v.availability.usable ? <Chip tone="ok">Usable</Chip> : <Chip tone="bad">Blocked: {v.availability.blockingReasons.map((r) => r.detail).join("; ")}</Chip>)}
          </div>
          <p className="mt-2 text-[12px] text-muted">
            Next maintenance date {v.equipment.maintenanceDueDate ? fmtDate(v.equipment.maintenanceDueDate) : "not set"}. {w.takesEquipmentDown ? "Starting this work takes the equipment to maintenance; completing with a working result returns it to service." : "This work does not take the equipment out of use."}
          </p>
        </Card>

        {(v.can.start || v.can.hold || v.can.complete || v.can.cancel || v.can.assign) && (
          <Card>
            <CardTitle>Work</CardTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              {v.can.start && <TransitionForm workOrderId={w.id} to="in_progress" label={w.status === "on_hold" ? "Resume work" : "Start work"} />}
              {v.can.hold && <TransitionForm workOrderId={w.id} to="on_hold" label="Put on hold" needsReason />}
            </div>
            {v.can.complete && (
              <div className="mt-4 border-t border-line pt-4">
                <CompleteForm workOrderId={w.id} kind={w.kind} />
              </div>
            )}
            {w.status === "in_progress" && !v.can.complete && <p className="mt-3 text-[13px] text-muted">Completing needs maintenance.work_order.edit and masterdata.equipment.edit (technicians).</p>}
            {v.can.assign && (
              <details className="mt-4 border-t border-line pt-4">
                <summary className="cursor-pointer text-[13px] text-primary-text">Assign, due date, priority</summary>
                <div className="mt-3">
                  <AssignForm workOrderId={w.id} technicians={v.technicians} current={w} />
                </div>
              </details>
            )}
            {v.can.cancel && (
              <details className="mt-4 border-t border-line pt-4">
                <summary className="cursor-pointer text-[13px] text-primary-text">Cancel this work order</summary>
                <div className="mt-3">
                  <TransitionForm workOrderId={w.id} to="cancelled" label="Cancel work order" needsReason />
                </div>
              </details>
            )}
          </Card>
        )}

        <Card>
          <CardTitle>Spare parts</CardTitle>
          {v.parts.length === 0 ? (
            <p className="text-[13px] text-muted">No parts issued.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[14px]">
              {v.parts.map((p) => (
                <li key={p.id}>
                  {Number(p.qtyBase)} {p.uomBase} {p.materialCode} {p.materialName} · lot {p.lotNumber} from {p.locationCode}
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
                  No released stock of the listed spare parts at this site. <Link className="text-primary-text hover:underline" href="/maintenance/spare-parts">Spare-parts list</Link>
                </p>
              ) : (
                <IssuePartForm workOrderId={w.id} stock={stock.map((s) => ({ ...s, qty: String(s.qty) }))} />
              )}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>History</CardTitle>
          <ol className="flex flex-col gap-1 text-[13px]">
            {v.timeline.map((t, i) => (
              <li key={i}>
                {fmtDateTime(t.at)} · {t.by}: {t.from ? `${t.from.replace("_", " ")} → ` : ""}
                {t.to.replace("_", " ")}
                {t.reason ? ` — ${t.reason}` : ""}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { uuidv7 } from "uuidv7";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDate, fmtDateTime } from "@/lib/qty";
import { equipmentMaintenanceSummary } from "@/modules/maintenance";
import { businessToday, getEquipment } from "@/modules/masterdata";
import { Banner, Chip } from "@/ui/status";
import { Card, CardTitle, Dl, EmptyState, LinkButton } from "@/ui/core";
import { RecordHeader } from "@/ui/record";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { waitingFor } from "../../../waiting-for";
import { EQUIPMENT_KIND_WORDS } from "../words";
import { Forbidden } from "../../../forbidden";
import { decideOverrideAction, reviewServiceAction } from "../../_eng/actions";
import { CommandForm, DecisionForm } from "../../_eng/forms";
import { ApprovalPanel, AvailabilityChip } from "../../_eng/ui";
import { OverrideRequestForm, ServiceRecordForm, StatusForm } from "./forms";

export const metadata: Metadata = { title: "Equipment" };

export default async function EquipmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!ctx.can("masterdata.equipment.view")) return <Forbidden what="the equipment register" permission="masterdata.equipment.view" />;
  const v = /^[0-9a-f-]{36}$/i.test(id) ? await getEquipment(ctx, id) : null;
  if (!v) return <EmptyState title="Equipment not found" action={<LinkButton href="/masterdata/equipment" variant="secondary">Back to equipment</LinkButton>}>It does not exist or belongs to a site you are not assigned to.</EmptyState>;
  const e = v.equipment;
  const a = v.availability;
  const today = businessToday();
  const maintenance = await equipmentMaintenanceSummary(ctx, e.id);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/masterdata/equipment" className="text-[13px] text-primary-text hover:underline">
          ← Equipment
        </Link>
        <RecordHeader back={{ href: "/masterdata/equipment", label: "Equipment" }} typeLabel={EQUIPMENT_KIND_WORDS[e.equipmentKind] ?? e.equipmentKind} title={e.name} chip={<AvailabilityChip a={a} />} meta={[<span key="code" className="font-mono">{e.code}</span>, v.site.name, e.lineLabel]} />
        <PageIntro>This machine&apos;s checks, cleaning and repairs. Record each one here so the system knows whether it may be used.</PageIntro>
      </div>
      {!a.selectable && (
        <Banner tone={a.usable ? "appr" : "bad"} title={a.usable ? "Blocked, but an approved override is active" : "Cannot be used in production"}>
          {a.blockingReasons.map((r) => r.detail).join("; ")}.
          {a.override ? ` Override valid until ${fmtDateTime(a.override.validUntil)}.` : " Record the missing service, or ask to use it anyway (site manager and QA say OK)."}
        </Banner>
      )}
      {!a.selectable && v.can.service ? (
        <NextStep text="Next: record the missing check, cleaning or repair. Then the machine may be used again." action={{ label: "Record service", href: "#service" }} />
      ) : !a.selectable ? (
        <NextStep text="This machine cannot be used now." waitingFor={await waitingFor(ctx, "masterdata.equipment.edit", e.siteId, "to record the missing service", "maintenance")} />
      ) : (
        <NextStep text={`Ready to use.${e.calibrationDueDate ? ` Next check due ${fmtDate(e.calibrationDueDate)}.` : e.maintenanceDueDate ? ` Next maintenance due ${fmtDate(e.maintenanceDueDate)}.` : ""} Record each check or cleaning here when it is done.`} />
      )}
      {a.selectable && a.warnings.length > 0 && <Banner tone="warn" title="Usable with a warning">{a.warnings.map((r) => r.detail).join("; ")}. The warning is recorded on every use.</Banner>}

      <Card>
        <Dl
          items={[
            ["Status", e.status.replace(/_/g, " ")],
            ["Blocking rule", e.blockingRule],
            ["Calibration due", e.calibrationDueDate ? fmtDate(e.calibrationDueDate) : "—"],
            ["Last calibrated", e.lastCalibratedDate ? fmtDate(e.lastCalibratedDate) : "—"],
            ["Maintenance due", e.maintenanceDueDate ? fmtDate(e.maintenanceDueDate) : "—"],
            ["Cleaning", `${e.cleaningStatus} (${e.cleaningRule.replace(/_/g, " ")})`],
            ["Last cleaned", e.lastCleanedAt ? fmtDateTime(e.lastCleanedAt) : "—"],
            ["Qualification", e.qualificationStatus.replace(/_/g, " ")],
            ["Capacity", e.capacityMax ? `${e.capacityMin ? D(e.capacityMin).toString() : "0"}–${D(e.capacityMax).toString()} ${e.capacityUom ?? ""}` : "—"],
          ]}
        />
      </Card>

      {/* Wave 4 W4C (US-6-19): live maintenance and PM plans of this equipment */}
      {maintenance && (
        <Card>
          <CardTitle action={ctx.can("maintenance.work_order.create") ? <LinkButton href={`/maintenance/work-orders/new?equipmentId=${e.id}`} variant="secondary" size="sm">Report a problem</LinkButton> : undefined}>Maintenance</CardTitle>
          {maintenance.orders.length === 0 && maintenance.plans.length === 0 ? (
            <p className="text-[13px] text-muted">No PM plan and no open maintenance work order.{ctx.can("maintenance.plan.create") ? " " : ""}{ctx.can("maintenance.plan.create") && <Link className="text-primary-text hover:underline" href={`/maintenance/plans/new?equipmentId=${e.id}`}>Create a PM plan</Link>}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[14px]">
              {maintenance.plans.map((p) => (
                <li key={p.id}>
                  <Link className="text-primary-text hover:underline" href={`/maintenance/plans/${p.id}`}>{p.planNumber}</Link> {p.title} · {p.triggerKind === "time" ? `due ${p.nextDueOn ? fmtDate(p.nextDueOn) : "—"}` : `every ${D(p.usageInterval ?? "0").toString()} ${p.usageMetric}`}
                </li>
              ))}
              {maintenance.orders.map((o) => (
                <li key={o.id}>
                  <Link className="text-primary-text hover:underline" href={`/maintenance/work-orders/${o.id}`}>{o.workOrderNumber}</Link> {o.title} <Chip tone={o.status === "in_progress" ? "appr" : "info"}>{o.status.replace(/_/g, " ")}</Chip>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {v.can.service && (
          <Card id="service">
            <CardTitle>Record service</CardTitle>
            <ServiceRecordForm equipmentId={e.id} idempotencyKey={uuidv7()} today={today} />
          </Card>
        )}
        {((v.can.changeStatus && v.nextStatuses.length > 0) || v.can.requestOverride) && (
          <MoreDetails title="Change its status, or ask to use it anyway">
            {v.can.changeStatus && v.nextStatuses.length > 0 && <StatusForm equipmentId={e.id} next={v.nextStatuses} />}
            {v.can.requestOverride && (
              <div className="border-t border-line pt-3">
                <p className="mb-2 text-[14px] font-medium">Use it anyway for a short time (site manager and QA must say OK)</p>
                <OverrideRequestForm equipmentId={e.id} />
              </div>
            )}
          </MoreDetails>
        )}
      </div>

      {v.overrides.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-[17px] font-semibold">Override requests</h2>
          {v.overrides.map((o) => (
            <ApprovalPanel key={o.id} approval={o.approval} status={o.status}>
              <p className="text-[13px]">
                <b>{o.requestedByName}</b> · {fmtDateTime(o.requestedAt)} · {o.status.replace(/_/g, " ")}
                {o.expired && o.status !== "rejected" ? " · expired" : ` · valid until ${fmtDateTime(o.validUntil)}`}
              </p>
              <p className="mt-1 text-[13px]">{o.reason}</p>
              <p className="mt-1 text-[12px] text-muted">Reasons at request: {o.availabilityReasons.join(", ").replace(/_/g, " ")}{o.workReference ? ` · for ${o.workReference}` : ""}</p>
              {o.canDecide && o.approval.nextStep && (
                <div className="mt-3">
                  <DecisionForm action={decideOverrideAction} id={o.id} stepLabel={o.approval.nextStep.label} isFinal={false} today={today} />
                </div>
              )}
            </ApprovalPanel>
          ))}
        </div>
      )}

      <Card>
        <CardTitle>Service history</CardTitle>
        {v.records.length === 0 ? (
          <EmptyState title="No service records yet" />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {v.records.map((r) => (
              <li key={r.id} className="py-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.serviceKind.replace(/_/g, " ")}</span>
                  <Chip tone={r.result === "fail" ? "bad" : "ok"}>{r.result}</Chip>
                  {r.result === "fail" && (r.reviewedBy ? <Chip tone="info">QA reviewed by {r.reviewedByName}</Chip> : <Chip tone="appr">QA review required</Chip>)}
                  <span className="text-muted">
                    {fmtDateTime(r.performedAt)} · {r.performedByName}
                  </span>
                </div>
                {(r.referenceNumber || r.nextDueDate || r.notes) && (
                  <p className="mt-1 text-[12px] text-fg-2">
                    {r.referenceNumber ? `Ref ${r.referenceNumber}. ` : ""}
                    {r.nextDueDate ? `Next due ${fmtDate(r.nextDueDate)}. ` : ""}
                    {r.notes ?? ""}
                  </p>
                )}
                {r.reviewNote && <p className="mt-1 text-[12px]">QA: {r.reviewNote}</p>}
                {r.canReview && (
                  <div className="mt-2">
                    <CommandForm action={reviewServiceAction} hidden={{ id: r.id }} label="QA review" reasonLabel="What QA found (effect on batches, what to do)" reasonName="note" variant="secondary" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>Status history</CardTitle>
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {v.transitions.map((t) => (
            <li key={t.id}>
              {fmtDateTime(t.occurredAt)} · {t.fromState ? `${t.fromState.replace(/_/g, " ")} → ` : ""}
              {t.toState.replace(/_/g, " ")} · {t.actorName}
              {t.reason ? ` · ${t.reason}` : ""}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

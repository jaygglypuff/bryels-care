import type { Metadata } from "next";
import Link from "next/link";
import { uuidv7 } from "uuidv7";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDate, fmtDateTime } from "@/lib/qty";
import { businessToday, getEquipment } from "@/modules/masterdata";
import { Banner, Chip } from "@/ui/status";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { decideOverrideAction, reviewServiceAction } from "../../_eng/actions";
import { CommandForm, DecisionForm } from "../../_eng/forms";
import { ApprovalPanel, AvailabilityChip } from "../../_eng/ui";
import { OverrideRequestForm, ServiceRecordForm, StatusForm } from "./forms";

export const metadata: Metadata = { title: "Equipment" };

export default async function EquipmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!ctx.can("masterdata.equipment.view")) return <Forbidden what="the equipment register" />;
  const v = /^[0-9a-f-]{36}$/i.test(id) ? await getEquipment(ctx, id) : null;
  if (!v) return <EmptyState title="Equipment not found" action={<LinkButton href="/masterdata/equipment" variant="secondary">Back to equipment</LinkButton>}>It does not exist or belongs to a site you are not assigned to.</EmptyState>;
  const e = v.equipment;
  const a = v.availability;
  const today = businessToday();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/masterdata/equipment" className="text-[13px] text-primary-text hover:underline">
          ← Equipment
        </Link>
        <PageHeader title={`${e.code} · ${e.name}`} subtitle={`${e.equipmentKind} · ${v.site.code} ${v.site.name}${e.lineLabel ? ` · ${e.lineLabel}` : ""}`} actions={<AvailabilityChip a={a} />} />
      </div>
      {!a.selectable && (
        <Banner tone={a.usable ? "appr" : "bad"} title={a.usable ? "Blocked, but an approved override is active" : "Cannot be used in production"}>
          {a.blockingReasons.map((r) => r.detail).join("; ")}.
          {a.override ? ` Override valid until ${fmtDateTime(a.override.validUntil)}.` : " Record the missing service, or request a controlled override (site manager + QA)."}
        </Banner>
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

      <div className="grid gap-5 lg:grid-cols-2">
        {v.can.service && (
          <Card>
            <CardTitle>Record service</CardTitle>
            <ServiceRecordForm equipmentId={e.id} idempotencyKey={uuidv7()} today={today} />
          </Card>
        )}
        <div className="flex flex-col gap-5">
          {v.can.changeStatus && v.nextStatuses.length > 0 && (
            <Card>
              <CardTitle>Status</CardTitle>
              <StatusForm equipmentId={e.id} next={v.nextStatuses} />
            </Card>
          )}
          {v.can.requestOverride && (
            <Card>
              <CardTitle>Controlled override (CX-CAL)</CardTitle>
              <OverrideRequestForm equipmentId={e.id} />
            </Card>
          )}
        </div>
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
                    <CommandForm action={reviewServiceAction} hidden={{ id: r.id }} label="QA review" reasonLabel="Review conclusion (impact on batches, actions)" reasonName="note" variant="cta" />
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

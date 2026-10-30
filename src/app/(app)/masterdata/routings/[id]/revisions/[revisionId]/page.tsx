import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDateTime } from "@/lib/qty";
import { AREAS, EQUIPMENT_KINDS, STEP_KINDS, approvedWorkInstructionOptions, businessToday, getRoutingRevision, waitText } from "@/modules/masterdata";
import { Banner, Chip } from "@/ui/status";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../../../forbidden";
import { decideRoutingAction, retireRoutingAction, submitRoutingAction, withdrawRoutingAction } from "../../../../_eng/actions";
import { CommandForm, DecisionForm } from "../../../../_eng/forms";
import { DeleteDraftButton } from "../../../../../delete-draft-button";
import { ApprovalPanel, EffectiveRange, VerifyBanner, VersionChip } from "../../../../_eng/ui";
import { RoutingStepEditor, type StepDraft } from "./step-editor";

export const metadata: Metadata = { title: "Routing revision" };

const limits = (p: { minValue: string | null; targetValue: string | null; maxValue: string | null; uom: string | null }) => {
  const f = (v: string | null) => (v === null ? null : D(v).toString());
  const parts = [f(p.minValue) && `min ${f(p.minValue)}`, f(p.targetValue) && `target ${f(p.targetValue)}`, f(p.maxValue) && `max ${f(p.maxValue)}`].filter(Boolean);
  return parts.length ? `${parts.join(" · ")} ${p.uom ?? ""}` : `${p.uom ?? ""} · limits not set`;
};

export default async function RoutingRevisionPage({ params }: { params: Promise<{ id: string; revisionId: string }> }) {
  const { id, revisionId } = await params;
  const ctx = await requireContext();
  if (!ctx.can("masterdata.routing.view")) return <Forbidden what="routings" />;
  const v = /^[0-9a-f-]{36}$/i.test(revisionId) ? await getRoutingRevision(ctx, revisionId) : null;
  if (!v || v.routing.id !== id) return <EmptyState title="Revision not found" action={<LinkButton href="/masterdata/routings" variant="secondary">Back to routings</LinkButton>} />;
  const r = v.revision;
  const today = businessToday();
  const lastStep = Math.max(...v.approval.policy.map((p) => p.step));
  const wis = v.can.edit ? await approvedWorkInstructionOptions(ctx) : [];
  const initial: StepDraft[] = v.steps.map((s) => ({
    name: s.name,
    code: s.code ?? "",
    stepKind: s.stepKind,
    area: s.area ?? "",
    instruction: s.instruction ?? "",
    workInstructionRevisionId: s.workInstructionRevisionId ?? "",
    requiresChecker: s.requiresChecker,
    blocksUntilComplete: s.blocksUntilComplete,
    requiresEquipment: s.requiresEquipment,
    equipmentKind: s.equipmentKind ?? "",
    minDurationMinutes: s.minDurationMinutes ? String(s.minDurationMinutes) : "",
    parameters: s.parameters.map((p) => ({
      code: p.code,
      name: p.name,
      valueKind: p.valueKind,
      uom: p.uom ?? "",
      minValue: p.minValue === null ? "" : D(p.minValue).toString(),
      targetValue: p.targetValue === null ? "" : D(p.targetValue).toString(),
      maxValue: p.maxValue === null ? "" : D(p.maxValue).toString(),
      isRequired: p.isRequired,
    })),
    checklistText: s.checklistItems.map((c) => `${c.requiresPhoto ? "[photo] " : ""}${c.text}`).join("\n"),
  }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={`/masterdata/routings/${v.routing.id}`} className="text-[13px] text-primary-text hover:underline">
          ← {v.routing.code}
        </Link>
        <PageHeader title={`${v.routing.code} revision ${r.revisionNo}`} subtitle={`${v.routing.name} · ${v.product.name}`} actions={<VersionChip status={r.status} label={r.label} />} />
      </div>
      {r.status === "approved" && <Banner tone="info" title="Approved revisions are read-only">Batches keep the routing revision they were created with. Start a new revision to change the steps.</Banner>}
      <VerifyBanner />
      <Card>
        <Dl
          items={[
            ["Effective", <EffectiveRange key="e" from={r.effectiveFrom} to={r.effectiveTo} />],
            ["Change scope", r.changeScope ? r.changeScope.replace(/_/g, " ") : v.draftScope ? `${v.draftScope.replace(/_/g, " ")} (if submitted now)` : "—"],
            ["Steps", String(v.steps.length)],
            ["Submitted by", r.submittedByName ? `${r.submittedByName}${r.submittedAt ? ` · ${fmtDateTime(r.submittedAt)}` : ""}` : "—"],
            ["Final approver", r.approvedByName ?? "—"],
          ]}
        />
        {r.changeSummary && <p className="mt-3 text-[13px]"><span className="font-medium">Change:</span> {r.changeSummary}</p>}
      </Card>

      {v.can.edit ? (
        <Card>
          <CardTitle>Edit draft steps</CardTitle>
          <RoutingStepEditor
            revisionId={r.id}
            initial={initial}
            effectiveFrom={r.effectiveFrom}
            changeSummary={r.changeSummary}
            workInstructions={wis.map((w) => ({ id: w.id, label: `${w.code} rev ${w.revisionNo} · ${w.name}${w.effectiveTo ? " (superseded)" : ""}` }))}
            stepKinds={STEP_KINDS}
            areas={AREAS}
            equipmentKinds={EQUIPMENT_KINDS}
            today={today}
          />
        </Card>
      ) : (
        <Card>
          <CardTitle>Steps</CardTitle>
          {v.steps.length === 0 ? (
            <EmptyState title="No steps" />
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {v.steps.map((s) => (
                <li key={s.id} className="py-3" data-testid={`routing-step-${s.stepNo}`}>
                  <p className="font-medium">
                    {s.stepNo}. {s.name}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Chip tone="neu">{s.stepKind.replace(/_/g, " ")}{s.area ? ` (${s.area})` : ""}</Chip>
                    {s.requiresChecker && <Chip tone="info">Checker required</Chip>}
                    {s.requiresEquipment && <Chip tone="info">Equipment: {s.equipmentKind}</Chip>}
                    {s.minDurationMinutes && <Chip tone="neu">Wait at least {waitText(s.minDurationMinutes)}</Chip>}
                  </div>
                  {s.instruction && <p className="mt-1 text-[13px] text-fg-2">{s.instruction}</p>}
                  {s.workInstruction && (
                    <details className="mt-1 text-[13px]">
                      <summary className="cursor-pointer text-primary-text">
                        Work instruction {s.workInstruction.code} rev {s.workInstruction.revisionNo}
                      </summary>
                      <p className="mt-1 whitespace-pre-wrap rounded-[10px] bg-surface-2/60 p-2 text-[12px]">{s.workInstruction.bodyMarkdown}</p>
                    </details>
                  )}
                  {s.parameters.length > 0 && (
                    <ul className="mt-1 text-[12px]">
                      {s.parameters.map((p) => (
                        <li key={p.id}>
                          {p.name}: {p.valueKind === "numeric" ? limits(p) : p.valueKind === "boolean" ? "yes or no" : "a short note"}
                          {p.isRequired ? "" : " (optional)"}
                        </li>
                      ))}
                    </ul>
                  )}
                  {s.checklistItems.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-[12px]">
                      {s.checklistItems.map((c) => (
                        <li key={c.id}>
                          {c.text}
                          {c.requiresPhoto ? " (photo)" : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {(r.status !== "draft" || v.approval.decisions.length > 0) && (
        <ApprovalPanel approval={v.approval} status={r.status} what="steps">
          {v.approval.canDecide && v.approval.nextStep && (
            <DecisionForm action={decideRoutingAction} id={r.id} stepLabel={`step ${v.approval.nextStep.step}, ${v.approval.nextStep.label}`} isFinal={v.approval.nextStep.step === lastStep} defaultEffectiveFrom={r.effectiveFrom} today={today} />
          )}
        </ApprovalPanel>
      )}

      {(v.can.submit || v.can.withdraw || v.can.retire) && (
        <Card>
          <CardTitle>Actions</CardTitle>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {v.can.submit && <CommandForm action={submitRoutingAction} hidden={{ id: r.id }} label="Submit for approval" variant="cta" confirmText="Save the draft first. A sequencing-only change needs one site manager approval; any other change needs QA and a site manager or owner." />}
            {v.can.withdraw && <CommandForm action={withdrawRoutingAction} hidden={{ id: r.id }} label="Withdraw to draft" variant="secondary" />}
            {v.can.edit && r.status === "draft" && !r.submittedAt && <DeleteDraftButton kind="routing_revision" id={r.id} what="this draft revision and its steps (a routing with no other revision is removed too)" />}
            {v.can.retire && <CommandForm action={retireRoutingAction} hidden={{ id: r.id }} label="Retire revision" variant="danger" reasonLabel="Reason for retiring" />}
          </div>
        </Card>
      )}
    </div>
  );
}

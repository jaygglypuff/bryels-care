import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDate, fmtDateTime } from "@/lib/qty";
import { AREAS, AREAS_WORDS, EQUIPMENT_KINDS, STEP_KINDS, approvedWorkInstructionOptions, businessToday, getRoutingRevision, listFormulas, waitText } from "@/modules/masterdata";
import { Banner, Chip } from "@/ui/status";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Explain, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Forbidden } from "../../../../../forbidden";
import { decideRoutingAction, retireRoutingAction, submitRoutingAction, withdrawRoutingAction } from "../../../../_eng/actions";
import { CommandForm, DecisionForm } from "../../../../_eng/forms";
import { DeleteDraftButton } from "../../../../../delete-draft-button";
import { ApprovalPanel, VerifyBanner } from "../../../../_eng/ui";
import { PlainVersionChip, stepKindWords, useFromText, NEXT_WRAP } from "../../../../_eng/plain";
import { waitingForApprover } from "../../../../_eng/waiting";
import { RoutingStepEditor, type StepDraft } from "./step-editor";

export const metadata: Metadata = { title: "Steps version (advanced)" };

const SCOPE_WORDS: Record<string, string> = { sequencing_only: "only the order of the steps (one manager OK)", quality_relevant: "what the steps do (QA and a manager say OK)" };

const limits = (p: { minValue: string | null; targetValue: string | null; maxValue: string | null; uom: string | null }) => {
  const f = (v: string | null) => (v === null ? null : D(v).toString());
  const parts = [f(p.minValue) && `at least ${f(p.minValue)}`, f(p.targetValue) && `aim for ${f(p.targetValue)}`, f(p.maxValue) && `at most ${f(p.maxValue)}`].filter(Boolean);
  return parts.length ? `${parts.join(" · ")} ${p.uom ?? ""}` : `${p.uom ?? ""} · no limits set`;
};

export default async function RoutingRevisionPage({ params }: { params: Promise<{ id: string; revisionId: string }> }) {
  const { id, revisionId } = await params;
  const ctx = await requireContext();
  if (!ctx.can("masterdata.routing.view")) return <Forbidden what="routings" />;
  const v = /^[0-9a-f-]{36}$/i.test(revisionId) ? await getRoutingRevision(ctx, revisionId) : null;
  if (!v || v.routing.id !== id)
    return (
      <EmptyState title="Version not found" action={<LinkButton href="/masterdata/routings" variant="secondary">All steps</LinkButton>}>
        It may have been deleted. Open the product&apos;s steps and pick a version from the list.
      </EmptyState>
    );
  const r = v.revision;
  const today = businessToday();
  const lastStep = Math.max(...v.approval.policy.map((p) => p.step));
  const wis = v.can.edit ? await approvedWorkInstructionOptions(ctx) : [];
  const recipe = ctx.can("masterdata.formula.view") ? ((await listFormulas(ctx)).find((f) => f.productId === v.product.id) ?? null) : null;
  const canChange = ctx.can("masterdata.formula.create") && ctx.can("masterdata.formula.edit") && ctx.can("masterdata.routing.create") && ctx.can("masterdata.routing.edit");
  const nextPolicy = v.approval.nextStep ? v.approval.policy.find((p) => p.step === v.approval.nextStep!.step) : null;
  const waiting = r.status === "pending_approval" && !v.approval.canDecide ? await waitingForApprover(ctx, "masterdata.routing.approve", nextPolicy, v.approval.policy.length) : null;
  const recipeLink = recipe ? (canChange ? { label: "Make a new version (step by step)", href: `/masterdata/recipes/${recipe.formulaId}?new=1` } : { label: "Open the recipe", href: `/masterdata/recipes/${recipe.formulaId}` }) : undefined;
  const hasMore = v.can.withdraw || v.can.retire || (v.can.edit && r.status === "draft" && !r.submittedAt);
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
        <Link href={`/masterdata/routings/${v.routing.id}`} className="inline-flex min-h-[44px] items-center text-[14px] text-primary-text hover:underline">
          ← Steps for {v.product.name}
        </Link>
        <PageHeader
          title={`Version ${r.revisionNo} of the steps for ${v.product.name}`}
          subtitle={
            <>
              Steps (advanced) · <RecordNo>{v.routing.code}</RecordNo> <PlainVersionChip status={r.status} label={r.label} />
            </>
          }
          actions={
            hasMore ? (
              <MoreMenu>
                <div className="flex flex-col gap-3">
                  {v.can.withdraw && <CommandForm action={withdrawRoutingAction} hidden={{ id: r.id }} label="Take it back to change it" variant="secondary" />}
                  {v.can.edit && r.status === "draft" && !r.submittedAt && <DeleteDraftButton kind="routing_revision" id={r.id} what="this draft version and its steps (steps with no other version are removed too)" />}
                  {v.can.retire && <CommandForm action={retireRoutingAction} hidden={{ id: r.id }} label="Stop using this version" variant="danger" reasonLabel="Why?" />}
                </div>
              </MoreMenu>
            ) : undefined
          }
        />
      </div>
      <PageIntro>
        This screen is for one version of the steps a worker follows. Most people use New recipe (step by step). These screens are for advanced changes. <Explain term="version" label="What is a version?" />
      </PageIntro>

      {r.status === "draft" ? (
        v.can.submit ? (
          <NextStep className={NEXT_WRAP} text="Next: check the steps and press Save, then send them for approval." action={{ label: "Send for approval", href: "#send" }} />
        ) : (
          <NextStep className={NEXT_WRAP} text="This version is being written." waitingFor={`Waiting for ${r.createdByName ?? "the planner"} to finish it and send it for approval.`} />
        )
      ) : r.status === "pending_approval" ? (
        v.approval.canDecide ? (
          <NextStep className={NEXT_WRAP} text="Next: check the steps, then say OK or not OK." action={{ label: "Decide", href: "#decide" }} />
        ) : (
          <NextStep className={NEXT_WRAP} text="Sent for approval." waitingFor={waiting ?? "Waiting for approval."} />
        )
      ) : r.status === "approved" ? (
        <NextStep className={NEXT_WRAP} text={r.label === "effective" ? "This version is in use. To change the steps, make a new version." : "This version is approved."} action={recipeLink} />
      ) : r.status === "rejected" ? (
        <NextStep className={NEXT_WRAP} text="This version was not OK'd. Read the note in the approval box, then make a new version." action={recipeLink} />
      ) : (
        <NextStep className={NEXT_WRAP} text="This version is no longer used." action={recipeLink} />
      )}

      {r.status === "approved" && <Banner tone="info" title="An approved version cannot change">Batches keep the steps they started with. Make a new version to change them.</Banner>}
      <VerifyBanner />
      <Card>
        <Dl
          items={[
            ["Use from", useFromText(r.effectiveFrom, r.effectiveTo, fmtDate).replace(/^Use from:? ?/, "") || "—"],
            ["This change is about", r.changeScope ? (SCOPE_WORDS[r.changeScope] ?? r.changeScope.replace(/_/g, " ")) : v.draftScope ? `${SCOPE_WORDS[v.draftScope] ?? v.draftScope.replace(/_/g, " ")} (if sent now)` : "—"],
            ["Steps", String(v.steps.length)],
            ["Sent by", r.submittedByName ? `${r.submittedByName}${r.submittedAt ? ` · ${fmtDateTime(r.submittedAt)}` : ""}` : "—"],
            ["Last OK by", r.approvedByName ?? "—"],
          ]}
        />
        {r.changeSummary && (
          <p className="mt-3 text-[14px]">
            <span className="font-medium">What changed:</span> {r.changeSummary}
          </p>
        )}
      </Card>

      {v.can.edit ? (
        <Card>
          <CardTitle>Change the draft steps</CardTitle>
          <RoutingStepEditor
            revisionId={r.id}
            initial={initial}
            effectiveFrom={r.effectiveFrom}
            changeSummary={r.changeSummary}
            workInstructions={wis.map((w) => ({ id: w.id, label: `${w.name} (version ${w.revisionNo})${w.effectiveTo ? " (old version)" : ""}` }))}
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
            <p className="text-[14px] text-fg-2">No steps yet.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {v.steps.map((s) => (
                <li key={s.id} className="py-3" data-testid={`routing-step-${s.stepNo}`}>
                  <p className="font-medium">
                    {s.stepNo}. {s.name}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Chip tone="neu">{stepKindWords(s.stepKind)}{s.area ? ` (${AREAS_WORDS[s.area] ?? s.area})` : ""}</Chip>
                    {s.requiresChecker && <Chip tone="info">A second person checks</Chip>}
                    {s.requiresEquipment && <Chip tone="info">Needs a {s.equipmentKind}</Chip>}
                    {s.minDurationMinutes && <Chip tone="neu">Wait at least {waitText(s.minDurationMinutes)}</Chip>}
                  </div>
                  {s.instruction && <p className="mt-1 text-[13px] text-fg-2">{s.instruction}</p>}
                  {s.workInstruction && (
                    <details className="mt-1 text-[13px]">
                      <summary className="flex min-h-[44px] cursor-pointer items-center text-primary-text">
                        How-to sheet: {s.workInstruction.name} (version {s.workInstruction.revisionNo})
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
        <section id="decide" className="scroll-mt-20">
          <ApprovalPanel approval={v.approval} status={r.status} what="steps">
            {v.approval.canDecide && v.approval.nextStep && (
              <DecisionForm action={decideRoutingAction} id={r.id} stepLabel={`OK ${v.approval.nextStep.step} of ${v.approval.policy.length}, ${v.approval.nextStep.label}`} isFinal={v.approval.nextStep.step === lastStep} defaultEffectiveFrom={r.effectiveFrom} today={today} plain />
            )}
            {r.status === "pending_approval" && !v.approval.canDecide && (
              <p className="text-[13px] text-muted">You cannot decide this step: it needs another job, or you wrote, sent or already approved this version.</p>
            )}
          </ApprovalPanel>
        </section>
      )}

      {v.can.submit && (
        <section id="send" className="scroll-mt-20">
          <Card>
            <CardTitle>Send for approval</CardTitle>
            <CommandForm action={submitRoutingAction} hidden={{ id: r.id }} label="Send for approval" variant="cta" confirmText="Press Save above first. If only the order of the steps changed, one manager says OK; any other change needs QA and a manager or the owner." />
          </Card>
        </section>
      )}
    </div>
  );
}

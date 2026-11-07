import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { D } from "@/lib/qty";
import { businessToday, getInspectionPlanDetail } from "@/modules/masterdata";
import { Card, CardTitle, Dl, EmptyState, LinkButton, Table, Td } from "@/ui/core";
import { RecordHeader } from "@/ui/record";
import { Explain, NextStep, PageIntro } from "@/ui/guide";
import { waitingForApprover } from "../../_eng/waiting";
import { Forbidden } from "../../../forbidden";
import { decideInspectionPlanAction, newInspectionPlanRevisionAction, submitInspectionPlanAction } from "../../_eng/actions";
import { CommandForm, DecisionForm } from "../../_eng/forms";
import { DeleteDraftButton } from "../../../delete-draft-button";
import { ApprovalPanel, EffectiveRange, VerifyBanner, VersionChip } from "../../_eng/ui";
import { PlanTestEditor } from "./test-editor";

export const metadata: Metadata = { title: "Inspection plan" };

const spec = (t: { valueKind: string; uom: string | null; specMin: string | null; specMax: string | null; specText: string | null }) => {
  if (t.valueKind !== "numeric") return t.specText ?? "—";
  const mi = t.specMin === null ? null : D(t.specMin).toString();
  const ma = t.specMax === null ? null : D(t.specMax).toString();
  return `${mi !== null && ma !== null ? `${mi} – ${ma}` : mi !== null ? `≥ ${mi}` : `≤ ${ma}`} ${t.uom ?? ""}`;
};

export default async function InspectionPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!ctx.can("quality.inspection_plan.view")) return <Forbidden what="inspection plans" permission="quality.inspection_plan.view" />;
  const v = /^[0-9a-f-]{36}$/i.test(id) ? await getInspectionPlanDetail(ctx, id) : null;
  if (!v) return <EmptyState title="Quality checks not found" action={<LinkButton href="/masterdata/inspection-plans" variant="secondary">Back</LinkButton>}>Go back to the list and pick the item by name.</EmptyState>;
  const p = v.plan;
  const today = businessToday();
  const nextPolicy = v.approval.nextStep ? v.approval.policy.find((x) => x.step === v.approval.nextStep!.step) : null;
  const waiting = p.status === "pending_approval" && !v.approval.canDecide ? await waitingForApprover(ctx, "quality.inspection_plan.approve", nextPolicy, v.approval.policy.length, { exclude: [p.createdBy, p.submittedBy], prior: v.approval.decisions.map((d) => d.decidedBy), siteId: p.siteId }) : null;
  // UX audit C #10: one "What to do next" per state; the one green button is the form further down.
  const next =
    p.status === "draft" && v.can.edit ? (
      <NextStep text="Next: check the tests below, press Save, then send the checks for approval (button at the bottom). A second QA person approves them." />
    ) : p.status === "draft" ? (
      <NextStep text="This version is being written." waitingFor={await waitingForApprover(ctx, "quality.inspection_plan.edit", { step: 1, label: "QA", roles: ["qa_qc"] }, 1).then((w) => w.replace("to check it", "to finish it and send it for approval"))} />
    ) : p.status === "pending_approval" && v.approval.canDecide ? (
      <NextStep text="Next: read the tests, then approve them or send them back (below)." />
    ) : p.status === "pending_approval" ? (
      <NextStep text="Sent for approval." waitingFor={waiting ?? "Waiting for approval."} />
    ) : (
      <NextStep text={p.status === "approved" ? `In use: QA uses these checks ${p.planKind === "incoming" ? "when a delivery arrives" : p.planKind === "in_process" ? "while a batch is made" : "when a batch is finished"}. To change them, start a new version.` : "Not in use any more. Kept on record."} />
    );
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/masterdata/inspection-plans" className="text-[13px] text-primary-text hover:underline">
          ← Quality checks
        </Link>
        <RecordHeader
          back={{ href: "/masterdata/inspection-plans", label: "Quality checks for each item" }}
          typeLabel="Quality checks for an item"
          title={p.name.replace(/\s*\(PLACEHOLDER\)\s*/i, " ").trim()}
          chip={<VersionChip status={p.status} label={p.label} />}
          meta={[v.appliesTo, `version ${p.revisionNo}`, <span key="code" className="font-mono">{p.code}</span>]}
          secondary={v.can.newRevision ? <CommandForm action={newInspectionPlanRevisionAction} hidden={{ id: p.id }} label="Start a new version" variant="secondary" /> : undefined}
        />
      </div>
      <PageIntro>
        The checks QA does on this item before it may be used or sold, and the limits for each. The system stores them; QA decides them. <Explain term="version" />
      </PageIntro>
      {next}
      <VerifyBanner placeholder={p.isPlaceholder} />
      <Card>
        <Dl
          items={[
            ["When", p.planKind === "incoming" ? "When a delivery arrives" : p.planKind === "in_process" ? "While making a batch" : "When a batch is finished"],
            ["Effective", <EffectiveRange key="e" from={p.effectiveFrom} to={p.effectiveTo} />],
            ["Approved by", p.approvedByName ?? "—"],
          ]}
        />
        {p.samplingInstructions && <p className="mt-3 whitespace-pre-wrap text-[13px]"><span className="font-medium">Sampling:</span> {p.samplingInstructions}</p>}
      </Card>
      {v.can.edit ? (
        <Card>
          <CardTitle>Edit draft</CardTitle>
          <PlanTestEditor
            init={{
              planId: p.id,
              name: p.name,
              samplingInstructions: p.samplingInstructions ?? "",
              effectiveFrom: p.effectiveFrom ?? "",
              changeSummary: p.changeSummary ?? "",
              isPlaceholder: p.isPlaceholder,
              today,
              tests: v.tests.map((t) => ({
                testCode: t.testCode,
                name: t.name,
                method: t.method ?? "",
                valueKind: t.valueKind,
                uom: t.uom ?? "",
                specMin: t.specMin === null ? "" : D(t.specMin).toString(),
                specMax: t.specMax === null ? "" : D(t.specMax).toString(),
                specText: t.specText ?? "",
                isRequired: t.isRequired,
              })),
            }}
          />
          {ctx.can("quality.inspection_plan.edit") && (
            <div className="mt-4">
              <CommandForm action={submitInspectionPlanAction} hidden={{ id: p.id }} label="Submit for approval" variant="cta" confirmText="Save the draft first. A second QA user must approve the plan." />
            </div>
          )}
          {!p.submittedAt && (ctx.can("quality.inspection_plan.edit") || ctx.can("quality.inspection_plan.create")) && (
            <div className="mt-4">
              <DeleteDraftButton kind="inspection_plan" id={p.id} what="this draft plan and its tests" />
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <CardTitle>Tests</CardTitle>
          {v.tests.length === 0 ? (
            <EmptyState title="No tests" />
          ) : (
            <Table head={["#", "Code", "Test", "Method", "Specification", "Required"]}>
              {v.tests.map((t) => (
                <tr key={t.id}>
                  <Td>{t.sequence}</Td>
                  <Td className="font-mono">{t.testCode}</Td>
                  <Td>{t.name}</Td>
                  <Td>{t.method ?? "—"}</Td>
                  <Td>{spec(t)}</Td>
                  <Td>{t.isRequired ? "Yes" : "No"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      {p.status !== "draft" && (
        <ApprovalPanel approval={v.approval} status={p.status}>
          {v.approval.canDecide && v.approval.nextStep && <DecisionForm action={decideInspectionPlanAction} id={p.id} stepLabel={v.approval.nextStep.label} isFinal defaultEffectiveFrom={p.effectiveFrom} today={today} />}
        </ApprovalPanel>
      )}
      {v.revisions.length > 1 && (
        <Card>
          <CardTitle>Revisions</CardTitle>
          <ul className="flex flex-col gap-2 text-[13px]">
            {v.revisions.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/masterdata/inspection-plans/${r.id}`} className="font-semibold text-primary-text hover:underline">
                  Rev {r.revisionNo}
                </Link>
                <VersionChip status={r.status} label={r.label} />
                <EffectiveRange from={r.effectiveFrom} to={r.effectiveTo} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

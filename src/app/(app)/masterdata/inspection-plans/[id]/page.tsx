import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { D } from "@/lib/qty";
import { businessToday, getInspectionPlanDetail } from "@/modules/masterdata";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { decideInspectionPlanAction, newInspectionPlanRevisionAction, submitInspectionPlanAction } from "../../_eng/actions";
import { CommandForm, DecisionForm } from "../../_eng/forms";
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
  if (!ctx.can("quality.inspection_plan.view")) return <Forbidden what="inspection plans" />;
  const v = /^[0-9a-f-]{36}$/i.test(id) ? await getInspectionPlanDetail(ctx, id) : null;
  if (!v) return <EmptyState title="Inspection plan not found" action={<LinkButton href="/masterdata/inspection-plans" variant="secondary">Back</LinkButton>} />;
  const p = v.plan;
  const today = businessToday();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/masterdata/inspection-plans" className="text-[13px] text-primary-text hover:underline">
          ← Inspection plans
        </Link>
        <PageHeader
          title={`${p.code} revision ${p.revisionNo}`}
          subtitle={`${p.name} · ${v.appliesTo}`}
          actions={
            <>
              <VersionChip status={p.status} label={p.label} />
              {v.can.newRevision && <CommandForm action={newInspectionPlanRevisionAction} hidden={{ id: p.id }} label="Start new revision" variant="secondary" />}
            </>
          }
        />
      </div>
      <VerifyBanner placeholder={p.isPlaceholder} />
      <Card>
        <Dl
          items={[
            ["Kind", p.planKind.replace(/_/g, " ")],
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

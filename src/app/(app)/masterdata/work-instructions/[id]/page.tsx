import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { businessToday, getWorkInstruction } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { decideWorkInstructionAction, newWorkInstructionRevisionAction, submitWorkInstructionAction } from "../../_eng/actions";
import { CommandForm, DecisionForm } from "../../_eng/forms";
import { ApprovalPanel, EffectiveRange, VerifyBanner, VersionChip } from "../../_eng/ui";
import { WorkInstructionEditor } from "./editor";

export const metadata: Metadata = { title: "Work instruction" };

export default async function WorkInstructionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!ctx.can("masterdata.work_instruction.view")) return <Forbidden what="work instructions" />;
  const w = /^[0-9a-f-]{36}$/i.test(id) ? await getWorkInstruction(ctx, id) : null;
  if (!w) return <EmptyState title="Work instruction not found" action={<LinkButton href="/masterdata/work-instructions" variant="secondary">Back</LinkButton>} />;
  const today = businessToday();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/masterdata/work-instructions" className="text-[13px] text-primary-text hover:underline">
          ← Work instructions
        </Link>
        <PageHeader
          title={`${w.wi.code} · ${w.wi.name}`}
          actions={w.can.newRevision ? <CommandForm action={newWorkInstructionRevisionAction} hidden={{ workInstructionId: w.wi.id }} label="Start new revision" variant="secondary" /> : undefined}
        />
      </div>
      <VerifyBanner />
      {w.revisions.map((r) => (
        <div key={r.id} className="flex flex-col gap-3">
          <Card>
            <CardTitle action={<VersionChip status={r.status} label={r.label} />}>Revision {r.revisionNo}</CardTitle>
            <p className="text-[12px] text-muted">
              Effective <EffectiveRange from={r.effectiveFrom} to={r.effectiveTo} /> · drafted by {r.createdByName ?? "—"}
              {r.approvedByName ? ` · approved by ${r.approvedByName}${r.approvedAt ? ` ${fmtDateTime(r.approvedAt)}` : ""}` : ""}
            </p>
            {r.status === "draft" && w.can.edit ? (
              <div className="mt-3">
                <WorkInstructionEditor revisionId={r.id} body={r.bodyMarkdown} changeSummary={r.changeSummary} />
                {w.can.submit && (
                  <div className="mt-3">
                    <CommandForm action={submitWorkInstructionAction} hidden={{ id: r.id }} label="Submit for approval" variant="cta" confirmText="Save the text first; it cannot change after submitting." />
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 whitespace-pre-wrap rounded-[12px] bg-surface-2/60 p-3 text-[13px]">{r.bodyMarkdown}</p>
            )}
          </Card>
          {r.status !== "draft" && (
            <ApprovalPanel approval={r.approval} status={r.status}>
              {r.canDecide && r.approval.nextStep && <DecisionForm action={decideWorkInstructionAction} id={r.id} stepLabel={r.approval.nextStep.label} isFinal today={today} />}
            </ApprovalPanel>
          )}
        </div>
      ))}
    </div>
  );
}

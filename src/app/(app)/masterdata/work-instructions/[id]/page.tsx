import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { businessToday, getWorkInstruction } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Explain, MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { RecordNo } from "@/ui/plain-list";
import { Forbidden } from "../../../forbidden";
import { decideWorkInstructionAction, newWorkInstructionRevisionAction, submitWorkInstructionAction } from "../../_eng/actions";
import { CommandForm, DecisionForm } from "../../_eng/forms";
import { DeleteDraftButton } from "../../../delete-draft-button";
import { ApprovalPanel, VerifyBanner } from "../../_eng/ui";
import { PlainVersionChip, useFromText, NEXT_WRAP } from "../../_eng/plain";
import { waitingForApprover } from "../../_eng/waiting";
import { WorkInstructionEditor } from "./editor";

export const metadata: Metadata = { title: "How-to sheet" };

export default async function WorkInstructionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!ctx.can("masterdata.work_instruction.view")) return <Forbidden what="how-to sheets" />;
  const w = /^[0-9a-f-]{36}$/i.test(id) ? await getWorkInstruction(ctx, id) : null;
  if (!w)
    return (
      <EmptyState title="How-to sheet not found" action={<LinkButton href="/masterdata/work-instructions" variant="secondary">All how-to sheets</LinkButton>}>
        It may have been deleted. Go back to the list and look for its name.
      </EmptyState>
    );
  const today = businessToday();
  const open = w.revisions.find((r) => r.status === "draft" || r.status === "pending_approval") ?? null;
  const current = w.revisions.find((r) => r.status === "approved" && r.label === "effective") ?? null;
  const shown = [open, current].filter((r): r is NonNullable<typeof r> => !!r);
  const older = w.revisions.filter((r) => !shown.includes(r));
  const nextPolicy = open?.approval.nextStep ? open.approval.policy.find((p) => p.step === open.approval.nextStep!.step) : null;
  const waiting = open?.status === "pending_approval" && !open.canDecide ? await waitingForApprover(ctx, "masterdata.work_instruction.approve", nextPolicy, open.approval.policy.length) : null;

  const revisionCard = (r: (typeof w.revisions)[number]) => (
    <div key={r.id} className="flex flex-col gap-3">
      <Card>
        <CardTitle action={<PlainVersionChip status={r.status} label={r.label} />}>Version {r.revisionNo}</CardTitle>
        <p className="text-[13px] text-muted">
          {useFromText(r.effectiveFrom, r.effectiveTo, fmtDate)} · written by {r.createdByName ?? "—"}
          {r.approvedByName ? ` · OK by ${r.approvedByName}${r.approvedAt ? ` ${fmtDateTime(r.approvedAt)}` : ""}` : ""}
        </p>
        {r.status === "draft" && w.can.edit ? (
          <div className="mt-3 flex flex-col gap-3">
            <WorkInstructionEditor revisionId={r.id} body={r.bodyMarkdown} changeSummary={r.changeSummary} />
            {w.can.submit && (
              <section id="send" className="scroll-mt-20 border-t border-line pt-3">
                <CommandForm action={submitWorkInstructionAction} hidden={{ id: r.id }} label="Send for an OK" variant="cta" confirmText="Press Save first; the text cannot change after sending." />
              </section>
            )}
            {!r.submittedAt && (
              <MoreDetails title="Delete this draft">
                <DeleteDraftButton kind="work_instruction_revision" id={r.id} what="this draft version (a how-to sheet with no other version is removed too)" />
              </MoreDetails>
            )}
          </div>
        ) : (
          <p className="mt-3 whitespace-pre-wrap break-words rounded-[12px] bg-surface-2/60 p-3 text-[14px]">{r.bodyMarkdown}</p>
        )}
      </Card>
      {r.status !== "draft" && (
        <section id={r.id === open?.id ? "decide" : undefined} className="scroll-mt-20">
          <ApprovalPanel approval={r.approval} status={r.status} what="how-to sheet">
            {r.canDecide && r.approval.nextStep && <DecisionForm action={decideWorkInstructionAction} id={r.id} stepLabel={r.approval.nextStep.label} isFinal today={today} plain />}
          </ApprovalPanel>
        </section>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/masterdata/work-instructions" className="inline-flex min-h-[44px] items-center text-[14px] text-primary-text hover:underline">
          ← All how-to sheets
        </Link>
        <PageHeader
          title={w.wi.name}
          subtitle={
            <>
              How-to sheet · <RecordNo>{w.wi.code}</RecordNo>
            </>
          }
        />
      </div>
      <PageIntro>
        This screen is for one how-to sheet: the text a worker reads at a step, and its versions. <Explain term="version" label="What is a version?" />
      </PageIntro>
      {open?.status === "draft" ? (
        w.can.edit && w.can.submit ? (
          <NextStep className={NEXT_WRAP} text={`Next: write the text of version ${open.revisionNo}, press Save, then send it for an OK.`} action={{ label: "Send for an OK", href: "#send" }} />
        ) : (
          <NextStep className={NEXT_WRAP} text={`Version ${open.revisionNo} is being written.`} waitingFor={`Waiting for ${open.createdByName ?? "the writer"} to finish it and send it for an OK.`} />
        )
      ) : open?.status === "pending_approval" ? (
        open.canDecide ? (
          <NextStep className={NEXT_WRAP} text="Next: read the text, then say OK or not OK." action={{ label: "Decide", href: "#decide" }} />
        ) : (
          <NextStep className={NEXT_WRAP} text="Sent for an OK." waitingFor={waiting ?? "Waiting for approval."} />
        )
      ) : w.can.newRevision ? (
        <NextStep className={NEXT_WRAP} text={current ? `Version ${current.revisionNo} is in use. To change the text, start a new version.` : "No version is in use. Start a new version."} action={{ label: "Start a new version", href: "#new-version" }} />
      ) : (
        <NextStep className={NEXT_WRAP} text={current ? `Version ${current.revisionNo} is in use.` : "No version is in use yet."} />
      )}
      <VerifyBanner />
      {shown.map(revisionCard)}
      {w.can.newRevision && (
        <section id="new-version" className="scroll-mt-20">
          <Card>
            <CardTitle>Change the text</CardTitle>
            <p className="mb-3 text-[14px] text-fg-2">A new version starts as a copy you can change. The version in use stays until the new one gets its OK.</p>
            <CommandForm action={newWorkInstructionRevisionAction} hidden={{ workInstructionId: w.wi.id }} label="Start a new version" variant="primary" />
          </Card>
        </section>
      )}
      {older.length > 0 && <MoreDetails title={`Older versions (${older.length})`}>{older.map(revisionCard)}</MoreDetails>}
    </div>
  );
}

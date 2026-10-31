import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getCapa } from "@/modules/quality";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Timeline } from "../../_ui";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { CapaStatusChip } from "../_ui";
import { ActionStepForm, AddActionForm, CancelCapaForm, CloseCapaForm, EditCapaForm, EffectivenessForm, SubmitCapaForm } from "../forms";

export const dynamic = "force-dynamic";

const ACTION_TONE = { open: "info", done: "appr", verified: "ok", cancelled: "neu" } as const;
const ACTION_WORD: Record<string, string> = { open: "To do", done: "Done – to be checked", verified: "Checked", cancelled: "Cancelled" };
const STATE_WORD: Record<string, string> = { open: "new", in_progress: "being fixed", verification: "checking the fix works", closed: "done", cancelled: "cancelled" };

const plusDays = (d: string, n: number) => {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** CAPA detail (ux-system §9.14): record, actions with owners and due dates, verification, effectiveness, closure. */
export default async function CapaPage({ params, searchParams }: { params: Promise<{ capaId: string }>; searchParams: Promise<{ opened?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.capa.view")) return <Forbidden what="fix-and-prevent plans" />;
  const { capaId } = await params;
  const sp = await searchParams;
  let v: Awaited<ReturnType<typeof getCapa>>;
  try {
    v = await getCapa(ctx, capaId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Plan not found" action={<LinkButton href="/quality/capa" variant="secondary">All plans</LinkButton>}>
          This fix-and-prevent plan does not exist or is not at one of your sites. Ask QA if you think it should be here.
        </EmptyState>
      );
    }
    throw e;
  }
  const c = v.capa;
  const live = c.status === "open" || c.status === "in_progress";
  return (
    <>
      <PageHeader
        title={c.title}
        subtitle={
          <>
            Fix-and-prevent plan · <RecordNo>{c.capaNumber}</RecordNo>
          </>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-3">
              {ctx.can("quality.change_control.create") && (
                <LinkButton href={`/quality/changes/new?capaId=${c.id}`} variant="secondary">
                  Ask for a change (recipe, steps, tests)
                </LinkButton>
              )}
              <LinkButton href="/quality/capa" variant="secondary">
                All plans
              </LinkButton>
              {v.can.cancel && live && (
                <div className="border-t border-line pt-3">
                  <p className="mb-2 text-[13px] text-muted">Cancel only a duplicate or a plan started by mistake.</p>
                  <CancelCapaForm capaId={c.id} />
                </div>
              )}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for QA and the people doing the work: what went wrong, what we do about it, and the check that the fix worked.</PageIntro>
      {c.status === "open" ? (
        v.can.addAction ? <NextStep text="Next: add the first thing to do, who does it and by when." action={{ label: "Add what to do", href: "#actions" }} /> : <NextStep text="Nothing to do is planned yet." waitingFor={`Waiting for ${c.ownerName} to add what to do.`} />
      ) : c.status === "in_progress" ? (
        v.can.submit ? (
          <NextStep text="Next: everything is done and checked. Send the plan for the final check." action={{ label: "Send for the final check", href: "#closure" }} />
        ) : (
          <NextStep text={`Next: ${v.actions.some((a) => a.canComplete) ? "do your part and mark it as done" : v.actions.some((a) => a.canVerify) ? "check the work that is marked as done" : "finish the things to do"}.`} waitingFor={v.submitBlockers.length ? v.submitBlockers[0] : undefined} />
        )
      ) : c.status === "verification" ? (
        v.can.recordEffectiveness ? (
          <NextStep text="Next: did the fix work? Write down what you saw." action={{ label: "Write down the check", href: "#closure" }} />
        ) : v.can.close ? (
          <NextStep text="Next: the fix worked. Close the plan." action={{ label: "Close the plan", href: "#closure" }} />
        ) : (
          <NextStep text="The fix is being watched." waitingFor={v.can.closeBlockedReason ?? (c.effectivenessDueOn ? `The check is due on ${fmtDate(c.effectivenessDueOn)}.` : "Waiting for QA.")} />
        )
      ) : null}

      <div className="flex flex-col gap-5">
        {sp.opened && <Banner tone="ok" title="Plan started">{c.ownerName} was told. Add what to do, who does it and by when.</Banner>}
        <Card>
          <CardTitle action={<CapaStatusChip status={c.status} />}>The problem</CardTitle>
          <p className="mb-4 whitespace-pre-wrap text-[14px]">{c.problemStatement}</p>
          <Dl
            items={[
              [
                "Comes from",
                v.deviation ? (
                  <Link key="d" className="text-primary-text hover:underline" href={`/quality/deviations/${v.deviation.id}`}>
                    Problem report {v.deviation.number}
                  </Link>
                ) : v.complaint ? (
                  <Link key="c" className="text-primary-text hover:underline" href={`/quality/complaints/${v.complaint.id}`}>
                    Complaint {v.complaint.number}
                  </Link>
                ) : (
                  `${c.sourceLabel}${c.sourceReference ? `: ${c.sourceReference}` : ""}`
                ),
              ],
              ["Looks after it", c.ownerName],
              ["Finish by", c.dueDate ? fmtDate(c.dueDate) : "—"],
              ["Started", `${c.createdByName}, ${fmtDateTime(c.createdAt)}`],
              ["Sent for the final check", c.submittedAt ? `${c.submittedByName}, ${fmtDateTime(c.submittedAt)}` : "—"],
              ["Closed", c.closedAt ? `${fmtDateTime(c.closedAt)} · ${c.closedByName}` : c.status === "cancelled" ? `Cancelled: ${c.cancelReason}` : "—"],
            ]}
          />
        </Card>

        <Card>
          <CardTitle>Why it happened and the plan</CardTitle>
          <Dl
            items={[
              ["What caused it", c.rootCause ?? "—"],
              ["What we fix now", c.correctiveAction ?? "—"],
              ["What we change so it does not happen again", c.preventiveAction ?? "—"],
              ["How we know the fix worked", c.effectivenessCriteria ?? "—"],
            ]}
          />
          {v.can.edit && (
            <details className="mt-4 border-t border-line pt-4" open={!c.rootCause && c.status === "in_progress"}>
              <summary className="min-h-[44px] cursor-pointer py-2 text-[14px] text-primary-text">Write or change the cause and the plan</summary>
              <div className="mt-3">
                <EditCapaForm capaId={c.id} current={c} owners={v.owners} canReassign={v.can.reassign} />
              </div>
            </details>
          )}
        </Card>

        <Card>
          <span id="actions" className="block scroll-mt-24" />
          <CardTitle>Things to do</CardTitle>
          {v.actions.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing to do is planned yet. Each thing has a person, a date, and a second person checks it is done.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {v.actions.map((a) => (
                <li key={a.id} className="rounded-[16px] border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{a.actionNo}.</span>
                    <Chip tone={a.actionKind === "corrective" ? "info" : "appr"}>{a.actionKind === "corrective" ? "Fix now" : "So it does not happen again"}</Chip>
                    <Chip tone={ACTION_TONE[a.status as keyof typeof ACTION_TONE] ?? "neu"}>{ACTION_WORD[a.status] ?? a.status}</Chip>
                    {a.overdue && <Chip tone="bad">Late</Chip>}
                  </div>
                  <p className="mt-1 text-[14px]">{a.description}</p>
                  <p className="mt-1 text-[12px] text-muted">
                    {a.ownerName} · by {fmtDate(a.dueDate)}
                    {a.verificationMethod ? ` · check: ${a.verificationMethod}` : ""}
                  </p>
                  {a.completedAt && (
                    <p className="text-[12px] text-fg-2">
                      Done {fmtDateTime(a.completedAt)} by {a.completedByName}: {a.completionNote}
                    </p>
                  )}
                  {a.verifiedAt && (
                    <p className="text-[12px] text-fg-2">
                      Checked {fmtDateTime(a.verifiedAt)} by {a.verifiedByName}: {a.verificationNote}
                    </p>
                  )}
                  {a.status === "cancelled" && <p className="text-[12px] text-muted">Cancelled: {a.cancelReason}</p>}
                  {(a.canComplete || a.canVerify || a.canReopen || a.canCancel) && (
                    <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
                      {a.canComplete && <ActionStepForm actionId={a.id} kind="complete" />}
                      {a.canVerify && <ActionStepForm actionId={a.id} kind="verify" />}
                      {a.canReopen && <ActionStepForm actionId={a.id} kind="reopen" />}
                      {a.canCancel && <ActionStepForm actionId={a.id} kind="cancel" />}
                    </div>
                  )}
                  {a.status === "done" && !a.canVerify && a.completedBy === ctx.userId && <p className="mt-2 text-[12px] text-muted">You did this one; another person checks it.</p>}
                </li>
              ))}
            </ol>
          )}
          {v.can.addAction && (
            <details className="mt-4 border-t border-line pt-4" open={v.actions.length === 0}>
              <summary className="min-h-[44px] cursor-pointer py-2 text-[14px] text-primary-text">Add something to do</summary>
              <div className="mt-3">
                <AddActionForm capaId={c.id} owners={v.owners} minDate={v.today} />
              </div>
            </details>
          )}
        </Card>

        <Card>
          <span id="closure" className="block scroll-mt-24" />
          <CardTitle>Did the fix work? Close the plan</CardTitle>
          {c.status === "in_progress" &&
            (v.can.submit ? (
              <SubmitCapaForm capaId={c.id} earliest={plusDays(v.today, v.effectivenessCheckDays)} days={v.effectivenessCheckDays} />
            ) : (
              <p className="text-[13px] text-muted">{v.submitBlockers.length ? v.submitBlockers.join(" ") : "Only QA sends a plan for the final check."}</p>
            ))}
          {c.status === "open" && <p className="text-[13px] text-muted">Add the first thing to do to start the plan.</p>}
          {(c.status === "verification" || c.status === "closed") && (
            <Dl
              items={[
                ["Check due on", c.effectivenessDueOn ? fmtDate(c.effectivenessDueOn) : "—"],
                ["Did it work?", c.effectivenessResult ? (c.effectivenessResult === "effective" ? "Yes" : "No") : "Not checked yet"],
                ["Checked by", c.effectivenessCheckedAt ? `${c.effectivenessCheckedByName}, ${fmtDateTime(c.effectivenessCheckedAt)}` : "—"],
                ["What was seen", c.effectivenessEvidence ?? "—"],
              ]}
            />
          )}
          {v.can.recordEffectiveness && (
            <div className="mt-4 border-t border-line pt-4">
              <EffectivenessForm capaId={c.id} />
            </div>
          )}
          {c.status === "verification" && !c.effectivenessResult && !v.can.recordEffectiveness && c.effectivenessDueOn && <p className="mt-3 text-[13px] text-muted">The check can be written down from {fmtDate(c.effectivenessDueOn)}.</p>}
          {v.can.close && (
            <div className="mt-4 border-t border-line pt-4">
              <CloseCapaForm capaId={c.id} />
            </div>
          )}
          {v.can.closeBlockedReason && <p className="mt-3 text-[13px] text-muted">{v.can.closeBlockedReason}</p>}
          {c.closureNote && <p className="mt-3 text-[13px]">Note: {c.closureNote}</p>}
        </Card>



        <Card>
          <CardTitle>What happened</CardTitle>
          <Timeline rows={v.timeline} word={(s) => STATE_WORD[s] ?? s.replace(/_/g, " ")} />
        </Card>
      </div>
    </>
  );
}

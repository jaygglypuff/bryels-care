import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getCapa } from "@/modules/quality";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { CapaStatusChip } from "../_ui";
import { ActionStepForm, AddActionForm, CancelCapaForm, CloseCapaForm, EditCapaForm, EffectivenessForm, SubmitCapaForm } from "../forms";

export const dynamic = "force-dynamic";

const ACTION_TONE = { open: "info", done: "appr", verified: "ok", cancelled: "neu" } as const;

const plusDays = (d: string, n: number) => {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** CAPA detail (ux-system §9.14): record, actions with owners and due dates, verification, effectiveness, closure. */
export default async function CapaPage({ params, searchParams }: { params: Promise<{ capaId: string }>; searchParams: Promise<{ opened?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.capa.view")) return <Forbidden what="CAPA" />;
  const { capaId } = await params;
  const sp = await searchParams;
  let v: Awaited<ReturnType<typeof getCapa>>;
  try {
    v = await getCapa(ctx, capaId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="CAPA not found" action={<LinkButton href="/quality/capa" variant="secondary">CAPA</LinkButton>}>
          This CAPA does not exist or is not at one of your sites.
        </EmptyState>
      );
    }
    throw e;
  }
  const c = v.capa;
  const live = c.status === "open" || c.status === "in_progress";
  return (
    <>
      <PageHeader title={c.capaNumber} subtitle={`${c.title} · ${c.siteCode}`} actions={<LinkButton href="/quality/capa" variant="secondary">CAPA</LinkButton>} />
      <div className="flex flex-col gap-5">
        {sp.opened && <Banner tone="ok" title={`CAPA ${c.capaNumber} opened`}>The owner was notified. Add actions with owners and due dates; the first action starts the CAPA.</Banner>}
        <Card>
          <CardTitle action={<CapaStatusChip status={c.status} />}>CAPA</CardTitle>
          <p className="mb-4 whitespace-pre-wrap text-[14px]">{c.problemStatement}</p>
          <Dl
            items={[
              [
                "Source",
                v.deviation ? (
                  <Link key="d" className="text-primary-text hover:underline" href={`/quality/deviations/${v.deviation.id}`}>
                    Deviation {v.deviation.number}
                  </Link>
                ) : v.complaint ? (
                  <Link key="c" className="text-primary-text hover:underline" href={`/quality/complaints/${v.complaint.id}`}>
                    Complaint {v.complaint.number}
                  </Link>
                ) : (
                  `${c.sourceLabel}${c.sourceReference ? `: ${c.sourceReference}` : ""}`
                ),
              ],
              ["Owner", c.ownerName],
              ["Target date", c.dueDate ? fmtDate(c.dueDate) : "—"],
              ["Opened", `${fmtDateTime(c.createdAt)} · ${c.createdByName}`],
              ["Submitted for closure", c.submittedAt ? `${fmtDateTime(c.submittedAt)} · ${c.submittedByName}` : "—"],
              ["Closed", c.closedAt ? `${fmtDateTime(c.closedAt)} · ${c.closedByName}` : c.status === "cancelled" ? `Cancelled: ${c.cancelReason}` : "—"],
            ]}
          />
        </Card>

        <Card>
          <CardTitle>Root cause and plan</CardTitle>
          <Dl
            items={[
              ["Root cause", c.rootCause ?? "—"],
              ["Corrective action", c.correctiveAction ?? "—"],
              ["Preventive action", c.preventiveAction ?? "—"],
              ["Effectiveness criterion", c.effectivenessCriteria ?? "—"],
            ]}
          />
          {v.can.edit && (
            <details className="mt-4 border-t border-line pt-4">
              <summary className="cursor-pointer text-[13px] text-primary-text">Edit the CAPA record</summary>
              <div className="mt-3">
                <EditCapaForm capaId={c.id} current={c} owners={v.owners} canReassign={v.can.reassign} />
              </div>
            </details>
          )}
        </Card>

        <Card>
          <CardTitle>Actions</CardTitle>
          {v.actions.length === 0 ? (
            <p className="text-[13px] text-muted">No actions yet. Each action has an owner, a due date and is verified by a second person.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {v.actions.map((a) => (
                <li key={a.id} className="rounded-[16px] border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">#{a.actionNo}</span>
                    <Chip tone={a.actionKind === "corrective" ? "info" : "appr"}>{a.actionKind}</Chip>
                    <Chip tone={ACTION_TONE[a.status as keyof typeof ACTION_TONE] ?? "neu"}>{a.status}</Chip>
                    {a.overdue && <Chip tone="bad">Overdue</Chip>}
                  </div>
                  <p className="mt-1 text-[14px]">{a.description}</p>
                  <p className="mt-1 text-[12px] text-muted">
                    Owner {a.ownerName} · due {fmtDate(a.dueDate)}
                    {a.verificationMethod ? ` · verification: ${a.verificationMethod}` : ""}
                  </p>
                  {a.completedAt && (
                    <p className="text-[12px] text-fg-2">
                      Done {fmtDateTime(a.completedAt)} by {a.completedByName}: {a.completionNote}
                    </p>
                  )}
                  {a.verifiedAt && (
                    <p className="text-[12px] text-fg-2">
                      Verified {fmtDateTime(a.verifiedAt)} by {a.verifiedByName}: {a.verificationNote}
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
                  {a.status === "done" && !a.canVerify && a.completedBy === ctx.userId && <p className="mt-2 text-[12px] text-muted">You recorded this action; another person must verify it.</p>}
                </li>
              ))}
            </ol>
          )}
          {v.can.addAction && (
            <details className="mt-4 border-t border-line pt-4" open={v.actions.length === 0}>
              <summary className="cursor-pointer text-[13px] text-primary-text">Add an action</summary>
              <div className="mt-3">
                <AddActionForm capaId={c.id} owners={v.owners} minDate={v.today} />
              </div>
            </details>
          )}
        </Card>

        <Card>
          <CardTitle>Verification and closure</CardTitle>
          {c.status === "in_progress" &&
            (v.can.submit ? (
              <SubmitCapaForm capaId={c.id} earliest={plusDays(v.today, v.effectivenessCheckDays)} days={v.effectivenessCheckDays} />
            ) : (
              <p className="text-[13px] text-muted">{v.submitBlockers.length ? v.submitBlockers.join(" ") : "Submitting for closure needs quality.capa.submit (QA)."}</p>
            ))}
          {c.status === "open" && <p className="text-[13px] text-muted">Add the first action to start the CAPA.</p>}
          {(c.status === "verification" || c.status === "closed") && (
            <Dl
              items={[
                ["Effectiveness check due", c.effectivenessDueOn ? fmtDate(c.effectivenessDueOn) : "—"],
                ["Result", c.effectivenessResult ? c.effectivenessResult.replace("_", " ") : "Not recorded"],
                ["Checked", c.effectivenessCheckedAt ? `${fmtDateTime(c.effectivenessCheckedAt)} · ${c.effectivenessCheckedByName}` : "—"],
                ["Evidence", c.effectivenessEvidence ?? "—"],
              ]}
            />
          )}
          {v.can.recordEffectiveness && (
            <div className="mt-4 border-t border-line pt-4">
              <EffectivenessForm capaId={c.id} />
            </div>
          )}
          {c.status === "verification" && !c.effectivenessResult && !v.can.recordEffectiveness && c.effectivenessDueOn && <p className="mt-3 text-[13px] text-muted">The check can be recorded from {fmtDate(c.effectivenessDueOn)}.</p>}
          {v.can.close && (
            <div className="mt-4 border-t border-line pt-4">
              <CloseCapaForm capaId={c.id} />
            </div>
          )}
          {v.can.closeBlockedReason && <p className="mt-3 text-[13px] text-muted">{v.can.closeBlockedReason}</p>}
          {c.closureNote && <p className="mt-3 text-[13px]">Closure note: {c.closureNote}</p>}
        </Card>

        {v.can.cancel && live && (
          <Card>
            <details>
              <summary className="cursor-pointer text-[13px] text-primary-text">Cancel this CAPA (duplicate or raised in error)</summary>
              <div className="mt-3">
                <CancelCapaForm capaId={c.id} />
              </div>
            </details>
          </Card>
        )}

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

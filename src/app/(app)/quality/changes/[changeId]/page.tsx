import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getChangeControl } from "@/modules/quality";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Timeline } from "../../_ui";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { ChangeStatusChip } from "../../capa/_ui";
import { CancelChangeForm, CloseChangeForm, DecideChangeForm, EditChangeForm, ImplementChangeForm, LinkRevisionForm, SubmitChangeForm } from "../forms";

export const dynamic = "force-dynamic";

/** Change control detail: proposal, impact assessment, approval card, implementation and closure. */
export default async function ChangePage({ params, searchParams }: { params: Promise<{ changeId: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.change_control.view")) return <Forbidden what="change requests" />;
  const { changeId } = await params;
  const sp = await searchParams;
  let v: Awaited<ReturnType<typeof getChangeControl>>;
  try {
    v = await getChangeControl(ctx, changeId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Change request not found" action={<LinkButton href="/quality/changes" variant="secondary">All change requests</LinkButton>}>
          This change request does not exist or is not at one of your sites. Ask QA if you think it should be here.
        </EmptyState>
      );
    }
    throw e;
  }
  const c = v.change;
  return (
    <>
      <PageHeader
        title={c.title}
        subtitle={
          <>
            Change request · {c.siteCode ?? "all sites"} · <RecordNo>{c.changeNumber}</RecordNo>
          </>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-3">
              <LinkButton href="/quality/changes" variant="secondary">
                All change requests
              </LinkButton>
              {v.can.cancel && (
                <div className="border-t border-line pt-3">
                  <CancelChangeForm changeControlId={c.id} />
                </div>
              )}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for QA and managers: say what the change affects, get it approved, make it, and confirm it.</PageIntro>
      {c.status === "draft" ? (
        v.can.submit ? (
          <NextStep text={c.impactAssessment ? "Next: send it for approval." : "Next: write what the change affects and how risky it is, then send it for approval."} action={{ label: c.impactAssessment ? "Send for approval" : "Write what it affects", href: "#assess" }} />
        ) : (
          <NextStep text="The request is being written." waitingFor={`Waiting for ${c.createdByName} to finish and send it.`} />
        )
      ) : c.status === "submitted" ? (
        v.can.decide && v.approval.next ? (
          <NextStep text="Next: approve it, send it back, or say no." action={{ label: "Decide", href: "#approval" }} />
        ) : (
          <NextStep text="Sent for approval." waitingFor={v.approval.next ? `Waiting for: ${v.approval.next.label}.` : "Waiting for approval."} />
        )
      ) : c.status === "approved" ? (
        v.can.implement && !v.can.implementBlockedReason ? (
          <NextStep text="Next: make the change, then write what you did." action={{ label: "I made the change", href: "#implement" }} />
        ) : (
          <NextStep text="Approved." waitingFor={v.can.implementBlockedReason ?? "Waiting for the change to be made."} />
        )
      ) : c.status === "implemented" ? (
        v.can.close ? <NextStep text="Next: check the change and close the request." action={{ label: "Confirm and close", href: "#implement" }} /> : <NextStep text="The change is made." waitingFor="Waiting for a second person (not the one who made it) to confirm." />
      ) : null}

      <div className="flex flex-col gap-5">
        {sp.created && <Banner tone="ok" title="Change request saved">Now write what it affects and how risky it is, then send it for approval.</Banner>}
        <Card>
          <CardTitle action={<ChangeStatusChip status={c.status} />}>What should change</CardTitle>
          <p className="mb-2 whitespace-pre-wrap text-[14px]">{c.description}</p>
          <p className="mb-4 whitespace-pre-wrap text-[13px] text-fg-2">Why: {c.justification}</p>
          <Dl
            items={[
              ["Kind", c.entityTypeLabel.replace("Formula revision", "Recipe").replace("Routing revision", "Steps for a product").replace("Inspection plan revision", "Quality checks for an item").replace("Work instruction revision", "Work instruction")],
              [
                "The new version",
                v.entity ? (
                  <span key="e" className="inline-flex flex-wrap items-center gap-2">
                    <Link className="text-primary-text hover:underline" href={v.entity.href}>
                      {v.entity.label}
                    </Link>
                    <StatusChip status={v.entity.status} />
                  </span>
                ) : c.entityType === "other" ? (
                  "—"
                ) : (
                  "Not linked yet"
                ),
              ],
              ["Fix-and-prevent plan", v.capa ? <Link key="c" className="text-primary-text hover:underline" href={`/quality/capa/${v.capa.id}`}>{v.capa.number}</Link> : "—"],
              ["How risky", c.riskLevel ?? "Not rated yet"],
              ["Done by", c.targetDate ? fmtDate(c.targetDate) : "—"],
              ["Asked by", `${c.createdByName}, ${fmtDateTime(c.createdAt)}`],
              ["Sent for approval", c.submittedAt ? `${c.submittedByName}, ${fmtDateTime(c.submittedAt)}` : "—"],
              ["Change made", c.implementedAt ? `${c.implementedByName}, ${fmtDateTime(c.implementedAt)}` : "—"],
              ["Closed", c.closedAt ? `${fmtDateTime(c.closedAt)} · ${c.closedByName}` : c.status === "cancelled" ? `Cancelled: ${c.cancelReason}` : "—"],
            ]}
          />
        </Card>

        <Card>
          <span id="assess" className="block scroll-mt-24" />
          <CardTitle>What it affects</CardTitle>
          <Dl
            items={[
              ["What it affects", c.impactAssessment ?? "—"],
              ["How the change will be made", c.implementationPlan ?? "—"],
              ["What was changed", c.implementationNote ?? "—"],
            ]}
          />
          {v.can.edit && (
            <details className="mt-4 border-t border-line pt-4" open={!c.impactAssessment}>
              <summary className="min-h-[44px] cursor-pointer py-2 text-[14px] text-primary-text">Write what it affects and how risky it is</summary>
              <div className="mt-3">
                <EditChangeForm changeControlId={c.id} current={c} riskLevels={v.riskLevels} />
              </div>
            </details>
          )}
          {v.can.link && v.entityOptions.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <LinkRevisionForm changeControlId={c.id} options={v.entityOptions} current={c.entityId} />
            </div>
          )}
          {v.can.submit && (
            <div className="mt-4 border-t border-line pt-4">
              <SubmitChangeForm changeControlId={c.id} />
            </div>
          )}
        </Card>

        <Card>
          <span id="approval" className="block scroll-mt-24" />
          <CardTitle>Approval</CardTitle>
          <ol className="flex flex-col gap-2 text-[14px]">
            {v.approval.steps.map((s) => (
              <li key={s.step} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {s.step}. {s.label}
                </span>
                {s.roleCodes.length > 0 && <span className="text-[12px] text-muted">({s.roleCodes.map((r) => r.replace(/_/g, " ")).join(" or ")})</span>}
                {s.done ? <Chip tone="ok">Approved by {s.approvals.map((a) => a.name).join(", ")}</Chip> : c.status === "submitted" ? <Chip tone="appr">Waiting</Chip> : null}
              </li>
            ))}
          </ol>
          {v.approval.history.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-[12px] text-fg-2">
              {v.approval.history.map((h, i) => (
                <li key={i}>
                  Round {h.cycle}, step {h.step}: {({ approved: "approved", returned: "sent back", rejected: "said no" } as Record<string, string>)[h.decision] ?? h.decision} by {h.name} on {fmtDateTime(h.at)}
                  {h.note ? ` — ${h.note}` : ""}
                </li>
              ))}
            </ul>
          )}
          {v.can.decide && v.approval.next && (
            <div className="mt-4 border-t border-line pt-4">
              <DecideChangeForm changeControlId={c.id} stepLabel={v.approval.next.label} />
            </div>
          )}
          {c.status === "submitted" && !v.can.decide && <p className="mt-3 text-[13px] text-muted">The person who asked and the person who sent it cannot approve it themselves; someone else in the next step decides.</p>}
        </Card>

        {(c.status === "approved" || c.status === "implemented") && (
          <Card>
            <span id="implement" className="block scroll-mt-24" />
            <CardTitle>Make the change</CardTitle>
            {v.can.implement && (v.can.implementBlockedReason ? <p className="text-[13px] text-muted">{v.can.implementBlockedReason}</p> : <ImplementChangeForm changeControlId={c.id} />)}
            {v.can.close && <CloseChangeForm changeControlId={c.id} />}
            {c.status === "implemented" && !v.can.close && <p className="text-[13px] text-muted">A second person (not the one who made the change) confirms and closes it.</p>}
          </Card>
        )}



        <Card>
          <CardTitle>What happened</CardTitle>
          <Timeline rows={v.timeline} word={(s) => ({ draft: "being written", submitted: "waiting for approval", approved: "approved", rejected: "not approved", implemented: "change made", closed: "done", cancelled: "cancelled" })[s] ?? s} />
        </Card>
      </div>
    </>
  );
}

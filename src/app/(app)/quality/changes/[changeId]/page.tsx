import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getChangeControl } from "@/modules/quality";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { ChangeStatusChip } from "../../capa/_ui";
import { CancelChangeForm, CloseChangeForm, DecideChangeForm, EditChangeForm, ImplementChangeForm, LinkRevisionForm, SubmitChangeForm } from "../forms";

export const dynamic = "force-dynamic";

/** Change control detail: proposal, impact assessment, approval card, implementation and closure. */
export default async function ChangePage({ params, searchParams }: { params: Promise<{ changeId: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.change_control.view")) return <Forbidden what="change control" />;
  const { changeId } = await params;
  const sp = await searchParams;
  let v: Awaited<ReturnType<typeof getChangeControl>>;
  try {
    v = await getChangeControl(ctx, changeId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Change control not found" action={<LinkButton href="/quality/changes" variant="secondary">Change control</LinkButton>}>
          This change does not exist or is not at one of your sites.
        </EmptyState>
      );
    }
    throw e;
  }
  const c = v.change;
  return (
    <>
      <PageHeader title={c.changeNumber} subtitle={`${c.title} · ${c.siteCode ?? "Organization-wide"}`} actions={<LinkButton href="/quality/changes" variant="secondary">Change control</LinkButton>} />
      <div className="flex flex-col gap-5">
        {sp.created && <Banner tone="ok" title={`Change ${c.changeNumber} drafted`}>Add the impact assessment and the risk level, then submit it for approval.</Banner>}
        <Card>
          <CardTitle action={<ChangeStatusChip status={c.status} />}>Proposal</CardTitle>
          <p className="mb-2 whitespace-pre-wrap text-[14px]">{c.description}</p>
          <p className="mb-4 whitespace-pre-wrap text-[13px] text-fg-2">Why: {c.justification}</p>
          <Dl
            items={[
              ["What changes", c.entityTypeLabel],
              [
                "Implementing revision",
                v.entity ? (
                  <span key="e" className="inline-flex flex-wrap items-center gap-2">
                    <Link className="text-primary-text hover:underline" href={v.entity.href}>
                      {v.entity.label}
                    </Link>
                    <StatusChip status={v.entity.status} />
                  </span>
                ) : c.entityType === "other" ? (
                  "No versioned record"
                ) : (
                  "Not linked yet"
                ),
              ],
              ["CAPA", v.capa ? <Link key="c" className="text-primary-text hover:underline" href={`/quality/capa/${v.capa.id}`}>{v.capa.number}</Link> : "—"],
              ["Risk level", c.riskLevel ?? "Not assessed"],
              ["Target date", c.targetDate ? fmtDate(c.targetDate) : "—"],
              ["Proposed", `${fmtDateTime(c.createdAt)} · ${c.createdByName}`],
              ["Submitted", c.submittedAt ? `${fmtDateTime(c.submittedAt)} · ${c.submittedByName}` : "—"],
              ["Implemented", c.implementedAt ? `${fmtDateTime(c.implementedAt)} · ${c.implementedByName}` : "—"],
              ["Closed", c.closedAt ? `${fmtDateTime(c.closedAt)} · ${c.closedByName}` : c.status === "cancelled" ? `Cancelled: ${c.cancelReason}` : "—"],
            ]}
          />
        </Card>

        <Card>
          <CardTitle>Impact assessment and plan</CardTitle>
          <Dl
            items={[
              ["Impact assessment", c.impactAssessment ?? "—"],
              ["Implementation plan", c.implementationPlan ?? "—"],
              ["Implementation note", c.implementationNote ?? "—"],
            ]}
          />
          {v.can.edit && (
            <details className="mt-4 border-t border-line pt-4" open={!c.impactAssessment}>
              <summary className="cursor-pointer text-[13px] text-primary-text">Edit the assessment</summary>
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
          <CardTitle>Approval</CardTitle>
          <ol className="flex flex-col gap-2 text-[14px]">
            {v.approval.steps.map((s) => (
              <li key={s.step} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  Step {s.step}: {s.label}
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
                  Cycle {h.cycle}, step {h.step}: {h.decision} by {h.name} on {fmtDateTime(h.at)}
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
          {c.status === "submitted" && !v.can.decide && <p className="mt-3 text-[13px] text-muted">The proposer and the submitter cannot approve their own change; an approver of the next step decides.</p>}
        </Card>

        {(c.status === "approved" || c.status === "implemented") && (
          <Card>
            <CardTitle>Implementation</CardTitle>
            {v.can.implement && (v.can.implementBlockedReason ? <p className="text-[13px] text-muted">{v.can.implementBlockedReason}</p> : <ImplementChangeForm changeControlId={c.id} />)}
            {v.can.close && <CloseChangeForm changeControlId={c.id} />}
            {c.status === "implemented" && !v.can.close && <p className="text-[13px] text-muted">A person other than the implementer, holding quality.change_control.approve, confirms and closes.</p>}
          </Card>
        )}

        {v.can.cancel && (
          <Card>
            <details>
              <summary className="cursor-pointer text-[13px] text-primary-text">Cancel this change</summary>
              <div className="mt-3">
                <CancelChangeForm changeControlId={c.id} />
              </div>
            </details>
          </Card>
        )}

        <Card>
          <CardTitle>History</CardTitle>
          <ol className="flex flex-col gap-1 text-[13px]">
            {v.timeline.map((t, i) => (
              <li key={i}>
                {fmtDateTime(t.at)} · {t.by}: {t.from ? `${t.from} → ` : ""}
                {t.to}
                {t.reason ? ` — ${t.reason}` : ""}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}

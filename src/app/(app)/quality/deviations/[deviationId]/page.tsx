import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getDeviation, listCapas } from "@/modules/quality";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { WhoCanHelp } from "@/ui/who-can-help";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { DeviationStatusChip, QaStatusChip, Timeline } from "../../_ui";
import { CapaStatusChip } from "../../capa/_ui";
import { CloseDeviationForm, ContainForm, InvestigateForm, UpdateInvestigationForm } from "../../w2c-forms";

export const dynamic = "force-dynamic";

export default async function DeviationPage({ params, searchParams }: { params: Promise<{ deviationId: string }>; searchParams: Promise<{ opened?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.deviation.view")) return <Forbidden what="deviations" />;
  const { deviationId } = await params;
  const sp = await searchParams;
  let v: Awaited<ReturnType<typeof getDeviation>>;
  try {
    v = await getDeviation(ctx, deviationId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Problem report not found" action={<LinkButton href="/quality/deviations" variant="secondary">Problem reports</LinkButton>}>
          This problem report does not exist or is not at one of your sites. Ask QA if you think it should be here.
        </EmptyState>
      );
    }
    throw e;
  }
  const d = v.deviation;
  // Wave 4 W4C: the CAPA tab shows the CAPAs opened from this deviation (US-6-18).
  const capaRows = ctx.can("quality.capa.view") ? await listCapas(ctx, { deviationId: d.id, status: "all" }) : null;
  return (
    <>
      <PageHeader
        title="Problem report"
        subtitle={
          <>
            {v.batch ? `Batch ${v.batch.number}` : v.lot ? `Lot ${v.lot.number}` : d.sourceLabel} · <RecordNo>{d.deviationNumber}</RecordNo>
          </>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-2">
              {capaRows && ctx.can("quality.capa.create") && (
                <LinkButton href={`/quality/capa/new?deviationId=${d.id}`} variant="secondary">
                  Start a fix-and-prevent plan
                </LinkButton>
              )}
              <LinkButton href="/quality/deviations" variant="secondary">
                All problem reports
              </LinkButton>
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for QA: find out why this happened, stop affected stock if needed, and close the report.</PageIntro>
      {d.status === "open" ? (
        v.can.investigate ? (
          <NextStep text="Next: say how serious it is and what QA will check." action={{ label: "Start looking into it", href: "#investigate" }} />
        ) : (
          <>
            <NextStep text="QA has been told about this problem." waitingFor="Waiting for QA to look into it." />
            <div className="-mt-2 mb-4">
              <WhoCanHelp permission="quality.deviation.approve" siteId={d.siteId} hideEmails lead="QA people: " />
            </div>
          </>
        )
      ) : d.status === "investigating" ? (
        v.can.close ? (
          <NextStep text="Next: write what caused it and what was done, then close it." action={{ label: "Close the report", href: "#close" }} />
        ) : (
          <NextStep text="QA is looking into it." waitingFor={v.can.closeBlockedReason ?? "Waiting for QA to close it."} />
        )
      ) : null}

      <div className="flex flex-col gap-5">
        {sp.opened && <Banner tone="ok" title="Problem report sent">QA has been told. While it is open, its batch and lot cannot be made OK to use.</Banner>}
        <Card>
          <CardTitle action={<DeviationStatusChip status={d.status} />}>What happened</CardTitle>
          <p className="mb-4 whitespace-pre-wrap text-[14px]">{d.description}</p>
          <Dl
            items={[
              ["Batch", v.batch ? <Link key="b" className="text-primary-text hover:underline" href={`/quality/batches/${v.batch.id}`}>{v.batch.number}</Link> : "—"],
              ["Lot", v.lot ? <span key="l" className="inline-flex flex-wrap items-center gap-2"><Link className="text-primary-text hover:underline" href={`/quality/lots/${v.lot.id}`}>{v.lot.number}</Link><QaStatusChip status={v.lot.status} /></span> : "—"],
              ["Step", d.stepRef ?? "—"],
              ["Quality check", v.inspection ? <Link key="i" className="text-primary-text hover:underline" href={`/quality/inspections/${v.inspection.id}`}>{v.inspection.number}</Link> : "—"],
              ["Test not OK", v.result ? `${v.result.testName}: ${v.result.result} (should be ${v.result.specification})` : "—"],
              ["Reported", `${d.raisedByName}, ${fmtDateTime(d.raisedAt)}`],
              ["How serious", d.severity ? `${d.severity}${d.classifiedByName ? ` · ${d.classifiedByName}` : ""}` : "Not rated yet"],
              ["Closed", d.closedAt ? `${d.closedByName}, ${fmtDateTime(d.closedAt)}` : "—"],
              ["May the product be made OK?", d.releasePermitted === null ? "—" : d.releasePermitted ? "Yes" : "No"],
              ["Check again on", d.effectivenessCheckOn ? fmtDate(d.effectivenessCheckOn) : "—"],
            ]}
          />
        </Card>

        <Card>
          <span id="investigate" className="block scroll-mt-24" />
          <CardTitle>What QA found</CardTitle>
          <Dl
            items={[
              ["What QA checks", d.investigation ?? "—"],
              ["Other batches or lots affected", d.impactAssessment ?? "—"],
              ["What caused it", d.rootCause ?? "—"],
              ["What was done", d.resolution ?? "—"],
            ]}
          />
          {v.can.investigate && (
            <div className="mt-4 border-t border-line pt-4">
              <InvestigateForm deviationId={d.id} levels={v.severityLevels} />
            </div>
          )}
          {!v.can.investigate && v.can.update && (
            <details className="mt-4 border-t border-line pt-4">
              <summary className="min-h-[44px] cursor-pointer py-2 text-[14px] text-primary-text">Add to what QA found</summary>
              <div className="mt-3">
                <UpdateInvestigationForm deviationId={d.id} current={{ investigation: d.investigation, impactAssessment: d.impactAssessment, rootCause: d.rootCause }} />
              </div>
            </details>
          )}
        </Card>

        <Card>
          <CardTitle>Stock stopped by QA because of this</CardTitle>
          {v.holds.length === 0 ? (
            <p className="text-[13px] text-muted">No stock was stopped for this report.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[14px]">
              {v.holds.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2">
                  <Link className="font-medium text-primary-text hover:underline" href={`/quality/holds/${h.id}`}>
                    {h.number}
                  </Link>
                  <Chip tone={h.status === "closed" ? "neu" : "hold"}>{h.status === "closed" ? "No longer stopped" : "Stopped by QA"}</Chip>
                  {h.resolution && <span className="text-[12px] text-muted">{h.resolution === "released" ? "made OK again" : "not OK"}</span>}
                </li>
              ))}
            </ul>
          )}
          {v.can.contain && (
            <details className="mt-4 border-t border-line pt-4">
              <summary className="min-h-[44px] cursor-pointer py-2 text-[14px] text-primary-text">Stop a lot while QA looks into it</summary>
              <div className="mt-3">
                <ContainForm deviationId={d.id} defaultLot={v.lot?.number ?? null} reasonCodes={v.holdReasonCodes} />
              </div>
            </details>
          )}
        </Card>

        <Card>
          <CardTitle>Fix-and-prevent plans</CardTitle>
          {!capaRows ? (
            <p className="text-[13px] text-muted">Only QA and managers see the fix-and-prevent plans.</p>
          ) : capaRows.length === 0 ? (
            <p className="text-[13px] text-muted">No fix-and-prevent plan for this report{ctx.can("quality.capa.create") ? ". Start one (⋯ More) when something must be fixed so it does not happen again." : "."}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[14px]">
              {capaRows.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2">
                  <Link className="font-medium text-primary-text hover:underline" href={`/quality/capa/${c.id}`}>
                    {c.title} <span className="font-mono text-[12px] font-normal text-muted">{c.number}</span>
                  </Link>
                  <CapaStatusChip status={c.status} />
                  {c.overdue && <Chip tone="bad">Overdue</Chip>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {d.status !== "closed" && (
          <Card>
            <span id="close" className="block scroll-mt-24" />
            <CardTitle>Close the report</CardTitle>
            {v.can.close ? (
              <CloseDeviationForm deviationId={d.id} rootCause={d.rootCause} />
            ) : (
              <p className="text-[13px] text-muted">{v.can.closeBlockedReason ?? "Only QA can close a problem report."}</p>
            )}
          </Card>
        )}

        <Card>
          <CardTitle>What happened (history)</CardTitle>
          <Timeline rows={v.timeline} word={(s) => ({ open: "new", investigating: "QA looking into it", closed: "closed" })[s] ?? s} />
        </Card>
      </div>
    </>
  );
}

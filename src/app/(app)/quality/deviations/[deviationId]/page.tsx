import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { getDeviation, listCapas } from "@/modules/quality";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { DeviationStatusChip } from "../../_ui";
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
        <EmptyState title="Deviation not found" action={<LinkButton href="/quality/deviations" variant="secondary">Deviations</LinkButton>}>
          This deviation does not exist or is not at one of your sites.
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
      <PageHeader title={d.deviationNumber} subtitle={d.sourceLabel} actions={<LinkButton href="/quality/deviations" variant="secondary">Deviations</LinkButton>} />
      <div className="flex flex-col gap-5">
        {sp.opened && <Banner tone="ok" title={`Deviation ${d.deviationNumber} raised`}>QA has been notified. While it is open, the batch and lot it names cannot be released.</Banner>}
        <Card>
          <CardTitle action={<DeviationStatusChip status={d.status} />}>Deviation</CardTitle>
          <p className="mb-4 whitespace-pre-wrap text-[14px]">{d.description}</p>
          <Dl
            items={[
              ["Batch", v.batch ? <Link key="b" className="text-primary-text hover:underline" href={`/quality/batches/${v.batch.id}`}>{v.batch.number}</Link> : "—"],
              ["Lot", v.lot ? <span key="l" className="inline-flex flex-wrap items-center gap-2"><Link className="text-primary-text hover:underline" href={`/quality/lots/${v.lot.id}`}>{v.lot.number}</Link><StatusChip status={v.lot.status} /></span> : "—"],
              ["Step", d.stepRef ?? "—"],
              ["Inspection", v.inspection ? <Link key="i" className="text-primary-text hover:underline" href={`/quality/inspections/${v.inspection.id}`}>{v.inspection.number}</Link> : "—"],
              ["Result (OOS)", v.result ? `${v.result.testName}: ${v.result.result} (spec ${v.result.specification})` : "—"],
              ["Raised", `${fmtDateTime(d.raisedAt)} · ${d.raisedByName}`],
              ["Severity", d.severity ? `${d.severity}${d.classifiedByName ? ` · ${d.classifiedByName}` : ""}` : "Not classified"],
              ["Closed", d.closedAt ? `${fmtDateTime(d.closedAt)} · ${d.closedByName}` : "—"],
              ["Release permitted", d.releasePermitted === null ? "—" : d.releasePermitted ? "Yes" : "No"],
              ["Effectiveness check", d.effectivenessCheckOn ? fmtDate(d.effectivenessCheckOn) : "—"],
            ]}
          />
        </Card>

        <Card>
          <CardTitle>Investigation</CardTitle>
          <Dl
            items={[
              ["Investigation", d.investigation ?? "—"],
              ["Impact assessment", d.impactAssessment ?? "—"],
              ["Root cause", d.rootCause ?? "—"],
              ["Resolution", d.resolution ?? "—"],
            ]}
          />
          {v.can.investigate && (
            <div className="mt-4 border-t border-line pt-4">
              <InvestigateForm deviationId={d.id} levels={v.severityLevels} />
            </div>
          )}
          {!v.can.investigate && v.can.update && (
            <details className="mt-4 border-t border-line pt-4">
              <summary className="cursor-pointer text-[13px] text-primary-text">Update the investigation record</summary>
              <div className="mt-3">
                <UpdateInvestigationForm deviationId={d.id} current={{ investigation: d.investigation, impactAssessment: d.impactAssessment, rootCause: d.rootCause }} />
              </div>
            </details>
          )}
        </Card>

        <Card>
          <CardTitle>Containment holds</CardTitle>
          {v.holds.length === 0 ? (
            <p className="text-[13px] text-muted">No stock is held for this deviation.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[14px]">
              {v.holds.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2">
                  <Link className="font-medium text-primary-text hover:underline" href={`/quality/holds/${h.id}`}>
                    {h.number}
                  </Link>
                  <Chip tone={h.status === "closed" ? "neu" : "hold"}>{h.status}</Chip>
                  {h.resolution && <span className="text-[12px] text-muted">resolution {h.resolution}</span>}
                </li>
              ))}
            </ul>
          )}
          {v.can.contain && (
            <details className="mt-4 border-t border-line pt-4">
              <summary className="cursor-pointer text-[13px] text-primary-text">Place a containment hold</summary>
              <div className="mt-3">
                <ContainForm deviationId={d.id} defaultLot={v.lot?.number ?? null} reasonCodes={v.holdReasonCodes} />
              </div>
            </details>
          )}
        </Card>

        <Card>
          <CardTitle action={capaRows && ctx.can("quality.capa.create") ? <LinkButton href={`/quality/capa/new?deviationId=${d.id}`} variant="secondary" size="sm">Open CAPA</LinkButton> : undefined}>CAPA</CardTitle>
          {!capaRows ? (
            <p className="text-[13px] text-muted">Corrective and preventive actions are visible to holders of quality.capa.view.</p>
          ) : capaRows.length === 0 ? (
            <p className="text-[13px] text-muted">No CAPA for this deviation{ctx.can("quality.capa.create") ? "; open one when corrective or preventive action is needed (W07-04)." : "."}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[14px]">
              {capaRows.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2">
                  <Link className="font-medium text-primary-text hover:underline" href={`/quality/capa/${c.id}`}>
                    {c.number}
                  </Link>
                  <CapaStatusChip status={c.status} />
                  <span className="text-[13px] text-fg-2">{c.title}</span>
                  {c.overdue && <Chip tone="bad">Overdue</Chip>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {d.status !== "closed" && (
          <Card>
            <CardTitle>Close</CardTitle>
            {v.can.close ? (
              <CloseDeviationForm deviationId={d.id} rootCause={d.rootCause} />
            ) : (
              <p className="text-[13px] text-muted">{v.can.closeBlockedReason ?? "Closing needs quality.deviation.approve, held by QA."}</p>
            )}
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

import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getInspection } from "@/modules/quality";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, Table, Td, cx } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { InspectionStatusChip, fmtLotQty } from "../../_ui";
import { CancelInspectionForm, CorrectForm, ResultForm, ReviewForm, SampleForm, SubmitInspectionForm } from "../../w2c-forms";

export const dynamic = "force-dynamic";

export default async function InspectionPage({ params }: { params: Promise<{ inspectionId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.inspection.view")) return <Forbidden what="inspections" />;
  const { inspectionId } = await params;
  let v: Awaited<ReturnType<typeof getInspection>>;
  try {
    v = await getInspection(ctx, inspectionId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Inspection not found" action={<LinkButton href="/quality/inspections" variant="secondary">Inspections</LinkButton>}>
          This inspection does not exist or is not at one of your sites.
        </EmptyState>
      );
    }
    throw e;
  }
  const ins = v.inspection;
  const canSeeResults = ctx.can("quality.test_result.view");
  const subjectHref = v.batch ? `/quality/batches/${v.batch.id}` : v.lot ? `/quality/lots/${v.lot.id}` : "/quality";

  return (
    <>
      <PageHeader
        title={ins.inspectionNumber}
        subtitle={`${ins.inspectionKind.replace(/_/g, " ")} inspection · ${v.batch ? `batch ${v.batch.batchNumber}` : `lot ${v.lot?.lotNumber ?? ""}`}`}
        actions={
          <>
            <LinkButton href="/quality/inspections" variant="secondary">
              Inspections
            </LinkButton>
            <LinkButton href={subjectHref} variant="secondary">
              {v.batch ? "Batch release" : "Lot decision"}
            </LinkButton>
          </>
        }
      />
      <div className="flex flex-col gap-5">
        {v.plan.isPlaceholder && (
          <Banner tone="warn" title="Placeholder specification">
            Plan {v.plan.code} rev {v.plan.revisionNo} is fictional demo content. The company&apos;s QA must replace it with its validated specification before production use.
          </Banner>
        )}
        <Card>
          <CardTitle action={<InspectionStatusChip status={ins.status} outcome={ins.outcome} />}>Summary</CardTitle>
          <Dl
            items={[
              ["Plan", `${v.plan.code} rev ${v.plan.revisionNo}`],
              ["Subject", v.batch ? v.batch.batchNumber : (v.lot?.lotNumber ?? "—")],
              ["Lot", v.lot ? <span key="l" className="inline-flex flex-wrap items-center gap-2">{v.lot.lotNumber} <StatusChip status={v.lot.qualityStatus} /></span> : "—"],
              ["Due", fmtDateTime(ins.dueAt)],
              ["Sampled", ins.sampledAt ? `${fmtDateTime(ins.sampledAt)} · ${ins.samplerName ?? ""}` : "—"],
              ["Sample total", ins.sampleQtyBase ? fmtLotQty(ins.sampleQtyBase, ins.sampleUom) : "—"],
              ["Reviewed", ins.reviewedAt ? `${fmtDateTime(ins.reviewedAt)} · ${ins.reviewerName ?? ""}` : "—"],
              ["Review note", ins.reviewNote ?? "—"],
            ]}
          />
          {v.plan.samplingInstructions && <p className="mt-3 text-[13px] text-fg-2">Sampling: {v.plan.samplingInstructions}</p>}
        </Card>

        <Card>
          <CardTitle>Samples</CardTitle>
          {v.samples.length === 0 ? (
            <EmptyState title="No samples yet">Record each physical sample: the quantity leaves stock as a sample consumption.</EmptyState>
          ) : (
            <Table head={["#", "Quantity", "From", "Box", "Sampled by", "When"]}>
              {v.samples.map((s) => (
                <tr key={s.id}>
                  <Td>{s.sampleNo}</Td>
                  <Td>{fmtLotQty(s.qtyBase, s.baseUom)}</Td>
                  <Td>{s.locationCode}</Td>
                  <Td>{s.containerNumber ?? "—"}</Td>
                  <Td>{s.samplerName}</Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(s.sampledAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
          {v.can.sample && v.lot && (
            <div className="mt-4 border-t border-line pt-4">
              {v.stock.length === 0 ? (
                <p className="text-[13px] text-muted">Lot {v.lot.lotNumber} has no stock left to sample.</p>
              ) : (
                <SampleForm inspectionId={ins.id} uom={v.lot.baseUom} locations={v.stock.map((s) => ({ id: s.locationId, code: s.locationCode, qty: String(Number(s.qty)) }))} />
              )}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle action={v.missing.length ? <Chip tone="warn">{v.missing.length} required missing</Chip> : <Chip tone="ok">All required entered</Chip>}>Tests and results</CardTitle>
          {!canSeeResults ? (
            <p className="text-[13px] text-muted">Raw results are visible to QA only (quality.test_result.view). Status: {ins.statusLabel}.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {v.tests.map((t) => {
                const results = v.results.filter((r) => r.inspectionPlanTestId === t.id);
                return (
                  <li key={t.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {t.sequence}. {t.name}
                      </p>
                      {t.isRequired ? <Chip tone="neu">Required</Chip> : <Chip tone="neu">Optional</Chip>}
                      {t.hasLive ? null : t.isRequired ? <Chip tone="warn">No result</Chip> : null}
                    </div>
                    <p className="text-[13px] text-muted">
                      Specification: {t.spec}
                      {t.method ? ` · method ${t.method}` : ""}
                    </p>
                    {results.length > 0 && (
                      <ul className="mt-2 flex flex-col gap-1">
                        {results.map((r) => (
                          <li key={r.id} className={cx("rounded-[10px] border px-3 py-2 text-[13px]", !r.live ? "border-line bg-surface-2 text-muted" : r.passed ? "border-[var(--ok-bd)]" : "border-[var(--bad-bd)] bg-[var(--bad-bg)]")}>
                            <span className={cx("font-medium", !r.live && "line-through")}>{r.result}</span> {r.live ? r.passed ? <Chip tone="ok">Pass</Chip> : <Chip tone="bad">Fail</Chip> : <Chip tone="neu">Superseded</Chip>}
                            <span className="ml-2 text-muted">
                              {r.testerName} · {fmtDateTime(r.testedAt)}
                            </span>
                            {r.correctionReason && <div className="text-[12px]">Correction: {r.correctionReason}</div>}
                            {r.live && !r.passed && (
                              <div className="mt-1 text-[12px]">
                                {r.oosDeviation ? (
                                  <Link className="text-primary-text hover:underline" href={`/quality/deviations/${r.oosDeviation.id}`}>
                                    OOS deviation {r.oosDeviation.number} ({r.oosDeviation.status})
                                  </Link>
                                ) : v.can.raiseDeviation ? (
                                  <Link className="text-primary-text hover:underline" href={`/quality/deviations/new?${v.batch ? `batchId=${v.batch.id}` : `lotId=${v.lot?.id}`}&testResultId=${r.id}&inspectionId=${ins.id}`}>
                                    Raise OOS deviation for this result
                                  </Link>
                                ) : null}
                              </div>
                            )}
                            {r.live && v.can.correct && <CorrectForm inspectionId={ins.id} resultId={r.id} test={t} />}
                          </li>
                        ))}
                      </ul>
                    )}
                    {v.can.record && (
                      <details className="mt-2" open={!t.hasLive && t.isRequired}>
                        <summary className="cursor-pointer text-[13px] text-primary-text">{t.hasLive ? "Add a retest result" : "Enter result"}</summary>
                        <div className="mt-2">
                          <ResultForm inspectionId={ins.id} test={t} />
                        </div>
                      </details>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          <p className="mt-3 text-[12px] text-muted">Results are append-only. Corrections add a new entry with a reason; specifications come from the QA-approved plan and are not defined by the system.</p>
        </Card>

        {(v.can.submit || v.can.review || v.can.reviewBlockedReason || v.can.cancel) && (
          <Card>
            <CardTitle>Review</CardTitle>
            <div className="flex flex-col gap-4">
              {v.can.submit && <SubmitInspectionForm inspectionId={ins.id} />}
              {v.can.reviewBlockedReason && <Banner tone="info" title="Another QA user must review">{v.can.reviewBlockedReason}</Banner>}
              {v.can.review && <ReviewForm inspectionId={ins.id} />}
              {v.can.cancel && <CancelInspectionForm inspectionId={ins.id} />}
            </div>
            <p className="mt-3 text-[12px] text-muted">This is an electronic record of a QA review, not a validated electronic signature; keep signed paper records as your QA procedures require.</p>
          </Card>
        )}

        <Card>
          <CardTitle>History</CardTitle>
          <ol className="flex flex-col gap-1 text-[13px]">
            {v.timeline.map((t, i) => (
              <li key={i}>
                {fmtDateTime(t.at)} · {t.by}: {t.from ? `${t.from.replace(/_/g, " ")} → ` : ""}
                {t.to.replace(/_/g, " ")}
                {t.reason ? ` — ${t.reason}` : ""}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}

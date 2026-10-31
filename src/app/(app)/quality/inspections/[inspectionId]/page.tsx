import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getInspection } from "@/modules/quality";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, cx } from "@/ui/core";
import { Explain, MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { WhoCanHelp } from "@/ui/who-can-help";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { InspectionStatusChip, QaStatusChip, Timeline, fmtLotQty, inspectionWord } from "../../_ui";
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
        title={`Quality check: ${v.lot?.itemName ?? v.plan.name}`}
        subtitle={
          <>
            {v.batch ? `Batch ${v.batch.batchNumber}` : `Delivery ${v.lot?.lotNumber ?? ""}`} · <RecordNo>{ins.inspectionNumber}</RecordNo>
          </>
        }
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-2">
              <LinkButton href={subjectHref} variant="secondary">
                {v.batch ? "QA decision for this batch" : "QA decision for this lot"}
              </LinkButton>
              <LinkButton href="/quality/inspections" variant="secondary">
                All quality checks
              </LinkButton>
              {v.can.cancel && (
                <div className="border-t border-line pt-3">
                  <CancelInspectionForm inspectionId={ins.id} />
                </div>
              )}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>
        This screen is for QA: take a sample, type each test result, then a second QA person checks the results.
      </PageIntro>
      <div className="-mt-3 mb-4"><Explain term="quality_check" /></div>
      {ins.status === "approved" ? (
        <NextStep text={`Done: the tests were checked (${ins.outcome === "fail" ? "not OK" : "OK"}). Next: the QA decision.`} action={{ label: v.batch ? "Go to the batch decision" : "Go to the lot decision", href: subjectHref }} />
      ) : ins.status === "awaiting_review" ? (
        v.can.review ? (
          <NextStep text="Next: look at the results and accept them, or send them back." action={{ label: "Check the results", href: "#review" }} />
        ) : (
          <>
            <NextStep text="The results are typed." waitingFor="Waiting for a second QA person to check them (not the person who typed them)." />
            <div className="-mt-2 mb-4">
              <WhoCanHelp permission="quality.inspection.approve" siteId={ins.siteId} hideEmails lead="QA people who can check: " />
            </div>
          </>
        )
      ) : ["pending", "in_progress"].includes(ins.status) ? (
        <NextStep
          text={v.can.submit && v.missing.length === 0 ? "Next: all tests are typed. Send them for checking." : v.samples.length === 0 && v.lot && v.can.sample ? "Next: take a sample and write down how much." : `Next: type the test results (${v.missing.length} still missing).`}
          action={v.can.submit && v.missing.length === 0 ? { label: "Send for checking", href: "#review" } : undefined}
        />
      ) : null}

      <div className="flex flex-col gap-5">
        {v.plan.isPlaceholder && (
          <Banner tone="warn" title="Demo test list">
            The test list {v.plan.code} v{v.plan.revisionNo} is made-up demo content. The company&apos;s QA must replace it with its approved one before real use.
          </Banner>
        )}
        <Card>
          <CardTitle action={<InspectionStatusChip status={ins.status} outcome={ins.outcome} />}>About this check</CardTitle>
          <Dl
            items={[
              ["Lot", v.lot ? <span key="l" className="inline-flex flex-wrap items-center gap-2"><span className="font-mono text-[13px]">{v.lot.lotNumber}</span> <QaStatusChip status={v.lot.qualityStatus} /></span> : "—"],
              ["Due", fmtDateTime(ins.dueAt)],
              ["Sample taken", ins.sampledAt ? `${fmtDateTime(ins.sampledAt)} · ${ins.samplerName ?? ""}${ins.sampleQtyBase ? ` · ${fmtLotQty(ins.sampleQtyBase, ins.sampleUom)} in total` : ""}` : "—"],
              ["Checked by", ins.reviewedAt ? `${ins.reviewerName ?? ""}, ${fmtDateTime(ins.reviewedAt)}${ins.reviewNote ? ` — “${ins.reviewNote}”` : ""}` : "—"],
              ["Test list", `${v.plan.name} v${v.plan.revisionNo}`],
            ]}
          />
          {v.plan.samplingInstructions && <p className="mt-3 text-[13px] text-fg-2">How to take the sample: {v.plan.samplingInstructions}</p>}
        </Card>

        <Card>
          <CardTitle>Samples taken</CardTitle>
          {v.samples.length === 0 ? (
            <EmptyState title="No sample yet">Write down each sample you take; that amount is taken out of stock.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line text-[14px]">
              {v.samples.map((s) => (
                <li key={s.id} className="py-2">
                  <span className="font-medium">Sample {s.sampleNo}: {fmtLotQty(s.qtyBase, s.baseUom)}</span>
                  <span className="text-[13px] text-fg-2">
                    {" "}
                    · from {s.locationCode}
                    {s.containerNumber ? `, box ${s.containerNumber}` : ""} · {s.samplerName}, {fmtDateTime(s.sampledAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {v.can.sample && v.lot && (
            <div className="mt-4 border-t border-line pt-4">
              {v.stock.length === 0 ? (
                <p className="text-[13px] text-muted">Nothing of this lot is left to take a sample from.</p>
              ) : (
                <SampleForm inspectionId={ins.id} uom={v.lot.baseUom} locations={v.stock.map((s) => ({ id: s.locationId, code: s.locationCode, qty: String(Number(s.qty)) }))} />
              )}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle action={v.missing.length ? <Chip tone="warn">{v.missing.length} still missing</Chip> : <Chip tone="ok">All typed</Chip>}>Tests and results</CardTitle>
          {!canSeeResults ? (
            <p className="text-[13px] text-muted">Only QA sees the test results. Status: {inspectionWord(ins.status)}.</p>
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
                      {t.isRequired ? null : <Chip tone="neu">Optional</Chip>}
                      {t.hasLive ? null : t.isRequired ? <Chip tone="warn">No result yet</Chip> : null}
                    </div>
                    <p className="text-[13px] text-muted">
                      OK when: {t.spec}
                      {t.method ? ` · how: ${t.method}` : ""}
                    </p>
                    {results.length > 0 && (
                      <ul className="mt-2 flex flex-col gap-1">
                        {results.map((r) => (
                          <li key={r.id} className={cx("rounded-[10px] border px-3 py-2 text-[13px]", !r.live ? "border-line bg-surface-2 text-muted" : r.passed ? "border-[var(--ok-bd)]" : "border-[var(--bad-bd)] bg-[var(--bad-bg)]")}>
                            <span className={cx("font-medium", !r.live && "line-through")}>{r.result}</span> {r.live ? r.passed ? <Chip tone="ok">OK</Chip> : <Chip tone="bad">Not OK</Chip> : <Chip tone="neu">Replaced</Chip>}
                            <span className="ml-2 text-muted">
                              {r.testerName} · {fmtDateTime(r.testedAt)}
                            </span>
                            {r.correctionReason && <div className="text-[12px]">Correction: {r.correctionReason}</div>}
                            {r.live && !r.passed && (
                              <div className="mt-1 text-[12px]">
                                {r.oosDeviation ? (
                                  <Link className="text-primary-text hover:underline" href={`/quality/deviations/${r.oosDeviation.id}`}>
                                    Problem report {r.oosDeviation.number} ({r.oosDeviation.status === "closed" ? "closed" : "open"})
                                  </Link>
                                ) : v.can.raiseDeviation ? (
                                  <Link className="text-primary-text hover:underline" href={`/quality/deviations/new?${v.batch ? `batchId=${v.batch.id}` : `lotId=${v.lot?.id}`}&testResultId=${r.id}&inspectionId=${ins.id}`}>
                                    Report a problem about this not-OK result
                                  </Link>
                                ) : null}
                              </div>
                            )}
                            {r.live && v.can.correct && <CorrectForm inspectionId={ins.id} resultId={r.id} test={{ ...t }} />}
                          </li>
                        ))}
                      </ul>
                    )}
                    {v.can.record && (
                      <details className="mt-2" open={!t.hasLive && t.isRequired}>
                        <summary className="min-h-[44px] cursor-pointer py-2 text-[14px] text-primary-text">{t.hasLive ? "Add a result from a new test" : "Type the result"}</summary>
                        <div className="mt-2">
                          <ResultForm inspectionId={ins.id} test={{ ...t }} />
                        </div>
                      </details>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          <p className="mt-3 text-[12px] text-muted">Results are never changed: a correction adds a new line with a reason. What “OK” means comes from the QA-approved test list, not from the system.</p>
        </Card>

        {(v.can.submit || v.can.review || v.can.reviewBlockedReason) && (
          <Card>
            <span id="review" className="block scroll-mt-24" />
            <CardTitle>Check by a second QA person</CardTitle>
            <div className="flex flex-col gap-4">
              {v.can.submit && <SubmitInspectionForm inspectionId={ins.id} />}
              {v.can.reviewBlockedReason && <Banner tone="info" title="Another QA person must check this">You typed results here, so someone else checks them.</Banner>}
              {v.can.review && <ReviewForm inspectionId={ins.id} />}
            </div>
            <p className="mt-3 text-[12px] text-muted">This is an electronic record of a QA check, not a validated electronic signature; keep signed paper records as your QA procedures require.</p>
          </Card>
        )}

        <Card>
          <CardTitle>What happened</CardTitle>
          <Timeline rows={v.timeline} word={inspectionWord} />
        </Card>
      </div>
    </>
  );
}

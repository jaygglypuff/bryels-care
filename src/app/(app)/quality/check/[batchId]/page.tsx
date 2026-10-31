import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { pieceWord } from "@/modules/production";
import { getQualityCheck, QUALITY_CHECK_LABEL, type QualityCheckView } from "@/modules/quality";
import { Card, CardTitle, LinkButton, PageHeader } from "@/ui/core";
import { Explain, MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Help } from "@/ui/help/help";
import { Banner, Chip } from "@/ui/status";
import { WhoCanHelp } from "@/ui/who-can-help";
import { Forbidden } from "../../../forbidden";
import { StartInspectionButton } from "../../w2c-forms";
import { qaWord } from "../../_ui";
import { FailForm, NotYetForm, PassForm, TestsForm } from "../forms";
import { TestResultForm } from "../../batches/[batchId]/test-form";

export const metadata: Metadata = { title: "Check quality" };
export const dynamic = "force-dynamic";

const manilaToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

/**
 * Check quality (ADR-080 §8–9, slice V2-7): one page per finished batch. Summary, the "Exceptions in
 * this batch" box, the tests (one form, one Save), then Pass / Not yet / Fail. Reached from the production order and from
 * the QA list "Waiting for check". The service re-checks every rule; the page only explains them.
 */
export default async function CheckQualityPage({ params }: { params: Promise<{ batchId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.disposition.view")) return <Forbidden what="the quality check" />;
  const { batchId } = await params;
  let v: QualityCheckView;
  try {
    v = await getQualityCheck(ctx, batchId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const word = pieceWord(v.product.family, 2);
  const good = v.counts.good ? Number(v.counts.good) : null;
  const sellable = good !== null ? good - Number(v.counts.samples) : null;
  const decided = !v.decidable;
  const rejectTotal = v.counts.rejects.reduce((t, r) => t + Number(r.qty), 0);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title={`Check quality: ${v.product.name}`}
        subtitle={
          <>
            Batch <RecordNo>{v.batch.number}</RecordNo>
            {v.order ? <span className="text-muted"> · order {v.order.number}</span> : null}
          </>
        }
        actions={
          <>
            <Help screen="quality.check" />
            <MoreMenu>
              <div className="flex flex-col gap-2">
                <LinkButton href={`/print/bmr/${v.batch.id}`} variant="secondary" target="_blank">
                  Batch record (print)
                </LinkButton>
                {v.order && (
                  <LinkButton href={`/production/orders/${v.order.id}`} variant="secondary">
                    Production order
                  </LinkButton>
                )}
                <LinkButton href={`/quality/batches/${v.batch.id}`} variant="secondary">
                  Full QA review page
                </LinkButton>
              </div>
            </MoreMenu>
          </>
        }
      />
      <PageIntro>
        This screen is for the QA person: look at how this batch went and its tests, then say OK to use, not yet, or not OK.
      </PageIntro>
      <div className="-mt-3 mb-4"><Explain term="batch_record" label="What is a batch record?" /></div>
      {!decided &&
        (!v.can.decide ? (
          <NextStep text="Next: a QA person checks this batch and says OK or not OK." waitingFor="Waiting for QA (see who below, under Decision)." />
        ) : v.planDriven && !v.inspection ? (
          <NextStep text="Next: start the tests for this batch (box Tests below)." />
        ) : v.inspection && v.inspection.tests.some((t) => !t.result) ? (
          <NextStep text={`Next: type the test results (${v.inspection.tests.filter((t) => !t.result).length} left), then decide OK or not OK.`} />
        ) : (
          <NextStep text="Next: decide OK to use or not OK (box Decision)." />
        ))}

      {decided && (
        <Banner tone={v.batch.status === "rejected" ? "bad" : "ok"} title={v.batch.status === "rejected" ? "Not OK – don't use" : v.batch.status === "released" || v.batch.status === "closed" ? "OK to use" : `Batch: ${qaWord(v.batch.status)}`}>
          {v.lastCheck ? `${QUALITY_CHECK_LABEL[v.lastCheck.decision]} by ${v.lastCheck.by}, ${fmtDateTime(v.lastCheck.at)}.` : "Decided on the full QA review page."}
          {v.batch.status === "closed" ? " The batch is closed." : ""}
        </Banner>
      )}
      {!decided && v.onHold && (
        <Banner tone="warn" title="Not yet – stopped by QA">
          {v.lastCheck?.decision === "not_yet" ? `Not yet: ${v.lastCheck.reason ?? ""}. Check again on ${v.lastCheck.checkAgainOn ? fmtDate(v.lastCheck.checkAgainOn) : "—"}.` : "The lot is stopped by QA."}
        </Banner>
      )}

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-5">
          <Card>
            <CardTitle>This batch</CardTitle>
            <ul className="space-y-1 text-[15px]">
              <li>
                Good {word}: <b>{good ?? "—"}</b>
                {v.counts.expected ? <span className="text-muted"> (expected {v.counts.expected})</span> : null}
                {v.counts.yieldPct ? <span className={v.counts.withinRange ? "text-muted" : "font-semibold text-[var(--warn-fg)]"}> · {v.counts.yieldPct} % (OK {v.counts.range})</span> : null}
              </li>
              <li>
                Rejects: <b>{rejectTotal}</b>
                {v.counts.rejects.length > 0 && <span className="text-muted"> ({v.counts.rejects.map((r) => `${r.what} ${r.qty}`).join(", ")})</span>}
              </li>
              <li>
                Samples kept: <b>{Number(v.counts.samples)}</b> · ready to sell after OK: <b>{sellable ?? "—"}</b>
              </li>
              {v.lot && (
                <li>
                  Lot <span className="font-mono text-[13px] text-muted">{v.lot.number}</span>
                  {v.lot.expiresOn ? ` · expires ${fmtDate(v.lot.expiresOn)}` : ""} · in stock {Number(v.lot.onHand)}
                </li>
              )}
            </ul>
          </Card>

          <Card>
            <CardTitle>Things that did not go as planned</CardTitle>
            {v.exceptions.length === 0 ? (
              <p className="text-[15px] text-fg-2">Nothing left the normal path: no weighing or reading outside the limits, no early end of curing, no problem reports, no overrides.</p>
            ) : (
              <ul className="space-y-2" data-testid="exceptions">
                {v.exceptions.map((x, i) => (
                  <li key={i} className="flex items-start gap-2 text-[15px]">
                    <Chip tone={x.kind === "open_problem_report" ? "bad" : "warn"}>{x.kind === "open_problem_report" ? "Open" : "Check"}</Chip>
                    <span>{x.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Tests (quality check)</CardTitle>
            {!v.planDriven ? (
              <div className="space-y-3" data-testid="free-tests">
                {v.freeTests.length === 0 ? (
                  <p className="text-[14px] text-muted">This batch has no test list. Type each test you did here.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {v.freeTests.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
                        <span>
                          {t.name}: <b>{t.result}</b> <span className="text-muted">· {t.by}</span>
                        </span>
                        <Chip tone={t.passed ? "ok" : "bad"}>{t.passed ? "Pass" : "Fail"}</Chip>
                      </li>
                    ))}
                  </ul>
                )}
                {v.canRecordFreeTest && <TestResultForm batchId={v.batch.id} />}
              </div>
            ) : !v.inspection ? (
              <div className="space-y-2">
                <p className="text-[14px] text-muted">The tests have not been started.</p>
                {ctx.can("quality.inspection.create") && <StartInspectionButton batchId={v.batch.id} />}
              </div>
            ) : (
              (() => {
                const ins = v.inspection!;
                const done = ins.tests.filter((t) => t.result);
                const open = ins.tests.filter((t) => !t.result);
                const canType = ins.canRecord && !decided;
                return (
                  <div className="space-y-3">
                    {done.length > 0 && (
                      <ul className="divide-y divide-line" data-testid="tests-done">
                        {done.map((t) => (
                          <li key={t.id} className="py-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <span className="font-medium">{t.name}</span>
                              <span className="text-[13px] text-muted">OK: {t.spec}</span>
                            </div>
                            <p className="mt-1 text-[15px]">
                              <Chip tone={t.result!.passed ? "ok" : "bad"}>{t.result!.passed ? "OK" : "Not OK"}</Chip> {t.result!.text} <span className="text-[13px] text-muted">by {t.result!.by}</span>
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                    {open.length > 0 &&
                      (canType ? (
                        <>
                          {done.length > 0 && <p className="text-[14px] font-semibold">Still to test ({open.length})</p>}
                          <TestsForm key={open.map((t) => t.id).join(",")} inspectionId={ins.id} tests={open.map((t) => ({ id: t.id, name: t.name, valueKind: t.valueKind, uom: t.uom, spec: t.spec, isRequired: t.isRequired }))} />
                        </>
                      ) : (
                        <ul className="divide-y divide-line">
                          {open.map((t) => (
                            <li key={t.id} className="py-3">
                              <span className="font-medium">{t.name}</span> <span className="text-[14px] text-muted">· no result yet</span>
                            </li>
                          ))}
                        </ul>
                      ))}
                  </div>
                );
              })()
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {!decided && (
            <Card>
              <CardTitle>Decision</CardTitle>
              {!v.can.decide ? (
                <div className="space-y-2">
                  <p className="text-[14px] text-fg-2">A QA person decides this batch.</p>
                  <WhoCanHelp permission="quality.disposition.approve" siteId={v.batch.siteId} hideEmails />
                </div>
              ) : (
                <div className="space-y-5">
                  {v.blockers.length > 0 && (
                    <Banner tone="warn" title="“OK to use” is not possible yet">
                      <ul className="list-disc pl-5">
                        {v.blockers.map((b) => (
                          <li key={b}>{b}</li>
                        ))}
                      </ul>
                    </Banner>
                  )}
                  {v.independence.isMaker && !v.independence.ownerOverride && (
                    <Banner tone="warn" title="Another QA person must say OK">
                      You {v.independence.what.join(", ")} on this batch. The person who says OK never works on the batch.
                    </Banner>
                  )}
                  {v.independence.isMaker && v.independence.ownerOverride && <p className="text-[14px] text-fg-2">You made this batch and are saying OK. This is recorded and printed on the batch record.</p>}
                  {v.isTester && !v.testerMayRelease && !v.independence.ownerOverride && <p className="text-[14px] text-fg-2">You entered the test results; another QA person must say OK (setting).</p>}
                  {v.isTester && v.testerMayRelease && <p className="text-[13px] text-muted">You entered the test results. The batch record will say: tested and OK’d by the same person.</p>}
                  <PassForm batchId={v.batch.id} canPass={v.can.pass && v.blockers.length === 0} maker={v.independence.isMaker ? { what: v.independence.what, ownerOverride: v.independence.ownerOverride } : null} />
                  <details className="rounded-[16px] border border-line p-3">
                    <summary className="min-h-[44px] cursor-pointer py-2 text-[15px] font-semibold">Not yet (check again later)</summary>
                    <div className="mt-3">
                      <NotYetForm batchId={v.batch.id} today={manilaToday()} />
                    </div>
                  </details>
                  <details className="rounded-[16px] border border-line p-3">
                    <summary className="min-h-[44px] cursor-pointer py-2 text-[15px] font-semibold">Not OK – don&apos;t use</summary>
                    <div className="mt-3">
                      <FailForm batchId={v.batch.id} />
                    </div>
                  </details>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

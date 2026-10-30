import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { pieceWord } from "@/modules/production";
import { getQualityCheck, QUALITY_CHECK_LABEL, type QualityCheckView } from "@/modules/quality";
import { Card, CardTitle, LinkButton, PageHeader } from "@/ui/core";
import { Help } from "@/ui/help/help";
import { Banner, Chip } from "@/ui/status";
import { WhoCanHelp } from "@/ui/who-can-help";
import { Forbidden } from "../../../forbidden";
import { StartInspectionButton } from "../../w2c-forms";
import { FailForm, NotYetForm, PassForm, TestsForm } from "../forms";

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
        title={`Check quality · ${v.batch.number}`}
        subtitle={`${v.product.name}${v.order ? ` · order ${v.order.number}` : ""}`}
        actions={
          <>
            <Help screen="quality.check" />
            {v.order && (
              <LinkButton href={`/production/orders/${v.order.id}`} variant="secondary">
                Order
              </LinkButton>
            )}
            <LinkButton href={`/print/bmr/${v.batch.id}`} variant="secondary" target="_blank">
              Batch record
            </LinkButton>
          </>
        }
      />

      {decided && (
        <Banner tone={v.batch.status === "rejected" ? "bad" : "ok"} title={v.batch.status === "rejected" ? "Failed" : v.batch.status === "released" || v.batch.status === "closed" ? "Passed" : `Batch is ${v.batch.status.replace(/_/g, " ")}`}>
          {v.lastCheck ? `${QUALITY_CHECK_LABEL[v.lastCheck.decision]} by ${v.lastCheck.by}, ${fmtDateTime(v.lastCheck.at)}.` : "Decided on the QA release screen."}
          {v.batch.status === "closed" ? " The batch is closed." : ""}
        </Banner>
      )}
      {!decided && v.onHold && (
        <Banner tone="warn" title="On hold">
          {v.lastCheck?.decision === "not_yet" ? `Not yet: ${v.lastCheck.reason ?? ""}. Check again on ${v.lastCheck.checkAgainOn ? fmtDate(v.lastCheck.checkAgainOn) : "—"}.` : "The lot is on hold."}
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
                Samples kept: <b>{Number(v.counts.samples)}</b> · ready to sell after Pass: <b>{sellable ?? "—"}</b>
              </li>
              {v.lot && (
                <li>
                  Lot <span className="font-mono">{v.lot.number}</span>
                  {v.lot.expiresOn ? ` · expires ${fmtDate(v.lot.expiresOn)}` : ""} · in stock {Number(v.lot.onHand)}
                </li>
              )}
            </ul>
          </Card>

          <Card>
            <CardTitle>Exceptions in this batch</CardTitle>
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
            <CardTitle>Tests</CardTitle>
            {!v.planDriven ? (
              <p className="text-[14px] text-muted">This batch has no test list. Record tests on the QA release screen.</p>
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
                    <Banner tone="warn" title="Pass is not possible yet">
                      <ul className="list-disc pl-5">
                        {v.blockers.map((b) => (
                          <li key={b}>{b}</li>
                        ))}
                      </ul>
                    </Banner>
                  )}
                  {v.independence.isMaker && !v.independence.ownerOverride && (
                    <Banner tone="warn" title="Another QA person must pass it">
                      You {v.independence.what.join(", ")} on this batch. The person who passes a batch never works on it.
                    </Banner>
                  )}
                  {v.independence.isMaker && v.independence.ownerOverride && <p className="text-[14px] text-fg-2">You made this batch and are passing it. This is recorded and printed on the batch record.</p>}
                  {v.isTester && !v.testerMayRelease && !v.independence.ownerOverride && <p className="text-[14px] text-fg-2">You entered the test results; another QA person must pass it (setting).</p>}
                  {v.isTester && v.testerMayRelease && <p className="text-[13px] text-muted">You entered the test results. The batch record will say: tested and passed by the same person.</p>}
                  <PassForm batchId={v.batch.id} canPass={v.can.pass && v.blockers.length === 0} maker={v.independence.isMaker ? { what: v.independence.what, ownerOverride: v.independence.ownerOverride } : null} />
                  <details className="rounded-[16px] border border-line p-3">
                    <summary className="cursor-pointer text-[15px] font-semibold">Not yet</summary>
                    <div className="mt-3">
                      <NotYetForm batchId={v.batch.id} today={manilaToday()} />
                    </div>
                  </details>
                  <details className="rounded-[16px] border border-line p-3">
                    <summary className="cursor-pointer text-[15px] font-semibold">Fail</summary>
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

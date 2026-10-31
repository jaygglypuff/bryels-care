import Link from "next/link";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtDateTime, fmtMass, fmtQty } from "@/lib/qty";
import { getBatchRelease } from "@/modules/quality/dispositions";
import { conditionalReleaseState } from "@/modules/quality";
import { TESTABLE_BATCH_STATUSES } from "@/modules/quality/rules";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, cx } from "@/ui/core";
import { Explain, MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { WhoCanHelp } from "@/ui/who-can-help";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { DecisionHistory, DeviationStatusChip, InspectionStatusChip, QaStatusChip, fmtLotQty, qaWord, statusTone } from "../../_ui";
import { ConditionalDecideForm, ConditionalRequestForm, StartInspectionButton } from "../../w2c-forms";
import { decideBatchAction } from "../../actions";
import { DecisionForm } from "../../decision-form";
import { TestResultForm } from "./test-form";
import { Help } from "@/ui/help/help";

export const dynamic = "force-dynamic";

export default async function BatchReleasePage({ params }: { params: Promise<{ batchId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.disposition.view")) return <Forbidden what="QA batch release" />;
  const { batchId } = await params;

  let v: Awaited<ReturnType<typeof getBatchRelease>>;
  try {
    v = await getBatchRelease(ctx, batchId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") {
      return (
        <EmptyState title="Batch not found" action={<LinkButton href="/quality" variant="secondary">Back to QA queue</LinkButton>}>
          This batch does not exist or is not at one of your sites.
        </EmptyState>
      );
    }
    throw e;
  }
  const { batch, lot } = v;
  const cr = v.canDecide ? await conditionalReleaseState(ctx, batch.id) : null;
  const stepsDone = v.steps.filter((s) => s.record).length;
  const liveTests = v.tests.filter((t) => t.live);
  const passed = liveTests.filter((t) => t.passed).length;
  const failed = liveTests.length - passed;
  const testable = (TESTABLE_BATCH_STATUSES as readonly string[]).includes(batch.status);
  const releaseBlocker = v.blockers.length ? v.blockers.map((b) => b.message).join(" ") : null;

  return (
    <>
      <PageHeader
        title={v.productName}
        subtitle={
          <>
            Batch <RecordNo>{batch.batchNumber}</RecordNo> · full QA review
          </>
        }
        actions={
          <>
            <Help screen="quality.release" />
            <MoreMenu>
              <div className="flex flex-col gap-2">
                <LinkButton href={`/print/bmr/${batch.id}`} variant="secondary" target="_blank">
                  Batch record (print)
                </LinkButton>
                <LinkButton href={`/production/${batch.id}`} variant="secondary">
                  Batch on the production screen
                </LinkButton>
                {v.can.raiseDeviation && (
                  <LinkButton href={`/quality/deviations/new?batchId=${batch.id}`} variant="secondary">
                    Report a problem
                  </LinkButton>
                )}
                <LinkButton href="/quality" variant="secondary">
                  Back to QA queue
                </LinkButton>
              </div>
            </MoreMenu>
          </>
        }
      />
      <PageIntro>
        This screen is for the QA person: see everything about this batch (weighing, steps, tests, problems) and say OK to use or not OK.
      </PageIntro>
      <div className="-mt-3 mb-4"><Explain term="batch" /></div>
      {["awaiting_qc", "quarantined"].includes(batch.status) &&
        (v.canDecide ? (
          <NextStep
            text={v.planDriven && v.inspections.length === 0 ? "Next: start the quality check (tests) for this batch, then decide OK or not OK." : releaseBlocker ? "Next: fix what blocks the OK (see the yellow box below), or say not OK." : "Next: decide OK to use or not OK."}
            action={{ label: v.planDriven && v.inspections.length === 0 ? "Go to the tests" : "Decide now", href: v.planDriven && v.inspections.length === 0 ? "#tests" : "#decide" }}
          />
        ) : (
          <>
            <NextStep text="Next: a QA person checks this batch and says OK or not OK." waitingFor="Waiting for QA." />
            <div className="-mt-2 mb-4">
              <WhoCanHelp permission="quality.disposition.approve" siteId={batch.siteId} hideEmails lead="QA people who decide: " />
            </div>
          </>
        ))}

      <div className="flex flex-col gap-5">
        <Banner tone={statusTone(batch.status)} title={`Batch: ${qaWord(batch.status)}`}>
          {batch.status === "quarantined"
            ? "The tests were checked by a second QA person. Say OK to use or not OK; the products wait in the hold area until you decide."
            : batch.status === "awaiting_qc"
            ? "Look at the batch record and the tests, then say OK to use or not OK. The products wait in the hold area until you decide."
            : batch.status === "released"
              ? "OK to use: the products may be sold and were moved to the finished-goods shelves."
              : batch.status === "rejected"
                ? "Not OK – don't use: the products are blocked and in the area for things we cannot use."
                : "This batch is not finished yet; QA decides after production presses Finish batch."}
        </Banner>

        <Card>
          <CardTitle>This batch</CardTitle>
          <Dl
            items={[
              ["Product", v.productName],
              ["Status", <QaStatusChip key="s" status={batch.status} />],
              ["Pieces made", batch.actualUnits ? fmtQty(batch.actualUnits, "pcs", 0) : "—"],
              ["Weight made", `${batch.actualOutputG ? fmtMass(batch.actualOutputG) : "—"} (planned ${fmtMass(batch.plannedSizeG)}${batch.theoreticalYieldG ? `, expected ${fmtMass(batch.theoreticalYieldG)}` : ""})`],
              ["How much came out (yield)", batch.yieldPct ? `${D(batch.yieldPct).toFixed(1)} %` : "—"],
              ["Finished", fmtDateTime(batch.completedAt)],
              [
                "Product lot",
                lot ? (
                  <span key="l" className="inline-flex flex-wrap items-center gap-2">
                    <Link className="text-primary-text hover:underline" href={`/inventory/${lot.id}`}>
                      {lot.lotNumber}
                    </Link>
                    <QaStatusChip status={lot.qualityStatus} />
                  </span>
                ) : (
                  "—"
                ),
              ],
              ["Use by", fmtDate(lot?.expiresOn)],
              ["Where the products are", v.lotStock.length ? v.lotStock.map((s) => `${fmtLotQty(s.qty, lot?.baseUom)} at ${s.locationCode}`).join(", ") : "—"],
              ["Steps", `${stepsDone} of ${v.steps.length} done`],
            ]}
          />
        </Card>

        <Card>
          <CardTitle action={v.exceptionCount > 0 ? <Chip tone="warn">{v.exceptionCount} outside the limits</Chip> : <Chip tone="ok">All within the limits</Chip>}>Ingredients weighed</CardTitle>
          {v.lines.length === 0 ? (
            <EmptyState title="No ingredients">This batch has no ingredient list.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {v.lines.map((l) => {
                const exception = l.status === "exception" || l.dispenses.some((d) => !d.isWithinTolerance);
                return (
                  <li key={l.id} className={cx("flex flex-col gap-1 py-2.5 text-[14px]", exception && "-mx-2 rounded-[10px] bg-[var(--warn-bg)] px-2")}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{l.materialName}</span>
                      {l.status === "pending" ? <Chip tone="neu">Not weighed</Chip> : exception ? <Chip tone="warn">Outside the limits</Chip> : <Chip tone="ok">OK</Chip>}
                    </span>
                    <span className="text-fg-2">
                      Needed {fmtMass(l.theoreticalQtyG)} (± {D(l.tolerancePct).toString()} %) · weighed {fmtMass(l.dispensedQtyG)}
                    </span>
                    {l.dispenses.find((d) => d.exceptionReason) && <span className="text-[13px]">Why: {l.dispenses.find((d) => d.exceptionReason)?.exceptionReason}</span>}
                    {l.dispenses.length > 0 && (
                      <span className="text-[12px] text-muted">
                        {l.dispenses.map((d, i) => (
                          <span key={i} className="mr-2 inline-block">
                            <Link className="font-mono text-primary-text hover:underline" href={`/inventory/${d.lotId}`}>
                              {d.lotNumber}
                            </Link>{" "}
                            {fmtMass(d.actualQtyG)} · {d.operatorName} / {d.checkerName}
                          </span>
                        ))}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle action={<Chip tone={stepsDone === v.steps.length ? "ok" : "warn"}>{stepsDone} / {v.steps.length}</Chip>}>Steps done</CardTitle>
          <ol className="flex flex-col divide-y divide-line">
            {v.steps.map((s) => (
              <li key={s.routingStepId} className="flex flex-wrap items-start gap-3 py-2">
                {s.record ? <CheckCircle2 size={18} className="mt-0.5 text-[var(--ok-fg)]" aria-label="Done" /> : <CircleDashed size={18} className="mt-0.5 text-muted" aria-label="Not done" />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {s.stepNo}. {s.name}
                  </p>
                  <p className="text-[12px] text-muted">
                    {s.record ? `Done by ${s.record.conductedByName}${s.record.checkedByName ? `, checked by ${s.record.checkedByName}` : ""} · ${fmtDateTime(s.record.completedAt)}` : "Not done"}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card>
          <CardTitle action={v.inspection ? <InspectionStatusChip status={v.inspection.status} outcome={v.inspection.outcome} /> : undefined}>
            <span id="tests" className="scroll-mt-24">Quality check (tests)</span>
          </CardTitle>
          {!v.planDriven ? (
            <p className="text-[13px] text-muted">This batch has no test list (it was made before QA approved one for this product). Type the results below under “Test results”.</p>
          ) : (
            <>
              <p className="text-[13px] text-fg-2">
                Tests from the list “quality checks for this item”{v.plan?.code ? <span className="font-mono text-[12px] text-muted"> {v.plan.code} v{v.plan.revisionNo}</span> : null}, fixed when the batch was started
                {v.plan?.isPlaceholder ? ". This list is demo content: QA must replace it before real use" : ""}.
              </p>
              {v.inspections.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1 text-[14px]">
                  {v.inspections.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-2">
                      <Link className="inline-flex min-h-[44px] items-center font-medium text-primary-text hover:underline" href={`/quality/inspections/${i.id}`}>
                        Open the tests <span className="ml-1 font-mono text-[12px] font-normal text-muted">{i.number}</span>
                      </Link>
                      <InspectionStatusChip status={i.status} outcome={i.outcome} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[13px] text-muted">The tests have not been started.</p>
              )}
              {v.can.startInspection && (
                <div className="mt-3">
                  <StartInspectionButton batchId={batch.id} />
                </div>
              )}
            </>
          )}
        </Card>

        <Card>
          <CardTitle>Problem reports</CardTitle>
          {v.deviations.length === 0 ? (
            <p className="text-[13px] text-muted">No problem was reported for this batch. Something wrong? Use ⋯ More → Report a problem.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {v.deviations.map((d) => (
                <li key={d.id} className="flex flex-wrap items-start gap-2 py-2 text-[14px]">
                  <Link className="min-w-0 flex-1 font-medium text-primary-text hover:underline" href={`/quality/deviations/${d.id}`}>
                    {d.stepRef ? `${d.stepRef}: ` : ""}
                    {d.description} <span className="font-mono text-[12px] font-normal text-muted">{d.number}</span>
                  </Link>
                  <DeviationStatusChip status={d.status} />
                  {d.status === "closed" && d.releasePermitted === false && <Chip tone="rej">May not be made OK</Chip>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle action={liveTests.length > 0 ? <Chip tone={failed ? "bad" : "ok"}>{passed} OK{failed ? `, ${failed} not OK` : ""}</Chip> : undefined}>Test results</CardTitle>
          {v.tests.length === 0 ? (
            <EmptyState title="No test results yet">Type at least one test result before the batch can be made OK to use.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {v.tests.map((t) => (
                <li key={t.id} className={cx("flex flex-col gap-0.5 py-2.5 text-[14px]", !t.live ? "text-muted" : !t.passed && "-mx-2 rounded-[10px] bg-[var(--bad-bg)] px-2")}>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t.testName}</span>
                    {!t.live ? <Chip tone="neu">Replaced by a newer result</Chip> : t.passed ? <Chip tone="ok">OK</Chip> : <Chip tone="bad">Not OK</Chip>}
                  </span>
                  <span>
                    <span className={cx(!t.live && "line-through")}>{t.result}</span> <span className="text-[13px] text-muted">· should be: {t.specification}</span>
                  </span>
                  {t.correctionReason && <span className="text-[12px] text-muted">Correction: {t.correctionReason}</span>}
                  <span className="text-[12px] text-muted">
                    {t.testedByName}, {fmtDateTime(t.testedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {v.canRecordTest && testable && (
            <div className="mt-5 border-t border-line pt-4">
              <MoreDetails title="Type a test result by hand">
                <TestResultForm batchId={batch.id} />
              </MoreDetails>
            </div>
          )}
          <p className="mt-3 text-[12px] text-muted">Results are never changed; a correction is added as a new line. What “OK” means for each test is set by the company&apos;s QA, not by the system.</p>
        </Card>

        <Card>
          <span id="decide" className="block scroll-mt-24" />
          <CardTitle>QA decision</CardTitle>
          {!v.canDecide ? (
            <div className="text-[13px] text-muted">
              Only a QA person can say OK or not OK.
              <WhoCanHelp permission="quality.disposition.approve" siteId={batch.siteId} hideEmails />
            </div>
          ) : (
            <>
              {releaseBlocker && v.canReject && (
                <div className="mb-3">
                  <Banner tone="warn" title="“OK to use” is not possible yet">
                    <ul className="list-disc pl-5">
                      {v.blockers.map((b, i) => (
                        <li key={i}>{b.message}</li>
                      ))}
                    </ul>
                  </Banner>
                </div>
              )}
              <DecisionForm
                action={decideBatchAction}
                hidden={{ batchId: batch.id }}
                options={[
                  {
                    value: "release",
                    label: "OK to use",
                    hint: "The products may be sold; they move from the hold area to the finished-goods shelves.",
                    blocker: releaseBlocker && v.canReject ? "Not possible yet: see the reasons above." : releaseBlocker,
                  },
                  {
                    value: "reject",
                    label: "Not OK – don't use",
                    hint: "The products are blocked and move to the area for things we cannot use.",
                    blocker: v.canReject ? null : "Only a batch waiting for QA check can be made not OK.",
                    danger: true,
                  },
                ]}
              />
            </>
          )}
        </Card>

        {cr && (cr.enabled || cr.pending) && (
          <Card>
            <CardTitle>OK with conditions</CardTitle>
            {cr.pending ? (
              <>
                <p className="mb-3 text-[13px]">
                  Asked by {cr.pending.requestedByName} on {fmtDateTime(cr.pending.requestedAt)}. Conditions: {cr.pending.conditions}. Look at it again by {fmtDate(cr.pending.reviewDate)}.
                </p>
                {!cr.canDecide && <p className="mb-3 text-[13px] text-muted">A second QA person (not the one who asked) decides.</p>}
                <ConditionalDecideForm batchId={batch.id} requestId={cr.pending.id} canDecide={cr.canDecide} canCancel={ctx.can("quality.disposition.approve")} />
              </>
            ) : cr.canRequest && v.canReject ? (
              <MoreDetails title="Ask for “OK with conditions” (rare)">
                <ConditionalRequestForm batchId={batch.id} />
              </MoreDetails>
            ) : (
              <p className="text-[13px] text-muted">Only a batch waiting for QA check can get “OK with conditions”.</p>
            )}
            <p className="mt-3 text-[12px] text-muted">Allowed only when the company&apos;s QA turned it on (setting quality.conditional_release.enabled). It never skips open problem reports, QA stops, not-OK tests or the two-person rule.</p>
          </Card>
        )}

        <Card>
          <CardTitle>Past QA decisions</CardTitle>
          {v.history.length === 0 ? (
            <EmptyState title="No decisions yet">The OK or not OK on this batch will be listed here with who gave it and why.</EmptyState>
          ) : (
            <DecisionHistory rows={v.history} />
          )}
        </Card>
      </div>
    </>
  );
}

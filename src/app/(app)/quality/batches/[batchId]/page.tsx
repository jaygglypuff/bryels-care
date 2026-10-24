import Link from "next/link";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtDateTime, fmtMass, fmtQty } from "@/lib/qty";
import { getBatchRelease } from "@/modules/quality/dispositions";
import { conditionalReleaseState } from "@/modules/quality";
import { TESTABLE_BATCH_STATUSES } from "@/modules/quality/rules";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, Table, Td, cx } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { DecisionChip, DeviationStatusChip, InspectionStatusChip, Transition, fmtLotQty, statusTone } from "../../_ui";
import { ConditionalDecideForm, ConditionalRequestForm, StartInspectionButton } from "../../w2c-forms";
import { decideBatchAction } from "../../actions";
import { DecisionForm } from "../../decision-form";
import { TestResultForm } from "./test-form";

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
        title={batch.batchNumber}
        subtitle={`${v.productName} · ${v.productSku} · batch release`}
        actions={
          <>
            <LinkButton href="/quality" variant="secondary">
              QA queue
            </LinkButton>
            <LinkButton href={`/print/bmr/${batch.id}`} variant="secondary" target="_blank">
              Open BMR
            </LinkButton>
            <LinkButton href={`/production/${batch.id}`} variant="secondary">
              Batch record
            </LinkButton>
          </>
        }
      />

      <div className="flex flex-col gap-5">
        <Banner tone={statusTone(batch.status)} title={`Batch status: ${batch.status === "awaiting_qc" ? "awaiting QC" : batch.status.replace("_", " ")}`}>
          {batch.status === "quarantined"
            ? "The inspection was reviewed. Release or reject the batch; the output lot stays in quarantine until you decide."
            : batch.status === "awaiting_qc"
            ? "Review the batch record and test results, then release or reject the batch. The output lot stays in quarantine until you decide."
            : batch.status === "released"
              ? "Released: the output lot is usable and was moved to finished-goods storage."
              : batch.status === "rejected"
                ? "Rejected: the output lot is blocked and its stock is in the rejected-goods location."
                : "This batch is not ready for QA disposition yet."}
        </Banner>

        <Card>
          <CardTitle>Batch summary</CardTitle>
          <Dl
            items={[
              ["Product", v.productName],
              ["Status", <StatusChip key="s" status={batch.status} />],
              ["Planned size", fmtMass(batch.plannedSizeG)],
              ["Theoretical yield", batch.theoreticalYieldG ? fmtMass(batch.theoreticalYieldG) : "—"],
              ["Actual output", batch.actualOutputG ? fmtMass(batch.actualOutputG) : "—"],
              ["Yield", batch.yieldPct ? `${D(batch.yieldPct).toFixed(1)} %` : "—"],
              ["Units", batch.actualUnits ? fmtQty(batch.actualUnits, "pcs", 0) : "—"],
              ["Completed", fmtDateTime(batch.completedAt)],
              [
                "Output lot",
                lot ? (
                  <span key="l" className="inline-flex flex-wrap items-center gap-2">
                    <Link className="text-primary-text hover:underline" href={`/inventory/${lot.id}`}>
                      {lot.lotNumber}
                    </Link>
                    <StatusChip status={lot.qualityStatus} />
                  </span>
                ) : (
                  "—"
                ),
              ],
              ["Lot expiry", fmtDate(lot?.expiresOn)],
              ["Lot stock", v.lotStock.length ? v.lotStock.map((s) => `${fmtLotQty(s.qty, lot?.baseUom)} at ${s.locationCode}`).join(", ") : "—"],
              ["Checklist", `${stepsDone} of ${v.steps.length} steps completed`],
            ]}
          />
        </Card>

        <Card>
          <CardTitle action={v.exceptionCount > 0 ? <Chip tone="warn">{v.exceptionCount} exception(s)</Chip> : <Chip tone="ok">All within tolerance</Chip>}>Ingredients dispensed</CardTitle>
          {v.lines.length === 0 ? (
            <EmptyState title="No ingredient lines">This batch has no ingredient requirements.</EmptyState>
          ) : (
            <Table head={["#", "Material", "Required", "Tolerance", "Dispensed", "Lots used", "Tolerance check", "Weighed / checked by"]}>
              {v.lines.map((l) => {
                const exception = l.status === "exception" || l.dispenses.some((d) => !d.isWithinTolerance);
                return (
                  <tr key={l.id} className={cx(exception && "bg-[var(--warn-bg)]")}>
                    <Td>{l.lineNo}</Td>
                    <Td>
                      {l.materialName}
                      <div className="text-[12px] text-muted">{l.materialCode}</div>
                    </Td>
                    <Td>{fmtMass(l.theoreticalQtyG)}</Td>
                    <Td>± {D(l.tolerancePct).toString()} %</Td>
                    <Td>{fmtMass(l.dispensedQtyG)}</Td>
                    <Td>
                      {l.dispenses.length === 0
                        ? "—"
                        : l.dispenses.map((d, i) => (
                            <div key={i}>
                              <Link className="whitespace-nowrap text-primary-text hover:underline" href={`/inventory/${d.lotId}`}>
                                {d.lotNumber}
                              </Link>{" "}
                              <span className="whitespace-nowrap text-muted">{fmtMass(d.actualQtyG)}</span>
                            </div>
                          ))}
                    </Td>
                    <Td>
                      {l.status === "pending" ? (
                        <StatusChip status="pending" />
                      ) : exception ? (
                        <span>
                          <StatusChip status="exception" />
                          {l.dispenses.find((d) => d.exceptionReason) && <div className="mt-0.5 text-[12px]">{l.dispenses.find((d) => d.exceptionReason)?.exceptionReason}</div>}
                        </span>
                      ) : (
                        <Chip tone="ok">Within tolerance</Chip>
                      )}
                    </Td>
                    <Td className="text-[12px]">
                      {l.dispenses.map((d, i) => (
                        <div key={i}>
                          {d.operatorName} / {d.checkerName}
                        </div>
                      ))}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>

        <Card>
          <CardTitle action={<Chip tone={stepsDone === v.steps.length ? "ok" : "warn"}>{stepsDone} / {v.steps.length}</Chip>}>Checklist</CardTitle>
          <ol className="flex flex-col divide-y divide-line">
            {v.steps.map((s) => (
              <li key={s.routingStepId} className="flex flex-wrap items-start gap-3 py-2">
                {s.record ? <CheckCircle2 size={18} className="mt-0.5 text-[var(--ok-fg)]" aria-label="Completed" /> : <CircleDashed size={18} className="mt-0.5 text-muted" aria-label="Not completed" />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {s.stepNo}. {s.name}
                  </p>
                  <p className="text-[12px] text-muted">
                    {s.record ? `Conducted by ${s.record.conductedByName}${s.record.checkedByName ? `, checked by ${s.record.checkedByName}` : ""} · ${fmtDateTime(s.record.completedAt)}` : "Not completed"}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card>
          <CardTitle action={v.inspection ? <InspectionStatusChip status={v.inspection.status} outcome={v.inspection.outcome} /> : undefined}>Inspection</CardTitle>
          {!v.planDriven ? (
            <p className="text-[13px] text-muted">This batch has no frozen inspection plan (it was created before an approved finished-product plan existed). QA records its results below as free-form entries.</p>
          ) : (
            <>
              <p className="text-[13px] text-fg-2">
                Plan {v.plan?.code} rev {v.plan?.revisionNo} (frozen when the batch was created)
                {v.plan?.isPlaceholder ? " · placeholder specification, QA must replace it before production use" : ""}.
              </p>
              {v.inspections.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1 text-[14px]">
                  {v.inspections.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-2">
                      <Link className="font-medium text-primary-text hover:underline" href={`/quality/inspections/${i.id}`}>
                        {i.number}
                      </Link>
                      <InspectionStatusChip status={i.status} outcome={i.outcome} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[13px] text-muted">The inspection has not been started.</p>
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
          <CardTitle action={v.can.raiseDeviation ? <LinkButton href={`/quality/deviations/new?batchId=${batch.id}`} variant="secondary" size="sm">Raise deviation</LinkButton> : undefined}>Deviations</CardTitle>
          {v.deviations.length === 0 ? (
            <p className="text-[13px] text-muted">No deviation names this batch or its output lot.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {v.deviations.map((d) => (
                <li key={d.id} className="flex flex-wrap items-start gap-2 py-2 text-[14px]">
                  <Link className="font-medium text-primary-text hover:underline" href={`/quality/deviations/${d.id}`}>
                    {d.number}
                  </Link>
                  <DeviationStatusChip status={d.status} />
                  {d.status === "closed" && d.releasePermitted === false && <Chip tone="rej">Release not permitted</Chip>}
                  <span className="min-w-0 flex-1 text-[13px] text-fg-2">{d.stepRef ? `${d.stepRef}: ` : ""}{d.description}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle action={liveTests.length > 0 ? <Chip tone={failed ? "bad" : "ok"}>{passed} passed{failed ? `, ${failed} failed` : ""}</Chip> : undefined}>Test results</CardTitle>
          {v.tests.length === 0 ? (
            <EmptyState title="No test results yet">Record at least one test result before the batch can be released.</EmptyState>
          ) : (
            <Table head={["Test", "Specification", "Result", "Outcome", "Tested by", "When"]}>
              {v.tests.map((t) => (
                <tr key={t.id} className={cx(!t.live ? "text-muted" : !t.passed && "bg-[var(--bad-bg)]")}>
                  <Td className="font-medium">{t.testName}</Td>
                  <Td>{t.specification}</Td>
                  <Td>
                    <span className={cx(!t.live && "line-through")}>{t.result}</span>
                    {t.correctionReason && <div className="text-[12px] text-muted">Correction: {t.correctionReason}</div>}
                  </Td>
                  <Td>{!t.live ? <Chip tone="neu">Superseded</Chip> : t.passed ? <Chip tone="ok">Pass</Chip> : <Chip tone="bad">Fail</Chip>}</Td>
                  <Td>{t.testedByName}</Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(t.testedAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
          {v.canRecordTest && testable && (
            <div className="mt-5 border-t border-line pt-4">
              <h3 className="mb-3 text-[14px] font-semibold">Record test result</h3>
              <TestResultForm batchId={batch.id} />
            </div>
          )}
          <p className="mt-3 text-[12px] text-muted">Results are append-only. Specifications and required tests must be set by the company&apos;s QA personnel; the system does not define them.</p>
        </Card>

        <Card>
          <CardTitle>Batch decision</CardTitle>
          {!v.canDecide ? (
            <p className="text-[13px] text-muted">You can view this batch. Releasing or rejecting needs the QA approval permission (quality.disposition.approve).</p>
          ) : (
            <>
              {releaseBlocker && v.canReject && (
                <div className="mb-3">
                  <Banner tone="warn" title="Release is blocked">
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
                    label: "Release batch",
                    hint: `Batch and lot ${lot?.lotNumber ?? ""} become released; stock moves from quarantine to finished-goods storage.`,
                    blocker: releaseBlocker && v.canReject ? "Blocked: see the reasons above." : releaseBlocker,
                  },
                  {
                    value: "reject",
                    label: "Reject batch",
                    hint: "Batch and lot become rejected; stock moves to the rejected-goods location.",
                    blocker: v.canReject ? null : "Only a batch awaiting QC can be rejected.",
                    danger: true,
                  },
                ]}
              />
            </>
          )}
        </Card>

        {cr && (cr.enabled || cr.pending) && (
          <Card>
            <CardTitle>Conditional release</CardTitle>
            {cr.pending ? (
              <>
                <p className="mb-3 text-[13px]">
                  Requested by {cr.pending.requestedByName} on {fmtDateTime(cr.pending.requestedAt)}. Conditions: {cr.pending.conditions}. Review by {fmtDate(cr.pending.reviewDate)}.
                </p>
                {!cr.canDecide && <p className="mb-3 text-[13px] text-muted">A second approver (not the requester) must decide.</p>}
                <ConditionalDecideForm batchId={batch.id} requestId={cr.pending.id} canDecide={cr.canDecide} canCancel={ctx.can("quality.disposition.approve")} />
              </>
            ) : cr.canRequest && v.canReject ? (
              <ConditionalRequestForm batchId={batch.id} />
            ) : (
              <p className="text-[13px] text-muted">Only a batch awaiting QC or quarantined can be released conditionally.</p>
            )}
            <p className="mt-3 text-[12px] text-muted">Allowed by the company&apos;s QA policy (setting quality.conditional_release.enabled). It never bypasses deviations, holds, failed results or separation of duties.</p>
          </Card>
        )}

        <Card>
          <CardTitle>Decision history</CardTitle>
          {v.history.length === 0 ? (
            <EmptyState title="No decisions yet">The QA decision on this batch will be listed here.</EmptyState>
          ) : (
            <Table head={["When", "Decision", "Status change", "Decided by", "Reason"]}>
              {v.history.map((h) => (
                <tr key={h.id}>
                  <Td className="whitespace-nowrap">{fmtDateTime(h.decidedAt)}</Td>
                  <Td>
                    <DecisionChip decision={h.decision} />
                  </Td>
                  <Td>
                    <Transition from={h.fromStatus} to={h.toStatus} />
                  </Td>
                  <Td>{h.decidedByName}</Td>
                  <Td className="text-fg-2">{h.reason ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

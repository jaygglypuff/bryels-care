import type { Metadata } from "next";
import Link from "next/link";
import { uuidv7 } from "uuidv7";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtDateTime, fmtMass, fmtQty } from "@/lib/qty";
import { type BatchRecord, type LotOption, checkerOptions, getBatchRecord, progressLabel, usableLotsForBatch } from "@/modules/production";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { CompleteBatchForm, IngredientRow, StartBatchForm, StepForm } from "./forms";

export const metadata: Metadata = { title: "Batch" };

type Params = { params: Promise<{ batchId: string }> };

const STATE_LABEL: Record<string, string> = {
  draft: "Draft",
  planned: "Planned",
  materials_staged: "Materials staged",
  in_process: "In process",
  awaiting_qc: "Awaiting QC",
  quarantined: "Quarantined",
  released: "Released",
  rejected: "Rejected",
  rework_approved: "Rework approved",
  closed: "Closed",
};

function auditLine(a: BatchRecord["audits"][number]): string {
  const after = (a.after ?? {}) as Record<string, unknown>;
  const s = (k: string) => (after[k] == null ? "" : String(after[k]));
  switch (a.action) {
    case "production.batch.created":
      return s("formula") ? `Batch created from ${s("formula")}, planned ${fmtMass(s("plannedSizeG"))}` : "Batch created";
    case "production.batch.started":
      return "Batch started (materials staged, in process)";
    case "production.dispense_record.created":
      return `Weighed ${s("material")} ${fmtQty(s("actualQtyG"), "g", 1)} from lot ${s("lot")}, checked by ${s("checker")}${after.withinTolerance === false ? " (outside tolerance, exception)" : ""}`;
    case "production.process_step.completed":
      return `Step ${s("stepNo")} completed: ${s("name")}${s("checker") ? `, checked by ${s("checker")}` : ""}`;
    case "production.batch.completed":
      return `Batch completed: ${s("actualUnits")} pcs, yield ${s("yieldPct") ? fmtQty(s("yieldPct"), "%", 2) : "—"}, output lot ${s("outputLot")} to ${s("location")}`;
    case "quality.disposition.released":
      return "QA released the batch";
    case "quality.disposition.rejected":
      return "QA rejected the batch";
    default:
      return a.action;
  }
}

export default async function BatchWorkspace({ params }: Params) {
  const { batchId } = await params;
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Forbidden what="production batches" />;
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return <EmptyState title="Batch not found" action={<LinkButton href="/production" variant="secondary">Back to batches</LinkButton>} />;

  let rec: BatchRecord;
  try {
    rec = await getBatchRecord(ctx, batchId);
  } catch (e) {
    if (e instanceof DomainError && (e.code === "not_found" || e.code === "forbidden")) {
      return (
        <EmptyState title="Batch not found" action={<LinkButton href="/production" variant="secondary">Back to batches</LinkButton>}>
          It does not exist or belongs to a site you are not assigned to.
        </EmptyState>
      );
    }
    throw e;
  }
  const { batch, product, snapshot } = rec;
  const inProcess = batch.status === "in_process";
  const canWeighPerm = ctx.can("production.dispense_record.create");
  const canEdit = ctx.can("production.batch.edit");
  const canSubmit = ctx.can("production.batch.submit");
  const needsForms = inProcess && (canWeighPerm || canEdit);
  const lots: Record<string, LotOption[]> = needsForms ? await usableLotsForBatch(ctx, batch.id) : {};
  const checkers = needsForms ? await checkerOptions(ctx, batch.siteId) : [];
  const site = ctx.allowedSites.find((s) => s.id === batch.siteId);
  const allStepsDone = rec.stepsDone >= rec.steps.length;
  const weighingStepNo = rec.steps.find((s) => s.stepKind === "weighing")?.stepNo ?? null;

  const weighBlocked = !inProcess
    ? batch.status === "planned"
      ? "Start the batch to begin weighing."
      : null
    : !canWeighPerm
      ? "Your role cannot record weighings."
      : null;

  const timeline = [
    ...rec.transitions.map((t) => ({
      at: t.at,
      who: t.actor,
      text: t.fromState ? `Status ${STATE_LABEL[t.fromState] ?? t.fromState} → ${STATE_LABEL[t.toState] ?? t.toState}` : `Status set to ${STATE_LABEL[t.toState] ?? t.toState}`,
      reason: t.reason,
      kind: "state" as const,
    })),
    ...rec.audits.map((a) => ({ at: a.occurredAt, who: a.actor, text: auditLine(a), reason: a.reason, kind: "audit" as const })),
  ].sort((a, z) => new Date(z.at).getTime() - new Date(a.at).getTime());

  const lastDisposition = rec.dispositions.at(-1);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/production" className="text-[13px] text-primary-text hover:underline">
          ← Batches
        </Link>
        <PageHeader
          title={batch.batchNumber}
          subtitle={
            <span className="flex flex-wrap items-center gap-2">
              <StatusChip status={batch.status} />
              <span>
                {product.name} · {site?.code ?? ""} · {progressLabel(batch.status, rec.stepsDone, rec.steps.length)}
              </span>
            </span>
          }
          actions={
            <>
              <LinkButton href={`/print/bmr/${batch.id}`} variant="secondary" target="_blank">
                Print BMR
              </LinkButton>
              {batch.status === "planned" && canEdit && <StartBatchForm batchId={batch.id} />}
            </>
          }
        />
      </div>

      {batch.status === "planned" && (
        <Banner tone="info" title="Planned, not started">
          {canEdit ? "Start the batch when materials are at the weighing area. Starting records materials staged and in process." : "An operator starts the batch when materials are staged."}
        </Banner>
      )}
      {batch.status === "awaiting_qc" && (
        <Banner tone="appr" title="Awaiting QA decision">
          Output lot {rec.outputLot?.lotNumber} ({fmtQty(batch.actualUnits, "pcs", 0)}) is in quarantine. QA reviews the record and releases or rejects the batch.
        </Banner>
      )}
      {batch.status === "released" && <Banner tone="ok" title="Released by QA">The output lot may be used for sales orders.</Banner>}
      {batch.status === "rejected" && <Banner tone="rej" title="Rejected by QA">The output lot is blocked. Follow the rejected-goods procedure.</Banner>}

      <Card>
        <Dl
          items={[
            ["Product", `${product.name} (${product.skuCode})`],
            [
              "Formula",
              <span key="f">
                {snapshot.formulaCode} rev {snapshot.revisionNo}
                <span className="block text-[12px] text-muted">snapshot taken {fmtDateTime(snapshot.takenAt ?? batch.createdAt)}</span>
              </span>,
            ],
            ["Planned size", `${fmtQty(D(batch.plannedSizeG).div(1000), "kg", 2)} (${fmtQty(batch.plannedSizeG, "g", 1)})`],
            ["Planned start", fmtDate(batch.plannedStartOn)],
            ["Started", fmtDateTime(batch.startedAt)],
            ["Completed", fmtDateTime(batch.completedAt)],
            ["Theoretical yield", `${fmtMass(batch.theoreticalYieldG)} (${fmtQty(snapshot.theoreticalYieldPct, "%", 1)})`],
            [
              "Actual yield",
              batch.actualOutputG ? `${fmtQty(batch.actualUnits, "pcs", 0)} · ${fmtMass(batch.actualOutputG)} · ${fmtQty(batch.yieldPct, "%", 2)}` : "—",
            ],
            [
              "Output lot",
              rec.outputLot ? (
                <span key="l" className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono">{rec.outputLot.lotNumber}</span>
                  <StatusChip status={rec.outputLot.qualityStatus} />
                  <span className="text-[12px] text-muted">exp {fmtDate(rec.outputLot.expiresOn)}</span>
                </span>
              ) : (
                "—"
              ),
            ],
          ]}
        />
        {batch.remarks && <p className="mt-3 text-[13px] text-fg-2">Remarks: {batch.remarks}</p>}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardTitle
              action={
                <span className="text-[12px] text-muted tabular">
                  {rec.ingredients.filter((i) => i.status !== "pending").length} of {rec.ingredients.length} weighed
                </span>
              }
            >
              Weighing (dispensing)
            </CardTitle>
            <ol className="flex flex-col gap-3">
              {rec.ingredients.map((ing, i) => (
                <IngredientRow
                  key={ing.id}
                  batchId={batch.id}
                  ing={{ ...ing, records: ing.records.map((r) => ({ ...r, recordedAt: r.recordedAt.toISOString() })) }}
                  index={i}
                  total={rec.ingredients.length}
                  lots={lots[ing.materialId] ?? []}
                  checkers={checkers}
                  operatorName={ctx.displayName}
                  canWeigh={inProcess && canWeighPerm}
                  blockedReason={weighBlocked}
                  idempotencyKey={uuidv7()}
                />
              ))}
            </ol>
            <div className="mt-3 flex flex-wrap justify-between gap-2 rounded-[12px] bg-surface-2 px-3.5 py-2.5 text-[13px] tabular">
              <span className="font-semibold">Total</span>
              <span>
                Theoretical {fmtQty(rec.totals.theoreticalG, "g", 1)} · Actual {D(rec.totals.actualG).gt(0) ? fmtQty(rec.totals.actualG, "g", 1) : "—"}
              </span>
            </div>
          </Card>

          <Card>
            <CardTitle action={<span className="text-[12px] text-muted tabular">{rec.stepsDone} of {rec.steps.length} done</span>}>Checklist</CardTitle>
            <ol className="flex flex-col gap-2.5">
              {rec.steps.map((s) => {
                const isNext = rec.nextStep?.stepNo === s.stepNo;
                const blocked =
                  s.stepNo === weighingStepNo && !rec.allWeighed
                    ? `Weigh every ingredient first (${rec.ingredients.filter((i) => i.status === "pending").length} remaining).`
                    : null;
                return (
                  <li
                    key={s.stepNo}
                    data-testid={`step-${s.stepNo}`}
                    className={`rounded-[14px] border p-3.5 ${isNext && inProcess ? "border-primary bg-[var(--green-50)]" : "border-line bg-surface"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                          Step {s.stepNo} of {rec.steps.length}
                        </p>
                        <p className="text-[15px] font-semibold text-fg">{s.name}</p>
                        {s.instruction && <p className="mt-0.5 text-[12px] text-fg-2">{s.instruction}</p>}
                      </div>
                      {s.record ? <Chip tone="ok">Done</Chip> : isNext && inProcess ? <Chip tone="info">Next</Chip> : <Chip tone="neu">Waiting</Chip>}
                    </div>
                    {s.record && (
                      <p className="mt-2 text-[12px] text-fg-2">
                        Conducted by <b>{s.record.conductedBy}</b>
                        {s.record.checkedBy ? (
                          <>
                            , checked by <b>{s.record.checkedBy}</b>
                          </>
                        ) : null}{" "}
                        · {fmtDateTime(s.record.completedAt)}
                        {s.record.readings ? <span className="block">Readings: {s.record.readings}</span> : null}
                      </p>
                    )}
                    {isNext && inProcess && canEdit && (
                      <StepForm batchId={batch.id} stepNo={s.stepNo} stepKind={s.stepKind} checkers={checkers} operatorName={ctx.displayName} blockedReason={blocked} />
                    )}
                    {isNext && inProcess && !canEdit && <p className="mt-2 text-[12px] text-muted">Your role cannot complete steps.</p>}
                  </li>
                );
              })}
            </ol>
          </Card>

          {inProcess && (
            <Card>
              <CardTitle>Complete batch</CardTitle>
              {!allStepsDone ? (
                <p className="text-[13px] text-muted">
                  Available after all {rec.steps.length} checklist steps are complete ({rec.steps.length - rec.stepsDone} remaining).
                </p>
              ) : !canSubmit ? (
                <p className="text-[13px] text-muted">Your role cannot complete batches.</p>
              ) : (
                <CompleteBatchForm batchId={batch.id} unitNetMassG={product.unitNetMassG} theoreticalYieldG={batch.theoreticalYieldG ?? "0"} idempotencyKey={uuidv7()} />
              )}
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardTitle>Quality</CardTitle>
            {lastDisposition ? (
              <div className="mb-3 rounded-[12px] border border-line p-3 text-[13px]">
                <p className="flex items-center gap-2">
                  <StatusChip status={lastDisposition.toStatus} />
                  <span className="font-medium">{lastDisposition.decision === "release" ? "Approved" : lastDisposition.decision === "reject" ? "Disapproved" : lastDisposition.decision}</span>
                </p>
                <p className="mt-1 text-fg-2">
                  {lastDisposition.decidedByName} · {fmtDateTime(lastDisposition.decidedAt)}
                </p>
                {lastDisposition.reason && <p className="mt-1 text-fg-2">{lastDisposition.reason}</p>}
              </div>
            ) : (
              <p className="mb-3 text-[13px] text-muted">{batch.status === "awaiting_qc" ? "Waiting for QA disposition." : "No QA decision yet."}</p>
            )}
            {rec.tests.length === 0 ? (
              <p className="text-[13px] text-muted">No test results recorded.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line text-[13px]">
                {rec.tests.map((t) => (
                  <li key={t.id} className="py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{t.testName}</span>
                      <Chip tone={t.passed ? "ok" : "bad"}>{t.passed ? "Pass" : "Fail"}</Chip>
                    </div>
                    <p className="text-fg-2">
                      {t.result} <span className="text-muted">(spec {t.specification})</span>
                    </p>
                    <p className="text-[12px] text-muted">
                      {t.testedByName} · {fmtDateTime(t.testedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Timeline</CardTitle>
            {timeline.length === 0 ? (
              <p className="text-[13px] text-muted">No events yet.</p>
            ) : (
              <ol className="flex flex-col gap-3 text-[13px]">
                {timeline.map((e, i) => (
                  <li key={i} className="border-l-2 border-line pl-3">
                    <p className={e.kind === "state" ? "font-medium text-fg" : "text-fg"}>{e.text}</p>
                    <p className="text-[12px] text-muted">
                      {e.who ?? "System"} · {fmtDateTime(e.at)}
                    </p>
                    {e.reason && <p className="text-[12px] text-fg-2">Reason: {e.reason}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      {rec.ingredients.some((i) => i.records.length) && (
        <Card className="hidden md:block">
          <CardTitle>Dispense records</CardTitle>
          <Table head={["Ingredient", "Lot", "Expiry", "Location", "Theoretical (g)", "Actual (g)", "Tolerance", "Operator", "Checker", "Scale", "Time"]}>
            {rec.ingredients.flatMap((i) =>
              i.records.map((r) => (
                <tr key={r.id}>
                  <Td>{i.materialName}</Td>
                  <Td className="whitespace-nowrap font-mono">{r.lotNumber}</Td>
                  <Td className="whitespace-nowrap">{fmtDate(r.lotExpiresOn)}</Td>
                  <Td>{r.locationCode}</Td>
                  <Td className="text-right">{fmtQty(i.theoreticalQtyG, "", 1)}</Td>
                  <Td className="text-right">{fmtQty(r.actualQtyG, "", 1)}</Td>
                  <Td>{r.isWithinTolerance ? <Chip tone="ok">Within</Chip> : <Chip tone="warn">Exception</Chip>}</Td>
                  <Td className="whitespace-nowrap">{r.operator}</Td>
                  <Td className="whitespace-nowrap">{r.checker}</Td>
                  <Td className="whitespace-nowrap">{r.scaleCode ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(r.recordedAt)}</Td>
                </tr>
              )),
            )}
          </Table>
        </Card>
      )}
    </div>
  );
}

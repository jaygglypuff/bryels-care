import type { Metadata } from "next";
import Link from "next/link";
import { getSetting } from "@/lib/settings";
import { db } from "@/db/client";
import { uuidv7 } from "uuidv7";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtDateTime, fmtMass, fmtQty } from "@/lib/qty";
import {
  type BatchExecution,
  type BatchRecord,
  type ExecStep,
  checkPermission,
  equipmentOptions,
  getBatchExecution,
  getBatchRecord,
  isWeighingStep,
  packagingLotOptions,
  performPermission,
  progressLabel,
  quarantineLocations,
  signerOptions,
  usableLotsForBatch,
} from "@/modules/production";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, Table, Td, cx } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { StartBatchForm } from "./forms";
import {
  ChecklistForm,
  CompleteStepForm,
  DecideScrapForm,
  EquipmentForm,
  ExceptionForm,
  OneTap,
  PackagingCountForm,
  PackagingIssueForm,
  ReadingForm,
  ReasonForm,
  ScrapForm,
  TransferForm,
  WeighForm,
  YieldForm,
  type Person,
  type ScaleOpt,
  SignOffProvider,
} from "./exec-forms";
import { registerAppHooks } from "@/modules/wiring";
import { Help } from "@/ui/help/help";

// Execution ↔ QA hooks (idempotent; also registered at server start in src/instrumentation.ts).
registerAppHooks();

export const metadata: Metadata = { title: "Batch" };

type Params = { params: Promise<{ batchId: string }>; searchParams: Promise<{ step?: string }> };

const STATE_LABEL: Record<string, string> = {
  draft: "Draft",
  planned: "Planned",
  materials_staged: "Materials ready",
  in_process: "In process",
  awaiting_qc: "Waiting for quality approval",
  quarantined: "On hold until quality approves",
  released: "Approved by quality",
  rejected: "Rejected by quality",
  rework_approved: "Rework approved",
  closed: "Closed",
};
type StepTone = "ok" | "info" | "warn" | "neu" | "appr";
const STEP_STATUS: Record<string, { label: string; tone: StepTone }> = {
  awaiting_check: { label: "Needs checker", tone: "appr" },
  completed: { label: "Done", tone: "ok" },
  skipped: { label: "Skipped", tone: "warn" },
};

/**
 * The stepper chip in plain words: the step being worked on is "Now", the one after it "Next", the
 * rest "Later"; finished steps "Done". A batch that is not running shows no "Now".
 */
function stepChip(s: ExecStep, currentNo: number | null, running: boolean): { label: string; tone: StepTone } {
  const fixed = STEP_STATUS[s.status];
  if (fixed) return fixed;
  if (running && (s.isCurrent || s.status === "in_progress")) return { label: "Now", tone: "info" };
  if (running && currentNo !== null && s.stepNo === currentNo + 1) return { label: "Next", tone: "neu" };
  return { label: "Later", tone: "neu" };
}
const LINE_STATUS: Record<string, string> = { pending: "Pending", partial: "Part weighed", dispensed: "Dispensed", exception: "Exception" };

function auditLine(a: BatchRecord["audits"][number]): string {
  const after = (a.after ?? {}) as Record<string, unknown>;
  const s = (k: string) => (after[k] == null ? "" : String(after[k]));
  switch (a.action) {
    case "production.batch.created":
      return s("formula") ? `Batch created from ${s("formula")}, planned ${fmtMass(s("plannedSizeG"))}` : "Batch created";
    case "production.batch.started":
      return "Batch in process";
    case "production.dispense_record.created":
    case "production.dispense_record.recorded":
      return `Weighed ${s("materialName") || s("material")} ${fmtQty(s("actualQtyG"), "g", 1)} from lot ${s("lot")}${after.withinTolerance === false ? " (outside tolerance, exception)" : ""}${after.partial ? " (part)" : ""}`;
    case "production.dispense_record.checked":
      return `Weighing of ${s("material")} checked`;
    case "production.dispense_record.voided":
      return "Weighing voided";
    case "production.dispense_record.over_tolerance_approved":
      return `Out-of-tolerance weight of ${s("material")} approved (CX-TOL)`;
    case "production.process_step.completed":
    case "production.process_step_record.completed":
      return `Step ${s("stepNo")} ${s("status") === "awaiting_check" ? "done, waiting for checker" : "completed"}: ${s("name")}`;
    case "production.process_step_record.checked":
      return `Step ${s("stepNo")} checked: ${s("name")}`;
    case "production.line_clearance.answered":
      return `Checklist answered on step ${s("stepNo")}`;
    case "production.packaging_component.issued":
      return `Packaging lot ${s("lot")} issued: ${s("issued")} ${s("uom")}`;
    case "production.packaging_reconciliation.counted":
    case "production.packaging_reconciliation.recounted":
      return `Packaging ${s("material")} counted: variance ${s("variance")}${after.within === false ? " (mismatch)" : ""}`;
    case "production.equipment_use.ended":
      return `Equipment ${s("equipment")} released`;
    case "production.yield_record.approved":
      return "Yield outside range approved (deviation opened)";
    case "production.scrap_rework_record.recorded":
      return `${s("kind") === "rework" ? "Rework" : "Scrap"} recorded: ${s("qty")} ${s("uom")}`;
    case "production.production_posting.consumption_posted":
      return `Consumption posted (${s("postings")} movements)`;
    case "production.production_posting.output_posted":
      return `Output posted: lot ${s("lot")}, ${s("qty")} ${s("uom")} to ${s("location")}`;
    case "production.process_step_record.started":
      return `Step ${s("stepNo")} started: ${s("name")}`;
    case "production.process_step_record.returned":
      return `Step ${s("stepNo")} returned by the checker`;
    case "production.process_step_record.exception_approved":
      return `Exception approved on step ${s("stepNo")} (deviation opened)`;
    case "production.process_step_reading.recorded":
    case "production.process_step_reading.corrected":
      return `Reading ${s("parameter")} = ${s("value")}${s("uom") ? ` ${s("uom")}` : ""}${after.isWithinLimits === false ? " (outside limits)" : ""}`;
    case "production.equipment_use.created":
      return `Equipment ${s("equipment")} used on step ${s("stepNo")}`;
    case "production.yield_record.recorded":
    case "production.yield_record.corrected":
      return `Yield recorded: ${s("actualUnits")} pcs, ${fmtQty(s("yieldPct"), "%", 2)}`;
    case "production.batch.submitted":
    case "production.batch.completed":
      return `Posted to quarantine: ${s("actualUnits")} pcs, yield ${s("yieldPct") ? fmtQty(s("yieldPct"), "%", 2) : "—"}, output lot ${s("outputLot")} at ${s("location")}`;
    case "quality.disposition.released":
      return "QA released the batch";
    case "quality.disposition.rejected":
      return "QA rejected the batch";
    default:
      return a.action;
  }
}

function SignLine({ step }: { step: ExecStep }) {
  const r = step.record;
  if (!r) return null;
  return (
    <p className="text-[13px] text-fg-2">
      Done by <b>{r.conductedBy ?? "unknown"}</b>
      {r.checkedBy ? (
        <>
          , checked by <b>{r.checkedBy}</b>
          {r.checkedAt ? ` · ${fmtDateTime(r.checkedAt)}` : ""}
        </>
      ) : r.status === "awaiting_check" ? (
        <> · waiting for the checker</>
      ) : null}
      {r.exceptionApprovedBy && (
        <span className="block text-[var(--warn-fg)]">
          Exception approved by {r.exceptionApprovedBy}: {r.exceptionReason}
        </span>
      )}
      {r.notes && <span className="block">Notes: {r.notes}</span>}
    </p>
  );
}

function StepSummary({ step }: { step: ExecStep }) {
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      {step.checklist.length > 0 && (
        <ul className="flex flex-col gap-1">
          {step.checklist.map((c) => (
            <li key={c.id}>
              {c.itemNo}. {c.text}: <b>{c.answer ? c.answer.toUpperCase() : "—"}</b>
              {c.note ? ` (${c.note})` : ""}
            </li>
          ))}
        </ul>
      )}
      {step.parameters.length > 0 && (
        <ul className="flex flex-col gap-1">
          {step.parameters.map((p) => (
            <li key={p.id}>
              {p.name}: <b>{p.reading ? `${p.reading.value}${p.uom ? ` ${p.uom}` : ""}` : "—"}</b> <span className="text-muted">(limits {p.limits})</span>
              {p.reading && !p.reading.isWithinLimits && <Chip tone="bad">Outside limits</Chip>}
              {p.corrections > 0 && <span className="text-muted"> · corrected {p.corrections}×</span>}
            </li>
          ))}
        </ul>
      )}
      {step.equipmentUses.length > 0 && (
        <p>
          Equipment:{" "}
          {step.equipmentUses.map((u) => `${u.code}${u.reasons.length ? ` (${u.reasons.join(", ")})` : ""}${u.override ? " under override" : ""}`).join(", ")}
        </p>
      )}
      {step.packaging.length > 0 && <PackagingTable step={step} />}
    </div>
  );
}

function PackagingTable({ step }: { step: ExecStep }) {
  return (
    <ul className="flex flex-col gap-2">
      {step.packaging.map((p) => (
        <li key={p.id} className="rounded-[10px] border border-line p-2.5">
          <p className="font-medium">
            {p.materialName} · lot <span className="font-mono">{p.lotNumber}</span> · {p.locationCode}
          </p>
          <p className="tabular text-fg-2">
            Issued {fmtQty(p.issued, p.uom, 0)} · used {p.used ? fmtQty(p.used, "", 0) : "—"} · damaged {p.damaged ? fmtQty(p.damaged, "", 0) : "—"} · returned {p.returned ? fmtQty(p.returned, "", 0) : "—"} · variance{" "}
            {p.variance !== null ? fmtQty(p.variance, "", 0) : "—"}{" "}
            {p.counted && (p.within ? <Chip tone="ok">Reconciled</Chip> : <Chip tone="bad">Mismatch</Chip>)}
            {p.recount && <span className="text-muted"> · recount</span>}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default async function BatchWorkspace({ params, searchParams }: Params) {
  const { batchId } = await params;
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Forbidden what="production batches" />;
  const notFound = (
    <EmptyState title="Batch not found" action={<LinkButton href="/production" variant="secondary">Back to batches</LinkButton>}>
      It does not exist or belongs to a site you are not assigned to.
    </EmptyState>
  );
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return notFound;

  let rec: BatchRecord;
  let ex: BatchExecution;
  try {
    [rec, ex] = await Promise.all([getBatchRecord(ctx, batchId), getBatchExecution(ctx, batchId)]);
  } catch (e) {
    if (e instanceof DomainError && (e.code === "not_found" || e.code === "forbidden")) return notFound;
    throw e;
  }
  const { batch, product, snapshot } = rec;
  const running = batch.status === "in_process" || batch.status === "materials_staged";
  const viewNo = sp.step && /^\d+$/.test(sp.step) ? Number(sp.step) : (ex.currentStepNo ?? ex.steps.at(-1)?.stepNo ?? 1);
  const step = ex.steps.find((s) => s.stepNo === viewNo) ?? ex.steps[0];
  const total = ex.steps.length;
  const site = ctx.allowedSites.find((s) => s.id === batch.siteId);
  const canPerform = step ? ctx.can(performPermission(step.stepKind)) || (isWeighingStep(step.stepKind) && ctx.can("production.process_step_record.create")) : false;
  const canCheckStep = step ? ctx.can(checkPermission(step.stepKind)) : false;
  const working = !!step && running && step.isCurrent && (step.status === "pending" || step.status === "in_progress") && canPerform;
  const key = () => uuidv7();

  // Data only the active step screen needs.
  const needs = (k: string) => working && step.stepKind === k;
  const [checkers, approvers, scales, mixers, pkgLots, quarantine, fefo, yieldApprovers]: [Person[], Person[], ScaleOpt[], ScaleOpt[], Awaited<ReturnType<typeof packagingLotOptions>>, Awaited<ReturnType<typeof quarantineLocations>>, Awaited<ReturnType<typeof usableLotsForBatch>>, Person[]] = await Promise.all([
    running && step ? signerOptions(ctx, batch.siteId, step.stepKind === "dispensing" ? "production.dispense_record.approve" : step.stepKind === "transfer" ? "production.process_step_record.approve" : checkPermission(step.stepKind)) : Promise.resolve([]),
    running ? signerOptions(ctx, batch.siteId, "production.over_tolerance_dispense.approve") : Promise.resolve([]),
    working && isWeighingStep(step.stepKind) ? equipmentOptions(ctx, batch.siteId, step.equipmentKind ?? "scale") : Promise.resolve([]),
    working && step.requiresEquipment && !isWeighingStep(step.stepKind) ? equipmentOptions(ctx, batch.siteId, step.equipmentKind ?? null) : Promise.resolve([]),
    needs("packaging") || needs("filling") ? packagingLotOptions(ctx, batch.siteId) : Promise.resolve([]),
    ex.readyForTransfer ? quarantineLocations(ctx, batch.siteId) : Promise.resolve([]),
    working && isWeighingStep(step.stepKind) ? usableLotsForBatch(ctx, batch.id) : Promise.resolve({}),
    ex.readyForTransfer ? signerOptions(ctx, batch.siteId, "production.process_step_record.approve") : Promise.resolve([]),
  ]);

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
  const exceptionable = step?.blockers.some((b) => b.exceptionable) ?? false;
  const ingById = new Map(rec.ingredients.map((i) => [i.id, i]));

  const requirePassword = await getSetting(db, ctx.organizationId, "production.sign_off.require_password");
  return (
    <SignOffProvider requirePassword={requirePassword}>
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/production" className="text-[13px] text-primary-text hover:underline">
          ← Batches
        </Link>
        <PageHeader
          title={batch.batchNumber}
          subtitle={
            <span className="flex flex-wrap items-center gap-2">
              <StatusChip status={batch.status} label={STATE_LABEL[batch.status]} />
              <span>
                {[product.name, site?.name, progressLabel(batch.status, ex.stepsCompleted, total)].filter(Boolean).join(" · ")}
              </span>
            </span>
          }
          actions={
            <>
              <Help screen="production.weighing" label="Help: weighing" text="Help: weighing" />
              <Help screen="production.line_clearance" label="Help: line clearance" text="Help: line clearance" />
              <LinkButton href={`/print/bmr/${batch.id}`} variant="secondary" target="_blank">
                Print batch record
              </LinkButton>
              <LinkButton href={`/production/${batch.id}/closure`} variant="secondary">
                Close the batch and paper pages
              </LinkButton>
              {batch.status === "planned" && !batch.workOrderId && ctx.can("production.batch.edit") && <StartBatchForm batchId={batch.id} />}
              {batch.status === "planned" && batch.workOrderId && (
                <LinkButton href={`/production/staging/${batch.id}`} variant="cta">
                  Stage materials
                </LinkButton>
              )}
            </>
          }
        />
      </div>

      {batch.status === "planned" && (
        <Banner tone="info" title="Planned, not started">
          {batch.workOrderId
            ? "The warehouse stages the reserved lots by scan; the batch is ready when every ingredient is at the staging location."
            : ctx.can("production.batch.edit")
              ? "Confirm the materials when they are at the weighing area, then sign the line clearance."
              : "An operator confirms the materials when they are at the weighing area."}
        </Banner>
      )}
      {batch.status === "materials_staged" && <Banner tone="info" title="Materials ready">Sign the weighing-area line clearance (step 1) to start the batch.</Banner>}
      {batch.status === "awaiting_qc" && (
        <Banner tone="appr" title="Waiting for quality approval">
          Output lot {rec.outputLot?.lotNumber} ({fmtQty(batch.actualUnits, "pcs", 0)}) is in the hold area. Quality reviews the record and approves or rejects the batch.
        </Banner>
      )}
      {batch.status === "released" && <Banner tone="ok" title="Approved by quality">The output lot may be used for sales orders.</Banner>}
      {batch.status === "rejected" && <Banner tone="rej" title="Rejected by quality">The output lot is blocked. Follow the rejected-goods procedure.</Banner>}

      <nav aria-label="Batch steps">
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {ex.steps.map((s) => {
            const st = stepChip(s, ex.currentStepNo ?? null, running);
            return (
              <li key={s.stepNo} className="min-w-0">
                <Link
                  href={`/production/${batch.id}?step=${s.stepNo}`}
                  data-testid={`stepper-${s.stepNo}`}
                  aria-current={s.stepNo === step?.stepNo ? "step" : undefined}
                  className={cx(
                    "flex h-full min-h-[44px] items-center gap-2 rounded-[14px] border px-3 py-2 text-[13px] leading-snug",
                    s.stepNo === step?.stepNo ? "border-primary bg-[var(--green-50)] font-semibold" : "border-line bg-surface",
                  )}
                >
                  <span className="tabular">{s.stepNo}</span>
                  <span className="min-w-0 flex-1 break-words">{s.name}</span>
                  <Chip tone={st.tone}>{st.label}</Chip>
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          {step && (
            <Card data-testid={`step-panel-${step.stepNo}`}>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                Step {step.stepNo} of {total}
                {step.area ? ` · ${step.area} area` : ""}
              </p>
              <h2 className="text-[20px] font-semibold text-fg">{step.name}</h2>
              {step.instruction && <p className="mt-1 text-[14px] text-fg-2">{step.instruction}</p>}
              {step.workInstruction && (
                <details className="mt-2 text-[13px]">
                  <summary className="cursor-pointer text-primary-text">
                    Work instruction {step.workInstruction.code}, version {step.workInstruction.revisionNo} (as when the batch started)
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded-[10px] bg-surface-2 p-3 font-sans">{step.workInstruction.bodyMarkdown}</pre>
                </details>
              )}
              <div className="mt-3 flex flex-col gap-3">
                <SignLine step={step} />
                {step.record?.earliestCompletionAt && step.status !== "completed" && (
                  <Banner tone="info" title={`Minimum hold until ${fmtDateTime(step.record.earliestCompletionAt)}`}>
                    {step.minDurationMinutes} min minimum from the routing; ending earlier needs a QA exception.
                  </Banner>
                )}
                {step.record?.blockedReason && step.status !== "completed" && <Banner tone="warn" title="Blocked">{step.record.blockedReason}</Banner>}
                {step.isCurrent && step.blockers.length > 0 && step.status !== "awaiting_check" && step.status !== "pending" && (
                  <div className="rounded-[12px] border border-line bg-surface-2/60 p-3 text-[13px]">
                    <p className="font-semibold">Before this step can be signed off:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {step.blockers.map((b, i) => (
                        <li key={i}>{b.message}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {step.status === "awaiting_check" && (
                  <div className="flex flex-wrap gap-2">
                    {canCheckStep && step.record?.conductedById !== ctx.userId ? (
                      <>
                        <OneTap kind="checkStep" hidden={{ batchId: batch.id, stepNo: step.stepNo, idempotencyKey: key() }} label={`Check and sign step ${step.stepNo}`} />
                        <ReasonForm kind="return" hidden={{ batchId: batch.id, stepNo: String(step.stepNo) }} label="Return to operator" reasonLabel="What must be corrected?" />
                      </>
                    ) : (
                      <p className="text-[13px] text-muted">Waiting for a checker (another person) to sign from their own device, or on this device.</p>
                    )}
                  </div>
                )}

                {!running && step.status !== "completed" && batch.status !== "planned" && <p className="text-[13px] text-muted">The batch is {(STATE_LABEL[batch.status] ?? batch.status).toLowerCase()}; steps cannot be worked on.</p>}
                {running && !step.isCurrent && step.status !== "completed" && <p className="text-[13px] text-muted">Complete the earlier steps first.</p>}
                {running && step.isCurrent && !canPerform && step.status !== "awaiting_check" && <p className="text-[13px] text-muted">Your role cannot perform this step.</p>}

                {/* Line clearance / checklist */}
                {working && step.checklist.length > 0 && (
                  <ChecklistForm batchId={batch.id} stepNo={step.stepNo} items={step.checklist} checkers={checkers} idem={key()} />
                )}

                {/* Weighing */}
                {isWeighingStep(step.stepKind) && (
                  <ol className="flex flex-col gap-3">
                    {ex.ingredients.map((ing, i) => {
                      const r = ingById.get(ing.id);
                      const lastVoided = [...ing.weighings].reverse().find((w) => w.voided && !ing.weighings.some((x) => x.supersedesId === w.id));
                      const open = ing.status === "pending" || ing.status === "partial";
                      const rec0 = fefo[r?.materialId ?? ""]?.[0];
                      return (
                        <li key={ing.id} className="rounded-[14px] border border-line bg-surface p-3.5" data-testid={`ingredient-${ing.lineNo}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                                Ingredient {i + 1} of {ex.ingredients.length} · {ing.materialCode}
                              </p>
                              <p className="text-[16px] font-semibold">{ing.materialName}</p>
                              <p className="text-[13px] tabular text-fg-2">
                                Target {fmtQty(ing.theoreticalQtyG, "g", 1)} · range {r ? `${fmtQty(r.minG, "", 1)}–${fmtQty(r.maxG, "g", 1)}` : "—"} · weighed {D(ing.dispensedQtyG).gt(0) ? fmtQty(ing.dispensedQtyG, "g", 1) : "—"}
                              </p>
                            </div>
                            <StatusChip status={ing.status} label={LINE_STATUS[ing.status] ?? ing.status} />
                          </div>
                          {ing.weighings.length > 0 && (
                            <ul className="mt-2 flex flex-col gap-2 text-[13px]">
                              {ing.weighings.map((w) => (
                                <li key={w.id} className={cx("rounded-[10px] border px-3 py-2", w.voided ? "border-line text-muted line-through" : w.within ? "border-line bg-surface-2/60" : "border-[var(--warn-bd)] bg-[var(--warn-bg)]")}>
                                  #{w.sequence} · {fmtQty(w.qtyG, "g", 1)}
                                  {w.entered && w.entered !== `${D(w.qtyG).toString()} g` ? ` (entered ${w.entered})` : ""} · lot {w.lotNumber} · {w.locationCode} · {w.scale ?? "no scale"} · by {w.operator}
                                  {w.partial ? " · part" : ""} · {w.checker ? `checked by ${w.checker}` : "not checked yet"}
                                  {w.exceptionApprovedBy && <span className="block">Exception approved by {w.exceptionApprovedBy}: {w.exceptionReason}</span>}
                                  {w.voided && <span className="block no-underline">Voided by {w.voidedBy}: {w.voidReason}</span>}
                                  {!w.voided && running && (
                                    <div className="mt-2 flex flex-wrap gap-2 no-underline">
                                      {!w.checker && ctx.can("production.dispense_record.approve") && w.operatorId !== ctx.userId && (
                                        <OneTap kind="checkDispense" hidden={{ batchId: batch.id, dispenseRecordId: w.id, idempotencyKey: key() }} label="Check this weighing" variant="secondary" />
                                      )}
                                      {ctx.can("production.dispense_record.void") && step.status === "in_progress" && (
                                        <ReasonForm kind="void" hidden={{ batchId: batch.id, dispenseRecordId: w.id }} label="Void" reasonLabel="Why is this weighing void?" />
                                      )}
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                          {working && open && r && (
                            <details className="mt-3">
                              <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-center rounded-full bg-primary px-4 text-[15px] font-semibold text-white sm:inline-flex">
                                Weigh {ing.materialName}
                              </summary>
                              <WeighForm
                                batchId={batch.id}
                                ing={{ id: ing.id, lineNo: ing.lineNo, materialCode: ing.materialCode, materialName: ing.materialName, inciName: r.inciName, theoreticalQtyG: ing.theoreticalQtyG, tolerancePct: r.tolerancePct, minG: r.minG, maxG: r.maxG, dispensedQtyG: ing.dispensedQtyG, status: ing.status, recommended: rec0 ? `${rec0.lotNumber} at ${rec0.locationCode}, exp ${fmtDate(rec0.expiresOn)}` : null }}
                                scales={scales}
                                checkers={checkers}
                                approvers={approvers}
                                idem={key()}
                                replaces={lastVoided && ing.status === "pending" ? { id: lastVoided.id } : null}
                                needsChecker={(batch.formulaSnapshot as { lines?: { lineNo: number; requiresChecker?: boolean }[] }).lines?.find((x) => x.lineNo === ing.lineNo)?.requiresChecker !== false}
                                lots={(fefo[r?.materialId ?? ""] ?? []).map((l) => ({ lotNumber: l.lotNumber, locationCode: l.locationCode, locationName: l.locationName, qty: l.qty, expiresOn: l.expiresOn }))}
                              />
                            </details>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}

                {/* Process readings and equipment */}
                {working && step.requiresEquipment && !isWeighingStep(step.stepKind) && <EquipmentForm batchId={batch.id} stepNo={step.stepNo} kind={step.equipmentKind ?? null} options={mixers} />}
                {step.equipmentUses.length > 0 && !isWeighingStep(step.stepKind) && (
                  <p className="text-[13px] text-fg-2">
                    Equipment: {step.equipmentUses.map((u) => `${u.code}${u.reasons.length ? ` (recorded warnings: ${u.reasons.join(", ")})` : ""}${u.override ? " under approved override" : ""}`).join(", ")}
                  </p>
                )}
                {working && step.status === "pending" && step.minDurationMinutes && (
                  <OneTap kind="startStep" hidden={{ batchId: batch.id, stepNo: step.stepNo }} label="Start the hold timer" />
                )}
                {working && step.parameters.map((p) => <ReadingForm key={p.id} batchId={batch.id} stepNo={step.stepNo} p={p} idem={key()} />)}

                {/* Packaging */}
                {(step.stepKind === "packaging" || step.stepKind === "filling") && (
                  <>
                    {step.packaging.length > 0 && <PackagingTable step={step} />}
                    {working && (
                      <>
                        <PackagingIssueForm batchId={batch.id} stepNo={step.stepNo} suggestions={pkgLots.slice(0, 4).map((l) => `${l.lotNumber} (${l.materialName}, ${fmtQty(l.qty, l.uom, 0)} at ${l.locationCode})`)} idem={key()} />
                        {step.packaging.map((p) => (
                          <div key={p.id} className="rounded-[12px] border border-line p-3">
                            <p className="mb-2 text-[13px] font-medium">
                              Count {p.materialName} · lot {p.lotNumber} (issued {fmtQty(p.issued, p.uom, 0)})
                            </p>
                            <PackagingCountForm batchId={batch.id} row={{ id: p.id, materialName: p.materialName, lotNumber: p.lotNumber, issued: p.issued, uom: p.uom, counted: p.counted }} />
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}

                {working && exceptionable && <ExceptionForm batchId={batch.id} stepNo={step.stepNo} approvers={approvers} />}

                {working && step.stepKind !== "transfer" && step.checklist.length === 0 && (
                  <CompleteStepForm batchId={batch.id} stepNo={step.stepNo} stepKind={step.stepKind} requiresChecker={step.requiresChecker} checkers={checkers} idem={key()} disabledReason={step.blockers.length ? "Resolve the items above first; the server re-checks when you submit." : null} />
                )}

                {step.stepKind === "transfer" && step.status !== "completed" && <p className="text-[13px] text-fg-2">Record the yield below, then move the batch to the hold area with the checker.</p>}
                {step.status === "completed" && <StepSummary step={step} />}
              </div>
            </Card>
          )}

          {(ex.readyForTransfer || ex.yieldRecord || ex.outputs.length > 0) && (
            <Card data-testid="yield-transfer">
              <CardTitle>Yield and move to the hold area</CardTitle>
              {ex.yieldRecord && (
                <div className={cx("mb-3 rounded-[12px] border p-3 text-[13px]", ex.yieldRecord.isWithinLimits ? "border-line" : "border-[var(--warn-bd)] bg-[var(--warn-bg)]")}>
                  <p className="tabular">
                    <b>{fmtQty(ex.yieldRecord.actualUnits, "pcs", 0)}</b> · {fmtMass(ex.yieldRecord.actualBase)} of {fmtMass(ex.yieldRecord.theoreticalBase)} theoretical · yield{" "}
                    <b>{fmtQty(ex.yieldRecord.yieldPct, "%", 2)}</b> (range {D(ex.yieldRecord.minPct).toString()}–{D(ex.yieldRecord.maxPct).toString()} %)
                  </p>
                  <p className="text-fg-2">Recorded by {ex.yieldRecord.recordedByName} · {fmtDateTime(ex.yieldRecord.recordedAt)}</p>
                  {!ex.yieldRecord.isWithinLimits &&
                    (ex.yieldRecord.approvedBy ? (
                      <p>Approved by {ex.yieldRecord.approvedByName}: {ex.yieldRecord.approvalReason}</p>
                    ) : ctx.can("production.yield_record.approve") && ex.yieldRecord.recordedBy !== ctx.userId && running ? (
                      <ReasonForm kind="approveYield" hidden={{ batchId: batch.id, yieldRecordId: ex.yieldRecord.id }} label="Approve yield (opens a deviation)" reasonLabel="Assessment and decision" />
                    ) : (
                      <p>Outside the range: a site manager or QA (not the recorder) must approve it with a deviation.</p>
                    ))}
                </div>
              )}
              {running && ex.readyForTransfer && ctx.can("production.yield_record.create") && (
                <YieldForm batchId={batch.id} unitNetMassG={product.unitNetMassG} theoreticalG={batch.theoreticalYieldG ?? "0"} range={ex.yieldLimits} hasCurrent={!!ex.yieldRecord} idem={key()} />
              )}
              <div className="mt-4 flex flex-col gap-3">
                <p className="text-[13px] font-semibold">Scrap and rework</p>
                {ex.scrap.length === 0 ? (
                  <p className="text-[13px] text-muted">None recorded.</p>
                ) : (
                  <ul className="flex flex-col gap-2 text-[13px]">
                    {ex.scrap.map((s) => (
                      <li key={s.id} className="rounded-[10px] border border-line p-2.5">
                        {s.recordKind === "scrap" ? "Scrap" : "Rework"} {fmtQty(s.qty, s.uom, 0)} · {s.reasonLabel}
                        {s.note ? ` · ${s.note}` : ""} · {s.recordedByName} · <b>{s.status}</b>
                        {s.requiresApproval && s.status === "recorded" && (ctx.can("production.scrap_rework_record.approve") && s.recordedBy !== ctx.userId ? <DecideScrapForm batchId={batch.id} id={s.id} /> : <span className="block text-[var(--warn-fg)]">Needs approval by a site manager or QA.</span>)}
                      </li>
                    ))}
                  </ul>
                )}
                {running && ex.readyForTransfer && ctx.can("production.scrap_rework_record.create") && <ScrapForm batchId={batch.id} reasonCodes={ex.reasonCodes} idem={key()} />}
              </div>
              <div className="mt-4 flex flex-col gap-3">
                <p className="text-[13px] font-semibold">Move to the hold area until quality approves</p>
                {ex.outputs.map((o) => (
                  <p key={o.id} className="text-[13px]">
                    Output lot <span className="font-mono">{o.lotNumber}</span> · {fmtQty(o.qtyBase, o.baseUom, 0)} · {o.locationCode} · expires {fmtDate(o.expiresOn)} {o.qualityStatus && <StatusChip status={o.qualityStatus} />}
                  </p>
                ))}
                {running && ex.readyForTransfer && (
                  <>
                    {ex.transferBlockers.length > 0 ? (
                      <ul className="list-disc pl-5 text-[13px] text-[var(--warn-fg)]">
                        {ex.transferBlockers.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    ) : ctx.can("production.batch.post") ? (
                      <TransferForm batchId={batch.id} checkers={yieldApprovers} quarantine={quarantine} idem={key()} />
                    ) : (
                      <p className="text-[13px] text-muted">Your role cannot post the batch.</p>
                    )}
                  </>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <Dl
              items={[
                ["Product", `${product.name} (${product.skuCode})`],
                ["Formula", `${snapshot.formulaCode}, version ${snapshot.revisionNo}${snapshot.routing ? ` · steps ${snapshot.routing.routingCode}, version ${snapshot.routing.revisionNo}` : ""}`],
                ["Planned size", `${fmtQty(D(batch.plannedSizeG).div(1000), "kg", 2)}`],
                ["Started", fmtDateTime(batch.startedAt)],
                ["Theoretical yield", fmtMass(batch.theoreticalYieldG)],
                ["Stock updates", ex.postings.consumption || ex.postings.output ? `${ex.postings.consumption ?? 0} materials used · ${ex.postings.output ?? 0} finished goods` : ex.postAtDispense ? "At each weighing" : "When the batch moves to the hold area"],
              ]}
            />
          </Card>
          <Card>
            <CardTitle>Quality</CardTitle>
            {lastDisposition ? (
              <p className="flex items-center gap-2 text-[13px]">
                <StatusChip status={lastDisposition.toStatus} /> {lastDisposition.decidedByName} · {fmtDateTime(lastDisposition.decidedAt)}
              </p>
            ) : (
              <p className="text-[13px] text-muted">{batch.status === "awaiting_qc" ? "Waiting for quality approval." : "No quality decision yet."}</p>
            )}
            {rec.tests.length > 0 && (
              <ul className="mt-2 flex flex-col divide-y divide-line text-[13px]">
                {rec.tests.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      {t.testName}: {t.result}
                    </span>
                    <Chip tone={t.passed ? "ok" : "bad"}>{t.passed ? "Pass" : "Fail"}</Chip>
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
              <ol className="flex max-h-[520px] flex-col gap-3 overflow-y-auto text-[13px]">
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
                  <Td>{r.isWithinTolerance ? <Chip tone="ok">{r.isPartial ? "Part" : "Within"}</Chip> : <Chip tone="warn">Exception</Chip>}</Td>
                  <Td className="whitespace-nowrap">{r.operator}</Td>
                  <Td className="whitespace-nowrap">{r.checker ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{r.scaleCode ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(r.recordedAt)}</Td>
                </tr>
              )),
            )}
          </Table>
        </Card>
      )}
    </div>
    </SignOffProvider>
  );
}

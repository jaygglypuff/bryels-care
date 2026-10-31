import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { D, fmtDate, fmtDateTime, fmtMass, fmtQty } from "@/lib/qty";
import {
  type BatchExecution,
  type BatchFlowFacts,
  type BatchRecord,
  type ExecStep,
  type NextScreen,
  checkPermission,
  getBatchExecution,
  getBatchFlowFacts,
  getBatchRecord,
  isWeighingStep,
  nextBatchScreen,
  performPermission,
  progressLabel,
  waitingWords,
} from "@/modules/production";
import { Card, CardTitle, Dl, EmptyState, LinkButton, PageHeader, Table, Td, cx } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { DecideScrapForm, ReasonForm } from "./exec-forms";
import { registerAppHooks } from "@/modules/wiring";
import { whoCanDo } from "@/modules/identity";
import { Explain, NextStep, PageIntro } from "@/ui/guide";

// Execution ↔ QA hooks (idempotent; also registered at server start in src/instrumentation.ts).
registerAppHooks();

export const metadata: Metadata = { title: "Batch record" };

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
      return `Weighed ${s("materialName") || s("material")} ${fmtQty(s("actualQtyG"), "g", 1)} from lot ${s("lot")}${after.withinTolerance === false ? " (outside allowed difference, exception)" : ""}${after.partial ? " (part)" : ""}`;
    case "production.dispense_record.checked":
      return `Weighing of ${s("material")} checked`;
    case "production.dispense_record.voided":
      return "Weighing voided";
    case "production.dispense_record.over_tolerance_approved":
      return `Weight of ${s("material")} outside the allowed difference approved (CX-TOL)`;
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
      return `Value ${s("parameter")} = ${s("value")}${s("uom") ? ` ${s("uom")}` : ""}${after.isWithinLimits === false ? " (outside limits)" : ""}`;
    case "production.equipment_use.created":
      return `Equipment ${s("equipment")} used on step ${s("stepNo")}`;
    case "production.yield_record.recorded":
    case "production.yield_record.corrected":
      return `Pieces made recorded: ${s("actualUnits")} pcs, ${fmtQty(s("yieldPct"), "%", 2)} of expected`;
    case "production.batch.submitted":
    case "production.batch.completed":
      return `Posted to the hold area: ${s("actualUnits")} pcs, ${s("yieldPct") ? fmtQty(s("yieldPct"), "%", 2) : "—"}, output lot ${s("outputLot")} at ${s("location")}`;
    case "quality.disposition.released":
      return "QA released the batch";
    case "quality.disposition.rejected":
      return "QA rejected the batch";
    case "production.batch.finished":
      return "Batch finished";
    case "production.batch.label_lot_fixed":
      return `Product labels: lot ${s("lotNumber")}, expiry ${s("expiresOn")}`;
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
/** The permission that lets a person act on the batch's next screen (what "Continue" opens). */
function permissionFor(next: NextScreen, step: BatchFlowFacts["currentStep"]): Permission[] {
  switch (next.action) {
    case "get_materials":
      return ["production.batch.edit", "inventory.movement.post"];
    case "start":
      return step?.status === "awaiting_check" ? [checkPermission(step.kind)] : ["production.line_clearance.create"];
    case "weigh":
      return ["production.dispense_record.create", "production.dispense_record.approve"];
    case "step":
      return step ? (step.status === "awaiting_check" ? [checkPermission(step.kind)] : [performPermission(step.kind)]) : ["production.process_step_record.create"];
    case "wait":
      return ["production.process_step_record.create"];
    case "finish":
      return ["production.batch.post"];
    case "quality_check":
      return ["quality.disposition.approve"];
    default:
      return [];
  }
}

/**
 * The batch record (read-only, one path for production work 2026-10-31): what happened in a batch —
 * steps with who did and checked them, readings, equipment, materials weighed, packaging, labels,
 * output, rejects, quality and the timeline. For QA and managers ("See the full batch record"). Nothing
 * is done here: while the batch is being made, a person who can act sees one big "Continue this batch"
 * button that opens the production screen for the next thing to do. The only actions left are the
 * approvals of older yield and reject records (made before Finish existed), which have no other screen.
 */
export default async function BatchRecordPage({ params }: Params) {
  const { batchId } = await params;
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Forbidden what="production batches" />;
  const notFound = (
    <EmptyState title="Batch not found" action={<LinkButton href="/production" variant="secondary">Back to batch records</LinkButton>}>
      It does not exist or belongs to a site you are not assigned to.
    </EmptyState>
  );
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return notFound;

  let rec: BatchRecord;
  let ex: BatchExecution;
  let facts: BatchFlowFacts;
  try {
    [rec, ex, facts] = await Promise.all([getBatchRecord(ctx, batchId), getBatchExecution(ctx, batchId), getBatchFlowFacts(ctx, db, batchId)]);
  } catch (e) {
    if (e instanceof DomainError && (e.code === "not_found" || e.code === "forbidden")) return notFound;
    throw e;
  }
  const { batch, product, snapshot } = rec;
  const total = ex.steps.length;
  const site = ctx.allowedSites.find((s) => s.id === batch.siteId);
  const next = nextBatchScreen(facts, new Date(), ex.steps);
  const perms = permissionFor(next, facts.currentStep);
  const canAct = !!next.href && perms.some((p) => ctx.can(p) && ctx.canAt(p, batch.siteId));
  const whoActs = next.href && !canAct && perms[0] ? waitingWords(await whoCanDo(ctx, perms[0], batch.siteId)) : null;
  const beingMade = ["planned", "materials_staged", "in_process", "rework_approved"].includes(batch.status);

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
  const pendingYield = ex.yieldRecord && !ex.yieldRecord.isWithinLimits && !ex.yieldRecord.approvedBy ? ex.yieldRecord : null;
  const pendingScrap = ex.scrap.filter((s) => s.requiresApproval && s.status === "recorded");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/production" className="inline-flex min-h-[44px] items-center text-[14px] text-primary-text hover:underline">
          ← Batch records
        </Link>
        <PageHeader
          title={`Batch record ${batch.batchNumber}`}
          subtitle={
            <span className="flex flex-wrap items-center gap-2">
              <StatusChip status={batch.status} label={STATE_LABEL[batch.status]} />
              <span>{[product.name, site?.name, progressLabel(batch.status, ex.stepsCompleted, total)].filter(Boolean).join(" · ")}</span>
            </span>
          }
          actions={
            <details className="relative" data-testid="batch-more-menu">
              <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1 rounded-full border border-line bg-surface px-4 text-[14px] font-medium text-fg hover:bg-surface-2 [&::-webkit-details-marker]:hidden" aria-label="More actions">
                <span aria-hidden>⋯</span> More
              </summary>
              <div className="absolute right-0 z-20 mt-1.5 flex w-[min(280px,calc(100vw-2rem))] flex-col gap-1.5 rounded-[14px] border border-line bg-surface p-2 shadow-[0_8px_24px_rgba(28,27,24,.14)]">
                <LinkButton href={`/print/bmr/${batch.id}`} variant="secondary" target="_blank">
                  Print batch record
                </LinkButton>
                {(ctx.can("production.batch.approve") || ctx.can("production.batch.admin") || ctx.can("quality.disposition.approve")) && (
                  <LinkButton href={`/production/${batch.id}/closure`} variant="secondary">
                    Close the batch and paper pages
                  </LinkButton>
                )}
                {batch.workOrderId && (
                  <LinkButton href={`/production/orders/${batch.workOrderId}`} variant="secondary">
                    Open the production order
                  </LinkButton>
                )}
              </div>
            </details>
          }
        />
        <PageIntro>What happened in this batch: every step, who did and checked it, the numbers written, the materials weighed, wrappers, labels and the result. The work itself is done on the production screens.</PageIntro>
        <div className="-mt-2 mb-3">
          <Explain term="batch_record" />
        </div>
      </div>

      {next.href && canAct ? (
        <NextStep
          text={beingMade ? `This batch is being made. Next: ${next.label}.` : `Next: ${next.label}.`}
          action={{ label: beingMade ? `Continue this batch → ${next.label}` : next.label, href: next.href }}
        />
      ) : next.href && whoActs ? (
        <NextStep text={beingMade ? `This batch is being made. Next: ${next.label}.` : `Next: ${next.label}.`} waitingFor={`${whoActs} can do this.`} />
      ) : null}
      {next.disabledReason && <p className="-mt-2 text-[14px] text-muted">{next.disabledReason}</p>}

      {batch.status === "awaiting_qc" && (
        <Banner tone="appr" title="Waiting for the quality check">
          Output lot {rec.outputLot?.lotNumber} ({fmtQty(batch.actualUnits, "pcs", 0)}) is in the hold area. QA checks the record and passes or fails the batch.
        </Banner>
      )}
      {batch.status === "released" && <Banner tone="ok" title="Passed the quality check">The finished lot may be sold.</Banner>}
      {batch.status === "rejected" && <Banner tone="rej" title="Failed the quality check">The finished lot is blocked. Follow the rejected-goods procedure.</Banner>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <section aria-label="Steps" className="flex flex-col gap-2" data-testid="record-steps">
            <h2 className="text-[17px] font-semibold text-fg">Steps</h2>
            {ex.steps.map((s) => {
              const st = stepChip(s, ex.currentStepNo ?? null, beingMade);
              return (
                <details key={s.stepNo} className="rounded-[16px] border border-line bg-surface px-4 py-1" open={s.isCurrent && beingMade ? true : undefined} data-testid={`record-step-${s.stepNo}`}>
                  <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-2 py-2 text-[15px] [&::-webkit-details-marker]:hidden">
                    <span className="tabular text-muted">{s.stepNo}</span>
                    <span className="min-w-0 flex-1 break-words font-medium text-fg">{s.name}</span>
                    <Chip tone={st.tone}>{st.label}</Chip>
                  </summary>
                  <div className="flex flex-col gap-3 pb-3">
                    {s.instruction && <p className="text-[14px] text-fg-2">{s.instruction}</p>}
                    {s.workInstruction && (
                      <details className="text-[13px]">
                        <summary className="cursor-pointer text-primary-text">
                          How-to sheet {s.workInstruction.code}, version {s.workInstruction.revisionNo} (as when the batch started)
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap rounded-[10px] bg-surface-2 p-3 font-sans">{s.workInstruction.bodyMarkdown}</pre>
                      </details>
                    )}
                    <SignLine step={s} />
                    {s.record?.earliestCompletionAt && s.status !== "completed" && <p className="text-[13px] text-fg-2">Minimum wait until {fmtDateTime(s.record.earliestCompletionAt)}.</p>}
                    {s.record?.blockedReason && s.status !== "completed" && <p className="text-[13px] text-[var(--warn-fg)]">Not done yet: {s.record.blockedReason}</p>}
                    {s.status === "awaiting_check" && <p className="text-[13px] text-[var(--warn-fg)]">Waiting for the second person&apos;s check.</p>}
                    {!s.record && <p className="text-[13px] text-muted">Not started.</p>}
                    {s.record && <StepSummary step={s} />}
                    {isWeighingStep(s.stepKind) && <WeighingList ex={ex} />}
                  </div>
                </details>
              );
            })}
          </section>

          {(ex.yieldRecord || ex.outputs.length > 0 || ex.scrap.length > 0) && (
            <Card data-testid="record-output">
              <CardTitle>Pieces made, rejects and the hold area</CardTitle>
              {ex.yieldRecord && (
                <div className={cx("mb-3 rounded-[12px] border p-3 text-[13px]", ex.yieldRecord.isWithinLimits ? "border-line" : "border-[var(--warn-bd)] bg-[var(--warn-bg)]")}>
                  <p className="tabular">
                    <b>{fmtQty(ex.yieldRecord.actualUnits, "pcs", 0)}</b> · {fmtMass(ex.yieldRecord.actualBase)} of {fmtMass(ex.yieldRecord.theoreticalBase)} expected · <b>{fmtQty(ex.yieldRecord.yieldPct, "%", 2)}</b> of the expected amount (OK {D(ex.yieldRecord.minPct).toString()}–{D(ex.yieldRecord.maxPct).toString()} %)
                  </p>
                  <p className="text-fg-2">Recorded by {ex.yieldRecord.recordedByName} · {fmtDateTime(ex.yieldRecord.recordedAt)}</p>
                  {ex.yieldRecord.approvedBy && <p>Approved by {ex.yieldRecord.approvedByName}: {ex.yieldRecord.approvalReason}</p>}
                </div>
              )}
              <p className="text-[13px] font-semibold">Rejects</p>
              {ex.scrap.length === 0 ? (
                <p className="text-[13px] text-muted">None recorded.</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-2 text-[13px]">
                  {ex.scrap.map((s) => (
                    <li key={s.id} className="rounded-[10px] border border-line p-2.5">
                      {s.recordKind === "scrap" ? "Thrown away" : "Redo"} {fmtQty(s.qty, s.uom, 0)} · {s.reasonLabel}
                      {s.note ? ` · ${s.note}` : ""} · {s.recordedByName} · <b>{s.status}</b>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[13px] font-semibold">Finished lot</p>
              {ex.outputs.length === 0 ? (
                <p className="text-[13px] text-muted">Not finished yet.</p>
              ) : (
                ex.outputs.map((o) => (
                  <p key={o.id} className="text-[13px]">
                    Lot <span className="font-mono">{o.lotNumber}</span> · {fmtQty(o.qtyBase, o.baseUom, 0)} · {o.locationCode} · expires {fmtDate(o.expiresOn)} {o.qualityStatus && <StatusChip status={o.qualityStatus} />}
                  </p>
                ))
              )}
            </Card>
          )}

          {(pendingYield || pendingScrap.length > 0) && (
            <Card data-testid="record-approvals">
              <CardTitle>Older records waiting for a manager&apos;s approval</CardTitle>
              <p className="mb-2 text-[13px] text-fg-2">Recorded before the Finish screen existed. A site manager or QA (not the person who recorded it) decides.</p>
              {pendingYield &&
                (ctx.can("production.yield_record.approve") && pendingYield.recordedBy !== ctx.userId && beingMade ? (
                  <ReasonForm kind="approveYield" hidden={{ batchId: batch.id, yieldRecordId: pendingYield.id }} label="Approve the pieces made (opens a problem report)" reasonLabel="What you checked and decided" />
                ) : (
                  <p className="text-[13px]">Pieces made outside the range: waiting for a site manager or QA.</p>
                ))}
              {pendingScrap.map((s) => (
                <div key={s.id} className="mt-2 text-[13px]">
                  <p>
                    {fmtQty(s.qty, s.uom, 0)} {s.reasonLabel} by {s.recordedByName}
                  </p>
                  {ctx.can("production.scrap_rework_record.approve") && s.recordedBy !== ctx.userId ? <DecideScrapForm batchId={batch.id} id={s.id} /> : <p className="text-[var(--warn-fg)]">Needs approval by a site manager or QA.</p>}
                </div>
              ))}
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <details className="rounded-[24px] bg-surface p-5 shadow-[var(--shadow-card)]" data-testid="batch-details">
            <summary className="min-h-[44px] cursor-pointer py-2.5 text-[14px] font-medium">Details</summary>
            <Dl
              items={[
                ["Product", product.name],
                ["Recipe", `${snapshot.formulaName || product.name} (version ${snapshot.revisionNo})`],
                ["Planned size", `${fmtQty(D(batch.plannedSizeG).div(1000), "kg", 2)}`],
                ["Started", fmtDateTime(batch.startedAt)],
                ["Expected output", fmtMass(batch.theoreticalYieldG)],
                ["Production order", batch.workOrderId ? "Yes" : "Made without an order"],
                ["Stock updates", ex.postings.consumption || ex.postings.output ? `${ex.postings.consumption ?? 0} materials used · ${ex.postings.output ?? 0} finished goods` : ex.postAtDispense ? "At each weighing" : "When the batch moves to the hold area"],
              ]}
            />
          </details>
          <Card>
            <CardTitle>Quality</CardTitle>
            {lastDisposition ? (
              <p className="flex items-center gap-2 text-[13px]">
                <StatusChip status={lastDisposition.toStatus} /> {lastDisposition.decidedByName} · {fmtDateTime(lastDisposition.decidedAt)}
              </p>
            ) : (
              <p className="text-[13px] text-muted">{batch.status === "awaiting_qc" ? "Waiting for the quality check." : "No quality decision yet."}</p>
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
          <CardTitle>Weigh out records</CardTitle>
          <Table head={["Ingredient", "Lot", "Expiry", "Location", "Expected (g)", "Actual (g)", "Allowed difference", "Operator", "Checker", "Scale", "Time"]}>
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
  );
}


/** Weighings of every ingredient, read-only (who, lot, scale, checker, voids and approvals). */
function WeighingList({ ex }: { ex: BatchExecution }) {
  return (
    <ol className="flex flex-col gap-2">
      {ex.ingredients.map((ing) => (
        <li key={ing.id} className="rounded-[12px] border border-line bg-surface-2/40 p-3 text-[13px]" data-testid={`ingredient-${ing.lineNo}`}>
          <p className="font-medium text-fg">
            {ing.materialName} <span className="text-muted">· target {fmtQty(ing.theoreticalQtyG, "g", 1)} · {D(ing.dispensedQtyG).gt(0) ? `weighed ${fmtQty(ing.dispensedQtyG, "g", 1)}` : "not weighed yet"}</span>
          </p>
          {ing.weighings.map((w) => (
            <p key={w.id} className={w.voided ? "text-muted line-through" : "text-fg-2"}>
              {fmtQty(w.qtyG, "g", 1)} · lot {w.lotNumber} · {w.locationCode} · {w.scale ?? "no scale"} · by {w.operator} · {w.checker ? `checked by ${w.checker}` : "not checked"}
              {w.exceptionApprovedBy ? ` · approved by ${w.exceptionApprovedBy}: ${w.exceptionReason}` : ""}
              {w.voided ? ` · undone by ${w.voidedBy}: ${w.voidReason}` : ""}
            </p>
          ))}
        </li>
      ))}
    </ol>
  );
}

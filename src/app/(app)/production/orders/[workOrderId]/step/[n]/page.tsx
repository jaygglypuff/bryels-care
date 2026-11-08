import { StopForToday } from "./stop-for-today";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import Link from "next/link";
import { batchBoxInfoFor, batchRecordHref, finishHref, floorCheckNext, getFinishView, getStepCard, nextBatchScreen, type BatchBoxInfo, type StepCardView } from "@/modules/production";
import { FinishPanel } from "../../../../[batchId]/finish/finish-panel";
import { LinkButton } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Help } from "@/ui/help/help";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../../../forbidden";
import { FlowHeader, NoBatch, orderHrefOf, pickBatch } from "../../flow-shared";
import { plainWords } from "@/modules/production/plain-words";
import { PrintLabelsPanel } from "@/ui/labels/print-labels-panel";
import { printBatchLabelsPanelAction } from "../../flow-actions";
import { StepCard } from "./step-card";
import { BoxLabels } from "./box-labels";

export const metadata: Metadata = { title: "Step" };
export const dynamic = "force-dynamic";

/** S5 Step (ADR-080, UX review S5): Start check, Mix, Wait (curing / resting), Cut, Wrap. One step per screen. */
/** One plain sentence per kind of step; the step's own name comes from the approved steps (configuration). */
function plainStep(kind: string, isCheck: boolean, isWait: boolean, perPiece = false) {
  if (isCheck) return "Look at each point and answer Yes or No. All OK when everything is fine.";
  if (isWait) return "The batch rests here. Come back on the ready day.";
  // ADR-104 §2: box labels by default; a label on each piece only for products set up that way.
  if (kind === "packaging" || kind === "filling")
    return perPiece
      ? "Wrap or fill the pieces, stick a label on each piece, pack them in boxes and stick one label on each box."
      : "Wrap or fill the pieces, pack them in boxes and stick one label on each box.";
  if (kind === "dispensing" || kind === "weighing") return "Weigh out each ingredient on the Weigh screen.";
  if (kind === "transfer") return "Answer the questions about what was made and the packing left over, then tap Finish and send to QA. The batch goes to the QA waiting area.";
  return "Do this step, write the numbers it asks for, then tap Step done.";
}

export default async function StepPage({ params, searchParams }: { params: Promise<{ workOrderId: string; n: string }>; searchParams: Promise<{ batch?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Forbidden what="production steps" permission="production.batch.view" />;
  const { workOrderId, n } = await params;
  const stepNo = Number(n);
  if (!Number.isInteger(stepNo) || stepNo < 1 || stepNo > 999) notFound();
  const { batch: batchParam } = await searchParams;
  let orderHref = orderHrefOf(workOrderId);
  let v: StepCardView;
  let facts;
  let boxes: BatchBoxInfo | null = null;
  try {
    const picked = await pickBatch(ctx, workOrderId, batchParam, (f) => f.currentStep?.stepNo === stepNo);
    const batch = picked.batch;
    if (!batch) return <NoBatch orderHref={orderHref}>This order has no batch yet. Approve it first.</NoBatch>;
    orderHref = picked.backHref;
    facts = batch;
    v = await getStepCard(ctx, batch.batchId, stepNo);
    if (v.packaging) boxes = await batchBoxInfoFor(ctx, batch.batchId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const b = v.batch;
  const href = (s: number) => `/production/orders/${workOrderId}/step/${s}?batch=${b.id}`;
  const next = nextBatchScreen(facts);
  // Who checks this step next, by name and role (never the person who did it; docs/NEXT_APPROVER.md).
  const checkNext = v.step.status === "awaiting_check" ? await floorCheckNext(ctx, v.step.kind === "line_clearance" ? "start_check" : "step_check", b.id, v.step.record?.conductedById ?? null) : null;
  // Round 5 B19: the step after packing is "Move to the QA waiting area" (step 7 of 7), which holds the Finish form;
  // "Done — go to …" opens that step, it is never skipped.
  const nextHref = v.next ? (v.next.kind === "dispensing" || v.next.kind === "weighing" ? `/production/orders/${workOrderId}/weigh?batch=${b.id}` : href(v.next.stepNo)) : null;
  const finishView = v.step.isTransfer ? await getFinishView(ctx, b.id) : null;
  return (
    <div className="mx-auto max-w-5xl pb-24 text-[16px]">
      <FlowHeader
        title={plainWords(v.step.name)}
        batchNumber={b.batchNumber}
        orderHref={orderHref}
        progress={<span>Step {v.step.index} of {v.step.total}</span>}
        actions={<Help screen="production.step" />}
      />
      <PageIntro>{plainStep(v.step.kind, v.step.isCheck, v.step.isWait, boxes?.labelling === "per_piece")}</PageIntro>
      {v.blockedReason && v.step.status !== "completed" && (
        <div className="mb-4">
          <Banner tone="warn" title="Not yet" action={next.href && next.stepNo !== stepNo ? <LinkButton href={next.href} variant="secondary" size="lg">{next.label}</LinkButton> : undefined}>
            {v.blockedReason}
          </Banner>
        </div>
      )}
      {!ctx.can("production.process_step_record.create") && !ctx.can("production.line_clearance.create") && (
        <div className="mb-4">
          <Banner tone="neu" title="View only">You can see this step but not record it. Ask the production lead.</Banner>
        </div>
      )}
      <StepCard
        batchId={b.id}
        step={v.step}
        canPerform={v.canPerform}
        checkers={v.checkers}
        checkNext={checkNext}
        approvers={v.approvers}
        sameDevice={v.sameDevice}
        nextHref={nextHref}
        // Round 5 problem 10: the button says what it does, not only the next step's name.
        nextLabel={v.next ? `Done — go to ${v.next.kind === "dispensing" || v.next.kind === "weighing" ? "Weigh" : plainWords(v.next.name)}` : null}
        finishPanel={finishView ? <FinishPanel v={finishView} /> : undefined}
        quietDone={!!boxes && !boxes.plan?.printed && boxes.canPrint}
        weighHref={`/production/orders/${workOrderId}/weigh?batch=${b.id}`}
        finishHref={finishHref(b.id)}
        fullRecordHref={batchRecordHref(b.id)}
        packaging={v.packaging}
        blocked={!!v.blockedReason}
        labelsPanel={
          boxes ? (
            <div className="grid gap-3">
              {/* Round 5 problem 3: the work in order, one green button, one print trip. */}
              <ol className="grid gap-1 rounded-[16px] border border-line bg-surface p-4 text-[16px]" data-testid="pack-order">
                {boxes.labelling === "per_piece" ? <li>1. Stick a label on each {boxes.pieceWord.replace(/s$/, "")}.</li> : null}
                <li>{boxes.labelling === "per_piece" ? "2" : "1"}. Pack {boxes.unitsPerBox} in a box.</li>
                <li>{boxes.labelling === "per_piece" ? "3" : "2"}. Stick one label on each box.</li>
                {boxes.samples ? <li className="text-[14px] text-fg-2">QA keeps {boxes.samples} {boxes.pieceWord} as samples: they go in no box and get no label (QA to confirm).</li> : null}
              </ol>
              <BoxLabels
                withPieceLabels={boxes.labelling === "per_piece" && !!v.packaging?.labels.allowed && !!v.packaging.labels.values}
                batchId={b.id}
                unitsPerBox={boxes.unitsPerBox}
                defaultPieces={boxes.defaultPieces}
                samples={boxes.samples}
                pieceWord={boxes.pieceWord}
                face={boxes.preview?.options[0]?.face ?? null}
                plan={boxes.plan}
                canPrint={boxes.canPrint}
                why={boxes.why}
                locked={boxes.locked}
                printHref={boxes.printHref}
              />
              {/* per_piece products also label each piece (ADR-099 panel); piece labels are not counted one by one. */}
              {boxes.labelling === "per_piece" && v.packaging?.labels.allowed && v.packaging.labels.values ? (
                <details className="text-[15px]">
                  <summary className="min-h-[44px] cursor-pointer py-2 text-primary-text">Print only the piece labels (again)</summary>
                <PrintLabelsPanel
                  ctx={ctx}
                  entityType="batch"
                  entityId={b.id}
                  kind="bar"
                  copies={boxes.plan?.pieces ?? v.packaging.labels.defaultCount}
                  title="Label for each piece"
                  sentence="Stick one label on each piece."
                  action={printBatchLabelsPanelAction}
                  batchValues={v.packaging.labels.values}
                />
                </details>
              ) : null}
            </div>
          ) : undefined
        }
        viewer={v.viewer}
        equipment={v.equipment}
      />
      {v.canStopForToday ? (
        <StopForToday batchId={b.id} stepNo={v.step.stepNo} prefill={v.stopPrefill} last={v.pause.last?.words ?? null} dayNo={v.pause.dayNo} />
      ) : v.pause.last ? (
        <p className="mt-4 text-[15px] text-fg-2" data-testid="last-pause">
          {v.pause.last.words}
        </p>
      ) : null}
      <p className="mt-6 flex flex-wrap gap-x-6 text-[15px]">
        <Link href={batchRecordHref(b.id)} className="inline-flex min-h-[44px] items-center text-primary-text underline">
          See the full batch record
        </Link>
        {/* Round 5 (B-owner-manager B4): report a problem from the step; the reporter comes back to this step. */}
        {ctx.can("quality.deviation.create") && (
          <Link href={`/quality/deviations/new?batchId=${b.id}&back=${encodeURIComponent(href(v.step.stepNo))}`} className="inline-flex min-h-[44px] items-center text-primary-text underline" data-testid="report-problem">
            Report a problem
          </Link>
        )}
      </p>
    </div>
  );
}

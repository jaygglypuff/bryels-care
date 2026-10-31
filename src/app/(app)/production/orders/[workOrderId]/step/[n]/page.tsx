import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import Link from "next/link";
import { batchRecordHref, finishHref, getStepCard, nextBatchScreen, type StepCardView } from "@/modules/production";
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

export const metadata: Metadata = { title: "Step" };
export const dynamic = "force-dynamic";

/** S5 Step (ADR-080, UX review S5): Start check, Mix, Wait (curing / resting), Cut, Wrap. One step per screen. */
/** One plain sentence per kind of step; the step's own name comes from the approved steps (configuration). */
function plainStep(kind: string, isCheck: boolean, isWait: boolean) {
  if (isCheck) return "Look at each point and answer Yes or No. All OK when everything is fine.";
  if (isWait) return "The batch rests here. Come back on the ready day.";
  if (kind === "packaging" || kind === "filling") return "Wrap or fill the pieces and stick one label on each. Then say how many wrappers you used and how many were spoiled.";
  if (kind === "dispensing" || kind === "weighing") return "Weigh out each ingredient on the Weigh screen.";
  if (kind === "transfer") return "Count the pieces and put the batch in the hold area on the Finish screen.";
  return "Do this step, write the numbers it asks for, then tap Step done.";
}

export default async function StepPage({ params, searchParams }: { params: Promise<{ workOrderId: string; n: string }>; searchParams: Promise<{ batch?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Forbidden what="production steps" />;
  const { workOrderId, n } = await params;
  const stepNo = Number(n);
  if (!Number.isInteger(stepNo) || stepNo < 1 || stepNo > 999) notFound();
  const { batch: batchParam } = await searchParams;
  let orderHref = orderHrefOf(workOrderId);
  let v: StepCardView;
  let facts;
  try {
    const picked = await pickBatch(ctx, workOrderId, batchParam, (f) => f.currentStep?.stepNo === stepNo);
    const batch = picked.batch;
    if (!batch) return <NoBatch orderHref={orderHref}>This order has no batch yet. Approve it first.</NoBatch>;
    orderHref = picked.backHref;
    facts = batch;
    v = await getStepCard(ctx, batch.batchId, stepNo);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const b = v.batch;
  const href = (s: number) => `/production/orders/${workOrderId}/step/${s}?batch=${b.id}`;
  const next = nextBatchScreen(facts);
  const nextHref = v.next ? (v.next.kind === "dispensing" || v.next.kind === "weighing" ? `/production/orders/${workOrderId}/weigh?batch=${b.id}` : v.next.kind === "transfer" ? finishHref(b.id) : href(v.next.stepNo)) : null;
  return (
    <div className="mx-auto max-w-5xl pb-24 text-[16px]">
      <FlowHeader
        title={plainWords(v.step.name)}
        batchNumber={b.batchNumber}
        orderHref={orderHref}
        progress={<span>Step {v.step.index} of {v.step.total}</span>}
        actions={<Help screen="production.step" />}
      />
      <PageIntro>{plainStep(v.step.kind, v.step.isCheck, v.step.isWait)}</PageIntro>
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
        approvers={v.approvers}
        passwordRequired={v.passwordRequired}
        nextHref={nextHref}
        nextLabel={v.next ? (v.next.kind === "transfer" ? "Go to Finish" : v.next.kind === "dispensing" || v.next.kind === "weighing" ? "Weigh" : v.next.name) : null}
        weighHref={`/production/orders/${workOrderId}/weigh?batch=${b.id}`}
        finishHref={finishHref(b.id)}
        fullRecordHref={batchRecordHref(b.id)}
        packaging={v.packaging}
        blocked={!!v.blockedReason}
        labelsPanel={
          v.packaging?.labels.allowed && v.packaging.labels.values ? (
            <PrintLabelsPanel
              ctx={ctx}
              entityType="batch"
              entityId={b.id}
              kind="bar"
              copies={v.packaging.labels.defaultCount}
              sentence="Stick one label on each bar."
              action={printBatchLabelsPanelAction}
              batchValues={v.packaging.labels.values}
            />
          ) : undefined
        }
        viewer={v.viewer}
        equipment={v.equipment}
      />
      <p className="mt-6 text-[15px]">
        <Link href={batchRecordHref(b.id)} className="inline-flex min-h-[44px] items-center text-primary-text underline">
          See the full batch record
        </Link>
      </p>
    </div>
  );
}

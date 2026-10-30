import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getStepCard, nextBatchScreen, type StepCardView } from "@/modules/production";
import { LinkButton } from "@/ui/core";
import { Help } from "@/ui/help/help";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../../../forbidden";
import { FlowHeader, NoBatch, pickBatch } from "../../flow-shared";
import { StepCard } from "./step-card";

export const metadata: Metadata = { title: "Step" };
export const dynamic = "force-dynamic";

/** S5 Step (ADR-080, UX review S5): Start check, Mix, Wait (curing / resting), Cut, Wrap. One step per screen. */
export default async function StepPage({ params, searchParams }: { params: Promise<{ workOrderId: string; n: string }>; searchParams: Promise<{ batch?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Forbidden what="production steps" />;
  const { workOrderId, n } = await params;
  const stepNo = Number(n);
  if (!Number.isInteger(stepNo) || stepNo < 1 || stepNo > 999) notFound();
  const { batch: batchParam } = await searchParams;
  const orderHref = `/production/orders/${workOrderId}`;
  let v: StepCardView;
  let facts;
  try {
    const { batch } = await pickBatch(ctx, workOrderId, batchParam, (f) => f.currentStep?.stepNo === stepNo);
    if (!batch) return <NoBatch orderHref={orderHref}>This order has no batch yet. Approve it first.</NoBatch>;
    facts = batch;
    v = await getStepCard(ctx, batch.batchId, stepNo);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const b = v.batch;
  const href = (s: number) => `/production/orders/${workOrderId}/step/${s}?batch=${b.id}`;
  const next = nextBatchScreen(facts);
  const nextHref = v.next ? (v.next.kind === "dispensing" || v.next.kind === "weighing" ? `/production/orders/${workOrderId}/weigh?batch=${b.id}` : v.next.kind === "transfer" ? `/production/${b.id}` : href(v.next.stepNo)) : null;
  return (
    <div className="mx-auto max-w-5xl pb-24 text-[16px]">
      <FlowHeader
        title={v.step.name}
        batchNumber={b.batchNumber}
        orderHref={orderHref}
        progress={<span>Step {v.step.index} of {v.step.total}</span>}
        actions={<Help screen="production.step" />}
      />
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
        fullRecordHref={`/production/${b.id}`}
      />
    </div>
  );
}

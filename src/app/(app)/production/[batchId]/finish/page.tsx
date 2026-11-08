import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { batchRecordHref, type FinishView, flowHref, getFinishView } from "@/modules/production";
import { Help } from "@/ui/help/help";
import { Forbidden } from "../../../forbidden";
import { FlowHeader } from "../../orders/[workOrderId]/flow-shared";
import { FinishPanel } from "./finish-panel";

export const metadata: Metadata = { title: "Finish batch" };
export const dynamic = "force-dynamic";

/**
 * Finish (ADR-080 §6; round 5 problem 2 and B19). When the recipe has the step "Move to the QA waiting area", Finish
 * IS that step: this address opens it in the step template ("Step 7 of 7"). A recipe without that step (ADR-128)
 * keeps this page, in the same template. Every rule is in finishBatch.
 */
export default async function FinishPage({ params }: { params: Promise<{ batchId: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Forbidden what="production batches" permission="production.batch.view" />;
  const { batchId } = await params;
  let v: FinishView;
  try {
    v = await getFinishView(ctx, batchId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  if (v.transferStepNo) redirect(flowHref({ batchId: v.batch.id, workOrderId: v.batchWorkOrderId }, `step/${v.transferStepNo}`));
  const back = v.order ? `/production/orders/${v.order.id}` : batchRecordHref(v.batch.id);
  return (
    <div className="mx-auto max-w-3xl pb-24 text-[16px]">
      <FlowHeader title="Finish the batch" batchNumber={v.batch.number} orderHref={back} progress={<span>{v.product.name}</span>} actions={<Help screen="production.finish" />} />
      <FinishPanel v={v} />
    </div>
  );
}

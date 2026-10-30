import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getWeighView, type WeighView } from "@/modules/production";
import { LinkButton } from "@/ui/core";
import { Help } from "@/ui/help/help";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../../forbidden";
import { FlowHeader, NoBatch, pickBatch } from "../flow-shared";
import { WeighFlow } from "./weigh-flow";

export const metadata: Metadata = { title: "Weigh" };
export const dynamic = "force-dynamic";

/** S4 Weigh (ADR-080 §3–4, UX review S4): one card per ingredient, lot confirm, keypad, second check. */
export default async function WeighPage({ params, searchParams }: { params: Promise<{ workOrderId: string }>; searchParams: Promise<{ batch?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Forbidden what="weighing" />;
  const { workOrderId } = await params;
  const { batch: batchParam } = await searchParams;
  const orderHref = `/production/orders/${workOrderId}`;
  let v: WeighView;
  try {
    const { batch } = await pickBatch(ctx, workOrderId, batchParam, (f) => f.status === "in_process" && f.currentStep?.kind === "dispensing");
    if (!batch) return <NoBatch orderHref={orderHref}>Nothing to weigh. This order has no batch yet.</NoBatch>;
    v = await getWeighView(ctx, batch.batchId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const b = v.batch;
  const stepHref = (n: number) => `/production/orders/${workOrderId}/step/${n}?batch=${b.id}`;
  return (
    <div className="mx-auto max-w-6xl pb-24 text-[16px]">
      <FlowHeader
        title="Weigh"
        batchNumber={b.batchNumber}
        orderHref={orderHref}
        progress={<span data-testid="weigh-progress">{v.weighedCount} of {v.cards.length} weighed{v.step ? ` · Step ${v.step.index} of ${v.step.total}` : ""}</span>}
        actions={<Help screen="production.weigh" />}
      />
      {v.blockedReason && (
        <div className="mb-4">
          <Banner tone="warn" title="You can't weigh now" action={b.status === "materials_staged" || b.status === "planned" ? <LinkButton href={`${orderHref}`} variant="secondary" size="lg">Back to the order</LinkButton> : undefined}>
            {v.blockedReason}
          </Banner>
        </div>
      )}
      {!ctx.can("production.dispense_record.create") && !v.blockedReason && (
        <div className="mb-4">
          <Banner tone="neu" title="View only">You can see the weighings but not weigh. Ask the production lead.</Banner>
        </div>
      )}
      <WeighFlow
        batchId={b.id}
        stepNo={v.step?.stepNo ?? null}
        stepDone={v.step?.status === "completed"}
        canWeigh={v.canWeigh}
        lotConfirm={v.settings.lotConfirm}
        cards={v.cards}
        scales={v.scales}
        requiresScale={!!v.step?.requiresEquipment}
        checkers={v.checkers}
        passwordRequired={v.passwordRequired}
        totalWeighed={v.totalWeighed}
        totalTarget={v.totalTarget}
        stepBlockers={(v.step?.blockers ?? []).map((x) => x.message)}
        nextHref={v.step ? stepHref(v.step.stepNo + 1) : null}
        fullRecordHref={`/production/${b.id}`}
      />
    </div>
  );
}

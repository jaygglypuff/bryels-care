import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { batchRecordHref, getWeighView, substituteMaterialOptions, type WeighView } from "@/modules/production";
import { LinkButton } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Help } from "@/ui/help/help";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../../forbidden";
import { FlowHeader, NoBatch, orderHrefOf, pickBatch } from "../flow-shared";
import { WeighFlow } from "./weigh-flow";

export const metadata: Metadata = { title: "Weigh" };
export const dynamic = "force-dynamic";

/** S4 Weigh (ADR-080 §3–4, UX review S4): one card per ingredient, lot confirm, keypad, second check. */
export default async function WeighPage({ params, searchParams }: { params: Promise<{ workOrderId: string }>; searchParams: Promise<{ batch?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Forbidden what="weighing" permission="production.batch.view" />;
  const { workOrderId } = await params;
  const { batch: batchParam } = await searchParams;
  let orderHref = orderHrefOf(workOrderId);
  let v: WeighView;
  try {
    const picked = await pickBatch(ctx, workOrderId, batchParam, (f) => f.status === "in_process" && f.currentStep?.kind === "dispensing");
    const batch = picked.batch;
    if (!batch) return <NoBatch orderHref={orderHref}>Nothing to weigh. This order has no batch yet.</NoBatch>;
    orderHref = picked.backHref;
    v = await getWeighView(ctx, batch.batchId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const b = v.batch;
  // Re-audit N9: the checker opening this screen sees "Check Jun's weighing", not "Weigh" (Home said "Check 2 weighings").
  const canCheck = ctx.can("production.dispense_record.approve") && ctx.canAt("production.dispense_record.approve", b.siteId);
  const toCheck = canCheck ? v.cards.flatMap((c) => c.waitingForCheck).filter((w) => w.operatorId !== ctx.userId) : [];
  const weighers = [...new Set(toCheck.map((w) => (w.operator ?? "the operator").split(/\s+/)[0]))];
  const title = toCheck.length === 0 ? "Weigh" : weighers.length === 1 ? `Check ${weighers[0]}'s ${toCheck.length === 1 ? "weighing" : "weighings"}` : "Check the weighings";
  const substitutes = v.cards.some((c) => c.canAskOther) ? (await substituteMaterialOptions(ctx)).map((m) => ({ id: m.id, name: m.name, baseUom: m.baseUom })) : [];
  const stepHref = (n: number) => `/production/orders/${workOrderId}/step/${n}?batch=${b.id}`;
  return (
    <div className="mx-auto max-w-6xl pb-24 text-[16px]">
      <FlowHeader
        title={title}
        batchNumber={b.batchNumber}
        orderHref={orderHref}
        progress={<span data-testid="weigh-progress">{v.weighedCount} of {v.cards.length} weighed{v.step ? ` · Step ${v.step.index} of ${v.step.total}` : ""}</span>}
        actions={<Help screen="production.weigh" />}
      />
      <PageIntro>Weigh out each ingredient: check the lot printed on the container, put it on the scale, type the weight and save.</PageIntro>
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
        moreHref={`/production/orders/${workOrderId}/weigh/more?batch=${b.id}`}
        viewer={{ userId: ctx.userId, displayName: ctx.displayName, canCheck: ctx.can("production.dispense_record.approve") && ctx.canAt("production.dispense_record.approve", b.siteId) }}
        reasons={v.lotChangeReasons}
        substitutes={substitutes}
      />
      <p className="mt-6 text-[15px]">
        <Link href={batchRecordHref(b.id)} className="inline-flex min-h-[44px] items-center text-primary-text underline">
          See the full batch record
        </Link>
      </p>
    </div>
  );
}

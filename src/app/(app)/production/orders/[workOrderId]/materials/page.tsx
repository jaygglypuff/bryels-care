import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { canTickMaterials, getMaterialsList, nextBatchScreen, type MaterialsListView } from "@/modules/production";
import { LinkButton } from "@/ui/core";
import { Help } from "@/ui/help/help";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../../forbidden";
import { FlowHeader, NoBatch, pickBatch } from "../flow-shared";
import { MaterialsList } from "./materials-list";

export const metadata: Metadata = { title: "Materials list" };
export const dynamic = "force-dynamic";

/** S3 Materials list (ADR-080 §2, UX review S3): tick each ingredient as Taken, or All taken. */
export default async function MaterialsPage({ params, searchParams }: { params: Promise<{ workOrderId: string }>; searchParams: Promise<{ batch?: string }> }) {
  const ctx = await requireContext();
  if (!canTickMaterials(ctx) && !ctx.can("production.batch.view")) return <Forbidden what="the materials list" />;
  const { workOrderId } = await params;
  const { batch: batchParam } = await searchParams;
  const orderHref = `/production/orders/${workOrderId}`;
  let picked;
  try {
    picked = await pickBatch(ctx, workOrderId, batchParam, (f) => f.status === "planned");
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  if (!picked.batch) return <NoBatch orderHref={orderHref}>Nothing to take. This order has no materials set aside yet. Approve the order first.</NoBatch>;
  let v: MaterialsListView;
  try {
    v = await getMaterialsList(ctx, picked.batch.batchId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const next = nextBatchScreen(picked.batch);
  const done = v.progress.taken + v.progress.notNeeded;
  return (
    <div className="mx-auto max-w-5xl pb-28 text-[16px]">
      <FlowHeader
        title="Materials list"
        batchNumber={v.batch.batchNumber}
        orderHref={orderHref}
        progress={<span data-testid="pick-progress">{v.ready ? "Materials ready" : `${done} of ${v.progress.lines} taken`}</span>}
        actions={<Help screen="production.materials_list" />}
      />
      <p className="mb-4 text-[15px] text-muted">{v.productName}. Bring each item to the mixing area and tap Taken. You confirm the lot again when you weigh.</p>
      {v.ready && (
        <div className="mb-4">
          <Banner tone="ok" title="Materials ready" action={next.href ? <LinkButton href={next.href} variant="cta" size="lg">{next.label}</LinkButton> : undefined}>
            Every line is taken. Start the batch with the Start check.
          </Banner>
        </div>
      )}
      {!v.ready && v.blockedReason && (
        <div className="mb-4">
          <Banner tone="warn" title="You can't tick this list now">{v.blockedReason}</Banner>
        </div>
      )}
      {!v.ready && !v.blockedReason && v.tickDeniedReason && (
        <div className="mb-4">
          <Banner tone="neu" title="View only">{v.tickDeniedReason}</Banner>
        </div>
      )}
      {v.lines.length === 0 ? (
        <NoBatch orderHref={orderHref}>Nothing to take. This batch has no ingredients.</NoBatch>
      ) : (
        <MaterialsList
          batchId={v.batch.id}
          canTick={v.canTick}
          scanLots={v.settings.scanLots}
          moveStock={v.settings.moveStock}
          allDone={v.progress.complete || v.ready}
          lines={v.lines.map((l) => ({
            id: l.batchMaterialId,
            name: l.materialName,
            qty: l.qty,
            uom: l.baseUom,
            state: l.state,
            by: l.by,
            reason: l.reason,
            lots: l.lots.map((x) => ({ lotNumber: x.lotNumber, place: x.locationName || x.locationCode, section: x.sectionLabel, expiresOn: x.expiresOn, problem: x.problem })),
          }))}
        />
      )}
    </div>
  );
}

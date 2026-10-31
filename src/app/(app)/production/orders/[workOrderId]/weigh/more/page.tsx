import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtQty } from "@/lib/qty";
import { getSetting } from "@/lib/settings";
import { equipmentOptions, getBatchExecution, getBatchRecord, isWeighingStep, signerOptions, usableLotsForBatch } from "@/modules/production";
import { PageIntro } from "@/ui/guide";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../../../forbidden";
import { OneTap, ReasonForm, SignOffProvider, WeighForm } from "../../../../[batchId]/exec-forms";
import { FlowHeader, NoBatch, orderHrefOf, pickBatch } from "../../flow-shared";

export const metadata: Metadata = { title: "Other ways to weigh" };
export const dynamic = "force-dynamic";

/**
 * "Other ways to weigh" for ONE ingredient (one path for production work, 2026-10-31): what the old
 * batch workspace offered under the weighing step, now inside the Weigh flow. Container (tare/gross)
 * weight, a part from a second lot, a weight outside the allowed difference with an approver and reason
 * (CX-TOL, a problem report is opened), undo (void) a weighing with a reason, and the second-person
 * check. Same services (recordDispense, voidDispense, checkDispense) and the same rules.
 */
export default async function WeighMorePage({ params, searchParams }: { params: Promise<{ workOrderId: string }>; searchParams: Promise<{ batch?: string; line?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.batch.view")) return <Forbidden what="weighing" />;
  const { workOrderId } = await params;
  const { batch: batchParam, line } = await searchParams;
  let backHref = orderHrefOf(workOrderId);
  let ex, rec;
  try {
    const picked = await pickBatch(ctx, workOrderId, batchParam, (f) => f.status === "in_process");
    if (!picked.batch) return <NoBatch orderHref={backHref}>Nothing to weigh. This order has no batch yet.</NoBatch>;
    [ex, rec] = await Promise.all([getBatchExecution(ctx, picked.batch.batchId), getBatchRecord(ctx, picked.batch.batchId)]);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const b = ex.batch;
  const weighHref = `/production/orders/${workOrderId}/weigh?batch=${b.id}`;
  backHref = weighHref;
  const ing = ex.ingredients.find((i) => i.id === line) ?? null;
  if (!ing) return <NoBatch orderHref={weighHref}>Choose an ingredient on the Weigh screen first.</NoBatch>;
  const r = rec.ingredients.find((i) => i.id === ing.id);
  const step = ex.steps.find((s) => isWeighingStep(s.stepKind)) ?? null;
  const running = b.status === "in_process";
  const canWeigh = running && !!step && step.isCurrent && (step.status === "pending" || step.status === "in_progress") && (ctx.can("production.dispense_record.create") || ctx.can("production.process_step_record.create"));
  const [scales, checkers, approvers, fefo, requirePassword] = await Promise.all([
    canWeigh && step ? equipmentOptions(ctx, b.siteId, step.equipmentKind ?? "scale") : Promise.resolve([]),
    running ? signerOptions(ctx, b.siteId, "production.dispense_record.approve") : Promise.resolve([]),
    running ? signerOptions(ctx, b.siteId, "production.over_tolerance_dispense.approve") : Promise.resolve([]),
    canWeigh ? usableLotsForBatch(ctx, b.id) : Promise.resolve({} as Awaited<ReturnType<typeof usableLotsForBatch>>),
    getSetting(db, ctx.organizationId, "production.sign_off.require_password"),
  ]);
  const lots = r ? (fefo[r.materialId] ?? []) : [];
  const lastVoided = [...ing.weighings].reverse().find((w) => w.voided && !ing.weighings.some((x) => x.supersedesId === w.id));
  const open = ing.status === "pending" || ing.status === "partial";
  const needsChecker = (b.formulaSnapshot as { lines?: { lineNo: number; requiresChecker?: boolean }[] }).lines?.find((x) => x.lineNo === ing.lineNo)?.requiresChecker !== false;
  const key = () => uuidv7();
  return (
    <SignOffProvider requirePassword={requirePassword}>
      <div className="mx-auto max-w-3xl pb-24 text-[16px]">
        <FlowHeader title={`Other ways to weigh: ${ing.materialName}`} batchNumber={b.batchNumber} orderHref={backHref} />
        <PageIntro>Use this only when the normal Weigh card does not fit: weighing in a container, taking part from a second lot, a weight outside the allowed difference (needs an approver), or undoing a wrong weighing.</PageIntro>
        <section className="mb-4 rounded-[16px] border border-line bg-surface p-4">
          <p className="text-[17px] font-semibold text-fg">{ing.materialName}</p>
          <p className="text-[15px] text-fg-2 tabular">
            Target {fmtQty(ing.theoreticalQtyG, "g", 1)}
            {r ? ` · OK from ${fmtQty(r.minG, "", 1)} to ${fmtQty(r.maxG, "g", 1)}` : ""} · {D(ing.dispensedQtyG).gt(0) ? `weighed ${fmtQty(ing.dispensedQtyG, "g", 1)}` : "not weighed yet"}
          </p>
        </section>
        {ing.weighings.length > 0 && (
          <section className="mb-4 grid gap-2" aria-label="Weighings of this ingredient">
            <h2 className="text-[17px] font-semibold">Weighings</h2>
            {ing.weighings.map((w) => (
              <div key={w.id} className="rounded-[14px] border border-line bg-surface p-3 text-[15px]">
                <p className={w.voided ? "text-muted line-through" : ""}>
                  {fmtQty(w.qtyG, "g", 1)} · lot {w.lotNumber} · shelf {w.locationCode} · by {w.operator} · {w.checker ? `checked by ${w.checker}` : "not checked yet"}
                </p>
                {w.exceptionApprovedBy && <p className="text-[14px] text-[var(--warn-fg)]">Approved by {w.exceptionApprovedBy}: {w.exceptionReason}</p>}
                {w.voided && <p className="text-[14px] text-muted">Undone by {w.voidedBy}: {w.voidReason}</p>}
                {!w.voided && running && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {!w.checker && ctx.can("production.dispense_record.approve") && w.operatorId !== ctx.userId && (
                      <OneTap kind="checkDispense" hidden={{ batchId: b.id, dispenseRecordId: w.id, idempotencyKey: key() }} label="Yes, I checked this weighing" variant="secondary" />
                    )}
                    {ctx.can("production.dispense_record.void") && step?.status === "in_progress" && (
                      <ReasonForm kind="void" hidden={{ batchId: b.id, dispenseRecordId: w.id }} label="Undo this weighing" reasonLabel="Why is this weighing wrong?" />
                    )}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}
        {!running && <Banner tone="neu" title="Not weighing now">This batch is not at the weighing step.</Banner>}
        {canWeigh && open && r ? (
          <WeighForm
            batchId={b.id}
            ing={{ id: ing.id, lineNo: ing.lineNo, materialCode: ing.materialCode, materialName: ing.materialName, inciName: r.inciName, theoreticalQtyG: ing.theoreticalQtyG, tolerancePct: r.tolerancePct, minG: r.minG, maxG: r.maxG, dispensedQtyG: ing.dispensedQtyG, status: ing.status, recommended: lots[0] ? `${lots[0].lotNumber} at ${lots[0].locationCode}, exp ${fmtDate(lots[0].expiresOn)}` : null }}
            scales={scales}
            checkers={checkers}
            approvers={approvers}
            idem={key()}
            replaces={lastVoided && ing.status === "pending" ? { id: lastVoided.id } : null}
            needsChecker={needsChecker}
            lots={lots.map((l) => ({ lotNumber: l.lotNumber, locationCode: l.locationCode, locationName: l.locationName, qty: l.qty, expiresOn: l.expiresOn }))}
          />
        ) : running && !open ? (
          <p className="text-[15px] text-muted">This ingredient is weighed. Undo a weighing above to weigh it again.</p>
        ) : null}
        <p className="mt-6">
          <Link href={weighHref} className="inline-flex min-h-[48px] items-center rounded-full border border-line bg-surface px-5 text-[15px] font-medium text-fg">
            Back to Weigh
          </Link>
        </p>
      </div>
    </SignOffProvider>
  );
}

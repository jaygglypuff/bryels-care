"use client";
import { useMemo, useState, type ReactNode } from "react";
import { D, fmtQty } from "@/lib/qty";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { addDailyLogAction, approveProductionOrderAction, assignProductionOrderAction, cancelProductionOrderAction, correctDailyLogAction, createProductionOrderAction } from "./actions";

/**
 * Client forms of the production order screens (ADR-074). Few fields visible; the rest under
 * "More details". The server validates everything again; these forms only collect input.
 */

type FormulaOption = { formulaId: string; productId: string; productName: string; productSku: string; referenceBatchSizeG: string | null; theoreticalYieldPct?: string | null; unitNetMassG?: string | null };

export type MakeForPrefill = { salesOrderId: string; salesOrderNumber: string; lineNo: number; productId: string; missing: string; neededBy: string | null };

function MoreDetails({ children }: { children: ReactNode }) {
  return (
    <details className="rounded-[14px] border border-line bg-surface-2/40 px-3.5 py-2.5">
      <summary className="min-h-[44px] cursor-pointer py-2.5 text-[14px] font-medium">More details</summary>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">{children}</div>
    </details>
  );
}

/** Pieces one batch makes (rounded down), for the hint under "How many". */
function perBatch(f: FormulaOption | undefined, sizeKg: string) {
  if (!f?.unitNetMassG || !f.theoreticalYieldPct || !/^\d+(\.\d+)?$/.test(sizeKg)) return null;
  const n = D(sizeKg).mul(1000).mul(f.theoreticalYieldPct).div(100).div(f.unitNetMassG).floor();
  return n.gt(0) ? n.toString() : null;
}

/**
 * New order (ADR-080 V2-2): pieces first. Visible: what to make, how many, needed by, start date.
 * Batch size, number of batches, line and notes are under "More details". With a customer order
 * ("Make for this order") the product, the missing pieces and the delivery date are prefilled and the
 * order is linked to it.
 */
export function ProductionOrderForm({ formulas, lines, today, prefill }: { formulas: FormulaOption[]; lines: { id: string; code: string; name: string }[]; today: string; prefill?: MakeForPrefill | null }) {
  const products = useMemo(() => {
    const m = new Map<string, FormulaOption>();
    for (const f of formulas) if (!m.has(f.productId)) m.set(f.productId, f);
    return [...m.values()];
  }, [formulas]);
  const [productId, setProductId] = useState(prefill?.productId ?? products[0]?.productId ?? "");
  const current = products.find((p) => p.productId === productId);
  const ref = current?.referenceBatchSizeG;
  const [sizeKg, setSizeKg] = useState(ref ? D(ref).div(1000).toString() : "");
  const per = perBatch(current, sizeKg);
  return (
    <ActionForm action={createProductionOrderAction} hidden={prefill ? { salesOrderId: prefill.salesOrderId } : undefined} submit="Create order" pending="Creating…" variant="cta" size="lg" className="flex flex-col gap-5">
      {(fe) => (
        <>
          {prefill && (
            <p className="rounded-[14px] border border-line bg-surface-2/60 px-3.5 py-3 text-[14px]">
              For customer order <span className="font-semibold">{prefill.salesOrderNumber}</span>, line {prefill.lineNo}: {prefill.missing} pieces are missing.
            </p>
          )}
          <Field label="What to make" htmlFor="productId" error={fe.productId}>
            <Select
              id="productId"
              name="productId"
              value={productId}
              disabled={!!prefill}
              onChange={(e) => {
                setProductId(e.target.value);
                const r = products.find((p) => p.productId === e.target.value)?.referenceBatchSizeG;
                setSizeKg(r ? D(r).div(1000).toString() : "");
              }}
            >
              {products.map((p) => (
                <option key={p.productId} value={p.productId}>{p.productName}</option>
              ))}
            </Select>
          </Field>
          {prefill && <input type="hidden" name="productId" value={productId} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How many (pieces)" htmlFor="quantityUnits" error={fe.quantityUnits} hint={per ? `One batch makes about ${per}. Empty = one batch.` : "Empty = one batch."}>
              <Input id="quantityUnits" name="quantityUnits" inputMode="numeric" pattern="[0-9]*" defaultValue={prefill?.missing ?? ""} placeholder={per ?? ""} />
            </Field>
            <Field label="Needed by" htmlFor="neededBy" error={fe.neededBy} hint="Optional. The order shows Late after this day.">
              <Input id="neededBy" name="neededBy" type="date" defaultValue={prefill?.neededBy ?? ""} />
            </Field>
            <Field label="Start date" htmlFor="plannedStart" error={fe.plannedStart}>
              <Input id="plannedStart" name="plannedStart" type="date" defaultValue={today} required />
            </Field>
          </div>
          <MoreDetails>
            <Field label="Batch size (kg)" htmlFor="batchSizeKg" error={fe.batchSizeKg} hint={ref ? `Usual size ${fmtQty(D(ref).div(1000), "kg", 1)}` : undefined}>
              <Input id="batchSizeKg" name="batchSizeKg" inputMode="decimal" value={sizeKg} onChange={(e) => setSizeKg(e.target.value)} />
            </Field>
            <Field label="Number of batches" htmlFor="batchCount" error={fe.batchCount} hint="Empty = enough batches for How many.">
              <Input id="batchCount" name="batchCount" inputMode="numeric" defaultValue="" />
            </Field>
            <Field label="Finish by" htmlFor="plannedEnd" error={fe.plannedEnd} hint="Empty = same day as the start.">
              <Input id="plannedEnd" name="plannedEnd" type="date" />
            </Field>
            <Field label="Production line" htmlFor="productionLineId" error={fe.productionLineId}>
              <Select id="productionLineId" name="productionLineId" defaultValue="">
                <option value="">Not chosen</option>
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Notes" htmlFor="notes" error={fe.notes}>
              <Textarea id="notes" name="notes" maxLength={1000} className="min-h-[56px]" />
            </Field>
          </MoreDetails>
        </>
      )}
    </ActionForm>
  );
}

export function ApproveButton({ workOrderId }: { workOrderId: string }) {
  return <ActionForm action={approveProductionOrderAction} hidden={{ workOrderId }} submit="Approve" pending="Approving…" variant="cta" size="lg" messageBelow className="flex flex-col gap-2" />;
}

/** ADR-082: who makes this order. Only people who record production at the site are offered. */
export function AssignForm({ workOrderId, current, people }: { workOrderId: string; current: string | null; people: { id: string; name: string }[] }) {
  return (
    <ActionForm action={assignProductionOrderAction} hidden={{ workOrderId }} submit="Save" pending="Saving…" variant="secondary" size="sm" messageBelow className="flex flex-col gap-2">
      {(fe) => (
        <Field label="Who makes it" htmlFor="assignee" error={fe.assigneeId}>
          <Select id="assignee" name="assigneeId" defaultValue={current ?? ""}>
            <option value="">Anyone at the site</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>
      )}
    </ActionForm>
  );
}

export function CancelOrderForm({ workOrderId }: { workOrderId: string }) {
  return (
    <ActionForm action={cancelProductionOrderAction} hidden={{ workOrderId }} submit="Cancel order" pending="Cancelling…" variant="danger" size="sm" confirm="Cancel this production order? Materials set aside for it become free again." messageBelow className="flex flex-col gap-2">
      {(fe) => (
        <Field label="Why cancel?" htmlFor="cancel-reason" error={fe.reason}>
          <Textarea id="cancel-reason" name="reason" required minLength={5} maxLength={500} className="min-h-[56px]" />
        </Field>
      )}
    </ActionForm>
  );
}

export type LogInitial = { logId: string; logDate: string; shift: string | null; notes: string | null; goodQty: string; batchId: string | null; defects: { defectType: string; quantity: string }[] };

/** "What happened today" (add) or a correction of one entry (reason required). */
export function DailyLogForm({ workOrderId, defectTypes, batches, today, initial }: { workOrderId: string; defectTypes: string[]; batches: { id: string; batchNumber: string }[]; today: string; initial?: LogInitial }) {
  const correcting = !!initial;
  const types = [...defectTypes, ...(initial?.defects.map((d) => d.defectType).filter((t) => !defectTypes.includes(t)) ?? [])];
  const qtyOf = (t: string) => {
    const d = initial?.defects.find((x) => x.defectType === t);
    return d ? D(d.quantity).toString() : "";
  };
  const p = correcting ? `c-${initial.logId}-` : "add-";
  return (
    <ActionForm
      action={correcting ? correctDailyLogAction : addDailyLogAction}
      hidden={correcting ? { logId: initial.logId } : { workOrderId }}
      submit={correcting ? "Save correction" : "Save to daily log"}
      pending="Saving…"
      variant={correcting ? "primary" : "cta"}
      className="flex flex-col gap-4"
    >
      {(fe) => (
        <>
          {correcting && (
            <Field label="Why are you correcting it?" htmlFor={`${p}reason`} error={fe.reason}>
              <Input id={`${p}reason`} name="reason" required minLength={5} maxLength={300} placeholder="For example: counted one tray twice" />
            </Field>
          )}
          <Field label="What happened?" htmlFor={`${p}notes`} error={fe.notes}>
            <Textarea id={`${p}notes`} name="notes" maxLength={1000} defaultValue={initial?.notes ?? ""} placeholder="For example: mixed and poured 2 trays, cut tomorrow" className="min-h-[72px]" />
          </Field>
          <Field label="Good pieces made" htmlFor={`${p}goodQty`} error={fe.goodQty}>
            <Input id={`${p}goodQty`} name="goodQty" inputMode="decimal" defaultValue={initial ? D(initial.goodQty).toString() : ""} placeholder="0" />
          </Field>
          <details className="rounded-[14px] border border-line px-3.5" open={!!fe.defects || types.some((t) => !!qtyOf(t) && qtyOf(t) !== "0")}>
            <summary className="min-h-[48px] cursor-pointer py-3 text-[14px] font-medium">Any rejects? Tap to write how many of each type</summary>
          <fieldset className="pb-3">
            <legend className="sr-only">Rejects (how many pieces of each type)</legend>
            {fe.defects && <p className="mb-2 text-[13px] text-[var(--bad-fg)]">{fe.defects}</p>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {types.map((t, i) => (
                <label key={t} htmlFor={`${p}def-${i}`} className="flex min-h-[44px] items-center justify-between gap-3 text-[14px]">
                  <span className="min-w-0">{t}</span>
                  <input type="hidden" name="defectType" value={t} />
                  <Input id={`${p}def-${i}`} name="defectQty" inputMode="decimal" defaultValue={qtyOf(t)} placeholder="0" className="w-24 shrink-0" />
                </label>
              ))}
            </div>
          </fieldset>
          </details>
          <MoreDetails>
            <Field label="Day" htmlFor={`${p}logDate`} error={fe.logDate}>
              <Input id={`${p}logDate`} name="logDate" type="date" max={today} defaultValue={initial?.logDate ?? today} />
            </Field>
            <Field label="Shift (optional)" htmlFor={`${p}shift`} error={fe.shift}>
              <Input id={`${p}shift`} name="shift" maxLength={40} defaultValue={initial?.shift ?? ""} placeholder="Morning" />
            </Field>
            {batches.length > 1 || correcting ? (
              <Field label="Batch" htmlFor={`${p}batchId`} error={fe.batchId}>
                <Select id={`${p}batchId`} name="batchId" defaultValue={initial?.batchId ?? batches[0]?.id ?? ""}>
                  <option value="">Whole order</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>{b.batchNumber}</option>
                  ))}
                </Select>
              </Field>
            ) : (
              batches[0] && <input type="hidden" name="batchId" value={batches[0].id} />
            )}
          </MoreDetails>
        </>
      )}
    </ActionForm>
  );
}

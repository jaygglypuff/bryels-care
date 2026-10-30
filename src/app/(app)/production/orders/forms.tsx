"use client";
import { useMemo, useState, type ReactNode } from "react";
import { D, fmtQty } from "@/lib/qty";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { addDailyLogAction, approveProductionOrderAction, cancelProductionOrderAction, correctDailyLogAction, createProductionOrderAction } from "./actions";

/**
 * Client forms of the production order screens (ADR-074). Few fields visible; the rest under
 * "More details". The server validates everything again; these forms only collect input.
 */

type FormulaOption = { formulaId: string; productId: string; productName: string; productSku: string; referenceBatchSizeG: string | null };

function MoreDetails({ children }: { children: ReactNode }) {
  return (
    <details className="rounded-[14px] border border-line bg-surface-2/40 px-3.5 py-2.5">
      <summary className="min-h-[44px] cursor-pointer py-2.5 text-[14px] font-medium">More details</summary>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">{children}</div>
    </details>
  );
}

export function ProductionOrderForm({ formulas, lines, today }: { formulas: FormulaOption[]; lines: { id: string; code: string; name: string }[]; today: string }) {
  const products = useMemo(() => {
    const m = new Map<string, FormulaOption>();
    for (const f of formulas) if (!m.has(f.productId)) m.set(f.productId, f);
    return [...m.values()];
  }, [formulas]);
  const [productId, setProductId] = useState(products[0]?.productId ?? "");
  const ref = products.find((p) => p.productId === productId)?.referenceBatchSizeG;
  const [sizeKg, setSizeKg] = useState(ref ? D(ref).div(1000).toString() : "");
  return (
    <ActionForm action={createProductionOrderAction} submit="Create production order" pending="Creating…" variant="cta" size="lg" className="flex flex-col gap-5">
      {(fe) => (
        <>
          <Field label="What to make" htmlFor="productId" error={fe.productId}>
            <Select
              id="productId"
              name="productId"
              value={productId}
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How much (kg per batch)" htmlFor="batchSizeKg" error={fe.batchSizeKg} hint={ref ? `Usual size ${fmtQty(D(ref).div(1000), "kg", 1)}` : undefined}>
              <Input id="batchSizeKg" name="batchSizeKg" inputMode="decimal" value={sizeKg} onChange={(e) => setSizeKg(e.target.value)} />
            </Field>
            <Field label="Start date" htmlFor="plannedStart" error={fe.plannedStart}>
              <Input id="plannedStart" name="plannedStart" type="date" defaultValue={today} required />
            </Field>
          </div>
          <MoreDetails>
            <Field label="Number of batches" htmlFor="batchCount" error={fe.batchCount} hint="Usually 1.">
              <Input id="batchCount" name="batchCount" inputMode="numeric" defaultValue="1" />
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
          <fieldset className="rounded-[14px] border border-line px-3.5 py-3">
            <legend className="px-1 text-[14px] font-medium">Defects (how many pieces)</legend>
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

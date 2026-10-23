"use client";
import { useActionState, useState } from "react";
import { D, fmtDate, fmtQty } from "@/lib/qty";
import { Button, Field, Input, Select, Textarea, cx } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { Chip, StatusChip } from "@/ui/status";
import { completeBatchAction, completeStepAction, dispenseAction, startBatchAction } from "../actions";

type Person = { id: string; displayName: string };

export function StartBatchForm({ batchId }: { batchId: string }) {
  const [state, action] = useActionState(startBatchAction, null);
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="batchId" value={batchId} />
      <SubmitButton size="lg" variant="cta" pendingText="Starting…">
        Start batch
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export type LotOpt = { lotId: string; lotNumber: string; expiresOn: string | null; locationId: string; locationCode: string; locationName: string; qty: string };
export type IngredientView = {
  id: string;
  lineNo: number;
  materialCode: string;
  materialName: string;
  inciName: string | null;
  theoreticalQtyG: string;
  tolerancePct: string;
  minG: string;
  maxG: string;
  dispensedQtyG: string;
  status: string;
  records: { id: string; lotNumber: string; lotExpiresOn: string | null; locationCode: string; actualQtyG: string; isWithinTolerance: boolean; scaleCode: string | null; operator: string | null; checker: string | null; exceptionReason: string | null; recordedAt: string }[];
};

function toleranceState(actual: string, min: string, max: string): "empty" | "within" | "outside" | "invalid" {
  if (!actual.trim()) return "empty";
  if (!/^\d+(\.\d+)?$/.test(actual.trim())) return "invalid";
  const a = D(actual.trim());
  return a.gte(min) && a.lte(max) ? "within" : "outside";
}

export function IngredientRow({
  batchId,
  ing,
  index,
  total,
  lots,
  checkers,
  operatorName,
  canWeigh,
  blockedReason,
  idempotencyKey,
}: {
  batchId: string;
  ing: IngredientView;
  index: number;
  total: number;
  lots: LotOpt[];
  checkers: Person[];
  operatorName: string;
  canWeigh: boolean;
  blockedReason: string | null;
  idempotencyKey: string;
}) {
  const [open, setOpen] = useState(false);
  const [actual, setActual] = useState("");
  const firstLot = lots[0] ? `${lots[0].lotId}|${lots[0].locationId}` : "";
  const [lotLocation, setLotLocation] = useState(firstLot);
  const [scale, setScale] = useState("SC-01");
  const [checkerId, setCheckerId] = useState("");
  const [reason, setReason] = useState("");
  const [state, action] = useActionState(dispenseAction, null);
  const tol = toleranceState(actual, ing.minG, ing.maxG);
  const fe = state?.fieldErrors ?? {};
  const rec = ing.records[0];
  const pending = ing.status === "pending";

  return (
    <li className="rounded-[14px] border border-line bg-surface p-3.5 sm:p-4" data-testid={`ingredient-${ing.lineNo}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Ingredient {index + 1} of {total} · {ing.materialCode}
          </p>
          <p className="text-[16px] font-semibold text-fg">{ing.materialName}</p>
          {ing.inciName && <p className="text-[12px] text-muted">INCI: {ing.inciName}</p>}
        </div>
        <StatusChip status={ing.status} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Theoretical</dt>
          <dd className="tabular text-[15px] font-semibold">{fmtQty(ing.theoreticalQtyG, "g", 1)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Tolerance ±{fmtQty(ing.tolerancePct, "%", 2)}</dt>
          <dd className="tabular">
            {fmtQty(ing.minG, "", 1)} – {fmtQty(ing.maxG, "g", 1)}
          </dd>
          <dd className="text-[11px] text-[var(--warn-fg)]">placeholder pending process-owner approval</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Dispensed</dt>
          <dd className="tabular text-[15px] font-semibold">{pending ? "—" : fmtQty(ing.dispensedQtyG, "g", 1)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">Lot</dt>
          <dd className="tabular">{rec ? `${rec.lotNumber} · ${rec.locationCode}` : "—"}</dd>
        </div>
      </dl>

      {rec && (
        <div className={cx("mt-3 rounded-[10px] border px-3 py-2 text-[12px]", rec.isWithinTolerance ? "border-line bg-surface-2/60 text-fg-2" : "border-[var(--warn-bd)] bg-[var(--warn-bg)] text-[var(--warn-fg)]")}>
          Weighed by <b>{rec.operator}</b>, checked by <b>{rec.checker}</b>
          {rec.scaleCode ? ` on scale ${rec.scaleCode}` : ""} · lot expires {fmtDate(rec.lotExpiresOn)}
          {!rec.isWithinTolerance && (
            <span className="block">
              Outside tolerance. Exception reason: {rec.exceptionReason}
            </span>
          )}
        </div>
      )}

      {pending && (
        <div className="mt-3">
          {!canWeigh ? (
            blockedReason && <p className="text-[12px] text-muted">{blockedReason}</p>
          ) : !open ? (
            <Button type="button" size="lg" onClick={() => setOpen(true)} className="w-full sm:w-auto">
              Weigh {ing.materialName}
            </Button>
          ) : (
            <form action={action} className="mt-1 flex flex-col gap-4 rounded-[12px] border border-line-strong p-3.5" data-testid="weigh-form">
              <input type="hidden" name="batchId" value={batchId} />
              <input type="hidden" name="batchMaterialId" value={ing.id} />
              <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
              {lots.length === 0 ? (
                <p className="rounded-[10px] border border-[var(--bad-bd)] bg-[var(--bad-bg)] px-3 py-2 text-[13px] text-[var(--bad-fg)]">
                  No released, unexpired lot of {ing.materialName} with stock at this site. Ask the warehouse or QA before weighing.
                </p>
              ) : (
                <Field label="Material lot (FEFO: earliest expiry first)" htmlFor={`lot-${ing.id}`} error={fe.lotLocation}>
                  <Select id={`lot-${ing.id}`} name="lotLocation" value={lotLocation} onChange={(e) => setLotLocation(e.target.value)}>
                    {lots.map((l, i) => (
                      <option key={`${l.lotId}|${l.locationId}`} value={`${l.lotId}|${l.locationId}`}>
                        {l.lotNumber} · {l.locationCode} · exp {fmtDate(l.expiresOn)} · {fmtQty(l.qty, "g", 1)} available{i === 0 ? " · recommended" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Actual weight (g)" htmlFor={`actual-${ing.id}`} error={fe.actualQtyG}>
                  <Input
                    id={`actual-${ing.id}`}
                    name="actualQtyG"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={fmtQty(ing.theoreticalQtyG, "", 1).replace(/,/g, "")}
                    value={actual}
                    onChange={(e) => setActual(e.target.value)}
                    className="text-[18px] tabular"
                    required
                  />
                </Field>
                <Field label="Scale" htmlFor={`scale-${ing.id}`} error={fe.scaleCode}>
                  <Input id={`scale-${ing.id}`} name="scaleCode" value={scale} onChange={(e) => setScale(e.target.value)} />
                </Field>
              </div>
              <div aria-live="polite">
                {tol === "within" && <Chip tone="ok">Within tolerance</Chip>}
                {tol === "outside" && (
                  <Chip tone="warn">
                    Outside tolerance by {fmtQty(D(actual).minus(ing.theoreticalQtyG), "g", 1)} — exception reason required
                  </Chip>
                )}
                {tol === "invalid" && <Chip tone="bad">Enter grams as a number, e.g. 3723.2</Chip>}
              </div>
              {tol === "outside" && (
                <Field label="Exception reason (required outside tolerance)" htmlFor={`reason-${ing.id}`} error={fe.exceptionReason}>
                  <Textarea id={`reason-${ing.id}`} name="exceptionReason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What happened and what was decided, e.g. last container, supervisor informed." />
                </Field>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Operator" htmlFor={`op-${ing.id}`}>
                  <Input id={`op-${ing.id}`} value={`${operatorName} (you)`} readOnly className="bg-surface-2" />
                </Field>
                <Field label="Checker (must be another person)" htmlFor={`checker-${ing.id}`} error={fe.checkerId}>
                  <Select id={`checker-${ing.id}`} name="checkerId" value={checkerId} onChange={(e) => setCheckerId(e.target.value)} required>
                    <option value="" disabled>
                      Choose checker…
                    </option>
                    {checkers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.displayName}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <FormMessage state={state} />
              <div className="flex flex-wrap gap-2">
                <SubmitButton size="lg" variant={tol === "outside" ? "secondary" : "primary"} pendingText="Posting…" disabled={lots.length === 0}>
                  {tol === "outside" ? "Record exception" : "Confirm weight"}
                </SubmitButton>
                <Button type="button" variant="ghost" size="lg" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
      {!pending && state?.ok && <div className="mt-2"><FormMessage state={state} /></div>}
    </li>
  );
}

export function StepForm({
  batchId,
  stepNo,
  stepKind,
  checkers,
  operatorName,
  blockedReason,
}: {
  batchId: string;
  stepNo: number;
  stepKind: string;
  checkers: Person[];
  operatorName: string;
  blockedReason: string | null;
}) {
  const [state, action] = useActionState(completeStepAction, null);
  const [checkerId, setCheckerId] = useState("");
  const [readings, setReadings] = useState("");
  if (blockedReason) {
    return (
      <div className="mt-3">
        <p className="rounded-[10px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-3 py-2 text-[13px] text-[var(--warn-fg)]">{blockedReason}</p>
        <FormMessage state={state} />
      </div>
    );
  }
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="mt-3 flex flex-col gap-3" data-testid="step-form">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="stepNo" value={stepNo} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Conducted by" htmlFor={`cb-${stepNo}`}>
          <Input id={`cb-${stepNo}`} value={`${operatorName} (you)`} readOnly className="bg-surface-2" />
        </Field>
        <Field label="Checked by" htmlFor={`chk-${stepNo}`} error={fe.checkerId}>
          <Select id={`chk-${stepNo}`} name="checkerId" value={checkerId} onChange={(e) => setCheckerId(e.target.value)} required>
            <option value="" disabled>
              Choose checker…
            </option>
            {checkers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={stepKind === "process" ? "Readings (temperature, time, observations)" : "Readings or notes (optional)"} htmlFor={`rd-${stepNo}`} error={fe.readings}>
        <Input id={`rd-${stepNo}`} name="readings" value={readings} onChange={(e) => setReadings(e.target.value)} placeholder={stepKind === "process" ? "e.g. Mix temp 48 °C, trace at 22 min" : "Optional"} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton size="lg" pendingText="Saving…" className="w-full sm:w-auto sm:self-start">
        Complete step {stepNo}
      </SubmitButton>
    </form>
  );
}

export function CompleteBatchForm({
  batchId,
  unitNetMassG,
  theoreticalYieldG,
  idempotencyKey,
}: {
  batchId: string;
  unitNetMassG: string;
  theoreticalYieldG: string;
  idempotencyKey: string;
}) {
  const [state, action] = useActionState(completeBatchAction, null);
  const [units, setUnits] = useState("");
  const [remarks, setRemarks] = useState("");
  const valid = /^\d+$/.test(units.trim()) && Number(units) > 0;
  const outG = valid ? D(units.trim()).mul(unitNetMassG) : null;
  const yieldPct = outG && D(theoreticalYieldG).gt(0) ? outG.div(theoreticalYieldG).mul(100) : null;
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" data-testid="complete-form">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Finished units (pcs)" htmlFor="actualUnits" error={fe.actualUnits} hint={`Each unit ${fmtQty(unitNetMassG, "g", 0)} net`}>
          <Input id="actualUnits" name="actualUnits" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} className="text-[18px] tabular" required />
        </Field>
        <div className="rounded-[12px] border border-line bg-surface-2/60 p-3 text-[13px]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Preview (server recalculates)</p>
          <p className="mt-1 tabular">Actual output: {outG ? fmtQty(outG, "g", 0) : "—"}</p>
          <p className="tabular">Theoretical yield: {fmtQty(theoreticalYieldG, "g", 0)}</p>
          <p className="tabular font-semibold">Yield: {yieldPct ? fmtQty(yieldPct, "%", 2) : "—"}</p>
        </div>
      </div>
      <Field label="Remarks (optional)" htmlFor="remarks" error={fe.remarks}>
        <Textarea id="remarks" name="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Anything QA should know about this batch" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton size="lg" variant="cta" pendingText="Completing…" className="w-full sm:w-auto sm:self-start">
        Complete batch and send to QA
      </SubmitButton>
    </form>
  );
}

"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select } from "@/ui/core";
import { FormMessage } from "@/ui/form";
import { useActionForm } from "../_kit/forms";
import { createAdjustmentAction } from "./actions";

type LotOpt = { id: string; label: string; uom: string; locations: { id: string; code: string; qty: string }[] };
type Loc = { id: string; code: string };

export function AdjustmentForm({ lots, locations, reasons, idempotencyKey }: { lots: LotOpt[]; locations: Loc[]; reasons: readonly { code: string; label: string; requiresNote: boolean }[]; idempotencyKey: string }) {
  const { state, pending, onSubmit } = useActionForm(createAdjustmentAction);
  const [rows, setRows] = useState<{ key: number; lotId: string; locationId: string }[]>([{ key: 0, lotId: "", locationId: "" }]);
  const fe = state?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="lineCount" value={rows.length} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Reason" htmlFor="reasonCode" error={fe.reasonCode}>
          <Select id="reasonCode" name="reasonCode" defaultValue="" required>
            <option value="" disabled>Choose…</option>
            {reasons.filter((r) => r.code !== "found_unlabelled").map((r) => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Details" htmlFor="reasonNote" error={fe.reasonNote} hint="Required for reasons that need an explanation (e.g. Other).">
          <Input id="reasonNote" name="reasonNote" maxLength={500} placeholder="e.g. Drum dented during unloading" />
        </Field>
      </div>
      {rows.map((r, i) => {
        const lot = lots.find((l) => l.id === r.lotId);
        return (
          <fieldset key={r.key} className="grid min-w-0 gap-3 rounded-[16px] border border-line p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] sm:items-end">
            <legend className="px-1 text-[12px] font-medium text-muted">Line {i + 1}</legend>
            <Field label="Lot" htmlFor={`lotId_${i}`}>
              <Select id={`lotId_${i}`} name={`lotId_${i}`} value={r.lotId} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, lotId: e.target.value, locationId: lots.find((l) => l.id === e.target.value)?.locations[0]?.id ?? "" } : x)))}>
                <option value="">Choose…</option>
                {lots.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Location" htmlFor={`locationId_${i}`}>
              <Select id={`locationId_${i}`} name={`locationId_${i}`} value={r.locationId} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, locationId: e.target.value } : x)))}>
                <option value="">Choose…</option>
                {locations.map((l) => {
                  const have = lot?.locations.find((x) => x.id === l.id);
                  return <option key={l.id} value={l.id}>{l.code}{have ? ` · ${have.qty} ${lot!.uom}` : ""}</option>;
                })}
              </Select>
            </Field>
            <Field label="Direction" htmlFor={`direction_${i}`}>
              <Select id={`direction_${i}`} name={`direction_${i}`} defaultValue="decrease">
                <option value="decrease">Decrease</option>
                <option value="increase">Increase</option>
              </Select>
            </Field>
            <Field label={`Quantity${lot ? ` (${lot.uom})` : ""}`} htmlFor={`qty_${i}`}>
              <Input id={`qty_${i}`} name={`qty_${i}`} inputMode="decimal" autoComplete="off" />
            </Field>
            <Field label="Unit cost ₱ (optional)" htmlFor={`unitCost_${i}`}>
              <Input id={`unitCost_${i}`} name={`unitCost_${i}`} inputMode="decimal" autoComplete="off" />
            </Field>
            <input type="hidden" name={`note_${i}`} value="" />
            <Button type="button" variant="ghost" aria-label={`Remove line ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
              <Trash2 size={16} />
            </Button>
          </fieldset>
        );
      })}
      <div>
        <Button type="button" variant="secondary" onClick={() => setRows([...rows, { key: Date.now(), lotId: "", locationId: "" }])} disabled={rows.length >= 100}>
          <Plus size={16} /> Add line
        </Button>
      </div>
      <p className="text-[12px] text-muted">Leave the unit cost empty when it is not known; the approval rule then treats the value as unknown (see settings). Found stock without a label is handled by a site manager.</p>
      <FormMessage state={state} />
      <Button type="submit" variant="cta" size="lg" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Saving draft…" : "Save draft"}
      </Button>
    </form>
  );
}

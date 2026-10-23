"use client";
import { useActionState, useState } from "react";
import Decimal from "decimal.js";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { saveFormulaDraftAction } from "../../../../_eng/actions";

type Material = { id: string; code: string; name: string; baseUom: string };
type Row = { key: number; materialId: string; quantityG: string; tolMode: "pct" | "abs"; tol: string; phaseCode: string; scaling: "proportional" | "fixed" };
export type EditorInit = {
  revisionId: string;
  referenceBatchSizeG: string;
  theoreticalYieldPct: string;
  effectiveFrom: string | null;
  changeSummary: string | null;
  notes: string | null;
  lines: { materialId: string; quantityG: string; tolerancePct: string | null; toleranceAbsG: string | null; phaseCode: string | null; scaling: string }[];
};

const strip = (v: string) => (v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v);
const dec = (v: string) => {
  try {
    const d = new Decimal(v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
};

/**
 * Draft line editor (US-3-01). Every line needs exactly one tolerance (percentage or grams, no
 * system default, A-PROC-03). The unrounded line sum is shown next to the reference batch size so a
 * rounding difference (e.g. 17,600.1 g vs 17,600 g) is visible rather than hidden.
 */
export function FormulaLineEditor({ init, materials, today }: { init: EditorInit; materials: Material[]; today: string }) {
  const [state, action] = useActionState<ActionState, FormData>(saveFormulaDraftAction, null);
  let seq = 0;
  const [rows, setRows] = useState<Row[]>(() =>
    init.lines.map((l) => ({
      key: ++seq,
      materialId: l.materialId,
      quantityG: strip(l.quantityG),
      tolMode: l.toleranceAbsG !== null ? "abs" : "pct",
      tol: strip(l.toleranceAbsG ?? l.tolerancePct ?? ""),
      phaseCode: l.phaseCode ?? "",
      scaling: l.scaling === "fixed" ? "fixed" : "proportional",
    })),
  );
  const [nextKey, setNextKey] = useState(init.lines.length + 1);
  const [size, setSize] = useState(strip(init.referenceBatchSizeG));
  const [yieldPct, setYieldPct] = useState(strip(init.theoreticalYieldPct));
  const [effectiveFrom, setEffectiveFrom] = useState(init.effectiveFrom ?? "");
  const [changeSummary, setChangeSummary] = useState(init.changeSummary ?? "");
  const [notes, setNotes] = useState(init.notes ?? "");
  const fe = state?.fieldErrors ?? {};

  const sum = rows.reduce((acc, r) => acc.plus(dec(r.quantityG) ?? 0), new Decimal(0));
  const sizeD = dec(size);
  const diff = sizeD ? sum.minus(sizeD) : null;
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const payload = JSON.stringify({
    revisionId: init.revisionId,
    referenceBatchSizeG: size.trim(),
    theoreticalYieldPct: yieldPct.trim(),
    effectiveFrom: effectiveFrom || null,
    changeSummary: changeSummary || null,
    notes: notes || null,
    lines: rows.map((r) => ({
      materialId: r.materialId,
      quantityG: r.quantityG.trim(),
      tolerancePct: r.tolMode === "pct" ? r.tol.trim() || null : null,
      toleranceAbsG: r.tolMode === "abs" ? r.tol.trim() || null : null,
      phaseCode: r.phaseCode.trim() || null,
      scaling: r.scaling,
    })),
  });

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Reference batch size (g)" htmlFor="refsize" error={fe.referenceBatchSizeG}>
          <Input id="refsize" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} />
        </Field>
        <Field label="Theoretical yield (%)" htmlFor="yield" error={fe.theoreticalYieldPct}>
          <Input id="yield" inputMode="decimal" value={yieldPct} onChange={(e) => setYieldPct(e.target.value)} />
        </Field>
        <Field label="Proposed effective date" htmlFor="eff" error={fe.effectiveFrom} hint="The final approver confirms it.">
          <Input id="eff" type="date" min={today} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </Field>
      </div>
      <Field label="Change summary (what changes and why)" htmlFor="chg" error={fe.changeSummary}>
        <Input id="chg" value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} />
      </Field>

      <div className="flex flex-col gap-3">
        {rows.length === 0 && <p className="rounded-[12px] border border-dashed border-line-strong p-4 text-center text-[13px] text-muted">No ingredient lines yet. Add the first line.</p>}
        {rows.map((r, i) => {
          const err = (k: string) => fe[`lines.${i}.${k}`];
          return (
            <fieldset key={r.key} className="rounded-[16px] border border-line p-3" data-testid={`line-${i + 1}`}>
              <legend className="px-1 text-[12px] font-semibold text-muted">Line {i + 1}</legend>
              <div className="grid gap-3 sm:grid-cols-12">
                <div className="sm:col-span-4">
                  <Field label="Material" htmlFor={`m-${r.key}`} error={err("materialId")}>
                    <Select id={`m-${r.key}`} value={r.materialId} onChange={(e) => update(r.key, { materialId: e.target.value })}>
                      <option value="">Choose…</option>
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.code} · {m.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Quantity (g)" htmlFor={`q-${r.key}`} error={err("quantityG")}>
                    <Input id={`q-${r.key}`} inputMode="decimal" value={r.quantityG} onChange={(e) => update(r.key, { quantityG: e.target.value })} />
                  </Field>
                </div>
                <div className="sm:col-span-3">
                  <Field label="Tolerance" htmlFor={`t-${r.key}`} error={err("tolerancePct") ?? err("toleranceAbsG")}>
                    <div className="flex gap-2">
                      <Input id={`t-${r.key}`} inputMode="decimal" value={r.tol} onChange={(e) => update(r.key, { tol: e.target.value })} placeholder="required" />
                      <Select aria-label="Tolerance unit" value={r.tolMode} onChange={(e) => update(r.key, { tolMode: e.target.value as Row["tolMode"] })} className="w-[84px]">
                        <option value="pct">± %</option>
                        <option value="abs">± g</option>
                      </Select>
                    </div>
                  </Field>
                </div>
                <div className="sm:col-span-1">
                  <Field label="Phase" htmlFor={`p-${r.key}`} error={err("phaseCode")}>
                    <Input id={`p-${r.key}`} value={r.phaseCode} onChange={(e) => update(r.key, { phaseCode: e.target.value })} />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Scaling" htmlFor={`s-${r.key}`}>
                    <Select id={`s-${r.key}`} value={r.scaling} onChange={(e) => update(r.key, { scaling: e.target.value as Row["scaling"] })}>
                      <option value="proportional">Scales</option>
                      <option value="fixed">Fixed</option>
                    </Select>
                  </Field>
                </div>
              </div>
              <div className="mt-2 flex gap-1">
                <button type="button" aria-label={`Move line ${i + 1} up`} onClick={() => move(i, -1)} className="rounded-full p-2 hover:bg-surface-2">
                  <ArrowUp size={16} />
                </button>
                <button type="button" aria-label={`Move line ${i + 1} down`} onClick={() => move(i, 1)} className="rounded-full p-2 hover:bg-surface-2">
                  <ArrowDown size={16} />
                </button>
                <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="rounded-full p-2 text-[var(--bad-fg)] hover:bg-surface-2">
                  <Trash2 size={16} />
                </button>
              </div>
            </fieldset>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setRows((rs) => [...rs, { key: nextKey, materialId: "", quantityG: "", tolMode: "pct", tol: "", phaseCode: "", scaling: "proportional" }]);
            setNextKey((k) => k + 1);
          }}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-full border border-line px-4 text-[14px] font-medium hover:bg-surface-2"
        >
          <Plus size={16} /> Add line
        </button>
      </div>

      <div className="rounded-[12px] border border-line bg-surface-2/60 p-3 text-[13px] tabular" aria-live="polite">
        Sum of lines: <b>{sum.toString()} g</b> · reference batch size: <b>{sizeD ? sizeD.toString() : "—"} g</b>
        {diff && !diff.isZero() && <span className="block text-[12px] text-[var(--warn-fg)]">Difference {diff.toString()} g, shown unrounded (rounding of line quantities, F-06). Check it is intended.</span>}
      </div>
      <Field label="Notes (optional)" htmlFor="notes" error={fe.notes}>
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {fe.lines && <p className="text-[12px] text-[var(--bad-fg)]">{fe.lines}</p>}
      <FormMessage state={state} />
      <SubmitButton variant="primary" pendingText="Saving draft…">
        Save draft
      </SubmitButton>
    </form>
  );
}

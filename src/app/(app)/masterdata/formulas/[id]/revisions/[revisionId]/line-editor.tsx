"use client";
import { useActionState, useEffect, useState } from "react";
import Decimal from "decimal.js";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { saveFormulaDraftAction } from "../../../../_eng/actions";

type Material = { id: string; code: string; name: string; baseUom: string; kind?: string };
type Alt = { materialId: string; ratio: string };
type Row = { key: number; materialId: string; quantityG: string; tolMode: "pct" | "abs"; tol: string; phaseCode: string; scaling: "proportional" | "fixed"; isCritical: boolean; requiresChecker: boolean; alts: Alt[] };
export type EditorInit = {
  revisionId: string;
  referenceBatchSizeG: string;
  theoreticalYieldPct: string;
  effectiveFrom: string | null;
  changeSummary: string | null;
  notes: string | null;
  lines: { materialId: string; quantityG: string; tolerancePct: string | null; toleranceAbsG: string | null; phaseCode: string | null; scaling: string; isCritical?: boolean; requiresChecker?: boolean; alternatives?: { materialId: string; ratio: string }[] }[];
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
 * Draft line editor (US-3-01), grade-5 words (ADR-088): ingredient, amount, allowed difference, batch
 * weight, expected amount made, use from. Every line needs exactly one allowed difference (percentage
 * or grams, no system default, A-PROC-03). The unrounded gram total of the ingredients is shown next
 * to the batch weight so a rounding difference is visible; packaging lines (pieces, ADR-094) are
 * outside that total.
 */
export function FormulaLineEditor({ init, materials, today }: { init: EditorInit; materials: Material[]; today: string }) {
  const [state, action] = useActionState<ActionState, FormData>(saveFormulaDraftAction, null);
  // React 19 resets a form after its action, which showed every controlled select as "Choose…" although the
  // draft was saved; drawing the form again from the kept state after each save shows the saved values.
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (state) setRound((r) => r + 1);
  }, [state]);
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
      // Kept as stored: before this, every save reset both flags to the schema defaults (true).
      isCritical: l.isCritical ?? true,
      requiresChecker: l.requiresChecker ?? false,
      alts: (l.alternatives ?? []).map((a) => ({ materialId: a.materialId, ratio: strip(a.ratio) })),
    })),
  );
  const [nextKey, setNextKey] = useState(init.lines.length + 1);
  const [size, setSize] = useState(strip(init.referenceBatchSizeG));
  const [yieldPct, setYieldPct] = useState(strip(init.theoreticalYieldPct));
  const [effectiveFrom, setEffectiveFrom] = useState(init.effectiveFrom ?? "");
  const [changeSummary, setChangeSummary] = useState(init.changeSummary ?? "");
  const [notes, setNotes] = useState(init.notes ?? "");
  const fe = state?.fieldErrors ?? {};

  const kindOf = new Map(materials.map((m) => [m.id, m.kind]));
  const isPack = (r: Row) => kindOf.get(r.materialId) === "packaging";
  // Packaging lines hold pieces, not grams (ADR-094): never added to the gram total.
  const sum = rows.reduce((acc, r) => (isPack(r) ? acc : acc.plus(dec(r.quantityG) ?? 0)), new Decimal(0));
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
      isCritical: r.isCritical,
      requiresChecker: r.requiresChecker,
      // ADR-104 §1b: approved with the recipe; offered at weighing as "Use the approved alternative".
      alternatives: isPack(r) ? [] : r.alts.filter((a) => a.materialId).map((a) => ({ materialId: a.materialId, ratio: a.ratio.trim() || "1", notes: null })),
    })),
  });

  return (
    <form key={round} action={action} className="flex flex-col gap-5">
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Batch weight (g)" htmlFor="refsize" error={fe.referenceBatchSizeG}>
          <Input id="refsize" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} />
        </Field>
        <Field label="Expected amount made (%)" htmlFor="yield" error={fe.theoreticalYieldPct} hint="How much of the batch weight ends up as product.">
          <Input id="yield" inputMode="decimal" value={yieldPct} onChange={(e) => setYieldPct(e.target.value)} />
        </Field>
        <Field label="Use from (optional)" htmlFor="eff" error={fe.effectiveFrom} hint="The last person to say OK confirms the day.">
          <Input id="eff" type="date" min={today} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </Field>
      </div>
      <Field label="What changed and why" htmlFor="chg" error={fe.changeSummary}>
        <Input id="chg" value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} />
      </Field>

      <div className="flex flex-col gap-3">
        {rows.length === 0 && <p className="rounded-[8px] border border-dashed border-line-strong p-4 text-center text-[13px] text-muted">No ingredients yet. Add the first one.</p>}
        {rows.map((r, i) => {
          const err = (k: string) => fe[`lines.${i}.${k}`];
          return (
            <fieldset key={r.key} className="rounded-[8px] border border-line p-3" data-testid={`line-${i + 1}`}>
              <legend className="px-1 text-[12px] font-semibold text-muted">{isPack(r) ? `Packaging ${i + 1} (pieces)` : `Ingredient ${i + 1}`}</legend>
              <div className="grid gap-3 sm:grid-cols-12">
                <div className="sm:col-span-4">
                  <Field label={isPack(r) ? "Packaging" : "Ingredient"} htmlFor={`m-${r.key}`} error={err("materialId")}>
                    <Select id={`m-${r.key}`} value={r.materialId} onChange={(e) => update(r.key, { materialId: e.target.value })}>
                      <option value="">Choose…</option>
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label={isPack(r) ? "Pieces" : "Amount (g)"} htmlFor={`q-${r.key}`} error={err("quantityG")}>
                    <Input id={`q-${r.key}`} inputMode="decimal" value={r.quantityG} onChange={(e) => update(r.key, { quantityG: e.target.value })} />
                  </Field>
                </div>
                <div className="sm:col-span-3">
                  <Field label="Allowed difference" htmlFor={`t-${r.key}`} error={err("tolerancePct") ?? err("toleranceAbsG")}>
                    <div className="flex gap-2">
                      <Input id={`t-${r.key}`} inputMode="decimal" value={r.tol} onChange={(e) => update(r.key, { tol: e.target.value })} placeholder="needed" />
                      <Select aria-label="Allowed difference in % or grams" value={r.tolMode} onChange={(e) => update(r.key, { tolMode: e.target.value as Row["tolMode"] })} className="w-[84px]">
                        <option value="pct">± %</option>
                        <option value="abs">± g</option>
                      </Select>
                    </div>
                  </Field>
                </div>
                <div className="sm:col-span-1">
                  <Field label="Part" htmlFor={`p-${r.key}`} error={err("phaseCode")}>
                    <Input id={`p-${r.key}`} value={r.phaseCode} onChange={(e) => update(r.key, { phaseCode: e.target.value })} />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Bigger batch" htmlFor={`s-${r.key}`}>
                    <Select id={`s-${r.key}`} value={r.scaling} onChange={(e) => update(r.key, { scaling: e.target.value as Row["scaling"] })}>
                      <option value="proportional">Grows with it</option>
                      <option value="fixed">Stays the same</option>
                    </Select>
                  </Field>
                </div>
              </div>
              <label className="mt-2 flex min-h-[44px] items-center gap-2 text-[13px]">
                <input type="checkbox" className="h-5 w-5" checked={r.requiresChecker} onChange={(e) => update(r.key, { requiresChecker: e.target.checked })} />
                Needs a second person to check the weighing
              </label>
              {!isPack(r) && (
                <details className="mt-1 text-[13px]" open={r.alts.length > 0} data-testid={`alternatives-${i + 1}`}>
                  <summary className="min-h-[44px] cursor-pointer py-2 text-primary-text">Allowed alternatives (optional){r.alts.length ? ` · ${r.alts.length}` : ""}</summary>
                  <p className="text-[12px] text-muted">Another ingredient the operator may use instead, without asking QA each time. QA approves it with this recipe.</p>
                  {r.alts.map((a, j) => (
                    <div key={j} className="mt-2 grid grid-cols-[minmax(0,1fr)_110px_44px] items-end gap-2">
                      <Field label="Instead, use" htmlFor={`alt-${r.key}-${j}`} error={err(`alternatives.${j}.materialId`)}>
                        <Select id={`alt-${r.key}-${j}`} value={a.materialId} onChange={(e) => update(r.key, { alts: r.alts.map((x, k) => (k === j ? { ...x, materialId: e.target.value } : x)) })}>
                          <option value="">Choose…</option>
                          {materials.filter((m) => m.kind !== "packaging" && m.id !== r.materialId).map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Amount × " htmlFor={`altr-${r.key}-${j}`} error={err(`alternatives.${j}.ratio`)} hint="1 = same">
                        <Input id={`altr-${r.key}-${j}`} inputMode="decimal" value={a.ratio} onChange={(e) => update(r.key, { alts: r.alts.map((x, k) => (k === j ? { ...x, ratio: e.target.value } : x)) })} />
                      </Field>
                      <button type="button" aria-label="Remove this alternative" onClick={() => update(r.key, { alts: r.alts.filter((_, k) => k !== j) })} className="inline-flex size-11 items-center justify-center rounded-[6px] text-[var(--bad-fg)] hover:bg-surface-2">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  {r.alts.length < 5 && (
                    <button type="button" onClick={() => update(r.key, { alts: [...r.alts, { materialId: "", ratio: "1" }] })} className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-[6px] border border-line px-3 text-[13px]">
                      <Plus size={14} /> Add an alternative
                    </button>
                  )}
                </details>
              )}
              <div className="mt-2 flex gap-1">
                <button type="button" aria-label={`Move ingredient ${i + 1} up`} onClick={() => move(i, -1)} className="inline-flex size-11 items-center justify-center rounded-[6px] hover:bg-surface-2">
                  <ArrowUp size={16} />
                </button>
                <button type="button" aria-label={`Move ingredient ${i + 1} down`} onClick={() => move(i, 1)} className="inline-flex size-11 items-center justify-center rounded-[6px] hover:bg-surface-2">
                  <ArrowDown size={16} />
                </button>
                <button type="button" aria-label={`Remove ingredient ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="inline-flex size-11 items-center justify-center rounded-[6px] text-[var(--bad-fg)] hover:bg-surface-2">
                  <Trash2 size={16} />
                </button>
              </div>
            </fieldset>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setRows((rs) => [...rs, { key: nextKey, materialId: "", quantityG: "", tolMode: "pct", tol: "", phaseCode: "", scaling: "proportional", isCritical: true, requiresChecker: false, alts: [] }]);
            setNextKey((k) => k + 1);
          }}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-[6px] border border-line px-4 text-[14px] font-medium hover:bg-surface-2"
        >
          <Plus size={16} /> Add ingredient
        </button>
      </div>

      <div className="rounded-[8px] border border-line bg-surface-2/60 p-3 text-[13px] tabular" aria-live="polite">
        All ingredients together: <b>{sum.toString()} g</b> · batch weight: <b>{sizeD ? sizeD.toString() : "—"} g</b>
        {rows.some(isPack) && <span className="block text-[12px] text-muted">Packaging is counted in pieces and is not in the gram total.</span>}
        {diff && !diff.isZero() && <span className="block text-[12px] text-[var(--warn-fg)]">Difference {diff.toString()} g, shown exactly (rounding of the amounts, F-06). Check it is meant.</span>}
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

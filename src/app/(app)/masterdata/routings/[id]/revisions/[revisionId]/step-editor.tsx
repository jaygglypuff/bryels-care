"use client";
import { useActionState, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { saveRoutingDraftAction } from "../../../../_eng/actions";
import { AREAS_WORDS, WAIT_UNITS, type WaitUnit, minutesToWait, waitText, waitToMinutes } from "@/modules/masterdata/recipe-blocks";

export type ParamDraft = { code: string; name: string; valueKind: string; uom: string; minValue: string; targetValue: string; maxValue: string; isRequired: boolean };
export type StepDraft = {
  name: string;
  code: string;
  stepKind: string;
  area: string;
  instruction: string;
  workInstructionRevisionId: string;
  requiresChecker: boolean;
  blocksUntilComplete: boolean;
  requiresEquipment: boolean;
  equipmentKind: string;
  minDurationMinutes: string;
  /** The wait typed as amount + unit (minutes, hours, days, weeks); saved as whole minutes. */
  waitAmount?: string;
  waitUnit?: WaitUnit;
  parameters: ParamDraft[];
  /** One checklist item per line; prefix "[photo] " to require a photo. */
  checklistText: string;
};

const KIND_LABEL: Record<string, string> = {
  line_clearance: "Line clearance",
  dispensing: "Dispensing / weighing",
  process: "Process",
  in_process_qc: "In-process QC",
  filling: "Filling",
  cutting: "Cutting",
  curing: "Curing",
  hold: "Hold (minimum duration)",
  packaging: "Packaging",
  reconciliation: "Reconciliation",
  transfer: "Transfer",
  checklist: "Checklist",
};

const emptyStep = (): StepDraft => ({
  name: "",
  code: "",
  stepKind: "process",
  area: "",
  instruction: "",
  workInstructionRevisionId: "",
  // Second-person check off by default (owner usability test); weighing turns it on when chosen.
  requiresChecker: false,
  blocksUntilComplete: true,
  requiresEquipment: false,
  equipmentKind: "",
  minDurationMinutes: "",
  parameters: [],
  checklistText: "",
});


/** The parameter's internal code, made from its name when the user leaves it out (e.g. "Oil temperature" → oil_temperature). */
const paramCode = (name: string, i: number) => {
  const c = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "").slice(0, 40);
  return c || `reading_${i + 1}`;
};
/**
 * Draft routing editor (US-3-02): steps in order with kind, area, checker requirement, equipment
 * class, parameters (unit, min/target/max, required) and checklist items. The server validates
 * every rule again and returns field errors keyed by path (steps.2.area…).
 */
export function RoutingStepEditor({
  revisionId,
  initial,
  effectiveFrom,
  changeSummary,
  workInstructions,
  stepKinds,
  areas,
  equipmentKinds,
  today,
}: {
  revisionId: string;
  initial: StepDraft[];
  effectiveFrom: string | null;
  changeSummary: string | null;
  workInstructions: { id: string; label: string }[];
  stepKinds: readonly string[];
  areas: readonly string[];
  equipmentKinds: readonly string[];
  today: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveRoutingDraftAction, null);
  // React 19 resets a form after its action, which showed every controlled select as "Choose…" although the
  // draft was saved; drawing the form again from the kept state after each save shows the saved values.
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (state) setRound((r) => r + 1);
  }, [state]);
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    initial.map((s) => {
      const w = minutesToWait(s.minDurationMinutes.trim() ? Number(s.minDurationMinutes) : null);
      return { ...s, waitAmount: s.waitAmount ?? w.amount, waitUnit: s.waitUnit ?? w.unit };
    }),
  );
  const [eff, setEff] = useState(effectiveFrom ?? "");
  const [chg, setChg] = useState(changeSummary ?? "");
  const fe = state?.fieldErrors ?? {};
  const set = (i: number, patch: Partial<StepDraft>) => setSteps((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setParam = (i: number, k: number, patch: Partial<ParamDraft>) => set(i, { parameters: steps[i].parameters.map((p, j) => (j === k ? { ...p, ...patch } : p)) });
  const move = (i: number, d: number) =>
    setSteps((ss) => {
      const j = i + d;
      if (j < 0 || j >= ss.length) return ss;
      const c = [...ss];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  const n = (v: string) => (v.trim() ? v.trim() : null);
  const payload = JSON.stringify({
    revisionId,
    effectiveFrom: eff || null,
    changeSummary: chg || null,
    steps: steps.map((s) => ({
      code: n(s.code),
      name: s.name,
      stepKind: s.stepKind,
      area: n(s.area),
      instruction: n(s.instruction),
      workInstructionRevisionId: n(s.workInstructionRevisionId),
      requiresChecker: s.requiresChecker,
      blocksUntilComplete: s.blocksUntilComplete,
      requiresEquipment: s.requiresEquipment,
      equipmentKind: n(s.equipmentKind),
      minDurationMinutes: (s.waitAmount ?? "").trim() ? (Number.isNaN(waitToMinutes(s.waitAmount ?? "", s.waitUnit ?? "days")) ? -1 : waitToMinutes(s.waitAmount ?? "", s.waitUnit ?? "days")) : null,
      parameters: s.parameters.map((p, j) => ({ code: p.code.trim() || paramCode(p.name, j), name: p.name, valueKind: p.valueKind, uom: n(p.uom), minValue: n(p.minValue), targetValue: n(p.targetValue), maxValue: n(p.maxValue), isRequired: p.isRequired })),
      checklistItems: s.checklistText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => ({ text: l.replace(/^\[photo\]\s*/i, ""), requiresPhoto: /^\[photo\]/i.test(l), isBlocking: true })),
    })),
  });

  return (
    <form key={round} action={action} className="flex flex-col gap-4">
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Use from (optional)" htmlFor="r-eff" error={fe.effectiveFrom} hint="The last person to say OK confirms the day.">
          <Input id="r-eff" type="date" min={today} value={eff} onChange={(e) => setEff(e.target.value)} />
        </Field>
        <Field label="What changed and why" htmlFor="r-chg" error={fe.changeSummary}>
          <Input id="r-chg" value={chg} onChange={(e) => setChg(e.target.value)} />
        </Field>
      </div>
      {steps.length === 0 && <p className="rounded-[12px] border border-dashed border-line-strong p-4 text-center text-[13px] text-muted">No steps yet. Add the first step.</p>}
      {steps.map((s, i) => {
        const err = (k: string) => fe[`steps.${i}.${k}`];
        const pid = `st-${i}`;
        return (
          <fieldset key={i} className="rounded-[16px] border border-line p-3" data-testid={`edit-step-${i + 1}`}>
            <legend className="px-1 text-[12px] font-semibold text-muted">Step {i + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-6">
              <div className="sm:col-span-2">
                <Field label="What is the step called?" htmlFor={`${pid}-name`} error={err("name")}>
                  <Input id={`${pid}-name`} value={s.name} onChange={(e) => set(i, { name: e.target.value })} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="What kind of step?" htmlFor={`${pid}-kind`} error={err("stepKind")}>
                  <Select id={`${pid}-kind`} value={s.stepKind} onChange={(e) => set(i, { stepKind: e.target.value, ...(e.target.value === "dispensing" ? { requiresChecker: true } : {}) })}>
                    {stepKinds.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k] ?? k}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Where?" htmlFor={`${pid}-area`} error={err("area")}>
                  <Select id={`${pid}-area`} value={s.area} onChange={(e) => set(i, { area: e.target.value })}>
                    <option value="">—</option>
                    {areas.map((a) => (
                      <option key={a} value={a}>
                        {AREAS_WORDS[a] ?? a}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="sm:col-span-6">
                <Field label="What to do (shown to the worker)" htmlFor={`${pid}-ins`} error={err("instruction")}>
                  <Input id={`${pid}-ins`} value={s.instruction} onChange={(e) => set(i, { instruction: e.target.value })} />
                </Field>
              </div>
              <div className="sm:col-span-3">
                <Field label="How-to sheet (approved)" htmlFor={`${pid}-wi`} error={err("workInstructionRevisionId")}>
                  <Select id={`${pid}-wi`} value={s.workInstructionRevisionId} onChange={(e) => set(i, { workInstructionRevisionId: e.target.value })}>
                    <option value="">None</option>
                    {workInstructions.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Machine or tool needed" htmlFor={`${pid}-eq`} error={err("equipmentKind")}>
                  <Select id={`${pid}-eq`} value={s.equipmentKind} onChange={(e) => set(i, { equipmentKind: e.target.value, requiresEquipment: !!e.target.value })}>
                    <option value="">None</option>
                    {equipmentKinds.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="sm:col-span-6">
                <Field
                  label="Wait at least (for curing or resting steps)"
                  htmlFor={`${pid}-min`}
                  error={err("minDurationMinutes")}
                  hint={(() => {
                    const m = waitToMinutes(s.waitAmount ?? "", s.waitUnit ?? "days");
                    return m && !Number.isNaN(m) ? `Wait at least ${waitText(m)}.` : "Empty = no minimum time.";
                  })()}
                >
                  <div className="flex gap-2">
                    <Input id={`${pid}-min`} inputMode="decimal" className="w-28" value={s.waitAmount ?? ""} onChange={(e) => set(i, { waitAmount: e.target.value })} />
                    <Select aria-label="Wait unit" className="w-36" value={s.waitUnit ?? "days"} onChange={(e) => set(i, { waitUnit: e.target.value as WaitUnit })}>
                      {WAIT_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </Select>
                  </div>
                </Field>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-[13px]">
              <label className="flex min-h-[44px] items-center gap-2">
                <input type="checkbox" className="h-5 w-5" checked={s.requiresChecker} onChange={(e) => set(i, { requiresChecker: e.target.checked })} /> A second person checks and signs this step
              </label>
              <label className="flex min-h-[44px] items-center gap-2">
                <input type="checkbox" className="h-5 w-5" checked={s.blocksUntilComplete} onChange={(e) => set(i, { blocksUntilComplete: e.target.checked })} /> The next steps wait until this one is done
              </label>
            </div>

            <div className="mt-2">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Readings to write down</p>
              {err("parameters") && <p className="text-[12px] text-[var(--bad-fg)]">{err("parameters")}</p>}
              {s.parameters.map((p, k) => {
                const perr = (f: string) => fe[`steps.${i}.parameters.${k}.${f}`];
                return (
                  <div key={k} className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 rounded-[12px] bg-surface-2/60 p-2.5 sm:grid-cols-6">
                    <label className="col-span-2 flex flex-col gap-0.5 text-[12px] font-medium sm:col-span-3">
                      What to record
                      <Input aria-label="Parameter name" placeholder="e.g. Oil temperature" value={p.name} onChange={(e) => setParam(i, k, { name: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-0.5 text-[12px] font-medium">
                      Type
                      <Select aria-label="Value kind" value={p.valueKind} onChange={(e) => setParam(i, k, { valueKind: e.target.value })}>
                        <option value="numeric">Number</option>
                        <option value="text">Text</option>
                        <option value="boolean">Yes/no</option>
                      </Select>
                    </label>
                    <label className="flex flex-col gap-0.5 text-[12px] font-medium">
                      Unit
                      <Input aria-label="Unit" placeholder="°C, min, pcs" value={p.uom} onChange={(e) => setParam(i, k, { uom: e.target.value })} disabled={p.valueKind !== "numeric"} />
                    </label>
                    <div className="flex items-end justify-end">
                      <button type="button" aria-label="Remove parameter" onClick={() => set(i, { parameters: s.parameters.filter((_, j) => j !== k) })} className="inline-flex size-11 items-center justify-center rounded-full text-[var(--bad-fg)] hover:bg-surface-2">
                        <Trash2 size={15} />
                      </button>
                    </div>
                    {p.valueKind === "numeric" && (
                      <>
                        <label className="flex flex-col gap-0.5 text-[12px] font-medium">
                          Lowest OK
                          <Input aria-label="Minimum" placeholder="optional" inputMode="decimal" value={p.minValue} onChange={(e) => setParam(i, k, { minValue: e.target.value })} />
                        </label>
                        <label className="flex flex-col gap-0.5 text-[12px] font-medium">
                          Target
                          <Input aria-label="Target" placeholder="optional" inputMode="decimal" value={p.targetValue} onChange={(e) => setParam(i, k, { targetValue: e.target.value })} />
                        </label>
                        <label className="flex flex-col gap-0.5 text-[12px] font-medium">
                          Highest OK
                          <Input aria-label="Maximum" placeholder="optional" inputMode="decimal" value={p.maxValue} onChange={(e) => setParam(i, k, { maxValue: e.target.value })} />
                        </label>
                      </>
                    )}
                    {(perr("code") || perr("uom") || perr("minValue") || perr("targetValue") || perr("name")) && (
                      <p className="col-span-full text-[12px] text-[var(--bad-fg)]">{perr("code") ?? perr("name") ?? perr("uom") ?? perr("minValue") ?? perr("targetValue")}</p>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => set(i, { parameters: [...s.parameters, { code: "", name: "", valueKind: "numeric", uom: "", minValue: "", targetValue: "", maxValue: "", isRequired: true }] })}
                className="mt-2 inline-flex min-h-[40px] items-center gap-1 rounded-full border border-line px-3 text-[13px] hover:bg-surface-2"
              >
                <Plus size={14} /> Add a reading (parameter)
              </button>
              <p className="mt-1 text-[12px] text-muted">A parameter is a reading the operator records at this step, for example a temperature or a time. Lowest/highest OK are optional; a reading outside them is flagged.</p>
            </div>

            <div className="mt-3">
              <Field label="Checklist items (one per line; start with [photo] to require a photo)" htmlFor={`${pid}-cl`} error={err("checklistItems")}>
                <Textarea id={`${pid}-cl`} value={s.checklistText} onChange={(e) => set(i, { checklistText: e.target.value })} />
              </Field>
            </div>

            <div className="mt-2 flex gap-1">
              <button type="button" aria-label={`Move step ${i + 1} up`} onClick={() => move(i, -1)} className="inline-flex size-11 items-center justify-center rounded-full hover:bg-surface-2">
                <ArrowUp size={16} />
              </button>
              <button type="button" aria-label={`Move step ${i + 1} down`} onClick={() => move(i, 1)} className="inline-flex size-11 items-center justify-center rounded-full hover:bg-surface-2">
                <ArrowDown size={16} />
              </button>
              <button type="button" aria-label={`Remove step ${i + 1}`} onClick={() => setSteps((ss) => ss.filter((_, j) => j !== i))} className="inline-flex size-11 items-center justify-center rounded-full text-[var(--bad-fg)] hover:bg-surface-2">
                <Trash2 size={16} />
              </button>
            </div>
          </fieldset>
        );
      })}
      <button type="button" onClick={() => setSteps((ss) => [...ss, emptyStep()])} className="inline-flex min-h-[44px] items-center gap-2 self-start rounded-full border border-line px-4 text-[14px] font-medium hover:bg-surface-2">
        <Plus size={16} /> Add step
      </button>
      {fe.steps && <p className="text-[12px] text-[var(--bad-fg)]">{fe.steps}</p>}
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving draft…">Save draft</SubmitButton>
    </form>
  );
}

"use client";
import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { saveInspectionPlanAction } from "../../_eng/actions";

export type TestDraft = { testCode: string; name: string; method: string; valueKind: string; uom: string; specMin: string; specMax: string; specText: string; isRequired: boolean };

/** Draft test editor (US-3-03): a numeric test needs a unit and a minimum and/or maximum. Test codes are made from the names (ADR-088). */
export function PlanTestEditor({ init }: { init: { planId: string; name: string; samplingInstructions: string; effectiveFrom: string; changeSummary: string; isPlaceholder: boolean; tests: TestDraft[]; today: string } }) {
  const [state, action] = useActionState<ActionState, FormData>(saveInspectionPlanAction, null);
  const [name, setName] = useState(init.name);
  const [sampling, setSampling] = useState(init.samplingInstructions);
  const [eff, setEff] = useState(init.effectiveFrom);
  const [chg, setChg] = useState(init.changeSummary);
  const [placeholder, setPlaceholder] = useState(init.isPlaceholder);
  const [tests, setTests] = useState<TestDraft[]>(init.tests);
  const fe = state?.fieldErrors ?? {};
  const set = (i: number, patch: Partial<TestDraft>) => setTests((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const n = (v: string) => (v.trim() ? v.trim() : null);
  const payload = JSON.stringify({
    planId: init.planId,
    name,
    samplingInstructions: n(sampling),
    effectiveFrom: n(eff),
    changeSummary: n(chg),
    isPlaceholder: placeholder,
    tests: tests.map((t) => ({ testCode: t.testCode, name: t.name, method: n(t.method), valueKind: t.valueKind, uom: n(t.uom), specMin: n(t.specMin), specMax: n(t.specMax), specText: n(t.specText), isRequired: t.isRequired })),
  });
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="ip-name" error={fe.name}>
          <Input id="ip-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Use from (date)" htmlFor="ip-eff" error={fe.effectiveFrom}>
          <Input id="ip-eff" type="date" min={init.today} value={eff} onChange={(e) => setEff(e.target.value)} />
        </Field>
      </div>
      <MoreDetails open={!!(fe.samplingInstructions || fe.changeSummary)}>
        <Field label="How to take the sample" htmlFor="ip-sam" error={fe.samplingInstructions}>
          <Textarea id="ip-sam" value={sampling} onChange={(e) => setSampling(e.target.value)} />
        </Field>
        <Field label="What changed in this version" htmlFor="ip-chg" error={fe.changeSummary}>
          <Input id="ip-chg" value={chg} onChange={(e) => setChg(e.target.value)} />
        </Field>
        <label className="flex min-h-[44px] items-center gap-2 text-[13px]">
          <input type="checkbox" checked={placeholder} onChange={(e) => setPlaceholder(e.target.checked)} /> Example content only (QA has not confirmed it yet)
        </label>
      </MoreDetails>
      {tests.map((t, i) => {
        const err = (k: string) => fe[`tests.${i}.${k}`];
        return (
          <fieldset key={i} className="rounded-[16px] border border-line p-3" data-testid={`plan-test-${i + 1}`}>
            <legend className="px-1 text-[12px] font-semibold text-muted">Test {i + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-6">
              <div className="sm:col-span-4">
                <Field label="What is checked?" htmlFor={`tn-${i}`} error={err("name")}>
                  <Input id={`tn-${i}`} value={t.name} onChange={(e) => set(i, { name: e.target.value })} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Result type" htmlFor={`tk-${i}`}>
                  <Select id={`tk-${i}`} value={t.valueKind} onChange={(e) => set(i, { valueKind: e.target.value })}>
                    <option value="numeric">Number with limits</option>
                    <option value="text">Text criterion</option>
                    <option value="pass_fail">Pass / fail</option>
                  </Select>
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="How (method)" htmlFor={`tm-${i}`} error={err("method")}>
                  <Input id={`tm-${i}`} value={t.method} onChange={(e) => set(i, { method: e.target.value })} />
                </Field>
              </div>
              {t.valueKind === "numeric" ? (
                <>
                  <Field label="Unit" htmlFor={`tu-${i}`} error={err("uom")}>
                    <Input id={`tu-${i}`} value={t.uom} onChange={(e) => set(i, { uom: e.target.value })} />
                  </Field>
                  <Field label="Minimum" htmlFor={`tmin-${i}`} error={err("specMin")}>
                    <Input id={`tmin-${i}`} inputMode="decimal" value={t.specMin} onChange={(e) => set(i, { specMin: e.target.value })} />
                  </Field>
                  <Field label="Maximum" htmlFor={`tmax-${i}`} error={err("specMax")}>
                    <Input id={`tmax-${i}`} inputMode="decimal" value={t.specMax} onChange={(e) => set(i, { specMax: e.target.value })} />
                  </Field>
                </>
              ) : (
                <div className="sm:col-span-4">
                  <Field label="Acceptance criterion" htmlFor={`tt-${i}`} error={err("specText")}>
                    <Input id={`tt-${i}`} value={t.specText} onChange={(e) => set(i, { specText: e.target.value })} />
                  </Field>
                </div>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <label className="flex min-h-[44px] items-center gap-2 text-[13px]">
                <input type="checkbox" checked={t.isRequired} onChange={(e) => set(i, { isRequired: e.target.checked })} /> Must be done
              </label>
              <details className="min-w-0 flex-1 px-2">
                <summary className="min-h-[44px] cursor-pointer py-3 text-[13px] text-fg-2">Your own test code (optional)</summary>
                <Field label="Test code" htmlFor={`tc-${i}`} error={err("testCode")} hint="Leave empty: the system makes one from the test name.">
                  <Input id={`tc-${i}`} value={t.testCode} onChange={(e) => set(i, { testCode: e.target.value })} className="font-mono uppercase" />
                </Field>
              </details>
              <button type="button" aria-label={`Remove test ${i + 1}`} onClick={() => setTests((ts) => ts.filter((_, j) => j !== i))} className="rounded-full p-2 text-[var(--bad-fg)] hover:bg-surface-2">
                <Trash2 size={16} />
              </button>
            </div>
          </fieldset>
        );
      })}
      <button
        type="button"
        onClick={() => setTests((ts) => [...ts, { testCode: "", name: "", method: "", valueKind: "numeric", uom: "", specMin: "", specMax: "", specText: "", isRequired: true }])}
        className="inline-flex min-h-[44px] items-center gap-2 self-start rounded-full border border-line px-4 text-[14px] font-medium hover:bg-surface-2"
      >
        <Plus size={16} /> Add test
      </button>
      {fe.tests && <p className="text-[12px] text-[var(--bad-fg)]">{fe.tests}</p>}
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">Save draft</SubmitButton>
    </form>
  );
}

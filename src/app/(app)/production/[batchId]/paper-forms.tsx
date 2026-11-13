"use client";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { enterStepFromPaperAction, enterWeighingFromPaperAction, paperNotUsedAction } from "./paper-actions";

/**
 * ADR-134 client forms: "The paper record was not used" and the "Enter from the paper record" lines. Plain words, one
 * question per field, 44 px targets; the server checks everything again (page, time, people, tolerance, lot).
 */

type Person = { id: string; name: string };
type Choice = { value: string; label: string };

export function NotUsedForm({ batchId }: { batchId: string }) {
  return (
    <ActionForm action={paperNotUsedAction} hidden={{ batchId }} submit="Close the blank pages" pending="Closing…" variant="secondary" messageBelow>
      {(fe) => (
        <Field label="Why was it not used?" htmlFor="paper-not-used-reason" error={fe.reason} hint="Pages with lines typed from them are kept.">
          <Input id="paper-not-used-reason" name="reason" required minLength={5} maxLength={300} placeholder="For example: the system worked all day" />
        </Field>
      )}
    </ActionForm>
  );
}

/** Time, done by, checked by and (for weighing and moves) why it was on paper: the same block on every form. */
function PaperFacts({ id, fe, people, checkers, outage, outageReasons, showStart, checkerHint }: { id: string; fe: Record<string, string>; people: Person[]; checkers: Person[]; outage: boolean; outageReasons: Choice[]; showStart?: boolean; checkerHint?: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {showStart && (
        <Field label="Time started (if written)" htmlFor={`${id}-start`} error={fe.startedAt}>
          <Input id={`${id}-start`} name="startedAt" type="datetime-local" className="min-h-[44px]" />
        </Field>
      )}
      <Field label="Time written on the paper" htmlFor={`${id}-time`} error={fe.occurredAt} hint="When it happened, not now.">
        <Input id={`${id}-time`} name="occurredAt" type="datetime-local" required className="min-h-[44px]" />
      </Field>
      <Field label="Done by" htmlFor={`${id}-done`} error={fe.doneById}>
        <Select id={`${id}-done`} name="doneById" required defaultValue="" className="min-h-[44px]">
          <option value="" disabled>
            Choose the name on the paper
          </option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Checked by" htmlFor={`${id}-check`} error={fe.checkedById} hint={checkerHint ?? "Leave empty if nobody signed as checker: the check is then done in the system."}>
        <Select id={`${id}-check`} name="checkedById" defaultValue="" className="min-h-[44px]">
          <option value="">Nobody signed as checker</option>
          {checkers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      {outage && (
        <>
          <Field label="Why was it done on paper?" htmlFor={`${id}-why`} error={fe.outageReason}>
            <Select id={`${id}-why`} name="outageReason" required defaultValue="no_internet" className="min-h-[44px]">
              {outageReasons.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="More about why (needed for Other)" htmlFor={`${id}-whynote`} error={fe.outageNote}>
            <Input id={`${id}-whynote`} name="outageNote" maxLength={300} className="min-h-[44px]" />
          </Field>
        </>
      )}
    </div>
  );
}

export type WeighLine = { batchMaterialId: string; materialName: string; materialCode: string; uom: string; targetText: string; rangeText: string };

export function WeighLineForm({ batchId, paperRecordId, line, people, checkers, scales, outageReasons }: { batchId: string; paperRecordId: string; line: WeighLine; people: Person[]; checkers: Person[]; scales: Choice[]; outageReasons: Choice[] }) {
  const id = `w-${line.batchMaterialId.slice(-8)}`;
  return (
    <ActionForm action={enterWeighingFromPaperAction} hidden={{ batchId, paperRecordId, batchMaterialId: line.batchMaterialId }} submit={`Save ${line.materialName}`} pending="Saving…" variant="cta" size="lg">
      {(fe) => (
        <div className="flex flex-col gap-3">
          <p className="text-[14px]">
            Target <b>{line.targetText}</b> · allowed {line.rangeText}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Lot number on the paper" htmlFor={`${id}-lot`} error={fe.lotRef ?? fe.lot}>
              <Input id={`${id}-lot`} name="lotRef" required autoComplete="off" className="min-h-[44px] font-mono uppercase" />
            </Field>
            <Field label="Weight on the paper" htmlFor={`${id}-qty`} error={fe.qty}>
              <Input id={`${id}-qty`} name="qty" required inputMode="decimal" autoComplete="off" className="min-h-[44px]" />
            </Field>
            <Field label="Unit" htmlFor={`${id}-uom`} error={fe.uom}>
              <Select id={`${id}-uom`} name="uom" defaultValue={line.uom} className="min-h-[44px]">
                {(line.uom === "g" ? ["g", "kg"] : line.uom === "mL" ? ["mL", "L"] : [line.uom]).map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {scales.length > 0 && (
            <Field label="Scale" htmlFor={`${id}-scale`} error={fe.equipment ?? fe.equipmentRef}>
              <Select id={`${id}-scale`} name="equipmentRef" defaultValue="" className="min-h-[44px]">
                <option value="">Not written</option>
                {scales.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {fe.offPlanReasonCode && (
            <Field label="This is not the lot taken at Get materials. Why?" htmlFor={`${id}-offplan`} error={fe.offPlanReasonCode}>
              <Select id={`${id}-offplan`} name="offPlanReasonCode" defaultValue="other" className="min-h-[44px]">
                <option value="other">Other (write it below)</option>
              </Select>
              <Input name="offPlanNote" defaultValue="Lot written on the paper record" className="mt-2 min-h-[44px]" />
            </Field>
          )}
          <PaperFacts id={id} fe={fe} people={people} checkers={checkers} outage outageReasons={outageReasons} />
        </div>
      )}
    </ActionForm>
  );
}

export type StepForm = {
  stepNo: number;
  paperRecordId: string;
  outage: boolean;
  requiresEquipment: boolean;
  isHold: boolean;
  checklist: { id: string; itemNo: number; text: string }[];
  parameters: { id: string; name: string; uom: string | null; limits: string | null; valueKind: string }[];
};

export function StepFromPaperForm({ batchId, step, people, checkers, equipment, outageReasons }: { batchId: string; step: StepForm; people: Person[]; checkers: Person[]; equipment: Choice[]; outageReasons: Choice[] }) {
  const id = `s-${step.stepNo}`;
  return (
    <ActionForm action={enterStepFromPaperAction} hidden={{ batchId, paperRecordId: step.paperRecordId, stepNo: String(step.stepNo) }} submit={`Save step ${step.stepNo} as done`} pending="Saving…" variant="cta" size="lg">
      {(fe) => (
        <div className="flex flex-col gap-3">
          {step.checklist.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[14px] font-medium">Checklist: tick what the paper says</legend>
              {step.checklist.map((c) => (
                <div key={c.id} className="rounded-[12px] border border-line p-2.5">
                  <p className="text-[14px]">
                    {c.itemNo}. {c.text}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label={`Item ${c.itemNo}`}>
                    {(
                      [
                        ["yes", "Yes"],
                        ["no", "No"],
                        ["na", "N/A"],
                      ] as const
                    ).map(([v, l]) => (
                      <label key={v} className="flex min-h-[44px] min-w-[72px] cursor-pointer items-center gap-2 rounded-full border border-line px-3 text-[14px]">
                        <input type="radio" name={`answer-${c.id}`} value={v} required /> {l}
                      </label>
                    ))}
                  </div>
                  <Input name={`note-${c.id}`} placeholder="What the paper says for a No" aria-label={`Note for item ${c.itemNo}`} className="mt-2 min-h-[44px]" />
                  {fe[`note-${c.id}`] && <p className="text-[13px] text-[var(--bad-fg)]">{fe[`note-${c.id}`]}</p>}
                </div>
              ))}
            </fieldset>
          )}
          {step.parameters.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {step.parameters.map((p) => (
                <Field key={p.id} label={`${p.name}${p.uom ? ` (${p.uom})` : ""}`} htmlFor={`${id}-${p.id}`} hint={p.limits ? `Limits: ${p.limits}` : undefined}>
                  <Input id={`${id}-${p.id}`} name={`reading-${p.id}`} inputMode={p.valueKind === "numeric" ? "decimal" : undefined} autoComplete="off" className="min-h-[44px]" />
                </Field>
              ))}
            </div>
          )}
          {step.requiresEquipment && equipment.length > 0 && (
            <Field label="Machine written on the paper" htmlFor={`${id}-eq`} error={fe.equipment ?? fe.equipmentRef}>
              <Select id={`${id}-eq`} name="equipmentRef" defaultValue="" className="min-h-[44px]">
                <option value="">Choose the machine</option>
                {equipment.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <PaperFacts id={id} fe={fe} people={people} checkers={checkers} outage={step.outage} outageReasons={outageReasons} showStart={step.isHold} />
          <Field label="Notes on the paper (optional)" htmlFor={`${id}-notes`} error={fe.notes}>
            <Textarea id={`${id}-notes`} name="notes" maxLength={1000} rows={2} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

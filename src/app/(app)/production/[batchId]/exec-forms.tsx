"use client";
import { createContext, useActionState, useContext, useState, type ReactNode } from "react";
import { D, fmtQty } from "@/lib/qty";
import { parseScan } from "@/lib/scan/payload";
import { Button, Field, Input, Select, Textarea, cx } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { Chip } from "@/ui/status";
import {
  approveYieldAction,
  checkDispenseAction,
  checkStepAction,
  checklistAction,
  completeStepAction,
  countPackagingAction,
  decideScrapAction,
  dispenseAction,
  equipmentAction,
  issuePackagingAction,
  postToQuarantineAction,
  readingAction,
  returnStepAction,
  scrapAction,
  startStepAction,
  stepExceptionAction,
  voidDispenseAction,
  yieldAction,
} from "./actions";

/**
 * Operator-mode forms of the batch workspace (W2B). Big targets (min 44–56 px), one step at a
 * time, keypad-friendly inputs. Every form posts to a server action; the server decides. A second
 * person signs on this device with their own password (CoSign) or later from their own session.
 */

export type Person = { id: string; displayName: string };
const Hidden = ({ v }: { v: Record<string, string | number> }) => (
  <>
    {Object.entries(v).map(([k, x]) => (
      <input key={k} type="hidden" name={k} value={String(x)} />
    ))}
  </>
);

/** Whether a co-signer must also type their password (setting production.sign_off.require_password, ADR-078). */
const SignOffPassword = createContext(false);
export function SignOffProvider({ requirePassword, children }: { requirePassword: boolean; children: ReactNode }) {
  return <SignOffPassword.Provider value={requirePassword}>{children}</SignOffPassword.Provider>;
}

/** Second-person signature on this device: choose the person (and, when required, they type their password). */
export function CoSign({ prefix, people, title, hint, required = false }: { prefix: "checker" | "approver"; people: Person[]; title: string; hint?: string; required?: boolean }) {
  const [who, setWho] = useState("");
  const needsPassword = useContext(SignOffPassword);
  return (
    <fieldset className="grid gap-3 rounded-[12px] border border-line bg-surface-2/50 p-3 sm:grid-cols-2" data-testid={`cosign-${prefix}`}>
      <legend className="px-1 text-[12px] font-semibold uppercase tracking-wide text-muted">{title}</legend>
      <Field label="Name" htmlFor={`${prefix}-${title}`} hint={hint}>
        <Select id={`${prefix}-${title}`} name={`${prefix}Id`} value={who} onChange={(e) => setWho(e.target.value)} required={required}>
          <option value="">{required ? "Choose…" : "Sign later from their own device"}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </Select>
      </Field>
      {who && needsPassword && (
        <Field label="Their password (typed by them)" htmlFor={`${prefix}-pw-${title}`}>
          <Input id={`${prefix}-pw-${title}`} name={`${prefix}Password`} type="password" autoComplete="off" required />
        </Field>
      )}
    </fieldset>
  );
}

function useAct(action: (s: Awaited<ReturnType<typeof checklistAction>>, fd: FormData) => Promise<Awaited<ReturnType<typeof checklistAction>>>) {
  return useActionState(action, null);
}

/* ------------------------------------------------------------------ line clearance */

export type ChecklistItemView = { id: string; itemNo: number; text: string; isBlocking: boolean; requiresPhoto: boolean; answer: string | null; note: string | null };

export function ChecklistForm({ batchId, stepNo, items, checkers, idem }: { batchId: string; stepNo: number; items: ChecklistItemView[]; checkers: Person[]; idem: string }) {
  const [state, action] = useAct(checklistAction);
  const [answers, setAnswers] = useState<Record<string, string>>(Object.fromEntries(items.map((i) => [i.id, i.answer ?? ""])));
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" data-testid="checklist-form">
      <Hidden v={{ batchId, stepNo, itemIds: items.map((i) => i.id).join(","), idempotencyKey: idem }} />
      <ol className="flex flex-col gap-3">
        {items.map((it) => (
          <li key={it.id} className="rounded-[14px] border border-line p-3" data-testid={`check-item-${it.itemNo}`}>
            <p className="text-[15px] font-medium text-fg">
              {it.itemNo}. {it.text}
              {!it.isBlocking && <span className="ml-2 text-[12px] text-muted">(advisory)</span>}
            </p>
            {it.requiresPhoto && <p className="mt-1 text-[12px] text-[var(--warn-fg)]">This item needs a photo. Photo capture on this screen is not available yet; attach the photo and ask the supervisor.</p>}
            <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label={`Answer item ${it.itemNo}`}>
              {(["yes", "no", "na"] as const).map((a) => (
                <label
                  key={a}
                  className={cx(
                    "flex min-h-[48px] cursor-pointer items-center justify-center rounded-full border text-[15px] font-semibold",
                    answers[it.id] === a ? (a === "no" ? "border-[var(--bad-bd)] bg-[var(--bad-bg)] text-[var(--bad-fg)]" : "border-primary bg-[var(--green-50)] text-primary-text") : "border-line-strong bg-surface",
                  )}
                >
                  <input type="radio" className="sr-only" name={`answer-${it.id}`} value={a} checked={answers[it.id] === a} onChange={() => setAnswers({ ...answers, [it.id]: a })} />
                  {a === "na" ? "N/A" : a === "yes" ? "Yes" : "No"}
                </label>
              ))}
            </div>
            {fe[`answer-${it.id}`] && <p className="mt-1 text-[12px] text-[var(--bad-fg)]">{fe[`answer-${it.id}`]}</p>}
            {answers[it.id] === "no" && (
              <div className="mt-2">
                <Field label="What did you find and do? (required)" htmlFor={`note-${it.id}`} error={fe[`note-${it.id}`]}>
                  <Textarea id={`note-${it.id}`} name={`note-${it.id}`} defaultValue={it.note ?? ""} required />
                </Field>
              </div>
            )}
          </li>
        ))}
      </ol>
      <CoSign prefix="checker" people={checkers} title="Checked by" hint="Another person verifies the area." />
      <FormMessage state={state} />
      <SubmitButton size="lg" pendingText="Saving…" className="w-full sm:w-auto sm:self-start">
        Sign clearance (step {stepNo})
      </SubmitButton>
    </form>
  );
}

/* ------------------------------------------------------------------ weighing */

export type ScaleOpt = { id: string; code: string; name: string; usable: boolean; viaOverride: boolean; blocking: string[]; reasons: string[]; calibrationDueDate: string | null; capacity: string | null };
export type IngredientExec = { id: string; lineNo: number; materialCode: string; materialName: string; inciName: string | null; theoreticalQtyG: string; tolerancePct: string; minG: string; maxG: string; dispensedQtyG: string; status: string; recommended: string | null };
/** A lot the operator can weigh from: where it is and how much is there (base unit, grams). */
export type WeighLot = { lotNumber: string; locationCode: string; locationName: string; qty: string; expiresOn: string | null };

export function WeighForm({
  batchId,
  ing,
  scales,
  checkers,
  approvers,
  idem,
  replaces,
  lots = [],
  needsChecker = true,
}: {
  batchId: string;
  ing: IngredientExec;
  lots?: WeighLot[];
  needsChecker?: boolean;
  scales: ScaleOpt[];
  checkers: Person[];
  approvers: Person[];
  idem: string;
  replaces?: { id: string } | null;
}) {
  const [state, action] = useAct(dispenseAction);
  const [qty, setQty] = useState("");
  const [uom, setUom] = useState("g");
  const [lot, setLot] = useState(lots[0]?.lotNumber ?? "");
  const [loc, setLoc] = useState(lots[0]?.locationCode ?? "");
  const [typing, setTyping] = useState(lots.length === 0);
  const [partial, setPartial] = useState(false);
  const picked = lots.find((l) => l.lotNumber === lot && l.locationCode === loc) ?? null;
  const stillNeeded = D(ing.theoreticalQtyG).minus(ing.dispensedQtyG);
  const firstUsable = scales.find((s) => s.usable)?.code ?? "";
  const [scale, setScale] = useState(firstUsable);
  const fe = state?.fieldErrors ?? {};
  const scan = lot.trim() ? parseScan(lot) : null;
  const scanError = scan && (scan.kind === "invalid" || (scan.kind === "typed" && scan.type !== "LOT")) ? (scan.kind === "typed" ? `That is a ${scan.type} label. Scan the lot label on the container.` : "Not a lot label.") : null;
  const valid = /^\d+(\.\d+)?$/.test(qty.trim());
  const g = valid ? D(qty.trim()).mul(uom === "kg" ? 1000 : 1) : null;
  const total = g ? g.plus(ing.dispensedQtyG) : null;
  const tol: "empty" | "within" | "below" | "above" = !total ? "empty" : total.lt(ing.minG) ? "below" : total.gt(ing.maxG) ? "above" : "within";
  const outside = !partial && (tol === "below" || tol === "above");
  return (
    <form action={action} className="mt-1 flex flex-col gap-4 rounded-[12px] border border-line-strong p-3.5" data-testid="weigh-form">
      <Hidden v={{ batchId, batchMaterialId: ing.id, idempotencyKey: idem, uom }} />
      {replaces && <input type="hidden" name="supersedesId" value={replaces.id} />}
      {!typing ? (
        <Field label="1. Choose the lot" htmlFor={`lotpick-${ing.id}`} error={fe.lot ?? fe.location} hint="Oldest expiry first; lots already brought to production are at the top.">
          <Select
            id={`lotpick-${ing.id}`}
            value={`${lot}|${loc}`}
            onChange={(e) => {
              const [l, c] = e.target.value.split("|");
              setLot(l ?? "");
              setLoc(c ?? "");
            }}
            className="min-h-[52px] text-[15px]"
          >
            {lots.map((l) => (
              <option key={`${l.lotNumber}|${l.locationCode}`} value={`${l.lotNumber}|${l.locationCode}`}>
                {l.lotNumber} · {fmtQty(l.qty, "g", 1)} at {l.locationCode}
                {l.expiresOn ? ` · exp ${l.expiresOn}` : ""}
              </option>
            ))}
          </Select>
          <input type="hidden" name="lotRef" value={lot} />
          <input type="hidden" name="locationRef" value={loc} />
          {picked && D(picked.qty).lt(stillNeeded) && (
            <span className="mt-1 block text-[12.5px] text-[var(--warn-fg)]">
              Only {fmtQty(picked.qty, "g", 1)} in this lot; {fmtQty(stillNeeded, "g", 1)} still needed. Weigh what it has, tick &quot;Another lot follows&quot;, then weigh the rest from the next lot.
            </span>
          )}
          <button type="button" className="mt-1 text-[12.5px] text-primary-text underline" onClick={() => setTyping(true)}>
            Scan or type a lot instead
          </button>
        </Field>
      ) : (
        <>
          <Field label="1. Scan the lot label on the container" htmlFor={`lot-${ing.id}`} error={fe.lot ?? scanError ?? undefined} hint={lots.length === 0 ? "No usable lot of this material at this site. Receive it (and have it approved) first." : ing.recommended ? `Suggested: ${ing.recommended}` : undefined}>
            <Input id={`lot-${ing.id}`} name="lotRef" value={lot} onChange={(e) => setLot(e.target.value)} autoComplete="off" placeholder="BC:LOT:… or lot number" className="min-h-[52px] font-mono text-[16px]" required />
          </Field>
          <Field label="Location (only if the lot is in several places)" htmlFor={`loc-${ing.id}`} error={fe.location}>
            <Input id={`loc-${ing.id}`} name="locationRef" value={loc} onChange={(e) => setLoc(e.target.value)} autoComplete="off" placeholder="BC:LOC:… or code, e.g. A-01" />
          </Field>
          {lots.length > 0 && (
            <button type="button" className="self-start text-[12.5px] text-primary-text underline" onClick={() => setTyping(false)}>
              Choose from the list instead
            </button>
          )}
        </>
      )}
      <Field
        label="2. Scale"
        htmlFor={`scale-${ing.id}`}
        error={fe.equipment ?? (scales.length > 0 && !firstUsable ? "No scale can be used now. Record the cleaning or calibration, or ask for a controlled override (CX-CAL)." : undefined)}
      >
        <Select id={`scale-${ing.id}`} name="equipmentRef" value={scale} onChange={(e) => setScale(e.target.value)}>
          <option value="">{scales.length === 0 ? "No scale registered at this site" : "Choose a scale…"}</option>
          {scales.map((s) => (
            <option key={s.id} value={s.code} disabled={!s.usable}>
              {s.code} · {s.name}
              {s.calibrationDueDate ? ` · cal. due ${s.calibrationDueDate}` : ""}
              {!s.usable ? ` · blocked: ${s.blocking.join("; ")}` : s.viaOverride ? " · under approved override" : s.reasons.length ? ` · warning: ${s.reasons.join("; ")}` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
        <Field label={`3. Net weight (target ${fmtQty(ing.theoreticalQtyG, "g", 1)})`} htmlFor={`qty-${ing.id}`} error={fe.qty}>
          <Input id={`qty-${ing.id}`} name="qty" inputMode="decimal" autoComplete="off" value={qty} onChange={(e) => setQty(e.target.value)} className="min-h-[56px] text-[22px] tabular" required />
        </Field>
        <Field label="Unit" htmlFor={`uom-${ing.id}`}>
          <Select id={`uom-${ing.id}`} value={uom} onChange={(e) => setUom(e.target.value)} className="min-h-[56px]">
            <option value="g">g</option>
            <option value="kg">kg</option>
          </Select>
        </Field>
      </div>
      <details className="text-[13px]">
        <summary className="cursor-pointer text-primary-text">Gross and tare (optional)</summary>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Field label={`Gross (${uom})`} htmlFor={`gross-${ing.id}`}>
            <Input id={`gross-${ing.id}`} name="gross" inputMode="decimal" />
          </Field>
          <Field label={`Tare (${uom})`} htmlFor={`tare-${ing.id}`}>
            <Input id={`tare-${ing.id}`} name="tare" inputMode="decimal" />
          </Field>
        </div>
      </details>
      <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
        <input type="checkbox" name="partial" checked={partial} onChange={(e) => setPartial(e.target.checked)} className="size-5" />
        Another lot follows for this ingredient (split weighing)
      </label>
      <div aria-live="polite" className="flex flex-wrap gap-2">
        {tol === "within" && !partial && <Chip tone="ok">Within tolerance · line total {fmtQty(total!, "g", 1)}</Chip>}
        {outside && (
          <Chip tone="bad">
            Outside tolerance {fmtQty(ing.minG, "", 1)}–{fmtQty(ing.maxG, "g", 1)} · line total {fmtQty(total!, "g", 1)}
          </Chip>
        )}
        {partial && total && <Chip tone="info">Part weighing · line total {fmtQty(total, "g", 1)}</Chip>}
      </div>
      {replaces && (
        <Field label="Reason for the correction" htmlFor={`corr-${ing.id}`} error={fe.correctionReason}>
          <Input id={`corr-${ing.id}`} name="correctionReason" required />
        </Field>
      )}
      {outside && (
        <div className="flex flex-col gap-3 rounded-[12px] border border-[var(--bad-bd)] bg-[var(--bad-bg)]/40 p-3">
          <p className="text-[13px] text-[var(--bad-fg)]">Re-weigh, or request an exception: QA (or the site manager) approves on this device with their password. A deviation is opened.</p>
          <CoSign prefix="approver" people={approvers} title="Exception approved by" required />
          <Field label="Approver's reason" htmlFor={`exr-${ing.id}`} error={fe.exceptionReason}>
            <Textarea id={`exr-${ing.id}`} name="exceptionReason" required />
          </Field>
        </div>
      )}
      {needsChecker && <CoSign prefix="checker" people={checkers} title="Checked by" hint="Or the checker signs later from their own device." />}
      <FormMessage state={state} />
      <SubmitButton size="lg" variant={outside ? "secondary" : "primary"} pendingText="Saving…" disabled={!!scanError} className="w-full sm:w-auto sm:self-start">
        {outside ? "Request exception" : "Confirm weight"}
      </SubmitButton>
    </form>
  );
}

/** One-tap action for the signed-in person (check a weighing, check a step, start a step). */
export function OneTap({ kind, hidden, label, variant = "primary" }: { kind: "checkDispense" | "checkStep" | "startStep"; hidden: Record<string, string | number>; label: string; variant?: "primary" | "secondary" }) {
  const act = kind === "checkDispense" ? checkDispenseAction : kind === "checkStep" ? checkStepAction : startStepAction;
  const [state, action] = useAct(act);
  return (
    <form action={action} className="flex flex-col gap-1.5">
      <Hidden v={hidden} />
      <SubmitButton size="lg" variant={variant} pendingText="Saving…">
        {label}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function ReasonForm({ kind, hidden, label, reasonLabel, extra }: { kind: "void" | "return" | "approveYield"; hidden: Record<string, string>; label: string; reasonLabel: string; extra?: ReactNode }) {
  const act = kind === "void" ? voidDispenseAction : kind === "return" ? returnStepAction : approveYieldAction;
  const [state, action] = useAct(act);
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <form action={action} className="flex w-full flex-col gap-2 rounded-[12px] border border-line p-3">
      <Hidden v={hidden} />
      {extra}
      <Field label={reasonLabel} htmlFor={`reason-${kind}-${Object.values(hidden).join("-")}`} error={state?.fieldErrors?.reason}>
        <Textarea id={`reason-${kind}-${Object.values(hidden).join("-")}`} name="reason" required />
      </Field>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingText="Saving…">{label}</SubmitButton>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ process step */

export type ParamView = { id: string; code: string; name: string; valueKind: string; uom: string | null; limits: string; isRequired: boolean; reading: { value: string; isWithinLimits: boolean; recordedBy: string | null } | null };

export function ReadingForm({ batchId, stepNo, p, idem }: { batchId: string; stepNo: number; p: ParamView; idem: string }) {
  const [state, action] = useAct(readingAction);
  const [val, setVal] = useState("");
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-2 rounded-[12px] border border-line p-3" data-testid={`param-${p.code}`}>
      <Hidden v={{ batchId, stepNo, parameterId: p.id, idempotencyKey: idem }} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-medium">
          {p.name}
          {p.uom ? ` (${p.uom})` : ""}
          {!p.isRequired && <span className="ml-1 text-[12px] text-muted">optional</span>}
        </p>
        <span className="text-[12px] text-muted">Limits: {p.limits}</span>
      </div>
      {p.reading && (
        <p className="text-[13px]">
          Recorded <b>{p.reading.value}</b> by {p.reading.recordedBy}{" "}
          {p.reading.isWithinLimits ? <Chip tone="ok">Within limits</Chip> : <Chip tone="bad">Outside limits</Chip>}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {p.valueKind === "boolean" ? (
          <Select name="value" value={val} onChange={(e) => setVal(e.target.value)} className="min-h-[48px] max-w-[200px]" required>
            <option value="">Choose…</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        ) : (
          <Input name="value" value={val} onChange={(e) => setVal(e.target.value)} inputMode={p.valueKind === "numeric" ? "decimal" : "text"} className="min-h-[48px] max-w-[220px] text-[18px] tabular" aria-label={p.name} required />
        )}
        <SubmitButton pendingText="Saving…">{p.reading ? "Correct" : "Record"}</SubmitButton>
      </div>
      {p.reading && <Input name="correctionReason" placeholder="Reason for the correction (required)" aria-label="Correction reason" />}
      {fe.correctionReason && <p className="text-[12px] text-[var(--bad-fg)]">{fe.correctionReason}</p>}
      <FormMessage state={state} />
    </form>
  );
}

export function EquipmentForm({ batchId, stepNo, kind, options }: { batchId: string; stepNo: number; kind: string | null; options: ScaleOpt[] }) {
  const [state, action] = useAct(equipmentAction);
  const [ref, setRef] = useState(options.find((o) => o.usable)?.code ?? "");
  return (
    <form action={action} className="flex flex-col gap-2" data-testid="equipment-form">
      <Hidden v={{ batchId, stepNo }} />
      <Field label={`Scan or choose the ${kind ?? "equipment"}`} htmlFor={`eq-${stepNo}`} error={state?.fieldErrors?.equipment}>
        <Select id={`eq-${stepNo}`} name="equipmentRef" value={ref} onChange={(e) => setRef(e.target.value)} className="min-h-[48px]">
          <option value="">Choose…</option>
          {options.map((o) => (
            <option key={o.id} value={o.code} disabled={!o.usable}>
              {o.code} · {o.name}
              {!o.usable ? ` · blocked: ${o.blocking.join("; ")}` : o.viaOverride ? " · under approved override" : o.reasons.length ? ` · warning: ${o.reasons.join("; ")}` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingText="Saving…" className="self-start">
        Record equipment
      </SubmitButton>
    </form>
  );
}

export function CompleteStepForm({ batchId, stepNo, stepKind, requiresChecker, checkers, idem, disabledReason }: { batchId: string; stepNo: number; stepKind: string; requiresChecker: boolean; checkers: Person[]; idem: string; disabledReason?: string | null }) {
  const [state, action] = useAct(completeStepAction);
  return (
    <form action={action} className="flex flex-col gap-3" data-testid="complete-step-form">
      <Hidden v={{ batchId, stepNo, stepKind, idempotencyKey: idem }} />
      <Field label="Notes (optional)" htmlFor={`notes-${stepNo}`}>
        <Input id={`notes-${stepNo}`} name="notes" />
      </Field>
      {requiresChecker && <CoSign prefix="checker" people={checkers} title="Checked by" hint="Or the checker signs later from their own device." />}
      {/* UX review: disabled with the plain reason until ready (UI only; the server re-checks on submit). */}
      {disabledReason && (
        <p className="text-[14px] font-medium text-[var(--warn-fg)]" id={`complete-why-${stepNo}`}>
          {disabledReason}
        </p>
      )}
      <FormMessage state={state} />
      <SubmitButton size="lg" pendingText="Saving…" className="w-full sm:w-auto sm:self-start" disabled={!!disabledReason} aria-describedby={disabledReason ? `complete-why-${stepNo}` : undefined}>
        Complete step {stepNo}
      </SubmitButton>
    </form>
  );
}

export function ExceptionForm({ batchId, stepNo, approvers }: { batchId: string; stepNo: number; approvers: Person[] }) {
  const [state, action] = useAct(stepExceptionAction);
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Request exception (QA)
      </Button>
    );
  return (
    <form action={action} className="flex flex-col gap-3 rounded-[12px] border border-[var(--warn-bd)] p-3">
      <Hidden v={{ batchId, stepNo }} />
      <CoSign prefix="approver" people={approvers} title="Exception approved by" required />
      <Field label="Approver's assessment and decision" htmlFor={`exc-${stepNo}`} error={state?.fieldErrors?.reason}>
        <Textarea id={`exc-${stepNo}`} name="reason" required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">Approve exception and open deviation</SubmitButton>
    </form>
  );
}

/* ------------------------------------------------------------------ packaging */

export function PackagingIssueForm({ batchId, stepNo, suggestions, idem }: { batchId: string; stepNo: number; suggestions: string[]; idem: string }) {
  const [state, action] = useAct(issuePackagingAction);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3 rounded-[12px] border border-line p-3" data-testid="packaging-issue-form">
      <Hidden v={{ batchId, stepNo, idempotencyKey: idem }} />
      <Field label="Scan the packaging or label lot" htmlFor={`pk-lot-${stepNo}`} error={fe.lot} hint={suggestions.length ? `Released: ${suggestions.join(" · ")}` : "No released packaging lot with stock at this site."}>
        <Input id={`pk-lot-${stepNo}`} name="lotRef" autoComplete="off" className="min-h-[52px] font-mono" placeholder="BC:LOT:…" required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity issued" htmlFor={`pk-qty-${stepNo}`} error={fe.qty}>
          <Input id={`pk-qty-${stepNo}`} name="qty" inputMode="decimal" className="min-h-[48px] text-[18px]" required />
        </Field>
        <Field label="Location (if several)" htmlFor={`pk-loc-${stepNo}`} error={fe.location}>
          <Input id={`pk-loc-${stepNo}`} name="locationRef" placeholder="e.g. PKG-01" />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…" className="self-start">
        Issue to packaging
      </SubmitButton>
    </form>
  );
}

export function PackagingCountForm({ batchId, row }: { batchId: string; row: { id: string; materialName: string; lotNumber: string; issued: string; uom: string; counted: boolean } }) {
  const [state, action] = useAct(countPackagingAction);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-2" data-testid={`packaging-count-${row.lotNumber}`}>
      <Hidden v={{ batchId, reconciliationId: row.id }} />
      <div className="grid grid-cols-3 gap-2">
        {(["used", "damaged", "returned"] as const).map((k) => (
          <Field key={k} label={k[0].toUpperCase() + k.slice(1)} htmlFor={`${k}-${row.id}`} error={fe[k]}>
            <Input id={`${k}-${row.id}`} name={k} inputMode="decimal" className="min-h-[48px]" required={k === "used"} />
          </Field>
        ))}
      </div>
      {row.counted && <Input name="correctionReason" placeholder="Reason for the recount (required)" aria-label="Recount reason" />}
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingText="Saving…" className="self-start">
        {row.counted ? "Recount" : "Save count"}
      </SubmitButton>
    </form>
  );
}

/* ------------------------------------------------------------------ yield and transfer */

export function YieldForm({ batchId, unitNetMassG, theoreticalG, range, hasCurrent, idem }: { batchId: string; unitNetMassG: string; theoreticalG: string; range: { min: number; max: number }; hasCurrent: boolean; idem: string }) {
  const [state, action] = useAct(yieldAction);
  const [units, setUnits] = useState("");
  const ok = /^\d+$/.test(units.trim()) && Number(units) > 0;
  const outG = ok ? D(units).mul(unitNetMassG) : null;
  const pct = outG && D(theoreticalG).gt(0) ? outG.div(theoreticalG).mul(100) : null;
  const inRange = pct ? pct.gte(range.min) && pct.lte(range.max) : null;
  return (
    <form action={action} className="flex flex-col gap-3" data-testid="yield-form">
      <Hidden v={{ batchId, idempotencyKey: idem }} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Good finished units (pcs)" htmlFor="actualUnits" error={state?.fieldErrors?.actualUnits} hint={`Each unit ${fmtQty(unitNetMassG, "g", 0)} net`}>
          <Input id="actualUnits" name="actualUnits" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} className="min-h-[56px] text-[22px] tabular" required />
        </Field>
        <div className="rounded-[12px] border border-line bg-surface-2/60 p-3 text-[13px]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Preview (server recalculates)</p>
          <p className="tabular">Actual output: {outG ? fmtQty(outG, "g", 0) : "—"}</p>
          <p className="tabular">Theoretical yield: {fmtQty(theoreticalG, "g", 0)}</p>
          <p className="tabular font-semibold">Yield: {pct ? fmtQty(pct, "%", 2) : "—"}</p>
          <p className="text-muted">Configured range {range.min}–{range.max} %{inRange === false ? " · outside: needs approval with a deviation" : ""}</p>
        </div>
      </div>
      <Field label="Notes (optional)" htmlFor="yield-notes">
        <Input id="yield-notes" name="notes" />
      </Field>
      {hasCurrent && (
        <Field label="Reason for correcting the recorded yield" htmlFor="yield-corr" error={state?.fieldErrors?.correctionReason}>
          <Input id="yield-corr" name="correctionReason" required />
        </Field>
      )}
      <FormMessage state={state} />
      <SubmitButton size="lg" pendingText="Saving…" className="w-full sm:w-auto sm:self-start">
        {hasCurrent ? "Correct yield" : "Record yield"}
      </SubmitButton>
    </form>
  );
}

export function ScrapForm({ batchId, reasonCodes, idem }: { batchId: string; reasonCodes: { code: string; label: string }[]; idem: string }) {
  const [state, action] = useAct(scrapAction);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2" data-testid="scrap-form">
      <Hidden v={{ batchId, idempotencyKey: idem }} />
      <Field label="Kind" htmlFor="scrap-kind">
        <Select id="scrap-kind" name="kind" defaultValue="scrap">
          <option value="scrap">Scrap</option>
          <option value="rework">Rework</option>
        </Select>
      </Field>
      <Field label="Reason" htmlFor="scrap-reason" error={fe.reasonCode}>
        <Select id="scrap-reason" name="reasonCode" required defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          {reasonCodes.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Units" htmlFor="scrap-qty" error={fe.qty}>
        <Input id="scrap-qty" name="qty" inputMode="numeric" required />
      </Field>
      <Field label="Note" htmlFor="scrap-note" error={fe.note}>
        <Input id="scrap-note" name="note" />
      </Field>
      <div className="sm:col-span-2">
        <FormMessage state={state} />
        <SubmitButton variant="secondary" pendingText="Saving…">
          Record
        </SubmitButton>
      </div>
    </form>
  );
}

export function DecideScrapForm({ batchId, id }: { batchId: string; id: string }) {
  const [state, action] = useAct(decideScrapAction);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Hidden v={{ batchId, scrapReworkRecordId: id }} />
      <Input name="note" placeholder="Reason for the decision" aria-label="Decision reason" className="max-w-[260px]" required />
      <SubmitButton name="decision" value="approve" pendingText="Saving…">
        Approve
      </SubmitButton>
      <SubmitButton name="decision" value="reject" variant="secondary" pendingText="Saving…">
        Reject
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function TransferForm({ batchId, checkers, quarantine, idem }: { batchId: string; checkers: Person[]; quarantine: { code: string; name: string }[]; idem: string }) {
  const [state, action] = useAct(postToQuarantineAction);
  const [confirm, setConfirm] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-3" data-testid="transfer-form">
      <Hidden v={{ batchId, idempotencyKey: idem }} />
      <Field label="Scan the hold area location" htmlFor="transfer-loc" error={state?.fieldErrors?.locationRef} hint={quarantine.length ? `Hold area locations: ${quarantine.map((q) => q.code).join(", ")}` : "This site has no hold area location."}>
        <Input id="transfer-loc" name="locationRef" autoComplete="off" className="min-h-[52px] font-mono text-[16px]" placeholder="BC:LOC:QUA-01" required />
      </Field>
      <CoSign prefix="checker" people={checkers} title="Checked by" required />
      <label className="flex min-h-[44px] items-start gap-2 text-[14px]">
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-1 size-5" required />
        This updates stock: the materials used leave stock and the finished lot is created in the hold area, where it waits for quality approval. It cannot be edited afterwards.
      </label>
      <FormMessage state={state} />
      <SubmitButton size="lg" variant="cta" pendingText="Posting…" disabled={!confirm} className="w-full sm:w-auto sm:self-start">
        Move to hold area and send to quality
      </SubmitButton>
    </form>
  );
}

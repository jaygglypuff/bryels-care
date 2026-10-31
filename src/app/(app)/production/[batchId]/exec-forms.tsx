"use client";
import { createContext, useActionState, useContext, useState, type ReactNode } from "react";
import { D, fmtQty } from "@/lib/qty";
import { ScanOrPick, type PickCandidate } from "@/ui/scan-or-pick";
import { Button, Field, Input, Select, Textarea, cx } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { Chip } from "@/ui/status";
import {
  approveYieldAction,
  checkDispenseAction,
  checkStepAction,
  decideScrapAction,
  dispenseAction,
  returnStepAction,
  startStepAction,
  voidDispenseAction,
} from "./actions";

/**
 * Forms kept from the old batch workspace (W2B) after the one-path change of 2026-10-31: the advanced
 * weighing form, one-tap checks and reason forms used by "Other ways to weigh"
 * (/production/orders/<order>/weigh/more) and the legacy yield / reject approvals on the batch record.
 * The step, packaging, yield and transfer forms are gone: that work is done on the flow screens.
 *
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

function useAct(action: (s: Awaited<ReturnType<typeof dispenseAction>>, fd: FormData) => Promise<Awaited<ReturnType<typeof dispenseAction>>>) {
  return useActionState(action, null);
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
  const lotCandidates: PickCandidate[] = [];
  for (const l of lots) {
    const place: PickCandidate = { value: l.locationCode, title: l.locationName || l.locationCode, detail: fmtQty(l.qty, "g", 1), code: l.locationCode, codes: [l.locationCode] };
    const had = lotCandidates.find((c) => c.code === l.lotNumber);
    if (had) had.places!.push(place);
    else lotCandidates.push({ value: l.lotNumber, title: ing.materialName, detail: `lot ${l.lotNumber} · ${fmtQty(l.qty, "g", 1)} at ${l.locationCode}${l.expiresOn ? ` · exp ${l.expiresOn}` : ""}`, code: l.lotNumber, codes: [l.lotNumber], places: [place] });
  }
  const [partial, setPartial] = useState(false);
  const picked = lots.find((l) => l.lotNumber === lot && l.locationCode === loc) ?? null;
  const stillNeeded = D(ing.theoreticalQtyG).minus(ing.dispensedQtyG);
  const firstUsable = scales.find((s) => s.usable)?.code ?? "";
  const [scale, setScale] = useState(firstUsable);
  const fe = state?.fieldErrors ?? {};
  const valid = /^\d+(\.\d+)?$/.test(qty.trim());
  const g = valid ? D(qty.trim()).mul(uom === "kg" ? 1000 : 1) : null;
  const total = g ? g.plus(ing.dispensedQtyG) : null;
  const tol: "empty" | "within" | "below" | "above" = !total ? "empty" : total.lt(ing.minG) ? "below" : total.gt(ing.maxG) ? "above" : "within";
  const outside = !partial && (tol === "below" || tol === "above");
  return (
    <form action={action} className="mt-1 flex flex-col gap-4 rounded-[12px] border border-line-strong p-3.5" data-testid="weigh-form">
      <Hidden v={{ batchId, batchMaterialId: ing.id, idempotencyKey: idem, uom }} />
      {replaces && <input type="hidden" name="supersedesId" value={replaces.id} />}
      {/* ADR-098 ScanOrPick: the usable lots (oldest expiry first) to tap or scan; then the shelf when several. */}
      <ScanOrPick
        kind="lot"
        name="lotRef"
        submit="code"
        label="1. Which lot? Scan the label on the container, or tap it"
        hint={lots.length === 0 ? "No usable lot of this material at this site. Receive it (and have it approved) first." : "Oldest expiry first; lots already brought to production are at the top."}
        candidatesLabel="Usable lots"
        candidates={lotCandidates}
        value={lot || null}
        onChange={(v, c) => {
          setLot(c?.code ?? v ?? "");
          setLoc(c?.places?.length === 1 ? (c.places[0].code ?? "") : "");
        }}
        required
        error={fe.lot ?? null}
      />
      {lot && (
        <ScanOrPick
          key={lot}
          kind="location"
          name="locationRef"
          submit="code"
          label="From which shelf?"
          candidates={lotCandidates.find((c) => c.code === lot)?.places ?? []}
          value={loc || null}
          onChange={(v, c) => setLoc(c?.code ?? v ?? "")}
          hideWhenSingle
          error={fe.location ?? null}
        />
      )}
      {picked && D(picked.qty).lt(stillNeeded) && (
        <span className="block text-[12.5px] text-[var(--warn-fg)]">
          Only {fmtQty(picked.qty, "g", 1)} in this lot; {fmtQty(stillNeeded, "g", 1)} still needed. Weigh what it has, tick &quot;Another lot follows&quot;, then weigh the rest from the next lot.
        </span>
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
      <SubmitButton size="lg" variant={outside ? "secondary" : "primary"} pendingText="Saving…" className="w-full sm:w-auto sm:self-start">
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

"use client";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button, Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm, FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { Chip } from "@/ui/status";
import { decideQualityCheckAction, saveTestResultsAction } from "./actions";

/**
 * The three decisions of Check quality (ADR-080 §8; UX words Pass / Not yet / Fail). Pass is enabled
 * only after the "I reviewed the batch record" tick. Pass and Fail ask in the page, after the form is
 * complete ("Yes, pass" / "Back"), never with a browser pop-up. The server re-checks everything.
 */

/** In-page confirmation: the first button checks the form, then shows the question with the real submit. */
function ConfirmStep({
  formRef,
  open,
  setOpen,
  ask,
  question,
  detail,
  yes,
  pending,
  variant = "primary",
  disabled,
  testId,
}: {
  formRef: RefObject<HTMLFormElement | null>;
  open: boolean;
  setOpen: (v: boolean) => void;
  ask: ReactNode;
  question: string;
  detail?: string;
  yes: string;
  pending: string;
  variant?: "primary" | "danger";
  disabled?: boolean;
  testId: string;
}) {
  if (!open) {
    return (
      <div>
        <Button type="button" size="lg" variant={variant} disabled={disabled} onClick={() => formRef.current?.reportValidity() && setOpen(true)} data-testid={`${testId}-ask`}>
          {ask}
        </Button>
      </div>
    );
  }
  return (
    <div className="rounded-[16px] border-2 border-[var(--warn-bd)] bg-[var(--warn-bg)] p-4" role="alertdialog" aria-labelledby={`${testId}-q`} data-testid={`${testId}-confirm`}>
      <p id={`${testId}-q`} className="text-[16px] font-semibold">
        {question}
      </p>
      {detail && <p className="mt-1 text-[15px]">{detail}</p>}
      <div className="mt-3 flex flex-wrap gap-3">
        <SubmitButton size="lg" variant={variant} pendingText={pending} autoFocus>
          {yes}
        </SubmitButton>
        <Button type="button" variant="secondary" size="lg" onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
    </div>
  );
}

export function PassForm({ batchId, maker, canPass }: { batchId: string; maker: { what: string[]; ownerOverride: boolean } | null; canPass: boolean }) {
  const [state, dispatch] = useInPlaceAction(decideQualityCheckAction);
  const [reviewed, setReviewed] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state) setOpen(false);
  }, [state]);
  const fe = state?.fieldErrors ?? {};
  return (
    <form ref={formRef} action={dispatch} className="flex flex-col gap-3" onSubmit={(e) => !open && e.preventDefault()}>
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="decision" value="pass" />
      <label className="flex min-h-[48px] items-center gap-3 text-[15px]">
        <input type="checkbox" name="recordReviewed" value="yes" className="h-6 w-6" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />I reviewed the batch record and the exceptions above
      </label>
      {fe.recordReviewed && <p className="text-[14px] text-[var(--bad-fg)]">{fe.recordReviewed}</p>}
      {maker?.ownerOverride && (
        <Field label="Why do you pass a batch you worked on? (printed on the batch record)" htmlFor="overrideReason" error={fe.overrideReason} hint={`You ${maker.what.join(", ")} on this batch. This is recorded.`}>
          <Textarea id="overrideReason" name="overrideReason" rows={2} maxLength={1000} required placeholder="For example: No separate QA person yet" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
        </Field>
      )}
      <Field label="Note (optional)" htmlFor="pass-reason" error={fe.reason}>
        <Input id="pass-reason" name="reason" maxLength={1000} autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <FormMessage state={state} />
      <ConfirmStep formRef={formRef} open={open} setOpen={setOpen} ask="Pass" question="Pass this batch?" detail="The stock becomes ready to sell." yes="Yes, pass" pending="Passing…" disabled={!reviewed || !canPass} testId="pass" />
    </form>
  );
}

export function NotYetForm({ batchId, today }: { batchId: string; today: string }) {
  return (
    <ActionForm action={decideQualityCheckAction} hidden={{ batchId, decision: "not_yet" }} submit="Not yet" pending="Saving…" variant="secondary">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Why not yet?" htmlFor="ny-reason" error={fe.reason}>
            <Input id="ny-reason" name="reason" required maxLength={1000} autoComplete="off" placeholder="For example: waiting for the pH retest" />
          </Field>
          <Field label="Check again on" htmlFor="ny-date" error={fe.checkAgainOn}>
            <Input id="ny-date" name="checkAgainOn" type="date" required min={today} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function FailForm({ batchId }: { batchId: string }) {
  const [state, dispatch] = useInPlaceAction(decideQualityCheckAction);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state) setOpen(false);
  }, [state]);
  const fe = state?.fieldErrors ?? {};
  return (
    <form ref={formRef} action={dispatch} className="flex flex-col gap-3" onSubmit={(e) => !open && e.preventDefault()}>
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="decision" value="fail" />
      <Field label="Why does it fail?" htmlFor="fail-reason" error={fe.reason}>
        <Textarea id="fail-reason" name="reason" rows={2} required maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <FormMessage state={state} />
      <ConfirmStep formRef={formRef} open={open} setOpen={setOpen} ask="Fail" question="Fail this batch?" detail="The stock is moved to the rejected area. This cannot be undone here." yes="Yes, fail" pending="Saving…" variant="danger" testId="fail" />
    </form>
  );
}

export type CheckTest = { id: string; name: string; valueKind: string; uom: string | null; spec: string; isRequired: boolean };

/**
 * All tests without a result in ONE form with one "Save results" button (consultant review): no page
 * reload per test. Values stay in state, so a refused save keeps what was typed; the server saves all
 * or nothing and returns the field error of each wrong test.
 */
export function TestsForm({ inspectionId, tests }: { inspectionId: string; tests: CheckTest[] }) {
  const [state, dispatch] = useInPlaceAction(saveTestResultsAction);
  const [v, setV] = useState<Record<string, { value: string; uom: string; conforms: string }>>(() => Object.fromEntries(tests.map((t) => [t.id, { value: "", uom: t.uom ?? "", conforms: "" }])));
  const fe = state?.fieldErrors ?? {};
  const filled = tests.filter((t) => v[t.id] && (v[t.id].value.trim() || v[t.id].conforms)).length;
  const set = (id: string, k: "value" | "uom" | "conforms", x: string) => setV((cur) => ({ ...cur, [id]: { ...(cur[id] ?? { value: "", uom: "", conforms: "" }), [k]: x } }));
  return (
    <form action={dispatch} className="flex flex-col gap-1" data-testid="tests-form">
      <input type="hidden" name="inspectionId" value={inspectionId} />
      <input type="hidden" name="testIds" value={tests.map((t) => t.id).join(",")} />
      <ul className="divide-y divide-line">
        {tests.map((t) => {
          const p = `r-${t.id}-`;
          const x = v[t.id] ?? { value: "", uom: t.uom ?? "", conforms: "" };
          return (
            <li key={t.id} className="py-3" data-testid={`test-${t.id}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {t.name}
                  {!t.isRequired && <span className="text-[12px] text-muted"> (optional)</span>}
                </span>
                <span className="text-[13px] text-muted">OK: {t.spec}</span>
              </div>
              {t.valueKind === "numeric" ? (
                <div className="mt-2 grid grid-cols-[1fr_96px] gap-3">
                  <Field label="Measured value" htmlFor={`${p}value`} error={fe[`${p}value`]}>
                    <Input id={`${p}value`} name={`${p}value`} inputMode="decimal" autoComplete="off" value={x.value} onChange={(e) => set(t.id, "value", e.target.value)} />
                  </Field>
                  <Field label="Unit" htmlFor={`${p}uom`} error={fe[`${p}uom`]}>
                    <Input id={`${p}uom`} name={`${p}uom`} autoComplete="off" value={x.uom} onChange={(e) => set(t.id, "uom", e.target.value)} />
                  </Field>
                </div>
              ) : (
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <Field label="Conforms to the specification?" htmlFor={`${p}conforms`} error={fe[`${p}conforms`]}>
                    <Select id={`${p}conforms`} name={`${p}conforms`} value={x.conforms} onChange={(e) => set(t.id, "conforms", e.target.value)}>
                      <option value="">Not tested yet</option>
                      <option value="yes">Yes, conforms</option>
                      <option value="no">No, out of specification</option>
                    </Select>
                  </Field>
                  <Field label={t.valueKind === "text" ? "Observation" : "Note (optional)"} htmlFor={`${p}value`} error={fe[`${p}value`]}>
                    <Input id={`${p}value`} name={`${p}value`} maxLength={500} autoComplete="off" value={x.value} onChange={(e) => set(t.id, "value", e.target.value)} />
                  </Field>
                </div>
              )}
              {x.conforms === "no" && <p className="mt-1"><Chip tone="bad">Not OK</Chip></p>}
            </li>
          );
        })}
      </ul>
      <FormMessage state={state} />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <SubmitButton size="lg" pendingText="Saving…" disabled={filled === 0} data-testid="save-results">
          {filled > 1 ? `Save ${filled} results` : "Save results"}
        </SubmitButton>
        <span className="text-[13px] text-muted">Tests left empty stay open; save them later.</span>
      </div>
    </form>
  );
}

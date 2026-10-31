"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { Field, Input, Select, Textarea, cx } from "@/ui/core";
import { MoreDetails } from "@/ui/guide";
import { ActionForm, FormMessage, SubmitButton } from "@/ui/form";
import {
  bulkDispositionAction,
  cancelConditionalAction,
  cancelInspectionAction,
  closeDeviationAction,
  containDeviationAction,
  correctResultAction,
  decideConditionalAction,
  openDeviationAction,
  recordResultAction,
  recordSampleAction,
  requestConditionalAction,
  reviewInspectionAction,
  startInspectionAction,
  startInvestigationAction,
  submitInspectionAction,
  updateInvestigationAction,
  verifyLabelAction,
  type BulkState,
  type VerifyState,
} from "./w2c-actions";

export function StartInspectionButton({ batchId, lotId, processStepRecordId }: { batchId?: string; lotId?: string; processStepRecordId?: string }) {
  return <ActionForm action={startInspectionAction} hidden={{ batchId, lotId, processStepRecordId }} submit="Start the quality check" pending="Starting…" variant="secondary" />;
}

export function SampleForm({ inspectionId, locations, uom }: { inspectionId: string; locations: { id: string; code: string; qty: string }[]; uom: string }) {
  return (
    <ActionForm action={recordSampleAction} hidden={{ inspectionId }} submit="Save sample" pending="Saving…" variant="secondary" confirm="This amount is taken out of stock as a sample. Continue?">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Taken from (place)" htmlFor="fromLocationId" error={fe.fromLocationId}>
            <Select id="fromLocationId" name="fromLocationId" required defaultValue={locations[0]?.id ?? ""}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} ({l.qty} {uom})
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`How much (${uom})`} htmlFor="qty" error={fe.qty}>
            <Input id="qty" name="qty" required inputMode="decimal" autoComplete="off" />
          </Field>
          <div className="sm:col-span-2">
            <MoreDetails>
              <Field label="Box it came from (optional: scan the box label)" htmlFor="containerRef" error={fe.containerRef}>
                <Input id="containerRef" name="containerRef" autoComplete="off" />
              </Field>
              <Field label="Note (optional)" htmlFor="note" error={fe.note}>
                <Input id="note" name="note" maxLength={500} />
              </Field>
            </MoreDetails>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

type Test = { id: string; name: string; valueKind: string; uom: string | null; spec: string };

function ValueFields({ t, fe, prefix }: { t: Test; fe: Record<string, string>; prefix: string }) {
  if (t.valueKind === "numeric") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Measured value" htmlFor={`${prefix}value`} error={fe.value}>
          <Input id={`${prefix}value`} name="value" required inputMode="decimal" autoComplete="off" />
        </Field>
        <Field label="Unit" htmlFor={`${prefix}uom`} error={fe.uom}>
          <Input id={`${prefix}uom`} name="uom" required defaultValue={t.uom ?? ""} autoComplete="off" />
        </Field>
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t.valueKind === "text" ? "Observation" : "Note (optional)"} htmlFor={`${prefix}value`} error={fe.value}>
        <Input id={`${prefix}value`} name="value" required={t.valueKind === "text"} maxLength={500} autoComplete="off" />
      </Field>
      <Field label="Is it OK?" htmlFor={`${prefix}conforms`} error={fe.conforms}>
        <Select id={`${prefix}conforms`} name="conforms" required defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          <option value="yes">Yes, OK</option>
          <option value="no">No, not OK</option>
        </Select>
      </Field>
    </div>
  );
}

export function ResultForm({ inspectionId, test }: { inspectionId: string; test: Test }) {
  return (
    <ActionForm action={recordResultAction} hidden={{ inspectionId, planTestId: test.id }} submit="Save result" pending="Saving…" variant="secondary">
      {(fe) => <ValueFields t={test} fe={fe} prefix={`r-${test.id}-`} />}
    </ActionForm>
  );
}

export function CorrectForm({ inspectionId, resultId, test }: { inspectionId: string; resultId: string; test: Test }) {
  return (
    <details className="mt-1">
      <summary className="min-h-[44px] cursor-pointer py-2 text-[13px] text-primary-text">Correct this result</summary>
      <div className="mt-2 rounded-[12px] border border-line p-3">
        <ActionForm action={correctResultAction} hidden={{ inspectionId, resultId }} submit="Save correction" pending="Saving…" variant="secondary">
          {(fe) => (
            <>
              <ValueFields t={test} fe={fe} prefix={`c-${resultId}-`} />
              <Field label="Why the correction?" htmlFor={`c-${resultId}-reason`} error={fe.reason} hint="The original stays visible, struck through.">
                <Input id={`c-${resultId}-reason`} name="reason" required minLength={5} maxLength={1000} />
              </Field>
            </>
          )}
        </ActionForm>
      </div>
    </details>
  );
}

export function SubmitInspectionForm({ inspectionId }: { inspectionId: string }) {
  return <ActionForm action={submitInspectionAction} hidden={{ inspectionId }} submit="Send for checking" pending="Sending…" variant="cta" />;
}

export function ReviewForm({ inspectionId }: { inspectionId: string }) {
  return (
    <ActionForm action={reviewInspectionAction} hidden={{ inspectionId }} submit="Save the check" pending="Saving…" variant="cta">
      {(fe) => (
        <>
          <Field label="Are the results complete and correct?" htmlFor="decision" error={fe.decision}>
            <Select id="decision" name="decision" required defaultValue="approve">
              <option value="approve">Yes, accept them</option>
              <option value="return">No, test again</option>
              <option value="reject">No, throw this check away</option>
            </Select>
          </Field>
          <Field label="Note" htmlFor="note" error={fe.note} hint="Needed when you say no (a short sentence).">
            <Textarea id="note" name="note" maxLength={1000} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function CancelInspectionForm({ inspectionId }: { inspectionId: string }) {
  return (
    <ActionForm action={cancelInspectionAction} hidden={{ inspectionId }} submit="Cancel this quality check" pending="Cancelling…" variant="secondary" confirm="Cancel this quality check?">
      {(fe) => (
        <Field label="Why cancel?" htmlFor="cancel-reason" error={fe.reason}>
          <Input id="cancel-reason" name="reason" required minLength={5} maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}

export function DeviationForm({ batchId, lotId, inspectionId, testResultId, steps }: { batchId?: string; lotId?: string; inspectionId?: string; testResultId?: string; steps: { stepNo: number; name: string }[] }) {
  return (
    <ActionForm action={openDeviationAction} hidden={{ batchId, lotId, inspectionId, testResultId }} submit="Send problem report" pending="Sending…" variant="cta">
      {(fe) => (
        <>
          {steps.length > 0 && (
            <Field label="Which step? (optional)" htmlFor="stepRef" error={fe.stepRef}>
              <Select id="stepRef" name="stepRef" defaultValue="">
                <option value="">Not one step</option>
                {steps.map((s) => (
                  <option key={s.stepNo} value={`Step ${s.stepNo} ${s.name}`}>
                    Step {s.stepNo}. {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="What happened?" htmlFor="description" error={fe.description} hint="Just the facts: what, when, how much. QA decides how serious it is.">
            <Textarea id="description" name="description" required minLength={5} maxLength={4000} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function InvestigateForm({ deviationId, levels }: { deviationId: string; levels: string[] }) {
  return (
    <ActionForm action={startInvestigationAction} hidden={{ deviationId }} submit="Start looking into it" pending="Saving…" variant="cta">
      {(fe) => (
        <>
          <Field label="How serious?" htmlFor="severity" error={fe.severity} hint="The levels are set by the company's QA.">
            <Select id="severity" name="severity" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What will QA check?" htmlFor="investigation" error={fe.investigation}>
            <Textarea id="investigation" name="investigation" required maxLength={4000} />
          </Field>
          <MoreDetails>
            <Field label="Other batches or lots that may be affected (optional)" htmlFor="impactAssessment" error={fe.impactAssessment} hint="Same material lot, machine or person. “Where it came from and where it went” helps.">
              <Textarea id="impactAssessment" name="impactAssessment" maxLength={4000} />
            </Field>
          </MoreDetails>
        </>
      )}
    </ActionForm>
  );
}

export function UpdateInvestigationForm({ deviationId, current }: { deviationId: string; current: { investigation: string | null; impactAssessment: string | null; rootCause: string | null } }) {
  return (
    <ActionForm action={updateInvestigationAction} hidden={{ deviationId }} submit="Save" pending="Saving…" variant="secondary">
      {(fe) => (
        <>
          <Field label="What QA checks" htmlFor="u-investigation" error={fe.investigation}>
            <Textarea id="u-investigation" name="investigation" defaultValue={current.investigation ?? ""} maxLength={4000} />
          </Field>
          <Field label="Other batches or lots affected" htmlFor="u-impact" error={fe.impactAssessment}>
            <Textarea id="u-impact" name="impactAssessment" defaultValue={current.impactAssessment ?? ""} maxLength={4000} />
          </Field>
          <Field label="What caused it (so far)" htmlFor="u-root" error={fe.rootCause}>
            <Textarea id="u-root" name="rootCause" defaultValue={current.rootCause ?? ""} maxLength={4000} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function ContainForm({ deviationId, defaultLot, reasonCodes }: { deviationId: string; defaultLot: string | null; reasonCodes: { code: string; label: string }[] }) {
  return (
    <ActionForm action={containDeviationAction} hidden={{ deviationId, scope: "lot" }} submit={defaultLot ? `Stop lot ${defaultLot}` : "Stop the lot"} pending="Stopping…" variant="danger" confirm="Nobody can use, set aside or ship the lot until QA decides. Continue?">
      {(fe) => (
        <>
          {defaultLot ? (
            <MoreDetails title="Stop a different lot (scan its label)">
              <Field label="Other lot (scan the label)" htmlFor="lotRef" error={fe.lotRef ?? fe.lot} hint={`Leave empty to stop ${defaultLot}.`}>
                <Input id="lotRef" name="lotRef" autoComplete="off" />
              </Field>
            </MoreDetails>
          ) : (
            <Field label="Lot to stop (scan the label)" htmlFor="lotRef" error={fe.lotRef ?? fe.lot}>
              <Input id="lotRef" name="lotRef" autoComplete="off" />
            </Field>
          )}
          <Field label="Kind of reason" htmlFor="reasonCode" error={fe.reasonCode}>
            <Select id="reasonCode" name="reasonCode" defaultValue="investigation">
              {reasonCodes.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Why?" htmlFor="contain-reason" error={fe.reason}>
            <Input id="contain-reason" name="reason" required minLength={5} maxLength={1000} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function CloseDeviationForm({ deviationId, rootCause }: { deviationId: string; rootCause: string | null }) {
  return (
    <ActionForm action={closeDeviationAction} hidden={{ deviationId }} submit="Close the report" pending="Closing…" variant="cta" confirm="A closed problem report cannot be changed. Close it?">
      {(fe) => (
        <>
          <Field label="What caused it?" htmlFor="rootCause" error={fe.rootCause}>
            <Textarea id="rootCause" name="rootCause" required defaultValue={rootCause ?? ""} maxLength={4000} />
          </Field>
          <Field label="What was done?" htmlFor="resolution" error={fe.resolution}>
            <Textarea id="resolution" name="resolution" required maxLength={4000} />
          </Field>
          <Field label="May the product still be made OK to use?" htmlFor="releasePermitted" error={fe.releasePermitted} hint="QA decides. “No” keeps the batch and lot from ever being made OK.">
            <Select id="releasePermitted" name="releasePermitted" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <option value="yes">Yes, QA may still say OK</option>
              <option value="no">No, never OK</option>
            </Select>
          </Field>
          <MoreDetails>
            <Field label="Check again on (optional): did the fix work?" htmlFor="effectivenessCheckOn" error={fe.effectivenessCheckOn}>
              <Input id="effectivenessCheckOn" name="effectivenessCheckOn" type="date" />
            </Field>
          </MoreDetails>
        </>
      )}
    </ActionForm>
  );
}

export function ConditionalRequestForm({ batchId }: { batchId: string }) {
  return (
    <ActionForm action={requestConditionalAction} hidden={{ batchId }} submit="Ask for “OK with conditions”" pending="Sending…" variant="secondary">
      {(fe) => (
        <>
          <Field label="What are the conditions?" htmlFor="conditions" error={fe.conditions} hint="For example: which result we still wait for, and what may not happen before it.">
            <Textarea id="conditions" name="conditions" required maxLength={2000} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Look at it again on" htmlFor="reviewDate" error={fe.reviewDate}>
              <Input id="reviewDate" name="reviewDate" type="date" required />
            </Field>
            <Field label="Why?" htmlFor="cr-reason" error={fe.reason}>
              <Input id="cr-reason" name="reason" required minLength={5} maxLength={1000} />
            </Field>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function ConditionalDecideForm({ batchId, requestId, canDecide, canCancel }: { batchId: string; requestId: string; canDecide: boolean; canCancel: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {canDecide && (
        <ActionForm action={decideConditionalAction} hidden={{ batchId, requestId }} submit="Save my decision" pending="Saving…" variant="cta">
          {(fe) => (
            <>
              <Field label="Decision" htmlFor="cr-decision" error={fe.decision}>
                <Select id="cr-decision" name="decision" defaultValue="approve">
                  <option value="approve">Yes, OK with these conditions</option>
                  <option value="reject">No</option>
                </Select>
              </Field>
              <Field label="Note" htmlFor="cr-note" error={fe.note}>
                <Input id="cr-note" name="note" required minLength={5} maxLength={1000} />
              </Field>
            </>
          )}
        </ActionForm>
      )}
      {canCancel && (
        <ActionForm action={cancelConditionalAction} hidden={{ batchId, requestId }} submit="Take the request back" pending="Saving…" variant="secondary">
          {(fe) => (
            <Field label="Why take it back?" htmlFor="cr-cancel" error={fe.reason}>
              <Input id="cr-cancel" name="reason" required minLength={5} maxLength={1000} />
            </Field>
          )}
        </ActionForm>
      )}
    </div>
  );
}

type BulkRow = { id: string; lotNumber: string; itemName: string; itemCode: string; expiresOn: string | null; expired: boolean; onHand: string; baseUom: string; supplierLotNumber: string | null };

export function BulkForm({ rows, reasonCodes }: { rows: BulkRow[]; reasonCodes: { code: string; label: string }[] }) {
  const [state, dispatch] = useActionState<BulkState, FormData>(bulkDispositionAction, null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rows.filter((r) => !r.expired).map((r) => r.id)));
  useEffect(() => setPicked(new Set(rows.filter((r) => !r.expired).map((r) => r.id))), [rows]);
  const fe = state?.fieldErrors ?? {};
  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])));
  return (
    <form action={dispatch} className="flex flex-col gap-4" onSubmit={(e) => !window.confirm(`Save this decision for ${picked.size} lot(s)? Each lot is decided and saved one by one.`) && e.preventDefault()}>
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <span>
          {picked.size} of {rows.length} selected
        </span>
        <button type="button" className="text-primary-text hover:underline" onClick={() => setPicked(new Set(rows.filter((r) => !r.expired).map((r) => r.id)))}>
          Tick all that can be decided
        </button>
        <button type="button" className="text-primary-text hover:underline" onClick={() => setPicked(new Set())}>
          Untick all
        </button>
      </div>
      <ul className="flex max-h-[420px] flex-col divide-y divide-line overflow-y-auto rounded-[16px] border border-line">
        {rows.map((r) => {
          const outcome = state?.outcomes?.find((o) => o.lotId === r.id);
          return (
            <li key={r.id} className="text-[13px]">
              <label className="flex min-h-[48px] flex-wrap items-center gap-3 px-3 py-2">
              <input type="checkbox" name="lotIds" value={r.id} checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.itemName} ${r.lotNumber}`} className="h-5 w-5 accent-[var(--primary)]" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {r.itemName} <span className="font-mono text-[12px] font-normal text-muted">{r.lotNumber}</span>
                </span>
                <span className="block text-muted">
                  {r.onHand} {r.baseUom}
                  {r.expiresOn ? ` · use by ${r.expiresOn}` : ""}
                  {r.expired ? " · EXPIRED (will be refused)" : ""}
                </span>
              </span>
              {outcome && <span className={cx("text-[12px] font-medium", outcome.ok ? "text-[var(--ok-fg)]" : "text-[var(--bad-fg)]")}>{outcome.ok ? `Done: ${({ released: "OK to use", rejected: "not OK" } as Record<string, string>)[outcome.toStatus ?? ""] ?? outcome.toStatus}` : `Refused: ${outcome.message}`}</span>}
              </label>
            </li>
          );
        })}
      </ul>
      {fe.lotIds && <p className="text-[12px] text-[var(--bad-fg)]">{fe.lotIds}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Decision" htmlFor="b-decision" error={fe.decision}>
          <Select id="b-decision" name="decision" defaultValue="release">
            <option value="release">OK to use</option>
            <option value="reject">Not OK – don&apos;t use (moves to the area for things we cannot use)</option>
          </Select>
        </Field>
        <Field label="Kind of reason" htmlFor="b-reason" error={fe.reasonCode}>
          <Select id="b-reason" name="reasonCode" defaultValue={reasonCodes[0]?.code}>
            {reasonCodes.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Your password (to confirm it is you)" htmlFor="b-password" error={fe.password} hint="Not needed within 10 minutes of “Confirm it’s you”; two-step sign-in users confirm there.">
          <Input id="b-password" name="password" type="password" autoComplete="current-password" />
        </Field>
        <div className="sm:col-span-2">
          <MoreDetails>
            <Field label="Note (optional)" htmlFor="b-note" error={fe.note}>
              <Input id="b-note" name="note" maxLength={500} placeholder="For example: first count, zone A" />
            </Field>
          </MoreDetails>
        </div>
      </div>
      <FormMessage state={state} />
      {state?.outcomes && (
        <p className="text-[13px] text-muted" role="status">
          Done {state.outcomes.filter((o) => o.ok).length} · refused {state.outcomes.filter((o) => !o.ok).length} · total {state.outcomes.length}
        </p>
      )}
      <div>
        <SubmitButton variant="cta" size="lg" pendingText={`Deciding ${picked.size} lot(s)… keep this page open`} disabled={picked.size === 0}>
          Save for {picked.size} lot(s)
        </SubmitButton>
      </div>
    </form>
  );
}

export function VerifyScanForm({ locationId }: { locationId: string }) {
  const [state, dispatch] = useActionState<VerifyState, FormData>(async (p, fd) => {
    const r = await verifyLabelAction(p, fd);
    ref.current?.reset();
    setTimeout(() => input.current?.focus(), 0);
    return r;
  }, null);
  const ref = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  return (
    <form ref={ref} action={dispatch} className="flex flex-col gap-3">
      <input type="hidden" name="locationId" value={locationId} />
      <Field label="Scan a box or lot label" htmlFor="scan" error={state?.fieldErrors?.scan} hint="The scanner sends it by itself. A label that will not scan: type what is under the barcode and press Enter.">
        <Input ref={input} id="scan" name="scan" required autoFocus autoComplete="off" inputMode="text" />
      </Field>
      {state?.ok && state.message && (
        <p role="status" className={cx("rounded-[10px] border px-3 py-2 text-[14px] font-medium", state.last?.status === "verified" ? "border-[var(--ok-bd)] bg-[var(--ok-bg)] text-[var(--ok-fg)]" : "border-[var(--warn-bd)] bg-[var(--warn-bg)] text-[var(--warn-fg)]")}>
          {state.message}
        </p>
      )}
      {state && !state.ok && <FormMessage state={state} />}
      <div>
        <SubmitButton variant="cta" pendingText="Checking…">
          Check this label
        </SubmitButton>
      </div>
    </form>
  );
}

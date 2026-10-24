"use client";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select, Textarea, cx } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import type { ButtonVariant } from "@/ui/core";
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

type Action = (p: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Small form shell: hidden fields, a fresh idempotency key after every success, field errors from the
 * server, an optional confirm, one submit button. The server re-checks every rule.
 */
function ActionForm({
  action,
  hidden,
  submit,
  pending = "Saving…",
  variant = "primary",
  confirm,
  children,
  className,
}: {
  action: Action;
  hidden: Record<string, string | null | undefined>;
  submit: string;
  pending?: string;
  variant?: ButtonVariant;
  confirm?: string;
  children?: (fe: Record<string, string>) => ReactNode;
  className?: string;
}) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const ref = useRef<HTMLFormElement>(null);
  const [state, dispatch] = useActionState<ActionState, FormData>(async (p, fd) => {
    const r = await action(p, fd);
    if (r?.ok) {
      setKey(crypto.randomUUID());
      ref.current?.reset();
    }
    return r;
  }, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form ref={ref} action={dispatch} className={cx("flex flex-col gap-3", className)} onSubmit={(e) => confirm && !window.confirm(confirm) && e.preventDefault()}>
      <input type="hidden" name="idempotencyKey" value={key} />
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {children?.(fe)}
      <FormMessage state={state} />
      <div>
        <SubmitButton variant={variant} pendingText={pending}>
          {submit}
        </SubmitButton>
      </div>
    </form>
  );
}

export function StartInspectionButton({ batchId, lotId, processStepRecordId }: { batchId?: string; lotId?: string; processStepRecordId?: string }) {
  return <ActionForm action={startInspectionAction} hidden={{ batchId, lotId, processStepRecordId }} submit="Start inspection" pending="Starting…" variant="secondary" />;
}

export function SampleForm({ inspectionId, locations, uom }: { inspectionId: string; locations: { id: string; code: string; qty: string }[]; uom: string }) {
  return (
    <ActionForm action={recordSampleAction} hidden={{ inspectionId }} submit="Record sample" pending="Recording…" variant="secondary" confirm="The sample quantity is removed from stock as a sample consumption. Continue?">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Taken from" htmlFor="fromLocationId" error={fe.fromLocationId}>
            <Select id="fromLocationId" name="fromLocationId" required defaultValue={locations[0]?.id ?? ""}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} ({l.qty} {uom})
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Quantity (${uom})`} htmlFor="qty" error={fe.qty}>
            <Input id="qty" name="qty" required inputMode="decimal" autoComplete="off" />
          </Field>
          <Field label="Box (optional, scan or type)" htmlFor="containerRef" error={fe.containerRef}>
            <Input id="containerRef" name="containerRef" autoComplete="off" placeholder="BC:BOX:…" />
          </Field>
          <Field label="Note (optional)" htmlFor="note" error={fe.note}>
            <Input id="note" name="note" maxLength={500} />
          </Field>
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
        <Field label="Unit" htmlFor={`${prefix}uom`} error={fe.uom} hint={`Specification unit: ${t.uom}`}>
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
      <Field label="Conforms to the specification?" htmlFor={`${prefix}conforms`} error={fe.conforms}>
        <Select id={`${prefix}conforms`} name="conforms" required defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          <option value="yes">Yes, conforms</option>
          <option value="no">No, out of specification</option>
        </Select>
      </Field>
    </div>
  );
}

export function ResultForm({ inspectionId, test }: { inspectionId: string; test: Test }) {
  return (
    <ActionForm action={recordResultAction} hidden={{ inspectionId, planTestId: test.id }} submit="Record result" pending="Recording…" variant="secondary">
      {(fe) => <ValueFields t={test} fe={fe} prefix={`r-${test.id}-`} />}
    </ActionForm>
  );
}

export function CorrectForm({ inspectionId, resultId, test }: { inspectionId: string; resultId: string; test: Test }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-[12px] text-primary-text">Correct this entry</summary>
      <div className="mt-2 rounded-[12px] border border-line p-3">
        <ActionForm action={correctResultAction} hidden={{ inspectionId, resultId }} submit="Record correction" pending="Recording…" variant="secondary">
          {(fe) => (
            <>
              <ValueFields t={test} fe={fe} prefix={`c-${resultId}-`} />
              <Field label="Reason for the correction" htmlFor={`c-${resultId}-reason`} error={fe.reason} hint="The original stays visible, struck through.">
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
  return <ActionForm action={submitInspectionAction} hidden={{ inspectionId }} submit="Submit for review" pending="Submitting…" variant="secondary" />;
}

export function ReviewForm({ inspectionId }: { inspectionId: string }) {
  return (
    <ActionForm action={reviewInspectionAction} hidden={{ inspectionId }} submit="Record review" pending="Recording…" variant="cta">
      {(fe) => (
        <>
          <Field label="Review decision" htmlFor="decision" error={fe.decision}>
            <Select id="decision" name="decision" required defaultValue="approve">
              <option value="approve">Approve: results complete and correctly recorded</option>
              <option value="return">Return for testing / retest</option>
              <option value="reject">Reject the inspection</option>
            </Select>
          </Field>
          <Field label="Note" htmlFor="note" error={fe.note} hint="Required to return or reject (at least 5 characters).">
            <Textarea id="note" name="note" maxLength={1000} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function CancelInspectionForm({ inspectionId }: { inspectionId: string }) {
  return (
    <ActionForm action={cancelInspectionAction} hidden={{ inspectionId }} submit="Cancel inspection" pending="Cancelling…" variant="secondary" confirm="Cancel this inspection?">
      {(fe) => (
        <Field label="Reason" htmlFor="cancel-reason" error={fe.reason}>
          <Input id="cancel-reason" name="reason" required minLength={5} maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}

export function DeviationForm({ batchId, lotId, inspectionId, testResultId, steps }: { batchId?: string; lotId?: string; inspectionId?: string; testResultId?: string; steps: { stepNo: number; name: string }[] }) {
  return (
    <ActionForm action={openDeviationAction} hidden={{ batchId, lotId, inspectionId, testResultId }} submit="Raise deviation" pending="Raising…" variant="cta">
      {(fe) => (
        <>
          {steps.length > 0 && (
            <Field label="Step (optional)" htmlFor="stepRef" error={fe.stepRef}>
              <Select id="stepRef" name="stepRef" defaultValue="">
                <option value="">Not tied to one step</option>
                {steps.map((s) => (
                  <option key={s.stepNo} value={`Step ${s.stepNo} ${s.name}`}>
                    Step {s.stepNo}. {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="What happened" htmlFor="description" error={fe.description} hint="Facts: what, when, how much. QA classifies severity.">
            <Textarea id="description" name="description" required minLength={5} maxLength={4000} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function InvestigateForm({ deviationId, levels }: { deviationId: string; levels: string[] }) {
  return (
    <ActionForm action={startInvestigationAction} hidden={{ deviationId }} submit="Classify and start investigation" pending="Saving…">
      {(fe) => (
        <>
          <Field label="Severity" htmlFor="severity" error={fe.severity} hint="Classes are configured by the company's QA.">
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
          <Field label="Investigation plan" htmlFor="investigation" error={fe.investigation}>
            <Textarea id="investigation" name="investigation" required maxLength={4000} />
          </Field>
          <Field label="Impact assessment (optional)" htmlFor="impactAssessment" error={fe.impactAssessment} hint="Other batches using the same lot, equipment or operator (use Traceability).">
            <Textarea id="impactAssessment" name="impactAssessment" maxLength={4000} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function UpdateInvestigationForm({ deviationId, current }: { deviationId: string; current: { investigation: string | null; impactAssessment: string | null; rootCause: string | null } }) {
  return (
    <ActionForm action={updateInvestigationAction} hidden={{ deviationId }} submit="Save investigation" pending="Saving…" variant="secondary">
      {(fe) => (
        <>
          <Field label="Investigation" htmlFor="u-investigation" error={fe.investigation}>
            <Textarea id="u-investigation" name="investigation" defaultValue={current.investigation ?? ""} maxLength={4000} />
          </Field>
          <Field label="Impact assessment" htmlFor="u-impact" error={fe.impactAssessment}>
            <Textarea id="u-impact" name="impactAssessment" defaultValue={current.impactAssessment ?? ""} maxLength={4000} />
          </Field>
          <Field label="Root cause (draft)" htmlFor="u-root" error={fe.rootCause}>
            <Textarea id="u-root" name="rootCause" defaultValue={current.rootCause ?? ""} maxLength={4000} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function ContainForm({ deviationId, defaultLot, reasonCodes }: { deviationId: string; defaultLot: string | null; reasonCodes: { code: string; label: string }[] }) {
  return (
    <ActionForm action={containDeviationAction} hidden={{ deviationId, scope: "lot" }} submit="Place containment hold" pending="Placing hold…" variant="danger" confirm="The lot goes on QA hold: blocked for allocation, issue and shipment. Continue?">
      {(fe) => (
        <>
          <Field label="Lot to hold (scan or type)" htmlFor="lotRef" error={fe.lotRef ?? fe.lot} hint={defaultLot ? `Leave empty to hold ${defaultLot}.` : undefined}>
            <Input id="lotRef" name="lotRef" autoComplete="off" placeholder="BC:LOT:…" />
          </Field>
          <Field label="Reason code" htmlFor="reasonCode" error={fe.reasonCode}>
            <Select id="reasonCode" name="reasonCode" defaultValue="investigation">
              {reasonCodes.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason" htmlFor="contain-reason" error={fe.reason}>
            <Input id="contain-reason" name="reason" required minLength={5} maxLength={1000} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function CloseDeviationForm({ deviationId, rootCause }: { deviationId: string; rootCause: string | null }) {
  return (
    <ActionForm action={closeDeviationAction} hidden={{ deviationId }} submit="Close deviation" pending="Closing…" variant="cta" confirm="A closed deviation cannot be changed. Close it?">
      {(fe) => (
        <>
          <Field label="Root cause" htmlFor="rootCause" error={fe.rootCause}>
            <Textarea id="rootCause" name="rootCause" required defaultValue={rootCause ?? ""} maxLength={4000} />
          </Field>
          <Field label="Resolution" htmlFor="resolution" error={fe.resolution}>
            <Textarea id="resolution" name="resolution" required maxLength={4000} />
          </Field>
          <Field label="May the affected product still be released?" htmlFor="releasePermitted" error={fe.releasePermitted} hint="QA's conclusion. 'No' keeps the batch and lot blocked from release.">
            <Select id="releasePermitted" name="releasePermitted" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <option value="yes">Yes, release may proceed</option>
              <option value="no">No, the product may not be released</option>
            </Select>
          </Field>
          <Field label="Effectiveness check date (optional)" htmlFor="effectivenessCheckOn" error={fe.effectivenessCheckOn}>
            <Input id="effectivenessCheckOn" name="effectivenessCheckOn" type="date" />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

export function ConditionalRequestForm({ batchId }: { batchId: string }) {
  return (
    <ActionForm action={requestConditionalAction} hidden={{ batchId }} submit="Request conditional release" pending="Requesting…" variant="secondary">
      {(fe) => (
        <>
          <Field label="Conditions" htmlFor="conditions" error={fe.conditions} hint="For example: pending result and what may not happen before it.">
            <Textarea id="conditions" name="conditions" required maxLength={2000} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Review date" htmlFor="reviewDate" error={fe.reviewDate}>
              <Input id="reviewDate" name="reviewDate" type="date" required />
            </Field>
            <Field label="Reason" htmlFor="cr-reason" error={fe.reason}>
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
        <ActionForm action={decideConditionalAction} hidden={{ batchId, requestId }} submit="Record second approval decision" pending="Recording…" variant="cta">
          {(fe) => (
            <>
              <Field label="Decision" htmlFor="cr-decision" error={fe.decision}>
                <Select id="cr-decision" name="decision" defaultValue="approve">
                  <option value="approve">Approve the conditional release</option>
                  <option value="reject">Reject the request</option>
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
        <ActionForm action={cancelConditionalAction} hidden={{ batchId, requestId }} submit="Withdraw request" pending="Withdrawing…" variant="secondary">
          {(fe) => (
            <Field label="Reason to withdraw" htmlFor="cr-cancel" error={fe.reason}>
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
    <form action={dispatch} className="flex flex-col gap-4" onSubmit={(e) => !window.confirm(`Apply this decision to ${picked.size} lot(s)? Each lot is decided and recorded separately.`) && e.preventDefault()}>
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <span>
          {picked.size} of {rows.length} selected
        </span>
        <button type="button" className="text-primary-text hover:underline" onClick={() => setPicked(new Set(rows.filter((r) => !r.expired).map((r) => r.id)))}>
          Select all usable
        </button>
        <button type="button" className="text-primary-text hover:underline" onClick={() => setPicked(new Set())}>
          Clear
        </button>
      </div>
      <ul className="flex max-h-[420px] flex-col divide-y divide-line overflow-y-auto rounded-[16px] border border-line">
        {rows.map((r) => {
          const outcome = state?.outcomes?.find((o) => o.lotId === r.id);
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-[13px]">
              <input type="checkbox" name="lotIds" value={r.id} checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.lotNumber}`} className="h-5 w-5 accent-[var(--primary)]" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {r.lotNumber} <span className="text-muted">· {r.itemCode}</span>
                </p>
                <p className="text-muted">
                  {r.itemName} · {r.onHand} {r.baseUom}
                  {r.expiresOn ? ` · exp. ${r.expiresOn}` : ""}
                  {r.expired ? " · EXPIRED (will be refused)" : ""}
                </p>
              </div>
              {outcome && <span className={cx("text-[12px] font-medium", outcome.ok ? "text-[var(--ok-fg)]" : "text-[var(--bad-fg)]")}>{outcome.ok ? `Done: ${outcome.toStatus}` : `Refused: ${outcome.message}`}</span>}
            </li>
          );
        })}
      </ul>
      {fe.lotIds && <p className="text-[12px] text-[var(--bad-fg)]">{fe.lotIds}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Decision" htmlFor="b-decision" error={fe.decision}>
          <Select id="b-decision" name="decision" defaultValue="release">
            <option value="release">Release (quarantine → released; held → released)</option>
            <option value="reject">Reject (moves stock to the rejected location)</option>
          </Select>
        </Field>
        <Field label="Reason code" htmlFor="b-reason" error={fe.reasonCode}>
          <Select id="b-reason" name="reasonCode" defaultValue={reasonCodes[0]?.code}>
            {reasonCodes.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note (optional)" htmlFor="b-note" error={fe.note}>
          <Input id="b-note" name="note" maxLength={500} placeholder="For example: rehearsal R1, zone A" />
        </Field>
        <Field label="Your password (re-authentication)" htmlFor="b-password" error={fe.password} hint="Not needed within 10 minutes of “Confirm it’s you”; two-step sign-in users confirm there.">
          <Input id="b-password" name="password" type="password" autoComplete="current-password" />
        </Field>
      </div>
      <FormMessage state={state} />
      {state?.outcomes && (
        <p className="text-[13px] text-muted" role="status">
          Done {state.outcomes.filter((o) => o.ok).length} · refused {state.outcomes.filter((o) => !o.ok).length} · total {state.outcomes.length}
        </p>
      )}
      <div>
        <SubmitButton variant="cta" size="lg" pendingText={`Deciding ${picked.size} lot(s)… keep this page open`} disabled={picked.size === 0}>
          Apply to {picked.size} lot(s)
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
      <Field label="Scan a box or lot label" htmlFor="scan" error={state?.fieldErrors?.scan} hint="A keyboard-wedge scanner submits by itself; or type the code and press Enter.">
        <Input ref={input} id="scan" name="scan" required autoFocus autoComplete="off" inputMode="text" placeholder="BC:BOX:BX00000001" />
      </Field>
      {state?.ok && state.message && (
        <p role="status" className={cx("rounded-[10px] border px-3 py-2 text-[14px] font-medium", state.last?.status === "verified" ? "border-[var(--ok-bd)] bg-[var(--ok-bg)] text-[var(--ok-fg)]" : "border-[var(--warn-bd)] bg-[var(--warn-bg)] text-[var(--warn-fg)]")}>
          {state.message}
        </p>
      )}
      {state && !state.ok && <FormMessage state={state} />}
      <div>
        <SubmitButton variant="cta" pendingText="Checking…">
          Verify
        </SubmitButton>
      </div>
    </form>
  );
}

"use client";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import {
  accountedAction,
  cancelRecallAction,
  closeRecallAction,
  decideRecallAction,
  markRecalledAction,
  notifyCustomerAction,
  openRecallAction,
  refreshScopeAction,
  startDrillAction,
  startRecoveryAction,
  submitRecallAction,
  updateRecallAction,
} from "./actions";

function PasswordField({ fe, id }: { fe: Record<string, string>; id: string }) {
  return (
    <Field label="Your password (re-authentication)" htmlFor={id} error={fe.password} hint="Restricted decision. Not needed within the step-up window of “Confirm it’s you”; two-step sign-in users confirm there.">
      <Input id={id} name="password" type="password" autoComplete="current-password" />
    </Field>
  );
}

export function OpenRecallForm({ query }: { query: { code?: string; supplierLot?: string; complaintId?: string; mode: "forward" | "reverse" } }) {
  return (
    <ActionForm action={openRecallAction} hidden={{ code: query.code, supplierLot: query.supplierLot, complaintId: query.complaintId, mode: query.mode }} submit="Open recall case (draft)" pending="Tracing…" variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kind" htmlFor="recallKind" error={fe.recallKind}>
            <Select id="recallKind" name="recallKind" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <option value="recall">Recall</option>
              <option value="withdrawal">Withdrawal</option>
              <option value="mock">Mock recall (drill, marks no stock)</option>
            </Select>
          </Field>
          <Field label="Title" htmlFor="title" error={fe.title}>
            <Input id="title" name="title" required maxLength={200} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Reason and description" htmlFor="description" error={fe.description}>
              <Textarea id="description" name="description" required minLength={5} maxLength={4000} />
            </Field>
          </div>
          <Field label="Classification (optional, QA / regulatory)" htmlFor="classification" error={fe.classification} hint="Free text decided by the company's QA and regulatory personnel; the system never computes it.">
            <Input id="classification" name="classification" maxLength={300} />
          </Field>
          <Field label="Notification obligations (optional)" htmlFor="regulatoryNotes" error={fe.regulatoryNotes} hint="Authority and customer obligations as decided by QA / regulatory.">
            <Textarea id="regulatoryNotes" name="regulatoryNotes" maxLength={4000} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function RefreshScopeForm({ recallCaseId }: { recallCaseId: string }) {
  return <ActionForm action={refreshScopeAction} hidden={{ recallCaseId }} submit="Refresh scope from the ledger" variant="secondary" size="sm" />;
}

export function ClassificationForm({ recallCaseId, classification, regulatoryNotes }: { recallCaseId: string; classification: string | null; regulatoryNotes: string | null }) {
  return (
    <ActionForm action={updateRecallAction} hidden={{ recallCaseId }} submit="Save" size="sm">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Classification (QA / regulatory)" htmlFor="rc-classification" error={fe.classification}>
            <Input id="rc-classification" name="classification" maxLength={300} defaultValue={classification ?? ""} />
          </Field>
          <Field label="Notification obligations" htmlFor="rc-regulatoryNotes" error={fe.regulatoryNotes}>
            <Textarea id="rc-regulatoryNotes" name="regulatoryNotes" maxLength={4000} defaultValue={regulatoryNotes ?? ""} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function SubmitRecallForm({ recallCaseId }: { recallCaseId: string }) {
  return <ActionForm action={submitRecallAction} hidden={{ recallCaseId }} submit="Submit for approval" variant="cta" confirm="Submit the case? The scope is frozen once submitted." />;
}

export function DecideRecallForm({ recallCaseId, stepLabel }: { recallCaseId: string; stepLabel: string }) {
  return (
    <ActionForm action={decideRecallAction} hidden={{ recallCaseId }} submit={`Record decision (${stepLabel})`} variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Decision" htmlFor="rc-decision" error={fe.decision}>
            <Select id="rc-decision" name="decision" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <option value="approved">Approve</option>
              <option value="returned">Return to draft</option>
              <option value="rejected">Reject</option>
            </Select>
          </Field>
          <Field label="Note (required to return or reject)" htmlFor="rc-note" error={fe.note}>
            <Input id="rc-note" name="note" maxLength={1000} />
          </Field>
          <PasswordField fe={fe} id="rc-decide-password" />
        </div>
      )}
    </ActionForm>
  );
}

export function MarkRecalledForm({ recallCaseId, count }: { recallCaseId: string; count: number }) {
  return (
    <ActionForm action={markRecalledAction} hidden={{ recallCaseId }} submit={`Mark ${count} lot(s) recalled`} variant="danger" confirm="Mark every pending lot of this case recalled? Recalled stock cannot be allocated, picked, packed or shipped.">
      {(fe) => <PasswordField fe={fe} id="rc-mark-password" />}
    </ActionForm>
  );
}

export function StartDrillForm({ recallCaseId }: { recallCaseId: string }) {
  return <ActionForm action={startDrillAction} hidden={{ recallCaseId }} submit="Start the drill" variant="cta" />;
}

export function NotifyForm({ recallCaseId, customerId, event, methods }: { recallCaseId: string; customerId: string; event: "notified" | "acknowledged"; methods: readonly string[] }) {
  return (
    <ActionForm action={notifyCustomerAction} hidden={{ recallCaseId, customerId, event }} submit={event === "notified" ? "Record notification" : "Record acknowledgement"} size="sm" className="flex flex-col gap-2">
      {(fe) => (
        <div className="grid gap-2 sm:grid-cols-2">
          {event === "notified" && (
            <Field label="How" htmlFor={`m-${customerId}`} error={fe.method}>
              <Select id={`m-${customerId}`} name="method" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {methods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Note (optional)" htmlFor={`n-${customerId}-${event}`} error={fe.note}>
            <Input id={`n-${customerId}-${event}`} name="note" maxLength={1000} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function StartRecoveryForm({ recallCaseId }: { recallCaseId: string }) {
  return <ActionForm action={startRecoveryAction} hidden={{ recallCaseId }} submit="Start recovery" variant="cta" />;
}

export function AccountedForm({ lineId, current }: { lineId: string; current: string }) {
  return (
    <ActionForm action={accountedAction} hidden={{ lineId }} submit="Save" size="sm" className="flex flex-col gap-2">
      {(fe) => (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Accounted" htmlFor={`a-${lineId}`} error={fe.qty}>
            <Input id={`a-${lineId}`} name="qty" inputMode="decimal" required defaultValue={current} />
          </Field>
          <Field label="How (destroyed, consumed, never sold…)" htmlFor={`an-${lineId}`} error={fe.note}>
            <Input id={`an-${lineId}`} name="note" required minLength={5} maxLength={1000} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function CloseRecallForm({ recallCaseId, hasGaps }: { recallCaseId: string; hasGaps: boolean }) {
  return (
    <ActionForm action={closeRecallAction} hidden={{ recallCaseId }} submit="Close the case" variant="cta" confirm="Close the recall case with this closure report?">
      {(fe) => (
        <div className="grid gap-3">
          <Field label="Closure report" htmlFor="closureReport" error={fe.closureReport}>
            <Textarea id="closureReport" name="closureReport" required minLength={5} maxLength={6000} />
          </Field>
          <Field label={hasGaps ? "Explanation of the unreconciled quantities (required)" : "Explanation of gaps (none)"} htmlFor="reconciliationExplanation" error={fe.reconciliationExplanation}>
            <Textarea id="reconciliationExplanation" name="reconciliationExplanation" maxLength={4000} required={hasGaps} />
          </Field>
          <PasswordField fe={fe} id="rc-close-password" />
        </div>
      )}
    </ActionForm>
  );
}

export function CancelRecallForm({ recallCaseId }: { recallCaseId: string }) {
  return (
    <ActionForm action={cancelRecallAction} hidden={{ recallCaseId }} submit="Cancel case" variant="danger" confirm="Cancel this recall case?">
      {(fe) => (
        <Field label="Reason" htmlFor="rc-cancel" error={fe.reason}>
          <Input id="rc-cancel" name="reason" required minLength={5} maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}

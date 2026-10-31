"use client";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
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
    <Field label="Your password (to confirm it is you)" htmlFor={id} error={fe.password} hint="A serious decision. Not needed shortly after “Confirm it’s you”; two-step sign-in users confirm there.">
      <Input id={id} name="password" type="password" autoComplete="current-password" />
    </Field>
  );
}

export function OpenRecallForm({ query }: { query: { code?: string; supplierLot?: string; complaintId?: string; mode: "forward" | "reverse" } }) {
  return (
    <ActionForm action={openRecallAction} hidden={{ code: query.code, supplierLot: query.supplierLot, complaintId: query.complaintId, mode: query.mode }} submit="Save the draft" pending="Saving…" variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What kind?" htmlFor="recallKind" error={fe.recallKind}>
            <Select id="recallKind" name="recallKind" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <option value="recall">Product recall (get it back from customers)</option>
              <option value="withdrawal">Take it off the shelves (withdrawal)</option>
              <option value="mock">Practice recall (drill, stops no stock)</option>
            </Select>
          </Field>
          <Field label="Short name" htmlFor="title" error={fe.title}>
            <Input id="title" name="title" required maxLength={200} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Why must it come back?" htmlFor="description" error={fe.description}>
              <Textarea id="description" name="description" required minLength={5} maxLength={4000} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <MoreDetails>
              <Field label="Class (optional, QA / regulatory)" htmlFor="classification" error={fe.classification} hint="Written by the company's QA and regulatory people; the system never works it out.">
                <Input id="classification" name="classification" maxLength={300} />
              </Field>
              <Field label="Who must be told (optional)" htmlFor="regulatoryNotes" error={fe.regulatoryNotes} hint="Authorities and customers, as QA / regulatory decide.">
                <Textarea id="regulatoryNotes" name="regulatoryNotes" maxLength={4000} />
              </Field>
            </MoreDetails>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

export function RefreshScopeForm({ recallCaseId }: { recallCaseId: string }) {
  return <ActionForm action={refreshScopeAction} hidden={{ recallCaseId }} submit="Update the list from the stock records" variant="secondary" size="sm" />;
}

export function ClassificationForm({ recallCaseId, classification, regulatoryNotes }: { recallCaseId: string; classification: string | null; regulatoryNotes: string | null }) {
  return (
    <ActionForm action={updateRecallAction} hidden={{ recallCaseId }} submit="Save" size="sm">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Class (QA / regulatory)" htmlFor="rc-classification" error={fe.classification}>
            <Input id="rc-classification" name="classification" maxLength={300} defaultValue={classification ?? ""} />
          </Field>
          <Field label="Who must be told" htmlFor="rc-regulatoryNotes" error={fe.regulatoryNotes}>
            <Textarea id="rc-regulatoryNotes" name="regulatoryNotes" maxLength={4000} defaultValue={regulatoryNotes ?? ""} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function SubmitRecallForm({ recallCaseId }: { recallCaseId: string }) {
  return <ActionForm action={submitRecallAction} hidden={{ recallCaseId }} submit="Send for approval" variant="cta" confirm="Send it for approval? The list of lots and customers is fixed once sent." />;
}

export function DecideRecallForm({ recallCaseId, stepLabel }: { recallCaseId: string; stepLabel: string }) {
  return (
    <ActionForm action={decideRecallAction} hidden={{ recallCaseId }} submit={`Save my decision (${stepLabel})`} variant="cta">
      {(fe) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Decision" htmlFor="rc-decision" error={fe.decision}>
            <Select id="rc-decision" name="decision" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <option value="approved">Yes, approve</option>
              <option value="returned">Send back to change it</option>
              <option value="rejected">No</option>
            </Select>
          </Field>
          <Field label="Note (needed when you say no or send back)" htmlFor="rc-note" error={fe.note}>
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
    <ActionForm action={markRecalledAction} hidden={{ recallCaseId }} submit={`Stop ${count} lot(s): recalled`} variant="danger" confirm="Mark every lot in this recall as recalled? Nobody can set aside, pick, pack or ship it afterwards.">
      {(fe) => <PasswordField fe={fe} id="rc-mark-password" />}
    </ActionForm>
  );
}

export function StartDrillForm({ recallCaseId }: { recallCaseId: string }) {
  return <ActionForm action={startDrillAction} hidden={{ recallCaseId }} submit="Start the practice" variant="cta" />;
}

export function NotifyForm({ recallCaseId, customerId, event, methods }: { recallCaseId: string; customerId: string; event: "notified" | "acknowledged"; methods: readonly string[] }) {
  return (
    <ActionForm action={notifyCustomerAction} hidden={{ recallCaseId, customerId, event }} submit={event === "notified" ? "Saved: customer told" : "Saved: customer answered"} size="sm" className="flex flex-col gap-2">
      {(fe) => (
        <div className="grid gap-2 sm:grid-cols-2">
          {event === "notified" && (
            <Field label="How were they told?" htmlFor={`m-${customerId}`} error={fe.method}>
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
  return <ActionForm action={startRecoveryAction} hidden={{ recallCaseId }} submit="Start getting the products back" variant="cta" />;
}

export function AccountedForm({ lineId, current }: { lineId: string; current: string }) {
  return (
    <ActionForm action={accountedAction} hidden={{ lineId }} submit="Save" size="sm" className="flex flex-col gap-2">
      {(fe) => (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="How many are accounted for" htmlFor={`a-${lineId}`} error={fe.qty}>
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
    <ActionForm action={closeRecallAction} hidden={{ recallCaseId }} submit="Close the recall" variant="cta" confirm="Close the product recall with this final report?">
      {(fe) => (
        <div className="grid gap-3">
          <Field label="Final report: what happened and what came back" htmlFor="closureReport" error={fe.closureReport}>
            <Textarea id="closureReport" name="closureReport" required minLength={5} maxLength={6000} />
          </Field>
          <Field label={hasGaps ? "Why do some amounts not add up? (required)" : "Amounts that do not add up (none)"} htmlFor="reconciliationExplanation" error={fe.reconciliationExplanation}>
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
    <ActionForm action={cancelRecallAction} hidden={{ recallCaseId }} submit="Cancel the recall" variant="danger" confirm="Cancel this product recall?">
      {(fe) => (
        <Field label="Why cancel?" htmlFor="rc-cancel" error={fe.reason}>
          <Input id="rc-cancel" name="reason" required minLength={5} maxLength={1000} />
        </Field>
      )}
    </ActionForm>
  );
}

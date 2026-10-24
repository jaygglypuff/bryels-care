"use client";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Button, Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { amendAction, closeBatchAction, decideReopenAction, issuePaperAction, requestReopenAction, reviewPaperAction, voidPaperAction, withdrawReopenAction } from "./actions";

/** Client forms of the closure page; every action is re-checked by the services (US-3-19, US-3-20). */

function useKey() {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return [key, () => setKey(crypto.randomUUID())] as const;
}

const confirmSubmit = (text: string) => (e: React.FormEvent<HTMLFormElement>) => {
  if (!window.confirm(text)) e.preventDefault();
};

export function CloseBatchForm({ batchId, batchNumber }: { batchId: string; batchNumber: string }) {
  const [state, action] = useActionState<ActionState, FormData>(closeBatchAction, null);
  const [key] = useKey();
  return (
    <form action={action} onSubmit={confirmSubmit(`Close batch ${batchNumber}? The record becomes final; changes later need a reopen approved by a site manager and QA.`)} className="space-y-3">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="idempotencyKey" value={key} suppressHydrationWarning />
      <Field label="Closure note (optional)" htmlFor="close-note" error={state?.fieldErrors?.note}>
        <Textarea id="close-note" name="note" maxLength={1000} rows={2} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="cta" size="lg" pendingText="Closing…">
        Close batch and generate the final BMR
      </SubmitButton>
    </form>
  );
}

export function ReopenRequestForm({ batchId, fromState }: { batchId: string; fromState: string | null }) {
  const [state, action] = useActionState<ActionState, FormData>(requestReopenAction, null);
  const [key] = useKey();
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} onSubmit={confirmSubmit("Request a reopen of this closed batch? A QA user must co-approve before anything changes.")} className="space-y-3">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="idempotencyKey" value={key} suppressHydrationWarning />
      <Field label="While it is amended, the batch goes to" htmlFor="targetState" error={fe.targetState}>
        <Select id="targetState" name="targetState" defaultValue={fromState ?? "quarantined"} required>
          {fromState && <option value={fromState}>Back to {fromState} (record correction only; the QA decision stands)</option>}
          <option value="quarantined">QA review (quarantined; QA must decide again)</option>
        </Select>
      </Field>
      <Field label="Why must the closed record be reopened?" htmlFor="reason" error={fe.reason} hint="At least 10 characters; printed on the BMR.">
        <Textarea id="reason" name="reason" required minLength={10} maxLength={1000} rows={2} />
      </Field>
      <Field label="What will be amended?" htmlFor="amendmentScope" error={fe.amendmentScope} hint="Sections or fields, e.g. “Step 4 reading”.">
        <Input id="amendmentScope" name="amendmentScope" required minLength={5} maxLength={1000} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingText="Sending…">
        Request reopen
      </SubmitButton>
    </form>
  );
}

export function DecideReopenForm({ batchId, requestId, stepLabel }: { batchId: string; requestId: string; stepLabel: string }) {
  const [state, action] = useActionState<ActionState, FormData>(decideReopenAction, null);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  return (
    <form
      action={action}
      onSubmit={confirmSubmit(decision === "approved" ? "Approve? If this is the last step, the batch is reopened now." : "Reject the reopen? The batch stays closed.")}
      className="space-y-3"
    >
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="requestId" value={requestId} />
      <fieldset className="flex flex-wrap gap-4 text-[14px]">
        <legend className="mb-1 text-[13px] font-medium">{stepLabel}</legend>
        <label className="flex min-h-[44px] items-center gap-2">
          <input type="radio" name="decision" value="approved" checked={decision === "approved"} onChange={() => setDecision("approved")} /> Approve
        </label>
        <label className="flex min-h-[44px] items-center gap-2">
          <input type="radio" name="decision" value="rejected" checked={decision === "rejected"} onChange={() => setDecision("rejected")} /> Reject
        </label>
      </fieldset>
      <Field label={decision === "rejected" ? "Reason (required)" : "Note (optional)"} htmlFor="decide-note" error={state?.fieldErrors?.note}>
        <Textarea id="decide-note" name="note" required={decision === "rejected"} minLength={decision === "rejected" ? 5 : undefined} maxLength={1000} rows={2} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant={decision === "approved" ? "cta" : "danger"} pendingText="Recording…">
        Record decision
      </SubmitButton>
    </form>
  );
}

export function WithdrawReopenForm({ batchId, requestId }: { batchId: string; requestId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(withdrawReopenAction, null);
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="requestId" value={requestId} />
      <Field label="Withdraw the request: reason" htmlFor="withdraw-reason" error={state?.fieldErrors?.reason}>
        <Input id="withdraw-reason" name="reason" required minLength={5} />
      </Field>
      <SubmitButton variant="secondary" pendingText="Withdrawing…">
        Withdraw
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

const SECTIONS: [string, string][] = [
  ["process_steps", "Procedure / process steps"],
  ["materials", "Dispensing and weighing"],
  ["line_clearance", "Line clearance"],
  ["packaging_reconciliation", "Packaging and label reconciliation"],
  ["output_yield", "Output and yield"],
  ["qc", "QC results"],
  ["deviations", "Deviations"],
  ["header", "Header"],
  ["remarks", "Remarks"],
  ["attachments", "Attachments"],
  ["other", "Other"],
];

export function AmendmentForm({ batchId, amendments }: { batchId: string; amendments: { id: string; amendmentNo: number; reference: string; superseded: boolean }[] }) {
  const [state, action] = useActionState<ActionState, FormData>(amendAction, null);
  const [key] = useKey();
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} onSubmit={confirmSubmit("Record this amendment? It cannot be edited or deleted; a mistake is corrected by another amendment.")} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="idempotencyKey" value={key} suppressHydrationWarning />
      <Field label="BMR section" htmlFor="section" error={fe.section}>
        <Select id="section" name="section" required defaultValue="process_steps">
          {SECTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="What is corrected" htmlFor="reference" error={fe.reference} hint="Step, line or field, e.g. “Step 4 Mixing, reading”.">
        <Input id="reference" name="reference" required minLength={2} maxLength={200} />
      </Field>
      <Field label="Value as recorded" htmlFor="previousValue" error={fe.previousValue}>
        <Input id="previousValue" name="previousValue" required maxLength={1000} />
      </Field>
      <Field label="Corrected value" htmlFor="correctedValue" error={fe.correctedValue}>
        <Input id="correctedValue" name="correctedValue" required maxLength={1000} />
      </Field>
      <Field label="Reason" htmlFor="amend-reason" error={fe.reason}>
        <Textarea id="amend-reason" name="reason" required minLength={5} maxLength={1000} rows={2} />
      </Field>
      <Field label="Corrects an earlier amendment (optional)" htmlFor="supersedesId" error={fe.supersedesId}>
        <Select id="supersedesId" name="supersedesId" defaultValue="">
          <option value="">No</option>
          {amendments
            .filter((a) => !a.superseded)
            .map((a) => (
              <option key={a.id} value={a.id}>
                A{a.amendmentNo} · {a.reference}
              </option>
            ))}
        </Select>
      </Field>
      <div className="sm:col-span-2 space-y-2">
        <FormMessage state={state} />
        <SubmitButton variant="cta" pendingText="Recording…">
          Record amendment
        </SubmitButton>
      </div>
    </form>
  );
}

export function IssuePaperForm({ batchId, steps }: { batchId: string; steps: { stepNo: number; name: string }[] }) {
  const [state, action] = useActionState<ActionState, FormData>(issuePaperAction, null);
  const [key, renew] = useKey();
  return (
    <form action={async (f) => { await action(f); renew(); }} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="idempotencyKey" value={key} suppressHydrationWarning />
      <Field label="Blank paper page for step" htmlFor="stepNo" error={state?.fieldErrors?.stepNo}>
        <Select id="stepNo" name="stepNo" required>
          {steps.map((s) => (
            <option key={s.stepNo} value={s.stepNo}>
              {s.stepNo}. {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <SubmitButton variant="secondary" pendingText="Issuing…">
        Issue page
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

/** Upload of the completed page; posts to the API route (multipart, Idempotency-Key). */
export function AttachPaperForm({ paperRecordId }: { paperRecordId: string }) {
  const router = useRouter();
  const [key, renew] = useKey();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<ActionState>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/production/paper-records/${paperRecordId}/file`, { method: "POST", body: new FormData(e.currentTarget), headers: { "Idempotency-Key": key } });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !body.ok) {
        setMsg({ ok: false, message: body.message ?? "The upload failed. Nothing was saved." });
        return;
      }
      renew();
      setMsg({ ok: true, message: "Scan attached. A different person must now review the transcription." });
      router.refresh();
    } catch {
      setMsg({ ok: false, message: "The upload failed (connection). Nothing was saved; try again." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <Field label="Scan or photo of the completed page (PDF, JPEG, PNG)" htmlFor={`file-${paperRecordId}`}>
        <Input id={`file-${paperRecordId}`} name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required />
      </Field>
      <Field label="Transcription note (optional)" htmlFor={`tn-${paperRecordId}`} hint="By attaching you confirm you entered the page's values in the system.">
        <Input id={`tn-${paperRecordId}`} name="transcriptionNote" maxLength={1000} />
      </Field>
      <FormMessage state={msg} />
      <Button type="submit" variant="secondary" disabled={busy}>
        {busy ? "Uploading…" : "Attach scan"}
      </Button>
    </form>
  );
}

export function ReviewPaperForm({ batchId, paperRecordId }: { batchId: string; paperRecordId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(reviewPaperAction, null);
  const [decision, setDecision] = useState<"confirm" | "return">("confirm");
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="paperRecordId" value={paperRecordId} />
      <fieldset className="flex flex-wrap gap-4 text-[14px]">
        <legend className="mb-1 text-[13px] font-medium">Compare the scan with the electronic record</legend>
        <label className="flex min-h-[44px] items-center gap-2">
          <input type="radio" name="decision" value="confirm" checked={decision === "confirm"} onChange={() => setDecision("confirm")} /> Transcription matches
        </label>
        <label className="flex min-h-[44px] items-center gap-2">
          <input type="radio" name="decision" value="return" checked={decision === "return"} onChange={() => setDecision("return")} /> Does not match
        </label>
      </fieldset>
      <Field label={decision === "return" ? "What does not match (required)" : "Note (optional)"} htmlFor={`rn-${paperRecordId}`} error={state?.fieldErrors?.note}>
        <Input id={`rn-${paperRecordId}`} name="note" required={decision === "return"} minLength={decision === "return" ? 5 : undefined} maxLength={1000} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant={decision === "confirm" ? "cta" : "secondary"} pendingText="Recording…">
        Record review
      </SubmitButton>
    </form>
  );
}

export function VoidPaperForm({ batchId, paperRecordId }: { batchId: string; paperRecordId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(voidPaperAction, null);
  return (
    <form action={action} onSubmit={confirmSubmit("Void this paper page? Keep the printed sheet with the batch file marked VOID.")} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="paperRecordId" value={paperRecordId} />
      <Field label="Void (unused page): reason" htmlFor={`vr-${paperRecordId}`} error={state?.fieldErrors?.reason}>
        <Input id={`vr-${paperRecordId}`} name="reason" required minLength={5} />
      </Field>
      <SubmitButton variant="danger" pendingText="Voiding…">
        Void page
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

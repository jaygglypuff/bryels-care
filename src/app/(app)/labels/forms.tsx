"use client";
import { useActionState, useRef, useState, type FormEvent } from "react";
import type { ActionState } from "@/lib/errors";
import { Button, Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import {
  cancelAction,
  createReceiptLabelJobsAction,
  markFailedAction,
  markPrintedAction,
  reprintAction,
  retryAction,
  voidAction,
} from "./actions";

type Action = (prev: ActionState, f: FormData) => Promise<ActionState>;
const ACTIONS: Record<string, Action> = { printed: markPrintedAction, retry: retryAction, cancel: cancelAction };

/** On-page confirmation for a form with a server action (ADR-083: no browser pop-ups). */
function useOnPageConfirm(question: string | undefined) {
  const [asking, setAsking] = useState(false);
  const confirmed = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (!question) return;
    if (confirmed.current) {
      confirmed.current = false;
      setAsking(false);
      return;
    }
    e.preventDefault();
    setAsking(true);
  };
  const box = asking ? (
    <div role="alertdialog" aria-label="Please confirm" className="flex flex-col gap-2 rounded-[14px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] p-3">
      <p className="text-[14px] font-medium text-fg">{question}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="cta"
          onClick={() => {
            confirmed.current = true;
            formRef.current?.requestSubmit();
          }}
        >
          Yes, continue
        </Button>
        <Button type="button" variant="secondary" onClick={() => setAsking(false)}>
          Back
        </Button>
      </div>
    </div>
  ) : null;
  return { formRef, onSubmit, box };
}

function useKey() {
  const [key] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`));
  return key;
}

/** One-button command on a job (printed / retry / cancel). */
export function JobCommand({ jobId, kind, label, variant = "secondary", confirm }: { jobId: string; kind: "printed" | "retry" | "cancel"; label: string; variant?: "cta" | "secondary" | "danger"; confirm?: string }) {
  const [state, action] = useActionState<ActionState, FormData>(ACTIONS[kind], null);
  const c = useOnPageConfirm(confirm);
  return (
    <form ref={c.formRef} action={action} onSubmit={c.onSubmit} className="space-y-2">
      <input type="hidden" name="jobId" value={jobId} />
      {c.box ?? (
        <SubmitButton variant={variant} pendingText="Saving…" className="w-full sm:w-auto">
          {label}
        </SubmitButton>
      )}
      <FormMessage state={state} />
    </form>
  );
}

export function FailForm({ jobId }: { jobId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(markFailedAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="jobId" value={jobId} />
      <Field label="What went wrong?" htmlFor={`fail-${jobId}`} error={state?.fieldErrors?.message}>
        <Input id={`fail-${jobId}`} name="message" placeholder="Printer out of labels" required minLength={3} />
      </Field>
      <SubmitButton variant="secondary" pendingText="Saving…">Print failed</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function VoidForm({ jobId }: { jobId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(voidAction, null);
  const c = useOnPageConfirm("Void this label? It will be listed as superseded and must be destroyed. This cannot be undone.");
  return (
    <form ref={c.formRef} action={action} onSubmit={c.onSubmit} className="space-y-2">
      <input type="hidden" name="jobId" value={jobId} />
      <Field label="Why does the label no longer match?" htmlFor={`void-${jobId}`} error={state?.fieldErrors?.reason}>
        <Input id={`void-${jobId}`} name="reason" placeholder="Repacked into a new drum" required minLength={5} />
      </Field>
      {c.box ?? <SubmitButton variant="danger" pendingText="Voiding…">Void label</SubmitButton>}
      <FormMessage state={state} />
    </form>
  );
}

export function ReprintForm({ jobId, reasons, maxCopies }: { jobId: string; reasons: readonly { code: string; label: string; requiresNote: boolean }[]; maxCopies: number }) {
  const [state, action] = useActionState<ActionState, FormData>(reprintAction, null);
  const key = useKey();
  const [reason, setReason] = useState("");
  const needsNote = reasons.find((r) => r.code === reason)?.requiresNote ?? false;
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <Field label="Why print it again?" htmlFor="reasonCode" error={fe.reasonCode}>
        <Select id="reasonCode" name="reasonCode" required value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Choose a reason…</option>
          {reasons.map((r) => (
            <option key={r.code} value={r.code}>{r.label}</option>
          ))}
        </Select>
      </Field>
      <Field label={needsNote ? "Explain (required)" : "Note (optional)"} htmlFor="note" error={fe.note}>
        <Textarea id="note" name="note" required={needsNote} minLength={needsNote ? 5 : undefined} maxLength={500} />
      </Field>
      <Field label="How many labels?" htmlFor="copies" error={fe.copies} hint={`Up to ${maxCopies}.`}>
        <Input id="copies" name="copies" type="number" inputMode="numeric" min={1} max={maxCopies} defaultValue={1} required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="cta" pendingText="Sending…">Reprint (logged)</SubmitButton>
    </form>
  );
}

type TemplateOpt = { id: string; code: string; name: string; media: string; copiesDefault: number };

/** One label per sack/container: the number of labels of each lot starts at the receipt's container count (1 when not recorded). */
export function ReceiptJobsForm({ grId, templates, lots }: { grId: string; templates: TemplateOpt[]; lots: { lotId: string; lotNumber: string; materialName: string; containerCount: number | null }[] }) {
  const [state, action] = useActionState<ActionState, FormData>(createReceiptLabelJobsAction, null);
  const fe = state?.fieldErrors ?? {};
  const lotCount = lots.length;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="grId" value={grId} />
      <Field label="Label size" htmlFor="labelTemplateId" error={fe.labelTemplateId}>
        <Select id="labelTemplateId" name="labelTemplateId" required defaultValue={templates[0]?.id}>
          {templates.map((x) => (
            <option key={x.id} value={x.id}>{x.name.includes("mm") ? x.name : `${x.media} · ${x.name}`}</option>
          ))}
        </Select>
      </Field>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-[14px] font-semibold">One label for each sack or container</legend>
        {lots.map((l) => (
          <div key={l.lotId} className="grid grid-cols-[1fr_120px] items-end gap-3" data-testid="receipt-label-lot">
            <p className="pb-3 text-[14px]">
              <span className="font-semibold">{l.materialName}</span> <span className="font-mono text-muted">· {l.lotNumber}</span>
            </p>
            <Field label="How many sacks/containers?" htmlFor={`copies-${l.lotId}`} error={fe[`copies-${l.lotId}`] ?? fe.copies}>
              <Input id={`copies-${l.lotId}`} name={`copies-${l.lotId}`} type="number" inputMode="numeric" min={1} max={99} defaultValue={Math.min(Math.max(l.containerCount ?? 1, 1), 99)} required />
            </Field>
          </div>
        ))}
      </fieldset>
      <FormMessage state={state} />
      <SubmitButton variant="cta" size="lg" pendingText="Making the labels…">Print labels for {lotCount} {lotCount === 1 ? "lot" : "lots"}</SubmitButton>
    </form>
  );
}

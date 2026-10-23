"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import {
  cancelAction,
  createLabelJobAction,
  createReceiptLabelJobsAction,
  markFailedAction,
  markPrintedAction,
  reprintAction,
  retryAction,
  voidAction,
} from "./actions";

type Action = (prev: ActionState, f: FormData) => Promise<ActionState>;
const ACTIONS: Record<string, Action> = { printed: markPrintedAction, retry: retryAction, cancel: cancelAction };

function useKey() {
  const [key] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`));
  return key;
}

/** One-button command on a job (printed / retry / cancel). */
export function JobCommand({ jobId, kind, label, variant = "secondary", confirm }: { jobId: string; kind: "printed" | "retry" | "cancel"; label: string; variant?: "cta" | "secondary" | "danger"; confirm?: string }) {
  const [state, action] = useActionState<ActionState, FormData>(ACTIONS[kind], null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="space-y-2"
    >
      <input type="hidden" name="jobId" value={jobId} />
      <SubmitButton variant={variant} pendingText="Saving…" className="w-full sm:w-auto">
        {label}
      </SubmitButton>
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
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm("Void this label? It will be listed as superseded and must be destroyed. This cannot be undone.")) e.preventDefault();
      }}
      className="space-y-2"
    >
      <input type="hidden" name="jobId" value={jobId} />
      <Field label="Why does the label no longer match?" htmlFor={`void-${jobId}`} error={state?.fieldErrors?.reason}>
        <Input id={`void-${jobId}`} name="reason" placeholder="Repacked into a new drum" required minLength={5} />
      </Field>
      <SubmitButton variant="danger" pendingText="Voiding…">Void label</SubmitButton>
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
      <Field label="Reason for the reprint" htmlFor="reasonCode" error={fe.reasonCode}>
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
      <Field label="Copies" htmlFor="copies" error={fe.copies} hint={`Up to ${maxCopies}.`}>
        <Input id="copies" name="copies" type="number" inputMode="numeric" min={1} max={maxCopies} defaultValue={1} required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="cta" pendingText="Sending…">Reprint (logged)</SubmitButton>
    </form>
  );
}

type TemplateOpt = { id: string; code: string; name: string; media: string; copiesDefault: number };
type StationOpt = { id: string; code: string; name: string; printerName: string };

export function CreateJobForm({ entityType, entityId, templates, stations }: { entityType: string; entityId: string; templates: TemplateOpt[]; stations: StationOpt[] }) {
  const [state, action] = useActionState<ActionState, FormData>(createLabelJobAction, null);
  const key = useKey();
  const [tpl, setTpl] = useState(templates[0]?.id ?? "");
  const fe = state?.fieldErrors ?? {};
  const t = templates.find((x) => x.id === tpl);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <Field label="Label template" htmlFor="labelTemplateId" error={fe.labelTemplateId}>
        <Select id="labelTemplateId" name="labelTemplateId" value={tpl} onChange={(e) => setTpl(e.target.value)} required>
          {templates.map((x) => (
            <option key={x.id} value={x.id}>{x.code} · {x.media}</option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Copies" htmlFor="copies" error={fe.copies} hint="One per container.">
          <Input id="copies" name="copies" type="number" inputMode="numeric" min={1} max={99} defaultValue={t?.copiesDefault ?? 1} key={tpl} required />
        </Field>
        <Field label="Print station" htmlFor="printStationId" error={fe.printStationId}>
          <Select id="printStationId" name="printStationId" defaultValue={stations.length === 1 ? stations[0].id : ""} required>
            {stations.length > 1 && <option value="">Choose…</option>}
            {stations.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.printerName})</option>
            ))}
          </Select>
        </Field>
      </div>
      <FormMessage state={state} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <SubmitButton name="then" value="station" variant="cta" size="lg" pendingText="Sending…">Send to print station</SubmitButton>
        <SubmitButton name="then" value="print" variant="secondary" size="lg" pendingText="Preparing…">Print here now</SubmitButton>
      </div>
    </form>
  );
}

export function ReceiptJobsForm({ grId, templates, stations, lotCount }: { grId: string; templates: TemplateOpt[]; stations: StationOpt[]; lotCount: number }) {
  const [state, action] = useActionState<ActionState, FormData>(createReceiptLabelJobsAction, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="grId" value={grId} />
      <Field label="Label template" htmlFor="labelTemplateId" error={fe.labelTemplateId}>
        <Select id="labelTemplateId" name="labelTemplateId" required defaultValue={templates[0]?.id}>
          {templates.map((x) => (
            <option key={x.id} value={x.id}>{x.code} · {x.media}</option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Copies per lot" htmlFor="copies" error={fe.copies} hint="One per container.">
          <Input id="copies" name="copies" type="number" inputMode="numeric" min={1} max={99} defaultValue={1} required />
        </Field>
        <Field label="Print station" htmlFor="printStationId" error={fe.printStationId}>
          <Select id="printStationId" name="printStationId" defaultValue={stations.length === 1 ? stations[0].id : ""} required>
            {stations.length > 1 && <option value="">Choose…</option>}
            {stations.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.printerName})</option>
            ))}
          </Select>
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="cta" size="lg" pendingText="Sending…">Send {lotCount} {lotCount === 1 ? "label job" : "label jobs"} to the station</SubmitButton>
    </form>
  );
}

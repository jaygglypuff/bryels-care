"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { downloadPdfAction, reprintDocumentAction, voidDocumentAction } from "./actions";

export function DocReprintForm({ id, reasons }: { id: string; reasons: readonly { code: string; label: string; requiresNote: boolean }[] }) {
  const [state, action] = useActionState<ActionState, FormData>(reprintDocumentAction, null);
  const [key] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState("");
  const needsNote = reasons.find((r) => r.code === reason)?.requiresNote ?? false;
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <Field label="Reason for the reprint" htmlFor="reasonCode" error={fe.reasonCode}>
        <Select id="reasonCode" name="reasonCode" value={reason} onChange={(e) => setReason(e.target.value)} required>
          <option value="">Choose a reason…</option>
          {reasons.map((r) => (
            <option key={r.code} value={r.code}>{r.label}</option>
          ))}
        </Select>
      </Field>
      <Field label={needsNote ? "Explain (required)" : "Note (optional)"} htmlFor="note" error={fe.note}>
        <Textarea id="note" name="note" required={needsNote} minLength={needsNote ? 5 : undefined} maxLength={500} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="cta" pendingText="Reprinting…">Reprint (logged)</SubmitButton>
    </form>
  );
}

export function DocVoidForm({ id }: { id: string }) {
  const [state, action] = useActionState<ActionState, FormData>(voidDocumentAction, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm("Void this document? It stays on record but must not be used.")) e.preventDefault();
      }}
      className="space-y-2"
    >
      <input type="hidden" name="id" value={id} />
      <Field label="Why was it generated in error?" htmlFor="void-reason" error={state?.fieldErrors?.reason}>
        <Input id="void-reason" name="reason" required minLength={5} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="danger" pendingText="Voiding…">Void document</SubmitButton>
    </form>
  );
}

export function DownloadPdfForm({ id }: { id: string }) {
  const [state, action] = useActionState<ActionState, FormData>(downloadPdfAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="secondary" pendingText="Checking…">Download PDF</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

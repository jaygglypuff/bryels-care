"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { type ButtonVariant, Field, Input, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * One-button command form (submit, withdraw, start revision…), optionally with a required reason.
 * The server re-checks every rule; the button only appears when the page decided it applies.
 */
export function CommandForm({
  action,
  hidden,
  label,
  pendingText = "Working…",
  variant = "primary",
  reasonLabel,
  reasonName = "reason",
  confirmText,
}: {
  action: Action;
  hidden: Record<string, string>;
  label: string;
  pendingText?: string;
  variant?: ButtonVariant;
  reasonLabel?: string;
  reasonName?: string;
  confirmText?: string;
}) {
  const [state, run] = useActionState<ActionState, FormData>(action, null);
  const [open, setOpen] = useState(false);
  const needsPanel = !!reasonLabel || !!confirmText;
  const fe = state?.fieldErrors ?? {};
  const fieldsId = Object.values(hidden).join("-");
  if (needsPanel && !open) {
    return (
      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2">
          {label}
        </button>
        <FormMessage state={state} />
      </div>
    );
  }
  return (
    <form action={run} className="flex w-full flex-col gap-3">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {confirmText && <p className="text-[13px] text-fg-2">{confirmText}</p>}
      {reasonLabel && (
        <Field label={reasonLabel} htmlFor={`${reasonName}-${fieldsId}`} error={fe[reasonName]}>
          <Textarea id={`${reasonName}-${fieldsId}`} name={reasonName} required />
        </Field>
      )}
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant={variant} pendingText={pendingText}>
          {label}
        </SubmitButton>
        {needsPanel && (
          <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] rounded-full px-4 text-[14px] text-primary-text hover:underline">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** Approve or reject the waiting step; the final approval may set the effective date. */
export function DecisionForm({
  action,
  id,
  stepLabel,
  isFinal,
  defaultEffectiveFrom,
  today,
  plain = false,
}: {
  action: Action;
  id: string;
  stepLabel: string;
  isFinal: boolean;
  defaultEffectiveFrom?: string | null;
  today: string;
  /** Grade-5 words (ADR-088): "Use from", "Say OK", "Not OK". Default keeps the original words for the other screens. */
  plain?: boolean;
}) {
  const [state, run] = useActionState<ActionState, FormData>(action, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={run} className="flex flex-col gap-3 rounded-[16px] border border-line bg-surface-2/60 p-4">
      <input type="hidden" name="id" value={id} />
      <p className="text-[13px] font-medium">Your decision: {stepLabel}</p>
      {isFinal && (
        <Field
          label={plain ? "Use from" : "Effective from"}
          htmlFor={`eff-${id}`}
          error={fe.effectiveFrom}
          hint={plain ? "New batches from this day use this version; the old version stops that day." : "New batches planned on or after this date use this revision; the current one is superseded on that date."}
        >
          <Input id={`eff-${id}`} name="effectiveFrom" type="date" min={today} defaultValue={defaultEffectiveFrom && defaultEffectiveFrom >= today ? defaultEffectiveFrom : today} />
        </Field>
      )}
      <Field label={plain ? "Note (needed when it is not OK)" : "Note (required to reject)"} htmlFor={`note-${id}`} error={fe.note}>
        <Textarea id={`note-${id}`} name="note" placeholder={plain ? "What you checked, or what must change" : "What you checked, or why you reject"} />
      </Field>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="approved" variant="cta" pendingText="Saving…">
          {plain ? "Say OK" : "Approve"}
        </SubmitButton>
        <SubmitButton name="decision" value="rejected" variant="danger" pendingText="Saving…">
          {plain ? "Not OK" : "Reject"}
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * Simple create form around server-rendered fields. Field errors come back in the message
 * ("code: This code is already used.") because the fields are rendered on the server.
 */
export function CreateForm({ action, children, submitLabel, cancelHref }: { action: Action; children: React.ReactNode; submitLabel: string; cancelHref: string }) {
  const [state, run] = useActionState<ActionState, FormData>(action, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={run} className="flex flex-col gap-4">
      {children}
      {Object.keys(fe).length > 0 && (
        <ul className="list-disc pl-5 text-[12px] text-[var(--bad-fg)]">
          {Object.entries(fe).map(([k, v]) => (
            <li key={k}>
              {k}: {v}
            </li>
          ))}
        </ul>
      )}
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="cta" pendingText="Creating…">
          {submitLabel}
        </SubmitButton>
        <a href={cancelHref} className="inline-flex min-h-[44px] items-center rounded-full border border-line px-5 text-[14px] font-medium hover:bg-surface-2">
          Cancel
        </a>
      </div>
    </form>
  );
}

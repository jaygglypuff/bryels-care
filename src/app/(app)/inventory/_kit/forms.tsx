"use client";
import { startTransition, useActionState, useState, type FormEvent, type ReactNode } from "react";
import type { ActionState } from "@/lib/errors";
import { Button, Field, Input, type ButtonVariant } from "@/ui/core";
import { FormMessage } from "@/ui/form";

/** Submits without React's automatic reset so fields keep their values on validation errors. */
export function useActionForm(action: (prev: ActionState, fd: FormData) => Promise<ActionState>, confirmText?: string) {
  const [state, dispatch, pending] = useActionState(action, null);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    if (confirmText && !window.confirm(confirmText)) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
  return { state, pending, onSubmit };
}

/**
 * A one-button command form (submit, approve, post, release…) with optional reason field and
 * confirmation. The server decides; the button only shows pending and the server's message.
 */
export function CommandForm({
  action,
  label,
  pendingLabel,
  variant = "primary",
  confirmText,
  reason,
  hidden,
  children,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  label: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  confirmText?: string;
  reason?: { label: string; placeholder?: string; required?: boolean };
  hidden?: Record<string, string>;
  children?: ReactNode;
}) {
  const { state, pending, onSubmit } = useActionForm(action, confirmText);
  const [open, setOpen] = useState(!reason);
  if (!open)
    return (
      <Button type="button" variant={variant === "cta" ? "secondary" : variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <form onSubmit={onSubmit} className="flex min-w-0 flex-col gap-3">
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      {reason && (
        <Field label={reason.label} htmlFor={`reason-${label}`} error={state?.fieldErrors?.reason}>
          <Input id={`reason-${label}`} name="reason" maxLength={500} required={reason.required ?? true} minLength={reason.required === false ? undefined : 3} placeholder={reason.placeholder} />
        </Field>
      )}
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? (pendingLabel ?? "Working…") : label}
        </Button>
        {reason && (
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Back
          </Button>
        )}
      </div>
    </form>
  );
}

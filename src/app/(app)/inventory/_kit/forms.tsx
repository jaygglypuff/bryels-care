"use client";
import { startTransition, useActionState, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ActionState } from "@/lib/errors";
import { Button, Field, Input, type ButtonVariant } from "@/ui/core";
import { FormMessage } from "@/ui/form";

/**
 * Submits without React's automatic reset so fields keep their values on validation errors.
 * With `confirmText` the first submit only asks, on the page ("Yes, continue" / "Back"; ADR-083, no
 * browser pop-ups): render `confirmBox` where the submit button is. Going back sends nothing.
 */
export function useActionForm(action: (prev: ActionState, fd: FormData) => Promise<ActionState>, confirmText?: string, confirmLabel = "Yes, continue") {
  const [state, dispatch, pending] = useActionState(action, null);
  const held = useRef<FormData | null>(null);
  const [asking, setAsking] = useState(false);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    if (confirmText) {
      held.current = fd;
      setAsking(true);
      return;
    }
    startTransition(() => dispatch(fd));
  };
  const confirmBox = asking ? (
    <div role="alertdialog" aria-label="Please confirm" className="flex flex-col gap-3 rounded-[14px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] p-3.5">
      <p className="text-[15px] font-medium text-fg">{confirmText}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="cta"
          size="lg"
          onClick={() => {
            const fd = held.current;
            setAsking(false);
            if (fd) startTransition(() => dispatch(fd));
          }}
        >
          {confirmLabel}
        </Button>
        <Button type="button" variant="secondary" size="lg" onClick={() => setAsking(false)}>
          Back
        </Button>
      </div>
    </div>
  ) : null;
  return { state, pending, onSubmit, confirmBox };
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
  confirmLabel,
  reason,
  hidden,
  children,
  size,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  label: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  confirmText?: string;
  /** Text of the confirm button (default "Yes, continue"). */
  confirmLabel?: string;
  size?: "sm" | "md" | "lg";
  reason?: { label: string; placeholder?: string; required?: boolean };
  hidden?: Record<string, string>;
  children?: ReactNode;
}) {
  const { state, pending, onSubmit, confirmBox } = useActionForm(action, confirmText, confirmLabel);
  const [open, setOpen] = useState(!reason);
  if (!open)
    return (
      <Button type="button" variant={variant === "cta" ? "secondary" : variant} size={size} onClick={() => setOpen(true)}>
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
      {confirmBox ?? (
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={variant} size={size} disabled={pending}>
          {pending ? (pendingLabel ?? "Working…") : label}
        </Button>
        {reason && (
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Back
          </Button>
        )}
      </div>
      )}
    </form>
  );
}

"use client";
import { type ReactNode, useActionState } from "react";
import { Field, Input, type ButtonVariant } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { type UserActionState, userCommand } from "./actions";

/**
 * A small form bound to one user command. `reason` adds the mandatory reason field. A one-time link
 * returned because email is not set up is shown once, with the instruction to pass it on in person.
 */
export function CommandForm({
  userId,
  op,
  label,
  pending = "Saving…",
  variant = "secondary",
  reason,
  children,
  hidden,
}: {
  userId: string;
  op: string;
  label: string;
  pending?: string;
  variant?: ButtonVariant;
  reason?: { label: string; hint?: string };
  children?: ReactNode;
  hidden?: Record<string, string>;
}) {
  const [state, action] = useActionState<UserActionState, FormData>(userCommand, null);
  const id = `${op}-${hidden ? Object.values(hidden).join("-") : userId}`;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="op" value={op} />
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      {reason && (
        <Field label={reason.label} htmlFor={`${id}-reason`} error={state?.fieldErrors?.reason} hint={reason.hint}>
          <Input id={`${id}-reason`} name="reason" required minLength={5} maxLength={300} />
        </Field>
      )}
      <FormMessage state={state} />
      {state?.ok && state.manualLink && (
        <div className="rounded-[12px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] p-3 text-[13px] text-[var(--warn-fg)]">
          <p className="font-semibold">Email is not set up, so nothing was sent.</p>
          <p className="mt-1">Give this one-time link to the person directly (not by group chat). It is shown only now:</p>
          <p className="mt-2 select-all break-all rounded bg-surface px-2 py-1 font-mono text-[12px] text-fg">{state.manualLink}</p>
        </div>
      )}
      <div>
        <SubmitButton variant={variant} pendingText={pending}>
          {label}
        </SubmitButton>
      </div>
    </form>
  );
}

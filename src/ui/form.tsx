"use client";
import { useFormStatus } from "react-dom";
import { useActionState, useRef, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import type { ActionState } from "@/lib/errors";
import { Button, cx, type ButtonVariant } from "./core";
import { WhoCanHelp } from "./who-can-help";

export function SubmitButton({ children, pendingText = "Saving…", onClick, ...rest }: ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  // A button's name/value (e.g. decision=approved) is copied into a hidden field before submitting: some
  // browsers (iPad Safari) leave the clicked button out of the form data once it disables itself.
  const carryValue = (e: MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    const b = e.currentTarget;
    if (!rest.name || b.form == null) return;
    let field = b.form.querySelector<HTMLInputElement>(`input[type="hidden"][data-submitter="${rest.name}"]`);
    if (!field) {
      field = document.createElement("input");
      field.type = "hidden";
      field.name = rest.name;
      field.dataset.submitter = rest.name;
      b.form.appendChild(field);
    }
    field.value = String(rest.value ?? "");
  };
  const { name: _name, ...button } = rest;
  return (
    <Button type="submit" disabled={pending || rest.disabled} onClick={carryValue} {...button}>
      {pending ? pendingText : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state?.message) return null;
  return (
    <div
      role={state.ok ? "status" : "alert"}
      className={cx(
        "rounded-[10px] border px-3 py-2 text-[13px]",
        state.ok ? "border-[var(--ok-bd)] bg-[var(--ok-bg)] text-[var(--ok-fg)]" : "border-[var(--bad-bd)] bg-[var(--bad-bg)] text-[var(--bad-fg)]",
      )}
    >
      {state.message}
      {!state.ok && state.needs && <WhoCanHelp permission={state.needs.permission} siteId={state.needs.siteId} />}
    </div>
  );
}

export type FormAction<S extends ActionState = ActionState> = (prev: S, fd: FormData) => Promise<S>;

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/**
 * `useActionState` for an in-place server action (ADR-043, docs/ux-system.md "Rules: 5.8a").
 *
 * - Puts an `idempotencyKey` into the form data at submit: the same payload again (a retry or a
 *   double tap) reuses the key, any other payload gets a new one, and a success clears it. The
 *   form is not re-rendered to rotate the key.
 * - Does not refresh anything. The server action calls `refreshCurrentPage()`, so its response
 *   carries the re-rendered page and React commits the result and the fresh data together; the
 *   submit button stays pending until both are on screen.
 */
export function useInPlaceAction<S extends ActionState>(action: FormAction<S>, initial = null as Awaited<S>) {
  const last = useRef<{ payload: string; key: string } | null>(null);
  return useActionState<S, FormData>(async (prev, fd) => {
    fd.delete("idempotencyKey");
    const payload = JSON.stringify([...fd.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `${v.name}:${v.size}`]));
    if (!last.current || last.current.payload !== payload) last.current = { payload, key: newKey() };
    fd.set("idempotencyKey", last.current.key);
    const r = await action(prev, fd);
    if (r?.ok) last.current = null;
    return r;
  }, initial);
}

/**
 * The shared in-place form: hidden fields, optional fields (a render function receives the server's
 * field errors), an optional confirm, one submit button with pending text, and the server's message.
 * The server re-checks every rule; this component only submits and shows the outcome.
 */
export function ActionForm<S extends ActionState = ActionState>({
  action,
  hidden = {},
  submit,
  pending = "Saving…",
  variant = "primary",
  size = "md",
  confirm,
  children,
  className = "flex flex-col gap-3",
  messageBelow = false,
}: {
  action: FormAction<S>;
  hidden?: Record<string, string | null | undefined>;
  submit: string;
  pending?: string;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  /** Asked with `window.confirm` before submitting; cancelling sends nothing. */
  confirm?: string;
  children?: ReactNode | ((fieldErrors: Record<string, string>) => ReactNode);
  /** Replaces the default layout classes. */
  className?: string;
  /** Show the server's message under the button instead of above it. */
  messageBelow?: boolean;
}) {
  const [state, dispatch] = useInPlaceAction<S>(action);
  const fe = state?.fieldErrors ?? {};
  const message = <FormMessage state={state} />;
  return (
    <form action={dispatch} className={className} onSubmit={(e) => confirm && !window.confirm(confirm) && e.preventDefault()}>
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {typeof children === "function" ? children(fe) : children}
      {!messageBelow && message}
      <div>
        <SubmitButton variant={variant} size={size} pendingText={pending}>
          {submit}
        </SubmitButton>
      </div>
      {messageBelow && message}
    </form>
  );
}

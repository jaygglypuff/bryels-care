"use client";
import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import type { ActionState } from "@/lib/errors";
import { Button, cx } from "./core";

export function SubmitButton({ children, pendingText = "Saving…", ...rest }: ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || rest.disabled} {...rest}>
      {pending ? pendingText : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state?.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={cx(
        "rounded-[10px] border px-3 py-2 text-[13px]",
        state.ok ? "border-[var(--ok-bd)] bg-[var(--ok-bg)] text-[var(--ok-fg)]" : "border-[var(--bad-bd)] bg-[var(--bad-bg)] text-[var(--bad-fg)]",
      )}
    >
      {state.message}
    </p>
  );
}

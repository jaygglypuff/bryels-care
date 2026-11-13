"use client";
import { startTransition, useActionState, type FormEvent } from "react";
import type { ActionState } from "@/lib/errors";
import { withNoInternet } from "@/lib/offline/words";

/**
 * Submits a form to a server action without React's automatic form reset, so controlled fields
 * (selects, dynamic order lines) keep their values when the server returns validation errors.
 * `confirmText` asks before destructive or irreversible posts.
 */
export function useActionForm(action: (prev: ActionState, fd: FormData) => Promise<ActionState>, confirmText?: string) {
  const [state, dispatch, pending] = useActionState(withNoInternet(action), null); // ADR-134: no internet in words
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    if (confirmText && !window.confirm(confirmText)) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
  return { state, pending, onSubmit };
}

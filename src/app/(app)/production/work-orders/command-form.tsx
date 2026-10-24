"use client";
import type { ReactNode } from "react";
import type { ActionState } from "@/lib/errors";
import type { ButtonVariant } from "@/ui/core";
import { ActionForm } from "@/ui/form";

/**
 * Small form that posts hidden fields (and optional fields) to a server action and shows its result
 * under the button: the shared in-place ActionForm (ADR-043) with the W2A layout. A double click
 * replays the same command (same idempotency key); a new click after a success is a new command.
 */
export function CommandForm({
  action,
  fields,
  label,
  pendingText = "Working…",
  variant = "primary",
  size = "md",
  children,
  confirm,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  label: string;
  pendingText?: string;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  children?: ReactNode;
  confirm?: string;
}) {
  return (
    <ActionForm action={action} hidden={fields} submit={label} pending={pendingText} variant={variant} size={size} confirm={confirm} className="flex min-w-0 flex-col gap-2" messageBelow>
      {children}
    </ActionForm>
  );
}

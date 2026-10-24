"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import type { ActionState } from "@/lib/errors";
import type { ButtonVariant } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/**
 * Small form that posts hidden fields to a server action and shows its result. Each render gets
 * a fresh idempotency key after a completed submission, so a double click replays, a new click
 * after success is a new command.
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
  const [key, setKey] = useState(newKey);
  const [state, formAction] = useActionState(action, null);
  const router = useRouter();
  useEffect(() => {
    if (!state?.ok) return;
    setKey(newKey());
    router.refresh();
    // A refresh right after a client navigation was sometimes dropped in production builds; refresh again.
    const again = setTimeout(() => router.refresh(), 700);
    return () => clearTimeout(again);
  }, [state, router]);
  return (
    <form
      action={formAction}
      className="flex min-w-0 flex-col gap-2"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="idempotencyKey" value={key} />
      {children}
      <div>
        <SubmitButton variant={variant} size={size} pendingText={pendingText}>
          {label}
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

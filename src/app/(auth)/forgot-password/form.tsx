"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Card, Field, Input } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { requestReset } from "../account-actions";

export function ForgotForm({ emailReady }: { emailReady: boolean }) {
  const [state, action] = useActionState(requestReset, null);
  return (
    <Card>
      <h1 className="font-display text-[24px] font-semibold">Forgot your password?</h1>
      <p className="mb-5 mt-1 text-[13px] text-muted">Enter your work email. If the account exists we send a link that works once, for 30 minutes.</p>
      {!emailReady && (
        <p className="mb-4 rounded-[10px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-3 py-2 text-[13px] text-[var(--warn-fg)]">
          Email is not set up on this system yet, so no link can be sent. Ask your system administrator to reset your password for you.
        </p>
      )}
      {state?.ok ? (
        <FormMessage state={state} />
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="username" required />
          </Field>
          <FormMessage state={state} />
          <SubmitButton size="lg" variant="cta" pendingText="Sending…">
            Send reset link
          </SubmitButton>
        </form>
      )}
      <Link href="/sign-in" className="mt-4 block text-center text-[13px] font-medium text-primary-text hover:underline">
        Back to sign-in
      </Link>
    </Card>
  );
}

"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Card, Field, Input } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { verifyCode } from "../actions";

export function VerifyForm() {
  const [state, action] = useActionState(verifyCode, null);
  return (
    <Card>
      <h1 className="font-display text-[24px] font-semibold">Enter your code</h1>
      <p className="mb-5 mt-1 text-[13px] text-muted">Open your authenticator app and type the 6-digit code for Bryel&apos;s Care. Lost your phone? Use one of your recovery codes.</p>
      <form action={action} className="flex flex-col gap-4">
        <Field label="Code" htmlFor="code" error={state?.fieldErrors?.code}>
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required maxLength={19} className="font-mono tracking-[.2em]" />
        </Field>
        <FormMessage state={state} />
        <SubmitButton size="lg" variant="cta" pendingText="Checking…">
          Continue
        </SubmitButton>
        <Link href="/sign-in" className="text-center text-[13px] font-medium text-primary-text hover:underline">
          Start again
        </Link>
      </form>
    </Card>
  );
}

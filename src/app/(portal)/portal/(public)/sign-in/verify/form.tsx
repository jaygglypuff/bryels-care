"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Card, Field, Input } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { portalVerifyCode } from "../../../actions";

export function PortalVerifyForm() {
  const [state, action] = useActionState(portalVerifyCode, null);
  return (
    <Card>
      <h1 className="font-display text-[24px] font-semibold">Enter your code</h1>
      <p className="mb-5 mt-1 text-[13px] text-muted">Open your authenticator app and type the 6-digit code for the Bryel&apos;s Care portal. Lost your phone? Ask your Bryel&apos;s Care representative to reset two-step sign-in.</p>
      <form action={action} className="flex flex-col gap-4">
        <Field label="Code" htmlFor="code" error={state?.fieldErrors?.code}>
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required maxLength={6} className="font-mono tracking-[.2em]" />
        </Field>
        <FormMessage state={state} />
        <SubmitButton size="lg" variant="cta" pendingText="Checking…">
          Continue
        </SubmitButton>
        <Link href="/portal/sign-in" className="text-center text-[13px] font-medium text-primary-text hover:underline">
          Start again
        </Link>
      </form>
    </Card>
  );
}

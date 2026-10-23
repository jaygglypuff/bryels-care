"use client";
import { useActionState } from "react";
import { Card, Field, Input } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { signIn } from "./actions";

export function SignInForm() {
  const [state, action] = useActionState(signIn, null);
  return (
    <Card>
      <h1 className="font-display text-[26px] font-semibold">Welcome back</h1>
      <p className="mb-5 mt-1 text-[13px] text-muted">Sign in to continue to your site.</p>
      <form action={action} className="flex flex-col gap-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <FormMessage state={state} />
        <SubmitButton size="lg" variant="cta" pendingText="Signing in…">
          Sign in
        </SubmitButton>
      </form>
    </Card>
  );
}

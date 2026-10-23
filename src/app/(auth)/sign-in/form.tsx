"use client";
import { useActionState } from "react";
import { Card, Field, Input } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { signIn } from "./actions";

export function SignInForm() {
  const [state, action] = useActionState(signIn, null);
  return (
    <Card>
      <h1 className="mb-4 text-[20px] font-semibold">Sign in</h1>
      <form action={action} className="flex flex-col gap-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <FormMessage state={state} />
        <SubmitButton size="lg" pendingText="Signing in…">
          Sign in
        </SubmitButton>
      </form>
    </Card>
  );
}

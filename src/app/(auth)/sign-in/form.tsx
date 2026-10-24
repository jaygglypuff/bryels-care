"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Card, Field, Input } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { signIn } from "./actions";

export function SignInForm({ notice }: { notice?: string | null }) {
  const [state, action] = useActionState(signIn, null);
  return (
    <Card>
      <h1 className="font-display text-[26px] font-semibold">Welcome back</h1>
      <p className="mb-5 mt-1 text-[13px] text-muted">Sign in to continue to your site.</p>
      {notice && (
        <p role="status" className="mb-4 rounded-[10px] border border-[var(--ok-bd)] bg-[var(--ok-bg)] px-3 py-2 text-[13px] text-[var(--ok-fg)]">
          {notice}
        </p>
      )}
      <form action={action} className="flex flex-col gap-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <label className="flex items-start gap-2 text-[13px] text-fg-2">
          <input type="checkbox" name="sharedDevice" className="mt-0.5 size-4 accent-[var(--brand-600)]" />
          <span>This is a shared device (signs out sooner when idle)</span>
        </label>
        <FormMessage state={state} />
        <SubmitButton size="lg" variant="cta" pendingText="Signing in…">
          Sign in
        </SubmitButton>
        <Link href="/forgot-password" className="text-center text-[13px] font-medium text-primary-text hover:underline">
          Forgot your password?
        </Link>
      </form>
    </Card>
  );
}

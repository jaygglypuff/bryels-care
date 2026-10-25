"use client";
import { useActionState } from "react";
import { Card, Field, Input } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { portalSignIn } from "../../actions";

export function PortalSignInForm({ notice, email }: { notice?: string | null; email?: string | null }) {
  const [state, action] = useActionState(portalSignIn, null);
  return (
    <Card>
      <h1 className="font-display text-[26px] font-semibold">Customer portal</h1>
      <p className="mb-5 mt-1 text-[13px] text-muted">Sign in with the email Bryel&apos;s Care invited. Staff accounts do not work here.</p>
      {notice && (
        <p role="status" className="mb-4 rounded-[10px] border border-[var(--ok-bd)] bg-[var(--ok-bg)] px-3 py-2 text-[13px] text-[var(--ok-fg)]">
          {notice}
        </p>
      )}
      <form action={action} className="flex flex-col gap-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="username" defaultValue={email ?? undefined} required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <FormMessage state={state} />
        <SubmitButton size="lg" variant="cta" pendingText="Signing in…">
          Sign in
        </SubmitButton>
        <p className="text-center text-[12.5px] text-muted">Forgot your password or locked out? Ask your Bryel&apos;s Care sales representative to send you a new invitation link.</p>
      </form>
    </Card>
  );
}

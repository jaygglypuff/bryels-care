"use client";
import { useActionState } from "react";
import { Card, CardTitle, Field, Input } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { reauth } from "./actions";

/**
 * "Confirm it's you" card shown above restricted forms when the session has not re-authenticated
 * recently (docs/security.md §3.6). The server enforces the rule; this card only makes it reachable.
 */
export function ReauthCard({ purpose, needsCode }: { purpose: string; needsCode: boolean }) {
  const [state, action] = useActionState(reauth, null);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <Card className="border border-[var(--warn-bd)]">
      <CardTitle>Confirm it&apos;s you</CardTitle>
      <p className="mb-3 text-[13px] text-muted">Restricted changes need your password{needsCode ? " and a code from your authenticator app" : ""} again. The confirmation lasts 10 minutes.</p>
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <input type="hidden" name="purpose" value={purpose} />
        <Field label="Your password" htmlFor="reauth-password" error={state?.fieldErrors?.password}>
          <Input id="reauth-password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        {needsCode ? (
          <Field label="Code" htmlFor="reauth-code" error={state?.fieldErrors?.code}>
            <Input id="reauth-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={19} required />
          </Field>
        ) : (
          <span className="hidden sm:block" />
        )}
        <SubmitButton variant="cta" pendingText="Checking…">
          Confirm
        </SubmitButton>
        <div className="sm:col-span-3">
          <FormMessage state={state} />
        </div>
      </form>
    </Card>
  );
}

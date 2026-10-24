"use client";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import type { ActionState } from "@/lib/errors";
import type { TokenState } from "@/modules/identity";
import { Card, Field, Input } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";

type Props = {
  mode: "invite" | "reset";
  check: (token: string) => Promise<TokenState>;
  submit: (s: ActionState, fd: FormData) => Promise<ActionState>;
};

/**
 * Reads the one-time token from the URL fragment (#token=…, never sent to the server), removes it from
 * the address bar, checks it, and posts it in the form body with the new password (docs/security.md §3.8).
 */
export function TokenPasswordForm({ mode, check, submit }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<TokenState | "loading" | "error">("loading");
  const [state, action] = useActionState(submit, null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", window.location.pathname);
    if (!t) {
      setInfo({ state: "invalid" });
      return;
    }
    setToken(t);
    check(t).then(setInfo, () => setInfo("error"));
  }, [check]);

  const again = mode === "invite" ? "Ask your administrator to send a new invitation." : "Request a new link.";
  if (info === "loading") return <Card aria-busy="true"><p className="text-[14px] text-muted">Checking your link…</p></Card>;
  if (info === "error")
    return (
      <Card>
        <h1 className="font-display text-[22px] font-semibold">The link could not be checked</h1>
        <p className="mt-2 text-[13px] text-muted">Check your connection and open the link from the email again.</p>
      </Card>
    );
  if (info.state !== "valid")
    return (
      <Card>
        <h1 className="font-display text-[22px] font-semibold">{info.state === "expired" ? "This link has expired" : info.state === "used" ? "This link was already used" : "This link is not valid"}</h1>
        <p className="mt-2 text-[13px] text-muted">Links work once and for a limited time. {again}</p>
        <Link href={mode === "invite" ? "/sign-in" : "/forgot-password"} className="mt-4 inline-block text-[14px] font-medium text-primary-text hover:underline">
          {mode === "invite" ? "Go to sign-in" : "Request a new link"}
        </Link>
      </Card>
    );
  return (
    <Card>
      <h1 className="font-display text-[24px] font-semibold">{mode === "invite" ? `Welcome, ${info.displayName}` : "Choose a new password"}</h1>
      <p className="mb-5 mt-1 text-[13px] text-muted">
        {mode === "invite" ? "Choose the password for " : "New password for "}
        <span className="font-medium text-fg">{info.email}</span>. Use at least 12 characters; a short sentence is easy to remember and hard to guess.
      </p>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token ?? ""} />
        <input type="hidden" name="username" value={info.email} autoComplete="username" />
        <Field label="New password" htmlFor="password" error={state?.fieldErrors?.password}>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
        </Field>
        <Field label="Type it again" htmlFor="confirm" error={state?.fieldErrors?.confirm}>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
        </Field>
        <FormMessage state={state} />
        <SubmitButton size="lg" variant="cta" pendingText="Saving…">
          {mode === "invite" ? "Set password and continue" : "Save new password"}
        </SubmitButton>
      </form>
    </Card>
  );
}

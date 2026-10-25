"use client";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import type { PortalTokenState } from "@/modules/portal";
import { Card, Field, Input } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { acceptPortalInvite, checkPortalInvitation } from "../../actions";

/**
 * Accepting a portal invitation: the one-time token travels in the URL fragment (#token=…, never sent
 * to the server or logged), is removed from the address bar, checked, and posted with the password.
 */
export function PortalInviteForm() {
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<PortalTokenState | "loading" | "error">("loading");
  const [state, action] = useActionState(acceptPortalInvite, null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", window.location.pathname);
    if (!t) {
      setInfo({ state: "invalid" });
      return;
    }
    setToken(t);
    checkPortalInvitation(t).then(setInfo, () => setInfo("error"));
  }, []);

  if (info === "loading")
    return (
      <Card aria-busy="true">
        <p className="text-[14px] text-muted">Checking your link…</p>
      </Card>
    );
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
        <p className="mt-2 text-[13px] text-muted">Invitation links work once and for a limited time. Ask your Bryel&apos;s Care sales representative to send a new one.</p>
        <Link href="/portal/sign-in" className="mt-4 inline-block text-[14px] font-medium text-primary-text hover:underline">
          Go to the portal sign-in
        </Link>
      </Card>
    );
  return (
    <Card>
      <h1 className="font-display text-[24px] font-semibold">Welcome, {info.displayName}</h1>
      <p className="mb-5 mt-1 text-[13px] text-muted">
        Portal access for <span className="font-medium text-fg">{info.customerName}</span>. Choose the password for <span className="font-medium text-fg">{info.email}</span>: at least 12
        characters; a short sentence is easy to remember and hard to guess.
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
          Set password and continue
        </SubmitButton>
      </form>
    </Card>
  );
}

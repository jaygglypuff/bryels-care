"use client";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { Button, Field, Input } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { type EnrolState, changePassword, finishEnrolment, startEnrolment, turnOffMfa } from "./actions";

export function ChangePasswordForm({ email }: { email: string }) {
  const [state, action] = useActionState(changePassword, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="username" value={email} autoComplete="username" />
      <Field label="Current password" htmlFor="currentPassword" error={state?.fieldErrors?.currentPassword}>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="New password" htmlFor="newPassword" error={state?.fieldErrors?.newPassword} hint="At least 12 characters. Your other devices are signed out.">
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
      </Field>
      <Field label="Type it again" htmlFor="confirm" error={state?.fieldErrors?.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
      </Field>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingText="Saving…">Change password</SubmitButton>
      </div>
    </form>
  );
}

/** Enrolment: start (QR + manual key) → confirm one code → recovery codes shown once. */
export function MfaEnrolment() {
  const [started, start, starting] = useActionState<EnrolState>(startEnrolment, null);
  const [done, confirm] = useActionState<EnrolState, FormData>(finishEnrolment, null);
  const router = useRouter();
  if (done?.ok && done.codes)
    return (
      <div className="flex flex-col gap-3" role="status">
        <p className="font-semibold text-[var(--ok-fg)]">Two-step sign-in is on.</p>
        <p className="text-[13px] text-fg-2">Save these recovery codes somewhere safe (printed, or in a password manager). Each works once if you lose your phone. They are shown only now.</p>
        <ul className="grid grid-cols-1 gap-1.5 rounded-[12px] bg-surface-2 p-3 font-mono text-[13px] sm:grid-cols-2">
          {done.codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div>
          <Button type="button" variant="cta" onClick={() => router.refresh()}>
            I saved them
          </Button>
        </div>
      </div>
    );
  if (!started?.ok)
    return (
      <form action={start} className="flex flex-col gap-2">
        {started?.message && <FormMessage state={{ ok: false, message: started.needsReauth ? `${started.message} Use the "Confirm it's you" box above first.` : started.message }} />}
        <div>
          <Button type="submit" variant="cta" disabled={starting}>
            {starting ? "Preparing…" : "Set up two-step sign-in"}
          </Button>
        </div>
      </form>
    );
  return (
    <div className="flex flex-col gap-3">
      <ol className="list-decimal pl-5 text-[13px] text-fg-2">
        <li>Install an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis…).</li>
        <li>Scan the code, or type the key by hand.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={started.qr} alt="QR code for your authenticator app" width={220} height={220} className="rounded-[12px] border border-line" />
      <p className="break-all font-mono text-[13px]">Key: {started.secret?.replace(/(.{4})/g, "$1 ").trim()}</p>
      <form action={confirm} className="flex flex-wrap items-end gap-3">
        <Field label="Code from the app" htmlFor="enrol-code" error={done?.fieldErrors?.code}>
          <Input id="enrol-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="w-40 font-mono tracking-[.2em]" />
        </Field>
        <SubmitButton variant="cta" pendingText="Checking…">
          Turn on
        </SubmitButton>
      </form>
      {done && !done.ok && done.message && !done.fieldErrors && <FormMessage state={{ ok: false, message: done.message }} />}
    </div>
  );
}

export function MfaDisableForm() {
  const [state, action] = useActionState(turnOffMfa, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <Field label="Current code" htmlFor="off-code" error={state?.fieldErrors?.code}>
        <Input id="off-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={19} required className="w-48" />
      </Field>
      <SubmitButton variant="secondary" pendingText="Turning off…">
        Turn off
      </SubmitButton>
      <div className="w-full">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

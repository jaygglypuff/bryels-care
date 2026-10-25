"use client";
import { Field, Input } from "@/ui/core";
import { ActionForm, FormMessage, SubmitButton, useInPlaceAction } from "@/ui/form";
import { portalBeginTotp, portalChangePassword, portalConfirmTotp, portalDisableTotp, type TotpBeginState } from "../../actions";

export function ChangePasswordForm({ email }: { email: string }) {
  return (
    <ActionForm action={portalChangePassword} submit="Change password" pending="Saving…" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {(fe) => (
        <>
          <input type="hidden" name="username" value={email} autoComplete="username" />
          <Field label="Current password" htmlFor="currentPassword" error={fe.currentPassword}>
            <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="New password" htmlFor="newPassword" error={fe.newPassword} hint="At least 12 characters">
            <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
          </Field>
          <Field label="Type it again" htmlFor="confirm" error={fe.confirm}>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
          </Field>
        </>
      )}
    </ActionForm>
  );
}

/** Step 1 (password) shows the QR code in this card; step 2 confirms one code. */
export function TotpEnrolForm() {
  const [begin, beginAction] = useInPlaceAction<TotpBeginState>(portalBeginTotp);
  return (
    <div className="flex flex-col gap-4">
      {!begin?.qrDataUrl ? (
        <form action={beginAction} className="flex flex-col gap-3">
          <Field label="Confirm your password to start" htmlFor="totpPassword" error={begin?.fieldErrors?.password}>
            <Input id="totpPassword" name="password" type="password" autoComplete="current-password" required />
          </Field>
          <FormMessage state={begin} />
          <div>
            <SubmitButton variant="secondary" pendingText="Preparing…">
              Set up two-step sign-in
            </SubmitButton>
          </div>
        </form>
      ) : (
        <>
          <div className="flex flex-col items-start gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL generated on the server */}
            <img src={begin.qrDataUrl} alt="QR code for your authenticator app" width={180} height={180} className="rounded-[12px] border border-line" />
            <p className="text-[12px] text-muted">
              Cannot scan? Enter this key: <code className="break-all font-mono">{begin.secret}</code>
            </p>
          </div>
          <ActionForm action={portalConfirmTotp} submit="Turn on" pending="Checking…">
            {(fe) => (
              <Field label="6-digit code from the app" htmlFor="totpCode" error={fe.code}>
                <Input id="totpCode" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="font-mono tracking-[.2em]" />
              </Field>
            )}
          </ActionForm>
        </>
      )}
    </div>
  );
}

export function TotpDisableForm() {
  return (
    <ActionForm action={portalDisableTotp} submit="Turn off" pending="Checking…" variant="secondary" confirm="Turn off two-step sign-in?">
      {(fe) => (
        <Field label="Current 6-digit code" htmlFor="totpOff" error={fe.code}>
          <Input id="totpOff" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="font-mono tracking-[.2em]" />
        </Field>
      )}
    </ActionForm>
  );
}

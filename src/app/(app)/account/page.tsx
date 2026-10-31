import { PageIntro } from "@/ui/guide";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { listMySessions, myMfaState, stepUpStatus } from "@/modules/identity";
import { Card, CardTitle, Dl, EmptyState, PageHeader } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { revokeMySession } from "./actions";
import { ChangePasswordForm, MfaDisableForm, MfaEnrolment } from "./forms";
import { ReauthCard } from "./reauth";

export const dynamic = "force-dynamic";
export const metadata = { title: "My account" };

/** Profile, password, own sessions and two-step sign-in (self-service, no permission needed). */
export default async function AccountPage() {
  const ctx = await requireContext();
  const [sessions, mfa, step] = await Promise.all([listMySessions(ctx), myMfaState(ctx), stepUpStatus(ctx)]);
  return (
    <>
      <PageHeader title="My account" subtitle={ctx.email} />
      <PageIntro>This screen is for you: your name, your password, the extra sign-in code on your phone, and where you are signed in.</PageIntro>
      {mfa.required && !mfa.enrolled && (
        <div className="mb-4">
          <Banner tone={mfa.overdue ? "bad" : "warn"} title={mfa.overdue ? "Two-step sign-in is required now" : "Set up two-step sign-in"}>
            Your role can change controlled records, so a password alone is not enough.{" "}
            {mfa.graceEndsAt && !mfa.overdue ? `Set it up before ${fmtDateTime(mfa.graceEndsAt)}.` : "Actions that need the owner's OK are blocked until it is set up."}
          </Banner>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Profile</CardTitle>
            <Dl
              items={[
                ["Name", ctx.displayName],
                ["Email", ctx.email],
                ["Roles", ctx.roleCodes.map((r) => ROLE_BUNDLES[r]?.name ?? r).join(", ")],
                ["Sites", ctx.isOrganizationWide ? "All sites" : ctx.allowedSites.map((s) => s.code).join(", ")],
              ]}
            />
            <p className="mt-3 text-[12px] text-muted">Your name and email are changed by a system administrator.</p>
          </Card>
          <Card>
            <CardTitle>Change password</CardTitle>
            <ChangePasswordForm email={ctx.email} />
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle action={mfa.enrolled ? <Chip tone="ok">On</Chip> : <Chip tone={mfa.required ? "warn" : "neu"}>Off</Chip>}>Two-step sign-in</CardTitle>
            {mfa.enrolled ? (
              <>
                <p className="mb-3 text-[13px] text-fg-2">Sign-in asks for a code from your authenticator app. Recovery codes left: {mfa.recoveryCodesLeft} of 10.</p>
                {mfa.required ? (
                  <p className="text-[13px] text-muted">Your role requires two-step sign-in, so it cannot be turned off. Lost your phone? An administrator can reset it.</p>
                ) : step.ready ? (
                  <MfaDisableForm />
                ) : (
                  <ReauthCard purpose="turn off two-step sign-in" needsCode={step.needsCode} />
                )}
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-[13px] text-fg-2">Adds a 6-digit code from your phone at sign-in, so a stolen password alone cannot get in.</p>
                {step.reauthFresh ? <MfaEnrolment /> : <ReauthCard purpose="set up two-step sign-in" needsCode={false} />}
              </div>
            )}
          </Card>
          <Card>
            <CardTitle action={<span className="text-[12px] text-muted">{sessions.length} signed in</span>}>Where you are signed in</CardTitle>
            {sessions.length === 0 ? (
              <EmptyState title="No other sessions" />
            ) : (
              <ul className="divide-y divide-line">
                {sessions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="font-medium text-fg">
                        {s.deviceLabel ?? "Unknown device"} {s.current && <Chip tone="ok">This device</Chip>} {s.deviceClass === "shared" && <Chip tone="info">Shared device</Chip>}
                      </p>
                      <p className="text-[12px] text-muted">
                        Last active {fmtDateTime(s.lastSeenAt)}
                        {s.ip ? ` · ${s.ip}` : ""} · signed in {fmtDateTime(s.createdAt)}
                      </p>
                    </div>
                    {!s.current && (
                      <form action={revokeMySession}>
                        <input type="hidden" name="sessionId" value={s.id} />
                        <button className="rounded-full border border-line px-3 py-1.5 text-[13px] font-medium text-fg hover:bg-surface-2">Sign out</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

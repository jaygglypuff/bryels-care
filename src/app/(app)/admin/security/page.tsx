import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { securityOverview } from "@/modules/identity";
import { Card, CardTitle, EmptyState, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../forbidden";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security" };

const LABEL: Record<string, string> = {
  "session.idle_minutes": "Idle sign-out, standard (minutes)",
  "session.idle_minutes_privileged": "Idle sign-out, privileged (minutes)",
  "session.idle_minutes_shared_device": "Idle sign-out, shared device (minutes)",
  "session.absolute_hours": "Longest session, standard (hours)",
  "session.absolute_hours_privileged": "Longest session, privileged (hours)",
  "session.purge_after_days": "Delete old sessions after (days)",
  "identity.reauth_window_minutes": "Re-confirm password for restricted changes every (minutes)",
  "identity.mfa.grace_days": "Days to set up two-step sign-in",
  "identity.invitation.ttl_hours": "Invitation link valid (hours)",
  "identity.password_reset.ttl_minutes": "Reset link valid (minutes)",
  "identity.password.min_length": "Minimum password length",
  "identity.password.history_count": "Recent passwords that cannot be reused",
  "identity.assignment.restricted_grant_requires_owner": "Roles with restricted permissions granted only by the owner",
};

/** Security overview: session and password policy (settings), email adapter, two-step coverage of privileged people. */
export default async function SecurityPage() {
  const ctx = await requireContext();
  if (!(ctx.can("identity.user.admin") || ctx.can("identity.role.admin"))) return <Forbidden what="security settings" />;
  const o = await securityOverview(ctx);
  const missing = o.mfa.filter((m) => !m.enrolled);
  return (
    <>
      <PageHeader title="Sign-in safety" />
      <PageIntro>This screen is for the IT person and the owner: the sign-in rules (password length, how long a sign-in lasts), whether email works, and who still has to set up the extra sign-in code on their phone.</PageIntro>
      <div className="mb-4 flex flex-col gap-3">
        {!o.email.ready && (
          <Banner tone="warn" title="Email does not work yet">
            {o.email.problem} Set EMAIL_PROVIDER=resend with RESEND_API_KEY and EMAIL_FROM on the server (docs/deployment-railway.md).
          </Banner>
        )}
        {!o.encryptionKeyConfigured && (
          <Banner tone={process.env.NODE_ENV === "production" ? "bad" : "info"} title="DATA_ENCRYPTION_KEY is not set">
            {process.env.NODE_ENV === "production" ? "Two-step sign-in cannot be set up until it is." : "Development uses a built-in key; production must set its own."}
          </Banner>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardTitle>Sign-in rules</CardTitle>
          <p className="mb-3 text-[13px] text-muted">Starting values the owner must check. Change them under Settings → Security; every change is kept in the history of changes.</p>
          <ul className="divide-y divide-line">
            {o.policy.map((p) => (
              <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-[13px] text-fg">
                  {LABEL[p.key] ?? p.key}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[13px] tabular">{typeof p.value === "boolean" ? (p.value ? "Yes" : "No") : String(p.value)}</span>
                  {p.isDefault ? <Chip tone="neu">Default</Chip> : <Chip tone="info">Changed</Chip>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Server set-up (for the IT person)</CardTitle>
            <ul className="flex flex-col gap-2 text-[13px]">
              <li>
                Email adapter: <span className="font-mono">{o.email.provider}</span> {o.email.ready ? <Chip tone="ok">Ready</Chip> : <Chip tone="warn">Setup required</Chip>}
              </li>
              <li>Two-step secret encryption key: {o.encryptionKeyConfigured ? <Chip tone="ok">Set</Chip> : <Chip tone="warn">Not set</Chip>}</li>
              <li>Client IP header for rate limits: {o.trustedProxyHeaderConfigured ? <Chip tone="ok">Set</Chip> : <Chip tone="warn">Not set (IP limits off)</Chip>}</li>
            </ul>
            <p className="mt-3 text-[12px] text-muted">
              Signed-in devices across your sites: <Link href="/admin/sessions" className="underline">Sessions</Link>.
            </p>
          </Card>
          <Card className="min-w-0">
            <CardTitle action={<span className="text-[12px] text-muted">{missing.length} not set up</span>}>Extra sign-in code for people who approve</CardTitle>
            {o.mfa.length === 0 ? (
              <EmptyState title="Nobody at your sites needs it" />
            ) : (
              <Table head={["Person", "Status", "Deadline"]}>
                {o.mfa.map((m) => (
                  <tr key={m.userId}>
                    <Td>
                      <Link href={`/admin/users/${m.userId}`} className="font-medium text-primary-text hover:underline">
                        {m.name}
                      </Link>
                    </Td>
                    <Td>{m.enrolled ? <Chip tone="ok">On</Chip> : m.overdue ? <Chip tone="bad">Overdue</Chip> : <Chip tone="warn">Pending</Chip>}</Td>
                    <Td className="text-fg-2">{m.graceEndsAt ? fmtDateTime(m.graceEndsAt) : "—"}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

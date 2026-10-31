import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listActiveSessions } from "@/modules/identity";
import { Card, EmptyState, PageHeader } from "@/ui/core";
import { Chip } from "@/ui/status";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../forbidden";
import { CommandForm } from "../users/[id]/command-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sessions" };

/** Signed-in devices of the people in the caller's scope (US-1-12, identity.session.view / .void). */
export default async function SessionsPage() {
  const ctx = await requireContext();
  if (!ctx.can("identity.session.view")) return <Forbidden what="sessions" />;
  const sessions = await listActiveSessions(ctx);
  const canVoid = ctx.can("identity.session.void");
  return (
    <>
      <PageHeader title="Who is signed in" subtitle={`${sessions.length} device(s)`} />
      <PageIntro>This screen is for the IT person: every phone, tablet and computer where someone is signed in. If a phone is lost, press “Sign out” on it; it is signed out the next time it is used.</PageIntro>
      <Card>
        
        {sessions.length === 0 ? (
          <EmptyState title="Nobody is signed in" />
        ) : (
          <ul className="divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-fg">
                    <Link href={`/admin/users/${s.userId}`} className="text-primary-text hover:underline">
                      {s.userName}
                    </Link>{" "}
                    <span className="break-all text-[12px] text-muted">{s.userEmail}</span>
                  </p>
                  <p className="text-[12px] text-muted">
                    {s.deviceLabel ?? "Unknown device"}
                    {s.ip ? ` · ${s.ip}` : ""} · last active {fmtDateTime(s.lastSeenAt)} · expires {fmtDateTime(s.expiresAt)}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {s.current && <Chip tone="ok">You, this device</Chip>}
                    {s.deviceClass === "shared" && <Chip tone="info">Shared device</Chip>}
                    {s.privileged && <Chip tone="warn">Can approve</Chip>}
                    {s.mfaVerified && <Chip tone="ok">Extra code checked</Chip>}
                  </p>
                </div>
                {canVoid && !s.current && (
                  <details className="w-full sm:w-auto">
                    <summary className="flex min-h-[44px] cursor-pointer items-center text-[14px] font-medium text-primary-text">Sign out</summary>
                    <div className="mt-2 sm:w-72">
                      <CommandForm userId={s.userId} op="revoke_session" label="Sign out this device" hidden={{ sessionId: s.id }} reason={{ label: "Why" }} />
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

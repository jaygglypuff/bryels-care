import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getUser, type UserDetail } from "@/modules/identity";
import { Card, CardTitle, Dl, EmptyState, PageHeader } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { actionLabel, moduleLabel } from "../../audit/format";
import { UserStatusChip } from "../user-status";
import { UnlockForm } from "./unlock-form";

export const dynamic = "force-dynamic";

export default async function UserDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ unlocked?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("identity.user.view")) return <Forbidden what="user administration" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d: UserDetail;
  try {
    d = await getUser(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const { user: u } = d;
  const justUnlocked = (await searchParams).unlocked === "1" && u.status === "active";

  return (
    <>
      <p className="mb-2 text-[13px]">
        <Link href="/admin/users" className="text-primary-text hover:underline">
          ← Users & roles
        </Link>
      </p>
      <PageHeader title={u.displayName} subtitle={u.email} actions={<UserStatusChip status={u.status} />} />

      {justUnlocked && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="Account unlocked">
            {u.displayName} can sign in again. The unlock and your reason are recorded in the audit log.
          </Banner>
        </div>
      )}

      {u.status === "locked" && (
        <div className="mb-4">
          <Banner tone="bad" title="This account is locked">
            Locked after {u.failedLoginCount} failed sign-in attempts. The user cannot sign in until a system administrator unlocks the account.
          </Banner>
          {ctx.can("identity.user.admin") ? (
            <Card className="mt-3">
              <CardTitle>Unlock account</CardTitle>
              <UnlockForm userId={u.id} />
            </Card>
          ) : (
            <p className="mt-2 text-[13px] text-muted">Only a system administrator can unlock accounts.</p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Account</CardTitle>
            <Dl
              items={[
                ["Status", <UserStatusChip key="s" status={u.status} />],
                ["Last sign-in", u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"],
                ["Failed attempts", String(u.failedLoginCount)],
                ["Created", fmtDateTime(u.createdAt)],
                ["Updated", fmtDateTime(u.updatedAt)],
              ]}
            />
          </Card>
          <Card>
            <CardTitle>Role assignments</CardTitle>
            {d.assignments.length === 0 ? (
              <EmptyState title="No assignments in your sites" />
            ) : (
              <ul className="divide-y divide-line">
                {d.assignments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span className="font-medium text-fg">{a.roleName}</span>
                    <span className="text-[13px] text-fg-2">{a.orgWide ? "All sites (organization-wide)" : `${a.siteCode} · ${a.siteName}`}</span>
                  </li>
                ))}
              </ul>
            )}
            {d.hiddenAssignments > 0 && <p className="mt-2 text-[12px] text-muted">{d.hiddenAssignments} assignment(s) at sites outside your scope are not shown.</p>}
          </Card>
          {d.history && (
            <Card>
              <CardTitle
                action={
                  <Link href={`/admin/audit?q=${encodeURIComponent(u.email)}`} className="text-[13px] font-medium text-primary-text hover:underline">
                    Audit log
                  </Link>
                }
              >
                Account history
              </CardTitle>
              {d.history.length === 0 ? (
                <p className="text-[13px] text-muted">No account events recorded.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {d.history.map((h) => (
                    <li key={h.id} className="py-2">
                      <p className="text-[13px] text-fg">{actionLabel(h.action)}</p>
                      <p className="text-[12px] text-muted">
                        {h.actorName ?? "System"} · {fmtDateTime(h.occurredAt)}
                        {h.reason && ` · “${h.reason}”`}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <Card className="min-w-0">
          <CardTitle action={<span className="text-[12px] text-muted">{d.permissionCount} permissions</span>}>Effective permissions</CardTitle>
          <p className="mb-3 text-[13px] text-muted">Union of the permissions of all roles assigned to this user. Each permission applies within the assignment&apos;s site scope.</p>
          {d.permissionsByModule.length === 0 ? (
            <EmptyState title="No permissions" />
          ) : (
            <div className="flex flex-col gap-3">
              {d.permissionsByModule.map((g) => (
                <section key={g.module}>
                  <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[.04em] text-fg-2">
                    {moduleLabel(g.module)} <span className="font-medium text-muted">· {g.permissions.length}</span>
                  </h3>
                  <ul className="flex flex-wrap gap-1.5">
                    {g.permissions.map((p) => (
                      <li key={p}>
                        <Chip tone={p.endsWith(".view") ? "neu" : "info"}>
                          <span className="font-mono text-[11px]">{p}</span>
                        </Chip>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

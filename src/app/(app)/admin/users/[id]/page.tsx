import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { type SessionView, type UserDetail, getUser, grantableRoles, listActiveSessions, warehousesForSites } from "@/modules/identity";
import { Card, CardTitle, Dl, EmptyState, Input, PageHeader, Select } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { actionLabel, moduleLabel } from "../../audit/format";
import { StepUpGate } from "../step-up-gate";
import { UserStatusChip } from "../user-status";
import { CommandForm } from "./command-form";

export const dynamic = "force-dynamic";

/** User detail (US-1-16): profile, status actions, assignments (US-1-18, US-2-29), sessions (US-1-12), MFA (US-1-28), audit. */
export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
  const self = u.id === ctx.userId;
  const canAdmin = ctx.can("identity.user.admin") && !self;
  const canAssign = ctx.can("identity.site_assignment.admin") && !self;
  const canSessions = ctx.can("identity.session.view");
  const [sessions, roles, whs] = await Promise.all([
    canSessions ? listActiveSessions(ctx, { userId: u.id }) : Promise.resolve([] as SessionView[]),
    canAssign && ctx.can("identity.site_assignment.view") ? grantableRoles(ctx, ctx.currentSiteId) : Promise.resolve([]),
    canAssign ? warehousesForSites(ctx) : Promise.resolve([]),
  ]);
  const restrictedHere = canAdmin || canAssign || ctx.can("identity.mfa.admin");

  return (
    <>
      <p className="mb-2 text-[13px]">
        <Link href="/admin/users" className="text-primary-text hover:underline">
          ← Users
        </Link>
      </p>
      <PageHeader title={u.displayName} subtitle={u.email} actions={<UserStatusChip status={u.status} />} />
      {self && (
        <div className="mb-4">
          <Banner tone="info" title="This is your own account">
            Nobody changes their own status or roles; another administrator does that. Your password and two-step sign-in are on <Link href="/account" className="underline">My account</Link>.
          </Banner>
        </div>
      )}
      {restrictedHere && !self && <StepUpGate ctx={ctx} purpose="change this account" />}

      {u.status === "invited" && (
        <div className="mb-4">
          <Banner tone="info" title={d.invitation?.expired ? "Invitation expired" : "Invitation pending"}>
            {d.invitation
              ? d.invitation.expired
                ? `The link expired on ${fmtDateTime(d.invitation.expiresAt)}. Send a new one.`
                : `Sent ${fmtDateTime(d.invitation.createdAt)}; valid until ${fmtDateTime(d.invitation.expiresAt)}.`
              : "No open invitation link."}
          </Banner>
          {ctx.can("identity.invitation.create") && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Card>
                <CardTitle>Send a new link</CardTitle>
                <p className="mb-3 text-[13px] text-muted">The previous link stops working.</p>
                <CommandForm userId={u.id} op="resend" label="Resend invitation" variant="cta" pending="Sending…" />
              </Card>
              <Card>
                <CardTitle>Withdraw the invitation</CardTitle>
                <CommandForm userId={u.id} op="revoke_invitation" label="Withdraw" variant="danger" reason={{ label: "Reason", hint: "For example: hire cancelled." }} />
              </Card>
            </div>
          )}
        </div>
      )}
      {u.status === "deactivated" && (
        <div className="mb-4">
          <Banner tone="neu" title="This account is deactivated">
            {u.deactivatedAt ? `Since ${fmtDateTime(u.deactivatedAt)}. ` : ""}Every request by this person is refused. The record stays for the audit trail.
          </Banner>
        </div>
      )}
      {u.status === "locked" && (
        <div className="mb-4">
          <Banner tone="bad" title="This account is locked">
            {u.failedLoginCount >= 5 ? `Locked after ${u.failedLoginCount} failed sign-in attempts.` : "Locked by an administrator."} The user cannot sign in until it is unlocked.
          </Banner>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Account</CardTitle>
            <Dl
              items={[
                ["Status", <UserStatusChip key="s" status={u.status} />],
                ["Last sign-in", u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"],
                ["Two-step sign-in", d.mfaEnrolled ? "On" : "Off"],
                ["Signed in on", `${d.liveSessions} device(s)`],
                ["Password set", u.passwordChangedAt ? fmtDateTime(u.passwordChangedAt) : "—"],
                ["Created", fmtDateTime(u.createdAt)],
              ]}
            />
            {ctx.can("identity.user.edit") && u.status !== "deactivated" && (
              <div className="mt-4 border-t border-line pt-4">
                <CommandForm userId={u.id} op="rename" label="Save name">
                  <label htmlFor="displayName" className="text-[13px] font-medium text-fg">Display name</label>
                  <Input id="displayName" name="displayName" defaultValue={u.displayName} required minLength={2} maxLength={120} />
                </CommandForm>
              </div>
            )}
          </Card>

          {canAdmin && (
            <Card>
              <CardTitle>Account actions</CardTitle>
              <div className="flex flex-col gap-5">
                {u.status === "active" && (
                  <>
                    <CommandForm userId={u.id} op="sign_out_all" label="Sign out everywhere" reason={{ label: "Reason for signing out", hint: "For example: phone reported lost." }} />
                    <CommandForm userId={u.id} op="force_reset" label="Force password reset" reason={{ label: "Reason for the reset" }} />
                    <CommandForm userId={u.id} op="lock" label="Lock account" variant="danger" reason={{ label: "Reason for locking" }} />
                  </>
                )}
                {u.status === "locked" && <CommandForm userId={u.id} op="unlock" label="Unlock account" variant="cta" reason={{ label: "Reason for unlocking", hint: "For example: identity confirmed by phone." }} />}
                {(u.status === "active" || u.status === "locked") && (
                  <CommandForm userId={u.id} op="deactivate" label="Deactivate (offboarding)" variant="danger" reason={{ label: "Reason for deactivation", hint: "Ends every role, signs out every device, voids links." }} />
                )}
                {u.status === "deactivated" && <CommandForm userId={u.id} op="reactivate" label="Reactivate" variant="cta" reason={{ label: "Reason for reactivation", hint: "No role comes back automatically." }} />}
                {d.mfaEnrolled && ctx.can("identity.mfa.admin") && (
                  <CommandForm userId={u.id} op="reset_mfa" label="Reset two-step sign-in" reason={{ label: "Reason for the reset", hint: "For example: new phone, identity confirmed in person." }} />
                )}
              </div>
            </Card>
          )}

          {d.history && (
            <Card>
              <CardTitle action={<Link href={`/admin/audit?q=${encodeURIComponent(u.email)}`} className="text-[13px] font-medium text-primary-text hover:underline">Audit log</Link>}>Account history</CardTitle>
              {d.history.length === 0 ? (
                <p className="text-[13px] text-muted">No account events recorded.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {d.history.map((h) => (
                    <li key={h.id} className="py-2">
                      <p className="text-[13px] text-fg">{actionLabel(h.action)}</p>
                      <p className="text-[12px] text-muted">
                        {h.actorName ?? h.actorLabel ?? "System"} · {fmtDateTime(h.occurredAt)}
                        {h.reason && ` · “${h.reason}”`}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Role assignments</CardTitle>
            {d.assignments.length === 0 ? (
              <EmptyState title="No current assignments in your sites">{u.status === "active" ? "The user cannot sign in to anything until a role is granted." : undefined}</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {d.assignments.map((a) => {
                  const siteWh = whs.filter((w) => w.siteId === a.siteId);
                  return (
                    <li key={a.id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-fg">
                          {a.roleName} {!a.roleIsSystem && <Chip tone="info">Custom</Chip>} {a.state === "scheduled" && <Chip tone="warn">Starts {fmtDate(a.validFrom)}</Chip>}
                        </span>
                        <span className="text-[13px] text-fg-2">{a.orgWide ? "All sites (organization-wide)" : `${a.siteCode} · ${a.siteName}`}</span>
                      </div>
                      <p className="text-[12px] text-muted">
                        From {fmtDate(a.validFrom)}
                        {a.validTo ? ` to ${fmtDate(a.validTo)}` : ", no end date"}
                        {a.warehouseIds ? ` · writes only in ${a.warehouseCodes.join(", ")}` : a.orgWide ? "" : " · whole site"}
                      </p>
                      {canAssign && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[13px] font-medium text-primary-text">Change</summary>
                          <div className="mt-3 flex flex-col gap-4 rounded-[14px] bg-surface-2 p-3">
                            {!a.orgWide && siteWh.length > 0 && (
                              <CommandForm userId={u.id} op="scope" label="Save warehouse limit" hidden={{ assignmentId: a.id }} reason={{ label: "Reason" }}>
                                <fieldset className="flex flex-wrap gap-3">
                                  <legend className="mb-1 text-[13px] font-medium text-fg">May post stock in (none ticked = whole site)</legend>
                                  {siteWh.map((w) => (
                                    <label key={w.id} className="flex items-center gap-1.5 text-[13px]">
                                      <input type="checkbox" name="warehouseIds" value={w.id} defaultChecked={a.warehouseIds?.includes(w.id)} className="size-4" /> {w.code} · {w.name}
                                    </label>
                                  ))}
                                </fieldset>
                              </CommandForm>
                            )}
                            <CommandForm userId={u.id} op="end_assignment" label="End this assignment" variant="danger" hidden={{ assignmentId: a.id }} reason={{ label: "Reason for ending" }} />
                          </div>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {d.hiddenAssignments > 0 && <p className="mt-2 text-[12px] text-muted">{d.hiddenAssignments} assignment(s) at sites outside your scope are not shown.</p>}
            {canAssign && u.status !== "deactivated" && (
              <details className="mt-3 border-t border-line pt-3">
                <summary className="cursor-pointer text-[14px] font-semibold text-primary-text">Grant a role</summary>
                <div className="mt-3">
                  <CommandForm userId={u.id} op="grant" label="Grant role" variant="cta">
                    <label htmlFor="grant-role" className="text-[13px] font-medium text-fg">Role</label>
                    <Select id="grant-role" name="roleId" required defaultValue="">
                      <option value="" disabled>Choose a role…</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                          {r.blockedReason && r.blockedReason !== "Site only" ? ` (${r.blockedReason})` : ""}
                        </option>
                      ))}
                    </Select>
                    <label htmlFor="grant-site" className="text-[13px] font-medium text-fg">Where</label>
                    <Select id="grant-site" name="siteId" required defaultValue={ctx.currentSiteId}>
                      {ctx.allowedSites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.code} · {s.name}
                        </option>
                      ))}
                      {ctx.isOrganizationWide && <option value="org">All sites (owner, system admin, auditor only)</option>}
                    </Select>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="grant-from" className="text-[13px] font-medium text-fg">Starts</label>
                        <Input id="grant-from" name="validFrom" type="date" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="grant-to" className="text-[13px] font-medium text-fg">Ends (optional)</label>
                        <Input id="grant-to" name="validTo" type="date" />
                      </div>
                    </div>
                    <label htmlFor="grant-reason" className="text-[13px] font-medium text-fg">Note (optional)</label>
                    <Input id="grant-reason" name="reason" maxLength={300} />
                  </CommandForm>
                  <p className="mt-2 text-[12px] text-muted">Roles with restricted permissions you do not hold are granted by the owner. Warehouse limits are set after granting.</p>
                </div>
              </details>
            )}
          </Card>

          {d.endedAssignments.length > 0 && (
            <Card>
              <CardTitle>Ended assignments</CardTitle>
              <ul className="divide-y divide-line text-[13px]">
                {d.endedAssignments.map((a) => (
                  <li key={a.id} className="py-2">
                    <span className="font-medium text-fg">{a.roleName}</span> · {a.orgWide ? "All sites" : a.siteCode} · {fmtDate(a.validFrom)} to {a.validTo ? fmtDate(a.validTo) : "—"}
                    {a.revokedReason && <span className="text-muted"> · “{a.revokedReason}”</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {canSessions && (
            <Card>
              <CardTitle>Active sessions</CardTitle>
              {sessions.length === 0 ? (
                <p className="text-[13px] text-muted">Not signed in anywhere.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {sessions.map((s) => (
                    <li key={s.id} className="py-2.5">
                      <p className="font-medium text-fg">
                        {s.deviceLabel ?? "Unknown device"} {s.deviceClass === "shared" && <Chip tone="info">Shared</Chip>} {s.privileged && <Chip tone="warn">Privileged</Chip>}
                      </p>
                      <p className="text-[12px] text-muted">
                        Last active {fmtDateTime(s.lastSeenAt)}
                        {s.ip ? ` · ${s.ip}` : ""} · expires {fmtDateTime(s.expiresAt)}
                      </p>
                      {ctx.can("identity.session.void") && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[13px] font-medium text-primary-text">Sign out this device</summary>
                          <div className="mt-2">
                            <CommandForm userId={u.id} op="revoke_session" label="Sign out" hidden={{ sessionId: s.id }} reason={{ label: "Reason" }} />
                          </div>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card className="min-w-0">
            <CardTitle action={<span className="text-[12px] text-muted">{d.permissionCount} permissions</span>}>Effective permissions</CardTitle>
            <p className="mb-3 text-[13px] text-muted">Union of the permissions of the user&apos;s current roles. Each applies within its assignment&apos;s site.</p>
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
                            <span className="break-all font-mono text-[11px]">{p}</span>
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
      </div>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { type SessionView, type UserDetail, getUser, grantableRoles, listActiveSessions, warehousesForSites } from "@/modules/identity";
import { Card, CardTitle, Dl, EmptyState, Input, PageHeader, Select } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { plainRole, plainRoleName } from "@/ui/role-names";
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
          ← People
        </Link>
      </p>
      <PageHeader title={u.displayName} subtitle={u.email} actions={<UserStatusChip status={u.status} />} />
      <PageIntro>This screen is for the owner and the IT person: what this person may do (their job), where, and their account. Changes are kept in the history of changes.</PageIntro>
      {!self && u.status === "invited" && (
        <NextStep text={`${u.displayName} has not signed in yet.`} waitingFor="They must open the link in their email (or the link you gave them) and choose a password." />
      )}
      {!self && u.status === "active" && d.assignments.length === 0 && canAssign && (
        <NextStep text={`Give ${u.displayName} a job (role) so they can use the app.`} action={{ label: "Give a job", href: "#grant" }} />
      )}
      {!self && u.status === "locked" && canAdmin && (
        <NextStep text="This account is locked. Unlock it only after you checked it is really them (for example by phone)." action={{ label: "Unlock", href: "#account-actions" }} />
      )}
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
            {u.deactivatedAt ? `Since ${fmtDateTime(u.deactivatedAt)}. ` : ""}They cannot sign in. Their name stays on past records and in the history of changes.
          </Banner>
        </div>
      )}
      {u.status === "locked" && (
        <div className="mb-4">
          <Banner tone="bad" title="This account is locked">
            {u.failedLoginCount >= 5 ? `Locked after ${u.failedLoginCount} failed sign-in attempts.` : "Locked by the IT person or the owner."} They cannot sign in until it is unlocked.
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
                  <label htmlFor="displayName" className="text-[13px] font-medium text-fg">Name shown in the app</label>
                  <Input id="displayName" name="displayName" defaultValue={u.displayName} required minLength={2} maxLength={120} />
                </CommandForm>
              </div>
            )}
          </Card>

          {canAdmin && (
            <div id="account-actions">
            <MoreDetails title="⋯ More: sign out, new password, lock or switch off this account" open={u.status === "locked"}>
              <div className="flex flex-col gap-5">
                {u.status === "active" && (
                  <>
                    <CommandForm userId={u.id} op="sign_out_all" label="Sign out everywhere" reason={{ label: "Reason for signing out", hint: "For example: phone reported lost." }} />
                    <CommandForm userId={u.id} op="force_reset" label="Make them choose a new password" reason={{ label: "Reason for the reset" }} />
                    <CommandForm userId={u.id} op="lock" label="Lock account" variant="danger" reason={{ label: "Reason for locking" }} />
                  </>
                )}
                {u.status === "locked" && <CommandForm userId={u.id} op="unlock" label="Unlock account" variant="cta" reason={{ label: "Reason for unlocking", hint: "For example: identity confirmed by phone." }} />}
                {(u.status === "active" || u.status === "locked") && (
                  <CommandForm userId={u.id} op="deactivate" label="Switch off (person left)" variant="danger" reason={{ label: "Why", hint: "Ends every job, signs out every device, stops old links." }} />
                )}
                {u.status === "deactivated" && <CommandForm userId={u.id} op="reactivate" label="Switch on again" variant="cta" reason={{ label: "Why", hint: "Their old jobs do not come back by themselves; give them again." }} />}
                {d.mfaEnrolled && ctx.can("identity.mfa.admin") && (
                  <CommandForm userId={u.id} op="reset_mfa" label="Reset two-step sign-in" reason={{ label: "Reason for the reset", hint: "For example: new phone, identity confirmed in person." }} />
                )}
              </div>
            </MoreDetails>
            </div>
          )}

          {d.history && (
            <Card>
              <CardTitle action={<Link href={`/admin/audit?q=${encodeURIComponent(u.email)}`} className="inline-flex min-h-[44px] items-center text-[14px] font-medium text-primary-text hover:underline">Full history</Link>}>History of changes</CardTitle>
              {d.history.length === 0 ? (
                <p className="text-[13px] text-muted">Nothing changed yet.</p>
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
            <CardTitle>Job (role) and where</CardTitle>
            {d.assignments.length === 0 ? (
              <EmptyState title="No job at your sites yet">{u.status === "active" ? "They can sign in but see nothing until you give them a job below." : undefined}</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {d.assignments.map((a) => {
                  const siteWh = whs.filter((w) => w.siteId === a.siteId);
                  return (
                    <li key={a.id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-fg">
                          {plainRoleName(a.roleName)} {!a.roleIsSystem && <Chip tone="info">Made here</Chip>} {a.state === "scheduled" && <Chip tone="warn">Starts {fmtDate(a.validFrom)}</Chip>}
                        </span>
                        <span className="text-[13px] text-fg-2">{a.orgWide ? "All sites" : a.siteName}</span>
                      </div>
                      <p className="text-[12px] text-muted">
                        From {fmtDate(a.validFrom)}
                        {a.validTo ? ` to ${fmtDate(a.validTo)}` : ", no end date"}
                        {a.warehouseIds ? ` · moves stock only in ${a.warehouseCodes.join(", ")}` : a.orgWide ? "" : " · whole site"}
                      </p>
                      {canAssign && (
                        <details className="mt-2">
                          <summary className="flex min-h-[44px] cursor-pointer items-center text-[14px] font-medium text-primary-text">Change</summary>
                          <div className="mt-3 flex flex-col gap-4 rounded-[14px] bg-surface-2 p-3">
                            {!a.orgWide && siteWh.length > 0 && (
                              <CommandForm userId={u.id} op="scope" label="Save warehouse limit" hidden={{ assignmentId: a.id }} reason={{ label: "Reason" }}>
                                <fieldset className="flex flex-wrap gap-3">
                                  <legend className="mb-1 text-[13px] font-medium text-fg">May move stock in (none ticked = whole site)</legend>
                                  {siteWh.map((w) => (
                                    <label key={w.id} className="flex items-center gap-1.5 text-[13px]">
                                      <input type="checkbox" name="warehouseIds" value={w.id} defaultChecked={a.warehouseIds?.includes(w.id)} className="size-4" /> {w.code} · {w.name}
                                    </label>
                                  ))}
                                </fieldset>
                              </CommandForm>
                            )}
                            <CommandForm userId={u.id} op="end_assignment" label="Take this job away" variant="danger" hidden={{ assignmentId: a.id }} reason={{ label: "Why" }} />
                          </div>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {d.hiddenAssignments > 0 && <p className="mt-2 text-[12px] text-muted">{d.hiddenAssignments} job(s) at other sites are not shown to you.</p>}
            {canAssign && u.status !== "deactivated" && (
              <details id="grant" className="mt-3 border-t border-line pt-3" open={d.assignments.length === 0}>
                <summary className="flex min-h-[44px] cursor-pointer items-center text-[15px] font-semibold text-primary-text">Give a job (role)</summary>
                <div className="mt-3">
                  <CommandForm userId={u.id} op="grant" label="Give this job" variant="cta">
                    <label htmlFor="grant-role" className="text-[13px] font-medium text-fg">Job (role)</label>
                    <Select id="grant-role" name="roleId" required defaultValue="">
                      <option value="" disabled>Choose a job…</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {plainRole(r.code, r.name)}
                          {r.blockedReason && r.blockedReason !== "Site only" ? " (needs the owner's OK)" : ""}
                        </option>
                      ))}
                    </Select>
                    <label htmlFor="grant-site" className="text-[13px] font-medium text-fg">Where</label>
                    <Select id="grant-site" name="siteId" required defaultValue={ctx.currentSiteId}>
                      {ctx.allowedSites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                      {ctx.isOrganizationWide && <option value="org">All sites (only owner, IT person, auditor)</option>}
                    </Select>
                    <MoreDetails title="Start, end and a note (you can skip this)">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor="grant-from" className="text-[13px] font-medium text-fg">Starts (empty = today)</label>
                          <Input id="grant-from" name="validFrom" type="date" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor="grant-to" className="text-[13px] font-medium text-fg">Ends (optional)</label>
                          <Input id="grant-to" name="validTo" type="date" />
                        </div>
                      </div>
                      <label htmlFor="grant-reason" className="text-[13px] font-medium text-fg">Note (optional)</label>
                      <Input id="grant-reason" name="reason" maxLength={300} />
                    </MoreDetails>
                  </CommandForm>
                  <p className="mt-2 text-[13px] text-muted">Jobs that need the owner&apos;s OK are given by the owner. A warehouse limit can be set after giving the job.</p>
                </div>
              </details>
            )}
          </Card>

          {d.endedAssignments.length > 0 && (
            <Card>
              <CardTitle>Jobs they had before</CardTitle>
              <ul className="divide-y divide-line text-[13px]">
                {d.endedAssignments.map((a) => (
                  <li key={a.id} className="py-2">
                    <span className="font-medium text-fg">{plainRoleName(a.roleName)}</span> · {a.orgWide ? "All sites" : a.siteCode} · {fmtDate(a.validFrom)} to {a.validTo ? fmtDate(a.validTo) : "—"}
                    {a.revokedReason && <span className="text-muted"> · “{a.revokedReason}”</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {canSessions && (
            <Card>
              <CardTitle>Where they are signed in</CardTitle>
              {sessions.length === 0 ? (
                <p className="text-[13px] text-muted">Not signed in anywhere.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {sessions.map((s) => (
                    <li key={s.id} className="py-2.5">
                      <p className="font-medium text-fg">
                        {s.deviceLabel ?? "Unknown device"} {s.deviceClass === "shared" && <Chip tone="info">Shared</Chip>} {s.privileged && <Chip tone="warn">Can approve</Chip>}
                      </p>
                      <p className="text-[12px] text-muted">
                        Last active {fmtDateTime(s.lastSeenAt)}
                        {s.ip ? ` · ${s.ip}` : ""} · expires {fmtDateTime(s.expiresAt)}
                      </p>
                      {ctx.can("identity.session.void") && (
                        <details className="mt-1">
                          <summary className="flex min-h-[44px] cursor-pointer items-center text-[14px] font-medium text-primary-text">Sign out this device</summary>
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

          <MoreDetails title={`Everything they may do: ${d.permissionCount} technical names (for the IT person)`}>
            <p className="text-[13px] text-muted">All the permissions of their current jobs together. Each one works only at the site of that job.</p>
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
          </MoreDetails>
        </div>
      </div>
    </>
  );
}

import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { emailSetupStatus } from "@/lib/email";
import { fmtDateTime } from "@/lib/qty";
import { listUsers } from "@/modules/identity";
import { Card, CardTitle, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, buttonClass } from "@/ui/core";
import { Banner } from "@/ui/status";
import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { plainRoleName } from "@/ui/role-names";
import { Forbidden } from "../../forbidden";
import { UserStatusChip } from "./user-status";

export const dynamic = "force-dynamic";

const STATUSES = ["invited", "active", "locked", "deactivated"];
const STATUS_TEXT: Record<string, string> = { invited: "Not signed in yet", active: "Active", locked: "Locked", deactivated: "Switched off (left)" };

/** Users (US-1-16): list with search and status filter, invite, export. */
export default async function UsersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("identity.user.view")) return <Forbidden what="user administration" />;
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status ?? "") ? sp.status : undefined;
  const q = (sp.q ?? "").trim().slice(0, 80) || undefined;
  const [users, all] = await Promise.all([listUsers(ctx, { status, q }), status || q ? listUsers(ctx) : null]);
  const everyone = all ?? users;
  const locked = everyone.filter((u) => u.status === "locked").length;
  const invited = everyone.filter((u) => u.status === "invited").length;
  const canInvite = ctx.can("identity.user.create") && ctx.can("identity.invitation.create") && ctx.can("identity.site_assignment.admin");
  const email = emailSetupStatus();

  return (
    <>
      <PageHeader
        title="People who use the app"
        subtitle={`${everyone.length} people${invited ? ` · ${invited} not signed in yet` : ""}${locked ? ` · ${locked} locked` : ""}`}
        actions={
          <>
            {canInvite && (
              <LinkButton href="/admin/users/invite" variant="cta">
                Add a person
              </LinkButton>
            )}
            {(ctx.can("identity.role.view") || ctx.can("identity.user.export")) && (
              <MoreMenu>
                <div className="flex flex-col gap-2">
                  {ctx.can("identity.role.view") && (
                    <LinkButton href="/admin/roles" variant="secondary" size="sm">
                      Roles (what each job may do)
                    </LinkButton>
                  )}
                  {ctx.can("identity.user.export") && (
                    <a href={`/admin/users/export?format=csv${status ? `&status=${status}` : ""}`} className={buttonClass("secondary", "sm")}>
                      Download the list (CSV)
                    </a>
                  )}
                </div>
              </MoreMenu>
            )}
          </>
        }
      />
      <PageIntro>This screen is for the owner and the IT person: everyone who can sign in, their job (role) and their site. Tap a person to change their role, reset their password or switch them off when they leave.</PageIntro>
      {canInvite && !email.ready && (
        <div className="mb-4">
          <Banner tone="warn" title="Email sending is not set up yet">
            Give the sign-up link to the person yourself. It is shown to you once, right after you add them. The IT person can set up email under{" "}
            <Link href="/admin/security" className="underline">Security</Link>.
          </Banner>
        </div>
      )}
      <Card>
        <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
          <div className="min-w-[200px] flex-1">
            <label htmlFor="q" className="sr-only">Search name or email</label>
            <Input id="q" name="q" placeholder="Search name or email" defaultValue={q ?? ""} />
          </div>
          <label htmlFor="status" className="sr-only">Status</label>
          <Select id="status" name="status" defaultValue={status ?? ""} className="w-auto">
            <option value="">Everyone</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_TEXT[s]}
              </option>
            ))}
          </Select>
          <button className={buttonClass("secondary")}>Search</button>
        </form>
        
        {users.length === 0 ? (
          <EmptyState title={status || q ? "Nobody matches" : "Nobody at your sites yet"}>{status || q ? <Link href="/admin/users" className="underline">Show everyone</Link> : "Press “Add a person” to invite the first one."}</EmptyState>
        ) : (
          <>
            <div className="hidden md:block">
              <Table head={["Name", "Email", "Job (role)", "Site", "Status", "Last sign-in"]}>
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-surface-2">
                    <Td>
                      <Link href={`/admin/users/${u.id}`} className="font-medium text-primary-text hover:underline">
                        {u.displayName}
                      </Link>
                    </Td>
                    <Td className="text-fg-2">{u.email}</Td>
                    <Td>{u.roles.map(plainRoleName).join(", ") || "—"}</Td>
                    <Td>{u.siteScope}</Td>
                    <Td>
                      <UserStatusChip status={u.status} />
                    </Td>
                    <Td className="text-fg-2">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"}</Td>
                  </tr>
                ))}
              </Table>
            </div>
            <ul className="flex flex-col gap-2 md:hidden">
              {users.map((u) => (
                <li key={u.id}>
                  <Link href={`/admin/users/${u.id}`} className="block rounded-[12px] border border-line p-3 hover:border-line-strong">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-fg">{u.displayName}</span>
                      <UserStatusChip status={u.status} />
                    </div>
                    <p className="break-all text-[12px] text-muted">{u.email}</p>
                    <p className="mt-1 text-[13px] text-fg-2">
                      {u.roles.map(plainRoleName).join(", ") || "No job yet"} · {u.siteScope}
                    </p>
                    <p className="text-[12px] text-muted">Last sign-in: {u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "never"}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </>
  );
}

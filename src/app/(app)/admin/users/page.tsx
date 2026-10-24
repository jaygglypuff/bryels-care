import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { emailSetupStatus } from "@/lib/email";
import { fmtDateTime } from "@/lib/qty";
import { listUsers } from "@/modules/identity";
import { Card, CardTitle, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, buttonClass } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { UserStatusChip } from "./user-status";

export const dynamic = "force-dynamic";

const STATUSES = ["invited", "active", "locked", "deactivated"];

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
        title="Users"
        subtitle={`${everyone.length} people${invited ? ` · ${invited} invited` : ""}${locked ? ` · ${locked} locked` : ""}`}
        actions={
          <>
            {ctx.can("identity.role.view") && (
              <LinkButton href="/admin/roles" variant="secondary">
                Roles
              </LinkButton>
            )}
            {ctx.can("identity.user.export") && (
              <a href={`/admin/users/export?format=csv${status ? `&status=${status}` : ""}`} className={buttonClass("secondary")}>
                Export CSV
              </a>
            )}
            {canInvite && (
              <LinkButton href="/admin/users/invite" variant="cta">
                Invite someone
              </LinkButton>
            )}
          </>
        }
      />
      {canInvite && !email.ready && (
        <div className="mb-4">
          <Banner tone="warn" title="Email is not set up">
            {email.problem} Invitation links are then shown to you once, to pass on in person. <Link href="/admin/security" className="underline">Security settings</Link>
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
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
          <button className={buttonClass("secondary")}>Filter</button>
        </form>
        <CardTitle>People</CardTitle>
        {users.length === 0 ? (
          <EmptyState title={status || q ? "No users match the filter" : "No users in your sites"}>{status || q ? <Link href="/admin/users" className="underline">Clear the filter</Link> : null}</EmptyState>
        ) : (
          <>
            <div className="hidden md:block">
              <Table head={["Name", "Email", "Role(s)", "Site scope", "Status", "Last sign-in"]}>
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-surface-2">
                    <Td>
                      <Link href={`/admin/users/${u.id}`} className="font-medium text-primary-text hover:underline">
                        {u.displayName}
                      </Link>
                    </Td>
                    <Td className="text-fg-2">{u.email}</Td>
                    <Td>{u.roles.join(", ") || "—"}</Td>
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
                      {u.roles.join(", ") || "No role"} · {u.siteScope}
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

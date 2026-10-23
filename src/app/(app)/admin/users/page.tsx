import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listRoles, listUsers } from "@/modules/identity";
import { Card, CardTitle, EmptyState, PageHeader, Table, Td } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { UserStatusChip } from "./user-status";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const ctx = await requireContext();
  if (!ctx.can("identity.user.view")) return <Forbidden what="user administration" />;
  const [users, roles] = await Promise.all([listUsers(ctx), ctx.can("identity.role.view") ? listRoles(ctx) : Promise.resolve(null)]);
  const locked = users.filter((u) => u.status === "locked").length;

  return (
    <>
      <PageHeader
        title="Users & roles"
        subtitle={`${users.length} users${locked ? ` · ${locked} locked` : ""} · read-only in this release; accounts are managed by the system administrator`}
      />
      <Card>
        <CardTitle>Users</CardTitle>
        {users.length === 0 ? (
          <EmptyState title="No users in your sites" />
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
                      {u.roles.join(", ")} · {u.siteScope}
                    </p>
                    <p className="text-[12px] text-muted">Last sign-in: {u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "never"}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {roles && (
        <Card className="mt-4">
          <CardTitle>Roles</CardTitle>
          <p className="mb-3 text-[13px] text-muted">
            Seeded roles are read-only templates. Permissions are the union of a user&apos;s roles; site scope comes from each assignment.
          </p>
          <Table head={["Role", "Code", "Permissions", "Users", "Scope", "Type"]}>
            {roles.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">{r.name}</Td>
                <Td className="font-mono text-[12px] text-fg-2">{r.code}</Td>
                <Td className="tabular">{r.permissionCount}</Td>
                <Td className="tabular">{r.userCount}</Td>
                <Td>{r.allowsOrganizationWide ? "Organization-wide or per site" : "Per site"}</Td>
                <Td>{r.isSystem ? <Chip tone="neu">Template · read-only</Chip> : <Chip tone="info">Custom</Chip>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}

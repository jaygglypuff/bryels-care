import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { listRoles, roleMatrix } from "@/modules/identity";
import { Card, CardTitle, EmptyState, Input, PageHeader, Table, Td, buttonClass } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";

export const dynamic = "force-dynamic";
export const metadata = { title: "Roles" };

const SENS = { N: "neu", S: "warn", R: "bad" } as const;

/** Roles and the permission catalogue (US-1-17); custom roles by cloning (US-1-29). */
export default async function RolesPage({ searchParams }: { searchParams: Promise<{ q?: string; deleted?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("identity.role.view")) return <Forbidden what="roles" />;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 80);
  const [roles, matrix] = await Promise.all([listRoles(ctx), roleMatrix(ctx)]);
  const rows = matrix.catalogue.filter((c) => !q || c.code.includes(q));
  const active = matrix.roles.filter((r) => r.status === "active");
  return (
    <>
      <p className="mb-2 text-[13px]">
        <Link href="/admin/users" className="text-primary-text hover:underline">
          ← Users
        </Link>
      </p>
      <PageHeader title="Roles" subtitle={`${roles.filter((r) => r.isSystem).length} seeded templates · ${roles.filter((r) => !r.isSystem).length} custom`} />
      {sp.deleted === "1" && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="Role deleted" />
        </div>
      )}
      <Card>
        <CardTitle>Roles</CardTitle>
        <p className="mb-3 text-[13px] text-muted">
          Seeded roles are read-only templates. To change a bundle, open a role and clone it into a custom role. Permissions are the union of a person&apos;s roles; the site comes from each assignment.
        </p>
        <div className="hidden md:block">
          <Table head={["Role", "Code", "Permissions", "People", "Scope", "Type"]}>
            {roles.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2">
                <Td>
                  <Link href={`/admin/roles/${r.id}`} className="font-medium text-primary-text hover:underline">
                    {r.name}
                  </Link>
                </Td>
                <Td className="font-mono text-[12px] text-fg-2">{r.code}</Td>
                <Td className="tabular">{r.permissionCount}</Td>
                <Td className="tabular">{r.userCount}</Td>
                <Td>{r.allowsOrganizationWide ? "Organization-wide or per site" : "Per site"}</Td>
                <Td>
                  {r.isSystem ? <Chip tone="neu">Template · read-only</Chip> : <Chip tone="info">Custom{r.clonedFromName ? ` · from ${r.clonedFromName}` : ""}</Chip>} {r.status === "inactive" && <Chip tone="warn">Inactive</Chip>}
                </Td>
              </tr>
            ))}
          </Table>
        </div>
        <ul className="flex flex-col gap-2 md:hidden">
          {roles.map((r) => (
            <li key={r.id}>
              <Link href={`/admin/roles/${r.id}`} className="block rounded-[12px] border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-fg">{r.name}</span>
                  {r.isSystem ? <Chip tone="neu">Template</Chip> : <Chip tone="info">Custom</Chip>}
                </div>
                <p className="text-[12px] text-muted">
                  {r.permissionCount} permissions · {r.userCount} people{r.status === "inactive" ? " · inactive" : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-4">
        <CardTitle action={<span className="text-[12px] text-muted">{matrix.catalogue.length} permission strings</span>}>Permission matrix</CardTitle>
        <form className="mb-3 flex gap-2" role="search">
          <label htmlFor="q" className="sr-only">Filter permissions</label>
          <Input id="q" name="q" defaultValue={q} placeholder="Filter, e.g. inventory.adjustment" />
          <button className={buttonClass("secondary")}>Filter</button>
        </form>
        <p className="mb-3 text-[12px] text-muted">
          Sensitivity: <Chip tone="neu">N normal</Chip> <Chip tone="warn">S sensitive</Chip> <Chip tone="bad">R restricted (re-authentication, two-step sign-in)</Chip>
        </p>
        {rows.length === 0 ? (
          <EmptyState title="No permission matches the filter" />
        ) : (
          <div className="max-h-[640px] overflow-auto rounded-[14px] border border-line">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-surface">
                <tr>
                  <th className="sticky left-0 bg-surface p-2 text-left font-semibold">Permission</th>
                  {active.map((r) => (
                    <th key={r.id} className="p-2 text-center font-semibold" title={r.name}>
                      <span className="inline-block max-w-[90px] truncate align-bottom">{r.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.code} className="border-t border-line">
                    <td className="sticky left-0 bg-surface p-2">
                      <span className="font-mono">{c.code}</span> {c.sensitivity !== "N" && <Chip tone={SENS[c.sensitivity]}>{c.sensitivity}</Chip>}
                    </td>
                    {active.map((r) => (
                      <td key={r.id} className="p-2 text-center">
                        {matrix.grants[r.id]?.includes(c.code) ? <span aria-label="granted">●</span> : <span className="text-muted" aria-label="not granted">·</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { listRoles, roleMatrix } from "@/modules/identity";
import { EmptyState, Input, PageHeader, buttonClass } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { SENSITIVITY_TEXT } from "@/ui/permission-words";
import { plainRole, plainRoleName } from "@/ui/role-names";
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
        <Link href="/admin/users" className="inline-flex min-h-[44px] items-center text-primary-text hover:underline">
          ← People
        </Link>
      </p>
      <PageHeader title="Roles (what each job may do)" subtitle={`${roles.filter((r) => r.isSystem).length} standard · ${roles.filter((r) => !r.isSystem).length} made here`} />
      <PageIntro>This screen is for the owner and the IT person: each job (role) and what it may do. The standard jobs cannot be changed; to make a different one, open a job and press “Copy into a new job”.</PageIntro>
      {sp.deleted === "1" && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="Job deleted" />
        </div>
      )}
      <PlainList label="Jobs">
        {roles.map((r) => (
          <PlainRow
            key={r.id}
            href={`/admin/roles/${r.id}`}
            title={plainRole(r.code, r.name)}
            status={
              <>
                {r.isSystem ? <Chip tone="neu">Standard</Chip> : <Chip tone="info">Made here{r.clonedFromName ? ` · from ${plainRoleName(r.clonedFromName)}` : ""}</Chip>}
                {r.status === "inactive" && <Chip tone="warn">Not used any more</Chip>}
              </>
            }
            facts={`${r.userCount} ${r.userCount === 1 ? "person" : "people"} · ${r.allowsOrganizationWide ? "one site or all sites" : "one site"}`}
          />
        ))}
      </PlainList>

      <div className="mt-4">
        <MoreDetails title={`Technical table: ${matrix.catalogue.length} permission names by job (for the IT person)`} open={!!q}>
          <form className="flex gap-2" role="search">
            <label htmlFor="q" className="sr-only">Filter permissions</label>
            <Input id="q" name="q" defaultValue={q} placeholder="Filter, e.g. inventory.adjustment" />
            <button className={buttonClass("secondary")}>Filter</button>
          </form>
          <p className="text-[12px] text-muted">
            <Chip tone="warn">Careful</Chip> <Chip tone="bad">Needs the owner&apos;s OK (password again, two-step sign-in)</Chip>
          </p>
          {rows.length === 0 ? (
            <EmptyState title="No permission matches the filter" />
          ) : (
            <div className="max-h-[640px] overflow-auto rounded-[14px] border border-line">
              <table className="w-full border-collapse text-[12px]">
                <thead className="sticky top-0 bg-surface">
                  <tr>
                    <th className="sticky left-0 bg-surface p-2 text-left font-semibold">Technical name</th>
                    {active.map((r) => (
                      <th key={r.id} className="p-2 text-center font-semibold" title={r.name}>
                        <span className="inline-block max-w-[90px] truncate align-bottom">{plainRole(r.code, r.name)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.code} className="border-t border-line">
                      <td className="sticky left-0 bg-surface p-2">
                        <span className="font-mono">{c.code}</span> {c.sensitivity !== "N" && <Chip tone={SENS[c.sensitivity]}>{SENSITIVITY_TEXT[c.sensitivity]}</Chip>}
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
        </MoreDetails>
      </div>
    </>
  );
}

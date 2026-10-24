import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import type { Permission } from "@/lib/permissions";
import { type RoleDetail, getRole, permissionCatalogue } from "@/modules/identity";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { StepUpGate } from "../../users/step-up-gate";
import { EditRoleForm, RetireRoleForms } from "../forms";

export const dynamic = "force-dynamic";

const SENS = { N: "neu", S: "warn", R: "bad" } as const;

export default async function RoleDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("identity.role.view")) return <Forbidden what="roles" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d: RoleDetail;
  try {
    d = await getRole(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const { role } = d;
  const canAdmin = ctx.can("identity.role.admin");
  const editable = canAdmin && !role.isSystem && role.status === "active";
  const catalogue = permissionCatalogue().map((c) => ({ code: c.code, module: c.module, sensitivity: c.sensitivity, held: ctx.can(c.code as Permission) }));
  const grouped = new Map<string, RoleDetail["permissions"]>();
  for (const p of d.permissions) grouped.set(p.code.split(".")[0], [...(grouped.get(p.code.split(".")[0]) ?? []), p]);
  return (
    <>
      <p className="mb-2 text-[13px]">
        <Link href="/admin/roles" className="text-primary-text hover:underline">
          ← Roles
        </Link>
      </p>
      <PageHeader
        title={role.name}
        subtitle={<span className="font-mono">{role.code}</span>}
        actions={
          <>
            {role.isSystem ? <Chip tone="neu">Template · read-only</Chip> : <Chip tone="info">Custom</Chip>}
            {role.status === "inactive" && <Chip tone="warn">Inactive</Chip>}
            {canAdmin && (
              <LinkButton href={`/admin/roles/${role.id}/clone`} variant="secondary" size="sm">
                Clone into a custom role
              </LinkButton>
            )}
          </>
        }
      />
      {(await searchParams).created === "1" && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="Custom role created">Grant it from a user&apos;s page. Every change to it is audited with the permissions added and removed.</Banner>
        </div>
      )}
      {d.sodWarnings.length > 0 && (
        <div className="mb-4">
          <Banner tone="warn" title="Separation of duties">
            This role can both submit and approve: {d.sodWarnings.join(", ")}. The system still refuses anyone approving their own submission.
          </Banner>
        </div>
      )}
      {editable && <StepUpGate ctx={ctx} purpose="change a role" />}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>About</CardTitle>
            <Dl
              items={[
                ["Permissions", String(d.permissions.length)],
                ["People now", String(d.activeAssignments)],
                ["Scope", role.allowsOrganizationWide ? "Organization-wide or per site" : "Per site"],
                ["Cloned from", role.clonedFromName ?? "—"],
                ["Updated", fmtDateTime(role.updatedAt)],
              ]}
            />
            {role.description && <p className="mt-3 text-[13px] text-fg-2">{role.description}</p>}
            {role.isSystem && <p className="mt-3 text-[12px] text-muted">Seeded templates change only with a software release, so every site keeps the same bundle. Clone it to make a variant.</p>}
          </Card>
          {editable && (
            <Card>
              <CardTitle>Retire this role</CardTitle>
              <RetireRoleForms roleId={role.id} canDelete={d.everAssigned === 0} />
            </Card>
          )}
        </div>
        <Card className="min-w-0">
          {editable ? (
            <>
              <CardTitle>Edit permissions</CardTitle>
              <p className="mb-3 text-[13px] text-muted">You can remove anything, and add only permissions you hold yourself.</p>
              <EditRoleForm roleId={role.id} name={role.name} description={role.description} catalogue={catalogue} selected={d.permissions.map((p) => p.code)} />
            </>
          ) : (
            <>
              <CardTitle>Permissions</CardTitle>
              <div className="flex flex-col gap-3">
                {[...grouped.entries()].map(([mod, ps]) => (
                  <section key={mod}>
                    <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[.04em] text-fg-2">
                      {mod} <span className="font-medium text-muted">· {ps.length}</span>
                    </h3>
                    <ul className="flex flex-wrap gap-1.5">
                      {ps.map((p) => (
                        <li key={p.code}>
                          <Chip tone={SENS[p.sensitivity]}>
                            <span className="break-all font-mono text-[11px]">{p.code}</span>
                          </Chip>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}

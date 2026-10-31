import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import type { Permission } from "@/lib/permissions";
import { type RoleDetail, getRole, permissionCatalogue } from "@/modules/identity";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { permissionSummary, plainModule } from "@/ui/permission-words";
import { plainRole, plainRoleName } from "@/ui/role-names";
import { Forbidden } from "../../../forbidden";
import { StepUpGate } from "../../users/step-up-gate";
import { EditRoleForm, RetireRoleForms } from "../forms";

export const dynamic = "force-dynamic";

const SENS = { N: "neu", S: "warn", R: "bad" } as const;

/** "Stock: see, add, change" — one line per area, in plain words. */
function PlainSummary({ codes }: { codes: string[] }) {
  const rows = permissionSummary(codes);
  if (rows.length === 0) return <p className="text-[14px] text-fg-2">Nothing yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.module} className="py-2 text-[14px]">
          <span className="font-semibold text-fg">{r.label}:</span> <span className="text-fg-2">{r.actions.join(", ")}</span>
        </li>
      ))}
    </ul>
  );
}

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
        title={plainRole(role.code, role.name)}
        actions={
          <>
            {role.isSystem ? <Chip tone="neu">Standard</Chip> : <Chip tone="info">Made here</Chip>}
            {role.status === "inactive" && <Chip tone="warn">Not used any more</Chip>}
            {canAdmin && (
              <LinkButton href={`/admin/roles/${role.id}/clone`} variant="secondary" size="sm">
                Copy into a new job
              </LinkButton>
            )}
          </>
        }
      />
      <PageIntro>This screen is for the owner and the IT person: what people with this job may do. Give the job to a person on their page under People.</PageIntro>
      {(await searchParams).created === "1" && (
        <div className="mb-4" role="status">
          <Banner tone="ok" title="New job made">Give it to a person on their page under People. Every change to it is kept in the history of changes.</Banner>
        </div>
      )}
      {d.sodWarnings.length > 0 && (
        <div className="mb-4">
          <Banner tone="warn" title="This job can both ask and approve">
            Areas: {d.sodWarnings.map((w) => plainModule(w.split(".")[0])).join(", ")}. The system still stops anyone approving their own request.
          </Banner>
        </div>
      )}
      {editable && <StepUpGate ctx={ctx} purpose="change a role" />}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>About this job</CardTitle>
            <Dl
              items={[
                ["People with this job now", String(d.activeAssignments)],
                ["Where", role.allowsOrganizationWide ? "One site or all sites" : "One site"],
                ["Copied from", role.clonedFromName ? plainRoleName(role.clonedFromName) : "—"],
                ["Last changed", fmtDateTime(role.updatedAt)],
              ]}
            />
            {role.description && <p className="mt-3 text-[13px] text-fg-2">{role.description}</p>}
            {role.isSystem && <p className="mt-3 text-[13px] text-muted">Standard jobs change only with a new version of the app, so every site has the same. Copy it to make your own.</p>}
          </Card>
          {editable && (
            <MoreDetails title="⋯ More: stop using or delete this job">
              <RetireRoleForms roleId={role.id} canDelete={d.everAssigned === 0} />
            </MoreDetails>
          )}
        </div>
        <Card className="min-w-0">
          {editable ? (
            <>
              <CardTitle>What this job may do</CardTitle>
              <PlainSummary codes={d.permissions.map((p) => p.code)} />
              <p className="mb-3 mt-4 text-[13px] text-muted">To change it: tick or untick below. You can take anything away, and add only what you may do yourself.</p>
              <EditRoleForm roleId={role.id} name={role.name} description={role.description} catalogue={catalogue} selected={d.permissions.map((p) => p.code)} />
            </>
          ) : (
            <>
              <CardTitle>What this job may do</CardTitle>
              <PlainSummary codes={d.permissions.map((p) => p.code)} />
              <div className="mt-4">
              <MoreDetails title={`Technical names (${d.permissions.length}, for the IT person)`}>
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
              </MoreDetails>
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}

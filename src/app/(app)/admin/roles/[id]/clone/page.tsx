import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { type RoleDetail, getRole, permissionCatalogue } from "@/modules/identity";
import { Card, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { PageIntro } from "@/ui/guide";
import { permissionSummary } from "@/ui/permission-words";
import { plainRole } from "@/ui/role-names";
import { Forbidden } from "../../../../forbidden";
import { StepUpGate } from "../../../users/step-up-gate";
import { CloneForm } from "../../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Copy a job" };

/** US-1-29: clone a role; strings the creator does not hold are left out and listed. */
export default async function CloneRolePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("identity.role.admin")) return <Forbidden what="role administration" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d: RoleDetail;
  try {
    d = await getRole(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const catalogue = permissionCatalogue().map((c) => ({ code: c.code, module: c.module, sensitivity: c.sensitivity, held: ctx.can(c.code as Permission) }));
  const held = d.permissions.filter((p) => ctx.can(p.code as Permission)).map((p) => p.code);
  const dropped = d.permissions.filter((p) => !ctx.can(p.code as Permission)).map((p) => p.code);
  return (
    <>
      <p className="mb-2 text-[13px]">
        <Link href={`/admin/roles/${id}`} className="text-primary-text hover:underline">
          ← {d.role.name}
        </Link>
      </p>
      <PageHeader title={`New job, copied from ${plainRole(d.role.code, d.role.name)}`} />
      <PageIntro>This screen is for making your own job (role): give it a name, untick what this job should not do, and press the button at the bottom.</PageIntro>
      <StepUpGate ctx={ctx} purpose="create a role" />
      {dropped.length > 0 && (
        <div className="mb-4">
          <Banner tone="warn" title={`${dropped.length} thing(s) left out`}>
            A new job cannot do more than you may do yourself. Left out: {permissionSummary(dropped).map((r) => `${r.label} (${r.actions.join(", ")})`).join("; ")}. Ask the owner to make the job if it needs them.
          </Banner>
        </div>
      )}
      <Card className="max-w-[900px]">
        <CloneForm sourceRoleId={id} sourceName={d.role.name} catalogue={catalogue} selected={held} />
      </Card>
    </>
  );
}

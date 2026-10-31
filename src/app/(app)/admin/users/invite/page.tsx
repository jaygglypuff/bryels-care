import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { grantableRoles, warehousesForSites } from "@/modules/identity";
import { Card, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { StepUpGate } from "../step-up-gate";
import { InviteForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a person" };

export default async function InvitePage() {
  const ctx = await requireContext();
  if (!(ctx.can("identity.user.create") && ctx.can("identity.invitation.create") && ctx.can("identity.site_assignment.admin"))) return <Forbidden what="inviting people" />;
  const [roles, warehouses] = await Promise.all([grantableRoles(ctx, ctx.currentSiteId), warehousesForSites(ctx)]);
  return (
    <>
      <p className="mb-2 text-[13px]">
        <Link href="/admin/users" className="text-primary-text hover:underline">
          ← People
        </Link>
      </p>
      <PageHeader title="Add a person" />
      <PageIntro>This screen is for adding someone who will use the app: type their email and name, pick their job and site, and press “Send invitation”. They get a link to choose their own password; you never see it.</PageIntro>
      <StepUpGate ctx={ctx} purpose="invite people" />
      <Card className="max-w-[640px]">
        <InviteForm roles={roles} sites={ctx.allowedSites} warehouses={warehouses} orgWide={ctx.isOrganizationWide} defaultSiteId={ctx.currentSiteId} />
      </Card>
    </>
  );
}

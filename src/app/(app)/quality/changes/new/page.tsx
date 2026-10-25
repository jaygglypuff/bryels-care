import { requireContext } from "@/lib/auth/context";
import { changeControlFormContext } from "@/modules/quality";
import { Card, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { CreateChangeForm } from "../forms";

export const dynamic = "force-dynamic";

/** Propose a change (US-6-18); may come from a CAPA (?capaId=) or a revision page (?entityType=&entityId=). */
export default async function NewChangePage({ searchParams }: { searchParams: Promise<{ capaId?: string; entityType?: string; entityId?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.change_control.create")) return <Forbidden what="proposing changes" />;
  const sp = await searchParams;
  const v = await changeControlFormContext(ctx, sp);
  return (
    <>
      <PageHeader title="Propose a change" subtitle="Draft first; add the impact assessment and risk level, then submit for approval" actions={<LinkButton href="/quality/changes" variant="secondary">Change control</LinkButton>} />
      <Card>
        <CreateChangeForm entityTypes={v.entityTypes} options={v.options} sites={v.sites} capa={v.capa} defaultType={v.entityType} defaultEntityId={v.entityId} />
      </Card>
    </>
  );
}

import { requireContext } from "@/lib/auth/context";
import { capaFormContext } from "@/modules/quality";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { OpenCapaForm } from "../forms";

export const dynamic = "force-dynamic";

/** Open a CAPA (W07-04), pre-filled from the deviation or complaint it comes from. */
export default async function NewCapaPage({ searchParams }: { searchParams: Promise<{ deviationId?: string; complaintId?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.capa.create")) return <Forbidden what="starting fix-and-prevent plans" />;
  const sp = await searchParams;
  const v = await capaFormContext(ctx, { deviationId: sp.deviationId, complaintId: sp.complaintId });
  return (
    <>
      <PageHeader title="Start a fix-and-prevent plan" subtitle={v.deviation ? `From problem report ${v.deviation.number}` : v.complaint ? `From complaint ${v.complaint.number}` : undefined} actions={<LinkButton href="/quality/capa" variant="secondary">All plans</LinkButton>} />
      <PageIntro>This screen is for QA and managers: name the problem and who looks after the plan. You add the things to do on the next screen.</PageIntro>
      <Card>
        {v.owners.length === 0 ? (
          <EmptyState title="Nobody here can look after a plan">Give someone the QA or site manager role at this site first (ask the administrator: Management → People & access).</EmptyState>
        ) : (
          <OpenCapaForm sources={v.sources} owners={v.owners} sites={v.sites} deviation={v.deviation} complaint={v.complaint} defaultSiteId={v.siteId} me={ctx.userId} />
        )}
      </Card>
    </>
  );
}

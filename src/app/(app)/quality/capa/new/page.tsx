import { requireContext } from "@/lib/auth/context";
import { capaFormContext } from "@/modules/quality";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { OpenCapaForm } from "../forms";

export const dynamic = "force-dynamic";

/** Open a CAPA (W07-04), pre-filled from the deviation or complaint it comes from. */
export default async function NewCapaPage({ searchParams }: { searchParams: Promise<{ deviationId?: string; complaintId?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("quality.capa.create")) return <Forbidden what="opening CAPAs" />;
  const sp = await searchParams;
  const v = await capaFormContext(ctx, { deviationId: sp.deviationId, complaintId: sp.complaintId });
  return (
    <>
      <PageHeader title="Open CAPA" subtitle={v.deviation ? `From deviation ${v.deviation.number}` : v.complaint ? `From complaint ${v.complaint.number}` : "For an audit finding or another source"} actions={<LinkButton href="/quality/capa" variant="secondary">CAPA</LinkButton>} />
      <Card>
        {v.owners.length === 0 ? (
          <EmptyState title="Nobody can own a CAPA at this site">Assign a QA or site manager role at the site first (identity administration).</EmptyState>
        ) : (
          <OpenCapaForm sources={v.sources} owners={v.owners} sites={v.sites} deviation={v.deviation} complaint={v.complaint} defaultSiteId={v.siteId} />
        )}
      </Card>
    </>
  );
}

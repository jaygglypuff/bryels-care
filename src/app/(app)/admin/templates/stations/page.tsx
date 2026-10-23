import { requireContext } from "@/lib/auth/context";
import { listStations } from "@/modules/documents";
import { Card, CardTitle, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { StationForm } from "../forms";

export const metadata = { title: "Print stations" };
export const dynamic = "force-dynamic";

export default async function StationsPage() {
  const ctx = await requireContext();
  if (!ctx.can("documents.print_station.admin")) return <Forbidden what="print station settings" />;
  const stations = (await listStations(ctx, { includeInactive: true })).filter((s) => ctx.allowedSiteIds.includes(s.siteId));
  const here = stations.filter((s) => s.siteId === ctx.currentSiteId);
  const others = stations.filter((s) => s.siteId !== ctx.currentSiteId);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Print stations" subtitle={`${ctx.currentSite.code} · the PC or tablet next to each label printer (A-RPT-09)`} actions={<LinkButton href="/admin/templates" variant="secondary">Back</LinkButton>} />
      <Card>
        <CardTitle>Add a station at {ctx.currentSite.code}</CardTitle>
        <StationForm />
      </Card>
      {here.length === 0 ? (
        <p className="text-[13px] text-muted">No stations at {ctx.currentSite.code} yet: label printing shows &quot;isn&apos;t set up&quot; until one exists.</p>
      ) : (
        here.map((s) => (
          <Card key={s.id}>
            <CardTitle>{s.code}</CardTitle>
            <StationForm values={{ id: s.id, code: s.code, name: s.name, printerName: s.printerName, notes: s.notes, isActive: s.isActive }} />
          </Card>
        ))
      )}
      {others.length > 0 && (
        <Card>
          <CardTitle>Other sites</CardTitle>
          <ul className="divide-y divide-line text-[13px]">
            {others.map((s) => (
              <li key={s.id} className="py-2">{s.siteCode} · {s.code} · {s.name} ({s.printerName}){s.isActive ? "" : " · inactive"}</li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-muted">Switch site to change these.</p>
        </Card>
      )}
    </div>
  );
}

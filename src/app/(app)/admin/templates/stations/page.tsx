import { requireContext } from "@/lib/auth/context";
import { listStations } from "@/modules/documents";
import { Card, CardTitle, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { StationForm } from "../forms";

export const metadata = { title: "Label printers" };
export const dynamic = "force-dynamic";

export default async function StationsPage() {
  const ctx = await requireContext();
  if (!ctx.can("documents.print_station.admin")) return <Forbidden what="print station settings" />;
  const stations = (await listStations(ctx, { includeInactive: true })).filter((s) => ctx.allowedSiteIds.includes(s.siteId));
  const here = stations.filter((s) => s.siteId === ctx.currentSiteId);
  const others = stations.filter((s) => s.siteId !== ctx.currentSiteId);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Label printers" subtitle={ctx.currentSite.name} actions={<LinkButton href="/admin/templates" variant="secondary">Back</LinkButton>} />
      <PageIntro>This screen is for the IT person: each computer or tablet that has a label printer next to it. Labels can only be printed at a place listed here.</PageIntro>
      <Card>
        <CardTitle>Add a printer place at {ctx.currentSite.name}</CardTitle>
        <StationForm />
      </Card>
      {here.length === 0 ? (
        <p className="text-[13px] text-muted">No printer place at {ctx.currentSite.name} yet. Until you add one, label printing says it &quot;isn&apos;t set up&quot;.</p>
      ) : (
        here.map((s) => (
          <Card key={s.id}>
            <CardTitle>{s.name}</CardTitle>
            <StationForm values={{ id: s.id, code: s.code, name: s.name, printerName: s.printerName, notes: s.notes, isActive: s.isActive }} />
          </Card>
        ))
      )}
      {others.length > 0 && (
        <Card>
          <CardTitle>Other sites</CardTitle>
          <ul className="divide-y divide-line text-[13px]">
            {others.map((s) => (
              <li key={s.id} className="py-2">{s.siteCode} · {s.name} ({s.printerName}){s.isActive ? "" : " · not used"}</li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-muted">Switch site at the top to change these.</p>
        </Card>
      )}
    </div>
  );
}

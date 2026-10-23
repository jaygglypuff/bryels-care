import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { listLocations } from "@/modules/inventory/masterdata";
import { Card, CardTitle, EmptyState, PageHeader } from "@/ui/core";
import { Chip } from "@/ui/status";
import { LocationKindChip } from "@/ui/inventory/bits";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Locations" };

export default async function LocationsPage() {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.location.view")) return <Forbidden what="locations" />;
  const rows = await listLocations(ctx);
  const groups = new Map<string, { name: string; items: typeof rows }>();
  for (const r of rows) {
    const g = groups.get(r.warehouseCode) ?? { name: r.warehouseName, items: [] };
    g.items.push(r);
    groups.set(r.warehouseCode, g);
  }
  const canSeeLots = ctx.can("inventory.lot.view");
  return (
    <div className="space-y-5">
      <PageHeader title="Locations" subtitle={`${ctx.currentSite.code} · ${ctx.currentSite.name} · warehouses and their storage, quarantine, production and dispatch locations`} />
      {rows.length === 0 ? (
        <EmptyState title="No locations at this site">Locations are set up by the system administrator.</EmptyState>
      ) : (
        [...groups.entries()].map(([code, g]) => (
          <Card key={code}>
            <CardTitle>{code} · {g.name}</CardTitle>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((l) => {
                const body = (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono font-semibold">{l.code}</span>
                      <LocationKindChip kind={l.kind} />
                    </div>
                    <p className="mt-1 text-[13px]">{l.name}</p>
                    <p className="mt-1 text-[12px] text-muted">
                      {l.lotCount} {l.lotCount === 1 ? "lot" : "lots"} in stock {!l.isActive && <Chip tone="neu">Inactive</Chip>}
                    </p>
                  </>
                );
                return (
                  <li key={l.id}>
                    {canSeeLots ? (
                      <Link href={`/inventory?loc=${l.id}`} className="block rounded-[12px] border border-line p-3 hover:bg-surface-2">{body}</Link>
                    ) : (
                      <div className="rounded-[12px] border border-line p-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}

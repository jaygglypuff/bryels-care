import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { listLocationsWithStock } from "@/modules/inventory/lots-admin";
import { Card, EmptyState, PageHeader, Table, Td } from "@/ui/core";
import { Chip } from "@/ui/status";
import { LocationKindChip } from "@/ui/inventory/bits";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Locations & stock" };

export default async function LocationsStockPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.location.view")) return <Forbidden what="locations" />;
  const sp = await searchParams;
  const all = await listLocationsWithStock(ctx);
  const rows = sp.kind ? all.filter((r) => r.kind === sp.kind) : all;
  const kinds = [...new Set(all.map((r) => r.kind))].sort();
  return (
    <div className="space-y-5">
      <PageHeader title="Locations & stock" subtitle={`${ctx.currentSite.code} · what each location holds, its boxes, blocked stock and any count freezing it`} />
      <nav className="flex flex-wrap gap-2" aria-label="Filter by kind">
        <Link href="/inventory/locations" className={`rounded-full border px-3 py-1.5 text-[13px] ${!sp.kind ? "border-primary bg-primary-soft text-primary-text" : "border-line"}`}>All</Link>
        {kinds.map((k) => (
          <Link key={k} href={`/inventory/locations?kind=${k}`} className={`rounded-full border px-3 py-1.5 text-[13px] ${sp.kind === k ? "border-primary bg-primary-soft text-primary-text" : "border-line"}`}>{k}</Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={sp.kind ? "No locations of this kind" : "No locations at this site"}>{sp.kind ? "Choose another kind." : "Locations are set up by the system administrator."}</EmptyState>
        ) : (
          <>
            <ul className="space-y-2 sm:hidden">
              {rows.map((l) => (
                <li key={l.id}>
                  <Link href={`/inventory/locations/${l.id}`} className="block rounded-[12px] border border-line p-3">
                    <div className="flex items-start justify-between gap-2"><span className="font-mono font-semibold">{l.code}</span><LocationKindChip kind={l.kind} /></div>
                    <p className="mt-1 text-[13px]">{l.name}</p>
                    <p className="mt-1 text-[12px] text-muted">{l.lots} lot(s) · {l.boxes} box(es){l.frozenBy ? ` · frozen by ${l.frozenBy}` : ""}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <Table className="hidden sm:block" head={["Location", "Kind", "Lots", "Not released", "Boxes", "Count"]}>
              {rows.map((l) => (
                <tr key={l.id} className="hover:bg-surface-2">
                  <Td><Link href={`/inventory/locations/${l.id}`} className="font-mono font-semibold text-primary-text hover:underline">{l.code}</Link><div className="text-[12px] text-muted">{l.name} · {l.warehouseCode}{!l.isActive ? " · inactive" : ""}</div></Td>
                  <Td><LocationKindChip kind={l.kind} /></Td>
                  <Td>{l.lots}</Td>
                  <Td>{l.blocked ? <Chip tone="warn">{l.blocked}</Chip> : "0"}</Td>
                  <Td>{l.boxes}</Td>
                  <Td>{l.frozenBy ? <Chip tone="warn">Frozen · {l.frozenBy}</Chip> : "—"}</Td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Card>
    </div>
  );
}

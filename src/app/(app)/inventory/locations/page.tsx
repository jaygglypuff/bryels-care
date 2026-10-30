import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { LOCATION_SECTIONS, SECTION_HINTS, SECTION_LABELS, isSection, type LocationSection } from "@/lib/location-sections";
import { listLocationsWithStock } from "@/modules/inventory/lots-admin";
import { Card, EmptyState, PageHeader, Table, Td } from "@/ui/core";
import { Chip } from "@/ui/status";
import { LocationKindChip } from "@/ui/inventory/bits";
import { SectionHeading } from "@/ui/inventory/sections";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Locations & stock" };

/** Places of the current site grouped by warehouse section (S6, ADR-077), with what each holds. */
export default async function LocationsStockPage({ searchParams }: { searchParams: Promise<{ kind?: string; section?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.location.view")) return <Forbidden what="locations" />;
  const sp = await searchParams;
  const all = (await listLocationsWithStock(ctx)).map((r) => ({ ...r, section: (isSection(r.section) ? r.section : "other") as LocationSection }));
  const section = isSection(sp.section) ? sp.section : undefined;
  const rows = all.filter((r) => (!sp.kind || r.kind === sp.kind) && (!section || r.section === section));
  const present = LOCATION_SECTIONS.filter((s) => all.some((r) => r.section === s));
  const chip = (active: boolean) => `inline-flex min-h-[40px] items-center rounded-full border px-3 py-1.5 text-[13px] ${active ? "border-primary bg-primary-soft text-primary-text" : "border-line"}`;
  return (
    <div className="space-y-5">
      <PageHeader title="Locations & stock" subtitle={`${ctx.currentSite.code} · every place by section: what it holds, its boxes and any count freezing it`} />
      <nav className="flex flex-wrap gap-2" aria-label="Filter by section">
        <Link href="/inventory/locations" className={chip(!section)}>All sections</Link>
        {present.map((s) => (
          <Link key={s} href={`/inventory/locations?section=${s}`} className={chip(section === s)}>{SECTION_LABELS[s]}</Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <Card>
          <EmptyState title={section || sp.kind ? "No places in this section" : "No locations at this site"}>{section || sp.kind ? "Choose another section." : "Locations are set up by the system administrator."}</EmptyState>
        </Card>
      ) : (
        present
          .filter((s) => rows.some((r) => r.section === s))
          .map((s) => {
            const list = rows.filter((r) => r.section === s);
            const lots = list.reduce((n, r) => n + r.lots, 0);
            return (
              <Card key={s} aria-labelledby={`section-${s}`} data-testid={`locations-section-${s}`}>
                <SectionHeading section={s} label={SECTION_LABELS[s]} hint={`${SECTION_HINTS[s]} · ${lots} lot${lots === 1 ? "" : "s"} in stock`} count={list.length} unit="place" />
                <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:hidden">
                  {list.map((l) => (
                    <li key={l.id} className="min-w-0">
                      <Link href={`/inventory/locations/${l.id}`} className="block rounded-[12px] border border-line p-3">
                        <div className="flex items-start justify-between gap-2"><span className="font-mono font-semibold">{l.code}</span><LocationKindChip kind={l.kind} /></div>
                        <p className="mt-1 text-[13px]">{l.name}</p>
                        <p className="mt-1 text-[12px] text-muted">{l.lots} lot(s) · {l.boxes} box(es){l.blocked ? ` · ${l.blocked} not ready to use` : ""}{l.frozenBy ? ` · frozen by ${l.frozenBy}` : ""}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Table className="hidden lg:block" head={["Place", "Type", "Lots", "Not ready to use", "Boxes", "Count"]}>
                  {list.map((l) => (
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
              </Card>
            );
          })
      )}
    </div>
  );
}

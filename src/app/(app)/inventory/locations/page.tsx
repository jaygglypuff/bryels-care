import { requireContext } from "@/lib/auth/context";
import { LOCATION_SECTIONS, SECTION_HINTS, SECTION_LABELS, isSection, type LocationSection } from "@/lib/location-sections";
import { listLocationsWithStock } from "@/modules/inventory/lots-admin";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { LocationKindChip } from "@/ui/inventory/bits";
import { SectionHeading } from "@/ui/inventory/sections";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Shelves" };

/**
 * Shelves and areas of the current site grouped by warehouse section (S6, ADR-077), with what each holds.
 * Grade-5 (ADR-088): shelf name first, code small and grey, one list for phone and desktop.
 */
export default async function LocationsStockPage({ searchParams }: { searchParams: Promise<{ kind?: string; section?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.location.view")) return <Forbidden what="shelves" />;
  const sp = await searchParams;
  const all = (await listLocationsWithStock(ctx)).map((r) => ({ ...r, section: (isSection(r.section) ? r.section : "other") as LocationSection }));
  const section = isSection(sp.section) ? sp.section : undefined;
  const rows = all.filter((r) => (!sp.kind || r.kind === sp.kind) && (!section || r.section === section));
  const present = LOCATION_SECTIONS.filter((s) => all.some((r) => r.section === s));
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <div className="space-y-4">
      <PageHeader title="Shelves" subtitle={ctx.currentSite.name} actions={ctx.can("inventory.movement.post") ? <LinkButton href="/inventory/move" variant="secondary">Move stock</LinkButton> : undefined} />
      <PageIntro>This screen is for seeing every shelf and area of the warehouse, what is on it, and if a count has stopped moves there. Tap a shelf to see its lots.</PageIntro>
      <FilterTabs
        label="Part of the warehouse"
        active={section ?? ""}
        tabs={[["", "Everywhere", "/inventory/locations"] as const, ...present.map((s) => [s, SECTION_LABELS[s], `/inventory/locations?section=${s}`] as const)]}
      />
      {rows.length === 0 ? (
        <EmptyState title={section || sp.kind ? "No shelves in this part" : "No shelves at this site yet"} action={section || sp.kind ? <LinkButton href="/inventory/locations" variant="secondary">Show everywhere</LinkButton> : undefined}>
          {section || sp.kind ? "Choose another part of the warehouse." : "Shelves are set up by the system administrator (Setup). Ask them to add the shelves of this site."}
        </EmptyState>
      ) : (
        present
          .filter((s) => rows.some((r) => r.section === s))
          .map((s) => {
            const list = rows.filter((r) => r.section === s);
            const lots = list.reduce((n, r) => n + r.lots, 0);
            return (
              <section key={s} aria-labelledby={`section-${s}`} data-testid={`locations-section-${s}`} className="space-y-2">
                <SectionHeading section={s} label={SECTION_LABELS[s]} hint={`${SECTION_HINTS[s]} · ${plural(lots, "lot", "lots")} in stock`} count={list.length} unit="place" />
                <PlainList label={SECTION_LABELS[s]}>
                  {list.map((l) => (
                    <PlainRow
                      key={l.id}
                      href={`/inventory/locations/${l.id}`}
                      title={l.name}
                      status={
                        <>
                          {l.kind !== "storage" && <LocationKindChip kind={l.kind} />}
                          {l.frozenBy && <Chip tone="warn">Being counted · no moves</Chip>}
                          {!l.isActive && <Chip>Not used any more</Chip>}
                        </>
                      }
                      facts={
                        <>
                          {plural(l.lots, "lot", "lots")} · {plural(l.boxes, "box or sack", "boxes or sacks")}
                          {l.blocked ? ` · ${l.blocked} not ready to use` : ""}
                        </>
                      }
                      code={l.code}
                      tone={l.frozenBy ? "warn" : undefined}
                    />
                  ))}
                </PlainList>
              </section>
            );
          })
      )}
    </div>
  );
}

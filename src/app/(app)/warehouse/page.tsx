import { requireContext } from "@/lib/auth/context";
import { sectionSummary } from "@/modules/inventory/sections";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { SectionTile } from "@/ui/inventory/sections";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../forbidden";

export const dynamic = "force-dynamic";
export const metadata = { title: "Warehouse sections" };

/**
 * Warehouse sections (S6, ADR-077): one tile per warehouse section ("Raw materials — 12 lots") so the operator
 * sees where things are; a tap opens the stock of that section. The day's tasks (receive, put away, move, count,
 * fix stock, find) are on the warehouse Home (ADR-090); the copy of them that made this page a second home was
 * removed (docs/LEGACY_SCREENS.md).
 */
export default async function WarehouseHomePage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="the warehouse" permission="inventory.lot.view" />;
  const tiles = await sectionSummary(ctx);
  const shown = tiles.filter((t) => t.lots > 0 || t.locations > 0);
  return (
    <div className="space-y-5">
      <PageHeader title="Warehouse sections" subtitle={ctx.currentSite.name} />
      <PageIntro>This screen is for seeing each part of the warehouse and how many lots are there. Tap a part to see its stock. The jobs of the day are on Home.</PageIntro>
      <Card>
        <CardTitle action={<LinkButton href="/inventory" variant="ghost">All stock</LinkButton>}>Parts of the warehouse</CardTitle>
        {shown.length === 0 ? (
          <EmptyState title="No places set up yet">Ask the site manager to add the shelves and say which part of the warehouse each is in (Management › Master data › Locations).</EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Warehouse sections">
            {shown.map((t) => (
              <li key={t.section} className="min-w-0">
                <SectionTile {...t} href={`/inventory?section=${t.section}`} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[12px] text-muted">A lot kept in two sections is counted in both. “Not ready to use” = waiting for QA check, stopped by QA, rejected or expired.</p>
      </Card>
    </div>
  );
}

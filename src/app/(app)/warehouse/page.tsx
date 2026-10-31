import { requireContext } from "@/lib/auth/context";
import { sectionSummary } from "@/modules/inventory/sections";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { SectionTile } from "@/ui/inventory/sections";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../forbidden";

export const dynamic = "force-dynamic";
export const metadata = { title: "Warehouse" };

/**
 * Warehouse home (S6, ADR-077): one tile per warehouse section ("Raw materials — 12 lots") so the operator
 * sees where things are; a tap opens the stock of that section. Common tasks are one tap away.
 */
export default async function WarehouseHomePage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="the warehouse" />;
  const tiles = await sectionSummary(ctx);
  const shown = tiles.filter((t) => t.lots > 0 || t.locations > 0);
  const tasks = [
    ctx.can("procurement.goods_receipt.create") && { href: "/inventory/receive", label: "Receive a delivery", cta: true },
    ctx.can("inventory.movement.post") && { href: "/inventory/receive/put-away", label: "Put away" },
    ctx.can("inventory.movement.post") && { href: "/inventory/move", label: "Move stock" },
    { href: "/inventory/scan", label: "Scan a label" },
    ctx.can("inventory.stock_count.view") && { href: "/inventory/counts", label: "Stock counts" },
  ].filter(Boolean) as { href: string; label: string; cta?: boolean }[];
  return (
    <div className="space-y-5">
      <PageHeader title="Warehouse" subtitle={ctx.currentSite.name} />
      <PageIntro>This screen is for the warehouse: the jobs of the day are one tap away, and each part of the warehouse shows how many lots are there.</PageIntro>
      <div className="flex flex-wrap gap-2">
        {tasks.map((t) => (
          <LinkButton key={t.href} href={t.href} variant={t.cta ? "cta" : "secondary"} size="lg">
            {t.label}
          </LinkButton>
        ))}
      </div>
      <Card>
        <CardTitle action={<LinkButton href="/inventory" variant="ghost">All stock</LinkButton>}>Parts of the warehouse</CardTitle>
        {shown.length === 0 ? (
          <EmptyState title="No places set up yet">Ask the site manager to add the shelves and say which part of the warehouse each is in (Setup → Shelves).</EmptyState>
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

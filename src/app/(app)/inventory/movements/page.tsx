import { requireContext } from "@/lib/auth/context";
import { MOVEMENT_TYPES, listMovements } from "@/modules/inventory/movements";
import { LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { FilterTabs } from "@/ui/plain-list";
import { MOVEMENT_LABEL } from "@/ui/inventory/bits";
import { MovementList } from "@/ui/inventory/movement-list";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Stock changes" };

/**
 * Stock changes (the site ledger, latest 200), grade-5 (ADR-088): one row per change, item first, the
 * change type as a chip with an icon, the amount on the right in friendly units. On a 390 px phone every
 * fact is visible (the old eight-column table showed only WHEN and TYPE).
 */
export default async function MovementsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.movement.view")) return <Forbidden what="stock changes" />;
  const { type } = await searchParams;
  const active = type && (MOVEMENT_TYPES as string[]).includes(type) ? type : undefined;
  const rows = await listMovements(ctx, { type: active });
  const tabs = [["", "All", "/inventory/movements"] as const, ...MOVEMENT_TYPES.map((t) => [t, MOVEMENT_LABEL[t], `/inventory/movements?type=${t}`] as const)];

  return (
    <div className="space-y-4">
      <PageHeader title="Stock changes" subtitle={ctx.currentSite.name} />
      <PageIntro>
        This screen is for seeing every time stock came in, moved, was used or went out, newest first. Nothing here is ever changed: a mistake is fixed with an undo that stays on record. Tap a row to see it.
      </PageIntro>
      <FilterTabs label="Kind of stock change" active={active ?? ""} tabs={tabs} />
      <MovementList
        rows={rows}
        empty={{
          title: active ? `No “${MOVEMENT_LABEL[active].toLowerCase()}” stock changes yet` : "No stock changes yet",
          text: "Every delivery received, move between shelves, use in making and sending out shows here as soon as it is saved to stock.",
        }}
      />
      {active && rows.length === 0 && <LinkButton href="/inventory/movements" variant="secondary">Show all stock changes</LinkButton>}
      {rows.length >= 200 && <p className="text-[13px] text-muted">Showing the newest 200. Open a lot to see all of its history.</p>}
    </div>
  );
}

import { Help } from "@/ui/help/help";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listRecentTransfers, listSiteLocations } from "@/modules/inventory/moves";
import { getContainer } from "@/modules/inventory/containers";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { Chip } from "@/ui/status";
import { placeWords } from "@/ui/inventory/bits";
import { Forbidden } from "../../forbidden";
import { lookupSourceAction, lotSourceById, type SourceInfo } from "./actions";
import { MoveFlow } from "./move-flow";

export const metadata = { title: "Move stock" };

const UUID = /^[0-9a-f-]{36}$/i;

/** Move stock (scan to move, US-2-14), grade-5 (ADR-088): scan or find by name, how much, scan or choose the shelf, confirm. */
export default async function MovePage({ searchParams }: { searchParams: Promise<{ box?: string; lot?: string; to?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.movement.post")) return <Forbidden what="moving stock" />;
  const sp = await searchParams;
  const locations = ctx.can("masterdata.location.view") ? await listSiteLocations(ctx) : [];
  let initialSource: SourceInfo | null = null;
  if (sp.box && UUID.test(sp.box) && ctx.can("inventory.container.view")) {
    try {
      const box = await getContainer(ctx, sp.box);
      const r = await lookupSourceAction(`BC:BOX:${box.containerNumber}`);
      if (r.ok) initialSource = r.data;
    } catch {
      initialSource = null;
    }
  } else if (sp.lot && UUID.test(sp.lot)) {
    initialSource = await lotSourceById(sp.lot);
  }
  const initialDestination = sp.to ? (locations.find((l) => l.id === sp.to) ?? null) : null;
  const recent = ctx.can("inventory.movement.view") ? await listRecentTransfers(ctx, 15) : [];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="Move stock"
        subtitle={ctx.currentSite.name}
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-2">
              <Help screen="inventory.move" />
              {ctx.can("inventory.movement.view") && <LinkButton href="/inventory/movements" variant="secondary">All stock changes</LinkButton>}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for moving stock to another shelf: scan the sack, box or lot (or type the item name), say how much, scan the shelf, then tap Confirm.</PageIntro>
      {locations.length === 0 ? (
        <EmptyState title="No shelves at this site">Shelves are set up by the system administrator (Setup). Ask them to add the shelves of this site.</EmptyState>
      ) : (
        <MoveFlow locations={locations} initialSource={initialSource} initialDestination={initialDestination} />
      )}
      {ctx.can("inventory.movement.view") && (
        <section className="space-y-2">
          <h2 className="text-[16px] font-semibold">Recent moves</h2>
          {recent.length === 0 ? (
            <p className="text-[14px] text-fg-2">No moves yet. Moves at this site show here.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface" aria-label="Recent moves">
              {recent.map((t) => (
                <li key={t.id} className="flex min-h-[56px] flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold">
                      {t.boxNumber ? `Box ${t.boxNumber}` : t.kind === "inter_site" ? "To another site" : "Loose stock"} {t.undoneAt && <Chip tone="warn">Undone</Chip>}
                    </p>
                    <p className="text-[13px] text-fg-2">
                      {placeWords(t.fromCode, t.toCode)} · {t.byName} · {fmtDateTime(t.completedAt)} <span className="font-mono text-[12px] text-muted">· {t.number}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

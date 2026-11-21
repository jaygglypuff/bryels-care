import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { reasonCodeOptions } from "@/modules/masterdata";
import { watchList, type WatchRow } from "@/modules/inventory";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Help } from "@/ui/help/help";
import { MoreMenu } from "@/ui/more-menu";
import { Forbidden } from "../../../forbidden";
import { CountLeft } from "./count-left";

export const metadata = { title: "Count what's left" };
export const dynamic = "force-dynamic";

/**
 * Count what's left (ADR-138 §3): open boxes and online shop shelf stock, the quiet ones first. Tap one, count the
 * pieces in your hand, save. The same number is a quick check; a difference goes to the site manager as a stock fix.
 */
export default async function CountLeftPage({ searchParams }: { searchParams: Promise<{ box?: string; lot?: string; location?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.takeout.create") && !ctx.can("inventory.adjustment.create")) return <Forbidden what="counting open boxes" permission="inventory.takeout.create" />;
  ctx.requireSite(ctx.currentSiteId);
  const sp = await searchParams;
  const rows = await watchList(db, ctx.organizationId, [ctx.currentSiteId]);
  const reasons = ctx.can("inventory.adjustment.create") ? (await reasonCodeOptions(db, ctx.organizationId, "adjustment")).filter((r) => !["opening_balance", "data_correction", "found_unlabelled"].includes(r.code)) : [];
  const key = (r: WatchRow) => (r.containerId ? `box:${r.containerId}` : `loose:${r.lotId}:${r.locationId}`);
  const selected = sp.box ? `box:${sp.box}` : sp.lot && sp.location ? `loose:${sp.lot}:${sp.location}` : null;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="Count what's left"
        subtitle={`${ctx.currentSite.name} · ${rows.length} ${rows.length === 1 ? "place" : "places"}`}
        actions={
          <MoreMenu>
            <div className="flex flex-col gap-2">
              <Help screen="inventory.takeout" />
              {ctx.can("inventory.takeout.create") && <LinkButton href="/inventory/take-out" variant="secondary">Take a few out</LinkButton>}
            </div>
          </MoreMenu>
        }
      />
      <PageIntro>This screen is for counting the pieces left in open boxes and on the online shop shelf. Count what you see; when it matches, one tap. When it does not, say why and the site manager checks it.</PageIntro>
      {rows.length === 0 ? (
        <EmptyState title="No open boxes here">Open boxes of finished goods, and pieces on an online shop shelf, show here to be counted.</EmptyState>
      ) : (
        <CountLeft
          rows={rows.map((r) => ({
            key: key(r),
            containerId: r.containerId,
            lotId: r.lotId,
            locationId: r.locationId,
            title: r.kind === "box" ? `Box ${r.boxNumber}` : `Loose on ${r.locationCode}`,
            productName: r.productName,
            detail: `${r.locationName} (${r.locationCode}) · lot ${r.lotNumber}${r.shopShelf ? " · online shop shelf" : ""}`,
            pieces: r.pieces,
            last: r.lastCount ? `Last counted ${fmtDateTime(r.lastCount)}` : `Last change ${fmtDateTime(r.lastActivity)}`,
            days: r.days,
            stale: r.stale,
          }))}
          selected={selected}
          reasons={reasons.map((r) => ({ code: r.code, label: r.label, requiresNote: r.requiresNote }))}
          canFix={ctx.can("inventory.adjustment.create") && ctx.can("inventory.adjustment.submit")}
        />
      )}
    </div>
  );
}

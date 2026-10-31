import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { CONTAINER_KINDS } from "@/db/schema";
import { getLocationDetail } from "@/modules/inventory/lots-admin";
import { listSiteLocations } from "@/modules/inventory/moves";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { NewBoxForm } from "../box-forms";

export const metadata = { title: "Pack into a box or sack" };

export default async function NewBoxPage({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.container.create") || !ctx.can("masterdata.location.view")) return <Forbidden what="packing boxes and sacks" />;
  const { lot } = await searchParams;
  // Loose stock per lot × shelf at the current site.
  const locs = await listSiteLocations(ctx);
  const byLot = new Map<string, { id: string; label: string; uom: string; locations: { id: string; code: string; name: string; loose: string }[] }>();
  for (const l of locs) {
    const d = await getLocationDetail(ctx, l.id);
    for (const r of d.lots) {
      const loose = Decimal.max(new Decimal(r.onHand).minus(r.boxed), 0);
      if (loose.lte(0)) continue;
      const entry = byLot.get(r.id) ?? { id: r.id, label: `${r.itemName} · lot ${r.lotNumber}`, uom: r.baseUom, locations: [] };
      entry.locations.push({ id: l.id, code: l.code, name: l.name, loose: loose.toString() });
      byLot.set(r.id, entry);
    }
  }
  const options = [...byLot.values()].sort((a, b) => a.label.localeCompare(b.label));
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title="Pack into a box or sack" subtitle={ctx.currentSite.name} />
      <PageIntro>This screen is for packing loose stock of one lot into a box or sack. The stock stays on the same shelf; the box gets its own number and label (made by the system).</PageIntro>
      <Card>
        {options.length === 0 ? (
          <EmptyState title="No loose stock to pack" action={<LinkButton href="/inventory/containers" variant="secondary">See boxes and sacks</LinkButton>}>
            Every lot at this site is already in a box, or has no stock left.
          </EmptyState>
        ) : (
          <NewBoxForm lots={options} initialLotId={lot} idempotencyKey={randomUUID()} kinds={CONTAINER_KINDS} />
        )}
      </Card>
    </div>
  );
}

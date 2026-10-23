import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { CONTAINER_KINDS } from "@/db/schema";
import { getLocationDetail } from "@/modules/inventory/lots-admin";
import { listSiteLocations } from "@/modules/inventory/moves";
import { Card, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { NewBoxForm } from "../box-forms";

export const metadata = { title: "New box" };

export default async function NewBoxPage({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.container.create") || !ctx.can("masterdata.location.view")) return <Forbidden what="packing boxes" />;
  const { lot } = await searchParams;
  // Loose stock per lot × location at the current site.
  const locs = await listSiteLocations(ctx);
  const byLot = new Map<string, { id: string; label: string; uom: string; locations: { id: string; code: string; loose: string }[] }>();
  for (const l of locs) {
    const d = await getLocationDetail(ctx, l.id);
    for (const r of d.lots) {
      const loose = Decimal.max(new Decimal(r.onHand).minus(r.boxed), 0);
      if (loose.lte(0)) continue;
      const entry = byLot.get(r.id) ?? { id: r.id, label: `${r.lotNumber} · ${r.itemName}`, uom: r.baseUom, locations: [] };
      entry.locations.push({ id: l.id, code: l.code, loose: loose.toString() });
      byLot.set(r.id, entry);
    }
  }
  const options = [...byLot.values()].sort((a, b) => a.label.localeCompare(b.label));
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title="New box" subtitle="Pack loose stock of one lot into a box. The stock stays where it is; the box gets its own number and label." />
      <Card>
        {options.length === 0 ? (
          <EmptyState title="No loose stock to pack" action={<LinkButton href="/inventory/containers" variant="secondary">Back to boxes</LinkButton>}>
            Every lot at this site is already boxed or has no stock.
          </EmptyState>
        ) : (
          <NewBoxForm lots={options} initialLotId={lot} idempotencyKey={randomUUID()} kinds={CONTAINER_KINDS} />
        )}
      </Card>
    </div>
  );
}

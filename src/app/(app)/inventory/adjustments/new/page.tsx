import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { requireContext } from "@/lib/auth/context";
import { ADJUSTMENT_REASONS } from "@/db/schema";
import { getLocationDetail } from "@/modules/inventory/lots-admin";
import { listSiteLocations } from "@/modules/inventory/moves";
import { Card, PageHeader } from "@/ui/core";
import { Forbidden } from "../../../forbidden";
import { AdjustmentForm } from "../adjustment-form";

export const metadata = { title: "New adjustment" };

export default async function NewAdjustmentPage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.adjustment.create") || !ctx.can("masterdata.location.view") || !ctx.can("inventory.lot.view")) return <Forbidden what="drafting adjustments" />;
  const locs = await listSiteLocations(ctx);
  const lots = new Map<string, { id: string; label: string; uom: string; locations: { id: string; code: string; qty: string }[] }>();
  for (const l of locs) {
    const d = await getLocationDetail(ctx, l.id);
    for (const r of d.lots) {
      const e = lots.get(r.id) ?? { id: r.id, label: `${r.lotNumber} · ${r.itemName}`, uom: r.baseUom, locations: [] };
      e.locations.push({ id: l.id, code: l.code, qty: new Decimal(r.onHand).toString() });
      lots.set(r.id, e);
    }
  }
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="New stock adjustment" subtitle="Draft now; it posts only after someone else approves it." />
      <Card>
        <AdjustmentForm lots={[...lots.values()].sort((a, b) => a.label.localeCompare(b.label))} locations={locs} reasons={ADJUSTMENT_REASONS} idempotencyKey={randomUUID()} />
      </Card>
    </div>
  );
}

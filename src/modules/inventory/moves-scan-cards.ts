import "server-only";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { containerContents, containers, inventoryBalances, inventoryLots, locations, stockReservations } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { daysUntil } from "@/lib/qty";
import { findContainerByNumber, getContainer, type AllowedAction } from "./containers";
import { activeCountsForLocations } from "./counts";
import { allowedDestinationKinds } from "./lots";
import { recommendLots } from "./reservations";

/**
 * Scan result cards for BC:BOX, BC:LOC and BC:LOT payloads (W02-02), with server-decided allowed
 * actions. Built for the scan page (owned by W1E) to call; records outside the user's sites
 * return null exactly like records that do not exist.
 */
export type ScanCard = {
  kind: "box" | "location" | "lot";
  id: string;
  title: string;
  subtitle: string;
  /** Lot quality status (box: the contents' status; location: its kind). */
  status: string;
  href: string;
  facts: [string, string][];
  warnings: string[];
  allowedActions: AllowedAction[];
};

const strip = (raw: string, prefix: string) => raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().toUpperCase().replace(new RegExp(`^BC:${prefix}:`), "");

export async function describeBoxForScan(ctx: AuthContext, raw: string): Promise<ScanCard | null> {
  if (!ctx.can("inventory.container.view")) return null;
  const hit = await findContainerByNumber(ctx, raw);
  if (!hit) return null;
  const box = await getContainer(ctx, hit.id);
  const statuses = [...new Set(box.contents.map((c) => c.qualityStatus))];
  const warnings: string[] = [];
  if (box.frozenBy) warnings.push(`Location frozen by count ${box.frozenBy}.`);
  if (box.mismatch) warnings.push("Box contents are above the stock recorded at its location; ask for a count.");
  return {
    kind: "box",
    id: box.id,
    title: box.containerNumber,
    subtitle: box.contents.map((c) => `${new Decimal(c.qtyBase).toString()} ${c.baseUom} ${c.itemName} · lot ${c.lotNumber}`).join("; ") || "Empty",
    status: statuses.length === 1 ? statuses[0] : statuses.length ? "mixed" : box.status,
    href: `/inventory/containers/${box.id}`,
    facts: [
      ["Box status", box.status],
      ["Location", box.locationCode ?? "—"],
      ["Packed", box.packedAt ? box.packedAt.toISOString().slice(0, 10) : "—"],
      ["Lineage edges", String(box.lineage.length)],
    ],
    warnings,
    allowedActions: box.allowedActions,
  };
}

export async function describeLocationForScan(ctx: AuthContext, raw: string): Promise<ScanCard | null> {
  if (!ctx.can("masterdata.location.view")) return null;
  const code = strip(raw, "LOC");
  // Location codes are unique per site only: prefer the current site.
  const [loc] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.code, code), inArray(locations.siteId, ctx.allowedSiteIds)))
    .orderBy(sql`(${locations.siteId} = ${ctx.currentSiteId}) desc`)
    .limit(1);
  if (!loc) return null;
  const [stock] = await db
    .select({ lots: sql<number>`count(distinct ${inventoryBalances.lotId})::int` })
    .from(inventoryBalances)
    .where(and(eq(inventoryBalances.locationId, loc.id), gt(inventoryBalances.qtyBase, "0")));
  const [boxes] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(containers)
    .where(and(eq(containers.currentLocationId, loc.id), inArray(containers.status, ["open", "sealed"])));
  const counts = await activeCountsForLocations(db, [loc.id]);
  const frozen = counts[0]?.countNumber ?? null;
  const actions: AllowedAction[] = [];
  if (ctx.can("inventory.lot.view")) actions.push({ key: "contents", label: "See what is here", href: `/inventory/locations/${loc.id}`, allowed: true });
  if (ctx.can("inventory.movement.post"))
    actions.push({ key: "move_here", label: "Move stock here", href: `/inventory/move?to=${loc.id}`, allowed: loc.isActive && !frozen, reason: !loc.isActive ? "Location is inactive." : frozen ? `Frozen by count ${frozen}.` : undefined });
  if (frozen && ctx.can("inventory.stock_count.submit")) actions.push({ key: "count", label: `Count ${frozen}`, href: `/inventory/counts/${counts[0].countId}`, allowed: true });
  return {
    kind: "location",
    id: loc.id,
    title: loc.code,
    subtitle: loc.name,
    status: loc.kind,
    href: `/inventory/locations/${loc.id}`,
    facts: [
      ["Kind", loc.kind],
      ["Lots in stock", String(stock?.lots ?? 0)],
      ["Boxes", String(boxes?.n ?? 0)],
      ["Count in progress", frozen ?? "None"],
    ],
    warnings: [...(frozen ? [`Frozen by stock count ${frozen}: no moves in or out.`] : []), ...(loc.siteId !== ctx.currentSiteId ? ["This location is at another of your sites. Switch site to act on it."] : [])],
    allowedActions: loc.siteId === ctx.currentSiteId ? actions : actions.filter((a) => a.key === "contents"),
  };
}

export async function describeLotForScan(ctx: AuthContext, raw: string): Promise<ScanCard | null> {
  if (!ctx.can("inventory.lot.view")) return null;
  const number = strip(raw, "LOT");
  const [lot] = await db
    .select()
    .from(inventoryLots)
    .where(and(eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.lotNumber, number), inArray(inventoryLots.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!lot) return null;
  const bal = await db
    .select({ code: locations.code, qty: inventoryBalances.qtyBase })
    .from(inventoryBalances)
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .where(and(eq(inventoryBalances.lotId, lot.id), gt(inventoryBalances.qtyBase, "0")));
  const [boxed] = await db
    .select({ q: sql<string>`coalesce(sum(${containerContents.qtyBase}),0)::text` })
    .from(containerContents)
    .innerJoin(containers, eq(containers.id, containerContents.containerId))
    .where(and(eq(containerContents.lotId, lot.id), inArray(containers.status, ["open", "sealed"])));
  const [reserved] = await db
    .select({ q: sql<string>`coalesce(sum(${stockReservations.qtyBase}),0)::text` })
    .from(stockReservations)
    .where(and(eq(stockReservations.lotId, lot.id), eq(stockReservations.status, "active"), sql`(${stockReservations.expiresAt} is null or ${stockReservations.expiresAt} > now())`));
  const onHand = bal.reduce((s, b) => s.plus(b.qty), new Decimal(0));
  let fefoRank: string = "—";
  if (lot.siteId === ctx.currentSiteId) {
    const rec = await recommendLots(ctx, lot.materialId ? { materialId: lot.materialId } : { productId: lot.productId });
    const mine = rec.candidates.find((c) => c.lotId === lot.id && c.eligible);
    fefoRank = mine ? `${mine.rank} of ${rec.candidates.filter((c) => c.eligible).length} (${rec.strategy.toUpperCase()})` : "Not proposed";
  }
  const kinds = allowedDestinationKinds(lot.qualityStatus, lot.expiresOn);
  const left = daysUntil(lot.expiresOn);
  const actions: AllowedAction[] = [{ key: "open", label: "Open lot", href: `/inventory/${lot.id}`, allowed: true }];
  if (lot.siteId === ctx.currentSiteId) {
    if (ctx.can("inventory.movement.post"))
      actions.push({ key: "move", label: kinds.includes("storage") ? "Move stock" : `Move (only to ${kinds.join(" / ")})`, href: `/inventory/move?lot=${lot.id}`, allowed: onHand.gt(0), reason: onHand.gt(0) ? undefined : "No stock left." });
    if (ctx.can("inventory.container.create")) actions.push({ key: "box", label: "Pack into a box", href: `/inventory/containers/new?lot=${lot.id}`, allowed: onHand.gt(0), reason: onHand.gt(0) ? undefined : "No stock left." });
    if (ctx.can("inventory.reservation.create")) {
      const usable = lot.qualityStatus === "released" && (left === null || left >= 0);
      actions.push({ key: "reserve", label: "Reserve", href: `/inventory/lots/reservations?lot=${lot.id}`, allowed: usable && onHand.gt(0), reason: usable ? (onHand.gt(0) ? undefined : "No stock left.") : "Only released, unexpired stock can be reserved." });
    }
  }
  if (ctx.can("inventory.label_job.create")) actions.push({ key: "label", label: "Print label", href: `/labels/new?entityType=inventory_lot&entityId=${lot.id}`, allowed: true });
  return {
    kind: "lot",
    id: lot.id,
    title: lot.lotNumber,
    subtitle: bal.map((b) => `${b.code}: ${new Decimal(b.qty).toString()} ${lot.baseUom}`).join(" · ") || "No stock",
    status: lot.qualityStatus,
    href: `/inventory/${lot.id}`,
    facts: [
      ["On hand", `${onHand.toString()} ${lot.baseUom}`],
      ["In boxes", `${new Decimal(boxed?.q ?? 0).toString()} ${lot.baseUom}`],
      ["Reserved", `${new Decimal(reserved?.q ?? 0).toString()} ${lot.baseUom}`],
      ["Expiry", lot.expiresOn ? `${lot.expiresOn} (${left} d)` : "No expiry"],
      ["FEFO rank", fefoRank],
    ],
    warnings: lot.siteId !== ctx.currentSiteId ? ["This lot is at another of your sites. Switch site to act on it."] : [],
    allowedActions: actions,
  };
}

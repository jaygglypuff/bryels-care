import "server-only";
import { and, asc, eq, gt, inArray, notInArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { containerContents, containers, inventoryBalances, inventoryLots, labelVerifications, locations, materials, products, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { parseScan } from "@/lib/scan";
import { getSetting } from "@/lib/settings";
import { assertUuid } from "./shared";

/**
 * Label verification scan (US-2-24, docs/data-migration-plan.md §10 step 5, MC-06): the count-and-tag
 * team scans every newly labelled box (BC:BOX) and loose lot label (BC:LOT) in a zone (location); the
 * first good scan is recorded in label_verifications (append-only), the container itself never changes,
 * and the zone shows verified % against the target (setting inventory.label_verification.target_pct).
 */

/** Container states that still stand in a zone and carry a label. */
const LIVE_CONTAINER = ["open", "sealed"];

export type ZoneItem = {
  kind: "box" | "lot";
  id: string;
  number: string;
  label: string;
  lotNumber: string | null;
  verifiedAt: Date | null;
  verifiedByName: string | null;
};

async function zoneItems(siteId: string, locationId: string): Promise<ZoneItem[]> {
  const boxes = await db
    .select({ id: containers.id, number: containers.containerNumber, kind: containers.containerKind, verifiedAt: labelVerifications.verifiedAt, verifiedByName: users.displayName })
    .from(containers)
    .leftJoin(labelVerifications, eq(labelVerifications.containerId, containers.id))
    .leftJoin(users, eq(users.id, labelVerifications.verifiedBy))
    .where(and(eq(containers.siteId, siteId), eq(containers.currentLocationId, locationId), inArray(containers.status, LIVE_CONTAINER)))
    .orderBy(asc(containers.containerNumber));
  const boxIds = boxes.map((b) => b.id);
  const boxLots = boxIds.length
    ? await db.select({ containerId: containerContents.containerId, lotNumber: inventoryLots.lotNumber, lotId: inventoryLots.id, qty: containerContents.qtyBase }).from(containerContents).innerJoin(inventoryLots, eq(inventoryLots.id, containerContents.lotId)).where(and(inArray(containerContents.containerId, boxIds), gt(containerContents.qtyBase, "0")))
    : [];
  const balances = await db
    .select({ lotId: inventoryLots.id, lotNumber: inventoryLots.lotNumber, qty: inventoryBalances.qtyBase, itemName: sql<string>`coalesce(${materials.name}, ${products.name})`, verifiedAt: labelVerifications.verifiedAt, verifiedByName: users.displayName })
    .from(inventoryBalances)
    .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .leftJoin(labelVerifications, and(eq(labelVerifications.lotId, inventoryLots.id), eq(labelVerifications.locationId, locationId), sql`${labelVerifications.containerId} is null`))
    .leftJoin(users, eq(users.id, labelVerifications.verifiedBy))
    .where(and(eq(inventoryBalances.locationId, locationId), gt(inventoryBalances.qtyBase, "0")))
    .orderBy(asc(inventoryLots.lotNumber));
  const items: ZoneItem[] = boxes.map((b) => {
    const ls = boxLots.filter((x) => x.containerId === b.id);
    return { kind: "box", id: b.id, number: b.number, label: b.kind, lotNumber: ls.map((x) => x.lotNumber).join(", ") || null, verifiedAt: b.verifiedAt, verifiedByName: b.verifiedByName };
  });
  for (const bal of balances) {
    const boxed = boxLots.filter((x) => x.lotId === bal.lotId).reduce((s, x) => s.plus(x.qty), new Decimal(0));
    if (new Decimal(bal.qty).gt(boxed)) items.push({ kind: "lot", id: bal.lotId, number: bal.lotNumber, label: bal.itemName, lotNumber: bal.lotNumber, verifiedAt: bal.verifiedAt, verifiedByName: bal.verifiedByName });
  }
  return items;
}

async function zoneLocation(ctx: AuthContext, locationId: string) {
  assertUuid(locationId, "Location");
  const [loc] = await db.select().from(locations).where(eq(locations.id, locationId)).limit(1);
  if (!loc || loc.siteId !== ctx.currentSiteId) throw new DomainError("not_found", "Location not found at your current site.");
  ctx.requireSite(loc.siteId);
  return loc;
}

/** Zones (locations) of the current site with live boxes or stock, for the zone picker. */
export async function labelVerificationLocations(ctx: AuthContext) {
  ctx.require("inventory.label_job.view");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);
  return db
    .select({
      id: locations.id,
      code: locations.code,
      name: locations.name,
      // Qualified explicitly: in a single-table select drizzle renders ${locations.id} as a bare "id".
      boxes: sql<number>`(select count(*)::int from ${containers} c where c.current_location_id = "locations"."id" and c.status in ('open','sealed'))`,
      verifiedBoxes: sql<number>`(select count(*)::int from ${containers} c join ${labelVerifications} v on v.container_id = c.id where c.current_location_id = "locations"."id" and c.status in ('open','sealed'))`,
    })
    .from(locations)
    .where(and(eq(locations.siteId, siteId), eq(locations.isActive, true), notInArray(locations.kind, ["shipping"])))
    .orderBy(asc(locations.code));
}

export async function labelVerificationZone(ctx: AuthContext, locationId: string) {
  ctx.require("inventory.label_job.view");
  const loc = await zoneLocation(ctx, locationId);
  const items = await zoneItems(loc.siteId, loc.id);
  const verified = items.filter((i) => i.verifiedAt).length;
  const targetPct = await getSetting(db, ctx.organizationId, "inventory.label_verification.target_pct");
  const pct = items.length ? new Decimal(verified).div(items.length).mul(100).toDecimalPlaces(1).toNumber() : 100;
  return {
    location: { id: loc.id, code: loc.code, name: loc.name },
    items,
    remaining: items.filter((i) => !i.verifiedAt),
    total: items.length,
    verified,
    verifiedPct: pct,
    targetPct,
    targetMet: pct >= targetPct,
    canScan: ctx.can("inventory.container.edit"),
  };
}

export type VerifyOutcome = { status: "verified" | "already"; kind: "box" | "lot"; number: string; verifiedAt: Date; verifiedByName: string | null };

/** Records the first verified scan of a box or loose lot label at the zone; repeats answer "already verified". */
export async function verifyLabelScan(ctx: AuthContext, input: { locationId: string; scan: string; clientSequence?: number | null }): Promise<VerifyOutcome> {
  ctx.require("inventory.container.edit");
  ctx.require("inventory.label_job.view");
  const loc = await zoneLocation(ctx, input.locationId);
  const parsed = parseScan(input.scan);
  if (parsed.kind === "invalid") throw new DomainError("validation", "That is not a box or lot label. Scan the BC:BOX or BC:LOT code.", { field: "scan" });
  if (parsed.kind === "typed" && parsed.type !== "BOX" && parsed.type !== "LOT") throw new DomainError("validation", "Scan a box (BC:BOX) or lot (BC:LOT) label.", { field: "scan" });
  const value = parsed.value;
  const notHere = () => new DomainError("not_found", `${value} not found at your site.`, { field: "scan" });

  return db.transaction(async (tx) => {
    let target: { kind: "box"; id: string; number: string } | { kind: "lot"; id: string; number: string } | null = null;
    if (parsed.kind === "untyped" || parsed.type === "BOX") {
      const [c] = await tx.select().from(containers).where(and(eq(containers.organizationId, ctx.organizationId), eq(containers.containerNumber, value))).limit(1);
      if (c) {
        if (c.siteId !== ctx.currentSiteId || !ctx.allowedSiteIds.includes(c.siteId)) throw notHere();
        if (!LIVE_CONTAINER.includes(c.status)) throw new DomainError("state", `Box ${c.containerNumber} is ${c.status.replace("_", " ")}; it should not be in a zone.`, { field: "scan" });
        if (c.currentLocationId !== loc.id) {
          const [at] = c.currentLocationId ? await tx.select({ code: locations.code }).from(locations).where(eq(locations.id, c.currentLocationId)).limit(1) : [];
          throw new DomainError("conflict", `Box ${c.containerNumber} is recorded at ${at?.code ?? "no location"}, not ${loc.code}. Move it or correct its location first.`, { field: "scan" });
        }
        target = { kind: "box", id: c.id, number: c.containerNumber };
      } else if (parsed.kind === "typed") throw notHere();
    }
    if (!target) {
      const [l] = await tx.select().from(inventoryLots).where(and(eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.lotNumber, value))).limit(1);
      if (!l || l.siteId !== ctx.currentSiteId || !ctx.allowedSiteIds.includes(l.siteId)) throw notHere();
      const [bal] = await tx.select({ qty: inventoryBalances.qtyBase }).from(inventoryBalances).where(and(eq(inventoryBalances.lotId, l.id), eq(inventoryBalances.locationId, loc.id))).limit(1);
      if (!bal || new Decimal(bal.qty).lte(0)) throw new DomainError("conflict", `Lot ${l.lotNumber} has no stock recorded at ${loc.code}.`, { field: "scan" });
      target = { kind: "lot", id: l.id, number: l.lotNumber };
    }
    const payload = parsed.kind === "typed" ? parsed.payload : `${target.kind === "box" ? "BC:BOX" : "BC:LOT"}:${value}`;
    const inserted = await tx
      .insert(labelVerifications)
      .values({
        organizationId: ctx.organizationId,
        siteId: loc.siteId,
        containerId: target.kind === "box" ? target.id : null,
        lotId: target.kind === "lot" ? target.id : null,
        locationId: loc.id,
        scanPayload: payload,
        verifiedBy: ctx.userId,
        clientSequence: input.clientSequence ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) {
      const [prev] = await tx
        .select({ at: labelVerifications.verifiedAt, by: users.displayName })
        .from(labelVerifications)
        .innerJoin(users, eq(users.id, labelVerifications.verifiedBy))
        .where(target.kind === "box" ? eq(labelVerifications.containerId, target.id) : and(eq(labelVerifications.lotId, target.id), eq(labelVerifications.locationId, loc.id), sql`${labelVerifications.containerId} is null`))
        .limit(1);
      return { status: "already", kind: target.kind, number: target.number, verifiedAt: prev.at, verifiedByName: prev.by };
    }
    await audit(tx, ctx, {
      action: target.kind === "box" ? "inventory.container.verified" : "inventory.lot.label_verified",
      entityType: target.kind === "box" ? "container" : "inventory_lot",
      entityId: target.id,
      entityNumber: target.number,
      siteId: loc.siteId,
      after: { location: loc.code, scanPayload: payload },
    });
    return { status: "verified", kind: target.kind, number: target.number, verifiedAt: inserted[0].verifiedAt, verifiedByName: ctx.displayName };
  });
}

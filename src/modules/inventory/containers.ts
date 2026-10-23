import "server-only";
import { and, asc, desc, eq, gt, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import { db, type Tx } from "@/db/client";
import {
  CONTAINER_KINDS,
  containerContents,
  containerLineage,
  containers,
  inventoryBalances,
  inventoryLots,
  locations,
  materials,
  products,
  stockMovements,
  users,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { claimIdempotencyKey, stateMachine, storeIdempotentResult } from "./command-kit";
import { allowedDestinationKinds, isPastExpiry, isUuid } from "./lots";
import { looseQty, MOVABLE_BOX_STATUSES } from "./moves";
import { activeCountsForLocations } from "./counts";
import { getInventorySetting } from "./policy";

type ContainerStatus = "open" | "sealed" | "in_transit" | "shipped" | "empty" | "void";

/** Container life cycle (data-model §3.3). Quality status is never a container status. */
export const containerMachine = stateMachine<ContainerStatus>("container", {
  open: ["sealed", "empty", "in_transit", "shipped"],
  sealed: ["open", "empty", "in_transit", "shipped"],
  in_transit: ["open", "sealed"],
  empty: ["open", "void"],
  shipped: [],
  void: [],
});

const QTY_RE = /^\d{1,12}(\.\d{1,6})?$/;
const parseQty = (v: string, what = "quantity") => {
  if (!QTY_RE.test(v ?? "") || new Decimal(v).lte(0)) throw new DomainError("validation", `Enter a ${what} greater than zero (up to 6 decimals).`);
  return new Decimal(v);
};

async function lockContainers(tx: Tx, ctx: AuthContext, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  if (sorted.some((i) => !isUuid(i))) throw new DomainError("not_found", "Box not found in your sites.");
  const rows = await tx.select().from(containers).where(inArray(containers.id, sorted)).orderBy(asc(containers.id)).for("update");
  if (rows.length !== sorted.length || rows.some((r) => r.organizationId !== ctx.organizationId || !ctx.allowedSiteIds.includes(r.siteId))) {
    throw new DomainError("not_found", "Box not found in your sites.");
  }
  for (const r of rows) ctx.requireSite(r.siteId);
  return rows;
}

async function lockLots(tx: Tx, lotIds: string[]) {
  const sorted = [...new Set(lotIds)].sort();
  if (sorted.length === 0) return [];
  return tx.select().from(inventoryLots).where(inArray(inventoryLots.id, sorted)).orderBy(asc(inventoryLots.id)).for("update");
}

async function contentsOf(tx: Tx, containerId: string) {
  return tx.select().from(containerContents).where(and(eq(containerContents.containerId, containerId), gt(containerContents.qtyBase, "0")));
}

async function addContent(tx: Tx, box: { id: string; organizationId: string; siteId: string }, lotId: string, baseUom: string, qty: Decimal) {
  await tx
    .insert(containerContents)
    .values({ organizationId: box.organizationId, siteId: box.siteId, containerId: box.id, lotId, baseUom, qtyBase: qty.toString() })
    .onConflictDoUpdate({
      target: [containerContents.containerId, containerContents.lotId],
      set: { qtyBase: sql`${containerContents.qtyBase} + ${qty.toString()}`, updatedAt: new Date() },
    });
}

async function takeContent(tx: Tx, containerId: string, lotId: string, qty: Decimal) {
  await tx
    .update(containerContents)
    .set({ qtyBase: sql`${containerContents.qtyBase} - ${qty.toString()}`, updatedAt: new Date() })
    .where(and(eq(containerContents.containerId, containerId), eq(containerContents.lotId, lotId)));
}

async function newBox(tx: Tx, ctx: AuthContext, v: { siteId: string; locationId: string | null; kind: string; isPartial?: boolean; notes?: string | null }) {
  const number = await nextNumber(tx, ctx.organizationId, "BOX");
  const [box] = await tx
    .insert(containers)
    .values({
      organizationId: ctx.organizationId,
      siteId: v.siteId,
      containerNumber: number,
      containerKind: v.kind,
      status: "open",
      currentLocationId: v.locationId,
      packedAt: new Date(),
      packedBy: ctx.userId,
      isPartial: v.isPartial ?? false,
      notes: v.notes ?? null,
      createdBy: ctx.userId,
    })
    .returning();
  return box;
}

/** Empties a box when nothing is left in it (status open/sealed → empty). */
async function emptyIfDrained(tx: Tx, box: typeof containers.$inferSelect) {
  const left = await contentsOf(tx, box.id);
  if (left.length === 0 && containerMachine.can(box.status as ContainerStatus, "empty")) {
    await tx.update(containers).set({ status: "empty", updatedAt: new Date() }).where(eq(containers.id, box.id));
    return true;
  }
  return false;
}

function assertMovable(box: typeof containers.$inferSelect) {
  if (!(MOVABLE_BOX_STATUSES as readonly string[]).includes(box.status)) throw new DomainError("state", `Box ${box.containerNumber} is ${box.status}; only open or sealed boxes can be changed.`);
  if (!box.currentLocationId) throw new DomainError("state", `Box ${box.containerNumber} has no location.`);
}

function sameItem(a: { materialId: string | null; productId: string | null }, b: { materialId: string | null; productId: string | null }) {
  return a.materialId === b.materialId && a.productId === b.productId;
}

export type CreateBoxInput = { lotId: string; locationId: string; qty: string; containerKind?: string; isPartial?: boolean; notes?: string | null; idempotencyKey: string };

/** Packs loose stock of a lot at a location into a new box (rule BOX). Stock stays at the location. */
export async function createBox(ctx: AuthContext, input: CreateBoxInput) {
  ctx.require("inventory.container.create");
  const kind = input.containerKind ?? "box";
  if (!(CONTAINER_KINDS as readonly string[]).includes(kind)) throw new DomainError("validation", "Choose a container kind.");
  if (!isUuid(input.lotId)) throw new DomainError("not_found", "Lot not found in your sites.");
  const qty = parseQty(input.qty);
  const key = `box_create:${input.idempotencyKey}`;
  const body = { ...input, idempotencyKey: undefined };
  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<{ id: string; containerNumber: string }>(tx, ctx.organizationId, key, "inventory.container.create", body);
    if (claimed) return { ...claimed.replay, replayed: true };
    const [lot] = await lockLots(tx, [input.lotId]);
    if (!lot || !ctx.allowedSiteIds.includes(lot.siteId)) throw new DomainError("not_found", "Lot not found in your sites.");
    ctx.requireSite(lot.siteId);
    const [loc] = isUuid(input.locationId) ? await tx.select().from(locations).where(eq(locations.id, input.locationId)) : [];
    if (!loc || loc.siteId !== lot.siteId) throw new DomainError("validation", "Choose a location of this lot's site.");
    if (lot.baseUom === "pcs" && !qty.isInteger()) throw new DomainError("validation", "This lot is counted in pieces; enter a whole number.");
    const loose = await looseQty(tx, lot.id, loc.id);
    if (loose.lt(qty)) throw new DomainError("insufficient_stock", `Only ${loose.toString()} ${lot.baseUom} of lot ${lot.lotNumber} is loose (not boxed) at ${loc.code}.`);
    const box = await newBox(tx, ctx, { siteId: lot.siteId, locationId: loc.id, kind, isPartial: input.isPartial, notes: input.notes?.trim() || null });
    await addContent(tx, box, lot.id, lot.baseUom, qty);
    await audit(tx, ctx, {
      action: "inventory.container.created",
      entityType: "container",
      entityId: box.id,
      entityNumber: box.containerNumber,
      siteId: box.siteId,
      after: { lotNumber: lot.lotNumber, qtyBase: qty.toString(), baseUom: lot.baseUom, location: loc.code, kind },
    });
    const result = { id: box.id, containerNumber: box.containerNumber };
    await storeIdempotentResult(tx, ctx.organizationId, key, body, result);
    return { ...result, replayed: false };
  });
}

export type SplitInput = { containerId: string; children: { lotId?: string; qty: string }[]; idempotencyKey: string };

/**
 * W02-04 split: takes quantities out of a box into new child boxes at the same location. One
 * container_lineage edge per child and lot; children inherit the lot (and so its status).
 */
export async function splitBox(ctx: AuthContext, input: SplitInput) {
  ctx.require("inventory.container.create");
  if (!input.children?.length) throw new DomainError("validation", "Enter at least one quantity to split off.");
  const key = `box_split:${input.idempotencyKey}`;
  const body = { ...input, idempotencyKey: undefined };
  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<{ children: { id: string; containerNumber: string }[] }>(tx, ctx.organizationId, key, "inventory.container.split", body);
    if (claimed) return { ...claimed.replay, replayed: true };
    const [parent] = await lockContainers(tx, ctx, [input.containerId]);
    assertMovable(parent);
    const contents = await contentsOf(tx, parent.id);
    if (contents.length === 0) throw new DomainError("state", `Box ${parent.containerNumber} is empty.`);
    const lots = await lockLots(tx, contents.map((c) => c.lotId));
    const wanted = input.children.map((ch) => {
      const lotId = ch.lotId ?? (contents.length === 1 ? contents[0].lotId : "");
      if (!lotId) throw new DomainError("validation", "This box holds several lots; choose the lot for each new box.");
      const content = contents.find((c) => c.lotId === lotId);
      if (!content) throw new DomainError("validation", "That lot is not in this box.");
      const lot = lots.find((l) => l.id === lotId)!;
      const qty = parseQty(ch.qty);
      if (lot.baseUom === "pcs" && !qty.isInteger()) throw new DomainError("validation", "This lot is counted in pieces; enter whole numbers.");
      return { lot, qty };
    });
    for (const c of contents) {
      const taken = wanted.filter((w) => w.lot.id === c.lotId).reduce((s, w) => s.plus(w.qty), new Decimal(0));
      if (taken.gt(c.qtyBase)) {
        const lot = lots.find((l) => l.id === c.lotId)!;
        throw new DomainError("validation", `The new boxes add up to ${taken.toString()} ${lot.baseUom} of lot ${lot.lotNumber}, more than the ${new Decimal(c.qtyBase).toString()} ${lot.baseUom} in ${parent.containerNumber}.`);
      }
    }
    const operationId = randomUUID();
    const children: { id: string; containerNumber: string }[] = [];
    for (const w of wanted) {
      const child = await newBox(tx, ctx, { siteId: parent.siteId, locationId: parent.currentLocationId, kind: parent.containerKind });
      await tx.update(containers).set({ parentContainerId: parent.parentContainerId }).where(eq(containers.id, child.id));
      await addContent(tx, child, w.lot.id, w.lot.baseUom, w.qty);
      await takeContent(tx, parent.id, w.lot.id, w.qty);
      await tx.insert(containerLineage).values({
        organizationId: ctx.organizationId,
        siteId: parent.siteId,
        operation: "split",
        operationId,
        parentContainerId: parent.id,
        childContainerId: child.id,
        lotId: w.lot.id,
        qtyBase: w.qty.toString(),
        performedBy: ctx.userId,
      });
      children.push({ id: child.id, containerNumber: child.containerNumber });
    }
    const emptied = await emptyIfDrained(tx, parent);
    await audit(tx, ctx, {
      action: "inventory.container.split",
      entityType: "container",
      entityId: parent.id,
      entityNumber: parent.containerNumber,
      siteId: parent.siteId,
      after: { children: children.map((c, i) => ({ number: c.containerNumber, lot: wanted[i].lot.lotNumber, qty: wanted[i].qty.toString() })), parentEmptied: emptied, operationId },
    });
    const result = { children };
    await storeIdempotentResult(tx, ctx.organizationId, key, body, result);
    return { ...result, replayed: false };
  });
}

/**
 * W02-05 merge: two or more boxes at the same location into one new box. Same item only (V-MAT);
 * boxes whose lots have different quality statuses never merge (409); mixed lots only when the
 * setting `inventory.container.allow_mixed_lots` allows (A-PROC-22). Parents are emptied.
 */
export async function mergeBoxes(ctx: AuthContext, input: { containerIds: string[]; idempotencyKey: string }) {
  ctx.require("inventory.container.create");
  const ids = [...new Set(input.containerIds)];
  if (ids.length < 2) throw new DomainError("validation", "Scan at least two boxes to merge.");
  const key = `box_merge:${input.idempotencyKey}`;
  const body = { containerIds: [...ids].sort() };
  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<{ id: string; containerNumber: string }>(tx, ctx.organizationId, key, "inventory.container.merge", body);
    if (claimed) return { ...claimed.replay, replayed: true };
    const boxes = await lockContainers(tx, ctx, ids);
    boxes.forEach(assertMovable);
    if (new Set(boxes.map((b) => b.siteId)).size > 1 || new Set(boxes.map((b) => b.currentLocationId)).size > 1) {
      throw new DomainError("validation", "Boxes can only be merged at the same location. Move them together first.");
    }
    const all = (await Promise.all(boxes.map(async (b) => (await contentsOf(tx, b.id)).map((c) => ({ ...c, box: b }))))).flat();
    if (all.length === 0) throw new DomainError("state", "These boxes are empty.");
    const lots = await lockLots(tx, all.map((c) => c.lotId));
    const first = lots[0];
    if (lots.some((l) => !sameItem(l, first))) throw new DomainError("validation", "V-MAT: only boxes of the same item can be merged.", { rule: "V-MAT" });
    const effective = (l: (typeof lots)[number]) => (l.qualityStatus === "released" && isPastExpiry(l.expiresOn) ? "expired" : l.qualityStatus);
    const statuses = new Set(lots.map(effective));
    if (statuses.size > 1) {
      throw new DomainError("conflict", `Boxes with different quality statuses cannot be merged (${[...statuses].join(" and ").replace(/_/g, " ")}).`, { rule: "container.lineage.merge_status_mismatch" });
    }
    const allowMixed = await getInventorySetting(tx, ctx.organizationId, boxes[0].siteId, "inventory.container.allow_mixed_lots");
    if (lots.length > 1 && !allowMixed) throw new DomainError("conflict", "These boxes hold different lots; mixed-lot boxes are not allowed (A-PROC-22).", { rule: "mixed_lots" });
    const target = await newBox(tx, ctx, { siteId: boxes[0].siteId, locationId: boxes[0].currentLocationId, kind: boxes[0].containerKind });
    const operationId = randomUUID();
    for (const c of all) {
      const lot = lots.find((l) => l.id === c.lotId)!;
      const qty = new Decimal(c.qtyBase);
      await addContent(tx, target, lot.id, lot.baseUom, qty);
      await takeContent(tx, c.box.id, lot.id, qty);
      await tx.insert(containerLineage).values({
        organizationId: ctx.organizationId,
        siteId: target.siteId,
        operation: "merge",
        operationId,
        parentContainerId: c.box.id,
        childContainerId: target.id,
        lotId: lot.id,
        qtyBase: qty.toString(),
        performedBy: ctx.userId,
      });
    }
    for (const b of boxes) await emptyIfDrained(tx, b);
    await audit(tx, ctx, {
      action: "inventory.container.merged",
      entityType: "container",
      entityId: target.id,
      entityNumber: target.containerNumber,
      siteId: target.siteId,
      after: { parents: boxes.map((b) => b.containerNumber), lots: lots.map((l) => l.lotNumber), operationId },
    });
    const result = { id: target.id, containerNumber: target.containerNumber };
    await storeIdempotentResult(tx, ctx.organizationId, key, body, result);
    return { ...result, replayed: false };
  });
}

export type RepackInput = { fromContainerId: string; toContainerId?: string | null; lotId?: string; qty: string; reason: string; idempotencyKey: string };

/**
 * W02-06 repack: moves a quantity from one box into another box at the same location (or into a
 * new box), recording packing date and packer on the target and a `repack` lineage edge, so a
 * repack is traceable from the original to the final box.
 */
export async function repackBox(ctx: AuthContext, input: RepackInput) {
  ctx.require("inventory.container.edit");
  if (!input.reason?.trim() || input.reason.trim().length < 3) throw new DomainError("validation", "Say why the box is repacked (at least 3 characters).");
  const qty = parseQty(input.qty);
  const key = `box_repack:${input.idempotencyKey}`;
  const body = { ...input, idempotencyKey: undefined };
  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<{ id: string; containerNumber: string }>(tx, ctx.organizationId, key, "inventory.container.repack", body);
    if (claimed) return { ...claimed.replay, replayed: true };
    if (input.toContainerId && input.toContainerId === input.fromContainerId) throw new DomainError("validation", "Choose a different box to repack into.");
    const locked = await lockContainers(tx, ctx, [input.fromContainerId, ...(input.toContainerId ? [input.toContainerId] : [])]);
    const source = locked.find((b) => b.id === input.fromContainerId)!;
    assertMovable(source);
    const contents = await contentsOf(tx, source.id);
    const lotId = input.lotId ?? (contents.length === 1 ? contents[0].lotId : "");
    const content = contents.find((c) => c.lotId === lotId);
    if (!content) throw new DomainError("validation", contents.length > 1 ? "Choose which lot to repack." : `Box ${source.containerNumber} is empty.`);
    if (new Decimal(content.qtyBase).lt(qty)) throw new DomainError("validation", `Box ${source.containerNumber} holds only ${new Decimal(content.qtyBase).toString()} ${content.baseUom} of this lot.`);
    const [lot] = await lockLots(tx, [lotId]);
    if (lot.baseUom === "pcs" && !qty.isInteger()) throw new DomainError("validation", "This lot is counted in pieces; enter a whole number.");
    let target = input.toContainerId ? locked.find((b) => b.id === input.toContainerId)! : null;
    if (target) {
      if (target.siteId !== source.siteId || target.currentLocationId !== source.currentLocationId) throw new DomainError("validation", "Both boxes must be at the same location to repack.");
      if (!["open", "empty"].includes(target.status)) throw new DomainError("state", `Box ${target.containerNumber} is ${target.status}; open it before repacking into it.`);
      const targetContents = await contentsOf(tx, target.id);
      if (targetContents.length) {
        const targetLots = await tx.select().from(inventoryLots).where(inArray(inventoryLots.id, targetContents.map((c) => c.lotId)));
        if (targetLots.some((l) => !sameItem(l, lot))) throw new DomainError("validation", "V-MAT: the target box holds a different item.", { rule: "V-MAT" });
        if (targetLots.some((l) => l.qualityStatus !== lot.qualityStatus)) throw new DomainError("conflict", "The target box holds stock with a different quality status.", { rule: "container.lineage.merge_status_mismatch" });
        const allowMixed = await getInventorySetting(tx, ctx.organizationId, source.siteId, "inventory.container.allow_mixed_lots");
        if (!allowMixed && targetLots.some((l) => l.id !== lot.id)) throw new DomainError("conflict", "The target box holds a different lot; mixed-lot boxes are not allowed (A-PROC-22).");
      }
      if (target.status === "empty") await tx.update(containers).set({ status: "open" }).where(eq(containers.id, target.id));
      await tx.update(containers).set({ packedAt: new Date(), packedBy: ctx.userId, updatedAt: new Date() }).where(eq(containers.id, target.id));
    } else {
      target = await newBox(tx, ctx, { siteId: source.siteId, locationId: source.currentLocationId, kind: source.containerKind });
    }
    await addContent(tx, target, lot.id, lot.baseUom, qty);
    await takeContent(tx, source.id, lot.id, qty);
    await tx.insert(containerLineage).values({
      organizationId: ctx.organizationId,
      siteId: source.siteId,
      operation: "repack",
      operationId: randomUUID(),
      parentContainerId: source.id,
      childContainerId: target.id,
      lotId: lot.id,
      qtyBase: qty.toString(),
      reason: input.reason.trim(),
      performedBy: ctx.userId,
    });
    await emptyIfDrained(tx, source);
    await audit(tx, ctx, {
      action: "inventory.container.repacked",
      entityType: "container",
      entityId: target.id,
      entityNumber: target.containerNumber,
      siteId: source.siteId,
      reason: input.reason.trim(),
      after: { from: source.containerNumber, to: target.containerNumber, lotNumber: lot.lotNumber, qtyBase: qty.toString() },
    });
    const result = { id: target.id, containerNumber: target.containerNumber };
    await storeIdempotentResult(tx, ctx.organizationId, key, body, result);
    return { ...result, replayed: false };
  });
}

/** Seal, reopen or void an (empty) box through the container state machine. */
export async function setBoxStatus(ctx: AuthContext, containerId: string, to: "sealed" | "open" | "void", reason?: string) {
  ctx.require("inventory.container.edit");
  return db.transaction(async (tx) => {
    const [box] = await lockContainers(tx, ctx, [containerId]);
    containerMachine.assert(box.status, to, `Box ${box.containerNumber}`);
    if (to === "void" && (await contentsOf(tx, box.id)).length) throw new DomainError("state", "Only an empty box can be voided.");
    await tx.update(containers).set({ status: to, updatedAt: new Date() }).where(eq(containers.id, box.id));
    await audit(tx, ctx, {
      action: `inventory.container.${to === "sealed" ? "sealed" : to === "open" ? "reopened" : "voided"}`,
      entityType: "container",
      entityId: box.id,
      entityNumber: box.containerNumber,
      siteId: box.siteId,
      reason: reason?.trim() || null,
      before: { status: box.status },
      after: { status: to },
    });
  });
}

/** Lineage both ways: every ancestor and descendant edge reachable from the box (recursive). */
export async function containerLineageGraph(q: Tx | typeof db, containerId: string) {
  const rows = await q.execute<{
    id: string;
    operation: string;
    parent_id: string;
    parent_number: string;
    child_id: string;
    child_number: string;
    lot_number: string;
    qty_base: string;
    performed_at: Date;
    direction: string;
  }>(sql`
    with recursive up(id) as (
      select ${containerId}::uuid
      union
      select l.parent_container_id from ${containerLineage} l join up on l.child_container_id = up.id
    ), down(id) as (
      select ${containerId}::uuid
      union
      select l.child_container_id from ${containerLineage} l join down on l.parent_container_id = down.id
    )
    select l.id, l.operation, l.parent_container_id as parent_id, p.container_number as parent_number,
           l.child_container_id as child_id, c.container_number as child_number, lot.lot_number, l.qty_base::text as qty_base,
           l.performed_at, case when l.child_container_id in (select id from up) then 'ancestor' else 'descendant' end as direction
    from ${containerLineage} l
    join ${containers} p on p.id = l.parent_container_id
    join ${containers} c on c.id = l.child_container_id
    join ${inventoryLots} lot on lot.id = l.lot_id
    where l.child_container_id in (select id from up) or l.parent_container_id in (select id from down)
    order by l.performed_at, l.id`);
  return [...rows];
}

/** Box detail within the user's sites (not found otherwise, no existence leak). */
export async function getContainer(ctx: AuthContext, containerId: string) {
  ctx.require("inventory.container.view");
  if (!isUuid(containerId)) throw new DomainError("not_found", "Box not found in your sites.");
  const [box] = await db
    .select({ box: containers, locationCode: locations.code, locationName: locations.name, locationKind: locations.kind, packedByName: users.displayName })
    .from(containers)
    .leftJoin(locations, eq(locations.id, containers.currentLocationId))
    .leftJoin(users, eq(users.id, containers.packedBy))
    .where(and(eq(containers.id, containerId), eq(containers.organizationId, ctx.organizationId), inArray(containers.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!box) throw new DomainError("not_found", "Box not found in your sites.");
  ctx.requireSite(box.box.siteId);
  const contents = await db
    .select({
      lotId: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      qualityStatus: inventoryLots.qualityStatus,
      expiresOn: inventoryLots.expiresOn,
      itemCode: sql<string>`coalesce(${materials.code}, ${products.skuCode})`,
      itemName: sql<string>`coalesce(${materials.name}, ${products.name})`,
      qtyBase: containerContents.qtyBase,
      baseUom: containerContents.baseUom,
      balanceAtLocation: sql<string>`coalesce((select b.qty_base from ${inventoryBalances} b where b.lot_id = ${inventoryLots.id} and b.location_id = ${box.box.currentLocationId ?? sql`null`}), 0)::text`,
    })
    .from(containerContents)
    .innerJoin(inventoryLots, eq(inventoryLots.id, containerContents.lotId))
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .where(and(eq(containerContents.containerId, containerId), gt(containerContents.qtyBase, "0")))
    .orderBy(asc(inventoryLots.lotNumber));
  const lineage = await containerLineageGraph(db, containerId);
  const movements = await db
    .select({ id: stockMovements.id, type: stockMovements.movementType, qtyBase: stockMovements.qtyBase, baseUom: stockMovements.baseUom, number: stockMovements.sourceDocumentNumber, postedAt: stockMovements.postedAt, by: users.displayName, meta: stockMovements.meta })
    .from(stockMovements)
    .innerJoin(users, eq(users.id, stockMovements.postedBy))
    .where(sql`${stockMovements.meta}->>'containerId' = ${containerId}`)
    .orderBy(desc(stockMovements.postedAt))
    .limit(100);
  const frozenBy = box.box.currentLocationId ? await activeCountsForLocations(db, [box.box.currentLocationId]) : [];
  const detail = {
    ...box.box,
    locationCode: box.locationCode,
    locationName: box.locationName,
    locationKind: box.locationKind,
    packedByName: box.packedByName,
    contents,
    lineage,
    movements,
    frozenBy: frozenBy[0]?.countNumber ?? null,
    /** Box content above the ledger balance at its location (stock left by another flow): needs a count. */
    mismatch: contents.some((c) => new Decimal(c.qtyBase).gt(c.balanceAtLocation)),
  };
  return { ...detail, allowedActions: boxAllowedActions(ctx, detail) };
}

export type ContainerDetail = Awaited<ReturnType<typeof getContainer>>;

export type AllowedAction = { key: string; label: string; href: string; allowed: boolean; reason?: string };

/**
 * Server-decided actions for a box card (W02-02): only what the role may do in this status, with
 * the reason for anything not allowed. Used by the box page and exposed for the scan card (W1E).
 */
export function boxAllowedActions(
  ctx: AuthContext,
  box: { id: string; status: string; contents: { qualityStatus: string; expiresOn: string | null }[]; frozenBy: string | null; locationKind: string | null },
): AllowedAction[] {
  const out: AllowedAction[] = [];
  const movable = (MOVABLE_BOX_STATUSES as readonly string[]).includes(box.status);
  const empty = box.contents.length === 0;
  const frozen = box.frozenBy ? `Its location is frozen by count ${box.frozenBy}.` : undefined;
  const why = !movable ? `The box is ${box.status}.` : empty ? "The box is empty." : frozen;
  if (ctx.can("inventory.movement.post")) {
    const kinds = [...new Set(box.contents.flatMap((c) => allowedDestinationKinds(c.qualityStatus, c.expiresOn)))];
    const label = kinds.length === 0 || kinds.includes("storage") ? "Move box" : `Move box (only to ${kinds.join(" / ")})`;
    out.push({ key: "move", label, href: `/inventory/move?box=${box.id}`, allowed: !why, reason: why });
  }
  if (ctx.can("inventory.container.create")) {
    out.push({ key: "split", label: "Split", href: `/inventory/containers/${box.id}?op=split`, allowed: !why, reason: why });
    out.push({ key: "merge", label: "Merge with…", href: `/inventory/containers/${box.id}?op=merge`, allowed: !why, reason: why });
  }
  if (ctx.can("inventory.container.edit")) {
    out.push({ key: "repack", label: "Repack", href: `/inventory/containers/${box.id}?op=repack`, allowed: !why, reason: why });
    if (box.status === "open" && !empty) out.push({ key: "seal", label: "Seal box", href: `/inventory/containers/${box.id}?op=seal`, allowed: true });
    if (box.status === "sealed") out.push({ key: "reopen", label: "Reopen box", href: `/inventory/containers/${box.id}?op=reopen`, allowed: true });
  }
  if (ctx.can("inventory.label_job.create")) out.push({ key: "label", label: "Print box label", href: `/print/box-label/${box.id}`, allowed: box.status !== "void", reason: box.status === "void" ? "The box is void." : undefined });
  return out;
}

/** Finds a box by its number in the user's sites (scan BC:BOX:<number>); null when not found. */
export async function findContainerByNumber(ctx: AuthContext, raw: string) {
  ctx.require("inventory.container.view");
  const number = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().toUpperCase().replace(/^BC:BOX:/, "");
  if (!number) return null;
  const [row] = await db
    .select({ id: containers.id, siteId: containers.siteId })
    .from(containers)
    .where(and(eq(containers.organizationId, ctx.organizationId), eq(containers.containerNumber, number), inArray(containers.siteId, ctx.allowedSiteIds)))
    .limit(1);
  return row ?? null;
}

export type ContainerFilter = { q?: string; status?: string; locationId?: string; includeEmpty?: boolean };

/** Boxes of the current site with their contents summary. */
export async function listContainers(ctx: AuthContext, f: ContainerFilter = {}) {
  ctx.require("inventory.container.view");
  ctx.requireSite(ctx.currentSiteId);
  const conds: SQL[] = [eq(containers.siteId, ctx.currentSiteId)];
  if (f.status) conds.push(eq(containers.status, f.status));
  else if (!f.includeEmpty) conds.push(inArray(containers.status, ["open", "sealed", "in_transit"]));
  if (f.locationId && isUuid(f.locationId)) conds.push(eq(containers.currentLocationId, f.locationId));
  const q = f.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
    conds.push(
      or(
        ilike(containers.containerNumber, like),
        sql`exists (select 1 from ${containerContents} cc join ${inventoryLots} l on l.id = cc.lot_id where cc.container_id = ${containers.id} and l.lot_number ilike ${like})`,
      )!,
    );
  }
  return db
    .select({
      id: containers.id,
      containerNumber: containers.containerNumber,
      containerKind: containers.containerKind,
      status: containers.status,
      locationCode: locations.code,
      packedAt: containers.packedAt,
      contents: sql<string | null>`(select string_agg(l.lot_number || ' · ' || trim(to_char(cc.qty_base, 'FM999999999990.######')) || ' ' || cc.base_uom, ', ' order by l.lot_number)
        from ${containerContents} cc join ${inventoryLots} l on l.id = cc.lot_id where cc.container_id = ${containers.id} and cc.qty_base > 0)`,
      qualityStatuses: sql<string | null>`(select string_agg(distinct l.quality_status, ',') from ${containerContents} cc join ${inventoryLots} l on l.id = cc.lot_id where cc.container_id = ${containers.id} and cc.qty_base > 0)`,
    })
    .from(containers)
    .leftJoin(locations, eq(locations.id, containers.currentLocationId))
    .where(and(...conds))
    .orderBy(desc(containers.createdAt))
    .limit(300);
}

/** Open boxes at a location (merge/repack target pickers, location card). */
export async function boxesAtLocation(ctx: AuthContext, locationId: string) {
  ctx.require("inventory.container.view");
  return listContainers(ctx, { locationId });
}

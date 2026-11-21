import "server-only";
import { and, asc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  approvalDecisions,
  containerContents,
  containers,
  customers,
  inventoryBalances,
  inventoryLots,
  locations,
  products,
  salesOrderLines,
  salesOrders,
  stockAllocations,
  stockMovements,
  stockReservations,
  stockTakeoutLines,
  stockTakeouts,
  users,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { getSetting } from "@/lib/settings";
import { type ApprovalVerdict, canDecideEvaluatedStep, evaluateApprovalRules, evaluateApprovalRulesAudited, notifyNextActors, rolesAllowedNow, stepVerdict } from "@/modules/governance";
import { claimIdempotencyKey, stateMachine, storeIdempotentResult } from "./command-kit";
import { addContent, containerMachine, contentsOf, emptyIfDrained, takeContent } from "./containers";
import { assertLotUsable, lockLots, postMovement } from "./ledger";
import { isUuid } from "./lots";
import { looseQty } from "./moves";
import { OPEN_ALLOCATION_ORDER_STATUSES, reservedByLotLocation } from "./reservations";
import { type Channel, isPurpose, limitReason, movementReason, orderSources, parsePieces, purposeSentence, TAKEOUT_TRANSITIONS, type TakeoutPurpose, type TakeoutStatus, undoRefusal } from "./takeout-rules";

/**
 * ADR-138 "Take a few out" (owner 2026-11-21): a quick stock-out of finished pieces for an online order, a sample, a
 * giveaway, the display shelf or staff use. Every rule is here (screens and routes are thin adapters):
 *
 * - Only released, in-date finished-goods lots in an active STORAGE place of the current site; never a box or stock
 *   set aside for a customer order (open allocation of an open order) or held by an active reservation; never more
 *   than the free stock (on hand − set aside − reserved) at that place.
 * - A box: the pieces come out of it; a sealed box is opened (container state machine sealed → open) and marked
 *   partial; an emptied box becomes empty. Loose pieces: never more than the loose pieces at the place.
 * - Posting = one `issue` movement per line through `postMovement`, in ONE transaction that locks the boxes, then the
 *   lots (id order), then the numbering row, and is keyed by the client's idempotency key (a double tap or an offline
 *   retry returns the first result).
 * - Above the limits (settings `inventory.takeout.max_pieces_per_line`, `.max_pieces_per_person_day`) the entry waits
 *   for an OK through the approval rules (`stock_takeout`); nothing moves until then.
 * - Posted entries are never edited: "Undo" posts reversal movements (same person the same day, or `.void` any time).
 */

export const takeoutMachine = stateMachine<TakeoutStatus>("stock_takeout", TAKEOUT_TRANSITIONS, {
  awaiting_approval: "waiting for an OK",
  posted: "taken out",
  rejected: "not approved",
  cancelled: "cancelled",
  reversed: "undone",
});

export type TakeoutLineInput = {
  /** A box (scanned or tapped): its lot is used (or `lotId` when the box holds several lots). */
  containerId?: string | null;
  /** Loose pieces of a lot at a place (with `locationId`), or the lot inside a mixed box. */
  lotId?: string | null;
  locationId?: string | null;
  /** Only the product: the app chooses where (shop shelf, open box or loose first, then earliest expiry). */
  productId?: string | null;
  pieces: string;
};

export type CreateTakeoutInput = {
  purpose: string;
  channel?: string | null;
  platformOrderRef?: string | null;
  customerId?: string | null;
  recipientName?: string | null;
  note?: string | null;
  lines: TakeoutLineInput[];
  idempotencyKey: string;
};

export type TakeoutResultLine = { lineNo: number; productName: string; lotNumber: string; pieces: string; uom: string; placeCode: string; boxNumber: string | null; openedBox: boolean };
export type TakeoutResult = {
  id: string;
  takeoutNumber: string;
  status: "posted" | "awaiting_approval";
  approvalReason: string | null;
  sentence: string;
  lines: TakeoutResultLine[];
  replayed: boolean;
};

const MAX_LINES = 30;

/** The configured online shops (setting `inventory.takeout.channels`). */
export async function takeoutChannels(q: DbOrTx, organizationId: string): Promise<Channel[]> {
  return getSetting(q, organizationId, "inventory.takeout.channels");
}

/** Pieces set aside for open customer orders plus active reservations, at one lot and place. */
async function heldAt(q: DbOrTx, siteId: string, lotId: string, locationId: string): Promise<Decimal> {
  const [a] = await q
    .select({ qty: sql<string>`coalesce(sum(${stockAllocations.qtyUnits}), 0)::text` })
    .from(stockAllocations)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, stockAllocations.salesOrderLineId))
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
    .where(and(eq(stockAllocations.lotId, lotId), eq(stockAllocations.locationId, locationId), eq(stockAllocations.status, "open"), inArray(salesOrders.status, OPEN_ALLOCATION_ORDER_STATUSES)));
  const r = (await reservedByLotLocation(q, siteId, { lotIds: [lotId] })).get(`${lotId}|${locationId}`) ?? new Decimal(0);
  return new Decimal(a?.qty ?? 0).plus(r);
}

/** A box set aside for an order (open allocation of an open order) or held by an active reservation. */
async function boxHeldFor(q: DbOrTx, containerId: string): Promise<string | null> {
  const [a] = await q
    .select({ number: salesOrders.orderNumber })
    .from(stockAllocations)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, stockAllocations.salesOrderLineId))
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
    .where(and(eq(stockAllocations.containerId, containerId), eq(stockAllocations.status, "open"), inArray(salesOrders.status, OPEN_ALLOCATION_ORDER_STATUSES)))
    .limit(1);
  if (a) return `customer order ${a.number}`;
  const [r] = await q
    .select({ ref: stockReservations.demandReference })
    .from(stockReservations)
    .where(and(eq(stockReservations.containerId, containerId), eq(stockReservations.status, "active"), sql`(${stockReservations.expiresAt} is null or ${stockReservations.expiresAt} > now())`))
    .limit(1);
  return r ? r.ref : null;
}

type Lot = typeof inventoryLots.$inferSelect;
type Loc = typeof locations.$inferSelect;
type Box = typeof containers.$inferSelect;
type Resolved = { lot: Lot; loc: Loc; box: Box | null; productId: string; productName: string; pieces: Decimal };

/** The words of a place that never gives pieces (shipping bay, QA cage…). */
function placeRefusal(loc: Loc): string | null {
  if (!loc.isActive || loc.status !== "active") return `${loc.name} (${loc.code}) is not in use. Take the pieces from a shelf that is.`;
  if (loc.kind !== "storage") {
    const words: Record<string, string> = { shipping: "the sending-out bay (stock there is for a customer order)", quarantine: "the QA waiting area", hold: "the stopped-by-QA cage", rejected: "the rejected goods cage", recall: "the recall cage", production: "the production room", receiving: "the receiving dock", staging: "a staging area" };
    return `${loc.code} is ${words[loc.kind] ?? loc.kind}. Take pieces only from a finished goods shelf.`;
  }
  return null;
}

/**
 * Checks one concrete source (box or loose lot at a place) in the caller's transaction. Lots and boxes must already be
 * locked by the caller. `already` = pieces of the same source taken by earlier lines of this entry.
 */
async function checkSource(tx: Tx, ctx: AuthContext, siteId: string, src: { lot: Lot; loc: Loc; box: Box | null }, pieces: Decimal, already: Decimal, where: string): Promise<void> {
  const { lot, loc, box } = src;
  if (lot.siteId !== siteId || loc.siteId !== siteId) throw new DomainError("not_found", `${where}: not found at ${ctx.currentSite.name}.`);
  if (lot.itemKind !== "product" || !lot.productId) throw new DomainError("validation", `${where}: lot ${lot.lotNumber} is not a finished product. Take a few out is for finished goods only.`, { rule: "TAKEOUT-FG" });
  try {
    assertLotUsable(lot);
  } catch (e) {
    if (e instanceof DomainError) throw new DomainError("blocked_lot", `${where}: ${e.message}`, { lotId: lot.id, rule: "TAKEOUT-USABLE" });
    throw e;
  }
  const place = placeRefusal(loc);
  if (place) throw new DomainError("validation", `${where}: ${place}`, { rule: "TAKEOUT-PLACE" });
  const want = pieces.plus(already);
  if (box) {
    if (box.siteId !== siteId) throw new DomainError("not_found", `${where}: box not found at ${ctx.currentSite.name}.`);
    if (!["open", "sealed"].includes(box.status)) throw new DomainError("state", `${where}: box ${box.containerNumber} is ${({ empty: "empty", void: "cancelled", shipped: "sent out", in_transit: "on the way" } as Record<string, string>)[box.status] ?? box.status}.`);
    if (box.currentLocationId !== loc.id) throw new DomainError("validation", `${where}: box ${box.containerNumber} is not at ${loc.code}.`);
    const held = await boxHeldFor(tx, box.id);
    if (held) throw new DomainError("conflict", `${where}: box ${box.containerNumber} is set aside for ${held}. Take the pieces from another box.`, { rule: "TAKEOUT-SET-ASIDE" });
    const [c] = await tx.select().from(containerContents).where(and(eq(containerContents.containerId, box.id), eq(containerContents.lotId, lot.id)));
    const inBox = new Decimal(c?.qtyBase ?? 0);
    if (inBox.lt(want)) throw new DomainError("insufficient_stock", `${where}: box ${box.containerNumber} has only ${inBox.toString()} ${lot.baseUom} of lot ${lot.lotNumber}.`, { onHand: inBox.toString(), requested: want.toString() });
  } else {
    const loose = await looseQty(tx, lot.id, loc.id);
    if (loose.lt(want)) {
      throw new DomainError("insufficient_stock", `${where}: only ${loose.toString()} ${lot.baseUom} of lot ${lot.lotNumber} are loose at ${loc.code}${loose.isZero() ? "; the rest is in boxes. Scan the box you take them from" : ""}.`, { onHand: loose.toString(), requested: want.toString() });
    }
  }
  const [bal] = await tx.select({ qty: inventoryBalances.qtyBase }).from(inventoryBalances).where(and(eq(inventoryBalances.lotId, lot.id), eq(inventoryBalances.locationId, loc.id)));
  const free = new Decimal(bal?.qty ?? 0).minus(await heldAt(tx, siteId, lot.id, loc.id));
  if (free.lt(want)) throw new DomainError("conflict", `${where}: only ${Decimal.max(free, 0).toString()} ${lot.baseUom} of lot ${lot.lotNumber} at ${loc.code} are free; the rest is set aside for customer orders.`, { rule: "TAKEOUT-SET-ASIDE", free: free.toString() });
}

type Candidate = { lotId: string; lotNumber: string; expiresOn: string | null; locationId: string; locationCode: string; locationName: string; shopShelf: boolean; containerId: string | null; boxNumber: string | null; boxStatus: string | null; free: string };

/**
 * Where pieces of a product can be taken from at the current site, in the order to use them (`orderSources`): free
 * pieces per box and per loose lot at each usable place. Read model; the posting re-checks every source.
 */
export async function takeoutCandidates(q: DbOrTx, ctx: AuthContext, productId: string): Promise<Candidate[]> {
  const siteId = ctx.currentSiteId;
  const rows = await q
    .select({ lot: inventoryLots, loc: locations, onHand: inventoryBalances.qtyBase })
    .from(inventoryBalances)
    .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .where(and(eq(inventoryLots.siteId, siteId), eq(inventoryLots.productId, productId), eq(inventoryLots.qualityStatus, "released"), eq(locations.kind, "storage"), eq(locations.isActive, true), eq(locations.status, "active"), gt(inventoryBalances.qtyBase, "0")));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const out: Candidate[] = [];
  for (const r of rows) {
    if (r.lot.expiresOn && r.lot.expiresOn < today) continue;
    const held = await heldAt(q, siteId, r.lot.id, r.loc.id);
    let free = Decimal.max(new Decimal(r.onHand).minus(held), 0);
    const boxes = await q
      .select({ id: containers.id, number: containers.containerNumber, status: containers.status, qty: containerContents.qtyBase })
      .from(containerContents)
      .innerJoin(containers, eq(containers.id, containerContents.containerId))
      .where(and(eq(containerContents.lotId, r.lot.id), eq(containers.currentLocationId, r.loc.id), inArray(containers.status, ["open", "sealed"]), gt(containerContents.qtyBase, "0")))
      .orderBy(asc(containers.containerNumber));
    let boxed = new Decimal(0);
    const base = { lotId: r.lot.id, lotNumber: r.lot.lotNumber, expiresOn: r.lot.expiresOn, locationId: r.loc.id, locationCode: r.loc.code, locationName: r.loc.name, shopShelf: r.loc.takeoutShelf };
    const boxRows: Candidate[] = [];
    for (const b of boxes) {
      boxed = boxed.plus(b.qty);
      if (await boxHeldFor(q, b.id)) continue;
      boxRows.push({ ...base, containerId: b.id, boxNumber: b.number, boxStatus: b.status, free: b.qty });
    }
    const loose = Decimal.max(new Decimal(r.onHand).minus(boxed), 0);
    const items: Candidate[] = [...(loose.gt(0) ? [{ ...base, containerId: null, boxNumber: null, boxStatus: null, free: loose.toString() }] : []), ...boxRows];
    // Never offer more than the free pieces at the place (set-asides without a box come off the loose pieces first).
    for (const it of orderSources(items.map((i) => ({ ...i })))) {
      const take = Decimal.min(it.free, free);
      if (take.lte(0)) continue;
      free = free.minus(take);
      out.push({ ...it, free: take.toString() });
    }
  }
  return orderSources(out);
}

async function lockBox(tx: Tx, ctx: AuthContext, id: string): Promise<Box> {
  if (!isUuid(id)) throw new DomainError("not_found", "Box not found in your sites.");
  const [b] = await tx.select().from(containers).where(eq(containers.id, id)).for("update").limit(1);
  if (!b || b.organizationId !== ctx.organizationId || !ctx.allowedSiteIds.includes(b.siteId)) throw new DomainError("not_found", "Box not found in your sites.");
  ctx.requireSite(b.siteId);
  return b;
}

type Planned = { lotId: string; locationId: string; containerId: string | null; pieces: Decimal };

/** Turns the input lines into concrete sources (a product-only line takes from the suggested places in order). */
async function planLines(tx: Tx, ctx: AuthContext, lines: TakeoutLineInput[]): Promise<Planned[]> {
  const out: Planned[] = [];
  let i = 0;
  for (const l of lines) {
    i++;
    const where = `Line ${i}`;
    const pieces = parsePieces(l.pieces);
    if (!pieces) throw new DomainError("validation", `${where}: enter how many pieces as a whole number above 0.`, { field: `lines.${i - 1}.pieces`, fieldErrors: { [`lines.${i - 1}.pieces`]: "Enter a whole number above 0." } });
    if (l.containerId) {
      const [b] = isUuid(l.containerId) ? await tx.select().from(containers).where(eq(containers.id, l.containerId)).limit(1) : [];
      if (!b || b.organizationId !== ctx.organizationId || b.siteId !== ctx.currentSiteId || !ctx.allowedSiteIds.includes(b.siteId)) throw new DomainError("not_found", `${where}: box not found at ${ctx.currentSite.name}.`);
      if (!b.currentLocationId) throw new DomainError("state", `${where}: box ${b.containerNumber} has no place.`);
      const contents = await contentsOf(tx, b.id);
      const lotId = l.lotId ?? (contents.length === 1 ? contents[0].lotId : null);
      if (!lotId) throw new DomainError("validation", contents.length ? `${where}: box ${b.containerNumber} holds several lots; choose the lot.` : `${where}: box ${b.containerNumber} is empty.`);
      out.push({ lotId, locationId: b.currentLocationId, containerId: b.id, pieces });
    } else if (l.lotId) {
      if (!isUuid(l.lotId) || !l.locationId || !isUuid(l.locationId)) throw new DomainError("validation", `${where}: choose the shelf the pieces come from.`);
      out.push({ lotId: l.lotId, locationId: l.locationId, containerId: null, pieces });
    } else if (l.productId) {
      if (!isUuid(l.productId)) throw new DomainError("not_found", `${where}: product not found.`);
      const [p] = await tx.select().from(products).where(and(eq(products.id, l.productId), eq(products.organizationId, ctx.organizationId))).limit(1);
      if (!p) throw new DomainError("not_found", `${where}: product not found.`);
      let left = pieces;
      // Pieces this entry already takes from the same sources.
      const used = (c: Candidate) => out.filter((o) => o.lotId === c.lotId && o.locationId === c.locationId && o.containerId === c.containerId).reduce((s, o) => s.plus(o.pieces), new Decimal(0));
      for (const c of await takeoutCandidates(tx, ctx, p.id)) {
        if (left.lte(0)) break;
        const take = Decimal.min(left, new Decimal(c.free).minus(used(c)));
        if (take.lte(0)) continue;
        out.push({ lotId: c.lotId, locationId: c.locationId, containerId: c.containerId, pieces: take });
        left = left.minus(take);
      }
      if (left.gt(0)) {
        const have = pieces.minus(left);
        throw new DomainError("insufficient_stock", `${where}: only ${have.toString()} free ${p.name} at ${ctx.currentSite.name} (released, in date, not set aside).`, { productId: p.id, free: have.toString(), requested: pieces.toString() });
      }
    } else throw new DomainError("validation", `${where}: scan a box or a lot, or choose the product.`);
  }
  return out;
}

/** Locks boxes then lots (id order) and checks every planned line; returns them resolved with names. */
async function lockAndCheck(tx: Tx, ctx: AuthContext, siteId: string, planned: Planned[]): Promise<Resolved[]> {
  const boxIds = [...new Set(planned.map((p) => p.containerId).filter((x): x is string => !!x))].sort();
  const boxes: Box[] = [];
  for (const id of boxIds) boxes.push(await lockBox(tx, ctx, id));
  const lots = await lockLots(tx, planned.map((p) => p.lotId));
  const locIds = [...new Set(planned.map((p) => p.locationId))];
  const locs = locIds.length ? await tx.select().from(locations).where(inArray(locations.id, locIds)) : [];
  const out: Resolved[] = [];
  let i = 0;
  for (const p of planned) {
    i++;
    const lot = lots.find((l) => l.id === p.lotId);
    if (!lot || lot.organizationId !== ctx.organizationId || !ctx.allowedSiteIds.includes(lot.siteId)) throw new DomainError("not_found", `Line ${i}: lot not found in your sites.`);
    ctx.requireSite(lot.siteId);
    const loc = locs.find((l) => l.id === p.locationId);
    if (!loc) throw new DomainError("not_found", `Line ${i}: shelf not found.`);
    const box = p.containerId ? (boxes.find((b) => b.id === p.containerId) ?? null) : null;
    const already = out.filter((o) => o.lot.id === lot.id && o.loc.id === loc.id && (o.box?.id ?? null) === p.containerId).reduce((s, o) => s.plus(o.pieces), new Decimal(0));
    await checkSource(tx, ctx, siteId, { lot, loc, box }, p.pieces, already, `Line ${i}`);
    const [prod] = await tx.select({ id: products.id, name: products.name }).from(products).where(eq(products.id, lot.productId!)).limit(1);
    out.push({ lot, loc, box, productId: prod.id, productName: prod.name, pieces: p.pieces });
  }
  // Whole-place free check over all lines (several lines on one lot and place).
  const byPlace = new Map<string, { lot: Lot; loc: Loc; total: Decimal }>();
  for (const r of out) {
    const k = `${r.lot.id}|${r.loc.id}`;
    const cur = byPlace.get(k) ?? { lot: r.lot, loc: r.loc, total: new Decimal(0) };
    cur.total = cur.total.plus(r.pieces);
    byPlace.set(k, cur);
  }
  for (const { lot, loc, total } of byPlace.values()) {
    const [bal] = await tx.select({ qty: inventoryBalances.qtyBase }).from(inventoryBalances).where(and(eq(inventoryBalances.lotId, lot.id), eq(inventoryBalances.locationId, loc.id)));
    const free = new Decimal(bal?.qty ?? 0).minus(await heldAt(tx, siteId, lot.id, loc.id));
    if (free.lt(total)) throw new DomainError("conflict", `Only ${Decimal.max(free, 0).toString()} ${lot.baseUom} of lot ${lot.lotNumber} at ${loc.code} are free; the rest is set aside for customer orders.`, { rule: "TAKEOUT-SET-ASIDE" });
  }
  return out;
}

/** Posts the issue movements of the resolved lines (box opened, contents taken, emptied box marked empty). */
async function postLines(tx: Tx, ctx: AuthContext, t: { id: string; takeoutNumber: string; sentence: string }, rows: { lineId: string; lineNo: number; r: Resolved }[], key: string, correlationId: string) {
  const out: TakeoutResultLine[] = [];
  for (const { lineId, lineNo, r } of rows) {
    let opened = false;
    if (r.box) {
      const [box] = await tx.select().from(containers).where(eq(containers.id, r.box.id)).limit(1);
      if (box.status === "sealed") {
        containerMachine.assert(box.status, "open", `Box ${box.containerNumber}`);
        opened = true;
        await audit(tx, ctx, {
          action: "inventory.container.reopened",
          entityType: "container",
          entityId: box.id,
          entityNumber: box.containerNumber,
          siteId: box.siteId,
          reason: `Opened to take pieces out (${t.takeoutNumber})`,
          before: { status: "sealed" },
          after: { status: "open", isPartial: true, takeout: t.takeoutNumber },
        });
      }
      await tx.update(containers).set({ status: "open", isPartial: true, updatedAt: new Date() }).where(eq(containers.id, box.id));
      await takeContent(tx, box.id, r.lot.id, r.pieces);
    }
    const { movement } = await postMovement(tx, ctx, {
      movementType: "issue",
      lotId: r.lot.id,
      fromLocationId: r.loc.id,
      qtyBase: r.pieces,
      entered: { qty: r.pieces, uom: r.lot.baseUom },
      sourceDocumentType: "stock_takeout",
      sourceDocumentId: t.id,
      sourceDocumentNumber: t.takeoutNumber,
      reason: movementReason(t.takeoutNumber, t.sentence),
      idempotencyKey: `${key}:${lineNo}`,
      correlationId,
      meta: { containerId: r.box?.id ?? null, takeoutLine: lineNo, openedBox: opened },
    });
    if (r.box) {
      const [box] = await tx.select().from(containers).where(eq(containers.id, r.box.id)).limit(1);
      await emptyIfDrained(tx, box);
    }
    await tx.update(stockTakeoutLines).set({ stockMovementId: movement.id, openedBox: opened }).where(eq(stockTakeoutLines.id, lineId));
    out.push({ lineNo, productName: r.productName, lotNumber: r.lot.lotNumber, pieces: r.pieces.toString(), uom: r.lot.baseUom, placeCode: r.loc.code, boxNumber: r.box?.containerNumber ?? null, openedBox: opened });
  }
  return out;
}

/** Pieces the person took out today (posted or waiting), for the per-day limit. */
async function piecesTodayBy(q: DbOrTx, organizationId: string, userId: string): Promise<Decimal> {
  const [r] = await q
    .select({ n: sql<string>`coalesce(sum(${stockTakeouts.totalPieces}), 0)::text` })
    .from(stockTakeouts)
    .where(and(eq(stockTakeouts.organizationId, organizationId), eq(stockTakeouts.createdBy, userId), inArray(stockTakeouts.status, ["posted", "awaiting_approval"]), sql`(${stockTakeouts.createdAt} at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date`));
  return new Decimal(r?.n ?? 0);
}

type Header = { purpose: TakeoutPurpose; channel: string | null; platformOrderRef: string | null; customerId: string | null; customerName: string | null; recipientName: string | null; note: string | null };

async function parseHeader(q: DbOrTx, ctx: AuthContext, input: CreateTakeoutInput): Promise<Header> {
  if (!isPurpose(input.purpose)) throw new DomainError("validation", "Choose why the pieces are taken out.", { field: "purpose", fieldErrors: { purpose: "Choose a reason." } });
  const purpose = input.purpose;
  const note = input.note?.trim() || null;
  if (note && note.length > 500) throw new DomainError("validation", "Keep the note to 500 characters.", { field: "note" });
  if (purpose === "other" && (!note || note.length < 3)) throw new DomainError("validation", "Say what the pieces were taken out for.", { field: "note", fieldErrors: { note: "Write what happened (at least 3 letters)." } });
  let channel: string | null = null;
  let platformOrderRef: string | null = null;
  if (purpose === "sold_online") {
    const channels = await takeoutChannels(q, ctx.organizationId);
    channel = input.channel?.trim() || null;
    if (!channel) throw new DomainError("validation", "Choose the online shop.", { field: "channel", fieldErrors: { channel: "Choose the shop." } });
    if (!channels.some((c) => c.code === channel)) throw new DomainError("validation", "That online shop is not on the list. Choose one from the list.", { field: "channel", fieldErrors: { channel: "Choose a shop from the list." } });
    platformOrderRef = input.platformOrderRef?.trim().replace(/[\u0000-\u001f\u007f]/g, "") || null;
    if (platformOrderRef && platformOrderRef.length > 60) throw new DomainError("validation", "The order number is too long (60 characters at most).", { field: "platformOrderRef" });
  } else if (input.channel?.trim() || input.platformOrderRef?.trim()) {
    // A shop or order number only belongs to an online sale; ignore stale fields from the form.
  }
  let customerId: string | null = null;
  let customerName: string | null = null;
  let recipientName: string | null = null;
  if (purpose === "customer_sample") {
    if (input.customerId?.trim()) {
      if (!ctx.can("masterdata.customer.view")) throw new DomainError("forbidden", "You can't see customers; type the name instead.", { field: "customerId" });
      const [c] = isUuid(input.customerId) ? await q.select({ id: customers.id, name: customers.name }).from(customers).where(and(eq(customers.id, input.customerId), eq(customers.organizationId, ctx.organizationId))).limit(1) : [];
      if (!c) throw new DomainError("validation", "Customer not found. Choose from the list or type a name.", { field: "customerId" });
      customerId = c.id;
      customerName = c.name;
    } else {
      recipientName = input.recipientName?.trim() || null;
      if (recipientName && recipientName.length > 120) throw new DomainError("validation", "Keep the name to 120 characters.", { field: "recipientName" });
    }
  }
  return { purpose, channel, platformOrderRef, customerId, customerName, recipientName, note };
}

/**
 * Records a take-out at the current site. Under the limits it posts at once; above them it waits for an OK (nothing
 * moves). Idempotent on `idempotencyKey`. Permission `inventory.takeout.create`; site and every source checked here.
 */
export async function createTakeout(ctx: AuthContext, input: CreateTakeoutInput): Promise<TakeoutResult> {
  ctx.require("inventory.takeout.create");
  const siteId = ctx.currentSiteId;
  ctx.requireSite(siteId);
  if (!input.idempotencyKey?.trim()) throw new DomainError("validation", "The form is not ready yet. Wait a moment and try again.");
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new DomainError("validation", "Add at least one product.", { field: "lines" });
  if (input.lines.length > MAX_LINES) throw new DomainError("validation", `One entry takes at most ${MAX_LINES} lines.`, { field: "lines" });
  const key = `takeout_create:${input.idempotencyKey}`;
  const body = { ...input, idempotencyKey: undefined, siteId };
  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<Omit<TakeoutResult, "replayed">>(tx, ctx.organizationId, key, "inventory.takeout.create", body);
    if (claimed) return { ...claimed.replay, replayed: true };
    const h = await parseHeader(tx, ctx, input);
    const planned = await planLines(tx, ctx, input.lines);
    const resolved = await lockAndCheck(tx, ctx, siteId, planned);
    const total = resolved.reduce((s, r) => s.plus(r.pieces), new Decimal(0));
    const [maxLine, maxDay] = await Promise.all([getSetting(tx, ctx.organizationId, "inventory.takeout.max_pieces_per_line", siteId), getSetting(tx, ctx.organizationId, "inventory.takeout.max_pieces_per_person_day", siteId)]);
    // The line limit counts the pieces of one product in the entry (an auto split over several boxes is one product).
    const perProduct = new Map<string, Decimal>();
    for (const r of resolved) perProduct.set(r.productId, (perProduct.get(r.productId) ?? new Decimal(0)).plus(r.pieces));
    const why = limitReason({ lines: [...perProduct.values()], takenTodayByPerson: await piecesTodayBy(tx, ctx.organizationId, ctx.userId), maxPerLine: maxLine, maxPerPersonDay: maxDay });
    const channels = await takeoutChannels(tx, ctx.organizationId);
    const sentence = purposeSentence(h, channels);
    const number = await nextNumber(tx, ctx.organizationId, "TKO");
    const correlationId = randomUUID();
    const now = new Date();
    const status: "posted" | "awaiting_approval" = why ? "awaiting_approval" : "posted";
    const [t] = await tx
      .insert(stockTakeouts)
      .values({
        organizationId: ctx.organizationId,
        siteId,
        takeoutNumber: number,
        status,
        purpose: h.purpose,
        channel: h.channel,
        platformOrderRef: h.platformOrderRef,
        customerId: h.customerId,
        recipientName: h.recipientName,
        note: h.note,
        totalPieces: total.toString(),
        approvalReason: why,
        idempotencyKey: key,
        correlationId,
        createdBy: ctx.userId,
        postedBy: why ? null : ctx.userId,
        postedAt: why ? null : now,
      })
      .returning();
    const lineRows = await tx
      .insert(stockTakeoutLines)
      .values(resolved.map((r, i) => ({ organizationId: ctx.organizationId, siteId, takeoutId: t.id, lineNo: i + 1, productId: r.productId, lotId: r.lot.id, locationId: r.loc.id, containerId: r.box?.id ?? null, qtyBase: r.pieces.toString(), baseUom: r.lot.baseUom })))
      .returning();
    await audit(tx, ctx, {
      action: "inventory.stock_takeout.created",
      entityType: "stock_takeout",
      entityId: t.id,
      entityNumber: number,
      siteId,
      reason: sentence,
      correlationId,
      after: { status, purpose: h.purpose, channel: h.channel, platformOrderRef: h.platformOrderRef, customerId: h.customerId, recipientName: h.recipientName, pieces: total.toString(), lines: resolved.map((r) => ({ lot: r.lot.lotNumber, place: r.loc.code, box: r.box?.containerNumber ?? null, pieces: r.pieces.toString() })), approvalReason: why },
    });
    let lines: TakeoutResultLine[];
    if (why) {
      const ev = await evaluateApprovalRulesAudited(tx, ctx, { documentType: "stock_takeout", siteId, recordId: t.id, recordNumber: number, basis: { qty_base: total.toString() } });
      await audit(tx, ctx, { action: "inventory.stock_takeout.submitted", entityType: "stock_takeout", entityId: t.id, entityNumber: number, siteId, reason: why, after: { status, steps: ev.steps.length } });
      const first = ev.steps[0] ?? null;
      await notifyNextActors(tx, ctx, TAKEOUT_HANDOFF, { siteId, excludeUserIds: [ctx.userId], roleCodes: first ? rolesAllowedNow(first, now) : [], stepNo: 1, stepsTotal: Math.max(ev.steps.length, 1) }, {
        title: `Take-out ${number} waits for your OK`,
        body: `${ctx.displayName}: ${total.toString()} pieces, ${sentence}. ${why}`,
        link: `/inventory/take-outs/${t.id}`,
        entityType: "stock_takeout",
        entityId: t.id,
        dedupeKey: `handoff.stock_takeout:${t.id}`,
      });
      lines = resolved.map((r, i) => ({ lineNo: i + 1, productName: r.productName, lotNumber: r.lot.lotNumber, pieces: r.pieces.toString(), uom: r.lot.baseUom, placeCode: r.loc.code, boxNumber: r.box?.containerNumber ?? null, openedBox: false }));
    } else {
      lines = await postLines(tx, ctx, { id: t.id, takeoutNumber: number, sentence }, lineRows.map((l) => ({ lineId: l.id, lineNo: l.lineNo, r: resolved[l.lineNo - 1] })), key, correlationId);
      await audit(tx, ctx, { action: "inventory.stock_takeout.posted", entityType: "stock_takeout", entityId: t.id, entityNumber: number, siteId, reason: sentence, correlationId, after: { status: "posted", movements: lines.length } });
    }
    const result: Omit<TakeoutResult, "replayed"> = { id: t.id, takeoutNumber: number, status, approvalReason: why, sentence, lines };
    await storeIdempotentResult(tx, ctx.organizationId, key, body, result);
    return { ...result, replayed: false };
  });
}

/** Hand-off rule for "who gives the OK" (governance next-actors, ad hoc: no new HANDOFFS entry needed). */
export const TAKEOUT_HANDOFF = {
  kind: "stock_takeout",
  permission: "inventory.takeout.approve" as const,
  does: "gives the OK for this take-out",
  doBase: "give the OK for this take-out",
  where: "in To approve",
  fallback: "the site manager",
  operational: true,
  prefer: ["site_manager", "owner_director"],
};

async function lockTakeout(tx: Tx, ctx: AuthContext, id: string) {
  if (!isUuid(id)) throw new DomainError("not_found", "Take-out not found in your sites.");
  const [t] = await tx.select().from(stockTakeouts).where(eq(stockTakeouts.id, id)).for("update").limit(1);
  if (!t || t.organizationId !== ctx.organizationId || !ctx.allowedSiteIds.includes(t.siteId)) throw new DomainError("not_found", "Take-out not found in your sites.");
  ctx.requireSite(t.siteId);
  return t;
}

async function sentenceOf(q: DbOrTx, t: typeof stockTakeouts.$inferSelect) {
  const [c] = t.customerId ? await q.select({ name: customers.name }).from(customers).where(eq(customers.id, t.customerId)).limit(1) : [];
  return purposeSentence({ ...t, customerName: c?.name ?? null }, await takeoutChannels(q, t.organizationId));
}

const decidedSteps = (tx: DbOrTx, id: string) =>
  tx.select().from(approvalDecisions).where(and(eq(approvalDecisions.recordType, "stock_takeout"), eq(approvalDecisions.recordId, id), eq(approvalDecisions.decision, "approved")));

/**
 * Gives the OK for a take-out above the limits. The open step of the approval rules (default: site manager or
 * owner), never the person who asked (ADR-088 §2 top roles excepted). The last OK posts the lines, re-checked now.
 */
export async function approveTakeout(ctx: AuthContext, id: string, note?: string | null) {
  ctx.require("inventory.takeout.approve");
  return db.transaction(async (tx) => {
    const t = await lockTakeout(tx, ctx, id);
    takeoutMachine.assert(t.status, "posted", `Take-out ${t.takeoutNumber}`);
    ctx.requireAt("inventory.takeout.approve", t.siteId);
    ctx.assertSeparationAt(t.createdBy === ctx.userId, "SEPARATION_OF_DUTIES: you took these pieces out, so someone else must give the OK.", t.siteId, { rule: "authz.sod.approve_own" });
    const decisions = await decidedSteps(tx, t.id);
    const step = decisions.length + 1;
    const ev = await evaluateApprovalRules(tx, t.organizationId, { documentType: "stock_takeout", siteId: t.siteId, basis: { qty_base: t.totalPieces } });
    const stepDef = ev.steps[step - 1];
    const pendingSince = step === 1 ? t.createdAt : (decisions[decisions.length - 1]?.decidedAt ?? t.createdAt);
    if (stepDef && !canDecideEvaluatedStep(ctx, stepDef, pendingSince)) {
      const roles = stepDef.roleCodes.map((r) => r.replace(/_/g, " ")).join(" or ");
      throw new DomainError("forbidden", `This OK needs the ${roles} role.`, { permission: "inventory.takeout.approve", siteId: t.siteId });
    }
    ctx.assertSeparationAt(decisions.some((d) => d.decidedBy === ctx.userId), "SEPARATION_OF_DUTIES: each OK must come from a different person.", t.siteId);
    await tx.insert(approvalDecisions).values({ organizationId: t.organizationId, siteId: t.siteId, recordType: "stock_takeout", recordId: t.id, step, decision: "approved", decidedBy: ctx.userId, note: note?.trim() || null });
    const final = step >= Math.max(ev.steps.length, 1);
    if (!final) {
      await audit(tx, ctx, { action: "inventory.stock_takeout.approved", entityType: "stock_takeout", entityId: t.id, entityNumber: t.takeoutNumber, siteId: t.siteId, reason: note?.trim() || null, before: { status: t.status }, after: { status: t.status, step, awaitingNextStep: true } });
      return { status: "awaiting_approval" as const, step };
    }
    // Re-check every line now: the pieces may have gone since the request.
    const lines = await tx.select().from(stockTakeoutLines).where(eq(stockTakeoutLines.takeoutId, t.id)).orderBy(asc(stockTakeoutLines.lineNo));
    const resolved = await lockAndCheck(tx, ctx, t.siteId, lines.map((l) => ({ lotId: l.lotId, locationId: l.locationId, containerId: l.containerId, pieces: new Decimal(l.qtyBase) })));
    const sentence = await sentenceOf(tx, t);
    const now = new Date();
    await tx.update(stockTakeouts).set({ status: "posted", approvedBy: ctx.userId, approvedAt: now, postedBy: ctx.userId, postedAt: now }).where(eq(stockTakeouts.id, t.id));
    const posted = await postLines(tx, ctx, { id: t.id, takeoutNumber: t.takeoutNumber, sentence }, lines.map((l, i) => ({ lineId: l.id, lineNo: l.lineNo, r: resolved[i] })), t.idempotencyKey, t.correlationId ?? randomUUID());
    await audit(tx, ctx, { action: "inventory.stock_takeout.approved", entityType: "stock_takeout", entityId: t.id, entityNumber: t.takeoutNumber, siteId: t.siteId, reason: note?.trim() || null, before: { status: t.status }, after: { status: "posted", step, movements: posted.length } });
    await audit(tx, ctx, { action: "inventory.stock_takeout.posted", entityType: "stock_takeout", entityId: t.id, entityNumber: t.takeoutNumber, siteId: t.siteId, reason: sentence, after: { status: "posted", approvedBy: ctx.userId, requestedBy: t.createdBy } });
    return { status: "posted" as const, step };
  });
}

/** Says no to a take-out waiting for an OK (a reason is required); nothing ever moved. */
export async function rejectTakeout(ctx: AuthContext, id: string, reason: string) {
  ctx.require("inventory.takeout.approve");
  const why = reason?.trim() ?? "";
  if (why.length < 3) throw new DomainError("validation", "Say why (at least 3 letters).", { field: "reason", fieldErrors: { reason: "Say why." } });
  return db.transaction(async (tx) => {
    const t = await lockTakeout(tx, ctx, id);
    takeoutMachine.assert(t.status, "rejected", `Take-out ${t.takeoutNumber}`);
    ctx.requireAt("inventory.takeout.approve", t.siteId);
    ctx.assertSeparationAt(t.createdBy === ctx.userId, "SEPARATION_OF_DUTIES: you took these pieces out, so someone else must decide.", t.siteId);
    const decisions = await decidedSteps(tx, t.id);
    await tx.insert(approvalDecisions).values({ organizationId: t.organizationId, siteId: t.siteId, recordType: "stock_takeout", recordId: t.id, step: decisions.length + 1, decision: "rejected", decidedBy: ctx.userId, note: why });
    await tx.update(stockTakeouts).set({ status: "rejected", rejectedBy: ctx.userId, rejectedAt: new Date(), rejectReason: why }).where(eq(stockTakeouts.id, t.id));
    await audit(tx, ctx, { action: "inventory.stock_takeout.rejected", entityType: "stock_takeout", entityId: t.id, entityNumber: t.takeoutNumber, siteId: t.siteId, reason: why, before: { status: t.status }, after: { status: "rejected" } });
  });
}

/** The person who asked (or an approver) withdraws a take-out still waiting for an OK. */
export async function cancelTakeout(ctx: AuthContext, id: string, reason: string) {
  ctx.require("inventory.takeout.create");
  const why = reason?.trim() ?? "";
  if (why.length < 3) throw new DomainError("validation", "Say why (at least 3 letters).", { field: "reason", fieldErrors: { reason: "Say why." } });
  return db.transaction(async (tx) => {
    const t = await lockTakeout(tx, ctx, id);
    takeoutMachine.assert(t.status, "cancelled", `Take-out ${t.takeoutNumber}`);
    if (t.createdBy !== ctx.userId && !ctx.canAt("inventory.takeout.approve", t.siteId)) throw new DomainError("forbidden", "Only the person who asked or a manager can cancel it.", { permission: "inventory.takeout.approve", siteId: t.siteId });
    await tx.update(stockTakeouts).set({ status: "cancelled", cancelledBy: ctx.userId, cancelledAt: new Date(), cancelReason: why }).where(eq(stockTakeouts.id, t.id));
    await audit(tx, ctx, { action: "inventory.stock_takeout.cancelled", entityType: "stock_takeout", entityId: t.id, entityNumber: t.takeoutNumber, siteId: t.siteId, reason: why, before: { status: t.status }, after: { status: "cancelled" } });
  });
}

/**
 * "Undo" (ADR-138 §2): reverses a posted take-out with a reason. The person who recorded it may undo it the same Manila
 * day; a holder of `inventory.takeout.void` at the site any time. Each line gets a `reversal` movement back to its
 * place; pieces go back into their box when the box is still there (an emptied box is opened again), else loose.
 */
export async function undoTakeout(ctx: AuthContext, id: string, reason: string, opts: { now?: Date } = {}) {
  ctx.require("inventory.takeout.create");
  const why = reason?.trim() ?? "";
  if (why.length < 3) throw new DomainError("validation", "Say why you undo it (at least 3 letters).", { field: "reason", fieldErrors: { reason: "Say why." } });
  return db.transaction(async (tx) => {
    const t = await lockTakeout(tx, ctx, id);
    if (t.status === "reversed") throw new DomainError("state", `Take-out ${t.takeoutNumber} is already undone.`);
    takeoutMachine.assert(t.status, "reversed", `Take-out ${t.takeoutNumber}`);
    const refusal = undoRefusal({ createdBy: t.createdBy, postedAt: t.postedAt, userId: ctx.userId, canVoid: ctx.canAt("inventory.takeout.void", t.siteId), now: opts.now });
    if (refusal) throw new DomainError("forbidden", refusal, { permission: "inventory.takeout.void", siteId: t.siteId });
    const lines = await tx.select().from(stockTakeoutLines).where(eq(stockTakeoutLines.takeoutId, t.id)).orderBy(asc(stockTakeoutLines.lineNo));
    const boxIds = [...new Set(lines.map((l) => l.containerId).filter((x): x is string => !!x))].sort();
    for (const b of boxIds) await tx.select({ id: containers.id }).from(containers).where(eq(containers.id, b)).for("update");
    await lockLots(tx, lines.map((l) => l.lotId));
    const correlationId = randomUUID();
    const back: string[] = [];
    for (const l of lines) {
      if (!l.stockMovementId) continue;
      const { movement } = await postMovement(tx, ctx, {
        movementType: "reversal",
        lotId: l.lotId,
        toLocationId: l.locationId,
        qtyBase: l.qtyBase,
        reversalOfId: l.stockMovementId,
        sourceDocumentType: "stock_takeout",
        sourceDocumentId: t.id,
        sourceDocumentNumber: t.takeoutNumber,
        reason: `Undo take-out ${t.takeoutNumber}: ${why}`.slice(0, 500),
        idempotencyKey: `takeout_undo:${t.id}:${l.lineNo}`,
        correlationId,
        meta: { containerId: l.containerId, takeoutLine: l.lineNo, undo: true },
      });
      if (l.containerId) {
        const [box] = await tx.select().from(containers).where(eq(containers.id, l.containerId)).limit(1);
        if (box && box.currentLocationId === l.locationId && ["open", "sealed", "empty"].includes(box.status)) {
          if (box.status === "empty") await tx.update(containers).set({ status: "open", updatedAt: new Date() }).where(eq(containers.id, box.id));
          const [lot] = await tx.select({ baseUom: inventoryLots.baseUom }).from(inventoryLots).where(eq(inventoryLots.id, l.lotId));
          await addContent(tx, box, l.lotId, lot.baseUom, new Decimal(l.qtyBase));
          back.push(`box ${box.containerNumber}`);
        } else back.push("loose on the shelf");
      }
      await tx.update(stockTakeoutLines).set({ reversalMovementId: movement.id }).where(eq(stockTakeoutLines.id, l.id));
    }
    await tx.update(stockTakeouts).set({ status: "reversed", reversedBy: ctx.userId, reversedAt: new Date(), reverseReason: why }).where(eq(stockTakeouts.id, t.id));
    await audit(tx, ctx, { action: "inventory.stock_takeout.reversed", entityType: "stock_takeout", entityId: t.id, entityNumber: t.takeoutNumber, siteId: t.siteId, reason: why, correlationId, before: { status: t.status }, after: { status: "reversed", lines: lines.length, putBack: back } });
    return { takeoutNumber: t.takeoutNumber, lines: lines.length };
  });
}

/** "To approve" verdicts (registered in src/modules/wiring.ts): the same step, role and same-person rules as approveTakeout. */
export async function takeoutApprovalVerdicts(ctx: AuthContext, ids: string[]): Promise<Map<string, ApprovalVerdict>> {
  const out = new Map<string, ApprovalVerdict>();
  if (!ids.length || !ctx.allowedSiteIds.length) return out;
  const rows = await db
    .select({ t: stockTakeouts, by: users.displayName })
    .from(stockTakeouts)
    .innerJoin(users, eq(users.id, stockTakeouts.createdBy))
    .where(and(eq(stockTakeouts.organizationId, ctx.organizationId), inArray(stockTakeouts.id, ids), inArray(stockTakeouts.siteId, ctx.allowedSiteIds), eq(stockTakeouts.status, "awaiting_approval")));
  for (const { t, by } of rows) {
    const decisions = await decidedSteps(db, t.id);
    const step = decisions.length + 1;
    const ev = await evaluateApprovalRules(db, t.organizationId, { documentType: "stock_takeout", siteId: t.siteId, basis: { qty_base: t.totalPieces } });
    const v = stepVerdict(ctx, {
      step: ev.steps[step - 1] ?? null,
      stepsCount: step === 1 ? ev.steps.length : undefined,
      basePermission: "inventory.takeout.approve",
      siteId: t.siteId,
      pendingSince: t.createdAt,
      excludedUserIds: [t.createdBy],
      priorApproverIds: decisions.map((d) => d.decidedBy),
      operational: true,
      roleStandIn: false,
    });
    out.set(t.id, { ...v, requestedById: t.createdBy, requestedByName: by, why: t.approvalReason, title: `Take-out of ${new Decimal(t.totalPieces).toString()} pieces: ${await sentenceOf(db, t)}` });
  }
  return out;
}

/** Ids of posted take-out movements, so the generic "Fix a mistake" reversal can refuse them (undo goes through the take-out). */
export async function isTakeoutMovement(q: DbOrTx, movementId: string): Promise<boolean> {
  const [m] = await q.select({ t: stockMovements.sourceDocumentType }).from(stockMovements).where(and(eq(stockMovements.id, movementId), ne(stockMovements.movementType, "reversal"))).limit(1);
  return m?.t === "stock_takeout";
}

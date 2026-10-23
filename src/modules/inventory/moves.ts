import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import { db, type Tx } from "@/db/client";
import {
  containerContents,
  containerLineage,
  containers,
  dispositions,
  inventoryBalances,
  inventoryLots,
  locations,
  materials,
  products,
  stockAllocations,
  stockCountEntries,
  stockCountLines,
  stockCounts,
  stockCountScopes,
  stockMovements,
  stockReservations,
  transferRequestLines,
  transferRequests,
  users,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { fmtDateTime } from "@/lib/qty";
import { postMovement } from "./ledger";
import { allowedDestinationKinds, isUuid } from "./lots";
import { claimIdempotencyKey, storeIdempotentResult } from "./command-kit";
import { assertLocationsNotFrozen } from "./counts";
import { getInventorySetting } from "./policy";

/** Statuses of a box that may be moved, split or merged. */
export const MOVABLE_BOX_STATUSES = ["open", "sealed"] as const;

export type MoveSource = { kind: "box"; containerId: string } | { kind: "lot"; lotId: string; fromLocationId: string; qty: string };

export type ScanMoveInput = {
  idempotencyKey: string;
  source: MoveSource;
  toLocationId: string;
  reason?: string;
  /** The session that posts the move; undo is allowed only from the same session (US-2-28). */
  sessionId?: string | null;
};

export type MoveLine = { lotId: string; lotNumber: string; itemName: string; qtyBase: string; baseUom: string; movementId: string };

export type MoveResult = {
  transferId: string;
  transferNumber: string;
  replayed: boolean;
  /** Set when the same box/lot and destination was already moved by this user moments ago (V-DUP); nothing posted. */
  alreadyMoved: boolean;
  box: { id: string; number: string } | null;
  lines: MoveLine[];
  from: { id: string; code: string };
  to: { id: string; code: string; name: string };
  postedAt: string;
  postedByName: string;
  /** Read-back text for the toast (AC1). */
  message: string;
  /** Present only while the actor may undo (ux §5.17 matrix; architecture §6). */
  undo: { until: string; command: "inventory.move.undo"; transferId: string } | null;
};

const QTY_RE = /^\d{1,12}(\.\d{1,6})?$/;

/** Sum of a lot's quantity held in open or sealed boxes at a location. */
export async function boxedQty(q: Tx | typeof db, lotId: string, locationId: string): Promise<Decimal> {
  const [r] = await q
    .select({ qty: sql<string>`coalesce(sum(${containerContents.qtyBase}), 0)::text` })
    .from(containerContents)
    .innerJoin(containers, eq(containers.id, containerContents.containerId))
    .where(and(eq(containerContents.lotId, lotId), eq(containers.currentLocationId, locationId), inArray(containers.status, [...MOVABLE_BOX_STATUSES])));
  return new Decimal(r?.qty ?? 0);
}

async function balanceQty(q: Tx | typeof db, lotId: string, locationId: string): Promise<Decimal> {
  const [b] = await q
    .select({ qty: inventoryBalances.qtyBase })
    .from(inventoryBalances)
    .where(and(eq(inventoryBalances.lotId, lotId), eq(inventoryBalances.locationId, locationId)))
    .limit(1);
  return new Decimal(b?.qty ?? 0);
}

/** Quantity of a lot at a location that is not inside a box (what a lot-level move may take). */
export async function looseQty(q: Tx | typeof db, lotId: string, locationId: string): Promise<Decimal> {
  const [bal, boxed] = await Promise.all([balanceQty(q, lotId, locationId), boxedQty(q, lotId, locationId)]);
  return Decimal.max(bal.minus(boxed), 0);
}

function statusWord(s: string) {
  return { quarantine: "quarantined", on_hold: "on QA hold", rejected: "rejected", expired: "expired", recalled: "recalled", released: "released" }[s] ?? s;
}

/** V-LOC: throws 409 with the allowed locations when the destination kind does not fit the lot's status. */
async function assertDestinationAllowed(tx: Tx, lot: { lotNumber: string; qualityStatus: string; expiresOn: string | null; siteId: string }, to: { code: string; kind: string }) {
  const kinds = allowedDestinationKinds(lot.qualityStatus, lot.expiresOn);
  if (kinds.includes(to.kind)) return;
  const suggestions = await tx
    .select({ code: locations.code })
    .from(locations)
    .where(and(eq(locations.siteId, lot.siteId), eq(locations.isActive, true), inArray(locations.kind, kinds)))
    .orderBy(asc(locations.code))
    .limit(6);
  const expiredByDate = lot.qualityStatus === "released" && !kinds.includes("storage");
  throw new DomainError(
    "blocked_lot",
    `Lot ${lot.lotNumber} is ${expiredByDate ? "past its expiry date" : statusWord(lot.qualityStatus)}; it can only go to ${kinds.join(" / ")} locations, not ${to.kind} (${to.code}).${suggestions.length ? ` Try ${suggestions.map((s) => s.code).join(", ")}.` : ""}`,
    { rule: "V-LOC", allowedKinds: kinds, suggestions: suggestions.map((s) => s.code) },
  );
}

async function loadLocationInScope(tx: Tx, ctx: AuthContext, locationId: string, label: string) {
  if (!isUuid(locationId)) throw new DomainError("validation", `Scan or choose the ${label} location.`);
  const [loc] = await tx.select().from(locations).where(eq(locations.id, locationId)).limit(1);
  if (!loc || !ctx.allowedSiteIds.includes(loc.siteId)) throw new DomainError("not_found", `The ${label} location was not found in your sites.`);
  return loc;
}

async function undoInfo(tx: Tx, ctx: AuthContext, kind: string, completedAt: Date, transferId: string) {
  if (kind !== "scan_move") return null;
  const seconds = await getInventorySetting(tx, ctx.organizationId, null, "settings.ux.undo_window_seconds");
  if (seconds <= 0) return null;
  const until = new Date(completedAt.getTime() + seconds * 1000);
  if (until.getTime() <= Date.now()) return null;
  return { until: until.toISOString(), command: "inventory.move.undo" as const, transferId };
}

/** Rebuilds the result of a posted transfer (used for "Already moved" and for replay after reload). */
async function describeTransfer(tx: Tx, ctx: AuthContext, transferId: string, flags: { replayed: boolean; alreadyMoved: boolean }): Promise<MoveResult> {
  const [tr] = await tx.select().from(transferRequests).where(eq(transferRequests.id, transferId)).limit(1);
  const lines = await tx
    .select({
      lotId: transferRequestLines.lotId,
      lotNumber: inventoryLots.lotNumber,
      itemName: sql<string>`coalesce(${materials.name}, ${products.name})`,
      qtyBase: transferRequestLines.qtyBase,
      baseUom: inventoryLots.baseUom,
      movementId: transferRequestLines.issueMovementId,
    })
    .from(transferRequestLines)
    .innerJoin(inventoryLots, eq(inventoryLots.id, transferRequestLines.lotId))
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .where(eq(transferRequestLines.transferRequestId, transferId))
    .orderBy(asc(transferRequestLines.lineNo));
  const [from] = await tx.select({ id: locations.id, code: locations.code }).from(locations).where(eq(locations.id, tr.fromLocationId!));
  const [to] = await tx.select({ id: locations.id, code: locations.code, name: locations.name }).from(locations).where(eq(locations.id, tr.toLocationId!));
  const [by] = await tx.select({ name: users.displayName }).from(users).where(eq(users.id, tr.requestedBy));
  const [box] = tr.containerId ? await tx.select({ id: containers.id, number: containers.containerNumber }).from(containers).where(eq(containers.id, tr.containerId)) : [];
  const postedAt = tr.completedAt ?? tr.createdAt;
  const what = box
    ? `box ${box.number} (${lines.map((l) => `${new Decimal(l.qtyBase).toString()} ${l.baseUom} ${l.itemName}, lot ${l.lotNumber}`).join("; ")})`
    : lines.map((l) => `${new Decimal(l.qtyBase).toString()} ${l.baseUom} of ${l.itemName}, lot ${l.lotNumber}`).join("; ");
  const mine = tr.requestedBy === ctx.userId;
  const message = flags.alreadyMoved
    ? `Already moved to ${to.code} at ${fmtDateTime(postedAt)} by ${mine ? "you" : by?.name} (${tr.transferNumber}). Nothing was posted.`
    : `Moved ${what} to ${to.code} · ${to.name}. ${tr.transferNumber}.`;
  return {
    transferId: tr.id,
    transferNumber: tr.transferNumber,
    replayed: flags.replayed,
    alreadyMoved: flags.alreadyMoved,
    box: box ?? null,
    lines: lines.map((l) => ({ ...l, qtyBase: new Decimal(l.qtyBase).toString(), movementId: l.movementId ?? "" })),
    from,
    to,
    postedAt: postedAt.toISOString(),
    postedByName: by?.name ?? "",
    message,
    undo: tr.undoneAt || !mine || flags.alreadyMoved ? null : await undoInfo(tx, ctx, tr.transferKind, postedAt, tr.id),
  };
}

/**
 * Scan-to-move (US-2-14, W02-03): moves a whole box, or a quantity of a lot's loose stock, to a
 * destination location of the same site as one transfer request with one transfer movement per lot.
 * Idempotent on the client key; the same box/lot and destination scanned again by the same user
 * within the duplicate window answers "Already moved … by you" and posts nothing (V-DUP, AC-16).
 * Lock order: idempotency key → container → lots (sorted) → locations (share) → balances → numbering.
 */
export async function scanMove(ctx: AuthContext, input: ScanMoveInput): Promise<MoveResult> {
  ctx.require("inventory.movement.post");
  if (!input.idempotencyKey || input.idempotencyKey.length > 100) throw new DomainError("validation", "Reload the page and try again (missing request id).");
  const src = input.source;
  if (src.kind === "box" && !isUuid(src.containerId)) throw new DomainError("not_found", "Box not found in your sites.");
  if (src.kind === "lot") {
    if (!isUuid(src.lotId)) throw new DomainError("not_found", "Lot not found in your sites.");
    if (!QTY_RE.test(src.qty ?? "") || new Decimal(src.qty).lte(0)) throw new DomainError("validation", "Enter a quantity greater than zero (up to 6 decimals).");
  }
  const key = `scan_move:${input.idempotencyKey}`;
  const body = { source: src, toLocationId: input.toLocationId };

  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<{ transferId: string; alreadyMoved: boolean }>(tx, ctx.organizationId, key, "inventory.scan_move", body);
    if (claimed) return describeTransfer(tx, ctx, claimed.replay.transferId, { replayed: true, alreadyMoved: claimed.replay.alreadyMoved });

    const to = await loadLocationInScope(tx, ctx, input.toLocationId, "destination");
    if (!to.isActive) throw new DomainError("validation", `Location ${to.code} is inactive; choose another destination.`);

    // Resolve the source and the lines to move.
    let box: typeof containers.$inferSelect | null = null;
    let fromLocationId: string;
    let lineSpecs: { lotId: string; qty: Decimal }[];
    if (src.kind === "box") {
      [box] = await tx.select().from(containers).where(eq(containers.id, src.containerId)).for("update").limit(1);
      if (!box || !ctx.allowedSiteIds.includes(box.siteId)) throw new DomainError("not_found", "Box not found in your sites.");
      ctx.requireSite(box.siteId);
      if (!(MOVABLE_BOX_STATUSES as readonly string[]).includes(box.status)) throw new DomainError("state", `Box ${box.containerNumber} is ${box.status}; only open or sealed boxes can be moved.`);
      if (!box.currentLocationId) throw new DomainError("state", `Box ${box.containerNumber} has no current location.`);
      fromLocationId = box.currentLocationId;
      const contents = await tx.select().from(containerContents).where(and(eq(containerContents.containerId, box.id), gt(containerContents.qtyBase, "0")));
      if (contents.length === 0) throw new DomainError("state", `Box ${box.containerNumber} is empty.`);
      lineSpecs = contents.map((c) => ({ lotId: c.lotId, qty: new Decimal(c.qtyBase) }));
    } else {
      fromLocationId = src.fromLocationId;
      lineSpecs = [{ lotId: src.lotId, qty: new Decimal(src.qty) }];
    }

    // V-DUP: the same source and destination moved by this user moments ago.
    const dupSeconds = await getInventorySetting(tx, ctx.organizationId, null, "inventory.move.duplicate_window_seconds");
    const since = new Date(Date.now() - dupSeconds * 1000);
    const dupConds = [
      eq(transferRequests.organizationId, ctx.organizationId),
      eq(transferRequests.requestedBy, ctx.userId),
      eq(transferRequests.toLocationId, to.id),
      eq(transferRequests.transferKind, "scan_move"),
      isNull(transferRequests.undoneAt),
      gt(transferRequests.createdAt, since),
    ];
    if (box) dupConds.push(eq(transferRequests.containerId, box.id));
    else
      dupConds.push(
        isNull(transferRequests.containerId),
        eq(transferRequests.fromLocationId, fromLocationId),
        sql`exists (select 1 from ${transferRequestLines} l where l.transfer_request_id = ${transferRequests.id} and l.lot_id = ${lineSpecs[0].lotId} and l.qty_base = ${lineSpecs[0].qty.toString()}::numeric)`,
      );
    const [dup] = await tx.select({ id: transferRequests.id }).from(transferRequests).where(and(...dupConds)).orderBy(desc(transferRequests.createdAt)).limit(1);
    if (dup && (box ? box.currentLocationId === to.id : true)) {
      await storeIdempotentResult(tx, ctx.organizationId, key, body, { transferId: dup.id, alreadyMoved: true });
      return describeTransfer(tx, ctx, dup.id, { replayed: false, alreadyMoved: true });
    }
    if (fromLocationId === to.id) throw new DomainError("validation", box ? `Box ${box.containerNumber} is already at ${to.code}.` : `The stock is already at ${to.code}; scan a different destination.`);

    // Lock the lots in id order, then check scope, status and destination class.
    const lotIds = [...new Set(lineSpecs.map((l) => l.lotId))].sort();
    const lots = await tx.select().from(inventoryLots).where(inArray(inventoryLots.id, lotIds)).orderBy(asc(inventoryLots.id)).for("update");
    if (lots.length !== lotIds.length || lots.some((l) => !ctx.allowedSiteIds.includes(l.siteId))) throw new DomainError("not_found", "Lot not found in your sites.");
    const siteId = lots[0].siteId;
    ctx.requireSite(siteId);
    const from = await loadLocationInScope(tx, ctx, fromLocationId, "source");
    if (from.siteId !== siteId) throw new DomainError("validation", "The source location is not at this lot's site.");
    if (to.siteId !== siteId) {
      throw new DomainError("validation", `${to.code} is at another site. Use an inter-site transfer, which needs stock-move rights at both sites.`, { rule: "inter_site" });
    }
    for (const lot of lots) await assertDestinationAllowed(tx, lot, to);
    await assertLocationsNotFrozen(tx, [from.id, to.id]);

    if (!box) {
      const lot = lots[0];
      if (lot.baseUom === "pcs" && !lineSpecs[0].qty.isInteger()) throw new DomainError("validation", "This lot is counted in pieces; enter a whole number.");
      const loose = await looseQty(tx, lot.id, from.id);
      if (loose.lt(lineSpecs[0].qty)) {
        const boxed = await boxedQty(tx, lot.id, from.id);
        throw new DomainError(
          "insufficient_stock",
          `Only ${loose.toString()} ${lot.baseUom} of lot ${lot.lotNumber} is loose at ${from.code}${boxed.gt(0) ? `; ${boxed.toString()} ${lot.baseUom} is in boxes, so scan the box to move it` : ""}.`,
        );
      }
    }

    const number = await nextNumber(tx, ctx.organizationId, "TR");
    const correlationId = randomUUID();
    const [tr] = await tx
      .insert(transferRequests)
      .values({
        organizationId: ctx.organizationId,
        siteId,
        transferNumber: number,
        transferKind: "scan_move",
        status: "completed",
        containerId: box?.id ?? null,
        fromLocationId: from.id,
        toLocationId: to.id,
        reason: input.reason?.trim() || null,
        requestedBy: ctx.userId,
        sessionId: input.sessionId && isUuid(input.sessionId) ? input.sessionId : null,
        idempotencyKey: key,
        correlationId,
        // Database time, equal to the movements' posted_at, so "later" checks for undo are exact.
        completedAt: sql`now()`,
      })
      .returning();

    let lineNo = 0;
    for (const spec of lineSpecs) {
      lineNo += 1;
      const lot = lots.find((l) => l.id === spec.lotId)!;
      const { movement } = await postMovement(tx, ctx, {
        movementType: "transfer",
        lotId: lot.id,
        fromLocationId: from.id,
        toLocationId: to.id,
        qtyBase: spec.qty,
        sourceDocumentType: "transfer_request",
        sourceDocumentId: tr.id,
        sourceDocumentNumber: number,
        reason: input.reason?.trim() || undefined,
        idempotencyKey: `${key}:${lineNo}`,
        meta: { containerId: box?.id ?? null, containerNumber: box?.containerNumber ?? null, correlationId, fromCode: from.code, toCode: to.code },
      });
      await tx.insert(transferRequestLines).values({
        transferRequestId: tr.id,
        lineNo,
        lotId: lot.id,
        containerId: box?.id ?? null,
        fromLocationId: from.id,
        toLocationId: to.id,
        qtyBase: spec.qty.toString(),
        issueMovementId: movement.id,
      });
      await audit(tx, ctx, {
        action: "inventory.stock_movement.posted",
        entityType: "stock_movement",
        entityId: movement.id,
        entityNumber: number,
        siteId,
        reason: input.reason?.trim() || null,
        after: { type: "transfer", lotNumber: lot.lotNumber, qtyBase: spec.qty.toString(), baseUom: lot.baseUom, from: from.code, to: to.code, box: box?.containerNumber ?? null, correlationId },
      });
    }
    if (box) await tx.update(containers).set({ currentLocationId: to.id, updatedAt: new Date() }).where(eq(containers.id, box.id));

    await storeIdempotentResult(tx, ctx.organizationId, key, body, { transferId: tr.id, alreadyMoved: false });
    return describeTransfer(tx, ctx, tr.id, { replayed: false, alreadyMoved: false });
  });
}

export type UndoResult = { transferNumber: string; reversalMovementIds: string[]; message: string; replayed: boolean };

/**
 * Undo of the actor's own scan-move inside the undo window (US-2-28, ux §5.17). Posts one linked
 * `reversal` movement per line back to the source (reason `undo_by_actor`, key `undo:<movement_id>`)
 * after the same validations; refused with 409 when the window elapsed, another user or session
 * asks, or anything later touched the lot, box or locations. Nothing is edited or deleted in the
 * ledger; afterwards only `inventory.movement.void` (supervisor reversal) applies.
 */
export async function undoMove(ctx: AuthContext, input: { transferId: string; sessionId?: string | null }): Promise<UndoResult> {
  ctx.require("inventory.movement.post");
  if (!isUuid(input.transferId)) throw new DomainError("not_found", "Move not found in your sites.");
  const key = `undo:${input.transferId}`;
  const body = { transferId: input.transferId };
  const refuse = (why: string) =>
    new DomainError("state", `${why} Nothing was changed. Ask your site manager to reverse the move with a reason (Request reversal).`, { offerReversalRequest: true });

  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<UndoResult>(tx, ctx.organizationId, key, "inventory.move.undo", body);
    if (claimed) return { ...claimed.replay, replayed: true };

    const [tr] = await tx.select().from(transferRequests).where(eq(transferRequests.id, input.transferId)).for("update").limit(1);
    if (!tr || !ctx.allowedSiteIds.includes(tr.siteId)) throw new DomainError("not_found", "Move not found in your sites.");
    ctx.requireSite(tr.siteId);
    if (tr.transferKind !== "scan_move") throw refuse(`${tr.transferNumber} is not a scan move, so it has no undo.`);
    if (tr.undoneAt) throw refuse(`${tr.transferNumber} was already undone.`);
    if (tr.requestedBy !== ctx.userId) throw refuse(`Only the person who moved the stock can undo ${tr.transferNumber}.`);
    if (tr.sessionId && tr.sessionId !== (input.sessionId ?? null)) throw refuse(`${tr.transferNumber} was posted from another session or device.`);
    const postedAt = tr.completedAt ?? tr.createdAt;
    const seconds = await getInventorySetting(tx, ctx.organizationId, null, "settings.ux.undo_window_seconds");
    if (Date.now() > postedAt.getTime() + seconds * 1000) throw refuse(`The ${seconds}-second undo window for ${tr.transferNumber} has passed.`);

    const lines = await tx.select().from(transferRequestLines).where(eq(transferRequestLines.transferRequestId, tr.id)).orderBy(asc(transferRequestLines.lineNo));
    const lotIds = [...new Set(lines.map((l) => l.lotId))].sort();
    const locIds = [tr.fromLocationId!, tr.toLocationId!];
    const ownMovementIds = lines.map((l) => l.issueMovementId!).filter(Boolean);

    // Anything later touching the lot, box or locations makes the undo unsafe (AC3).
    const reasons: string[] = [];
    const [laterMove] = await tx
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(
        and(
          gt(stockMovements.postedAt, postedAt),
          ownMovementIds.length ? sql`${stockMovements.id} not in (${sql.join(ownMovementIds.map((i) => sql`${i}`), sql`, `)})` : undefined,
          or(
            inArray(stockMovements.lotId, lotIds),
            inArray(stockMovements.fromLocationId, locIds),
            inArray(stockMovements.toLocationId, locIds),
            tr.containerId ? sql`${stockMovements.meta}->>'containerId' = ${tr.containerId}` : undefined,
          ),
        ),
      )
      .limit(1);
    if (laterMove) reasons.push("a later stock movement touched the same lot, box or location");
    const [laterRes] = await tx.select({ id: stockReservations.id }).from(stockReservations).where(and(inArray(stockReservations.lotId, lotIds), gt(stockReservations.createdAt, postedAt))).limit(1);
    if (laterRes) reasons.push("the stock was reserved since");
    const [laterAlloc] = await tx.select({ id: stockAllocations.id }).from(stockAllocations).where(and(inArray(stockAllocations.lotId, lotIds), gt(stockAllocations.createdAt, postedAt))).limit(1);
    if (laterAlloc) reasons.push("the stock was allocated to an order since");
    const [laterCount] = await tx
      .select({ id: stockCountEntries.id })
      .from(stockCountEntries)
      .innerJoin(stockCountLines, eq(stockCountLines.id, stockCountEntries.stockCountLineId))
      .where(and(gt(stockCountEntries.countedAt, postedAt), or(inArray(stockCountLines.lotId, lotIds), inArray(stockCountLines.locationId, locIds))))
      .limit(1);
    const [laterFreeze] = await tx
      .select({ id: stockCounts.id })
      .from(stockCounts)
      .innerJoin(stockCountScopes, eq(stockCountScopes.stockCountId, stockCounts.id))
      .where(and(gt(stockCounts.frozenAt, postedAt), inArray(stockCountScopes.locationId, locIds)))
      .limit(1);
    if (laterCount || laterFreeze) reasons.push("a stock count has started on it since");
    const [laterStatus] = await tx.select({ id: dispositions.id }).from(dispositions).where(and(eq(dispositions.subjectType, "lot"), inArray(dispositions.subjectId, lotIds), gt(dispositions.decidedAt, postedAt))).limit(1);
    if (laterStatus) reasons.push("QA changed the lot's status since");
    if (tr.containerId) {
      const [laterBox] = await tx
        .select({ id: containerLineage.id })
        .from(containerLineage)
        .where(and(gt(containerLineage.performedAt, postedAt), or(eq(containerLineage.parentContainerId, tr.containerId), eq(containerLineage.childContainerId, tr.containerId))))
        .limit(1);
      if (laterBox) reasons.push("the box was split, merged or repacked since");
    }
    if (reasons.length) throw refuse(`${tr.transferNumber} cannot be undone: ${reasons.join("; ")}.`);

    await tx.select({ id: inventoryLots.id }).from(inventoryLots).where(inArray(inventoryLots.id, lotIds)).orderBy(asc(inventoryLots.id)).for("update");
    await assertLocationsNotFrozen(tx, locIds);
    const reversalIds: string[] = [];
    for (const line of lines) {
      const { movement } = await postMovement(tx, ctx, {
        movementType: "reversal",
        lotId: line.lotId,
        fromLocationId: line.toLocationId,
        toLocationId: line.fromLocationId,
        qtyBase: line.qtyBase,
        sourceDocumentType: "transfer_request",
        sourceDocumentId: tr.id,
        sourceDocumentNumber: tr.transferNumber,
        reason: "undo_by_actor",
        idempotencyKey: `undo:${line.issueMovementId}`,
        meta: { reversalOfId: line.issueMovementId, containerId: line.containerId, correlationId: tr.correlationId },
      });
      reversalIds.push(movement.id);
      await tx.update(transferRequestLines).set({ reversalMovementId: movement.id }).where(eq(transferRequestLines.id, line.id));
      await audit(tx, ctx, {
        action: "inventory.stock_movement.reversed",
        entityType: "stock_movement",
        entityId: line.issueMovementId,
        entityNumber: tr.transferNumber,
        siteId: tr.siteId,
        reason: "undo_by_actor",
        after: { reversalMovementId: movement.id, qtyBase: new Decimal(line.qtyBase).toString() },
      });
    }
    await tx.update(transferRequests).set({ undoneAt: new Date(), undoneBy: ctx.userId }).where(eq(transferRequests.id, tr.id));
    if (tr.containerId) await tx.update(containers).set({ currentLocationId: tr.fromLocationId, updatedAt: new Date() }).where(eq(containers.id, tr.containerId));
    const [fromLoc] = await tx.select({ code: locations.code }).from(locations).where(eq(locations.id, tr.fromLocationId!));
    const result: UndoResult = {
      transferNumber: tr.transferNumber,
      reversalMovementIds: reversalIds,
      message: `Undone: ${tr.transferNumber} reversed; the stock is back at ${fromLoc.code}. Both movements stay in the ledger.`,
      replayed: false,
    };
    await storeIdempotentResult(tx, ctx.organizationId, key, body, result);
    return result;
  });
}

export type InterSiteInput = {
  idempotencyKey: string;
  lotId: string;
  fromLocationId: string;
  qty: string;
  toSiteId: string;
  toLocationId: string;
  reason: string;
};

/**
 * Inter-site transfer (US-2-14 AC2): an `issue` at the source site and a `receipt` at the
 * destination site into a new lot whose origin_lot_id is the source lot; both share one
 * correlation id. The actor needs inventory.intersite_transfer.post and stock-move rights at both
 * sites (both sites in scope).
 */
export async function interSiteTransfer(ctx: AuthContext, input: InterSiteInput) {
  ctx.require("inventory.intersite_transfer.post");
  ctx.require("inventory.movement.post");
  if (!isUuid(input.lotId)) throw new DomainError("not_found", "Lot not found in your sites.");
  if (!QTY_RE.test(input.qty ?? "") || new Decimal(input.qty).lte(0)) throw new DomainError("validation", "Enter a quantity greater than zero (up to 6 decimals).");
  if (!input.reason?.trim()) throw new DomainError("validation", "Give a reason for the inter-site transfer.");
  if (!isUuid(input.toSiteId) || !ctx.allowedSiteIds.includes(input.toSiteId)) {
    throw new DomainError("forbidden", "You need stock-move rights at both sites for an inter-site transfer.");
  }
  const key = `inter_site:${input.idempotencyKey}`;
  const body = { ...input, idempotencyKey: undefined };
  const qty = new Decimal(input.qty);

  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<{ transferId: string; transferNumber: string; destinationLotId: string; destinationLotNumber: string }>(
      tx,
      ctx.organizationId,
      key,
      "inventory.inter_site_transfer",
      body,
    );
    if (claimed) return { ...claimed.replay, replayed: true };

    const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, input.lotId)).for("update").limit(1);
    if (!lot || !ctx.allowedSiteIds.includes(lot.siteId)) throw new DomainError("not_found", "Lot not found in your sites.");
    ctx.requireSite(lot.siteId);
    ctx.requireSite(input.toSiteId);
    if (lot.siteId === input.toSiteId) throw new DomainError("validation", "Both locations are at the same site; use a normal move.");
    const from = await loadLocationInScope(tx, ctx, input.fromLocationId, "source");
    const to = await loadLocationInScope(tx, ctx, input.toLocationId, "destination");
    if (from.siteId !== lot.siteId) throw new DomainError("validation", "The source location is not at this lot's site.");
    if (to.siteId !== input.toSiteId || !to.isActive) throw new DomainError("validation", "Choose an active location at the destination site.");
    await assertDestinationAllowed(tx, { ...lot, siteId: input.toSiteId }, to);
    await assertLocationsNotFrozen(tx, [from.id, to.id]);
    if (lot.baseUom === "pcs" && !qty.isInteger()) throw new DomainError("validation", "This lot is counted in pieces; enter a whole number.");
    const loose = await looseQty(tx, lot.id, from.id);
    if (loose.lt(qty)) throw new DomainError("insufficient_stock", `Only ${loose.toString()} ${lot.baseUom} of lot ${lot.lotNumber} is loose at ${from.code}.`);

    const number = await nextNumber(tx, ctx.organizationId, "TR");
    const lotNumber = await nextNumber(tx, ctx.organizationId, "LOT");
    const correlationId = randomUUID();
    const [destLot] = await tx
      .insert(inventoryLots)
      .values({
        organizationId: ctx.organizationId,
        siteId: input.toSiteId,
        lotNumber,
        itemKind: lot.itemKind,
        materialId: lot.materialId,
        productId: lot.productId,
        supplierName: lot.supplierName,
        supplierLotNumber: lot.supplierLotNumber,
        manufacturedOn: lot.manufacturedOn,
        expiresOn: lot.expiresOn,
        qualityStatus: lot.qualityStatus,
        sourceBatchId: lot.sourceBatchId,
        originLotId: lot.id,
        baseUom: lot.baseUom,
        createdBy: ctx.userId,
      })
      .returning();
    const [tr] = await tx
      .insert(transferRequests)
      .values({
        organizationId: ctx.organizationId,
        siteId: lot.siteId,
        transferNumber: number,
        transferKind: "inter_site",
        status: "completed",
        toSiteId: input.toSiteId,
        fromLocationId: from.id,
        toLocationId: to.id,
        reason: input.reason.trim(),
        requestedBy: ctx.userId,
        idempotencyKey: key,
        correlationId,
        completedAt: sql`now()`,
      })
      .returning();
    const meta = { correlationId, fromSite: lot.siteId, toSite: input.toSiteId, fromCode: from.code, toCode: to.code };
    const issue = await postMovement(tx, ctx, {
      movementType: "issue",
      lotId: lot.id,
      fromLocationId: from.id,
      qtyBase: qty,
      sourceDocumentType: "transfer_request",
      sourceDocumentId: tr.id,
      sourceDocumentNumber: number,
      reason: input.reason.trim(),
      idempotencyKey: `${key}:issue`,
      meta: { ...meta, destinationLotId: destLot.id },
    });
    const receipt = await postMovement(tx, ctx, {
      movementType: "receipt",
      lotId: destLot.id,
      toLocationId: to.id,
      qtyBase: qty,
      sourceDocumentType: "transfer_request",
      sourceDocumentId: tr.id,
      sourceDocumentNumber: number,
      reason: input.reason.trim(),
      idempotencyKey: `${key}:receipt`,
      meta: { ...meta, originLotId: lot.id },
    });
    await tx.insert(transferRequestLines).values({
      transferRequestId: tr.id,
      lineNo: 1,
      lotId: lot.id,
      fromLocationId: from.id,
      toLocationId: to.id,
      qtyBase: qty.toString(),
      issueMovementId: issue.movement.id,
      receiptMovementId: receipt.movement.id,
      destinationLotId: destLot.id,
    });
    await audit(tx, ctx, {
      action: "inventory.inventory_lot.created",
      entityType: "inventory_lot",
      entityId: destLot.id,
      entityNumber: lotNumber,
      siteId: input.toSiteId,
      after: { originLotId: lot.id, originLotNumber: lot.lotNumber, qualityStatus: destLot.qualityStatus, transfer: number },
    });
    for (const [m, site] of [
      [issue.movement, lot.siteId],
      [receipt.movement, input.toSiteId],
    ] as const) {
      await audit(tx, ctx, {
        action: "inventory.stock_movement.posted",
        entityType: "stock_movement",
        entityId: m.id,
        entityNumber: number,
        siteId: site,
        reason: input.reason.trim(),
        after: { type: m.movementType, qtyBase: qty.toString(), baseUom: lot.baseUom, correlationId },
      });
    }
    const result = { transferId: tr.id, transferNumber: number, destinationLotId: destLot.id, destinationLotNumber: lotNumber };
    await storeIdempotentResult(tx, ctx.organizationId, key, body, result);
    return { ...result, replayed: false };
  });
}

/** Recent transfers of the current site (move history list on the move page). */
export async function listRecentTransfers(ctx: AuthContext, limit = 20) {
  ctx.require("inventory.movement.view");
  ctx.requireSite(ctx.currentSiteId);
  const fromLoc = locations;
  return db
    .select({
      id: transferRequests.id,
      number: transferRequests.transferNumber,
      kind: transferRequests.transferKind,
      fromCode: sql<string>`(select code from ${fromLoc} where id = ${transferRequests.fromLocationId})`,
      toCode: sql<string>`(select code from ${fromLoc} where id = ${transferRequests.toLocationId})`,
      boxNumber: sql<string | null>`(select container_number from ${containers} where id = ${transferRequests.containerId})`,
      byName: users.displayName,
      completedAt: transferRequests.completedAt,
      undoneAt: transferRequests.undoneAt,
    })
    .from(transferRequests)
    .innerJoin(users, eq(users.id, transferRequests.requestedBy))
    .where(or(eq(transferRequests.siteId, ctx.currentSiteId), eq(transferRequests.toSiteId, ctx.currentSiteId)))
    .orderBy(desc(transferRequests.createdAt))
    .limit(limit);
}

/** Active locations of the current site for the destination picker (scan or choose). */
export async function listSiteLocations(ctx: AuthContext, siteId = ctx.currentSiteId) {
  ctx.require("masterdata.location.view");
  ctx.requireSite(siteId);
  return db
    .select({ id: locations.id, code: locations.code, name: locations.name, kind: locations.kind })
    .from(locations)
    .where(and(eq(locations.siteId, siteId), eq(locations.isActive, true)))
    .orderBy(asc(locations.code));
}


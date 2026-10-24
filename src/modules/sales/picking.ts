import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type Tx } from "@/db/client";
import { containerContents, containers, customers, generatedDocuments, inventoryLots, locations, pickLines, picks, salesOrderLines, salesOrders, shipments, stockAllocations, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { D, fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { parseScan } from "@/lib/scan/payload";
import { getSetting } from "@/lib/settings";
import { assertLocationsNotFrozen, assertLotUsable, claimIdempotencyKey, storeIdempotentResult } from "@/modules/inventory";
import { generateForSource, resolveTemplateVersion } from "@/modules/documents";
import { lockOrder } from "./orders";
import { openAllocationsForOrder } from "./allocation";
import { isUuid, pickMachine, transitionOrder, transitionShipment } from "./fulfilment-state";

/**
 * Pick lists and pick scans (US-4-10, W09-06). A pick covers the order's open allocations; each scan
 * of an allocated box (BC:BOX) or a lot with a quantity for loose units (BC:LOT + qty) is a
 * `pick_lines` row keeping the payload. A box not on the order is refused ("not for this order")
 * unless the substitution rule allows a same-lot box of the same quantity (audited). Duplicate scans
 * count once. Starting a pick creates the shipment in `draft`; completing it moves it to `picked`.
 * Stock does not move here: the dispatch posting issues it.
 */

type PickRow = typeof picks.$inferSelect;

async function lockPick(tx: Tx, ctx: AuthContext, pickId: string): Promise<PickRow> {
  if (!isUuid(pickId)) throw new DomainError("not_found", "Pick not found in your sites.");
  const [p] = await tx.select().from(picks).where(and(eq(picks.id, pickId), eq(picks.organizationId, ctx.organizationId), inArray(picks.siteId, ctx.allowedSiteIds))).limit(1);
  if (!p) throw new DomainError("not_found", "Pick not found in your sites.");
  ctx.requireSite(p.siteId);
  // Order first, then the pick (the lock order of allocation and dispatch).
  await lockOrder(tx, ctx, p.salesOrderId);
  const [locked] = await tx.select().from(picks).where(eq(picks.id, p.id)).for("update");
  return locked;
}

async function pickedByAllocation(q: Tx | typeof db, pickId: string) {
  const rows = await q
    .select({ allocationId: pickLines.allocationId, qty: sql<string>`sum(${pickLines.qtyBase})::text` })
    .from(pickLines)
    .where(and(eq(pickLines.pickId, pickId), isNull(pickLines.voidedAt)))
    .groupBy(pickLines.allocationId);
  return new Map(rows.map((r) => [r.allocationId, D(r.qty)]));
}

/** Starts a pick for an allocated order (or the remainder of a partially shipped one) and its draft shipment. */
export async function startPick(ctx: AuthContext, orderId: string, input: { idempotencyKey: string }) {
  ctx.require("sales.pick.create");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  const key = `pick_start:${input.idempotencyKey}`;
  return db.transaction(async (tx) => {
    const [replay] = await tx.select().from(picks).where(and(eq(picks.organizationId, ctx.organizationId), eq(picks.idempotencyKey, key))).limit(1);
    if (replay) {
      ctx.requireSite(replay.siteId);
      return { pickId: replay.id, pickNumber: replay.pickNumber, shipmentId: replay.shipmentId, replayed: true };
    }
    const o = await lockOrder(tx, ctx, orderId);
    ctx.requireAt("sales.pick.create", o.siteId);
    if (!["allocated", "partially_shipped"].includes(o.status)) {
      throw new DomainError("state", `Order ${o.orderNumber} is ${o.status.replace(/_/g, " ")}; a pick list can be started when the order is allocated.`);
    }
    const [open] = await tx.select({ n: picks.pickNumber }).from(picks).where(and(eq(picks.salesOrderId, o.id), inArray(picks.status, ["draft", "in_progress"]))).limit(1);
    if (open) throw new DomainError("conflict", `Pick ${open.n} is already open for this order.`);
    const allocs = await openAllocationsForOrder(tx, o.id);
    if (allocs.length === 0) throw new DomainError("state", `Nothing is allocated to ${o.orderNumber} for picking. Allocate stock first.`);
    const [cust] = await tx.select().from(customers).where(eq(customers.id, o.customerId)).limit(1);
    // Numbers last (data-model §5.4 lock order).
    const shipmentNumber = await nextNumber(tx, ctx.organizationId, "SH");
    const pickNumber = await nextNumber(tx, ctx.organizationId, "PK");
    const [shipment] = await tx
      .insert(shipments)
      .values({
        organizationId: ctx.organizationId,
        siteId: o.siteId,
        salesOrderId: o.id,
        shipmentNumber,
        status: "draft",
        shipToAddress: cust?.shipToAddress ?? null,
        createdBy: ctx.userId,
        createdAt: new Date(),
      })
      .returning();
    const [pick] = await tx
      .insert(picks)
      .values({
        organizationId: ctx.organizationId,
        siteId: o.siteId,
        pickNumber,
        status: "in_progress",
        salesOrderId: o.id,
        shipmentId: shipment.id,
        assignedTo: ctx.userId,
        startedAt: new Date(),
        idempotencyKey: key,
        createdBy: ctx.userId,
      })
      .returning();
    await transitionOrder(tx, ctx, o, "picking");
    await audit(tx, ctx, {
      action: "sales.pick.created",
      entityType: "pick",
      entityId: pick.id,
      entityNumber: pickNumber,
      siteId: o.siteId,
      after: { orderNumber: o.orderNumber, shipmentNumber, allocations: allocs.length },
    });
    return { pickId: pick.id, pickNumber, shipmentId: shipment.id, replayed: false };
  });
}

export type PickScanInput = { payload: string; qty?: string | null; idempotencyKey: string; manualEntryReason?: string | null };
export type PickScanResult = {
  outcome: "picked" | "duplicate";
  message: string;
  lines: { lotNumber: string; boxNumber: string | null; qty: string; locationCode: string }[];
  substituted: boolean;
  progress: { picked: string; toPick: string };
  replayed?: boolean;
};

const QTY_RE = /^\d{1,12}(\.\d{1,6})?$/;

/**
 * One pick scan. BC:BOX:<n> picks the allocated box (whole-box allocations, or the allocated part of
 * a box); BC:LOT:<n> with a quantity picks loose units. A typed number without prefix is tried as a
 * box, then as a lot. Manual entry (unreadable label) needs a reason and is flagged.
 */
export async function scanPick(ctx: AuthContext, pickId: string, input: PickScanInput): Promise<PickScanResult> {
  ctx.require("sales.pick.create");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The scan is missing its key. Reload the page and try again.");
  const manual = !!input.manualEntryReason?.trim();
  if (manual && input.manualEntryReason!.trim().length < 3) throw new DomainError("validation", "Say why the label could not be scanned (at least 3 characters).", { field: "manualEntryReason" });
  const parsed = parseScan(input.payload);
  if (parsed.kind === "invalid") throw new DomainError("validation", "That is not a box or lot label. Scan the box label (BC:BOX) or the lot label (BC:LOT).", { field: "payload" });
  const key = `pick_scan:${input.idempotencyKey}`;
  const body = { pickId, payload: input.payload, qty: input.qty ?? null, manual };
  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<PickScanResult>(tx, ctx.organizationId, key, "sales.pick.scan", body);
    if (claimed) return { ...claimed.replay, replayed: true };
    const pick = await lockPick(tx, ctx, pickId);
    ctx.requireAt("sales.pick.create", pick.siteId);
    if (pick.status !== "in_progress") throw new DomainError("state", `Pick ${pick.pickNumber} is ${pick.status.replace(/_/g, " ")}; it takes no more scans.`);
    const allocs = await openAllocationsForOrder(tx, pick.salesOrderId);
    const picked = await pickedByAllocation(tx, pick.id);
    const left = (a: { id: string; qty: string }) => D(a.qty).minus(picked.get(a.id) ?? 0);

    const value = parsed.kind === "typed" ? parsed.value : parsed.value;
    const tryBox = parsed.kind === "untyped" || parsed.type === "BOX";
    const tryLot = parsed.kind === "untyped" || parsed.type === "LOT";
    if (parsed.kind === "typed" && !tryBox && !tryLot) throw new DomainError("validation", `A ${parsed.type} label cannot be picked. Scan the box or lot label.`, { field: "payload" });

    const [box] = tryBox
      ? await tx.select().from(containers).where(and(eq(containers.organizationId, ctx.organizationId), eq(containers.containerNumber, value), eq(containers.siteId, pick.siteId))).limit(1)
      : [];
    let lineNo = 0;
    const insertLine = async (v: { allocation: (typeof allocs)[number]; qty: Decimal; containerId: string | null; substitutedFor?: string | null }) => {
      lineNo += 1;
      const lot = (await tx.select().from(inventoryLots).where(eq(inventoryLots.id, v.allocation.lotId)).limit(1))[0];
      try {
        assertLotUsable(lot);
      } catch (e) {
        if (e instanceof DomainError) throw new DomainError("blocked_lot", `BLOCKED – ${e.message} Do not pick it; ask the office to re-allocate the order.`, { rule: "V-HOLD" });
        throw e;
      }
      await assertLocationsNotFrozen(tx, [v.allocation.locationId]);
      await tx.insert(pickLines).values({
        organizationId: ctx.organizationId,
        siteId: pick.siteId,
        pickId: pick.id,
        salesOrderLineId: v.allocation.salesOrderLineId,
        allocationId: v.allocation.id,
        lotId: v.allocation.lotId,
        containerId: v.containerId,
        fromLocationId: v.allocation.locationId,
        qtyBase: v.qty.toString(),
        baseUom: lot.baseUom,
        substitutedForContainerId: v.substitutedFor ?? null,
        pickedBy: ctx.userId,
        scanPayload: manual ? null : input.payload.slice(0, 200),
        entryMode: manual ? "manual" : "scan",
        manualEntryReason: manual ? input.manualEntryReason!.trim() : null,
        idempotencyKey: `${key}:${lineNo}`,
      });
      return lot;
    };

    const result: PickScanResult = { outcome: "picked", message: "", lines: [], substituted: false, progress: { picked: "0", toPick: "0" } };
    if (box) {
      const dup = await tx.select({ id: pickLines.id }).from(pickLines).where(and(eq(pickLines.pickId, pick.id), eq(pickLines.containerId, box.id), isNull(pickLines.voidedAt))).limit(1);
      if (dup.length) {
        result.outcome = "duplicate";
        result.message = `Box ${box.containerNumber} is already picked (counted once).`;
      } else {
        let alloc = allocs.find((a) => a.containerId === box.id && left(a).gt(0));
        let substitutedFor: string | null = null;
        if (!alloc) {
          // A-W3E-01: a same-lot box holding exactly the allocated quantity may replace an unpicked allocated box.
          const rule = await getSetting(tx, ctx.organizationId, "sales.pick.substitution", pick.siteId);
          const contents = await tx.select().from(containerContents).where(and(eq(containerContents.containerId, box.id), sql`${containerContents.qtyBase} > 0`));
          const taken = await tx.select({ id: stockAllocations.id }).from(stockAllocations).where(and(eq(stockAllocations.containerId, box.id), eq(stockAllocations.status, "open"))).limit(1);
          const candidate =
            rule === "same_lot" && contents.length === 1 && taken.length === 0 && ["open", "sealed"].includes(box.status) && box.currentLocationId
              ? allocs.find((a) => a.containerId && a.containerId !== box.id && a.lotId === contents[0].lotId && D(a.qty).eq(contents[0].qtyBase) && !picked.has(a.id))
              : undefined;
          if (!candidate) {
            throw new DomainError("conflict", `Box ${box.containerNumber} is not for this order. Put it back and scan a box on the pick list.`, { rule: "V-MAT", code: "NOT_FOR_THIS_ORDER" });
          }
          substitutedFor = candidate.containerId;
          await tx.update(stockAllocations).set({ containerId: box.id, locationId: box.currentLocationId! }).where(eq(stockAllocations.id, candidate.id));
          alloc = { ...candidate, containerId: box.id, locationId: box.currentLocationId!, boxNumber: box.containerNumber };
          result.substituted = true;
          await audit(tx, ctx, {
            action: "sales.pick.substituted",
            entityType: "pick",
            entityId: pick.id,
            entityNumber: pick.pickNumber,
            siteId: pick.siteId,
            before: { allocationId: candidate.id, box: candidate.boxNumber },
            after: { box: box.containerNumber, lotNumber: candidate.lotNumber, qty: candidate.qty },
          });
        }
        if (box.currentLocationId !== alloc.locationId || !["open", "sealed"].includes(box.status)) {
          throw new DomainError("state", `Box ${box.containerNumber} is ${box.status} and not at ${alloc.locationCode}; it cannot be picked for this allocation.`);
        }
        const qty = left(alloc);
        await insertLine({ allocation: alloc, qty, containerId: box.id, substitutedFor });
        result.lines.push({ lotNumber: alloc.lotNumber, boxNumber: box.containerNumber, qty: qty.toString(), locationCode: alloc.locationCode });
        result.message = `Picked box ${box.containerNumber}: ${fmtQty(qty, alloc.baseUom === "pcs" ? "pcs" : alloc.baseUom, alloc.baseUom === "pcs" ? 0 : 3)} of lot ${alloc.lotNumber}${result.substituted ? " (substitute for the allocated box)" : ""}.`;
      }
    } else {
      const [lot] = tryLot
        ? await tx.select().from(inventoryLots).where(and(eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.lotNumber, value), eq(inventoryLots.siteId, pick.siteId))).limit(1)
        : [];
      if (!lot) throw new DomainError("conflict", `${value} is not a box or lot at this site. Check the label and scan again.`, { rule: "V-MAT", code: "NOT_FOR_THIS_ORDER" });
      const loose = allocs.filter((a) => a.lotId === lot.id && !a.containerId && left(a).gt(0));
      if (loose.length === 0) {
        const boxed = allocs.some((a) => a.lotId === lot.id && a.containerId);
        throw new DomainError("conflict", boxed ? `Lot ${lot.lotNumber} is allocated in boxes for this order. Scan the box labels instead.` : `Lot ${lot.lotNumber} is not for this order.`, { rule: "V-MAT", code: "NOT_FOR_THIS_ORDER" });
      }
      const remaining = loose.reduce((s, a) => s.plus(left(a)), new Decimal(0));
      const raw = (input.qty ?? "").trim();
      if (!QTY_RE.test(raw) || D(raw).lte(0)) throw new DomainError("validation", `Enter how many units of lot ${lot.lotNumber} you picked (up to ${remaining.toString()}).`, { field: "qty" });
      let qty = D(raw);
      if (lot.baseUom === "pcs" && !qty.isInteger()) throw new DomainError("validation", "Whole pieces only.", { field: "qty" });
      if (qty.gt(remaining)) throw new DomainError("conflict", `Only ${remaining.toString()} ${lot.baseUom} of lot ${lot.lotNumber} are allocated loose to this order; ${qty.toString()} is more than allocated.`, { code: "OVER_PICK" });
      for (const a of loose) {
        if (qty.lte(0)) break;
        const take = Decimal.min(left(a), qty);
        await insertLine({ allocation: a, qty: take, containerId: null });
        result.lines.push({ lotNumber: a.lotNumber, boxNumber: null, qty: take.toString(), locationCode: a.locationCode });
        qty = qty.minus(take);
      }
      result.message = `Picked ${raw} ${lot.baseUom} of lot ${lot.lotNumber} (loose units).`;
    }
    const after = await pickedByAllocation(tx, pick.id);
    result.progress = {
      picked: [...after.values()].reduce((s, v) => s.plus(v), new Decimal(0)).toString(),
      toPick: allocs.reduce((s, a) => s.plus(a.qty), new Decimal(0)).toString(),
    };
    if (result.outcome === "picked") {
      await audit(tx, ctx, {
        action: "sales.pick.scanned",
        entityType: "pick",
        entityId: pick.id,
        entityNumber: pick.pickNumber,
        siteId: pick.siteId,
        after: { payload: manual ? null : input.payload.slice(0, 200), manualEntry: manual, lines: result.lines, substituted: result.substituted },
      });
      if (manual) {
        await audit(tx, ctx, { action: "sales.pick_line.manual_entry", entityType: "pick", entityId: pick.id, entityNumber: pick.pickNumber, siteId: pick.siteId, reason: input.manualEntryReason!.trim(), after: { value } });
      }
    }
    await storeIdempotentResult(tx, ctx.organizationId, key, body, result);
    return result;
  });
}

/** Takes back a mis-scanned pick line while the pick is open (the line is kept, voided, with the reason). */
export async function voidPickLine(ctx: AuthContext, pickLineId: string, reason: string) {
  ctx.require("sales.pick.create");
  const r = reason?.trim() ?? "";
  if (r.length < 3) throw new DomainError("validation", "Say why the scan is taken back (at least 3 characters).", { field: "reason" });
  if (!isUuid(pickLineId)) throw new DomainError("not_found", "Pick line not found.");
  return db.transaction(async (tx) => {
    const [line] = await tx.select().from(pickLines).where(and(eq(pickLines.id, pickLineId), eq(pickLines.organizationId, ctx.organizationId))).limit(1);
    if (!line || !ctx.allowedSiteIds.includes(line.siteId)) throw new DomainError("not_found", "Pick line not found.");
    const pick = await lockPick(tx, ctx, line.pickId);
    if (pick.status !== "in_progress") throw new DomainError("state", `Pick ${pick.pickNumber} is ${pick.status.replace(/_/g, " ")}; its scans can no longer be changed.`);
    if (line.voidedAt) return { ok: true };
    await tx.update(pickLines).set({ voidedAt: new Date(), voidedBy: ctx.userId, voidReason: r }).where(eq(pickLines.id, line.id));
    await audit(tx, ctx, { action: "sales.pick_line.voided", entityType: "pick", entityId: pick.id, entityNumber: pick.pickNumber, siteId: pick.siteId, reason: r, before: { lineId: line.id, qty: line.qtyBase, containerId: line.containerId } });
    return { ok: true };
  });
}

/**
 * Completes the pick (sales.pick.submit). Unpicked allocations need a short-pick reason; they stay
 * allocated for a later pick. The shipment moves draft → picked; the order stays `picking` until
 * pack verification.
 */
export async function completePick(ctx: AuthContext, pickId: string, input: { shortPickReason?: string | null; idempotencyKey?: string }) {
  ctx.require("sales.pick.submit");
  return db.transaction(async (tx) => {
    const pick = await lockPick(tx, ctx, pickId);
    ctx.requireAt("sales.pick.submit", pick.siteId);
    if (pick.status === "completed") return { pickNumber: pick.pickNumber, short: [], replayed: true };
    pickMachine.assert(pick.status, "completed", `Pick ${pick.pickNumber}`);
    const allocs = await openAllocationsForOrder(tx, pick.salesOrderId);
    const picked = await pickedByAllocation(tx, pick.id);
    if (picked.size === 0) throw new DomainError("state", "Nothing has been picked yet. Scan the boxes or lots on the pick list, or cancel the pick.");
    const short = allocs
      .map((a) => ({ a, left: D(a.qty).minus(picked.get(a.id) ?? 0) }))
      .filter((x) => x.left.gt(0))
      .map((x) => ({ sku: x.a.sku, lotNumber: x.a.lotNumber, box: x.a.boxNumber, short: x.left.toString() }));
    const reason = input.shortPickReason?.trim() || null;
    if (short.length && (!reason || reason.length < 3)) {
      throw new DomainError("validation", `Short pick: ${short.map((s) => `${s.sku} lot ${s.lotNumber}${s.box ? ` box ${s.box}` : ""} ${s.short} short`).join("; ")}. Give the short-pick reason.`, { field: "shortPickReason", short });
    }
    await tx.update(picks).set({ status: "completed", completedAt: new Date(), completedBy: ctx.userId, shortPickReason: short.length ? reason : null }).where(eq(picks.id, pick.id));
    const [s] = await tx.select().from(shipments).where(eq(shipments.id, pick.shipmentId)).for("update");
    await transitionShipment(tx, ctx, s, "picked");
    await audit(tx, ctx, {
      action: "sales.pick.completed",
      entityType: "pick",
      entityId: pick.id,
      entityNumber: pick.pickNumber,
      siteId: pick.siteId,
      reason: short.length ? reason : null,
      after: { shipmentNumber: s.shipmentNumber, short },
    });
    return { pickNumber: pick.pickNumber, short, replayed: false };
  });
}

/** Cancels an open pick and its draft shipment; the allocations stay and the order returns to allocated. */
export async function cancelPick(ctx: AuthContext, pickId: string, reason: string) {
  ctx.require("sales.pick.submit");
  const r = reason?.trim() ?? "";
  if (r.length < 3) throw new DomainError("validation", "Say why the pick is cancelled (at least 3 characters).", { field: "reason" });
  return db.transaction(async (tx) => {
    const pick = await lockPick(tx, ctx, pickId);
    ctx.requireAt("sales.pick.submit", pick.siteId);
    pickMachine.assert(pick.status, "cancelled", `Pick ${pick.pickNumber}`);
    const [s] = await tx.select().from(shipments).where(eq(shipments.id, pick.shipmentId)).for("update");
    if (s.status !== "draft") throw new DomainError("state", `Shipment ${s.shipmentNumber} is already ${s.status}; cancel it from the shipment page.`);
    await tx.update(picks).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: ctx.userId, cancelReason: r }).where(eq(picks.id, pick.id));
    await transitionShipment(tx, ctx, s, "cancelled", { cancelledAt: new Date(), cancelReason: r }, r);
    const [o] = await tx.select().from(salesOrders).where(eq(salesOrders.id, pick.salesOrderId));
    await transitionOrder(tx, ctx, o, (await hasDispatchedShipments(tx, o.id)) ? "partially_shipped" : "allocated", r);
    await audit(tx, ctx, { action: "sales.pick.cancelled", entityType: "pick", entityId: pick.id, entityNumber: pick.pickNumber, siteId: pick.siteId, reason: r });
    return { ok: true };
  });
}

export async function hasDispatchedShipments(q: Tx | typeof db, orderId: string) {
  const [r] = await q.select({ id: shipments.id }).from(shipments).where(and(eq(shipments.salesOrderId, orderId), inArray(shipments.status, ["dispatched", "delivered", "returned"]))).limit(1);
  return !!r;
}

/** Pick screen data: the pick, its order, allocations with progress, and the scans. */
export async function getPick(ctx: AuthContext, pickId: string) {
  ctx.require("sales.pick.view");
  if (!isUuid(pickId)) throw new DomainError("not_found", "Pick not found in your sites.");
  const [row] = await db
    .select({ pick: picks, order: salesOrders, customerName: customers.name, customerCode: customers.code, shipmentNumber: shipments.shipmentNumber, shipmentStatus: shipments.status })
    .from(picks)
    .innerJoin(salesOrders, eq(salesOrders.id, picks.salesOrderId))
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .innerJoin(shipments, eq(shipments.id, picks.shipmentId))
    .where(and(eq(picks.id, pickId), eq(picks.organizationId, ctx.organizationId), inArray(picks.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Pick not found in your sites.");
  ctx.requireSite(row.pick.siteId);
  const allocs = await openAllocationsForOrder(db, row.pick.salesOrderId);
  const lines = await db
    .select({ line: pickLines, lotNumber: inventoryLots.lotNumber, boxNumber: containers.containerNumber, locationCode: locations.code, by: users.displayName })
    .from(pickLines)
    .innerJoin(inventoryLots, eq(inventoryLots.id, pickLines.lotId))
    .innerJoin(locations, eq(locations.id, pickLines.fromLocationId))
    .innerJoin(users, eq(users.id, pickLines.pickedBy))
    .leftJoin(containers, eq(containers.id, pickLines.containerId))
    .where(eq(pickLines.pickId, row.pick.id))
    .orderBy(desc(pickLines.scannedAt));
  // Allocations fulfilled by this pick's shipment (after dispatch) still show as picked lines.
  const picked = new Map<string, Decimal>();
  for (const l of lines) if (!l.line.voidedAt) picked.set(l.line.allocationId, (picked.get(l.line.allocationId) ?? new Decimal(0)).plus(l.line.qtyBase));
  const rows = allocs.map((a) => ({ ...a, picked: (picked.get(a.id) ?? new Decimal(0)).toString(), done: (picked.get(a.id) ?? new Decimal(0)).gte(a.qty), blocked: a.qualityStatus !== "released" }));
  const toPick = rows.reduce((s, r) => s.plus(r.qty), new Decimal(0));
  const done = rows.reduce((s, r) => s.plus(r.picked), new Decimal(0));
  return {
    pick: row.pick,
    order: row.order,
    customerName: row.customerName,
    customerCode: row.customerCode,
    shipmentNumber: row.shipmentNumber,
    shipmentStatus: row.shipmentStatus,
    rows,
    lines: lines.map((l) => ({ ...l.line, lotNumber: l.lotNumber, boxNumber: l.boxNumber, locationCode: l.locationCode, pickedByName: l.by })),
    progress: { toPick: toPick.toString(), picked: done.toString(), pct: toPick.gt(0) ? Math.min(100, Math.round(done.div(toPick).times(100).toNumber())) : 0 },
  };
}

/** Orders ready to pick at the current site and the open / recent picks. */
export async function pickQueue(ctx: AuthContext) {
  ctx.require("sales.pick.view");
  ctx.requireSite(ctx.currentSiteId);
  const ready = await db
    .select({ id: salesOrders.id, orderNumber: salesOrders.orderNumber, status: salesOrders.status, requestedDeliveryOn: salesOrders.requestedDeliveryOn, customerName: customers.name })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(
      and(
        eq(salesOrders.siteId, ctx.currentSiteId),
        inArray(salesOrders.status, ["allocated", "partially_shipped"]),
        sql`exists (select 1 from ${stockAllocations} a join ${salesOrderLines} l on l.id = a.sales_order_line_id where l.sales_order_id = ${salesOrders.id} and a.status = 'open')`,
      ),
    )
    .orderBy(asc(salesOrders.requestedDeliveryOn), asc(salesOrders.orderNumber));
  const recent = await db
    .select({ id: picks.id, pickNumber: picks.pickNumber, status: picks.status, startedAt: picks.startedAt, completedAt: picks.completedAt, orderNumber: salesOrders.orderNumber, customerName: customers.name, shipmentId: picks.shipmentId, assignedName: users.displayName })
    .from(picks)
    .innerJoin(salesOrders, eq(salesOrders.id, picks.salesOrderId))
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .leftJoin(users, eq(users.id, picks.assignedTo))
    .where(eq(picks.siteId, ctx.currentSiteId))
    .orderBy(desc(picks.createdAt))
    .limit(50);
  return { ready, open: recent.filter((p) => p.status === "in_progress" || p.status === "draft"), recent: recent.filter((p) => p.status === "completed" || p.status === "cancelled").slice(0, 20) };
}

/** Pick list document data (pick_list/v1): rows by location in walk order, FEFO rank, no prices, no box codes. */
export async function pickListData(ctx: AuthContext, pickId: string) {
  const v = await getPick(ctx, pickId);
  const ranks = new Map<string, number>();
  const byProduct = new Map<string, string[]>();
  for (const r of [...v.rows].sort((a, z) => String(a.expiresOn ?? "9999").localeCompare(String(z.expiresOn ?? "9999")))) {
    const list = byProduct.get(r.productId) ?? [];
    if (!list.includes(r.lotId)) list.push(r.lotId);
    byProduct.set(r.productId, list);
  }
  for (const [, lots] of byProduct) lots.forEach((l, i) => ranks.set(l, i + 1));
  const groups = new Map<string, { locationCode: string; locationName: string; rows: unknown[] }>();
  for (const r of v.rows) {
    const g = groups.get(r.locationCode) ?? { locationCode: r.locationCode, locationName: r.locationName, rows: [] };
    const unit = r.baseUom;
    g.rows.push({
      sku: r.sku,
      productName: r.productName,
      lotNumber: r.lotNumber,
      expiresText: r.expiresOn ? fmtDate(r.expiresOn) : "No expiry",
      fefoRank: ranks.get(r.lotId) ?? 1,
      boxText: r.boxNumber ? `Box ${r.boxNumber}` : "Loose units",
      qtyText: fmtQty(r.qty, unit, unit === "pcs" ? 0 : 3),
      pickedText: D(r.picked).gt(0) ? fmtQty(r.picked, unit, unit === "pcs" ? 0 : 3) : null,
      statusText: r.blocked ? `BLOCKED – ${r.qualityStatus.replace(/_/g, " ")}; re-allocate` : r.done ? "Picked" : "To pick",
      blocked: r.blocked,
    });
    groups.set(r.locationCode, g);
  }
  return {
    pick: {
      pickNumber: v.pick.pickNumber,
      orderNumber: v.order.orderNumber,
      shipmentNumber: v.shipmentNumber,
      customerText: `${v.customerCode} · ${v.customerName}`,
      requestedDeliveryText: fmtDate(v.order.requestedDeliveryOn),
      pickerText: ctx.displayName,
      createdText: fmtDateTime(v.pick.createdAt),
      ruleText: "Allocated by the FEFO/FIFO rule per SKU and customer; pick the listed lot and box.",
    },
    groups: [...groups.values()].sort((a, z) => a.locationCode.localeCompare(z.locationCode)),
    totals: { linesText: String(v.rows.length), unitsText: v.progress.toPick },
    notes: v.rows.some((r) => r.blocked) ? ["Some lines are BLOCKED: their lot is no longer released. Do not pick them; the office re-allocates the order."] : [],
  };
}

/** Generates (records) the pick list document of a pick (documents.generated_document.create + sales.pick.view). */
export async function generatePickList(ctx: AuthContext, pickId: string, input: { idempotencyKey: string }) {
  ctx.require("documents.generated_document.create");
  const data = await pickListData(ctx, pickId);
  const v = await getPick(ctx, pickId);
  const key = `picklist:${input.idempotencyKey}`;
  return db.transaction(async (tx) => {
    const [replay] = await tx.select().from(generatedDocuments).where(and(eq(generatedDocuments.organizationId, ctx.organizationId), eq(generatedDocuments.idempotencyKey, key))).limit(1);
    if (replay) return { id: replay.id, documentNumber: replay.documentNumber };
    const code = await getSetting(tx, ctx.organizationId, "documents.pick_list.template_code", v.pick.siteId);
    const resolved = await resolveTemplateVersion(tx, ctx.organizationId, { templateCode: code, siteId: v.pick.siteId });
    if (!resolved) throw new DomainError("setup_required", `No approved pick list template (${code}) exists. Ask QA or an administrator to approve one under Admin → Templates.`);
    const doc = await generateForSource(tx, ctx, {
      resolved,
      documentKind: "pick_list",
      source: { type: "pick", id: v.pick.id, revisionAt: new Date(), state: v.pick.status },
      siteId: v.pick.siteId,
      data,
      watermark: v.pick.status === "completed" ? null : "IN PROGRESS",
      idempotencyKey: key,
      parameters: { dataset: "pick_list/v1" },
      supersedePrevious: true,
    });
    return { id: doc.id, documentNumber: doc.documentNumber };
  });
}

/** The newest recorded (ready) pick list document of a pick, for the print page. */
export async function latestPickListDocument(ctx: AuthContext, pickId: string) {
  ctx.require("documents.generated_document.view");
  const v = await getPick(ctx, pickId);
  const [doc] = await db
    .select()
    .from(generatedDocuments)
    .where(and(eq(generatedDocuments.organizationId, ctx.organizationId), eq(generatedDocuments.sourceEntityType, "pick"), eq(generatedDocuments.sourceEntityId, v.pick.id), eq(generatedDocuments.documentKind, "pick_list"), eq(generatedDocuments.status, "ready")))
    .orderBy(desc(generatedDocuments.generatedAt))
    .limit(1);
  return doc ?? null;
}

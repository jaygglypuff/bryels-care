import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type DbOrTx } from "@/db/client";
import {
  RESERVATION_DEMAND_TYPES,
  allocationRules,
  batches,
  customers,
  inventoryBalances,
  inventoryLots,
  locations,
  materials,
  products,
  salesOrderLines,
  salesOrders,
  stockAllocations,
  stockReservations,
  users,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { daysUntil } from "@/lib/qty";
import { claimIdempotencyKey, stateMachine, storeIdempotentResult } from "./command-kit";
import { isUuid } from "./lots";
import { getInventorySetting } from "./policy";

type ReservationStatus = "active" | "converted" | "released" | "expired" | "cancelled";
export const reservationMachine = stateMachine<ReservationStatus>("stock_reservation", {
  active: ["converted", "released", "expired", "cancelled"],
  converted: [],
  released: [],
  expired: [],
  cancelled: [],
});

/** Sales order statuses whose allocations still hold stock (mirrors src/modules/sales/allocation.ts). */
const OPEN_ALLOCATION_STATUSES = ["confirmed", "allocated"];

export type Strategy = "fefo" | "fifo";
export type StrategySource = "customer" | "product" | "material" | "material_kind" | "default" | "built_in";

/**
 * Resolves the FEFO/FIFO rule (A-PRD-16, Q-B-07): customer > product/material > material kind >
 * organization default > built-in FEFO. Rules are data maintained by the process owners.
 */
export async function resolveAllocationStrategy(
  q: DbOrTx,
  organizationId: string,
  item: { materialId?: string | null; productId?: string | null; materialKind?: string | null; customerId?: string | null },
): Promise<{ strategy: Strategy; source: StrategySource; minShelfLifeDays: number | null; ruleId: string | null }> {
  const rules = await q.select().from(allocationRules).where(and(eq(allocationRules.organizationId, organizationId), eq(allocationRules.isActive, true)));
  const pick =
    (item.customerId && rules.find((r) => r.scope === "customer" && r.customerId === item.customerId)) ||
    (item.productId && rules.find((r) => r.scope === "product" && r.productId === item.productId)) ||
    (item.materialId && rules.find((r) => r.scope === "material" && r.materialId === item.materialId)) ||
    (item.materialKind && rules.find((r) => r.scope === "material_kind" && r.materialKind === item.materialKind)) ||
    rules.find((r) => r.scope === "default");
  if (!pick) return { strategy: "fefo", source: "built_in", minShelfLifeDays: null, ruleId: null };
  return { strategy: pick.strategy as Strategy, source: pick.scope as StrategySource, minShelfLifeDays: pick.minShelfLifeDays, ruleId: pick.id };
}

type Orderable = { expiresOn: string | null; manufacturedOn?: string | null; lotCreatedAt?: Date | string | null; lotNumber: string; locationCode?: string };
const dateKey = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() : Number.POSITIVE_INFINITY);
const strKey = (v: string | null | undefined) => (v ? v : "￿");

/**
 * Candidate order. FEFO: earliest expiry first (lots without expiry last), tie by manufacture date,
 * then received/created time, then lot number. FIFO: oldest received/created first, then lot number.
 * Location code breaks the final tie so the order is deterministic.
 */
export function compareCandidates(strategy: Strategy) {
  return (a: Orderable, b: Orderable) => {
    const cmp = (x: number | string, y: number | string) => (x < y ? -1 : x > y ? 1 : 0);
    if (strategy === "fefo") {
      const e = cmp(strKey(a.expiresOn), strKey(b.expiresOn));
      if (e) return e;
      const m = cmp(strKey(a.manufacturedOn), strKey(b.manufacturedOn));
      if (m) return m;
    }
    return cmp(dateKey(a.lotCreatedAt), dateKey(b.lotCreatedAt)) || cmp(a.lotNumber, b.lotNumber) || cmp(a.locationCode ?? "", b.locationCode ?? "");
  };
}

export function sortCandidates<T extends Orderable>(rows: T[], strategy: Strategy): T[] {
  return [...rows].sort(compareCandidates(strategy));
}

/** Active, unexpired reservation quantity per lot × location (optionally ignoring some demands). */
export async function reservedByLotLocation(q: DbOrTx, siteId: string, opts: { lotIds?: string[]; excludeDemandIds?: string[] } = {}) {
  const conds: SQL[] = [
    eq(stockReservations.siteId, siteId),
    eq(stockReservations.status, "active"),
    or(isNull(stockReservations.expiresAt), gt(stockReservations.expiresAt, sql`now()`))!,
  ];
  if (opts.lotIds) {
    if (opts.lotIds.length === 0) return new Map<string, Decimal>();
    conds.push(inArray(stockReservations.lotId, opts.lotIds));
  }
  if (opts.excludeDemandIds?.length) conds.push(or(isNull(stockReservations.demandId), notInArray(stockReservations.demandId, opts.excludeDemandIds))!);
  const rows = await q
    .select({ lotId: stockReservations.lotId, locationId: stockReservations.locationId, qty: sql<string>`sum(${stockReservations.qtyBase})::text` })
    .from(stockReservations)
    .where(and(...conds))
    .groupBy(stockReservations.lotId, stockReservations.locationId);
  return new Map(rows.map((r) => [`${r.lotId}|${r.locationId}`, new Decimal(r.qty)]));
}

async function allocatedByLotLocation(q: DbOrTx, lotIds: string[]) {
  if (lotIds.length === 0) return new Map<string, Decimal>();
  const rows = await q
    .select({ lotId: stockAllocations.lotId, locationId: stockAllocations.locationId, qty: sql<string>`sum(${stockAllocations.qtyUnits})::text` })
    .from(stockAllocations)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, stockAllocations.salesOrderLineId))
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
    .where(and(inArray(stockAllocations.lotId, lotIds), inArray(salesOrders.status, OPEN_ALLOCATION_STATUSES)))
    .groupBy(stockAllocations.lotId, stockAllocations.locationId);
  return new Map(rows.map((r) => [`${r.lotId}|${r.locationId}`, new Decimal(r.qty)]));
}

/** Location kinds that hold promisable stock: finished goods in storage; materials in storage or production. */
const eligibleKinds = (itemKind: string) => (itemKind === "product" ? ["storage"] : ["storage", "production"]);

export type Candidate = {
  rank: number | null;
  lotId: string;
  lotNumber: string;
  qualityStatus: string;
  expiresOn: string | null;
  manufacturedOn: string | null;
  lotCreatedAt: Date;
  daysLeft: number | null;
  locationId: string;
  locationCode: string;
  locationKind: string;
  baseUom: string;
  onHand: string;
  reserved: string;
  allocated: string;
  available: string;
  eligible: boolean;
  reason: string | null;
};

const BLOCK_REASON: Record<string, string> = {
  quarantine: "Quarantined: awaiting QA release",
  on_hold: "On QA hold",
  rejected: "Rejected",
  expired: "Expired",
  recalled: "Recalled",
};

/**
 * FEFO/FIFO recommendation (US-2-20): every lot × location of the item at the site with stock,
 * ranked by the resolved rule. Blocked, expired, short-dated (customer or rule minimum) and
 * fully reserved stock is listed with the reason it is not proposed. `picks` covers `qty`.
 */
export async function recommendLots(
  ctx: AuthContext,
  input: { materialId?: string | null; productId?: string | null; customerId?: string | null; qty?: string | null; siteId?: string },
) {
  ctx.require("inventory.lot.view");
  const siteId = input.siteId ?? ctx.currentSiteId;
  ctx.requireSite(siteId);
  if (!!input.materialId === !!input.productId) throw new DomainError("validation", "Choose a material or a product.");
  const itemId = (input.materialId ?? input.productId)!;
  if (!isUuid(itemId)) throw new DomainError("not_found", "Item not found.");
  let materialKind: string | null = null;
  if (input.materialId) {
    const [m] = await db.select().from(materials).where(and(eq(materials.id, input.materialId), eq(materials.organizationId, ctx.organizationId)));
    if (!m) throw new DomainError("not_found", "Material not found.");
    materialKind = m.materialKind;
  } else {
    const [p] = await db.select().from(products).where(and(eq(products.id, input.productId!), eq(products.organizationId, ctx.organizationId)));
    if (!p) throw new DomainError("not_found", "Product not found.");
  }
  let customerMin: number | null = null;
  if (input.customerId) {
    const [c] = isUuid(input.customerId) ? await db.select().from(customers).where(and(eq(customers.id, input.customerId), eq(customers.organizationId, ctx.organizationId))) : [];
    if (!c) throw new DomainError("not_found", "Customer not found.");
    customerMin = c.minShelfLifeDays;
  }
  const rule = await resolveAllocationStrategy(db, ctx.organizationId, { materialId: input.materialId, productId: input.productId, materialKind, customerId: input.customerId });
  const minDays = Math.max(customerMin ?? 0, rule.minShelfLifeDays ?? 0) || null;
  const candidates = await candidatesFor(db, siteId, { materialId: input.materialId ?? null, productId: input.productId ?? null }, { strategy: rule.strategy, minShelfLifeDays: minDays });
  let need = input.qty ? new Decimal(input.qty) : null;
  const picks: { lotId: string; lotNumber: string; locationId: string; locationCode: string; qty: string }[] = [];
  if (need) {
    for (const c of candidates) {
      if (need.lte(0)) break;
      if (!c.eligible) continue;
      const take = Decimal.min(need, c.available);
      if (take.lte(0)) continue;
      picks.push({ lotId: c.lotId, lotNumber: c.lotNumber, locationId: c.locationId, locationCode: c.locationCode, qty: take.toString() });
      need = need.minus(take);
    }
  }
  return { strategy: rule.strategy, source: rule.source, minShelfLifeDays: minDays, candidates, recommended: candidates.find((c) => c.eligible) ?? null, picks, shortfall: need && need.gt(0) ? need.toString() : null };
}

/** Ranked candidate rows for an item at a site (shared by recommendation and reservation checks). */
export async function candidatesFor(q: DbOrTx, siteId: string, item: { materialId: string | null; productId: string | null }, opts: { strategy: Strategy; minShelfLifeDays: number | null }): Promise<Candidate[]> {
  const rows = await q
    .select({
      lotId: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      itemKind: inventoryLots.itemKind,
      qualityStatus: inventoryLots.qualityStatus,
      expiresOn: inventoryLots.expiresOn,
      manufacturedOn: inventoryLots.manufacturedOn,
      lotCreatedAt: inventoryLots.createdAt,
      baseUom: inventoryLots.baseUom,
      locationId: locations.id,
      locationCode: locations.code,
      locationKind: locations.kind,
      onHand: inventoryBalances.qtyBase,
    })
    .from(inventoryBalances)
    .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .where(
      and(
        eq(inventoryLots.siteId, siteId),
        item.materialId ? eq(inventoryLots.materialId, item.materialId) : eq(inventoryLots.productId, item.productId!),
        gt(inventoryBalances.qtyBase, "0"),
      ),
    );
  const lotIds = [...new Set(rows.map((r) => r.lotId))];
  const reserved = await reservedByLotLocation(q, siteId, { lotIds });
  const allocated = await allocatedByLotLocation(q, lotIds);
  const sorted = sortCandidates(rows, opts.strategy);
  let rank = 0;
  return sorted.map((r) => {
    const k = `${r.lotId}|${r.locationId}`;
    const res = reserved.get(k) ?? new Decimal(0);
    const alloc = allocated.get(k) ?? new Decimal(0);
    const available = Decimal.max(new Decimal(r.onHand).minus(res).minus(alloc), 0);
    const daysLeft = daysUntil(r.expiresOn);
    let reason: string | null = null;
    if (r.qualityStatus !== "released") reason = BLOCK_REASON[r.qualityStatus] ?? r.qualityStatus;
    else if (daysLeft !== null && daysLeft < 0) reason = "Expired (past expiry date)";
    else if (!eligibleKinds(r.itemKind).includes(r.locationKind)) reason = `In a ${r.locationKind} location`;
    else if (opts.minShelfLifeDays && daysLeft !== null && daysLeft < opts.minShelfLifeDays) reason = `Only ${daysLeft} days of shelf life left; minimum ${opts.minShelfLifeDays}`;
    else if (available.lte(0)) reason = "Fully reserved or allocated";
    const eligible = reason === null;
    return {
      rank: eligible ? ++rank : null,
      lotId: r.lotId,
      lotNumber: r.lotNumber,
      qualityStatus: r.qualityStatus,
      expiresOn: r.expiresOn,
      manufacturedOn: r.manufacturedOn,
      lotCreatedAt: r.lotCreatedAt,
      daysLeft,
      locationId: r.locationId,
      locationCode: r.locationCode,
      locationKind: r.locationKind,
      baseUom: r.baseUom,
      onHand: new Decimal(r.onHand).toString(),
      reserved: res.toString(),
      allocated: alloc.toString(),
      available: available.toString(),
      eligible,
      reason,
    };
  });
}

export type CreateReservationInput = {
  lotId: string;
  locationId: string;
  qty: string;
  demandType: string;
  demandId?: string | null;
  demandReference?: string | null;
  ttlHours?: number | null;
  idempotencyKey: string;
};

/**
 * Reserves a quantity of a specific lot at a location for a demand (A-DM-22). Only released,
 * unexpired stock in a promisable location, and never more than on hand − reserved − allocated.
 * The lot row lock serializes with sales allocation and other reservations.
 */
export async function createReservation(ctx: AuthContext, input: CreateReservationInput) {
  ctx.require("inventory.reservation.create");
  if (!(RESERVATION_DEMAND_TYPES as readonly string[]).includes(input.demandType)) throw new DomainError("validation", "Choose what the stock is reserved for.");
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(input.qty ?? "") || new Decimal(input.qty).lte(0)) throw new DomainError("validation", "Enter a quantity greater than zero.");
  if (!isUuid(input.lotId)) throw new DomainError("not_found", "Lot not found in your sites.");
  if (input.ttlHours !== undefined && input.ttlHours !== null && (!Number.isInteger(input.ttlHours) || input.ttlHours < 1 || input.ttlHours > 24 * 90)) {
    throw new DomainError("validation", "The reservation lifetime must be between 1 hour and 90 days.");
  }
  const qty = new Decimal(input.qty);
  const key = `reservation:${input.idempotencyKey}`;
  const body = { ...input, idempotencyKey: undefined };
  return db.transaction(async (tx) => {
    const claimed = await claimIdempotencyKey<{ id: string; reservationNumber: string }>(tx, ctx.organizationId, key, "inventory.reservation.create", body);
    if (claimed) return { ...claimed.replay, replayed: true };
    const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, input.lotId)).for("update").limit(1);
    if (!lot || lot.organizationId !== ctx.organizationId || !ctx.allowedSiteIds.includes(lot.siteId)) throw new DomainError("not_found", "Lot not found in your sites.");
    ctx.requireSite(lot.siteId);
    const [loc] = isUuid(input.locationId) ? await tx.select().from(locations).where(eq(locations.id, input.locationId)) : [];
    if (!loc || loc.siteId !== lot.siteId) throw new DomainError("validation", "Choose a location of this lot's site.");

    let reference = input.demandReference?.trim() || "";
    if (input.demandType === "sales_order_line") {
      const [line] = input.demandId && isUuid(input.demandId)
        ? await tx.select({ productId: salesOrderLines.productId, orderNumber: salesOrders.orderNumber, siteId: salesOrders.siteId, lineNo: salesOrderLines.lineNo }).from(salesOrderLines).innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId)).where(eq(salesOrderLines.id, input.demandId))
        : [];
      if (!line || line.siteId !== lot.siteId || line.productId !== lot.productId) throw new DomainError("validation", "Choose an order line of this product at this site.");
      reference = `${line.orderNumber} line ${line.lineNo}`;
    } else if (input.demandType === "batch") {
      const [b] = input.demandId && isUuid(input.demandId) ? await tx.select().from(batches).where(eq(batches.id, input.demandId)) : [];
      if (!b || b.siteId !== lot.siteId) throw new DomainError("validation", "Choose a batch at this site.");
      reference = b.batchNumber;
    } else if (!reference) {
      throw new DomainError("validation", "Say what the stock is reserved for (reference).");
    }

    const rule = await resolveAllocationStrategy(tx, ctx.organizationId, { materialId: lot.materialId, productId: lot.productId });
    const cands = await candidatesFor(tx, lot.siteId, { materialId: lot.materialId, productId: lot.productId }, { strategy: rule.strategy, minShelfLifeDays: null });
    const c = cands.find((x) => x.lotId === lot.id && x.locationId === loc.id);
    if (!c) throw new DomainError("insufficient_stock", `Lot ${lot.lotNumber} has no stock at ${loc.code}.`);
    if (!c.eligible && c.reason !== "Fully reserved or allocated") throw new DomainError("blocked_lot", `Lot ${lot.lotNumber} at ${loc.code} cannot be reserved: ${c.reason}.`);
    if (new Decimal(c.available).lt(qty)) {
      throw new DomainError("insufficient_stock", `Only ${c.available} ${lot.baseUom} of lot ${lot.lotNumber} at ${loc.code} is available (on hand ${c.onHand}, reserved ${c.reserved}, allocated ${c.allocated}).`);
    }
    const ttl = input.ttlHours ?? (await getInventorySetting(tx, ctx.organizationId, lot.siteId, "inventory.reservation.ttl_hours"));
    const number = await nextNumber(tx, ctx.organizationId, "RSV");
    const [r] = await tx
      .insert(stockReservations)
      .values({
        organizationId: ctx.organizationId,
        siteId: lot.siteId,
        reservationNumber: number,
        lotId: lot.id,
        locationId: loc.id,
        qtyBase: qty.toString(),
        baseUom: lot.baseUom,
        demandType: input.demandType,
        demandId: input.demandId && isUuid(input.demandId) ? input.demandId : null,
        demandReference: reference.slice(0, 200),
        status: "active",
        expiresAt: sql`now() + make_interval(hours => ${ttl})`,
        idempotencyKey: key,
        createdBy: ctx.userId,
      })
      .returning();
    const recommended = cands.find((x) => x.eligible);
    await audit(tx, ctx, {
      action: "inventory.stock_reservation.created",
      entityType: "stock_reservation",
      entityId: r.id,
      entityNumber: number,
      siteId: lot.siteId,
      after: {
        lotNumber: lot.lotNumber,
        location: loc.code,
        qtyBase: qty.toString(),
        demand: `${input.demandType}: ${reference}`,
        ttlHours: ttl,
        followedRecommendation: recommended ? recommended.lotId === lot.id : null,
      },
    });
    const result = { id: r.id, reservationNumber: number };
    await storeIdempotentResult(tx, ctx.organizationId, key, body, result);
    return { ...result, replayed: false };
  });
}

/** Releases an active reservation with a reason (inventory.reservation.void). */
export async function releaseReservation(ctx: AuthContext, id: string, reason: string) {
  ctx.require("inventory.reservation.void");
  if (!reason?.trim() || reason.trim().length < 3) throw new DomainError("validation", "Say why the reservation is released (at least 3 characters).");
  if (!isUuid(id)) throw new DomainError("not_found", "Reservation not found in your sites.");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(stockReservations).where(eq(stockReservations.id, id)).for("update").limit(1);
    if (!r || r.organizationId !== ctx.organizationId || !ctx.allowedSiteIds.includes(r.siteId)) throw new DomainError("not_found", "Reservation not found in your sites.");
    ctx.requireSite(r.siteId);
    reservationMachine.assert(r.status, "released", `Reservation ${r.reservationNumber}`);
    await tx.update(stockReservations).set({ status: "released", releasedAt: new Date(), releasedBy: ctx.userId, releasedReason: reason.trim() }).where(eq(stockReservations.id, r.id));
    await audit(tx, ctx, {
      action: "inventory.stock_reservation.released",
      entityType: "stock_reservation",
      entityId: r.id,
      entityNumber: r.reservationNumber,
      siteId: r.siteId,
      reason: reason.trim(),
      before: { status: r.status },
      after: { status: "released" },
    });
  });
}

/**
 * Releases every active reservation of one demand inside the caller's transaction (Wave 2 W2D:
 * batch closure releases what was still reserved for the batch, US-3-19). The caller has checked
 * its own permission on the demand; one audit event per reservation.
 */
export async function releaseReservationsForDemand(tx: DbOrTx, ctx: AuthContext, demandType: string, demandId: string, reason: string) {
  const rows = await tx
    .update(stockReservations)
    .set({ status: "released", releasedAt: new Date(), releasedBy: ctx.userId, releasedReason: reason })
    .where(and(eq(stockReservations.organizationId, ctx.organizationId), eq(stockReservations.demandType, demandType), eq(stockReservations.demandId, demandId), eq(stockReservations.status, "active")))
    .returning({ id: stockReservations.id, number: stockReservations.reservationNumber, siteId: stockReservations.siteId });
  for (const r of rows) {
    await audit(tx, ctx, { action: "inventory.stock_reservation.released", entityType: "stock_reservation", entityId: r.id, entityNumber: r.number, siteId: r.siteId, reason, before: { status: "active" }, after: { status: "released" } });
  }
  return rows.length;
}

/** Marks reservations past their TTL as expired (run by the list page and, later, a nightly job). */
export async function expireReservations(q: DbOrTx, siteId: string) {
  const rows = await q
    .update(stockReservations)
    .set({ status: "expired", releasedAt: sql`now()`, releasedReason: "ttl_elapsed" })
    .where(and(eq(stockReservations.siteId, siteId), eq(stockReservations.status, "active"), lte(stockReservations.expiresAt, sql`now()`)))
    .returning({ id: stockReservations.id });
  return rows.length;
}

/**
 * Scheduled reservation expiry (job `inventory.reservation_expiry`, US-2-20): every active
 * reservation of the context's sites whose TTL elapsed becomes `expired` (reason `ttl_elapsed`),
 * one audit event `inventory.stock_reservation.expired` each. Idempotent: a second run finds nothing.
 */
export async function expireDueReservations(ctx: AuthContext): Promise<{ expired: number; reservations: string[] }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(stockReservations)
      .set({ status: "expired", releasedAt: sql`now()`, releasedReason: "ttl_elapsed" })
      .where(
        and(
          eq(stockReservations.organizationId, ctx.organizationId),
          inArray(stockReservations.siteId, ctx.allowedSiteIds),
          eq(stockReservations.status, "active"),
          lte(stockReservations.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: stockReservations.id, number: stockReservations.reservationNumber, siteId: stockReservations.siteId, expiresAt: stockReservations.expiresAt });
    for (const r of rows) {
      await audit(tx, ctx, {
        action: "inventory.stock_reservation.expired",
        entityType: "stock_reservation",
        entityId: r.id,
        entityNumber: r.number,
        siteId: r.siteId,
        reason: "ttl_elapsed",
        before: { status: "active", expiresAt: r.expiresAt },
        after: { status: "expired" },
      });
    }
    return { expired: rows.length, reservations: rows.map((r) => r.number) };
  });
}

/** Marks a demand's active reservations as converted (sales allocation took the stock). */
export async function convertReservationsForDemands(q: DbOrTx, demandIds: string[]) {
  if (demandIds.length === 0) return 0;
  const rows = await q
    .update(stockReservations)
    .set({ status: "converted", releasedAt: sql`now()` })
    .where(and(inArray(stockReservations.demandId, demandIds), eq(stockReservations.status, "active")))
    .returning({ id: stockReservations.id });
  return rows.length;
}

export async function listReservations(ctx: AuthContext, f: { status?: string; lotId?: string } = {}) {
  ctx.require("inventory.reservation.view");
  ctx.requireSite(ctx.currentSiteId);
  const conds: SQL[] = [eq(stockReservations.siteId, ctx.currentSiteId)];
  if (f.status) conds.push(eq(stockReservations.status, f.status));
  if (f.lotId && isUuid(f.lotId)) conds.push(eq(stockReservations.lotId, f.lotId));
  return db
    .select({
      id: stockReservations.id,
      number: stockReservations.reservationNumber,
      status: stockReservations.status,
      lotId: stockReservations.lotId,
      lotNumber: inventoryLots.lotNumber,
      itemName: sql<string>`coalesce(${materials.name}, ${products.name})`,
      locationCode: locations.code,
      qtyBase: stockReservations.qtyBase,
      baseUom: stockReservations.baseUom,
      demandType: stockReservations.demandType,
      demandReference: stockReservations.demandReference,
      expiresAt: stockReservations.expiresAt,
      createdAt: stockReservations.createdAt,
      createdBy: users.displayName,
      releasedReason: stockReservations.releasedReason,
    })
    .from(stockReservations)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockReservations.lotId))
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .innerJoin(locations, eq(locations.id, stockReservations.locationId))
    .innerJoin(users, eq(users.id, stockReservations.createdBy))
    .where(and(...conds))
    .orderBy(desc(stockReservations.createdAt))
    .limit(300);
}

/** Items with stock at the current site, for the recommendation picker. */
export async function recommendableItems(ctx: AuthContext) {
  ctx.require("inventory.lot.view");
  const mats = await db.select({ id: materials.id, code: materials.code, name: materials.name }).from(materials).where(eq(materials.organizationId, ctx.organizationId)).orderBy(asc(materials.code));
  const prods = await db.select({ id: products.id, code: products.skuCode, name: products.name }).from(products).where(eq(products.organizationId, ctx.organizationId)).orderBy(asc(products.skuCode));
  const custs = await db.select({ id: customers.id, code: customers.code, name: customers.name }).from(customers).where(eq(customers.organizationId, ctx.organizationId)).orderBy(asc(customers.code));
  return { materials: mats, products: prods, customers: custs };
}

/** The material/product key (`m:<id>` / `p:<id>`) of a lot in the user's sites, for the recommendation picker. */
export async function itemKeyOfLot(ctx: AuthContext, lotId: string): Promise<string | null> {
  ctx.require("inventory.lot.view");
  if (!isUuid(lotId)) return null;
  const [l] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.id, lotId), inArray(inventoryLots.siteId, ctx.allowedSiteIds))).limit(1);
  return l ? (l.materialId ? `m:${l.materialId}` : `p:${l.productId}`) : null;
}

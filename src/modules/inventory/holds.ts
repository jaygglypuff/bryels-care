import "server-only";
import { and, asc, desc, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import Decimal from "decimal.js";
import { uuidv7 } from "uuidv7";
import { db, type Tx } from "@/db/client";
import {
  dispositions,
  inventoryBalances,
  inventoryLots,
  locations,
  materials,
  products,
  qualityHoldLots,
  qualityHoldStateTransitions,
  qualityHolds,
  stockMovements,
  users,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { postMovement } from "./ledger";
import { isPastExpiry, isUuid } from "./lots";

/**
 * Quality holds (US-2-10 AC3, data-model §6.7) and the held-stock issue exception (AC2, CX-LOT).
 *
 * Hold state machine:  open ──investigate──▶ investigating ──lift──▶ closed;  open ──lift──▶ closed.
 * Placing a hold puts every named lot (or every lot with stock in the named location) on_hold through a
 * `hold` disposition. Lifting needs quality.hold.approve by someone other than the opener and writes a
 * closing disposition per lot: resolution `released` returns each lot to its status before the hold
 * (quarantine stays quarantine: lifting a hold is never a QA release), `rejected` rejects them.
 */
export const HOLD_TRANSITIONS = {
  investigate: { from: ["open"], to: "investigating" },
  lift: { from: ["open", "investigating"], to: "closed" },
} as const;

/** Assumption A-W1B-04: default hold reason codes until the reason-code catalogue exists (QA to confirm). */
export const HOLD_REASON_CODES = [
  { code: "supplier_complaint", label: "Supplier complaint or notice" },
  { code: "suspected_contamination", label: "Suspected contamination" },
  { code: "damaged_packaging", label: "Damaged packaging" },
  { code: "documentation_issue", label: "Documentation issue (CoA, label)" },
  { code: "investigation", label: "Investigation / deviation" },
  { code: "retest_due", label: "Retest due" },
  { code: "other", label: "Other (explain)" },
] as const;
const HOLD_REASON_VALUES = HOLD_REASON_CODES.map((r) => r.code) as readonly string[];

export const HOLD_RESOLUTIONS = ["released", "rejected"] as const;
export type HoldResolution = (typeof HOLD_RESOLUTIONS)[number];

/** Statuses a hold can act on; rejected, expired and recalled stock is already blocked. */
const HOLDABLE = ["quarantine", "released", "on_hold"];

function reasonText(v: string | null | undefined, field = "reason") {
  const r = (v ?? "").trim();
  if (r.length < 5) throw new DomainError("validation", "Give a reason of at least 5 characters.", { field });
  if (r.length > 1000) throw new DomainError("validation", "Reason is too long (max 1,000 characters).", { field });
  return r;
}

/** Finds a lot by id, BC:LOT payload or lot number inside the caller's sites. */
export async function resolveLotRef(q: Tx | typeof db, ctx: AuthContext, ref: string) {
  const v = (ref ?? "").trim();
  const number = v.toUpperCase().replace(/^BC:LOT:/, "");
  const [lot] = await q
    .select()
    .from(inventoryLots)
    .where(and(eq(inventoryLots.organizationId, ctx.organizationId), isUuid(v) ? eq(inventoryLots.id, v) : eq(inventoryLots.lotNumber, number)))
    .limit(1);
  if (!lot || !ctx.allowedSiteIds.includes(lot.siteId)) throw new DomainError("not_found", `Lot ${number || v} not found in your sites.`, { field: "lot" });
  return lot;
}

/** Finds a location by id, BC:LOC payload or code inside a site. */
export async function resolveLocationRef(q: Tx | typeof db, ctx: AuthContext, siteId: string, ref: string) {
  const v = (ref ?? "").trim();
  const code = v.toUpperCase().replace(/^BC:LOC:/, "");
  const [loc] = await q
    .select()
    .from(locations)
    .where(and(eq(locations.siteId, siteId), isUuid(v) ? eq(locations.id, v) : eq(locations.code, code)))
    .limit(1);
  if (!loc) throw new DomainError("not_found", `Location ${code || v} not found at this site.`, { field: "location" });
  ctx.requireSite(loc.siteId);
  return loc;
}

/** Locations of a site under an open hold (they refuse stock moved into them). */
export async function heldLocations(q: Tx | typeof db, siteId: string) {
  return q
    .select({ locationId: qualityHolds.locationId, holdNumber: qualityHolds.holdNumber })
    .from(qualityHolds)
    .where(and(eq(qualityHolds.siteId, siteId), inArray(qualityHolds.status, ["open", "investigating"]), sql`${qualityHolds.locationId} is not null`));
}

/** Throws 409 when the location is under an open QA hold. Exported for other movement commands. */
export async function assertLocationNotHeld(q: Tx | typeof db, location: { id: string; code: string; siteId: string }) {
  const held = (await heldLocations(q, location.siteId)).find((h) => h.locationId === location.id);
  if (held) throw new DomainError("blocked_lot", `Location ${location.code} is blocked by QA hold ${held.holdNumber}; stock cannot be moved into it.`, { rule: "V-LOC", holdNumber: held.holdNumber });
}

/** Location kinds that may receive stock leaving a location under an open hold (segregation only). */
export const HELD_STOCK_DESTINATION_KINDS = ["quarantine", "hold", "rejected"] as const;

/**
 * Location-hold rules for any move between two locations (V-LOC, US-2-10 AC3), shared by put-away,
 * scan-to-move, the lot move page and inter-site transfers:
 * - the destination must not be under an open QA hold;
 * - stock in a held location may leave only to a quarantine, hold or rejected location.
 */
export async function assertHoldAllowsMove(
  q: Tx | typeof db,
  from: { id: string; code: string; siteId: string },
  to: { id: string; code: string; siteId: string; kind: string },
) {
  await assertLocationNotHeld(q, to);
  const heldFrom = (await heldLocations(q, from.siteId)).find((h) => h.locationId === from.id);
  if (heldFrom && !(HELD_STOCK_DESTINATION_KINDS as readonly string[]).includes(to.kind)) {
    throw new DomainError("blocked_lot", `Stock in ${from.code} is under QA hold ${heldFrom.holdNumber} and can only move to a quarantine, hold or rejected location.`, {
      rule: "V-LOC",
      holdNumber: heldFrom.holdNumber,
    });
  }
}

async function writeTransition(tx: Tx, ctx: AuthContext, hold: { id: string; siteId: string }, from: string | null, to: string, reason: string | null) {
  await tx.insert(qualityHoldStateTransitions).values({ organizationId: ctx.organizationId, siteId: hold.siteId, qualityHoldId: hold.id, fromState: from, toState: to, actorId: ctx.userId, reason });
}

async function decide(tx: Tx, ctx: AuthContext, lot: { id: string; siteId: string; qualityStatus: string }, decision: string, to: string, reason: string) {
  const id = uuidv7();
  await tx.insert(dispositions).values({ id, organizationId: ctx.organizationId, siteId: lot.siteId, subjectType: "lot", subjectId: lot.id, decision, fromStatus: lot.qualityStatus, toStatus: to, reason, decidedBy: ctx.userId });
  await tx.update(inventoryLots).set({ qualityStatus: to }).where(eq(inventoryLots.id, lot.id));
  return id;
}

export type PlaceHoldInput = { scope: "lot" | "location"; lotRef?: string; locationId?: string; reasonCode: string; reason: string; idempotencyKey: string };

/** Places a QA hold on a lot or on a location (US-2-10 AC3, W06-07). */
export async function placeHold(ctx: AuthContext, input: PlaceHoldInput) {
  ctx.require("quality.hold.create");
  if (!isUuid(input.idempotencyKey)) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  if (!HOLD_REASON_VALUES.includes(input.reasonCode)) throw new DomainError("validation", "Choose a reason code.", { field: "reasonCode" });
  const reason = reasonText(input.reason);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"qh:" + input.idempotencyKey}))`);
    const [dup] = await tx
      .select({ id: qualityHolds.id, holdNumber: qualityHolds.holdNumber })
      .from(qualityHolds)
      .where(and(eq(qualityHolds.organizationId, ctx.organizationId), eq(qualityHolds.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (dup) return { holdId: dup.id, holdNumber: dup.holdNumber, lots: 0, replayed: true };

    let siteId: string;
    let lotId: string | null = null;
    let locationId: string | null = null;
    let targets: (typeof inventoryLots.$inferSelect)[] = [];
    if (input.scope === "lot") {
      const ref = await resolveLotRef(tx, ctx, input.lotRef ?? "");
      const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, ref.id)).for("update");
      ctx.requireSite(lot.siteId);
      if (!HOLDABLE.includes(lot.qualityStatus)) throw new DomainError("state", `Lot ${lot.lotNumber} is ${lot.qualityStatus} and already blocked; a hold adds nothing.`);
      const [open] = await tx
        .select({ n: qualityHolds.holdNumber })
        .from(qualityHolds)
        .where(and(eq(qualityHolds.lotId, lot.id), inArray(qualityHolds.status, ["open", "investigating"])))
        .limit(1);
      if (open) throw new DomainError("conflict", `Lot ${lot.lotNumber} is already under hold ${open.n}.`);
      siteId = lot.siteId;
      lotId = lot.id;
      targets = [lot];
    } else if (input.scope === "location") {
      if (!isUuid(input.locationId ?? "")) throw new DomainError("validation", "Choose a location.", { field: "locationId" });
      const [loc] = await tx.select().from(locations).where(eq(locations.id, input.locationId!)).limit(1);
      if (!loc || !ctx.allowedSiteIds.includes(loc.siteId)) throw new DomainError("not_found", "Location not found in your sites.", { field: "locationId" });
      ctx.requireSite(loc.siteId);
      await assertLocationNotHeld(tx, loc).catch(() => {
        throw new DomainError("conflict", `Location ${loc.code} is already under an open hold.`);
      });
      siteId = loc.siteId;
      locationId = loc.id;
      const ids = await tx
        .selectDistinct({ lotId: inventoryBalances.lotId })
        .from(inventoryBalances)
        .where(and(eq(inventoryBalances.locationId, loc.id), gt(inventoryBalances.qtyBase, "0")));
      if (ids.length) {
        targets = await tx
          .select()
          .from(inventoryLots)
          .where(inArray(inventoryLots.id, ids.map((i) => i.lotId)))
          .orderBy(asc(inventoryLots.id))
          .for("update");
      }
    } else {
      throw new DomainError("validation", "Choose whether to hold a lot or a location.", { field: "scope" });
    }

    const holdNumber = await nextNumber(tx, ctx.organizationId, "QH");
    const [hold] = await tx
      .insert(qualityHolds)
      .values({ organizationId: ctx.organizationId, siteId, holdNumber, status: "open", lotId, locationId, reasonCode: input.reasonCode, reason, openedBy: ctx.userId, statusChangedBy: ctx.userId, idempotencyKey: input.idempotencyKey })
      .returning();
    await writeTransition(tx, ctx, hold, null, "open", reason);
    const affected: { lotNumber: string; from: string }[] = [];
    for (const lot of targets) {
      if (!HOLDABLE.includes(lot.qualityStatus)) continue;
      const dispositionId = lot.qualityStatus === "on_hold" ? null : await decide(tx, ctx, lot, "hold", "on_hold", `Hold ${holdNumber}: ${reason}`);
      await tx.insert(qualityHoldLots).values({ qualityHoldId: hold.id, lotId: lot.id, previousStatus: lot.qualityStatus, holdDispositionId: dispositionId });
      affected.push({ lotNumber: lot.lotNumber, from: lot.qualityStatus });
    }
    await audit(tx, ctx, {
      action: "quality.hold.placed",
      entityType: "quality_hold",
      entityId: hold.id,
      entityNumber: holdNumber,
      siteId,
      reason,
      after: { scope: input.scope, lotId, locationId, reasonCode: input.reasonCode, lots: affected },
    });
    return { holdId: hold.id, holdNumber, lots: affected.length, replayed: false };
  });
}

async function lockHold(tx: Tx, ctx: AuthContext, holdId: string) {
  if (!isUuid(holdId)) throw new DomainError("not_found", "Hold not found in your sites.");
  const [h] = await tx.select().from(qualityHolds).where(and(eq(qualityHolds.id, holdId), eq(qualityHolds.organizationId, ctx.organizationId))).for("update").limit(1);
  if (!h || !ctx.allowedSiteIds.includes(h.siteId)) throw new DomainError("not_found", "Hold not found in your sites.");
  ctx.requireSite(h.siteId);
  return h;
}

/** open → investigating (the hold stays in force). */
export async function markHoldInvestigating(ctx: AuthContext, input: { holdId: string; note: string }) {
  ctx.require("quality.hold.create");
  const note = reasonText(input.note, "note");
  return db.transaction(async (tx) => {
    const h = await lockHold(tx, ctx, input.holdId);
    if (!(HOLD_TRANSITIONS.investigate.from as readonly string[]).includes(h.status)) throw new DomainError("state", `Hold ${h.holdNumber} is ${h.status}.`);
    await tx.update(qualityHolds).set({ status: "investigating", statusChangedAt: new Date(), statusChangedBy: ctx.userId }).where(eq(qualityHolds.id, h.id));
    await writeTransition(tx, ctx, h, h.status, "investigating", note);
    await audit(tx, ctx, { action: "quality.hold.state_changed", entityType: "quality_hold", entityId: h.id, entityNumber: h.holdNumber, siteId: h.siteId, reason: note, before: { status: h.status }, after: { status: "investigating" } });
    return { holdId: h.id };
  });
}

/**
 * Lifts a hold (quality.hold.approve, never the opener). Each lot still on hold only because of this hold
 * gets a closing disposition: back to its previous status (released lots past expiry become expired), or
 * rejected.
 */
export async function liftHold(ctx: AuthContext, input: { holdId: string; resolution: HoldResolution; reason: string }) {
  ctx.require("quality.hold.approve");
  if (!(HOLD_RESOLUTIONS as readonly string[]).includes(input.resolution)) throw new DomainError("validation", "Choose the resolution.", { field: "resolution" });
  const reason = reasonText(input.reason);
  return db.transaction(async (tx) => {
    const h = await lockHold(tx, ctx, input.holdId);
    if (!(HOLD_TRANSITIONS.lift.from as readonly string[]).includes(h.status)) throw new DomainError("state", `Hold ${h.holdNumber} is already ${h.status}.`);
    if (h.openedBy === ctx.userId) throw new DomainError("separation_of_duties", "You placed this hold, so another QA user must lift it (separation of duties).");
    const rows = await tx.select().from(qualityHoldLots).where(eq(qualityHoldLots.qualityHoldId, h.id)).orderBy(asc(qualityHoldLots.lotId));
    const results: { lotNumber: string; to: string; note?: string }[] = [];
    for (const r of rows) {
      const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, r.lotId)).for("update");
      if (lot.qualityStatus !== "on_hold") {
        results.push({ lotNumber: lot.lotNumber, to: lot.qualityStatus, note: "status changed during the hold; left as is" });
        continue;
      }
      const [other] = await tx
        .select({ n: qualityHolds.holdNumber })
        .from(qualityHolds)
        .leftJoin(qualityHoldLots, eq(qualityHoldLots.qualityHoldId, qualityHolds.id))
        .where(and(ne(qualityHolds.id, h.id), inArray(qualityHolds.status, ["open", "investigating"]), or(eq(qualityHolds.lotId, lot.id), eq(qualityHoldLots.lotId, lot.id))))
        .limit(1);
      if (other) {
        results.push({ lotNumber: lot.lotNumber, to: "on_hold", note: `still under hold ${other.n}` });
        continue;
      }
      let decision: string;
      let to: string;
      if (input.resolution === "rejected") {
        decision = "reject";
        to = "rejected";
      } else if (r.previousStatus === "on_hold") {
        results.push({ lotNumber: lot.lotNumber, to: "on_hold", note: "was on hold before this hold" });
        continue;
      } else if (r.previousStatus === "released" && isPastExpiry(lot.expiresOn)) {
        decision = "expire";
        to = "expired";
      } else {
        decision = "hold_lifted";
        to = r.previousStatus;
      }
      const dispositionId = await decide(tx, ctx, lot, decision, to, `Hold ${h.holdNumber} lifted (${input.resolution}): ${reason}`);
      await tx.update(qualityHoldLots).set({ closingDispositionId: dispositionId }).where(eq(qualityHoldLots.id, r.id));
      results.push({ lotNumber: lot.lotNumber, to });
    }
    const now = new Date();
    await tx
      .update(qualityHolds)
      .set({ status: "closed", resolution: input.resolution, closeReason: reason, closedBy: ctx.userId, closedAt: now, statusChangedAt: now, statusChangedBy: ctx.userId })
      .where(eq(qualityHolds.id, h.id));
    await writeTransition(tx, ctx, h, h.status, "closed", reason);
    await audit(tx, ctx, {
      action: "quality.hold.lifted",
      entityType: "quality_hold",
      entityId: h.id,
      entityNumber: h.holdNumber,
      siteId: h.siteId,
      reason,
      before: { status: h.status },
      after: { status: "closed", resolution: input.resolution, lots: results },
    });
    return { holdId: h.id, lots: results };
  });
}

const opener = alias(users, "hold_opener");
const closer = alias(users, "hold_closer");

/** Holds of the current site, newest first. */
export async function listHolds(ctx: AuthContext, f: { status?: string } = {}) {
  ctx.require("quality.hold.view");
  ctx.requireSite(ctx.currentSiteId);
  const conds = [eq(qualityHolds.siteId, ctx.currentSiteId)];
  if (f.status === "active") conds.push(inArray(qualityHolds.status, ["open", "investigating"]));
  else if (f.status && ["open", "investigating", "closed"].includes(f.status)) conds.push(eq(qualityHolds.status, f.status));
  return db
    .select({
      id: qualityHolds.id,
      holdNumber: qualityHolds.holdNumber,
      status: qualityHolds.status,
      reasonCode: qualityHolds.reasonCode,
      reason: qualityHolds.reason,
      openedAt: qualityHolds.openedAt,
      openedByName: opener.displayName,
      resolution: qualityHolds.resolution,
      lotNumber: inventoryLots.lotNumber,
      locationCode: locations.code,
      lotCount: sql<number>`(select count(*) from ${qualityHoldLots} hl where hl.quality_hold_id = "quality_holds"."id")::int`,
    })
    .from(qualityHolds)
    .innerJoin(opener, eq(opener.id, qualityHolds.openedBy))
    .leftJoin(inventoryLots, eq(inventoryLots.id, qualityHolds.lotId))
    .leftJoin(locations, eq(locations.id, qualityHolds.locationId))
    .where(and(...conds))
    .orderBy(desc(qualityHolds.openedAt))
    .limit(200);
}

export async function getHold(ctx: AuthContext, holdId: string) {
  ctx.require("quality.hold.view");
  if (!isUuid(holdId)) throw new DomainError("not_found", "Hold not found in your sites.");
  const [row] = await db
    .select({ hold: qualityHolds, openedByName: opener.displayName, closedByName: closer.displayName, lotNumber: inventoryLots.lotNumber, locationCode: locations.code, locationName: locations.name })
    .from(qualityHolds)
    .innerJoin(opener, eq(opener.id, qualityHolds.openedBy))
    .leftJoin(closer, eq(closer.id, qualityHolds.closedBy))
    .leftJoin(inventoryLots, eq(inventoryLots.id, qualityHolds.lotId))
    .leftJoin(locations, eq(locations.id, qualityHolds.locationId))
    .where(and(eq(qualityHolds.id, holdId), eq(qualityHolds.organizationId, ctx.organizationId), inArray(qualityHolds.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Hold not found in your sites.");
  ctx.requireSite(row.hold.siteId);
  const lots = await db
    .select({
      lotId: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      qualityStatus: inventoryLots.qualityStatus,
      previousStatus: qualityHoldLots.previousStatus,
      itemCode: sql<string>`coalesce(${materials.code}, ${products.skuCode})`,
      itemName: sql<string>`coalesce(${materials.name}, ${products.name})`,
      baseUom: inventoryLots.baseUom,
      onHand: sql<string>`coalesce((select sum(b.qty_base) from ${inventoryBalances} b where b.lot_id = ${inventoryLots.id}), 0)::text`,
    })
    .from(qualityHoldLots)
    .innerJoin(inventoryLots, eq(inventoryLots.id, qualityHoldLots.lotId))
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .where(eq(qualityHoldLots.qualityHoldId, holdId))
    .orderBy(asc(inventoryLots.lotNumber));
  const timeline = await db
    .select({ from: qualityHoldStateTransitions.fromState, to: qualityHoldStateTransitions.toState, reason: qualityHoldStateTransitions.reason, at: qualityHoldStateTransitions.occurredAt, by: users.displayName })
    .from(qualityHoldStateTransitions)
    .innerJoin(users, eq(users.id, qualityHoldStateTransitions.actorId))
    .where(eq(qualityHoldStateTransitions.qualityHoldId, holdId))
    .orderBy(asc(qualityHoldStateTransitions.occurredAt));
  const active = row.hold.status !== "closed";
  return {
    ...row.hold,
    openedByName: row.openedByName,
    closedByName: row.closedByName,
    lotNumber: row.lotNumber,
    locationCode: row.locationCode,
    locationName: row.locationName,
    reasonLabel: HOLD_REASON_CODES.find((r) => r.code === row.hold.reasonCode)?.label ?? row.hold.reasonCode,
    lots,
    timeline,
    can: {
      lift: active && ctx.can("quality.hold.approve") && row.hold.openedBy !== ctx.userId,
      liftBlockedReason: active && ctx.can("quality.hold.approve") && row.hold.openedBy === ctx.userId ? "You placed this hold; another QA user must lift it." : null,
      investigate: row.hold.status === "open" && ctx.can("quality.hold.create"),
    },
  };
}

/** Locations of the current site for the hold form. */
export async function holdFormData(ctx: AuthContext) {
  ctx.require("quality.hold.create");
  ctx.requireSite(ctx.currentSiteId);
  const locs = await db
    .select({ id: locations.id, code: locations.code, name: locations.name, kind: locations.kind })
    .from(locations)
    .where(and(eq(locations.siteId, ctx.currentSiteId), eq(locations.isActive, true)))
    .orderBy(asc(locations.code));
  const held = new Set((await heldLocations(db, ctx.currentSiteId)).map((h) => h.locationId));
  return { locations: locs.map((l) => ({ ...l, held: held.has(l.id) })), reasonCodes: HOLD_REASON_CODES.map((r) => ({ ...r })) };
}

/* ------------------------------------------------------------------ held stock issue (CX-LOT) */

/** Locations of the current site for the held-stock issue form. */
export async function heldIssueFormData(ctx: AuthContext) {
  ctx.require("inventory.held_stock_issue.approve");
  ctx.requireSite(ctx.currentSiteId);
  return db
    .select({ id: locations.id, code: locations.code, name: locations.name, kind: locations.kind })
    .from(locations)
    .where(and(eq(locations.siteId, ctx.currentSiteId), eq(locations.isActive, true)))
    .orderBy(asc(locations.code));
}

export const HELD_ISSUE_PURPOSES = ["sampling", "rework", "destruction"] as const;
export type HeldIssuePurpose = (typeof HELD_ISSUE_PURPOSES)[number];

/**
 * Controlled exception: issue quarantined or on-hold stock for sampling, rework or destruction
 * (inventory.held_stock_issue.approve, qa_qc). Expired, rejected and recalled stock can never be issued.
 */
export async function issueHeldStock(
  ctx: AuthContext,
  input: { lotRef: string; fromLocationId: string; qty: string; purpose: HeldIssuePurpose; reason: string; idempotencyKey: string },
) {
  ctx.require("inventory.held_stock_issue.approve");
  if (!isUuid(input.idempotencyKey)) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  if (!(HELD_ISSUE_PURPOSES as readonly string[]).includes(input.purpose)) throw new DomainError("validation", "Choose the purpose.", { field: "purpose" });
  const reason = reasonText(input.reason);
  let qty: Decimal;
  try {
    qty = new Decimal(String(input.qty).trim());
  } catch {
    throw new DomainError("validation", "Enter a quantity.", { field: "qty" });
  }
  if (!qty.isFinite() || qty.lte(0)) throw new DomainError("validation", "Quantity must be greater than zero.", { field: "qty" });
  const key = `held-issue:${input.idempotencyKey}`;
  return db.transaction(async (tx) => {
    const ref = await resolveLotRef(tx, ctx, input.lotRef);
    const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, ref.id)).for("update");
    ctx.requireSite(lot.siteId);
    const [dup] = await tx.select({ id: stockMovements.id }).from(stockMovements).where(and(eq(stockMovements.organizationId, ctx.organizationId), eq(stockMovements.idempotencyKey, key))).limit(1);
    if (dup) return { movementId: dup.id, replayed: true };
    if (!["quarantine", "on_hold"].includes(lot.qualityStatus) || isPastExpiry(lot.expiresOn)) {
      throw new DomainError(
        "blocked_lot",
        `Lot ${lot.lotNumber} is ${isPastExpiry(lot.expiresOn) && lot.qualityStatus !== "expired" ? "past its expiry date" : lot.qualityStatus.replace("_", " ")}; expired, rejected and recalled stock can never be issued, not even by exception.`,
      );
    }
    if (lot.baseUom === "pcs" && !qty.isInteger()) throw new DomainError("validation", "This lot is counted in pieces; enter a whole number.", { field: "qty" });
    const [loc] = await tx.select().from(locations).where(and(eq(locations.id, input.fromLocationId), eq(locations.siteId, lot.siteId))).limit(1);
    if (!loc) throw new DomainError("validation", "Choose a location of this lot's site.", { field: "fromLocationId" });
    const { movement } = await postMovement(tx, ctx, {
      movementType: "consumption",
      lotId: lot.id,
      fromLocationId: loc.id,
      qtyBase: qty,
      sourceDocumentType: "held_stock_issue",
      sourceDocumentNumber: lot.lotNumber,
      reason: `${input.purpose}: ${reason}`,
      idempotencyKey: key,
      meta: { exception: "CX-LOT", purpose: input.purpose, qualityStatusAtPosting: lot.qualityStatus, approvedBy: ctx.userId },
    });
    await audit(tx, ctx, {
      action: "inventory.stock_movement.held_stock_issued",
      entityType: "stock_movement",
      entityId: movement.id,
      entityNumber: lot.lotNumber,
      siteId: lot.siteId,
      reason,
      after: { lotNumber: lot.lotNumber, status: lot.qualityStatus, purpose: input.purpose, qtyBase: qty.toString(), baseUom: lot.baseUom, from: loc.code },
    });
    return { movementId: movement.id, replayed: false };
  });
}

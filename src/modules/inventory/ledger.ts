import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import type { Tx } from "@/db/client";
import { inventoryBalances, inventoryLots, locations, stockMovements } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { assertLocationsOpen, checkEnteredQuantity } from "@/modules/masterdata";
import { assertLocationsNotFrozen } from "./freeze";

export type MovementType = "receipt" | "issue" | "transfer" | "consumption" | "output" | "adjustment" | "return" | "shipment" | "reversal";

export type PostMovementInput = {
  movementType: MovementType;
  lotId: string;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  qtyBase: Decimal.Value;
  /** What the user typed, when it differs from the base unit (ADR-010). Defaults to the base pair. */
  entered?: { qty: Decimal.Value; uom: string };
  sourceDocumentType?: string;
  sourceDocumentId?: string;
  sourceDocumentNumber?: string;
  reason?: string;
  idempotencyKey?: string;
  correlationId?: string;
  /** For movementType "reversal" only (reversal.ts, receipt reversal US-2-07): the movement it reverses. */
  reversalOfId?: string;
  /**
   * Stock count posting only (counts.ts postCount): that count's own freeze does not block its
   * adjustment rows. Every other posting is refused while a count freezes either location (V-FREEZE).
   */
  freezeExemptCountId?: string;
  meta?: Record<string, unknown>;
};

/**
 * Entered vs base quantity (ADR-010, V-UOM): checked against the approved conversions of the
 * organization's UOM table (masterdata `checkEnteredQuantity`, US-1-21). The MVP's fixed metric
 * factors (g/kg/mg, mL/L) are installed as approved reference conversions, so behaviour is
 * unchanged; material-specific conversions (pack units, density) now apply too.
 */
/** Location sides each movement type must carry (mirrors ck_stock_movements_locations). */
const SIDES: Record<Exclude<MovementType, "reversal" | "adjustment">, { from: boolean; to: boolean }> = {
  receipt: { from: false, to: true },
  output: { from: false, to: true },
  return: { from: false, to: true },
  issue: { from: true, to: false },
  consumption: { from: true, to: false },
  shipment: { from: true, to: false },
  transfer: { from: true, to: true },
};

function checkSides(input: PostMovementInput) {
  const from = !!input.fromLocationId;
  const to = !!input.toLocationId;
  const t = input.movementType;
  if (t === "reversal") {
    if (!input.reversalOfId) throw new DomainError("validation", "A reversal must link to the movement it reverses.");
    if (!from && !to) throw new DomainError("validation", "A reversal needs a location.");
    return;
  }
  if (input.reversalOfId) throw new DomainError("validation", "Only a reversal may link to another movement.");
  if (t === "adjustment") {
    if (from === to) throw new DomainError("validation", "An adjustment either adds to or removes from exactly one location.");
    return;
  }
  const rule = SIDES[t];
  if (!rule) throw new DomainError("validation", `Unknown movement type ${t}.`);
  if (rule.from !== from || rule.to !== to) {
    throw new DomainError("validation", `A ${t} movement needs ${rule.from ? "a source" : "no source"} and ${rule.to ? "a destination" : "no destination"} location.`);
  }
  if (t === "transfer" && input.fromLocationId === input.toLocationId) throw new DomainError("validation", "Choose a different destination location.");
}

/**
 * A-PM-06 (setting `inventory.role_movement_types`): a user whose every role is listed may post
 * only the listed movement types; for a transfer, the source or destination must be of one of the
 * listed location kinds. A user holding any unlisted role is not restricted by this rule.
 */
async function assertRoleMayPost(tx: Tx, ctx: AuthContext, siteId: string, type: MovementType, kinds: { from?: string; to?: string }) {
  if (ctx.roleCodes.length === 0) return;
  const rules = await getSetting(tx, ctx.organizationId, "inventory.role_movement_types", siteId);
  const applicable = ctx.roleCodes.map((r) => rules[r]);
  if (applicable.some((r) => !r)) return;
  const allowed = applicable.filter((r) => r!.movementTypes.includes(type));
  if (allowed.length === 0) {
    const types = [...new Set(applicable.flatMap((r) => r!.movementTypes))].join(", ");
    throw new DomainError("forbidden", `Your role may post only these movement types: ${types}.`);
  }
  if (type === "transfer") {
    if (allowed.some((r) => !r!.transferMustTouchLocationKinds)) return;
    const need = new Set(allowed.flatMap((r) => r!.transferMustTouchLocationKinds ?? []));
    if (!need.has(kinds.from ?? "") && !need.has(kinds.to ?? "")) {
      throw new DomainError("forbidden", `Your role may move stock only to or from ${[...need].join(" / ")} locations.`);
    }
  }
}

/**
 * Locks lots in id order (FOR UPDATE). Every posting path locks lots before balances and
 * allocates document numbers last, so concurrent postings can never deadlock
 * (docs/data-model.md §5.4: keys → lots → balances → numbering rule).
 */
export async function lockLots(tx: Tx, lotIds: string[]) {
  const ids = [...new Set(lotIds)].sort();
  if (ids.length === 0) return [];
  return tx.select().from(inventoryLots).where(inArray(inventoryLots.id, ids)).orderBy(asc(inventoryLots.id)).for("update");
}

/**
 * Posts one immutable stock movement and updates the balance projection in the same transaction
 * (ADR-006). Order: lot lock → idempotency re-check → validation (incl. V-FREEZE, location share
 * locks) → balance locks (location id order) → projection update → ledger insert → audit
 * `inventory.stock_movement.posted` (the only audit row per movement; callers add document-level events).
 * Balances never go negative (this check plus the database CHECK). A repeated idempotency key
 * returns the original movement. Callers check the command permission; this function checks site
 * scope, locations, quantities and the role movement-type rule.
 */
export async function postMovement(tx: Tx, ctx: AuthContext, input: PostMovementInput) {
  const qty = new Decimal(input.qtyBase);
  if (!qty.isFinite() || qty.lte(0)) throw new DomainError("validation", "Quantity must be greater than zero.");
  checkSides(input);

  const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, input.lotId)).for("update").limit(1);
  if (!lot || lot.organizationId !== ctx.organizationId) throw new DomainError("not_found", "Lot not found.");
  ctx.requireSite(lot.siteId);

  // Checked after the lot lock: a concurrent retry with the same key waits here, then sees the first row.
  if (input.idempotencyKey) {
    const [existing] = await tx
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.organizationId, ctx.organizationId), eq(stockMovements.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (existing) {
      if (existing.lotId !== lot.id) throw new DomainError("conflict", "This request key was already used for a different lot.");
      return { movement: existing, replayed: true };
    }
  }

  const locIds = [input.fromLocationId, input.toLocationId].filter((x): x is string => !!x);
  const locs = await tx.select({ id: locations.id, siteId: locations.siteId, kind: locations.kind }).from(locations).where(inArray(locations.id, locIds));
  const fromLoc = locs.find((l) => l.id === input.fromLocationId);
  const toLoc = locs.find((l) => l.id === input.toLocationId);
  if ((input.fromLocationId && fromLoc?.siteId !== lot.siteId) || (input.toLocationId && toLoc?.siteId !== lot.siteId)) {
    throw new DomainError("validation", "Locations must belong to the lot's site.");
  }
  await assertRoleMayPost(tx, ctx, lot.siteId, input.movementType, { from: fromLoc?.kind, to: toLoc?.kind });
  // V-FREEZE for every movement type and every caller (W1C counts): shares the location rows with a count release.
  await assertLocationsNotFrozen(tx, locIds, { exceptCountId: input.freezeExemptCountId });
  // US-1-20: a blocked or inactive location takes no movement in or out (W2G).
  await assertLocationsOpen(tx, locIds);
  const entered = await checkEnteredQuantity(tx, ctx.organizationId, qty, lot.baseUom, input.entered, lot.materialId);

  if (locIds.length) {
    await tx
      .select({ id: inventoryBalances.id })
      .from(inventoryBalances)
      .where(and(eq(inventoryBalances.lotId, lot.id), inArray(inventoryBalances.locationId, [...locIds].sort())))
      .orderBy(inventoryBalances.locationId)
      .for("update");
  }

  if (input.fromLocationId) {
    const [bal] = await tx
      .select()
      .from(inventoryBalances)
      .where(and(eq(inventoryBalances.lotId, lot.id), eq(inventoryBalances.locationId, input.fromLocationId)))
      .limit(1);
    const onHand = new Decimal(bal?.qtyBase ?? 0);
    if (onHand.lt(qty)) {
      throw new DomainError(
        "insufficient_stock",
        `Not enough stock of lot ${lot.lotNumber} at this location: ${onHand.toString()} ${lot.baseUom} on hand, ${qty.toString()} requested.`,
        { lotId: lot.id, locationId: input.fromLocationId, onHand: onHand.toString(), requested: qty.toString() },
      );
    }
    await tx
      .update(inventoryBalances)
      .set({ qtyBase: sql`${inventoryBalances.qtyBase} - ${qty.toString()}`, updatedAt: new Date() })
      .where(eq(inventoryBalances.id, bal!.id));
  }

  if (input.toLocationId) {
    await tx
      .insert(inventoryBalances)
      .values({ siteId: lot.siteId, lotId: lot.id, locationId: input.toLocationId, qtyBase: qty.toString() })
      .onConflictDoUpdate({
        target: [inventoryBalances.lotId, inventoryBalances.locationId],
        set: { qtyBase: sql`${inventoryBalances.qtyBase} + ${qty.toString()}`, updatedAt: new Date() },
      });
  }

  const [movement] = await tx
    .insert(stockMovements)
    .values({
      organizationId: ctx.organizationId,
      siteId: lot.siteId,
      movementType: input.movementType,
      lotId: lot.id,
      fromLocationId: input.fromLocationId ?? null,
      toLocationId: input.toLocationId ?? null,
      qtyBase: qty.toString(),
      baseUom: lot.baseUom,
      qtyEntered: entered.qty.toString(),
      enteredUom: entered.uom,
      qualityStatusAtPosting: lot.qualityStatus,
      correlationId: input.correlationId ?? null,
      sourceDocumentType: input.sourceDocumentType ?? null,
      sourceDocumentId: input.sourceDocumentId ?? null,
      sourceDocumentNumber: input.sourceDocumentNumber ?? null,
      reason: input.reason ?? null,
      reversalOfId: input.reversalOfId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      postedBy: ctx.userId,
      meta: input.meta ?? null,
    })
    .returning();

  await audit(tx, ctx, {
    action: "inventory.stock_movement.posted",
    entityType: "stock_movement",
    entityId: movement.id,
    entityNumber: input.sourceDocumentNumber ?? null,
    siteId: lot.siteId,
    reason: input.reason ?? null,
    correlationId: input.correlationId ?? null,
    after: {
      movementType: movement.movementType,
      lotNumber: lot.lotNumber,
      qtyBase: movement.qtyBase,
      baseUom: movement.baseUom,
      fromLocationId: movement.fromLocationId,
      toLocationId: movement.toLocationId,
      sourceDocumentType: movement.sourceDocumentType,
      reversalOfId: movement.reversalOfId,
      // Caller context (box, location codes, counted quantities…) so the one audit row per movement is self-explanatory.
      ...(input.meta ? { meta: input.meta } : {}),
    },
  });
  return { movement, replayed: false };
}

/**
 * Posts several movements in one transaction (multi-lot commands). All lots are locked up front in
 * id order, so two multi-lot commands touching the same lots in different orders cannot deadlock.
 */
export async function postMovements(tx: Tx, ctx: AuthContext, inputs: PostMovementInput[]) {
  await lockLots(tx, inputs.map((i) => i.lotId));
  const out = [];
  for (const i of inputs) out.push(await postMovement(tx, ctx, i));
  return out;
}

/** Statuses that block issue, consumption and shipment through normal flows. */
export const BLOCKED_STATUSES = ["quarantine", "on_hold", "rejected", "expired", "recalled"] as const;

/** Throws unless the lot is released and not past its expiry date. */
export function assertLotUsable(lot: { lotNumber: string; qualityStatus: string; expiresOn: string | null }, today = new Date()) {
  if (lot.qualityStatus !== "released") {
    const words: Record<string, string> = { quarantine: "in quarantine", on_hold: "on QA hold", rejected: "rejected", expired: "expired", recalled: "recalled" };
    throw new DomainError("blocked_lot", `Lot ${lot.lotNumber} is ${words[lot.qualityStatus] ?? lot.qualityStatus} and cannot be used until QA releases it.`);
  }
  if (lot.expiresOn && new Date(lot.expiresOn + "T23:59:59+08:00") < today) {
    throw new DomainError("blocked_lot", `Lot ${lot.lotNumber} expired on ${lot.expiresOn} and cannot be used.`);
  }
}

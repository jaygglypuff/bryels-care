import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import type { Tx } from "@/db/client";
import { inventoryBalances, inventoryLots, stockMovements } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";

export type MovementType = "receipt" | "issue" | "transfer" | "consumption" | "output" | "adjustment" | "shipment" | "reversal";

export type PostMovementInput = {
  movementType: MovementType;
  lotId: string;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  qtyBase: Decimal.Value;
  sourceDocumentType?: string;
  sourceDocumentId?: string;
  sourceDocumentNumber?: string;
  reason?: string;
  idempotencyKey?: string;
  meta?: Record<string, unknown>;
};

/**
 * Posts one immutable stock movement and updates the balance projection in the same transaction
 * (ADR-006). Balance rows are locked in a deterministic order; balances can never go negative
 * (database CHECK plus this check). A repeated idempotency key returns the original movement.
 */
export async function postMovement(tx: Tx, ctx: AuthContext, input: PostMovementInput) {
  const qty = new Decimal(input.qtyBase);
  if (qty.lte(0)) throw new DomainError("validation", "Quantity must be greater than zero.");

  if (input.idempotencyKey) {
    const [existing] = await tx
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.organizationId, ctx.organizationId), eq(stockMovements.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (existing) return { movement: existing, replayed: true };
  }

  const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, input.lotId)).for("update").limit(1);
  if (!lot) throw new DomainError("not_found", "Lot not found.");
  ctx.requireSite(lot.siteId);

  const locIds = [input.fromLocationId, input.toLocationId].filter((x): x is string => !!x).sort();
  if (locIds.length) {
    await tx
      .select({ id: inventoryBalances.id })
      .from(inventoryBalances)
      .where(and(eq(inventoryBalances.lotId, lot.id), inArray(inventoryBalances.locationId, locIds)))
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
      sourceDocumentType: input.sourceDocumentType ?? null,
      sourceDocumentId: input.sourceDocumentId ?? null,
      sourceDocumentNumber: input.sourceDocumentNumber ?? null,
      reason: input.reason ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      postedBy: ctx.userId,
      meta: input.meta ?? null,
    })
    .returning();
  return { movement, replayed: false };
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

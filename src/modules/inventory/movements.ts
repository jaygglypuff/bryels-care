import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { inventoryLots, locations, materials, products, shipments, stockMovements, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { postMovement, type MovementType } from "./ledger";
import { allowedDestinationKinds, isUuid } from "./lots";

export const MOVEMENT_TYPES: MovementType[] = ["receipt", "transfer", "consumption", "output", "adjustment", "shipment", "reversal"];

const fromLoc = alias(locations, "from_loc");
const toLoc = alias(locations, "to_loc");

/** Site ledger (latest 200) for the current site, newest first. */
export async function listMovements(ctx: AuthContext, f: { type?: string } = {}) {
  ctx.require("inventory.movement.view");
  ctx.requireSite(ctx.currentSiteId);
  const conds = [eq(stockMovements.siteId, ctx.currentSiteId)];
  if (f.type && (MOVEMENT_TYPES as string[]).includes(f.type)) conds.push(eq(stockMovements.movementType, f.type));
  return db
    .select({
      id: stockMovements.id,
      movementType: stockMovements.movementType,
      qtyBase: stockMovements.qtyBase,
      baseUom: stockMovements.baseUom,
      lotId: stockMovements.lotId,
      lotNumber: inventoryLots.lotNumber,
      itemCode: materials.code,
      itemName: materials.name,
      productSku: products.skuCode,
      productName: products.name,
      fromCode: fromLoc.code,
      toCode: toLoc.code,
      sourceDocumentType: stockMovements.sourceDocumentType,
      sourceDocumentId: stockMovements.sourceDocumentId,
      sourceDocumentNumber: stockMovements.sourceDocumentNumber,
      shipmentOrderId: shipments.salesOrderId,
      reason: stockMovements.reason,
      postedAt: stockMovements.postedAt,
      postedBy: users.displayName,
    })
    .from(stockMovements)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockMovements.lotId))
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .leftJoin(fromLoc, eq(fromLoc.id, stockMovements.fromLocationId))
    .leftJoin(toLoc, eq(toLoc.id, stockMovements.toLocationId))
    .leftJoin(shipments, and(eq(stockMovements.sourceDocumentType, "shipment"), eq(shipments.id, stockMovements.sourceDocumentId)))
    .innerJoin(users, eq(users.id, stockMovements.postedBy))
    .where(and(...conds))
    .orderBy(desc(stockMovements.postedAt))
    .limit(200);
}

/** Link target for a movement's source document, or null when there is no page for it. */
export function documentHref(m: { sourceDocumentType: string | null; sourceDocumentId: string | null; shipmentOrderId?: string | null }): string | null {
  if (!m.sourceDocumentId) return null;
  switch (m.sourceDocumentType) {
    case "goods_receipt":
      return `/inventory/receive/${m.sourceDocumentId}`;
    case "batch":
      return `/production/${m.sourceDocumentId}`;
    case "sales_order":
      return `/sales/${m.sourceDocumentId}`;
    case "shipment":
      return m.shipmentOrderId ? `/sales/${m.shipmentOrderId}` : null;
    default:
      return null;
  }
}

export type TransferInput = {
  lotId: string;
  fromLocationId: string;
  toLocationId: string;
  qty: string;
  reason: string;
  idempotencyKey: string;
};

/**
 * Moves stock of one lot between two locations of its site as a single transfer movement.
 * Destination kind must be allowed for the lot's status (quarantined and held lots stay in
 * quarantine-type locations). Retrying with the same idempotency key returns the first result.
 */
export async function transferStock(ctx: AuthContext, input: TransferInput) {
  ctx.require("inventory.movement.post");
  if (!isUuid(input.lotId)) throw new DomainError("not_found", "Lot not found in your sites.");
  const qty = new Decimal(input.qty);
  if (!qty.isFinite() || qty.lte(0)) throw new DomainError("validation", "Quantity must be greater than zero.");
  if (input.fromLocationId === input.toLocationId) throw new DomainError("validation", "Choose a different destination location.");
  const key = `transfer:${input.idempotencyKey}`;

  return db.transaction(async (tx) => {
    // Lock the lot first so a concurrent retry with the same key waits, then sees the first result.
    const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, input.lotId)).for("update").limit(1);
    if (!lot || !ctx.allowedSiteIds.includes(lot.siteId)) throw new DomainError("not_found", "Lot not found in your sites.");
    ctx.requireSite(lot.siteId);

    const [existing] = await tx
      .select({ id: stockMovements.id, number: stockMovements.sourceDocumentNumber, lotId: stockMovements.lotId })
      .from(stockMovements)
      .where(and(eq(stockMovements.organizationId, ctx.organizationId), eq(stockMovements.idempotencyKey, key)))
      .limit(1);
    if (existing) return { movementId: existing.id, number: existing.number ?? "", lotId: existing.lotId, replayed: true };

    const locs = await tx.select().from(locations).where(eq(locations.siteId, lot.siteId));
    const from = locs.find((l) => l.id === input.fromLocationId);
    const to = locs.find((l) => l.id === input.toLocationId);
    if (!from) throw new DomainError("validation", "The source location is not a location of this lot's site.");
    if (!to || !to.isActive) throw new DomainError("validation", "The destination location is not an active location of this lot's site.");
    if (lot.baseUom === "pcs" && !qty.isInteger()) throw new DomainError("validation", "This lot is counted in pieces; enter a whole number.");

    const kinds = allowedDestinationKinds(lot.qualityStatus, lot.expiresOn);
    if (!kinds.includes(to.kind)) {
      throw new DomainError(
        "blocked_lot",
        `Lot ${lot.lotNumber} is ${lot.qualityStatus.replace("_", " ")}${lot.qualityStatus === "released" ? " but past its expiry date" : ""}; it can only move to ${kinds.join(" / ")} locations, not ${to.kind} (${to.code}).`,
      );
    }

    const number = await nextNumber(tx, ctx.organizationId, "MOV");
    const { movement } = await postMovement(tx, ctx, {
      movementType: "transfer",
      lotId: lot.id,
      fromLocationId: from.id,
      toLocationId: to.id,
      qtyBase: qty,
      sourceDocumentType: "stock_transfer",
      sourceDocumentNumber: number,
      reason: input.reason,
      idempotencyKey: key,
      meta: { fromCode: from.code, toCode: to.code },
    });
    await audit(tx, ctx, {
      action: "inventory.stock_movement.transferred",
      entityType: "stock_movement",
      entityId: movement.id,
      entityNumber: number,
      siteId: lot.siteId,
      reason: input.reason,
      after: { lotNumber: lot.lotNumber, qtyBase: qty.toString(), baseUom: lot.baseUom, from: from.code, to: to.code },
    });
    return { movementId: movement.id, number, lotId: lot.id, replayed: false };
  });
}

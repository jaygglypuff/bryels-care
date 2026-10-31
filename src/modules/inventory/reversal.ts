import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import Decimal from "decimal.js";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { inventoryLots, locations, materials, products, stockMovements, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { lockLots, postMovement } from "./ledger";
import { allowedDestinationKinds, isUuid } from "./lots";

/**
 * Movement types this service may reverse. Receipts, consumption, output and shipments are
 * reversed by their source documents (goods receipt void, production posting reversal, customer
 * return) so the document and the ledger never disagree (docs/testing.md §4.2,
 * `ledger.reversal.receipt_with_lot`). Assumption A-W1A-03.
 */
export const REVERSIBLE_MOVEMENT_TYPES = ["transfer", "adjustment", "issue"] as const;

/** Word typed into the confirm dialog (docs/ux-system.md component 5.16, typed confirmation). */
export const REVERSAL_CONFIRMATION_WORD = "REVERSE";

export type ReverseMovementInput = {
  movementId: string;
  reason: string;
  idempotencyKey: string;
  confirmation: string;
  /** Optional corrected transfer posted in the same transaction, sharing the reversal's correlation id. */
  replacement?: { fromLocationId: string; toLocationId: string; qty: string } | null;
};

export type ReverseMovementResult = { reversalId: string; replacementId: string | null; replacementNumber: string | null; correlationId: string; lotId: string; replayed: boolean };

/**
 * inventory.movement.void: corrects a posted movement by a linked `reversal` row (from = original
 * to, to = original from) that passes the same validations as any posting (409 when the stock has
 * since moved), plus an optional replacement transfer. The original row is never touched; a row
 * can be reversed once (partial unique index on reversal_of_id); a reversal is never reversed.
 * Audit `inventory.stock_movement.reversed` (sensitive). Lock order: lot → balances → numbering.
 */
export async function reverseMovement(ctx: AuthContext, input: ReverseMovementInput): Promise<ReverseMovementResult> {
  ctx.require("inventory.movement.void");
  if (input.replacement) ctx.require("inventory.movement.post");
  if (!isUuid(input.movementId)) throw new DomainError("not_found", "Movement not found in your sites.");
  if (!isUuid(input.idempotencyKey)) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 3 || reason.length > 500) throw new DomainError("validation", "Give the reason for the correction (3 to 500 characters).", { field: "reason" });
  if ((input.confirmation ?? "").trim().toUpperCase() !== REVERSAL_CONFIRMATION_WORD) {
    throw new DomainError("validation", `Type ${REVERSAL_CONFIRMATION_WORD} to confirm the reversal.`, { field: "confirmation" });
  }
  const key = `reverse:${input.idempotencyKey}`;
  const replaceKey = `replace:${input.idempotencyKey}`;

  return db.transaction(async (tx) => {
    const [original] = await tx
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.id, input.movementId), eq(stockMovements.organizationId, ctx.organizationId)))
      .limit(1);
    if (!original || !ctx.allowedSiteIds.includes(original.siteId)) throw new DomainError("not_found", "Movement not found in your sites.");
    ctx.requireSite(original.siteId);

    const [lot] = await lockLots(tx, [original.lotId]);

    // Checked after the lot lock, so a concurrent retry with the same key waits and then replays.
    const prior = await tx
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.organizationId, ctx.organizationId), inArray(stockMovements.idempotencyKey, [key, replaceKey])));
    const rev = prior.find((r) => r.idempotencyKey === key);
    if (rev) {
      const rows = prior;
      if (rev.reversalOfId !== original.id) throw new DomainError("conflict", "This request key was already used for a different correction.");
      const rep = rows.find((r) => r.idempotencyKey === replaceKey) ?? null;
      return { reversalId: rev.id, replacementId: rep?.id ?? null, replacementNumber: rep?.sourceDocumentNumber ?? null, correlationId: rev.correlationId!, lotId: lot.id, replayed: true };
    }

    if (original.movementType === "reversal") throw new DomainError("state", "A reversal cannot itself be reversed. Post a new movement instead.");
    if (!(REVERSIBLE_MOVEMENT_TYPES as readonly string[]).includes(original.movementType)) {
      throw new DomainError(
        "state",
        `A ${original.movementType} is corrected from its source document (${original.sourceDocumentType ?? "document"} ${original.sourceDocumentNumber ?? ""}), not here.`.replace(" )", ")"),
      );
    }
    const [already] = await tx.select({ id: stockMovements.id }).from(stockMovements).where(eq(stockMovements.reversalOfId, original.id)).limit(1);
    if (already) throw new DomainError("conflict", "This movement has already been reversed.");
    // A movement that moved or changed a box (W1C) also changed the box's location or contents; a bare
    // ledger reversal would leave the box record wrong, so the box is corrected through its own flow.
    const boxId = (original.meta as { containerId?: string | null } | null)?.containerId;
    if (boxId) {
      throw new DomainError(
        "state",
        original.movementType === "adjustment"
          ? "This adjustment changed a box's contents. Correct it with a new stock adjustment on the same box (with a reason) instead."
          : "This movement moved a box. Move the box back with scan-to-move (or undo it within the undo window) so the box and the ledger stay in step.",
        { rule: "box_movement", containerId: boxId },
      );
    }

    const correlationId = uuidv7();
    const { movement: reversal } = await postMovement(tx, ctx, {
      movementType: "reversal",
      lotId: original.lotId,
      fromLocationId: original.toLocationId,
      toLocationId: original.fromLocationId,
      qtyBase: original.qtyBase,
      sourceDocumentType: original.sourceDocumentType ?? undefined,
      sourceDocumentId: original.sourceDocumentId ?? undefined,
      sourceDocumentNumber: original.sourceDocumentNumber ?? undefined,
      reason,
      reversalOfId: original.id,
      correlationId,
      idempotencyKey: key,
      meta: { reversalOf: original.id },
    });

    let replacement: typeof reversal | null = null;
    let replacementNumber: string | null = null;
    if (input.replacement) {
      const r = input.replacement;
      const qty = new Decimal(r.qty);
      if (!qty.isFinite() || qty.lte(0)) throw new DomainError("validation", "Replacement quantity must be greater than zero.", { field: "replacementQty" });
      if (lot.baseUom === "pcs" && !qty.isInteger()) throw new DomainError("validation", "This lot is counted in pieces; enter a whole number.", { field: "replacementQty" });
      const locs = await tx.select().from(locations).where(and(eq(locations.siteId, lot.siteId), or(eq(locations.id, r.fromLocationId), eq(locations.id, r.toLocationId))));
      const from = locs.find((l) => l.id === r.fromLocationId);
      const to = locs.find((l) => l.id === r.toLocationId);
      if (!from || !to || !to.isActive) throw new DomainError("validation", "Replacement locations must be active locations of the lot's site.", { field: "replacementTo" });
      const kinds = allowedDestinationKinds(lot.qualityStatus, lot.expiresOn);
      if (!kinds.includes(to.kind)) throw new DomainError("blocked_lot", `Lot ${lot.lotNumber} can only move to ${kinds.join(" / ")} locations, not ${to.kind} (${to.code}).`);
      replacementNumber = await nextNumber(tx, ctx.organizationId, "MOV");
      ({ movement: replacement } = await postMovement(tx, ctx, {
        movementType: "transfer",
        lotId: lot.id,
        fromLocationId: from.id,
        toLocationId: to.id,
        qtyBase: qty,
        sourceDocumentType: "stock_transfer",
        sourceDocumentNumber: replacementNumber,
        reason: `Replacement: ${reason}`,
        correlationId,
        idempotencyKey: replaceKey,
        meta: { replacementFor: original.id, fromCode: from.code, toCode: to.code },
      }));
    }

    await audit(tx, ctx, {
      action: "inventory.stock_movement.reversed",
      entityType: "stock_movement",
      entityId: original.id,
      entityNumber: original.sourceDocumentNumber,
      siteId: original.siteId,
      reason,
      correlationId,
      before: { movementType: original.movementType, qtyBase: original.qtyBase, fromLocationId: original.fromLocationId, toLocationId: original.toLocationId, lotNumber: lot.lotNumber },
      after: { reversalId: reversal.id, replacementId: replacement?.id ?? null, replacementNumber, replacementQty: replacement?.qtyBase ?? null },
    });
    return { reversalId: reversal.id, replacementId: replacement?.id ?? null, replacementNumber, correlationId, lotId: lot.id, replayed: false };
  });
}

/** Active locations of a site for the replacement choice in the correction dialog. */
export async function correctionLocations(ctx: AuthContext, siteId: string) {
  ctx.require("inventory.movement.void");
  ctx.requireSite(siteId);
  return db
    .select({ id: locations.id, code: locations.code, name: locations.name, kind: locations.kind })
    .from(locations)
    .where(and(eq(locations.siteId, siteId), eq(locations.isActive, true)))
    .orderBy(locations.code);
}

const fromLoc = alias(locations, "from_loc");
const toLoc = alias(locations, "to_loc");

/** A movement with its lot, locations, poster and every row of the same correction (reversal, replacement). */
export async function getMovementDetail(ctx: AuthContext, movementId: string) {
  ctx.require("inventory.movement.view");
  if (!isUuid(movementId)) throw new DomainError("not_found", "Movement not found in your sites.");
  const select = {
    m: stockMovements,
    lotNumber: inventoryLots.lotNumber,
    lotStatus: inventoryLots.qualityStatus,
    lotExpiresOn: inventoryLots.expiresOn,
    fromCode: fromLoc.code,
    toCode: toLoc.code,
    fromName: fromLoc.name,
    toName: toLoc.name,
    itemName: sql<string | null>`coalesce(${materials.name}, ${products.name})`,
    postedByName: users.displayName,
  };
  const base = () =>
    db
      .select(select)
      .from(stockMovements)
      .innerJoin(inventoryLots, eq(inventoryLots.id, stockMovements.lotId))
      .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
      .leftJoin(products, eq(products.id, inventoryLots.productId))
      .leftJoin(fromLoc, eq(fromLoc.id, stockMovements.fromLocationId))
      .leftJoin(toLoc, eq(toLoc.id, stockMovements.toLocationId))
      .innerJoin(users, eq(users.id, stockMovements.postedBy));
  const [row] = await base()
    .where(and(eq(stockMovements.id, movementId), eq(stockMovements.organizationId, ctx.organizationId), inArray(stockMovements.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Movement not found in your sites.");
  const conds = [eq(stockMovements.reversalOfId, row.m.id)];
  if (row.m.reversalOfId) conds.push(eq(stockMovements.id, row.m.reversalOfId));
  if (row.m.correlationId) conds.push(eq(stockMovements.correlationId, row.m.correlationId));
  let related = (await base().where(and(eq(stockMovements.lotId, row.m.lotId), or(...conds)))).filter((r) => r.m.id !== row.m.id);
  // The original carries no correlation id; its correction group is the reversal's (reversal + replacement).
  const groupIds = [...new Set(related.map((r) => r.m.correlationId).filter((x): x is string => !!x && x !== row.m.correlationId))];
  if (groupIds.length) {
    const more = await base().where(and(eq(stockMovements.lotId, row.m.lotId), inArray(stockMovements.correlationId, groupIds)));
    for (const r of more) if (r.m.id !== row.m.id && !related.some((x) => x.m.id === r.m.id)) related = [...related, r];
  }
  related.sort((a, b) => a.m.postedAt.getTime() - b.m.postedAt.getTime());
  const reversedBy = related.find((r) => r.m.reversalOfId === row.m.id) ?? null;
  return {
    ...row,
    related,
    reversedBy,
    canReverse:
      ctx.can("inventory.movement.void") &&
      !reversedBy &&
      row.m.movementType !== "reversal" &&
      (REVERSIBLE_MOVEMENT_TYPES as readonly string[]).includes(row.m.movementType),
  };
}

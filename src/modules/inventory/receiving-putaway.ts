import "server-only";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { inventoryBalances, inventoryLots, locations, materials, products, stockMovements, warehouses } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { heldLocations, resolveLocationRef, resolveLotRef } from "./holds";
import { assertLocationsNotFrozen } from "./freeze";
import { postMovement } from "./ledger";
import { allowedDestinationKinds, isUuid } from "./lots";
import { fmtStock } from "./low-stock";
import { looseQty } from "./moves";
import { SECTION_LABELS, SECTION_ORDER, isSection, sectionForItem, sectionSql, type LocationSection } from "@/modules/masterdata";

/**
 * Put-away (W01-08, US-2-09): scan the lot label, then the destination location. Status-location rule
 * V-LOC: a lot may only land in location kinds allowed for its quality status (allowedDestinationKinds,
 * A-INV-MVP-02): quarantined and held lots only in quarantine/hold locations. A location under an open QA
 * hold is refused. V-FREEZE: a location inside a running stock count is refused (freeze.ts).
 */

/** What the put-away screen shows after the lot scan: where the stock is and where it may go. */
export async function putAwayOptions(ctx: AuthContext, lotRef: string) {
  ctx.require("inventory.movement.post");
  const lot = await resolveLotRef(db, ctx, lotRef);
  ctx.requireSite(lot.siteId);
  const [mat] = lot.materialId ? await db.select({ code: materials.code, name: materials.name, materialKind: materials.materialKind }).from(materials).where(eq(materials.id, lot.materialId)) : [];
  const [prod] = !mat && lot.productId ? await db.select({ code: products.skuCode, name: products.name }).from(products).where(eq(products.id, lot.productId)) : [];
  // S6 (ADR-077): suggest the section the item belongs in; its locations are listed first.
  const suggestedSection: LocationSection = sectionForItem({ itemKind: lot.itemKind === "product" ? "product" : "material", materialKind: mat?.materialKind });
  const balances = await db
    .select({ locationId: locations.id, code: locations.code, name: locations.name, kind: locations.kind, qtyBase: inventoryBalances.qtyBase })
    .from(inventoryBalances)
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .where(and(eq(inventoryBalances.lotId, lot.id), gt(inventoryBalances.qtyBase, "0")))
    .orderBy(asc(locations.code));
  const kinds = allowedDestinationKinds(lot.qualityStatus, lot.expiresOn);
  const held = new Set((await heldLocations(db, lot.siteId)).map((h) => h.locationId));
  // Friendly quantities (60,000 g → 60 kg) and the loose part: boxed stock moves with its box.
  const balancesOut = await Promise.all(
    balances.map(async (b) => {
      const loose = Decimal.min(await looseQty(db, lot.id, b.locationId), b.qtyBase);
      return { ...b, looseQtyBase: loose.toString(), qtyText: fmtStock(b.qtyBase, lot.baseUom), looseQtyText: fmtStock(loose, lot.baseUom) };
    }),
  );
  const destinations = (
    await db
      .select({ id: locations.id, code: locations.code, name: locations.name, kind: locations.kind, section: sql<string>`${sectionSql("locations", "warehouses")}` })
      .from(locations)
      .innerJoin(warehouses, eq(warehouses.id, locations.warehouseId))
      .where(and(eq(locations.siteId, lot.siteId), eq(locations.isActive, true), inArray(locations.kind, kinds)))
      .orderBy(asc(locations.code))
  )
    .filter((l) => !held.has(l.id))
    .map((l) => ({ ...l, section: isSection(l.section) ? l.section : ("other" as LocationSection), sectionLabel: SECTION_LABELS[isSection(l.section) ? l.section : "other"] }))
    .sort((a, b) => Number(b.section === suggestedSection) - Number(a.section === suggestedSection) || SECTION_ORDER[a.section] - SECTION_ORDER[b.section] || a.code.localeCompare(b.code));
  return {
    lot: { id: lot.id, lotNumber: lot.lotNumber, qualityStatus: lot.qualityStatus, expiresOn: lot.expiresOn, baseUom: lot.baseUom, itemCode: mat?.code ?? prod?.code ?? "", itemName: mat?.name ?? prod?.name ?? "", supplierLotNumber: lot.supplierLotNumber },
    balances: balancesOut,
    destinations,
    allowedKinds: kinds,
    suggestedSection,
    suggestedSectionLabel: SECTION_LABELS[suggestedSection],
    suggestedCodes: destinations.filter((d) => d.section === suggestedSection).map((d) => d.code),
  };
}

/**
 * qtyUom: the unit the quantity was typed in. The lot's base unit, or the friendly unit shown on the
 * screen for gram/millilitre lots (kg = 1,000 g, L = 1,000 mL). Any other unit is refused.
 */
export type PutAwayInput = { lotRef: string; locationRef: string; fromLocationId?: string | null; qty?: string | null; qtyUom?: string | null; idempotencyKey: string };

const FRIENDLY_UNITS: Record<string, { base: string; factor: number }> = { kg: { base: "g", factor: 1000 }, L: { base: "mL", factor: 1000 } };

/** Converts a typed quantity to the lot's base unit (decimal-safe). */
export function putAwayQtyToBase(qty: Decimal, uom: string | null | undefined, baseUom: string): Decimal {
  const u = (uom ?? "").trim();
  if (!u || u === baseUom) return qty;
  const f = FRIENDLY_UNITS[u === "l" ? "L" : u];
  if (!f || f.base !== baseUom) {
    throw new DomainError("validation", `This lot is counted in ${baseUom}; enter the quantity in ${baseUom}${baseUom === "g" ? " or kg" : baseUom === "mL" ? " or L" : ""}.`, { field: "qty" });
  }
  return qty.mul(f.factor);
}

/** Posts one transfer from the lot's current (default: receiving) location to the scanned destination. */
export async function putAwayLot(ctx: AuthContext, input: PutAwayInput) {
  ctx.require("inventory.movement.post");
  if (!isUuid(input.idempotencyKey)) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  const key = `putaway:${input.idempotencyKey}`;
  return db.transaction(async (tx) => {
    const ref = await resolveLotRef(tx, ctx, input.lotRef);
    const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, ref.id)).for("update");
    ctx.requireSite(lot.siteId);
    const [dup] = await tx
      .select({ id: stockMovements.id, number: stockMovements.sourceDocumentNumber })
      .from(stockMovements)
      .where(and(eq(stockMovements.organizationId, ctx.organizationId), eq(stockMovements.idempotencyKey, key)))
      .limit(1);
    if (dup) return { movementId: dup.id, number: dup.number ?? "", lotNumber: lot.lotNumber, replayed: true, toCode: null as string | null };

    const to = await resolveLocationRef(tx, ctx, lot.siteId, input.locationRef);
    if (!to.isActive) throw new DomainError("validation", `Location ${to.code} is inactive.`, { field: "location" });
    const kinds = allowedDestinationKinds(lot.qualityStatus, lot.expiresOn);
    const held = await heldLocations(tx, lot.siteId);
    const heldIds = new Set(held.map((h) => h.locationId));
    if (!kinds.includes(to.kind)) {
      const allowed = await tx
        .select({ id: locations.id, code: locations.code })
        .from(locations)
        .where(and(eq(locations.siteId, lot.siteId), eq(locations.isActive, true), inArray(locations.kind, kinds)))
        .orderBy(asc(locations.code));
      const suggestions = allowed.filter((a) => !heldIds.has(a.id)).map((a) => a.code);
      throw new DomainError(
        "blocked_lot",
        lot.qualityStatus === "quarantine"
          ? `Lot ${lot.lotNumber} is waiting for the quality check, so it cannot go to ${to.code} yet. Leave it in ${suggestions[0] ?? "the hold area"} for now; put it away after QA approves it.`
          : `Lot ${lot.lotNumber} is ${lot.qualityStatus.replace("_", " ")}, so it cannot go to ${to.code}. Put it in ${suggestions.join(" or ") || "a hold area"}.`,
        { rule: "V-LOC", allowedLocations: suggestions, allowedKinds: kinds },
      );
    }
    const holdOnTo = held.find((h) => h.locationId === to.id);
    if (holdOnTo) throw new DomainError("blocked_lot", `Location ${to.code} is blocked by QA hold ${holdOnTo.holdNumber}. Choose another location.`, { rule: "V-LOC", holdNumber: holdOnTo.holdNumber });

    const bals = await tx
      .select({ locationId: inventoryBalances.locationId, qty: inventoryBalances.qtyBase, kind: locations.kind, code: locations.code })
      .from(inventoryBalances)
      .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
      .where(and(eq(inventoryBalances.lotId, lot.id), gt(inventoryBalances.qtyBase, "0")));
    let from = input.fromLocationId ? bals.find((b) => b.locationId === input.fromLocationId) : undefined;
    if (input.fromLocationId && !from) throw new DomainError("validation", "The lot has no stock at the chosen source location.", { field: "fromLocationId" });
    if (!from) {
      const candidates = bals.filter((b) => b.locationId !== to.id);
      const receiving = candidates.filter((b) => b.kind === "receiving");
      from = receiving.length === 1 ? receiving[0] : candidates.length === 1 ? candidates[0] : undefined;
      if (!from) {
        throw new DomainError(
          "validation",
          candidates.length === 0 ? `Lot ${lot.lotNumber} has no stock to put away${bals.length ? ` (it is already at ${to.code})` : ""}.` : `Lot ${lot.lotNumber} is in several locations (${candidates.map((c) => c.code).join(", ")}); choose where you are taking it from.`,
          { field: "fromLocationId" },
        );
      }
    }
    if (from.locationId === to.id) throw new DomainError("validation", `The lot is already at ${to.code}.`, { field: "location" });
    // V-FREEZE (US-2-17): a running stock count freezes its locations; checked here for a clear message (postMovement enforces it too).
    await assertLocationsNotFrozen(tx, [from.locationId, to.id]);
    if (heldIds.has(from.locationId) && !["quarantine", "hold", "rejected"].includes(to.kind)) {
      throw new DomainError("blocked_lot", `Stock in ${from.code} is under a QA hold and can only move to a quarantine, hold or rejected location.`, { rule: "V-LOC" });
    }
    // Boxed stock moves only with its box (same rule as transferStock, W1C): put-away moves the loose part.
    const loose = Decimal.min(await looseQty(tx, lot.id, from.locationId), from.qty);
    if (loose.lte(0)) {
      throw new DomainError("insufficient_stock", `All of lot ${lot.lotNumber} at ${from.code} is in boxes. Move the boxes instead: scan each box on the Move screen.`, { field: "qty" });
    }
    let qty = loose;
    if (input.qty && String(input.qty).trim()) {
      try {
        qty = putAwayQtyToBase(new Decimal(String(input.qty).trim().replace(/,/g, "")), input.qtyUom, lot.baseUom);
      } catch (e) {
        if (e instanceof DomainError) throw e;
        throw new DomainError("validation", "Enter a quantity.", { field: "qty" });
      }
      if (!qty.isFinite() || qty.lte(0)) throw new DomainError("validation", "Quantity must be greater than zero.", { field: "qty" });
      if (lot.baseUom === "pcs" && !qty.isInteger()) throw new DomainError("validation", "This lot is counted in pieces; enter a whole number.", { field: "qty" });
      if (qty.gt(loose)) {
        throw new DomainError("insufficient_stock", `Only ${fmtStock(loose, lot.baseUom)} of lot ${lot.lotNumber} ${new Decimal(from.qty).gt(loose) ? "is loose (the rest is in boxes)" : "is"} at ${from.code}.`, { field: "qty" });
      }
    }
    const number = await nextNumber(tx, ctx.organizationId, "MOV");
    const { movement } = await postMovement(tx, ctx, {
      movementType: "transfer",
      lotId: lot.id,
      fromLocationId: from.locationId,
      toLocationId: to.id,
      qtyBase: qty,
      sourceDocumentType: "put_away",
      sourceDocumentNumber: number,
      reason: "Put-away",
      idempotencyKey: key,
      meta: { fromCode: from.code, toCode: to.code, scanned: { lot: input.lotRef.startsWith("BC:"), location: input.locationRef.startsWith("BC:") } },
    });
    return { movementId: movement.id, number, lotNumber: lot.lotNumber, replayed: false, toCode: to.code as string | null };
  });
}

import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { goodsReceiptLines, goodsReceipts, inventoryLots, locations, materials, stockMovements, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";
import { postMovement } from "./ledger";
import { isUuid } from "./lots";

/** Location kinds a receipt line may be put away to. Default is the quarantine location. */
export const RECEIVING_LOCATION_KINDS = ["quarantine", "receiving", "storage"] as const;

/** Materials and put-away locations for the receive form (current site). */
export async function receivingFormData(ctx: AuthContext) {
  ctx.require("inventory.receipt.post");
  ctx.requireSite(ctx.currentSiteId);
  const [mats, locs] = await Promise.all([
    db
      .select({ id: materials.id, code: materials.code, name: materials.name, baseUom: materials.baseUom, shelfLifeDays: materials.shelfLifeDays })
      .from(materials)
      .where(eq(materials.organizationId, ctx.organizationId))
      .orderBy(asc(materials.code)),
    db
      .select({ id: locations.id, code: locations.code, name: locations.name, kind: locations.kind })
      .from(locations)
      .where(and(eq(locations.siteId, ctx.currentSiteId), eq(locations.isActive, true), inArray(locations.kind, [...RECEIVING_LOCATION_KINDS])))
      .orderBy(sql`case ${locations.kind} when 'quarantine' then 0 when 'receiving' then 1 else 2 end`, asc(locations.code)),
  ]);
  return { materials: mats, locations: locs };
}

export type ReceiptLineInput = {
  materialId: string;
  qty: string;
  supplierLotNumber: string;
  manufacturedOn?: string | null;
  expiresOn: string;
  locationId: string;
};

export type ReceiptInput = {
  idempotencyKey: string;
  supplierName: string;
  supplierDocumentNumber: string;
  notes?: string | null;
  lines: ReceiptLineInput[];
};

function manilaToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

/**
 * Posts a goods receipt: one header, and per line a new quarantined lot, a receipt line and a
 * receipt movement, all in one transaction with one audit event. The client sends a UUID per
 * form; a second submit with the same UUID returns the first receipt instead of doubling stock.
 */
export async function postGoodsReceipt(ctx: AuthContext, input: ReceiptInput) {
  ctx.require("inventory.receipt.post");
  ctx.requireSite(ctx.currentSiteId);
  if (!isUuid(input.idempotencyKey)) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  if (input.lines.length === 0) throw new DomainError("validation", "Add at least one line.");
  const keyBase = `gr:${input.idempotencyKey}`;
  const siteId = ctx.currentSiteId;
  const today = manilaToday();

  return db.transaction(async (tx) => {
    // Serialize submissions that share the key, then check whether the first one already posted.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${keyBase}))`);
    const [existing] = await tx
      .select({ receiptId: stockMovements.sourceDocumentId, number: stockMovements.sourceDocumentNumber })
      .from(stockMovements)
      .where(and(eq(stockMovements.organizationId, ctx.organizationId), eq(stockMovements.idempotencyKey, `${keyBase}:1`)))
      .limit(1);
    if (existing?.receiptId) return { receiptId: existing.receiptId, receiptNumber: existing.number ?? "", replayed: true };

    const matIds = [...new Set(input.lines.map((l) => l.materialId))];
    const mats = await tx.select().from(materials).where(and(eq(materials.organizationId, ctx.organizationId), inArray(materials.id, matIds)));
    const locs = await tx
      .select()
      .from(locations)
      .where(and(eq(locations.siteId, siteId), eq(locations.isActive, true), inArray(locations.kind, [...RECEIVING_LOCATION_KINDS])));

    // Validate every line before writing anything.
    const lines = input.lines.map((l, i) => {
      const n = i + 1;
      const mat = mats.find((m) => m.id === l.materialId);
      if (!mat) throw new DomainError("validation", `Line ${n}: choose a material.`);
      const loc = locs.find((x) => x.id === l.locationId);
      if (!loc) throw new DomainError("validation", `Line ${n}: choose a receiving, quarantine or storage location of this site.`);
      const qty = new Decimal(l.qty);
      if (!qty.isFinite() || qty.lte(0)) throw new DomainError("validation", `Line ${n}: quantity must be greater than zero.`);
      if (mat.baseUom === "pcs" && !qty.isInteger()) throw new DomainError("validation", `Line ${n}: ${mat.name} is counted in pieces; enter a whole number.`);
      if (l.manufacturedOn && l.manufacturedOn > today) throw new DomainError("validation", `Line ${n}: the manufacture date cannot be in the future.`);
      if (l.expiresOn <= today) throw new DomainError("validation", `Line ${n}: the expiry date must be after today; expired material cannot be received into stock.`);
      if (l.manufacturedOn && l.expiresOn <= l.manufacturedOn) throw new DomainError("validation", `Line ${n}: the expiry date must be after the manufacture date.`);
      return { ...l, n, mat, loc, qty };
    });

    const receiptNumber = await nextNumber(tx, ctx.organizationId, "GR");
    const [gr] = await tx
      .insert(goodsReceipts)
      .values({
        organizationId: ctx.organizationId,
        siteId,
        receiptNumber,
        supplierName: input.supplierName,
        supplierDocumentNumber: input.supplierDocumentNumber,
        receivedBy: ctx.userId,
        notes: input.notes || null,
      })
      .returning();

    const created: { lotNumber: string; material: string; qty: string; uom: string; location: string }[] = [];
    for (const l of lines) {
      const lotNumber = await nextNumber(tx, ctx.organizationId, "LOT");
      const [lot] = await tx
        .insert(inventoryLots)
        .values({
          organizationId: ctx.organizationId,
          siteId,
          lotNumber,
          itemKind: "material",
          materialId: l.mat.id,
          supplierName: input.supplierName,
          supplierLotNumber: l.supplierLotNumber,
          manufacturedOn: l.manufacturedOn || null,
          expiresOn: l.expiresOn,
          qualityStatus: "quarantine",
          baseUom: l.mat.baseUom,
          createdBy: ctx.userId,
        })
        .returning();
      await tx.insert(goodsReceiptLines).values({ goodsReceiptId: gr.id, lotId: lot.id, materialId: l.mat.id, qtyBase: l.qty.toString(), locationId: l.loc.id });
      await postMovement(tx, ctx, {
        movementType: "receipt",
        lotId: lot.id,
        toLocationId: l.loc.id,
        qtyBase: l.qty,
        sourceDocumentType: "goods_receipt",
        sourceDocumentId: gr.id,
        sourceDocumentNumber: receiptNumber,
        idempotencyKey: `${keyBase}:${l.n}`,
      });
      created.push({ lotNumber, material: l.mat.code, qty: l.qty.toString(), uom: l.mat.baseUom, location: l.loc.code });
    }

    await audit(tx, ctx, {
      action: "inventory.goods_receipt.posted",
      entityType: "goods_receipt",
      entityId: gr.id,
      entityNumber: receiptNumber,
      siteId,
      after: { supplierName: input.supplierName, supplierDocumentNumber: input.supplierDocumentNumber, lines: created },
    });
    return { receiptId: gr.id, receiptNumber, replayed: false };
  });
}

/** Receipt header and lines (with the lots created) within the user's allowed sites. */
export async function getReceipt(ctx: AuthContext, receiptId: string) {
  ctx.require("inventory.lot.view");
  if (!isUuid(receiptId)) throw new DomainError("not_found", "Receipt not found in your sites.");
  const [gr] = await db
    .select({ receipt: goodsReceipts, receivedByName: users.displayName })
    .from(goodsReceipts)
    .innerJoin(users, eq(users.id, goodsReceipts.receivedBy))
    .where(and(eq(goodsReceipts.id, receiptId), inArray(goodsReceipts.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!gr) throw new DomainError("not_found", "Receipt not found in your sites.");
  ctx.requireSite(gr.receipt.siteId);
  const lines = await db
    .select({
      id: goodsReceiptLines.id,
      qtyBase: goodsReceiptLines.qtyBase,
      lotId: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      qualityStatus: inventoryLots.qualityStatus,
      supplierLotNumber: inventoryLots.supplierLotNumber,
      manufacturedOn: inventoryLots.manufacturedOn,
      expiresOn: inventoryLots.expiresOn,
      baseUom: inventoryLots.baseUom,
      materialCode: materials.code,
      materialName: materials.name,
      locationCode: locations.code,
      locationName: locations.name,
    })
    .from(goodsReceiptLines)
    .innerJoin(inventoryLots, eq(inventoryLots.id, goodsReceiptLines.lotId))
    .innerJoin(materials, eq(materials.id, goodsReceiptLines.materialId))
    .innerJoin(locations, eq(locations.id, goodsReceiptLines.locationId))
    .where(eq(goodsReceiptLines.goodsReceiptId, receiptId))
    .orderBy(asc(inventoryLots.lotNumber));
  return { ...gr.receipt, receivedByName: gr.receivedByName, lines };
}

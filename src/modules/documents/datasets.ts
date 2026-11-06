import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { batchBoxes, batches, goodsReceiptLines, inventoryLots, locations, materials, packBoxes, packs, products, users, warehouses } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtMass, fmtQty } from "@/lib/qty";
import { allowedDestinationKinds, getContainer, getLotDetail, LOT_STATUSES } from "@/modules/inventory";
import type { LabelData } from "./renderers/label-v1";
import { STATUS_WORD } from "./renderers/shared";
import { perContainerQuantity } from "./sack-quantity";
import { isUuid } from "./templates";

/**
 * Label datasets (docs/reports-and-templates.md §1.3 `label/<applies_to>/v1`), built under the
 * caller's AuthContext so the scope rules of the source record apply. Values are formatted here
 * so the renderer stays a pure function of the frozen data.
 */

export type LabelEntity = {
  entityType: "inventory_lot" | "location" | "container" | "batch" | "batch_box";
  entityId: string;
  siteId: string;
  number: string;
  appliesTo: string;
  state: string | null;
  revisionAt: Date;
  entity: LabelData["entity"];
};

function qtyText(v: string, uom: string) {
  if (uom === "g") return fmtMass(v);
  if (uom === "pcs") return fmtQty(v, "pcs", 0);
  return fmtQty(v, uom, 1);
}

const CAPTION: Record<string, string> = { material: "RAW MATERIAL", wip: "INTERMEDIATE · not for sale", finished_good: "FINISHED GOODS", location: "LOCATION" };

/** Lot label data; throws not_found outside the user's sites (via the inventory module). */
export async function lotLabelEntity(ctx: AuthContext, lotId: string): Promise<LabelEntity> {
  const lot = await getLotDetail(ctx, lotId);
  let appliesTo = "finished_good";
  if (lot.itemKind === "material" && lot.materialId) {
    const [m] = await db.select({ kind: materials.materialKind }).from(materials).where(eq(materials.id, lot.materialId)).limit(1);
    appliesTo = m?.kind === "intermediate" ? "wip" : "material";
  }
  const onHand = lot.balances.reduce((a, b) => a.plus(b.qtyBase), D(0));
  // ADR-110 C7: a lot received in several sacks prints the quantity per sack (even split), or none ("sack 1 of 4").
  const [grl] = await db.select({ qty: goodsReceiptLines.qtyBase, containers: goodsReceiptLines.containerCount }).from(goodsReceiptLines).where(eq(goodsReceiptLines.lotId, lot.id)).limit(1);
  const sacks = grl ? perContainerQuantity(grl.qty, grl.containers, onHand) : { perContainer: onHand, containers: 1 };
  const last = lot.movements[0]?.postedAt ?? lot.createdAt;
  const revisionAt = new Date(Math.max(new Date(last).getTime(), new Date(lot.createdAt).getTime()));
  return {
    entityType: "inventory_lot",
    entityId: lot.id,
    siteId: lot.siteId,
    number: lot.lotNumber,
    appliesTo,
    state: lot.qualityStatus,
    revisionAt,
    entity: {
      payloadType: "LOT",
      value: lot.lotNumber,
      caption: CAPTION[appliesTo],
      itemCode: lot.itemCode || null,
      itemName: lot.itemName || null,
      inciName: lot.inciName ?? null,
      supplierName: lot.supplierName ?? null,
      supplierLotNumber: lot.supplierLotNumber ?? null,
      brand: lot.brand ?? null,
      receivedOn: fmtDate(lot.receipt?.receivedAt ?? lot.createdAt),
      manufacturedOn: lot.manufacturedOn ? fmtDate(lot.manufacturedOn) : null,
      expiresOn: lot.expiresOn ? fmtDate(lot.expiresOn) : "No expiry",
      expiryLabel: "Expiry",
      quantityText: sacks.containers > 1 ? (sacks.perContainer ? `${qtyText(sacks.perContainer.toString(), lot.baseUom)} each` : null) : qtyText(onHand.toString(), lot.baseUom),
      containerCount: sacks.containers > 1 ? sacks.containers : null,
      storageConditions: lot.storageConditions ?? null,
      batchNumber: lot.batchNumber ?? null,
      statusWord: STATUS_WORD[lot.qualityStatus] ?? lot.qualityStatus.toUpperCase(),
      locationName: null,
      warehouseCode: null,
      locationKindWord: null,
      allowedStatuses: null,
    },
  };
}

const KIND_WORD: Record<string, string> = {
  receiving: "RECEIVING",
  storage: "STORAGE",
  quarantine: "QUARANTINE",
  hold: "HOLD",
  rejected: "REJECTED",
  production: "PRODUCTION",
  shipping: "STAGING / SHIPPING",
};

/** Which lot statuses may be placed in a location kind (derived from the inventory move rules). */
export function acceptedStatuses(kind: string): string {
  const accepted = LOT_STATUSES.filter((s) => allowedDestinationKinds(s, null).includes(kind));
  return accepted.length ? accepted.map((s) => STATUS_WORD[s] ?? s).join(", ") : "No stock";
}

export async function locationLabelEntity(ctx: AuthContext, locationId: string): Promise<LabelEntity> {
  ctx.require("masterdata.location.view");
  if (!isUuid(locationId)) throw new DomainError("not_found", "Location not found in your sites.");
  const [l] = await db
    .select({ l: locations, wh: warehouses.code })
    .from(locations)
    .innerJoin(warehouses, eq(warehouses.id, locations.warehouseId))
    .where(and(eq(locations.id, locationId), inArray(locations.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!l) throw new DomainError("not_found", "Location not found in your sites.");
  return {
    entityType: "location",
    entityId: l.l.id,
    siteId: l.l.siteId,
    number: l.l.code,
    appliesTo: "location",
    state: l.l.isActive ? l.l.kind : "inactive",
    revisionAt: new Date(),
    entity: {
      payloadType: "LOC",
      value: l.l.code,
      caption: CAPTION.location,
      itemCode: null,
      itemName: null,
      locationName: l.l.name,
      warehouseCode: l.wh,
      locationKindWord: KIND_WORD[l.l.kind] ?? l.l.kind.toUpperCase(),
      allowedStatuses: acceptedStatuses(l.l.kind),
    },
  };
}

const initials = (name: string | null | undefined) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 4) || null;

/**
 * Box / carton label data (W3E, US-4-07; docs/reports-and-templates.md §8.3 "Box / carton"): BC:BOX,
 * SKU, lot, expiry, units (PARTIAL), packed date, packer initials, customer marks and "Box n of N"
 * from the pack that produced the box, status word inherited from the lot at print.
 */
export async function containerLabelEntity(ctx: AuthContext, containerId: string): Promise<LabelEntity> {
  const box = await getContainer(ctx, containerId);
  if (box.status === "void" || box.contents.length === 0) throw new DomainError("state", `Box ${box.containerNumber} is ${box.status === "void" ? "void" : "empty"}; there is nothing to label.`);
  const [pb] = await db
    .select({ boxNo: packBoxes.boxNo, boxCount: packs.boxCount, packStatus: packs.status, config: packs.configSnapshot, packer: users.displayName })
    .from(packBoxes)
    .innerJoin(packs, eq(packs.id, packBoxes.packId))
    .innerJoin(users, eq(users.id, packs.packedBy))
    .where(and(eq(packBoxes.containerId, box.id), eq(packBoxes.status, "packed")))
    .orderBy(desc(packBoxes.createdAt))
    .limit(1);
  const lots = await db
    .select({ id: inventoryLots.id, batchNumber: batches.batchNumber })
    .from(inventoryLots)
    .leftJoin(batches, eq(batches.id, inventoryLots.sourceBatchId))
    .where(inArray(inventoryLots.id, box.contents.map((c) => c.lotId)));
  const first = box.contents[0];
  const statuses = [...new Set(box.contents.map((c) => c.qualityStatus))];
  const expiries = box.contents.map((c) => c.expiresOn).filter((x): x is string => !!x).sort();
  const marks = (pb?.config as { shippingMarks?: string | null } | undefined)?.shippingMarks ?? null;
  const qty = box.contents.map((c) => qtyText(D(c.qtyBase).toString(), c.baseUom)).join(" + ");
  return {
    entityType: "container",
    entityId: box.id,
    siteId: box.siteId,
    number: box.containerNumber,
    appliesTo: box.containerKind === "pallet" ? "pallet" : "carton",
    // Content identity: a label is superseded when the box's lots or quantities change (split, merge, repack).
    state: `${statuses.join("+")}|${box.contents.map((c) => `${c.lotNumber}:${D(c.qtyBase).toString()}`).join(",")}`,
    revisionAt: new Date(box.updatedAt ?? box.createdAt),
    entity: {
      payloadType: "BOX",
      value: box.containerNumber,
      caption: box.containerKind === "pallet" ? "PALLET" : "BOX",
      itemCode: first.itemCode || null,
      itemName: first.itemName || null,
      batchNumber: lots.map((l) => l.batchNumber).filter(Boolean).join(", ") || null,
      expiresOn: expiries[0] ? fmtDate(expiries[0]) : "No expiry",
      expiryLabel: "Expiry",
      quantityText: `${box.contents.map((c) => c.lotNumber).join(", ")} · ${qty}${box.isPartial ? " · PARTIAL" : ""}`,
      statusWord: statuses.length === 1 ? (STATUS_WORD[statuses[0]] ?? statuses[0].toUpperCase()) : "MIXED STATUS",
      packedOn: box.packedAt ? fmtDate(box.packedAt) : null,
      packerInitials: initials(pb?.packer ?? box.packedByName),
      customerMarks: marks,
      boxOfText: pb ? `${pb.boxNo} of ${pb.boxCount}` : null,
    },
  };
}

export async function labelEntity(ctx: AuthContext, entityType: string, entityId: string): Promise<LabelEntity> {
  if (entityType === "inventory_lot") return lotLabelEntity(ctx, entityId);
  if (entityType === "location") return locationLabelEntity(ctx, entityId);
  if (entityType === "container") return containerLabelEntity(ctx, entityId);
  if (entityType === "batch") return batchLabelEntity(ctx, entityId);
  if (entityType === "batch_box") return batchBoxLabelEntity(ctx, entityId);
  throw new DomainError("validation", "Labels for this kind of record arrive with its module.");
}

/**
 * Product labels of a batch (ADR-088 §3), printed on the packaging step, one per piece: product, the
 * finished lot number, the batch number, made date and expiry. The lot number and dates are frozen on
 * the batch when the labels are first requested (production `printBatchLabels`); Finish posts the lot
 * with exactly these, so the bars and the stock record always agree. No status word: the label goes on
 * the product. The barcode is the lot's BC:LOT payload (it scans once the batch is finished).
 */
export async function batchLabelEntity(ctx: AuthContext, batchId: string, values?: BatchLabelValues | null): Promise<LabelEntity> {
  ctx.require("production.batch.view");
  if (!isUuid(batchId)) throw new DomainError("not_found", "Batch not found in your sites.");
  const [row] = await db
    .select({ b: batches, p: products })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId), inArray(batches.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Batch not found in your sites.");
  const fixed = !!(row.b.outputLotNumber && row.b.outputExpiresOn);
  // Preview only (ADR-099): before the first print the production module may pass the values it will fix.
  const b = fixed || !values ? row.b : { ...row.b, outputLotNumber: values.lotNumber, outputManufacturedOn: values.manufacturedOn ?? null, outputExpiresOn: values.expiresOn };
  const { p } = row;
  if (!b.outputLotNumber || !b.outputExpiresOn) throw new DomainError("state", `Print the labels of batch ${b.batchNumber} from its packaging step.`);
  return {
    entityType: "batch",
    entityId: b.id,
    siteId: b.siteId,
    number: b.batchNumber,
    // ADR-099: the product label on each piece (template kind `product`; an approved finished-goods lot label is the fallback).
    appliesTo: "product",
    // Content identity: same lot and dates = the same label (a second print is a controlled reprint).
    state: `${b.outputLotNumber}|${b.outputManufacturedOn ?? ""}|${b.outputExpiresOn}`,
    revisionAt: new Date(b.createdAt),
    entity: {
      payloadType: "LOT",
      value: b.outputLotNumber,
      caption: (p.family || "PRODUCT").toUpperCase().slice(0, 40),
      itemCode: p.skuCode,
      itemName: p.name,
      batchNumber: b.batchNumber,
      manufacturedOn: b.outputManufacturedOn ? fmtDate(b.outputManufacturedOn) : null,
      expiresOn: fmtDate(b.outputExpiresOn),
      expiryLabel: "Expiry",
      storageConditions: p.storageConditions ?? null,
      quantityText: null,
      statusWord: null,
    },
  };
}

/** Values a batch's product label will carry, passed by the production module for a preview before the first print. */
export type BatchLabelValues = { lotNumber: string; manufacturedOn?: string | null; expiresOn: string };

export async function labelEntityFor(ctx: AuthContext, entityType: string, entityId: string, batchValues?: BatchLabelValues | null, boxPreview?: BatchBoxPreview | null): Promise<LabelEntity> {
  if (entityType === "batch") return batchLabelEntity(ctx, entityId, batchValues);
  if (entityType === "batch_box" && boxPreview) return batchBoxPreviewEntity(ctx, entityId, boxPreview);
  return labelEntity(ctx, entityType, entityId);
}

/** A box label before the boxes exist (packaging step preview): the batch id plus the values the print will use. */
export type BatchBoxPreview = BatchLabelValues & { boxNo: number; boxCount: number; pieces: number; containerNumber: string };

/**
 * ADR-104 §2 box label of a batch (one per box, label kind `carton`): product, batch, lot, pieces in this box,
 * made, expiry, "3 of 13" and the box's own BC:BOX code. The box number is taken when the label is printed and
 * Finish creates the box (container) with that number, so the QR opens the box; until Finish it opens the batch.
 * No status word: the box waits for QA in the hold area and its status is always the lot's (scan to check).
 */
function boxEntity(b: typeof batches.$inferSelect, p: typeof products.$inferSelect, v: { lotNumber: string; manufacturedOn: string | null; expiresOn: string; boxNo: number; boxCount: number; pieces: number; unitsPerBox: number; containerNumber: string }, id: string): LabelEntity {
  const part = v.pieces < v.unitsPerBox;
  return {
    entityType: "batch_box",
    entityId: id,
    siteId: b.siteId,
    number: v.containerNumber,
    appliesTo: "carton",
    // Content identity: same lot, dates, box and pieces = the same label (a second print is a controlled reprint).
    state: `${v.lotNumber}|${v.manufacturedOn ?? ""}|${v.expiresOn}|${v.boxNo}/${v.boxCount}|${v.pieces}`,
    revisionAt: new Date(b.createdAt),
    entity: {
      payloadType: "BOX",
      value: v.containerNumber,
      caption: "BOX",
      itemCode: p.skuCode,
      itemName: p.name,
      batchNumber: b.batchNumber,
      manufacturedOn: v.manufacturedOn ? fmtDate(v.manufacturedOn) : null,
      expiresOn: fmtDate(v.expiresOn),
      expiryLabel: "Expiry",
      quantityText: `${v.lotNumber} · ${v.pieces} pcs${part ? " · PART BOX" : ""}`,
      statusWord: null,
      boxOfText: `${v.boxNo} of ${v.boxCount}`,
      storageConditions: p.storageConditions ?? null,
    },
  };
}

async function batchAndProduct(ctx: AuthContext, batchId: string) {
  ctx.require("production.batch.view");
  if (!isUuid(batchId)) throw new DomainError("not_found", "Batch not found in your sites.");
  const [row] = await db
    .select({ b: batches, p: products })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .where(and(eq(batches.id, batchId), eq(batches.organizationId, ctx.organizationId), inArray(batches.siteId, ctx.allowedSiteIds)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Batch not found in your sites.");
  return row;
}

export async function batchBoxLabelEntity(ctx: AuthContext, batchBoxId: string): Promise<LabelEntity> {
  if (!isUuid(batchBoxId)) throw new DomainError("not_found", "Box not found in your sites.");
  const [bx] = await db.select().from(batchBoxes).where(and(eq(batchBoxes.id, batchBoxId), eq(batchBoxes.organizationId, ctx.organizationId), inArray(batchBoxes.siteId, ctx.allowedSiteIds))).limit(1);
  if (!bx) throw new DomainError("not_found", "Box not found in your sites.");
  if (bx.status === "replaced") throw new DomainError("state", `Box label ${bx.containerNumber} was replaced by a new count. Print the new box labels.`);
  const { b, p } = await batchAndProduct(ctx, bx.batchId);
  if (!b.outputLotNumber || !b.outputExpiresOn) throw new DomainError("state", `Print the box labels of batch ${b.batchNumber} from its packaging step.`);
  return boxEntity(b, p, { lotNumber: b.outputLotNumber, manufacturedOn: b.outputManufacturedOn ?? null, expiresOn: b.outputExpiresOn, boxNo: bx.boxNo, boxCount: bx.boxCount, pieces: bx.pieces, unitsPerBox: bx.unitsPerBox, containerNumber: bx.containerNumber }, bx.id);
}

/** Preview of box 1 before printing (the values the production module will fix). */
export async function batchBoxPreviewEntity(ctx: AuthContext, batchId: string, v: BatchBoxPreview): Promise<LabelEntity> {
  const { b, p } = await batchAndProduct(ctx, batchId);
  return boxEntity(b, p, { lotNumber: v.lotNumber, manufacturedOn: v.manufacturedOn ?? null, expiresOn: v.expiresOn, boxNo: v.boxNo, boxCount: v.boxCount, pieces: v.pieces, unitsPerBox: Math.max(p.unitsPerBox, v.pieces), containerNumber: v.containerNumber }, batchId);
}

/** Sample data for label test pages (T-01): clearly fictional, never a real lot. */
export function sampleLabelEntity(appliesTo: string): LabelData["entity"] {
  if (appliesTo === "location")
    return { payloadType: "LOC", value: "TEST-LOC-01", caption: "LOCATION · TEST PAGE", locationName: "Test location (not real)", warehouseCode: "WH1", locationKindWord: "TEST", allowedStatuses: "RELEASED" };
  return {
    payloadType: "LOT",
    value: "TEST-0001",
    caption: `${CAPTION[appliesTo] ?? "LABEL"} · TEST PAGE`,
    itemCode: "MAT-TEST",
    itemName: "Test material (not real)",
    inciName: "Aqua",
    supplierName: "Sample Supplier (fictional)",
    supplierLotNumber: "SUP-TEST-1",
    receivedOn: "01 Jan 2026",
    manufacturedOn: "01 Jan 2026",
    expiresOn: "31 Dec 2027",
    expiryLabel: "Expiry",
    quantityText: "20.00 kg",
    storageConditions: "Cool, dry place",
    batchNumber: "B-26-0000",
    statusWord: "QUARANTINE",
  };
}

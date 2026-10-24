import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { batches, inventoryLots, locations, materials, packBoxes, packs, users, warehouses } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtMass, fmtQty } from "@/lib/qty";
import { allowedDestinationKinds, getContainer, getLotDetail, LOT_STATUSES } from "@/modules/inventory";
import type { LabelData } from "./renderers/label-v1";
import { STATUS_WORD } from "./renderers/shared";
import { isUuid } from "./templates";

/**
 * Label datasets (docs/reports-and-templates.md §1.3 `label/<applies_to>/v1`), built under the
 * caller's AuthContext so the scope rules of the source record apply. Values are formatted here
 * so the renderer stays a pure function of the frozen data.
 */

export type LabelEntity = {
  entityType: "inventory_lot" | "location" | "container";
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
      receivedOn: fmtDate(lot.receipt?.receivedAt ?? lot.createdAt),
      manufacturedOn: lot.manufacturedOn ? fmtDate(lot.manufacturedOn) : null,
      expiresOn: lot.expiresOn ? fmtDate(lot.expiresOn) : "No expiry",
      expiryLabel: "Expiry",
      quantityText: qtyText(onHand.toString(), lot.baseUom),
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
  throw new DomainError("validation", "Labels for this kind of record arrive with its module.");
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

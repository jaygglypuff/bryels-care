import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { uuidv7 } from "uuidv7";
import { db, type DbOrTx, type Tx } from "@/db/client";
import {
  containers,
  customers,
  deliveryReceipts,
  fileAttachments,
  generatedDocuments,
  inventoryLots,
  organizations,
  products,
  salesOrderLines,
  salesOrders,
  shipmentExceptions,
  shipmentLines,
  shipments,
  sites,
  users,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate, fmtDateTime, fmtQty } from "@/lib/qty";
import { getSetting } from "@/lib/settings";
import { objectKey, requireStorage, validateUpload } from "@/lib/storage";
import { generateForSource, resolveTemplateVersion, type DeliveryReceiptData } from "@/modules/documents";
import { notifyUsers, usersWithRoles } from "@/modules/platform/notifications";
import type { JobRunContext } from "@/modules/platform/job-definition";
import { claimIdempotencyKey, storeIdempotentResult } from "@/modules/inventory";
import { lockOrder } from "./orders";
import { deliveryReceiptMachine, isUuid, lockShipment, peekShipment, transitionShipment, type ShipmentRow } from "./fulfilment-state";

/**
 * Delivery receipts (US-4-12, US-4-13; docs/reports-and-templates.md §7). The DR number is allocated
 * by the dispatch posting; a draft DR (packed shipment, before dispatch) is a DRAFT-watermarked
 * document without a number that never changes stock. Acknowledgment records who received the goods
 * with a drawn signature or a photo of the signed copy (evidence, not an electronic signature) and
 * regenerates the DR "ACKNOWLEDGED <time>" with the image embedded. Prices are never printed.
 */

type DrRow = typeof deliveryReceipts.$inferSelect;
const unit = (uom: string) => (uom === "pcs" ? 0 : 3);

export type Acknowledgment = NonNullable<DeliveryReceiptData["acknowledgment"]>;

/** Frozen delivery_receipt/v1 dataset of a shipment (from its lines; after dispatch they are the ledger postings). */
export async function deliveryReceiptData(q: DbOrTx, shipmentId: string, opts: { drNumber: string | null; acknowledgment?: Acknowledgment | null; remarks?: string | null }): Promise<DeliveryReceiptData> {
  const [row] = await q
    .select({ s: shipments, o: salesOrders, c: customers, site: sites, orgName: organizations.name })
    .from(shipments)
    .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .innerJoin(sites, eq(sites.id, shipments.siteId))
    .innerJoin(organizations, eq(organizations.id, shipments.organizationId))
    .where(eq(shipments.id, shipmentId))
    .limit(1);
  const lines = await q
    .select({ l: shipmentLines, sku: products.skuCode, productName: products.name, lotNumber: inventoryLots.lotNumber, expiresOn: inventoryLots.expiresOn, boxNumber: containers.containerNumber, ordered: salesOrderLines.qtyUnits, lineNo: salesOrderLines.lineNo })
    .from(shipmentLines)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, shipmentLines.salesOrderLineId))
    .innerJoin(products, eq(products.id, salesOrderLines.productId))
    .innerJoin(inventoryLots, eq(inventoryLots.id, shipmentLines.lotId))
    .leftJoin(containers, eq(containers.id, shipmentLines.containerId))
    .where(eq(shipmentLines.shipmentId, shipmentId))
    .orderBy(asc(salesOrderLines.lineNo), asc(inventoryLots.lotNumber), asc(containers.containerNumber));
  // Shipped before this shipment, per order line (for "remaining").
  const prior = await q
    .select({ lineId: shipmentLines.salesOrderLineId, qty: sql<string>`sum(${shipmentLines.qtyBase})::text` })
    .from(shipmentLines)
    .innerJoin(shipments, eq(shipments.id, shipmentLines.shipmentId))
    .where(and(eq(shipments.salesOrderId, row.o.id), sql`${shipments.id} <> ${shipmentId}`, inArray(shipments.status, ["dispatched", "delivered", "returned"]), isNotNull(shipmentLines.stockMovementId)))
    .groupBy(shipmentLines.salesOrderLineId);
  const priorBy = new Map(prior.map((p) => [p.lineId, D(p.qty)]));
  const grouped = new Map<string, { sku: string; productName: string; lotNumber: string; expiresOn: string | null; boxes: string[]; loose: Decimal; qty: Decimal; uom: string; lineId: string; ordered: string; over: boolean }>();
  for (const l of lines) {
    const k = `${l.l.salesOrderLineId}|${l.lotNumber}`;
    const g = grouped.get(k) ?? { sku: l.sku, productName: l.productName, lotNumber: l.lotNumber, expiresOn: l.expiresOn, boxes: [], loose: new Decimal(0), qty: new Decimal(0), uom: l.l.baseUom, lineId: l.l.salesOrderLineId, ordered: l.ordered, over: false };
    if (l.boxNumber) g.boxes.push(l.boxNumber);
    else g.loose = g.loose.plus(l.l.qtyBase);
    g.qty = g.qty.plus(l.l.qtyBase);
    g.over = g.over || l.l.isOverShipment;
    grouped.set(k, g);
  }
  const thisByLine = new Map<string, Decimal>();
  for (const g of grouped.values()) thisByLine.set(g.lineId, (thisByLine.get(g.lineId) ?? new Decimal(0)).plus(g.qty));
  const exceptions = await q.select().from(shipmentExceptions).where(eq(shipmentExceptions.shipmentId, shipmentId)).orderBy(asc(shipmentExceptions.approvedAt));
  const over = exceptions.filter((e) => e.kind === "over_shipment");
  const copiesN = await getSetting(q, row.s.organizationId, "documents.delivery_receipt.copies", row.s.siteId);
  const statutory = (await getSetting(q, row.s.organizationId, "documents.delivery_receipt.statutory_text", row.s.siteId)).trim();
  const copyNames = ["Customer", "Driver", "File", "Accounting", "Extra"].slice(0, copiesN);
  const shipFrom = [row.site.name, row.site.addressLine1, row.site.city, row.site.province].filter(Boolean).join(", ");
  const totalUnits = lines.reduce((a, l) => a.plus(l.l.qtyBase), new Decimal(0));
  const uom = lines[0]?.l.baseUom ?? "pcs";
  return {
    company: { name: row.orgName.slice(0, 200), shipFrom: shipFrom.slice(0, 300) },
    dr: {
      drNumber: opts.drNumber,
      shipmentNumber: row.s.shipmentNumber ?? "—",
      orderNumber: row.o.orderNumber,
      customerPo: row.o.customerPoNumber ?? null,
      dispatchedText: row.s.dispatchedAt ? fmtDateTime(row.s.dispatchedAt) : null,
      carrier: row.s.carrier ?? null,
      trackingNumber: row.s.trackingNumber ?? null,
      driverName: row.s.driverName ?? null,
      vehiclePlate: row.s.vehiclePlate ?? null,
      packagesText: row.s.packageCount ? String(row.s.packageCount) : null,
      grossWeightText: row.s.grossWeight ? `${D(row.s.grossWeight).toString()} ${row.s.weightUom ?? "kg"}` : null,
    },
    customer: { code: row.c.code, name: row.c.name.slice(0, 200), shipTo: (row.s.shipToAddress ?? row.c.shipToAddress).slice(0, 400), contact: [row.c.contactName, row.c.phone].filter(Boolean).join(" · ").slice(0, 160) || null },
    lines: [...grouped.values()].map((g) => {
      const before = priorBy.get(g.lineId) ?? new Decimal(0);
      const shippedTotal = before.plus(thisByLine.get(g.lineId) ?? 0);
      return {
        sku: g.sku,
        productName: g.productName.slice(0, 160),
        lotNumber: g.lotNumber,
        expiresText: g.expiresOn ? fmtDate(g.expiresOn) : null,
        boxesText: [g.boxes.join(", "), g.loose.gt(0) ? `loose ${fmtQty(g.loose, g.uom, unit(g.uom))}` : ""].filter(Boolean).join(" · ").slice(0, 2000) || "—",
        shippedText: fmtQty(g.qty, g.uom, unit(g.uom)),
        orderedText: fmtQty(g.ordered, g.uom, unit(g.uom)),
        remainingText: fmtQty(Decimal.max(D(g.ordered).minus(shippedTotal), 0), g.uom, unit(g.uom)),
        overShipment: g.over,
      };
    }),
    totals: { unitsText: fmtQty(totalUnits, uom, unit(uom)), boxes: new Set(lines.filter((l) => l.l.containerId).map((l) => l.l.containerId)).size },
    overShipmentText: over.length ? over.map((e) => `+${D(e.extraQtyBase ?? 0).toString()} approved (customer ref ${e.customerReference})`).join("; ").slice(0, 400) : null,
    copies: copyNames,
    statutoryText: statutory || null,
    remarks: opts.remarks ?? null,
    acknowledgment: opts.acknowledgment ?? null,
  };
}

async function renderDr(tx: Tx, ctx: AuthContext, s: ShipmentRow, data: DeliveryReceiptData, watermark: string | null, idempotencyKey?: string | null) {
  const code = await getSetting(tx, ctx.organizationId, "documents.delivery_receipt.template_code", s.siteId);
  const resolved = await resolveTemplateVersion(tx, ctx.organizationId, { templateCode: code, siteId: s.siteId });
  if (!resolved) throw new DomainError("setup_required", `No approved delivery receipt template (${code}) exists. Ask QA or an administrator to approve one under Admin → Templates.`);
  return generateForSource(tx, ctx, {
    resolved,
    documentKind: "delivery_receipt",
    source: { type: "shipment", id: s.id, revisionAt: new Date(), state: s.status },
    siteId: s.siteId,
    data,
    watermark,
    idempotencyKey: idempotencyKey ?? null,
    parameters: { dataset: "delivery_receipt/v1", copies: data.copies.length },
    supersedePrevious: true,
  });
}

/** The live DR row of a shipment (draft / issued / acknowledged), or null. */
export async function liveDeliveryReceipt(q: DbOrTx, shipmentId: string, lock = false): Promise<DrRow | null> {
  const base = q.select().from(deliveryReceipts).where(and(eq(deliveryReceipts.shipmentId, shipmentId), sql`${deliveryReceipts.status} <> 'voided'`)).limit(1);
  const [r] = lock ? await base.for("update") : await base;
  return r ?? null;
}

/**
 * A draft DR for a packed shipment: recorded, DRAFT-watermarked, numberless. Never posts stock
 * (T-13 `shipment.draft_no_stock_change`).
 */
export async function generateDraftDeliveryReceipt(ctx: AuthContext, shipmentId: string, input: { idempotencyKey: string }) {
  ctx.require("sales.delivery_receipt.create");
  ctx.require("documents.generated_document.create");
  const key = `dr_draft:${input.idempotencyKey}`;
  return db.transaction(async (tx) => {
    const [replay] = await tx.select().from(generatedDocuments).where(and(eq(generatedDocuments.organizationId, ctx.organizationId), eq(generatedDocuments.idempotencyKey, key))).limit(1);
    if (replay) return { documentId: replay.id, documentNumber: replay.documentNumber, replayed: true };
    const s = await lockShipment(tx, ctx, shipmentId);
    ctx.requireAt("sales.delivery_receipt.create", s.siteId);
    if (s.status !== "packed") throw new DomainError("state", `Shipment ${s.shipmentNumber} is ${s.status}; a draft delivery receipt is printed for a packed shipment before dispatch.`);
    let dr = await liveDeliveryReceipt(tx, s.id, true);
    if (!dr) [dr] = await tx.insert(deliveryReceipts).values({ organizationId: ctx.organizationId, siteId: s.siteId, shipmentId: s.id, status: "draft", createdBy: ctx.userId }).returning();
    const data = await deliveryReceiptData(tx, s.id, { drNumber: null });
    const doc = await renderDr(tx, ctx, s, data, "DRAFT – NOT ISSUED", key);
    await tx.update(deliveryReceipts).set({ generatedDocumentId: doc.id, updatedAt: new Date() }).where(eq(deliveryReceipts.id, dr.id));
    await audit(tx, ctx, { action: "sales.delivery_receipt.draft_printed", entityType: "delivery_receipt", entityId: dr.id, entityNumber: s.shipmentNumber, siteId: s.siteId, after: { documentNumber: doc.documentNumber } });
    return { documentId: doc.id, documentNumber: doc.documentNumber, replayed: false };
  });
}

/**
 * Called by the dispatch posting inside its transaction: the DR row becomes `issued` with the DR
 * number, and the DR document is generated when its template is set up (otherwise the shipment page
 * shows the setup-required state and offers to generate it later).
 */
export async function issueDeliveryReceiptInTx(tx: Tx, ctx: AuthContext, s: ShipmentRow, drNumber: string) {
  let dr = await liveDeliveryReceipt(tx, s.id, true);
  if (dr) {
    deliveryReceiptMachine.assert(dr.status, "issued", `Delivery receipt of ${s.shipmentNumber}`);
    [dr] = await tx.update(deliveryReceipts).set({ status: "issued", drNumber, issuedAt: new Date(), issuedBy: ctx.userId, updatedAt: new Date() }).where(eq(deliveryReceipts.id, dr.id)).returning();
  } else {
    [dr] = await tx.insert(deliveryReceipts).values({ organizationId: ctx.organizationId, siteId: s.siteId, shipmentId: s.id, drNumber, status: "issued", issuedAt: new Date(), issuedBy: ctx.userId, createdBy: ctx.userId }).returning();
  }
  const [fresh] = await tx.select().from(shipments).where(eq(shipments.id, s.id));
  const data = await deliveryReceiptData(tx, s.id, { drNumber });
  const doc = ctx.can("documents.generated_document.create")
    ? await renderDr(tx, ctx, fresh, data, null).catch((e) => {
        if (e instanceof DomainError && e.code === "setup_required") return null;
        throw e;
      })
    : null;
  if (doc) await tx.update(deliveryReceipts).set({ generatedDocumentId: doc.id }).where(eq(deliveryReceipts.id, dr.id));
  return { dr, document: doc };
}

/** (Re)generates the issued DR document after dispatch when it was not generated (template set up later). */
export async function generateDeliveryReceipt(ctx: AuthContext, shipmentId: string, input: { idempotencyKey: string }) {
  ctx.require("sales.delivery_receipt.create");
  ctx.require("documents.generated_document.create");
  const key = `dr_gen:${input.idempotencyKey}`;
  return db.transaction(async (tx) => {
    const [replay] = await tx.select().from(generatedDocuments).where(and(eq(generatedDocuments.organizationId, ctx.organizationId), eq(generatedDocuments.idempotencyKey, key))).limit(1);
    if (replay) return { documentId: replay.id, documentNumber: replay.documentNumber };
    const s = await lockShipment(tx, ctx, shipmentId);
    const dr = await liveDeliveryReceipt(tx, s.id, true);
    if (!dr || dr.status === "draft") throw new DomainError("state", "The shipment is not dispatched yet; print a draft delivery receipt instead.");
    const data = await deliveryReceiptData(tx, s.id, { drNumber: dr.drNumber, acknowledgment: dr.status === "acknowledged" ? await ackFromRow(tx, dr) : null, remarks: dr.remarks });
    const doc = await renderDr(tx, ctx, s, data, dr.status === "acknowledged" ? `ACKNOWLEDGED ${fmtDateTime(dr.acknowledgedAt)}` : null, key);
    await tx.update(deliveryReceipts).set({ generatedDocumentId: doc.id, updatedAt: new Date() }).where(eq(deliveryReceipts.id, dr.id));
    return { documentId: doc.id, documentNumber: doc.documentNumber };
  });
}

const KIND_TEXT = { drawn: "Signature drawn on the device", photo: "Photo of the signed paper copy", name_only: "Name recorded (no signature image)" } as const;

async function ackFromRow(q: DbOrTx, dr: DrRow): Promise<Acknowledgment> {
  // The embedded image is not re-read on regeneration (it lives in storage); the earlier document keeps it.
  return {
    receivedByName: dr.receivedByName ?? "",
    receivedByPosition: dr.receivedByPosition,
    receivedAtText: fmtDateTime(dr.acknowledgedAt),
    remarks: dr.remarks,
    kindText: KIND_TEXT[(dr.acknowledgmentKind ?? "name_only") as keyof typeof KIND_TEXT],
    imageDataUri: null,
    imageNote: dr.signatureAttachmentId ? `Image on file (attachment ${dr.signatureAttachmentId.slice(0, 8)}).` : null,
  };
}

export type AcknowledgeInput = {
  receivedByName: string;
  receivedByPosition?: string | null;
  receivedAt: Date;
  remarks?: string | null;
  kind: "drawn" | "photo" | "name_only";
  file?: { fileName: string; declaredType: string; bytes: Uint8Array } | null;
  idempotencyKey: string;
};

/**
 * W09-09 acknowledgment (sales.delivery_receipt.create; documents.file_attachment.create for the image).
 * Shipment dispatched → delivered; DR issued → acknowledged and regenerated "ACKNOWLEDGED <time>".
 */
export async function acknowledgeDeliveryReceipt(ctx: AuthContext, shipmentId: string, input: AcknowledgeInput) {
  ctx.require("sales.delivery_receipt.create");
  const fe: Record<string, string> = {};
  const name = input.receivedByName?.trim() ?? "";
  if (name.length < 2 || name.length > 120) fe.receivedByName = "Enter who received the goods.";
  if (!["drawn", "photo", "name_only"].includes(input.kind)) fe.kind = "Choose how receipt was confirmed.";
  if (input.kind !== "name_only" && !input.file) fe.file = input.kind === "drawn" ? "Draw the signature first." : "Take or choose the photo of the signed copy.";
  if (!(input.receivedAt instanceof Date) || Number.isNaN(input.receivedAt.getTime())) fe.receivedAt = "Enter the date and time.";
  else if (input.receivedAt.getTime() > Date.now() + 5 * 60_000) fe.receivedAt = "The time of receipt cannot be in the future.";
  if ((input.remarks ?? "").length > 600) fe.remarks = "At most 600 characters.";
  if ((input.receivedByPosition ?? "").length > 80) fe.receivedByPosition = "At most 80 characters.";
  if (Object.keys(fe).length) throw new DomainError("validation", Object.values(fe)[0], { fieldErrors: fe });
  if (input.file) ctx.require("documents.file_attachment.create");
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("validation", "The form is missing its submission key. Reload the page and try again.");
  const key = `dr_ack:${input.idempotencyKey}`;

  // Validate and store the image before the transaction (as receiving documents do); the row is written inside.
  let stored: { id: string; key: string; driver: string; contentType: string; bytes: Uint8Array; fileName: string; sha: string } | null = null;
  if (input.file) {
    const [dup] = await db.select({ id: fileAttachments.id }).from(fileAttachments).where(and(eq(fileAttachments.organizationId, ctx.organizationId), eq(fileAttachments.idempotencyKey, key))).limit(1);
    if (!dup) {
      const storage = requireStorage();
      const f = validateUpload(input.file);
      if (f.contentType === "application/pdf") throw new DomainError("validation", "Upload a photo (JPEG, PNG or WebP) of the signed copy or draw the signature.", { field: "file" });
      const id = uuidv7();
      const k = objectKey(ctx.organizationId, id);
      await storage.put(k, f.bytes, f.contentType);
      stored = { id, key: k, driver: storage.driver, contentType: f.contentType, bytes: f.bytes, fileName: f.fileName, sha: createHash("sha256").update(f.bytes).digest("hex") };
    }
  }
  return db.transaction(async (tx) => {
    const body = { shipmentId, name, at: input.receivedAt.toISOString(), kind: input.kind, sha: stored?.sha ?? null };
    const claimed = await claimIdempotencyKey<{ drNumber: string | null; documentNumber: string | null }>(tx, ctx.organizationId, key, "sales.delivery_receipt.acknowledge", body);
    if (claimed) return { ...claimed.replay, replayed: true };
    const peek = await peekShipment(tx, ctx, shipmentId);
    await lockOrder(tx, ctx, peek.salesOrderId);
    const s = await lockShipment(tx, ctx, shipmentId);
    ctx.requireAt("sales.delivery_receipt.create", s.siteId);
    if (s.status !== "dispatched") throw new DomainError("state", `Shipment ${s.shipmentNumber ?? s.deliveryReceiptNumber} is ${s.status}; receipt is acknowledged for a dispatched shipment.`);
    if (s.dispatchedAt && input.receivedAt.getTime() < Math.floor(s.dispatchedAt.getTime() / 60_000) * 60_000) throw new DomainError("validation", "The time of receipt cannot be before dispatch.", { field: "receivedAt" });
    let dr = await liveDeliveryReceipt(tx, s.id, true);
    if (!dr) {
      // Shipments dispatched before Wave 3 have no DR row: record it from the shipment's DR number.
      [dr] = await tx.insert(deliveryReceipts).values({ organizationId: ctx.organizationId, siteId: s.siteId, shipmentId: s.id, drNumber: s.deliveryReceiptNumber, status: "issued", issuedAt: s.dispatchedAt, issuedBy: s.dispatchedBy, createdBy: ctx.userId }).returning();
    }
    deliveryReceiptMachine.assert(dr.status, "acknowledged", `Delivery receipt ${dr.drNumber}`);
    let attachmentId: string | null = null;
    if (stored) {
      await tx.insert(fileAttachments).values({
        id: stored.id,
        organizationId: ctx.organizationId,
        siteId: s.siteId,
        storageDriver: stored.driver,
        bucketKey: stored.key,
        fileName: stored.fileName,
        contentType: stored.contentType,
        sizeBytes: stored.bytes.length,
        checksumSha256: stored.sha,
        entityType: "delivery_receipt",
        entityId: dr.id,
        attachmentKind: input.kind === "drawn" ? "signature" : "photo",
        isSensitive: true,
        idempotencyKey: key,
        createdBy: ctx.userId,
      });
      attachmentId = stored.id;
    } else if (input.file) {
      const [dup] = await tx.select({ id: fileAttachments.id }).from(fileAttachments).where(and(eq(fileAttachments.organizationId, ctx.organizationId), eq(fileAttachments.idempotencyKey, key))).limit(1);
      attachmentId = dup?.id ?? null;
    }
    const position = input.receivedByPosition?.trim() || null;
    const remarks = input.remarks?.trim() || null;
    [dr] = await tx
      .update(deliveryReceipts)
      .set({ status: "acknowledged", acknowledgedAt: input.receivedAt, receivedByName: name, receivedByPosition: position, remarks, acknowledgmentKind: input.kind, signatureAttachmentId: attachmentId, acknowledgedByUserId: ctx.userId, updatedAt: new Date() })
      .where(eq(deliveryReceipts.id, dr.id))
      .returning();
    await transitionShipment(tx, ctx, s, "delivered", { deliveredAt: input.receivedAt, receivedByName: name });
    const maxKb = await getSetting(tx, ctx.organizationId, "documents.delivery_receipt.max_embedded_image_kb");
    const embed = stored && stored.bytes.length <= maxKb * 1024 ? `data:${stored.contentType};base64,${Buffer.from(stored.bytes).toString("base64")}` : null;
    const ack: Acknowledgment = {
      receivedByName: name,
      receivedByPosition: position,
      receivedAtText: fmtDateTime(input.receivedAt),
      remarks,
      kindText: KIND_TEXT[input.kind],
      imageDataUri: embed,
      imageNote: stored && !embed ? `Image too large to embed; kept on file (attachment ${stored.id.slice(0, 8)}).` : null,
    };
    const [fresh] = await tx.select().from(shipments).where(eq(shipments.id, s.id));
    const doc = ctx.can("documents.generated_document.create")
      ? await renderDr(tx, ctx, fresh, await deliveryReceiptData(tx, s.id, { drNumber: dr.drNumber, acknowledgment: ack, remarks }), `ACKNOWLEDGED ${fmtDateTime(input.receivedAt)}`).catch((e) => {
          if (e instanceof DomainError && e.code === "setup_required") return null;
          throw e;
        })
      : null;
    if (doc) await tx.update(deliveryReceipts).set({ generatedDocumentId: doc.id }).where(eq(deliveryReceipts.id, dr.id));
    await audit(tx, ctx, {
      action: "sales.delivery_receipt.acknowledged",
      entityType: "delivery_receipt",
      entityId: dr.id,
      entityNumber: dr.drNumber,
      siteId: s.siteId,
      after: { shipmentNumber: s.shipmentNumber, receivedByName: name, receivedByPosition: position, receivedAt: input.receivedAt.toISOString(), kind: input.kind, attachmentId, remarks, documentNumber: doc?.documentNumber ?? null },
    });
    const result = { drNumber: dr.drNumber, documentNumber: doc?.documentNumber ?? null };
    await storeIdempotentResult(tx, ctx.organizationId, key, body, result);
    return { ...result, replayed: false };
  });
}

/** Voids the live DR of a reversed shipment (called by the reversal inside its transaction). */
export async function voidDeliveryReceiptInTx(tx: Tx, ctx: AuthContext, shipmentId: string, reason: string) {
  const dr = await liveDeliveryReceipt(tx, shipmentId, true);
  if (!dr) return null;
  deliveryReceiptMachine.assert(dr.status, "voided", `Delivery receipt ${dr.drNumber ?? ""}`.trim());
  await tx.update(deliveryReceipts).set({ status: "voided", voidedAt: new Date(), voidedBy: ctx.userId, voidReason: reason, updatedAt: new Date() }).where(eq(deliveryReceipts.id, dr.id));
  await audit(tx, ctx, { action: "sales.delivery_receipt.voided", entityType: "delivery_receipt", entityId: dr.id, entityNumber: dr.drNumber, siteId: dr.siteId, reason });
  return dr;
}

/** Dispatched shipments whose DR is not acknowledged after the configured days (action centre list). */
export async function unacknowledgedDeliveryReceipts(ctx: AuthContext, siteId?: string) {
  ctx.require("sales.delivery_receipt.view");
  const site = siteId ?? ctx.currentSiteId;
  ctx.requireSite(site);
  const days = await getSetting(db, ctx.organizationId, "sales.delivery_receipt.unacknowledged_days", site);
  return overdueRows(db, ctx.organizationId, site, days);
}

async function overdueRows(q: DbOrTx, organizationId: string, siteId: string | null, days: number, asOf = new Date()) {
  const conds = [eq(shipments.organizationId, organizationId), eq(shipments.status, "dispatched"), lt(shipments.dispatchedAt, new Date(asOf.getTime() - days * 86_400_000))];
  if (siteId) conds.push(eq(shipments.siteId, siteId));
  return q
    .select({ shipmentId: shipments.id, siteId: shipments.siteId, shipmentNumber: shipments.shipmentNumber, drNumber: shipments.deliveryReceiptNumber, dispatchedAt: shipments.dispatchedAt, orderNumber: salesOrders.orderNumber, customerName: customers.name, days: sql<number>`floor(extract(epoch from (${asOf.toISOString()}::timestamptz - ${shipments.dispatchedAt})) / 86400)::int` })
    .from(shipments)
    .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(...conds))
    .orderBy(asc(shipments.dispatchedAt));
}

/**
 * Job `sales.delivery_receipt_reminder` (daily): in-app notifications to the site's warehouse,
 * site manager and sales roles for each unacknowledged DR older than the configured days; one per
 * DR and day (dedupe key).
 */
export async function remindUnacknowledged(run: JobRunContext) {
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  let notified = 0;
  for (const o of orgs) {
    const siteRows = await db.select({ id: sites.id }).from(sites).where(eq(sites.organizationId, o.id));
    for (const site of siteRows) {
      const days = await getSetting(db, o.id, "sales.delivery_receipt.unacknowledged_days", site.id);
      const rows = await overdueRows(db, o.id, site.id, days, run.asOf);
      for (const r of rows) {
        const recipients = await usersWithRoles(db, o.id, ["warehouse_operator", "site_manager", "sales_cs"], r.siteId);
        const ids = await notifyUsers(db, recipients, {
          organizationId: o.id,
          siteId: r.siteId,
          kind: "sales.delivery_receipt.unacknowledged",
          severity: "warning",
          title: `DR ${r.drNumber ?? r.shipmentNumber} not acknowledged after ${r.days} days`,
          body: `${r.customerName} · order ${r.orderNumber}. Capture the receiver's name and signature or a photo of the signed copy.`,
          entityType: "shipment",
          entityId: r.shipmentId,
          link: `/sales/shipments/${r.shipmentId}`,
          dedupeKey: `dr-unack:${r.shipmentId}:${run.asOf.toISOString().slice(0, 10)}`,
        });
        notified += ids.length;
      }
    }
  }
  return { notified };
}

/** The current DR document of a shipment for the print page (newest ready DR document). */
export async function currentDeliveryReceiptDocument(ctx: AuthContext, shipmentId: string) {
  ctx.require("sales.delivery_receipt.view");
  if (!isUuid(shipmentId)) throw new DomainError("not_found", "Shipment not found in your sites.");
  const [s] = await db.select().from(shipments).where(and(eq(shipments.id, shipmentId), eq(shipments.organizationId, ctx.organizationId), inArray(shipments.siteId, ctx.allowedSiteIds))).limit(1);
  if (!s) throw new DomainError("not_found", "Shipment not found in your sites.");
  const [doc] = await db
    .select({ d: generatedDocuments, by: users.displayName })
    .from(generatedDocuments)
    .innerJoin(users, eq(users.id, generatedDocuments.generatedBy))
    .where(and(eq(generatedDocuments.sourceEntityType, "shipment"), eq(generatedDocuments.sourceEntityId, s.id), eq(generatedDocuments.documentKind, "delivery_receipt"), eq(generatedDocuments.status, "ready")))
    .orderBy(desc(generatedDocuments.generatedAt))
    .limit(1);
  const dr = await liveDeliveryReceipt(db, s.id);
  return { shipment: s, dr, document: doc?.d ?? null };
}

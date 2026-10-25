import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { deliveryReceipts, products, quoteLines, quotes, salesOrders, shipments } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { fmtDate, fmtDateTime } from "@/lib/qty";
import { deliveryReceiptData } from "@/modules/sales";
import type { PortalCapability } from "./capabilities";
import type { PortalAuthContext } from "./context";
import { isUuid } from "./support";

/**
 * The customer's own documents in the portal (US-8-02 "their own documents only").
 *
 * ONE link function, `portalDocumentHref(kind, id)`, and one registry of document sources. Each source
 * lists and renders documents of the context's customer only, as an allow-listed view (header facts,
 * lines, totals): a customer copy, never the internal document (no driver or plate, no box or
 * location numbers, no internal notes, no staff names). Built in: quotations (`portal.quote.view`) and
 * delivery receipts (`portal.document.view`). Finance registers `invoice` (and statements) with
 * `registerPortalDocumentSource` when invoices exist (Phase 6); nothing else changes.
 */
export type PortalDocumentSummary = { kind: string; id: string; number: string; title: string; date: Date | string | null; statusLabel: string | null; reference: string | null; href: string };

export type PortalDocumentView = {
  kind: string;
  kindLabel: string;
  number: string;
  title: string;
  statusLabel: string | null;
  facts: [string, string][];
  columns: { header: string; numeric?: boolean }[];
  rows: string[][];
  totals: [string, string][];
  notes: string[];
};

export type PortalDocumentSource = {
  kind: string;
  label: string;
  capability: PortalCapability;
  list: (ctx: PortalAuthContext) => Promise<PortalDocumentSummary[]>;
  /** null when the id is not a document of this customer (the caller answers 404). */
  view: (ctx: PortalAuthContext, id: string) => Promise<PortalDocumentView | null>;
};

/** The one link to a portal document. */
export function portalDocumentHref(kind: string, id: string): string {
  return `/portal/documents/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`;
}

const g = globalThis as unknown as { __portalDocumentSources?: Map<string, PortalDocumentSource> };
function registry(): Map<string, PortalDocumentSource> {
  g.__portalDocumentSources ??= new Map();
  return g.__portalDocumentSources;
}

/** Adds (or replaces) a document source; idempotent per kind. */
export function registerPortalDocumentSource(source: PortalDocumentSource) {
  if (!/^[a-z_]{2,40}$/.test(source.kind)) throw new Error(`Invalid portal document kind ${source.kind}`);
  registry().set(source.kind, source);
}

export function portalDocumentKinds(): { kind: string; label: string }[] {
  ensureBuiltIns();
  return [...registry().values()].map((s) => ({ kind: s.kind, label: s.label }));
}

/** Every document of the signed-in customer the portal role may see, newest first. */
export async function listPortalDocuments(ctx: PortalAuthContext, filter: { kind?: string } = {}): Promise<PortalDocumentSummary[]> {
  ensureBuiltIns();
  const sources = [...registry().values()].filter((s) => ctx.can(s.capability) && (!filter.kind || s.kind === filter.kind));
  const all = (await Promise.all(sources.map((s) => s.list(ctx)))).flat();
  const t = (d: Date | string | null) => (d ? new Date(d).getTime() : 0);
  return all.sort((a, b) => t(b.date) - t(a.date));
}

/** One document of the signed-in customer; 404 for unknown kinds, foreign ids and missing capability alike. */
export async function getPortalDocument(ctx: PortalAuthContext, kind: string, id: string): Promise<PortalDocumentView> {
  ensureBuiltIns();
  const s = registry().get(kind);
  if (!s || !isUuid(id)) throw new DomainError("not_found", "Document not found.");
  ctx.require(s.capability);
  const v = await s.view(ctx, id);
  if (!v) throw new DomainError("not_found", "Document not found.");
  return v;
}

/* ------------------------------------------------------------------ built-in sources */

const QUOTE_VISIBLE = ["sent", "accepted", "rejected", "expired", "converted"] as const;
const QUOTE_LABEL: Record<string, string> = { sent: "Open", accepted: "Accepted", rejected: "Declined", expired: "Expired", converted: "Ordered" };
const money = (v: Decimal.Value, currency: string) => `${currency} ${new Decimal(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

const quotationSource: PortalDocumentSource = {
  kind: "quotation",
  label: "Quotations",
  capability: "portal.quote.view",
  async list(ctx) {
    const rows = await db
      .select({ id: quotes.id, number: quotes.quoteNumber, status: quotes.status, sentAt: quotes.sentAt, createdAt: quotes.createdAt, validUntil: quotes.validUntil })
      .from(quotes)
      .where(and(eq(quotes.customerId, ctx.customerId), eq(quotes.organizationId, ctx.organizationId), inArray(quotes.status, [...QUOTE_VISIBLE])))
      .orderBy(desc(quotes.createdAt));
    return rows.map((r) => ({ kind: "quotation", id: r.id, number: r.number, title: `Quotation ${r.number}`, date: r.sentAt ?? r.createdAt, statusLabel: QUOTE_LABEL[r.status] ?? null, reference: `valid until ${fmtDate(r.validUntil)}`, href: portalDocumentHref("quotation", r.id) }));
  },
  async view(ctx, id) {
    const [q] = await db
      .select()
      .from(quotes)
      .where(and(eq(quotes.id, id), eq(quotes.customerId, ctx.customerId), eq(quotes.organizationId, ctx.organizationId), inArray(quotes.status, [...QUOTE_VISIBLE])))
      .limit(1);
    if (!q) return null;
    const lines = await db
      .select({ sku: products.skuCode, name: products.name, qty: quoteLines.qtyUnits, unit: quoteLines.unitAmount, currency: quoteLines.currency })
      .from(quoteLines)
      .innerJoin(products, eq(products.id, quoteLines.productId))
      .where(eq(quoteLines.quoteId, q.id))
      .orderBy(asc(quoteLines.lineNo));
    return {
      kind: "quotation",
      kindLabel: "Quotation",
      number: q.quoteNumber,
      title: `Quotation ${q.quoteNumber}`,
      statusLabel: QUOTE_LABEL[q.status] ?? null,
      facts: [
        ["Customer", ctx.customerName],
        ["Date", fmtDate(q.sentAt ?? q.createdAt)],
        ["Valid until", fmtDate(q.validUntil)],
        ["Currency", q.currency],
      ],
      columns: [{ header: "SKU" }, { header: "Product" }, { header: "Quantity", numeric: true }, { header: "Unit price", numeric: true }, { header: "Amount", numeric: true }],
      rows: lines.map((l) => [l.sku, l.name, `${new Decimal(l.qty).toString()} pcs`, money(l.unit, l.currency), money(new Decimal(l.qty).times(l.unit), l.currency)]),
      totals: [
        ["Subtotal", money(q.subtotalAmount, q.currency)],
        ["Tax", money(q.taxAmount, q.currency)],
        ["Total", money(q.totalAmount, q.currency)],
      ],
      notes: q.notesCustomer ? [q.notesCustomer] : [],
    };
  },
};

const DR_LABEL: Record<string, string> = { issued: "Issued", acknowledged: "Received" };

const deliveryReceiptSource: PortalDocumentSource = {
  kind: "delivery_receipt",
  label: "Delivery receipts",
  capability: "portal.document.view",
  async list(ctx) {
    const rows = await db
      .select({ id: deliveryReceipts.id, number: deliveryReceipts.drNumber, status: deliveryReceipts.status, issuedAt: deliveryReceipts.issuedAt, orderNumber: salesOrders.orderNumber })
      .from(deliveryReceipts)
      .innerJoin(shipments, eq(shipments.id, deliveryReceipts.shipmentId))
      .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
      .where(and(eq(salesOrders.customerId, ctx.customerId), eq(deliveryReceipts.organizationId, ctx.organizationId), inArray(deliveryReceipts.status, ["issued", "acknowledged"])))
      .orderBy(desc(deliveryReceipts.issuedAt));
    return rows.map((r) => ({ kind: "delivery_receipt", id: r.id, number: r.number ?? "—", title: `Delivery receipt ${r.number ?? ""}`.trim(), date: r.issuedAt, statusLabel: DR_LABEL[r.status] ?? null, reference: `order ${r.orderNumber}`, href: portalDocumentHref("delivery_receipt", r.id) }));
  },
  async view(ctx, id) {
    const [r] = await db
      .select({ dr: deliveryReceipts, customerId: salesOrders.customerId })
      .from(deliveryReceipts)
      .innerJoin(shipments, eq(shipments.id, deliveryReceipts.shipmentId))
      .innerJoin(salesOrders, eq(salesOrders.id, shipments.salesOrderId))
      .where(and(eq(deliveryReceipts.id, id), eq(salesOrders.customerId, ctx.customerId), eq(deliveryReceipts.organizationId, ctx.organizationId), inArray(deliveryReceipts.status, ["issued", "acknowledged"])))
      .limit(1);
    if (!r) return null;
    const d = await deliveryReceiptData(db, r.dr.shipmentId, { drNumber: r.dr.drNumber });
    // Allow-list: the customer copy without driver, plate, box numbers, weights, remarks or the ship-from site.
    const facts: [string, string][] = [
      ["Customer", d.customer.name],
      ["Deliver to", d.customer.shipTo],
      ["Order", d.dr.orderNumber],
      ...(d.dr.customerPo ? ([["Your PO", d.dr.customerPo]] as [string, string][]) : []),
      ["Shipment", d.dr.shipmentNumber],
      ["Dispatched", d.dr.dispatchedText ?? (r.dr.issuedAt ? fmtDateTime(r.dr.issuedAt) : "—")],
      ...(d.dr.carrier ? ([["Carrier", d.dr.carrier]] as [string, string][]) : []),
      ...(d.dr.trackingNumber ? ([["Tracking number", d.dr.trackingNumber]] as [string, string][]) : []),
      ...(d.dr.packagesText ? ([["Packages", d.dr.packagesText]] as [string, string][]) : []),
      ...(r.dr.acknowledgedAt ? ([["Received", `${fmtDateTime(r.dr.acknowledgedAt)}${r.dr.receivedByName ? ` by ${r.dr.receivedByName}` : ""}`]] as [string, string][]) : []),
    ];
    return {
      kind: "delivery_receipt",
      kindLabel: "Delivery receipt",
      number: r.dr.drNumber ?? "—",
      title: `Delivery receipt ${r.dr.drNumber ?? ""}`.trim(),
      statusLabel: DR_LABEL[r.dr.status] ?? null,
      facts,
      columns: [{ header: "SKU" }, { header: "Product" }, { header: "Lot" }, { header: "Expiry" }, { header: "Shipped", numeric: true }, { header: "Ordered", numeric: true }, { header: "Still to come", numeric: true }],
      rows: d.lines.map((l) => [l.sku, l.productName, l.lotNumber, l.expiresText ?? "—", l.shippedText, l.orderedText, l.remainingText]),
      totals: [["Total shipped", d.totals.unitsText]],
      notes: d.statutoryText ? [d.statutoryText] : [],
    };
  },
};

function ensureBuiltIns() {
  const r = registry();
  if (!r.has("quotation")) r.set("quotation", quotationSource);
  if (!r.has("delivery_receipt")) r.set("delivery_receipt", deliveryReceiptSource);
}

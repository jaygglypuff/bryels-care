import { z } from "zod";
import { html, type SafeHtml } from "../html";
import type { TemplateDefinition } from "../schemas";
import { assertFulfilmentSafe, fulfilmentCss, fulfilmentFoot, fulfilmentHead, idGrid, watermarkOf } from "./fulfilment-shared";
import type { FrozenDataset, Renderer } from "./types";

/**
 * Delivery receipt v1 (US-4-12, US-4-13; docs/reports-and-templates.md §7). Company and ship-from,
 * DR / shipment / order / customer PO numbers, customer and ship-to, carrier, driver and plate, lines
 * with lots and box ids, ordered vs shipped and remaining, the received-by block and remarks; one
 * page per copy (Customer, Driver, File by default, A-RPT-13). Prices are never printed. Statutory
 * wording is configuration validated by the accountant (A-RPT-12). After acknowledgment the DR is
 * regenerated "ACKNOWLEDGED <time>" with the captured image embedded: evidence of receipt, not an
 * electronic signature (A-RPT-14).
 */
export const DELIVERY_RECEIPT_DATASETS = ["delivery_receipt/v1"] as const;

const t = (max: number) => z.string().max(max);
const tn = (max: number) => z.string().max(max).nullable();
/** Only inline raster images we produced from a validated upload. */
const IMAGE_URI = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export const deliveryReceiptDataSchema = z.object({
  company: z.object({ name: t(200), shipFrom: t(300) }),
  dr: z.object({
    drNumber: tn(40),
    shipmentNumber: t(40),
    orderNumber: t(40),
    customerPo: tn(80),
    dispatchedText: tn(60),
    carrier: tn(80),
    trackingNumber: tn(80),
    driverName: tn(80),
    vehiclePlate: tn(20),
    packagesText: tn(20),
    grossWeightText: tn(40),
  }),
  customer: z.object({ code: t(40), name: t(200), shipTo: t(400), contact: tn(160) }),
  lines: z
    .array(
      z.object({
        sku: t(40),
        productName: t(160),
        lotNumber: t(64),
        expiresText: tn(40),
        boxesText: t(2000),
        shippedText: t(40),
        orderedText: t(40),
        remainingText: t(40),
        overShipment: z.boolean(),
      }),
    )
    .max(500),
  totals: z.object({ unitsText: t(60), boxes: z.number().int() }),
  overShipmentText: tn(400),
  copies: z.array(t(40)).min(1).max(5),
  statutoryText: tn(600),
  remarks: tn(600),
  acknowledgment: z
    .object({
      receivedByName: t(120),
      receivedByPosition: tn(80),
      receivedAtText: t(60),
      remarks: tn(600),
      kindText: t(60),
      imageDataUri: z.string().max(6_000_000).regex(IMAGE_URI).nullable(),
      imageNote: tn(200),
    })
    .nullable(),
});
export type DeliveryReceiptData = z.infer<typeof deliveryReceiptDataSchema>;

function copyPage(def: TemplateDefinition, m: FrozenDataset["meta"], d: DeliveryReceiptData, copy: string, wm: string | null, last: boolean): SafeHtml {
  const r = d.dr;
  const a = d.acknowledgment;
  return html`<section class="dr-copy${last ? "" : " dr-break"}" data-testid="dr-copy" data-copy="${copy}">
  ${fulfilmentHead(def, m, "DELIVERY RECEIPT", wm, d.company.shipFrom)}
  <p class="copy-word"><span class="badge inv">${copy.toUpperCase()} COPY</span> ${r.drNumber ? html`<strong class="drno">DR ${r.drNumber}</strong>` : html`<strong class="drno">DRAFT – not issued, no stock moved</strong>`}</p>
  ${idGrid([
    ["Shipment", r.shipmentNumber],
    ["Sales order", r.orderNumber],
    ["Customer PO", r.customerPo],
    ["Dispatched", r.dispatchedText],
    ["Carrier", r.carrier],
    ["Tracking", r.trackingNumber],
    ["Driver", r.driverName],
    ["Vehicle plate", r.vehiclePlate],
  ])}
  ${idGrid([
    ["Customer", `${d.customer.name} (${d.customer.code})`],
    ["Ship to", d.customer.shipTo],
    ["Contact", d.customer.contact],
    ["Packages · weight", [r.packagesText, r.grossWeightText].filter(Boolean).join(" · ") || null],
  ])}
  ${d.overShipmentText ? html`<p class="note"><span class="badge inv">OVER-SHIPMENT APPROVED</span> ${d.overShipmentText}</p>` : ""}
  <table class="grid" data-testid="dr-lines">
    <thead><tr><th>SKU</th><th>Product</th><th>Lot</th><th>Expiry</th><th>Boxes</th><th>Shipped</th><th>Ordered</th><th>Remaining</th></tr></thead>
    <tbody>${d.lines.map(
      (l) => html`<tr>
      <td><strong>${l.sku}</strong></td>
      <td>${l.productName}</td>
      <td>${l.lotNumber}</td>
      <td>${l.expiresText ?? "—"}</td>
      <td>${l.boxesText}</td>
      <td class="num">${l.shippedText}${l.overShipment ? html` <span class="badge">OVER</span>` : ""}</td>
      <td class="num">${l.orderedText}</td>
      <td class="num">${l.remainingText}</td>
    </tr>`,
    )}
    <tr class="group"><td colspan="4">Total</td><td>${d.totals.boxes} box(es)</td><td class="num">${d.totals.unitsText}</td><td colspan="2"></td></tr></tbody>
  </table>
  ${d.remarks ? html`<p class="note"><strong>Remarks:</strong> ${d.remarks}</p>` : ""}
  ${d.statutoryText ? html`<p class="note" data-testid="statutory">${d.statutoryText}</p>` : ""}
  <div class="received keep" data-testid="received-by">
    <h2 class="sec">Received by</h2>
    ${a
      ? html`<div class="ack"><div><p><strong>${a.receivedByName}</strong>${a.receivedByPosition ? html` · ${a.receivedByPosition}` : ""}</p><p>${a.receivedAtText} · ${a.kindText}</p>${a.remarks ? html`<p>Remarks: ${a.remarks}</p>` : ""}${a.imageNote ? html`<p class="note">${a.imageNote}</p>` : ""}<p class="note">Acknowledgment captured as evidence of receipt; it is not an electronic signature.</p></div>
        ${a.imageDataUri ? html`<img class="ack-img" alt="Acknowledgment image" src="${a.imageDataUri}" />` : ""}</div>`
      : html`<div class="sign"><div>Name (print)</div><div>Position</div><div>Date / time</div></div><div class="sign"><div>Signature</div><div>Remarks (short, damaged, refused boxes)</div><div></div></div>`}
  </div>
  ${fulfilmentFoot(def, m, "shipment state")}
</section>`;
}

export const deliveryReceiptRendererV1: Renderer = {
  id: "delivery_receipt",
  version: 1,
  kinds: ["delivery_receipt"],
  datasets: DELIVERY_RECEIPT_DATASETS,
  title: "Delivery receipt (A4, one page per copy)",
  defaultDefinition(): TemplateDefinition {
    return {
      schema_version: "document_template/v1",
      renderer: { id: "delivery_receipt", version: 1 },
      dataset: "delivery_receipt/v1",
      page: { size: "A4", orientation: "portrait", margin_mm: { top: 16, right: 14, bottom: 16, left: 14 } },
      footer: { show_qr: true, uncontrolled_copy_text: "Stock was issued by the dispatch posting; this receipt documents it.", show_hash: true },
      sections: [{ id: "lines", enabled: true }],
      options: { watermarks: "default" },
    };
  },
  validateData(dataset, data) {
    if (!(DELIVERY_RECEIPT_DATASETS as readonly string[]).includes(dataset)) throw new Error(`Delivery receipt renderer v1 does not support dataset ${dataset}.`);
    deliveryReceiptDataSchema.parse(data);
    assertFulfilmentSafe(data);
  },
  render(def, input: FrozenDataset) {
    const d = deliveryReceiptDataSchema.parse(input.data);
    const m = input.meta;
    const wm = watermarkOf(def, m);
    const body = html`<div class="doc doc-screen" data-testid="document">${d.copies.map((c, i) => copyPage(def, m, d, c, wm, i === d.copies.length - 1))}</div>`;
    const extra = `
.dr-copy { position: relative; }
.dr-break { break-after: page; page-break-after: always; margin-bottom: 12mm; }
.copy-word { margin: 2mm 0; display: flex; gap: 3mm; align-items: center; }
.copy-word .drno { font-size: 11pt; }
.received { margin-top: 4mm; }
.ack { display: grid; grid-template-columns: 1fr 60mm; gap: 4mm; align-items: start; }
.ack p { margin: 0 0 1mm; }
.ack-img { width: 60mm; max-height: 40mm; object-fit: contain; border: 0.25mm solid #000; }
@media screen and (max-width: 640px) { .ack { grid-template-columns: 1fr; } .ack-img { width: 100%; } }`;
    return { css: fulfilmentCss(def, m, `DR ${d.dr.drNumber ?? "DRAFT"} · ${d.dr.orderNumber}`, extra), body, pageCount: d.copies.length };
  },
};

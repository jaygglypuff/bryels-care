import { plural } from "@/lib/plural";
import { html, type SafeHtml } from "../html";
import type { TemplateDefinition } from "../schemas";
import { DELIVERY_RECEIPT_DATASETS, type DeliveryReceiptData, deliveryReceiptDataSchema } from "./delivery-receipt-v1";
import { assertFulfilmentSafe, fulfilmentCss, fulfilmentFoot, fulfilmentHead, idGrid, watermarkOf } from "./fulfilment-shared";
import type { FrozenDataset, Renderer } from "./types";

/**
 * Delivery receipt v2 (ADR-124 open point, ADR-133 item 10; renderer-versioning pattern of BMR v2 / label v2). The
 * same dataset `delivery_receipt/v1` as v1; the lines say the product name first with the code small and grey after
 * it ("Calamansi Soap 135 g · ACS-135"), like the other document lines (ADR-124 item 2, `LineName`). Everything else
 * is v1's layout.
 *
 * v1 stays registered and unchanged: receipts issued with a v1 template version re-render to their stored checksum and
 * reprint with v1. A template moves to v2 only when a new template version on this renderer is approved through the
 * template approval (QA); production is never switched by code. The demo seeds approve it as demo data.
 */
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
    <thead><tr><th>Product</th><th>Lot</th><th>Expiry</th><th>Boxes</th><th>Shipped</th><th>Ordered</th><th>Remaining</th></tr></thead>
    <tbody>${d.lines.map(
      (l) => html`<tr>
      <td data-testid="dr-product"><strong>${l.productName}</strong> <span class="code">${l.sku}</span></td>
      <td>${l.lotNumber}</td>
      <td>${l.expiresText ?? "—"}</td>
      <td>${l.boxesText}</td>
      <td class="num">${l.shippedText}${l.overShipment ? html` <span class="badge">OVER</span>` : ""}</td>
      <td class="num">${l.orderedText}</td>
      <td class="num">${l.remainingText}</td>
    </tr>`,
    )}
    <tr class="group"><td colspan="3">Total</td><td>${plural(d.totals.boxes, "box")}</td><td class="num">${d.totals.unitsText}</td><td colspan="2"></td></tr></tbody>
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

export const deliveryReceiptRendererV2: Renderer = {
  id: "delivery_receipt",
  version: 2,
  kinds: ["delivery_receipt"],
  datasets: DELIVERY_RECEIPT_DATASETS,
  title: "Delivery receipt v2 (A4, one page per copy; product name first)",
  defaultDefinition(): TemplateDefinition {
    return {
      schema_version: "document_template/v1",
      renderer: { id: "delivery_receipt", version: 2 },
      dataset: "delivery_receipt/v1",
      page: { size: "A4", orientation: "portrait", margin_mm: { top: 16, right: 14, bottom: 16, left: 14 } },
      footer: { show_qr: true, uncontrolled_copy_text: "Stock was issued by the dispatch posting; this receipt documents it.", show_hash: true },
      sections: [{ id: "lines", enabled: true }],
      options: { watermarks: "default" },
    };
  },
  validateData(dataset, data) {
    if (!(DELIVERY_RECEIPT_DATASETS as readonly string[]).includes(dataset)) throw new Error(`Delivery receipt renderer v2 does not support dataset ${dataset}.`);
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
table.grid td .code { font-size: 7.5pt; color: #555; white-space: nowrap; }
.received { margin-top: 4mm; }
.ack { display: grid; grid-template-columns: 1fr 60mm; gap: 4mm; align-items: start; }
.ack p { margin: 0 0 1mm; }
.ack-img { width: 60mm; max-height: 40mm; object-fit: contain; border: 0.25mm solid #000; }
@media screen and (max-width: 640px) { .ack { grid-template-columns: 1fr; } .ack-img { width: 100%; } }`;
    return { css: fulfilmentCss(def, m, `DR ${d.dr.drNumber ?? "DRAFT"} · ${d.dr.orderNumber}`, extra), body, pageCount: d.copies.length };
  },
};

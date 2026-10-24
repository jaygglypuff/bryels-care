import { z } from "zod";
import { SCAN_VALUE_RE } from "@/lib/scan/payload";
import { payloadSymbol } from "../barcode";
import { html, type SafeHtml } from "../html";
import { LABEL_FIELD_KEYS, type LabelFieldKey, type TemplateDefinition } from "../schemas";
import { FONT_STACK, MONO_STACK, mmCss } from "./shared";
import type { FrozenDataset, Renderer } from "./types";

/**
 * Label renderer v1 (docs/reports-and-templates.md §8.2–8.4, §10 "Labels").
 * One label per page, `@page { size: <w>mm <h>mm; margin: 0 }`, vector QR or Code 128, the
 * encoded value printed under the symbol, status word at print and "Scan to verify", template
 * code/version and the job reference in 5 pt for reprint tracing.
 */

export const LABEL_DATASETS = ["label/material/v1", "label/wip/v1", "label/finished_good/v1", "label/location/v1", "label/test/v1", "label/carton/v1"] as const;

const text = z.string().max(200).nullable().optional();
export const labelDataSchema = z.object({
  label: z.object({
    code: z.string(),
    appliesTo: z.string(),
    symbology: z.enum(["qr", "code128", "ean13"]),
    mediaWidthMm: z.number().min(20).max(220),
    mediaHeightMm: z.number().min(15).max(300),
    dpi: z.number().int(),
    fields: z.array(z.enum(LABEL_FIELD_KEYS)),
  }),
  copies: z.number().int().min(1).max(99),
  entity: z.object({
    payloadType: z.enum(["LOT", "LOC", "BOX", "EQP"]),
    value: z.string().regex(SCAN_VALUE_RE),
    caption: z.string().max(40),
    itemCode: text,
    itemName: text,
    inciName: text,
    supplierName: text,
    supplierLotNumber: text,
    receivedOn: text,
    manufacturedOn: text,
    expiresOn: text,
    expiryLabel: text,
    quantityText: text,
    storageConditions: text,
    batchNumber: text,
    statusWord: text,
    locationName: text,
    warehouseCode: text,
    locationKindWord: text,
    allowedStatuses: text,
    // W3E box / carton labels
    packedOn: text,
    packerInitials: text,
    customerMarks: text,
    boxOfText: text,
  }),
  /** Test pages only: draw the 50 mm (or 40 mm) scaling ruler for T-01. */
  testPage: z.boolean().optional(),
});
export type LabelData = z.infer<typeof labelDataSchema>;

type Layout = "tall" | "wide" | "small";

function layoutOf(w: number, h: number): Layout {
  if (h >= 90) return "tall";
  if (w >= 80 && h >= 40) return "wide";
  return "small";
}

function css(d: LabelData): string {
  const w = d.label.mediaWidthMm;
  const h = d.label.mediaHeightMm;
  const layout = layoutOf(w, h);
  const pad = 2;
  const qr = layout === "tall" ? Math.min(40, w * 0.45) : Math.max(18, Math.min(h - 2 * pad - 5, w * 0.42, 40));
  const big = layout === "small" ? 9 : layout === "wide" ? 13 : 18;
  const small = layout === "tall" ? 9 : 7;
  return `
@page { size: ${mmCss(w)} ${mmCss(h)}; margin: 0; }
.lbl-sheet { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 16px 8px; }
.lbl { width: ${mmCss(w)}; height: ${mmCss(h)}; box-sizing: border-box; padding: ${pad}mm; background: #fff; color: #000;
  font-family: ${FONT_STACK}; overflow: hidden; position: relative; border: 1px solid #bdb9ad; border-radius: 1.5mm;
  display: grid; gap: 2mm; ${layout === "tall" ? "grid-template-rows: auto 1fr;" : `grid-template-columns: ${mmCss(qr)} 1fr;`} }
.lbl.c128 { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
.lbl-sym svg { display: block; width: ${mmCss(qr)}; height: ${mmCss(qr)}; }
.lbl.c128 .lbl-sym svg { width: 100%; height: 12mm; }
.lbl-sym .lbl-pay { font: 600 ${layout === "small" ? 5.5 : 6.5}pt/1.1 ${MONO_STACK}; margin-top: 0.8mm; word-break: break-all; }
.lbl-top { ${layout === "tall" ? "display: grid; grid-template-columns: " + mmCss(qr) + " 1fr; gap: 3mm;" : ""} }
.lbl-main { min-width: 0; display: flex; flex-direction: column; }
.lbl-cap { font: 800 ${layout === "small" ? 6 : 7}pt/1.1 ${FONT_STACK}; letter-spacing: 0.5pt; }
.lbl-id { font: 700 ${big}pt/1.05 ${MONO_STACK}; letter-spacing: -0.2pt; margin-top: 0.6mm; word-break: break-all; }
.lbl-name { font: 600 ${small + 1}pt/1.15 ${FONT_STACK}; margin-top: 0.6mm; max-height: ${layout === "small" ? 3.4 : 7.5}mm; overflow: hidden; }
.lbl-grid { display: grid; grid-template-columns: auto 1fr; column-gap: 1.6mm; row-gap: 0.2mm; font: 400 ${small}pt/1.15 ${FONT_STACK}; margin-top: 0.8mm; }
.lbl-grid dt { color: #333; } .lbl-grid dd { font-weight: 600; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lbl-status { margin-top: auto; border: 0.4mm solid #000; text-align: center; font: 800 ${layout === "small" ? 7 : 9}pt/1.25 ${FONT_STACK}; letter-spacing: 0.5pt; }
.lbl-status.inv { background: #000; color: #fff; }
.lbl-verify { font: 600 ${layout === "small" ? 5.5 : 6.5}pt/1.2 ${FONT_STACK}; text-align: center; margin-top: 0.4mm; }
.lbl-foot { position: absolute; left: ${pad}mm; right: ${pad}mm; bottom: 0.6mm; display: flex; justify-content: space-between; gap: 2mm; font: 400 5pt/1 ${MONO_STACK}; color: #222; }
.lbl-reprint { font-weight: 700; }
.lbl-ruler { margin-top: 1mm; }
.lbl-ruler .bar { height: 2.5mm; border: 0.25mm solid #000; border-top: none; box-sizing: border-box;
  background: repeating-linear-gradient(90deg, #000 0 0.25mm, transparent 0.25mm 5mm); }
.lbl-ruler p { font: 600 6pt/1.2 ${FONT_STACK}; margin: 0.4mm 0 0; }
@media print {
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  .lbl-sheet { display: block; padding: 0; }
  .lbl { border: none; border-radius: 0; break-after: page; page-break-after: always; }
  .lbl:last-child { break-after: auto; page-break-after: auto; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;
}

const FIELD_ROWS: [LabelFieldKey, string, (e: LabelData["entity"]) => string | null | undefined][] = [
  ["inci_name", "INCI", (e) => e.inciName],
  ["supplier_lot", "Sup. lot", (e) => e.supplierLotNumber],
  ["supplier", "Supplier", (e) => e.supplierName],
  ["batch", "Batch", (e) => e.batchNumber],
  ["received", "Received", (e) => e.receivedOn],
  ["manufactured", "Made", (e) => e.manufacturedOn],
  ["expiry", "Expiry", (e) => e.expiresOn],
  ["quantity", "Qty at print", (e) => e.quantityText],
  ["storage", "Storage", (e) => e.storageConditions],
  ["location_name", "Name", (e) => e.locationName],
  ["warehouse", "Warehouse", (e) => e.warehouseCode],
  ["allowed_statuses", "Accepts", (e) => e.allowedStatuses],
  ["packed", "Packed", (e) => e.packedOn],
  ["packer", "Packer", (e) => e.packerInitials],
  ["box_of", "Box", (e) => e.boxOfText],
  ["customer_marks", "Marks", (e) => e.customerMarks],
];

function oneLabel(d: LabelData, f: FrozenDataset["meta"], copyNo: number): SafeHtml {
  const e = d.entity;
  const show = new Set(d.label.fields);
  const { payload, svg } = payloadSymbol(e.payloadType, e.value, d.label.symbology);
  const rows = FIELD_ROWS.filter(([k, , get]) => show.has(k) && get(e)).map(([k, label, get]) => html`<dt>${k === "expiry" && e.expiryLabel ? e.expiryLabel : label}</dt><dd>${get(e)}</dd>`);
  const status = show.has("status_word") && e.statusWord ? e.statusWord : null;
  const kindWord = show.has("location_kind") && e.locationKindWord ? e.locationKindWord : null;
  const layout = layoutOf(d.label.mediaWidthMm, d.label.mediaHeightMm);
  const ruler = d.testPage ? (d.label.mediaWidthMm >= 54 ? 50 : 40) : 0;
  const sym = html`<div class="lbl-sym" data-testid="label-symbol" data-payload="${payload}">${svg}<p class="lbl-pay">${e.value}</p></div>`;
  const main = html`<div class="lbl-main">
      <div class="lbl-cap">${e.caption}</div>
      <div class="lbl-id">${e.value}</div>
      ${show.has("item_name") && (e.itemName || e.itemCode) ? html`<div class="lbl-name">${e.itemName ?? ""}${e.itemCode ? html` · ${e.itemCode}` : ""}</div>` : ""}
      ${rows.length ? html`<dl class="lbl-grid">${rows}</dl>` : ""}
      ${ruler ? html`<div class="lbl-ruler" data-testid="label-ruler"><div class="bar" style="width:${ruler}mm"></div><p>${ruler} mm: measure at 100 % scale (T-01)</p></div>` : ""}
      ${status ? html`<div class="lbl-status${status === "RELEASED" ? "" : " inv"}">${status === "RELEASED" ? "RELEASED" : html`STATUS AT PRINT: ${status}`}</div>` : ""}
      ${kindWord ? html`<div class="lbl-status inv">${kindWord}</div>` : ""}
      ${show.has("scan_to_verify") && status ? html`<div class="lbl-verify">Scan to verify current status</div>` : ""}
    </div>`;
  const foot = html`<div class="lbl-foot"><span>${f.templateCode} v${f.templateVersionNo}${d.copies > 1 ? html` · ${copyNo}/${d.copies}` : ""}</span><span>${f.reprintNo > 0 ? html`<span class="lbl-reprint">REPRINT ${f.reprintNo} · </span>` : ""}${f.traceRef}</span></div>`;
  const cls = `lbl${d.label.symbology === "code128" ? " c128" : ""}`;
  if (layout === "tall") return html`<article class="${cls}" data-testid="label" aria-label="Label ${e.value}"><div class="lbl-top">${sym}${main}</div>${foot}</article>`;
  return html`<article class="${cls}" data-testid="label" aria-label="Label ${e.value}">${sym}${main}${foot}</article>`;
}

export const labelRendererV1: Renderer = {
  id: "label",
  version: 1,
  kinds: ["label"],
  datasets: LABEL_DATASETS,
  title: "Label (one per page, QR or Code 128)",
  defaultDefinition(_kind, dataset = "label/material/v1"): TemplateDefinition {
    return {
      schema_version: "document_template/v1",
      renderer: { id: "label", version: 1 },
      dataset,
      page: { size: "label", orientation: "portrait", margin_mm: { top: 0, right: 0, bottom: 0, left: 0 } },
      sections: [],
      options: { watermarks: "default" },
    };
  },
  validateData(dataset, data) {
    if (!(LABEL_DATASETS as readonly string[]).includes(dataset)) throw new Error(`Label renderer v1 does not support dataset ${dataset}.`);
    labelDataSchema.parse(data);
  },
  render(_definition, input) {
    const d = labelDataSchema.parse(input.data);
    const pages = Array.from({ length: d.copies }, (_, i) => oneLabel(d, input.meta, i + 1));
    return { css: css(d), body: html`<div class="lbl-sheet">${pages}</div>`, pageCount: d.copies };
  },
};

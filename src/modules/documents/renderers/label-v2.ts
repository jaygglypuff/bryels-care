import { payloadSymbol } from "../barcode";
import { html, type SafeHtml } from "../html";
import type { LabelFieldKey, TemplateDefinition } from "../schemas";
import { LABEL_DATASETS, labelDataSchema, type LabelData } from "./label-v1";
import { FONT_STACK, MONO_STACK, mmCss } from "./shared";
import type { FrozenDataset, Renderer } from "./types";

/**
 * Label renderer v2 (ADR-099, live usability audit 2026-10-31). Same datasets and fields as v1; the layout
 * is computed in millimetres from the label size so nothing can fall off the label:
 * - the NAME is the biggest text, then the lot (or box / shelf code) and the expiry, then the other fields;
 * - the QR code (with its quiet zone) is a square that always fits inside the label;
 * - the status bar and the 5 pt trace line are their own rows at the bottom and never cover other text;
 * - small labels (under 40 mm high) drop the less important rows instead of overlapping.
 * v1 stays registered unchanged so labels printed with it re-render to the same checksum.
 */

const PAD = 1.5;
const FOOT = 2.2;

type Geometry = { w: number; h: number; small: boolean; qr: number; status: number; c128bar: number; nameSize: number; idSize: number; rowSize: number; nameLines: number; rows: number };

export function labelGeometry(w: number, h: number): Geometry {
  const small = h < 40 || w < 60;
  const status = small ? 3.6 : 4.8;
  const top = h - 2 * PAD - FOOT - status - 0.8;
  const qr = Math.max(12, Math.min(top, w * 0.42));
  const nameSize = small ? 8 : h >= 90 ? 16 : 12;
  const idSize = small ? 6.5 : h >= 90 ? 11 : 8.5;
  const rowSize = small ? 5.5 : h >= 90 ? 8.5 : 6.5;
  // How many detail rows fit under name (≤2 lines), id line and expiry line.
  const pt = 0.3528; // mm per point
  const used = 1.15 * pt * (nameSize * (small ? 2 : 2) + idSize * 2) + 1;
  const rows = Math.max(0, Math.floor((top - used) / (rowSize * 1.18 * pt)));
  return { w, h, small, qr, status, c128bar: Math.min(12, Math.max(8, top * 0.4)), nameSize, idSize, rowSize, nameLines: 2, rows };
}

export function labelV2CssParts(w: number, h: number): { page: string; face: string; print: string } {
  const g = labelGeometry(w, h);
  const page = `@page { size: ${mmCss(w)} ${mmCss(h)}; margin: 0; }`;
  const face = `.lbl-sheet { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 16px 8px; }
.lbl { width: ${mmCss(w)}; height: ${mmCss(h)}; box-sizing: border-box; padding: ${mmCss(PAD)}; background: #fff; color: #000; font-family: ${FONT_STACK}; overflow: hidden; position: relative; border: 1px solid #bdb9ad; border-radius: 1.5mm; display: grid; grid-template-rows: minmax(0, 1fr) auto ${mmCss(FOOT)}; row-gap: 0.8mm; }
.lbl-top { display: grid; grid-template-columns: ${mmCss(g.qr)} minmax(0, 1fr); column-gap: ${mmCss(g.small ? 1.2 : 2)}; min-height: 0; overflow: hidden; }
.lbl.c128 .lbl-top { grid-template-columns: minmax(0, 1fr); grid-template-rows: ${mmCss(g.c128bar)} minmax(0, 1fr); row-gap: 0.8mm; }
.lbl-sym { width: ${mmCss(g.qr)}; height: ${mmCss(g.qr)}; }
.lbl-sym svg { display: block; width: 100%; height: 100%; }
.lbl.c128 .lbl-sym { width: 100%; height: ${mmCss(g.c128bar)}; }
.lbl-main { min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.lbl-cap { font: 700 ${g.small ? 4.5 : 5.5}pt/1.1 ${FONT_STACK}; letter-spacing: 0.3pt; color: #222; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lbl-name { font: 800 ${g.nameSize}pt/1.1 ${FONT_STACK}; margin-top: 0.3mm; overflow: hidden; display: -webkit-box; -webkit-line-clamp: ${g.nameLines}; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.lbl-key { display: flex; flex-wrap: wrap; column-gap: 1.6mm; font: 700 ${g.idSize}pt/1.15 ${MONO_STACK}; margin-top: 0.4mm; }
.lbl-key span { white-space: nowrap; }
.lbl-key .k { font: 600 ${g.idSize * 0.75}pt/1.15 ${FONT_STACK}; color: #333; margin-right: 0.6mm; }
.lbl-exp { font: 800 ${g.idSize}pt/1.15 ${FONT_STACK}; }
.lbl-grid { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 1.2mm; font: 400 ${g.rowSize}pt/1.18 ${FONT_STACK}; margin: 0.5mm 0 0; overflow: hidden; }
.lbl-grid dt { color: #333; white-space: nowrap; } .lbl-grid dd { font-weight: 600; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lbl-status { height: ${mmCss(g.status)}; box-sizing: border-box; border: 0.35mm solid #000; display: flex; align-items: center; justify-content: center; gap: 1.5mm; font: 800 ${g.small ? 6 : 8}pt/1 ${FONT_STACK}; letter-spacing: 0.4pt; white-space: nowrap; overflow: hidden; }
.lbl-status.inv { background: #000; color: #fff; }
.lbl-status small { font: 600 ${g.small ? 4.5 : 5.5}pt/1 ${FONT_STACK}; letter-spacing: 0; }
.lbl-foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 2mm; font: 400 4.5pt/1 ${MONO_STACK}; color: #222; white-space: nowrap; overflow: hidden; }
.lbl-reprint { font-weight: 700; }
.lbl-ruler .bar { height: 2.5mm; border: 0.25mm solid #000; border-top: none; box-sizing: border-box; background: repeating-linear-gradient(90deg, #000 0 0.25mm, transparent 0.25mm 5mm); }
.lbl-ruler p { font: 600 5pt/1.2 ${FONT_STACK}; margin: 0.3mm 0 0; }`;
  const print = `@media print {
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  .lbl-sheet { display: block; padding: 0; }
  .lbl { border: none; border-radius: 0; break-after: page; page-break-after: always; }
  .lbl:last-child { break-after: auto; page-break-after: auto; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;
  return { page, face, print };
}

const ID_WORD: Record<string, string> = { LOT: "Lot", BOX: "Box", LOC: "Shelf", EQP: "Equipment" };

/** Detail rows in order of importance; small labels keep only what fits. */
const ROWS: [LabelFieldKey, string, (e: LabelData["entity"]) => string | null | undefined][] = [
  ["batch", "Batch", (e) => e.batchNumber],
  ["manufactured", "Made", (e) => e.manufacturedOn],
  ["storage", "Store", (e) => e.storageConditions],
  ["quantity", "Qty", (e) => e.quantityText],
  ["supplier_lot", "Sup. lot", (e) => e.supplierLotNumber],
  ["supplier", "Supplier", (e) => e.supplierName],
  ["received", "Received", (e) => e.receivedOn],
  ["inci_name", "INCI", (e) => e.inciName],
  ["brand", "Brand", (e) => e.brand],
  ["warehouse", "Warehouse", (e) => e.warehouseCode],
  ["allowed_statuses", "Accepts", (e) => e.allowedStatuses],
  ["packed", "Packed", (e) => e.packedOn],
  ["packer", "Packer", (e) => e.packerInitials],
  ["box_of", "Box", (e) => e.boxOfText],
  ["customer_marks", "Marks", (e) => e.customerMarks],
];

function oneLabel(d: LabelData, f: FrozenDataset["meta"], copyNo: number): SafeHtml {
  const e = d.entity;
  const g = labelGeometry(d.label.mediaWidthMm, d.label.mediaHeightMm);
  const show = new Set(d.label.fields);
  const { payload, svg } = payloadSymbol(e.payloadType, e.value, d.label.symbology);
  const name = e.payloadType === "LOC" ? (show.has("location_name") ? e.locationName : null) : show.has("item_name") ? e.itemName : null;
  const expiry = show.has("expiry") && e.expiresOn ? e.expiresOn : null;
  const ruler = d.testPage ? (d.label.mediaWidthMm >= 54 ? 50 : 40) : 0;
  const rows = ROWS.filter(([k, , get]) => show.has(k) && get(e))
    .slice(0, g.rows)
    .map(([, label, get]) => html`<dt>${label}</dt><dd>${get(e)}</dd>`);
  const status = show.has("status_word") && e.statusWord ? e.statusWord : null;
  const kindWord = show.has("location_kind") && e.locationKindWord ? e.locationKindWord : null;
  // Test pages (T-01) show the 50 mm ruler in the status row, so it is measured where the status bar prints.
  const bar = ruler
    ? html`<div class="lbl-ruler" data-testid="label-ruler"><div class="bar" style="width:${ruler}mm"></div><p>${ruler} mm at 100 % (T-01)</p></div>`
    : status
      ? html`<div class="lbl-status${status === "RELEASED" ? "" : " inv"}">${status}${status === "RELEASED" ? "" : g.small ? "" : html` <small>at print</small>`}${show.has("scan_to_verify") && !g.small ? html` <small>· scan to check now</small>` : ""}</div>`
      : kindWord
        ? html`<div class="lbl-status inv">${kindWord}</div>`
        : html`<div></div>`;
  const main = html`<div class="lbl-main">
      <div class="lbl-cap">${e.caption}</div>
      ${name ? html`<div class="lbl-name">${name}</div>` : ""}
      <div class="lbl-key"><span><span class="k">${ID_WORD[e.payloadType] ?? ""}</span>${e.value}</span>${expiry ? html`<span class="lbl-exp"><span class="k">${e.expiryLabel || "Expiry"}</span>${expiry}</span>` : ""}</div>
      ${rows.length ? html`<dl class="lbl-grid">${rows}</dl>` : ""}
    </div>`;
  const sym = html`<div class="lbl-sym" data-testid="label-symbol" data-payload="${payload}">${svg}</div>`;
  const foot = html`<div class="lbl-foot"><span>${f.templateCode} v${f.templateVersionNo}${d.copies > 1 ? html` · ${copyNo}/${d.copies}` : ""}</span><span>${f.reprintNo > 0 ? html`<span class="lbl-reprint">REPRINT ${f.reprintNo} · </span>` : ""}${f.traceRef}</span></div>`;
  const cls = `lbl${d.label.symbology === "code128" ? " c128" : ""}`;
  return html`<article class="${cls}" data-testid="label" aria-label="Label ${e.value}"><div class="lbl-top">${sym}${main}</div>${bar}${foot}</article>`;
}

export const labelRendererV2: Renderer = {
  id: "label",
  version: 2,
  kinds: ["label"],
  datasets: LABEL_DATASETS,
  title: "Label v2 (name first, everything inside the label)",
  defaultDefinition(_kind, dataset = "label/material/v1"): TemplateDefinition {
    return {
      schema_version: "document_template/v1",
      renderer: { id: "label", version: 2 },
      dataset,
      page: { size: "label", orientation: "portrait", margin_mm: { top: 0, right: 0, bottom: 0, left: 0 } },
      sections: [],
      options: { watermarks: "default" },
    };
  },
  validateData(dataset, data) {
    if (!(LABEL_DATASETS as readonly string[]).includes(dataset)) throw new Error(`Label renderer v2 does not support dataset ${dataset}.`);
    labelDataSchema.parse(data);
  },
  render(_definition, input) {
    const d = labelDataSchema.parse(input.data);
    const { page, face, print } = labelV2CssParts(d.label.mediaWidthMm, d.label.mediaHeightMm);
    const pages = Array.from({ length: d.copies }, (_, i) => oneLabel(d, input.meta, i + 1));
    return { css: `\n${page}\n${face}\n${print}`, body: html`<div class="lbl-sheet">${pages}</div>`, pageCount: d.copies };
  },
};

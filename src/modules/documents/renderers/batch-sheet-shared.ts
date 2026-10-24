import { z } from "zod";
import { qrSvg } from "../barcode";
import { html, type SafeHtml } from "../html";
import type { TemplateDefinition } from "../schemas";
import { FONT_STACK, MONO_STACK, cssString } from "./shared";
import type { FrozenDataset } from "./types";

/**
 * Shared A4 chrome for the W2A production sheets (dispensing sheet, traveler):
 * docs/reports-and-templates.md §10 print contract: running header with batch identity on every
 * page, "Page n of m", document number, template code/version and checksum, watermark word, and
 * the BC:DOC QR of the document itself. Lot barcodes are never printed on these sheets: the
 * operator must scan the physical container (US-3-08 AC1).
 */

export const batchIdentitySchema = z.object({
  batchNumber: z.string().max(40),
  batchStatus: z.string().max(40),
  productName: z.string().max(120),
  productSku: z.string().max(40),
  sizeText: z.string().max(40),
  plannedStart: z.string().max(40),
  workOrderNumber: z.string().max(40).nullable(),
  formulaLabel: z.string().max(80),
  routingLabel: z.string().max(80).nullable(),
  lineText: z.string().max(80).nullable(),
  siteText: z.string().max(80),
});
export type BatchIdentity = z.infer<typeof batchIdentitySchema>;

export function sheetCss(def: TemplateDefinition, meta: FrozenDataset["meta"], identity: BatchIdentity): string {
  const m = def.page.margin_mm;
  const size = def.page.size === "Letter" ? "letter" : "A4";
  return `
@page { size: ${size} ${def.page.orientation}; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;
  @top-right { content: ${cssString(`${identity.batchNumber} · ${identity.productName}`)}; font: 8pt ${FONT_STACK}; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt ${FONT_STACK}; }
  @bottom-left { content: ${cssString(`${meta.documentNumber} · ${meta.templateCode} v${meta.templateVersionNo}`)}; font: 7.5pt ${FONT_STACK}; }
}
.doc { font: 9.5pt/13pt ${FONT_STACK}; color: #000; background: #fff; max-width: ${def.page.orientation === "landscape" ? 267 : 180}mm; margin: 0 auto; position: relative; }
.doc-screen { padding: 10mm 0; }
.doc-head { display: grid; grid-template-columns: 1fr auto 1fr; gap: 4mm; align-items: start; border-bottom: 0.3mm solid #000; padding-bottom: 2mm; }
.doc-head .org { font-weight: 700; }
.doc-head .title { text-align: center; font: 700 12pt/1.2 ${FONT_STACK}; letter-spacing: 0.4pt; }
.doc-head .ident { text-align: right; font: 400 8.5pt/1.3 ${MONO_STACK}; }
.doc-wm-word { display: inline-block; border: 0.3mm solid #000; padding: 0 1.5mm; font: 700 8pt/1.4 ${FONT_STACK}; margin-top: 1mm; }
.idgrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1.5mm 4mm; margin: 3mm 0; }
.idgrid div { min-width: 0; }
.idgrid dt { font: 600 7pt/1.2 ${FONT_STACK}; text-transform: uppercase; letter-spacing: 0.3pt; }
.idgrid dd { margin: 0; font: 400 9.5pt/1.3 ${FONT_STACK}; overflow-wrap: anywhere; }
h2.sec { font: 700 10.5pt/1.3 ${FONT_STACK}; margin: 4mm 0 1.5mm; }
table.grid { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
table.grid th, table.grid td { border: 0.25mm solid #000; padding: 1mm 1.4mm; vertical-align: top; text-align: left; }
table.grid th { font-weight: 700; background: #f2f2f2; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
table.grid td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.grid td.blank { min-width: 18mm; height: 7mm; }
table.grid tr { break-inside: avoid; }
.note { font-size: 8pt; margin: 1.5mm 0; }
.sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; margin-top: 6mm; }
.sign div { border-top: 0.3mm solid #000; padding-top: 1mm; font-size: 8pt; }
.doc-foot { border-top: 0.3mm solid #000; padding-top: 2mm; margin-top: 5mm; display: grid; grid-template-columns: 1fr 16mm; gap: 3mm; font: 400 7.5pt/1.3 ${FONT_STACK}; }
.doc-foot .qr svg { width: 16mm; height: 16mm; display: block; }
.doc-foot .mono { font-family: ${MONO_STACK}; }
.doc-wm { position: absolute; inset: 60mm 0 auto 0; text-align: center; font: 800 48pt/1 ${FONT_STACK}; color: rgba(0,0,0,0.12); transform: rotate(-30deg); pointer-events: none; }
@media screen { .doc { overflow-x: auto; } }
@media print {
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  .doc-screen { padding: 0; }
  .doc-wm { position: fixed; inset: 110mm 0 auto 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;
}

export function watermarkOf(def: TemplateDefinition, meta: FrozenDataset["meta"]) {
  if (def.options?.watermarks === "none") return null;
  return meta.reprintNo > 0 ? `REPRINT ${meta.reprintNo}` : meta.watermark;
}

export function sheetHead(def: TemplateDefinition, meta: FrozenDataset["meta"], fallbackTitle: string, watermark: string | null): SafeHtml {
  return html`${watermark ? html`<div class="doc-wm" aria-hidden="true">${watermark}</div>` : ""}
  <header class="doc-head">
    <div class="org">${meta.organizationName}</div>
    <div class="title">${def.header?.title ?? fallbackTitle}</div>
    <div class="ident"><div>${meta.documentNumber}</div><div>${meta.templateCode} v${meta.templateVersionNo} · Rev ${meta.recordRevisionNo}</div>${watermark ? html`<div class="doc-wm-word">${watermark}</div>` : ""}</div>
  </header>`;
}

export function identityBlock(b: BatchIdentity): SafeHtml {
  const items: [string, string | null][] = [
    ["Batch", b.batchNumber],
    ["Product", `${b.productName} (${b.productSku})`],
    ["Batch size", b.sizeText],
    ["Planned start", b.plannedStart],
    ["Work order", b.workOrderNumber],
    ["Formula", b.formulaLabel],
    ["Routing", b.routingLabel],
    ["Line · site", [b.lineText, b.siteText].filter(Boolean).join(" · ")],
  ];
  return html`<dl class="idgrid" data-testid="identity">${items.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v ?? "—"}</dd></div>`)}</dl>`;
}

export function sheetFoot(def: TemplateDefinition, meta: FrozenDataset["meta"]): SafeHtml {
  const docPayload = `BC:DOC:${meta.documentNumber}`;
  return html`<footer class="doc-foot">
    <div>
      <div>Generated ${meta.generatedAt} by ${meta.generatedByName}${meta.siteCode ? html` · ${meta.siteCode}` : ""} · batch state at print: ${meta.sourceState ?? "—"}</div>
      <div class="mono">Template ${meta.templateCode} v${meta.templateVersionNo}${def.footer?.show_hash ? html` · checksum ${meta.definitionChecksum.slice(0, 8)}` : ""} · Source rev ${meta.sourceRevisionAt}</div>
      ${meta.reprintNo > 0 ? html`<div><strong>REPRINT ${meta.reprintNo} of ${meta.reprintOfNumber ?? meta.documentNumber}</strong></div>` : ""}
      ${def.footer?.uncontrolled_copy_text ? html`<div>${def.footer.uncontrolled_copy_text}</div>` : ""}
    </div>
    ${def.footer?.show_qr ? html`<div class="qr" data-payload="${docPayload}">${qrSvg(docPayload)}</div>` : ""}
  </footer>`;
}

/** Fails closed if a value that will be printed looks like a lot barcode payload (never on these sheets). */
export function assertNoLotPayload(data: unknown) {
  if (JSON.stringify(data ?? null).includes("BC:LOT:")) throw new Error("Production sheets never print lot barcodes (BC:LOT); the operator scans the physical container.");
}

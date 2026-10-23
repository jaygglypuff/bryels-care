import { z } from "zod";
import { code128Svg, qrSvg } from "../barcode";
import { html } from "../html";
import type { TemplateDefinition } from "../schemas";
import { FONT_STACK, MONO_STACK, cssString } from "./shared";
import type { FrozenDataset, Renderer } from "./types";

/**
 * A4 / Letter test page v1 (docs/reports-and-templates.md §11.1 item 6, §12 T-01, §1.5, §10).
 *
 * Proves the print contract on a real printer before any controlled document relies on it:
 * running header and footer on every page, document number, template code/version and
 * checksum, watermark word, a 50 mm and a 100 mm ruler, sample QR and Code 128 symbols, the
 * BC:DOC QR of this document, and type sizes. Rendered from sample data only.
 */

export const TEST_PAGE_DATASETS = ["test_page/a4/v1"] as const;

export const testPageDataSchema = z.object({
  purpose: z.string().max(200),
  samplePayloads: z.array(z.string().max(80)).max(4),
});
export type TestPageData = z.infer<typeof testPageDataSchema>;

function pageCss(def: TemplateDefinition, meta: FrozenDataset["meta"]): string {
  const m = def.page.margin_mm;
  const size = def.page.size === "Letter" ? "letter" : "A4";
  const right = `Page " counter(page) " of " counter(pages)`;
  return `
@page { size: ${size} ${def.page.orientation}; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;
  @bottom-right { content: "${right}; font: 8pt ${FONT_STACK}; }
  @bottom-left { content: ${cssString(`${meta.documentNumber} · ${meta.templateCode} v${meta.templateVersionNo}`)}; font: 7.5pt ${FONT_STACK}; }
}
.doc { font: 10pt/14pt ${FONT_STACK}; color: #000; background: #fff; max-width: 180mm; margin: 0 auto; position: relative; }
.doc-screen { padding: 12mm 0; }
.doc-head { display: grid; grid-template-columns: 1fr auto 1fr; gap: 4mm; align-items: start; border-bottom: 0.3mm solid #000; padding-bottom: 2mm; }
.doc-head .org { font-weight: 700; }
.doc-head .title { text-align: center; font: 700 12pt/1.2 ${FONT_STACK}; letter-spacing: 0.4pt; }
.doc-head .ident { text-align: right; font: 400 8.5pt/1.3 ${MONO_STACK}; }
.doc-wm-word { display: inline-block; border: 0.3mm solid #000; padding: 0 1.5mm; font: 700 8pt/1.4 ${FONT_STACK}; margin-top: 1mm; }
.doc-body { padding: 6mm 0; }
.doc-body h2 { font: 700 11pt/1.3 ${FONT_STACK}; margin: 5mm 0 2mm; }
.doc-body p { margin: 0 0 2mm; }
.ruler .bar { height: 4mm; border: 0.3mm solid #000; border-top: none; box-sizing: border-box; background: repeating-linear-gradient(90deg, #000 0 0.3mm, transparent 0.3mm 5mm); }
.ruler p { font: 600 8pt/1.2 ${FONT_STACK}; }
.syms { display: flex; flex-wrap: wrap; gap: 8mm; align-items: flex-end; }
.syms figure { margin: 0; }
.syms .qr svg { width: 28mm; height: 28mm; display: block; }
.syms .c128 svg { width: 80mm; height: 12mm; display: block; }
.syms figcaption { font: 600 7pt/1.2 ${MONO_STACK}; margin-top: 1mm; }
.types p { margin: 0 0 1mm; }
.doc-foot { border-top: 0.3mm solid #000; padding-top: 2mm; display: grid; grid-template-columns: 1fr 14mm; gap: 3mm; font: 400 7.5pt/1.3 ${FONT_STACK}; }
.doc-foot .qr svg { width: 14mm; height: 14mm; display: block; }
.doc-foot .mono { font-family: ${MONO_STACK}; }
.doc-wm { position: absolute; inset: 40mm 0 auto 0; text-align: center; font: 800 54pt/1 ${FONT_STACK}; color: rgba(0,0,0,0.12); transform: rotate(-30deg); pointer-events: none; }
@media print {
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  .doc-screen { padding: 0; }
  .doc-wm { position: fixed; inset: 110mm 0 auto 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;
}

export const testPageRendererV1: Renderer = {
  id: "test_page",
  version: 1,
  kinds: ["test_page"],
  datasets: TEST_PAGE_DATASETS,
  title: "Printer test page (A4 / Letter)",
  defaultDefinition(): TemplateDefinition {
    return {
      schema_version: "document_template/v1",
      renderer: { id: "test_page", version: 1 },
      dataset: "test_page/a4/v1",
      page: { size: "A4", orientation: "portrait", margin_mm: { top: 24, right: 15, bottom: 20, left: 15 } },
      header: { show_logo: false, title: "PRINTER TEST PAGE", identity_fields: [] },
      footer: { show_qr: true, uncontrolled_copy_text: "Printed copies are uncontrolled unless signed", show_hash: true },
      sections: [
        { id: "rulers", enabled: true },
        { id: "symbols", enabled: true },
        { id: "type_sizes", enabled: true },
      ],
      options: { watermarks: "default", show_ruler: true },
    };
  },
  validateData(dataset, data) {
    if (!(TEST_PAGE_DATASETS as readonly string[]).includes(dataset)) throw new Error(`Test page renderer v1 does not support dataset ${dataset}.`);
    testPageDataSchema.parse(data);
  },
  render(def, input) {
    const d = testPageDataSchema.parse(input.data);
    const m = input.meta;
    const enabled = new Set(def.sections.filter((s) => s.enabled).map((s) => s.id));
    const watermark = def.options?.watermarks === "none" ? null : m.reprintNo > 0 ? `REPRINT ${m.reprintNo}` : m.watermark;
    const docPayload = `BC:DOC:${m.documentNumber}`;
    const body = html`<div class="doc doc-screen" data-testid="document">
  ${watermark ? html`<div class="doc-wm" aria-hidden="true">${watermark}</div>` : ""}
  <header class="doc-head">
    <div class="org">${m.organizationName}</div>
    <div class="title">${def.header?.title ?? m.templateName}</div>
    <div class="ident"><div>${m.documentNumber}</div><div>${m.templateCode} v${m.templateVersionNo} · Rev ${m.recordRevisionNo}</div>${watermark ? html`<div class="doc-wm-word">${watermark}</div>` : ""}</div>
  </header>
  <main class="doc-body">
    <p>${d.purpose}</p>
    ${enabled.has("rulers") ? html`<h2>Scale check (T-01)</h2>
    <div class="ruler" data-testid="ruler-50"><div class="bar" style="width:50mm"></div><p>50 mm</p></div>
    <div class="ruler"><div class="bar" style="width:100mm"></div><p>100 mm. Print at 100 % ("Actual size"); measure both bars: ± 0.5 mm.</p></div>` : ""}
    ${enabled.has("symbols") ? html`<h2>Symbols (T-02, T-03)</h2>
    <div class="syms">${d.samplePayloads.map((p) => html`<figure class="qr">${qrSvg(p)}<figcaption>${p}</figcaption></figure>`)}
      ${d.samplePayloads[0] ? html`<figure class="c128">${code128Svg(d.samplePayloads[0])}<figcaption>Code 128: ${d.samplePayloads[0]}</figcaption></figure>` : ""}</div>` : ""}
    ${enabled.has("type_sizes") ? html`<h2>Type sizes</h2>
    <div class="types"><p style="font-size:11pt;font-weight:700">Identity line 11 pt bold: ${m.documentNumber}</p><p style="font-size:10pt">Body 10 pt: The quick brown fox jumps over the lazy dog 0123456789</p><p style="font-size:8.5pt">Table 8.5 pt: 1,234.567 kg · 0.500 g</p><p style="font-size:7.5pt">Caption 7.5 pt: Template ${m.templateCode} v${m.templateVersionNo}</p></div>` : ""}
  </main>
  <footer class="doc-foot">
    <div>
      <div>Generated ${m.generatedAt} by ${m.generatedByName}${m.siteCode ? html` · ${m.siteCode}` : ""}</div>
      <div class="mono">Template ${m.templateCode} v${m.templateVersionNo}${def.footer?.show_hash ? html` · checksum ${m.definitionChecksum.slice(0, 8)}` : ""} · Source rev ${m.sourceRevisionAt}</div>
      ${m.reprintNo > 0 ? html`<div><strong>REPRINT ${m.reprintNo} of ${m.reprintOfNumber ?? m.documentNumber}</strong></div>` : ""}
      ${def.footer?.uncontrolled_copy_text ? html`<div>${def.footer.uncontrolled_copy_text}</div>` : ""}
    </div>
    ${def.footer?.show_qr ? html`<div class="qr" data-payload="${docPayload}">${qrSvg(docPayload)}</div>` : ""}
  </footer>
</div>`;
    return { css: pageCss(def, m), body, pageCount: 1 };
  },
};

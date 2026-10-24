import { qrSvg } from "../barcode";
import { html } from "../html";
import type { TemplateDefinition } from "../schemas";
import { bmrPaperPageDataSchema } from "./bmr-data";
import { logoSvg } from "./bmr-logo";
import { FONT_STACK, MONO_STACK, cssString } from "./shared";
import type { Renderer } from "./types";

/**
 * Hybrid paper record page v1 (US-3-20; docs/reports-and-templates.md §2.5, A-RPT-06).
 *
 * A blank, numbered page for one routing step that the company's SOP requires on paper: batch
 * identity and page reference on every page, the step's instruction, a parameter table with the
 * limits and empty "actual" cells, the checklist with Yes / No / N/A boxes, ruled lines for notes,
 * conducted-by and checked-by signature boxes, and the transcription block (who transcribed, who
 * reviewed). The completed page is scanned and attached to the batch; a different person confirms
 * the transcription. Rendered from frozen data only.
 */

export const BMR_PAPER_DATASETS = ["bmr_paper_page/v1"] as const;

export function defaultBmrPaperPageDefinition(): TemplateDefinition {
  return {
    schema_version: "document_template/v1",
    renderer: { id: "bmr_paper_page", version: 1 },
    dataset: "bmr_paper_page/v1",
    page: { size: "A4", orientation: "portrait", margin_mm: { top: 16, right: 12, bottom: 16, left: 12 } },
    header: { show_logo: true, title: "BMR PAPER RECORD PAGE", identity_fields: ["batch_number", "product_name"] },
    footer: { show_qr: true, uncontrolled_copy_text: "Attach the completed page to the batch record; keep the original with the batch file.", show_hash: true },
    sections: [
      { id: "parameters", enabled: true },
      { id: "checklist", enabled: true },
      { id: "notes", enabled: true, handwritten_lines: true },
      { id: "signatures", enabled: true },
    ],
    options: { watermarks: "default" },
  };
}

export const bmrPaperPageRendererV1: Renderer = {
  id: "bmr_paper_page",
  version: 1,
  kinds: ["bmr"],
  datasets: BMR_PAPER_DATASETS,
  title: "BMR hybrid paper page (blank, for handwritten steps)",
  defaultDefinition: () => defaultBmrPaperPageDefinition(),
  validateDefinition(def) {
    const known = ["parameters", "checklist", "notes", "signatures"];
    const errors = def.sections.filter((s) => !known.includes(s.id)).map((s) => `sections: "${s.id}" is not a paper page section (use ${known.join(", ")}).`);
    if (!def.sections.some((s) => s.id === "signatures" && s.enabled)) errors.push('sections: "signatures" is required on a paper record page.');
    return errors;
  },
  validateData(dataset, data) {
    if (!(BMR_PAPER_DATASETS as readonly string[]).includes(dataset)) throw new Error(`Paper page renderer v1 does not support dataset ${dataset}.`);
    bmrPaperPageDataSchema.parse(data);
  },
  render(def, input) {
    const d = bmrPaperPageDataSchema.parse(input.data);
    const meta = input.meta;
    const p = d.page;
    const on = new Set(def.sections.filter((s) => s.enabled).map((s) => s.id));
    const m = def.page.margin_mm;
    const ident = `Batch ${d.batch.number} · ${p.reference} · ${meta.documentNumber}`;
    const css = `
@page { size: ${def.page.size === "Letter" ? "letter" : "A4"} ${def.page.orientation}; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;
  @top-right { content: ${cssString(ident)}; font: 600 7.5pt ${FONT_STACK}; }
  @bottom-left { content: ${cssString(`${meta.templateCode} v${meta.templateVersionNo}`)}; font: 7pt ${FONT_STACK}; }
  @bottom-right { content: ${cssString(`Batch ${d.batch.number} · ${p.reference} · page `)} counter(page) " of " counter(pages); font: 600 7.5pt ${FONT_STACK}; }
}
.bpp { color: #111; font: 9pt/1.35 ${FONT_STACK}; background: #fff; position: relative; }
.bpp-screen { width: 210mm; max-width: 100%; margin: 0 auto 24px; padding: 12mm; box-sizing: border-box; box-shadow: 0 2px 12px rgba(0,0,0,.12); }
.bpp table { width: 100%; border-collapse: collapse; }
.bpp th, .bpp td { border: 0.8px solid #222; padding: 4px 5px; vertical-align: top; text-align: left; }
.bpp thead { display: table-header-group; }
.bpp tr { break-inside: avoid; }
.bpp h2 { font-size: 9pt; font-weight: 700; margin: 10px 0 4px; text-transform: uppercase; }
.bpp .title { text-align: center; font-weight: 800; font-size: 12pt; }
.bpp .lbl { font-size: 7.5pt; color: #333; display: block; }
.bpp .val { font-weight: 700; font-size: 10pt; }
.bpp .ref { font: 700 11pt ${MONO_STACK}; }
.bpp .logo svg { width: 42mm; height: auto; display: block; }
.bpp .qr svg { width: 20mm; height: 20mm; display: block; }
.bpp .box { display: inline-block; width: 10px; height: 10px; border: 1px solid #222; margin: 0 3px 0 8px; vertical-align: -1px; }
.bpp .line { border-bottom: 0.8px solid #444; height: 8mm; }
.bpp .cell { height: 9mm; }
.bpp .muted { color: #555; font-size: 7.5pt; }
.bpp .wm { position: absolute; top: 40%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg); font: 800 40pt/1 ${FONT_STACK}; color: rgba(0,0,0,.08); white-space: nowrap; pointer-events: none; }
@media print { .bpp-screen { width: auto; margin: 0; padding: 0; box-shadow: none; } .bpp .wm { position: fixed; } }`;
    const payload = `BC:DOC:${meta.documentNumber}`;
    const watermark = def.options?.watermarks === "none" ? null : meta.watermark;
    const body = html`<div class="bpp bpp-screen" data-testid="document" data-document-number="${meta.documentNumber}">
  ${watermark ? html`<div class="wm" aria-hidden="true">${watermark}</div>` : ""}
  <table><tbody>
    <tr><td colspan="3" class="title">${def.header?.title ?? "BMR PAPER RECORD PAGE"}</td></tr>
    <tr>
      <td rowspan="2" style="width:24%;vertical-align:middle">${def.header?.show_logo !== false ? html`<div class="logo">${logoSvg()}</div>` : meta.organizationName}</td>
      <td><span class="lbl">Product Name:</span><span class="val">${d.batch.productName.toUpperCase()}</span> <span class="muted">(${d.batch.productCode})</span></td>
      <td style="width:26%"><span class="lbl">Batch Number:</span><span class="val">${d.batch.number}</span></td>
    </tr>
    <tr>
      <td><span class="lbl">Batch Formula No. / routing:</span>${d.batch.formulaLabel}${d.batch.routingLabel ? ` · ${d.batch.routingLabel}` : ""} · ${d.batch.batchSizeText}</td>
      <td><span class="lbl">Page reference:</span><span class="ref">${p.reference}</span></td>
    </tr>
    <tr>
      <td colspan="2"><span class="lbl">Step:</span><span class="val">${p.stepNo}. ${p.stepName}</span> <span class="muted">(${p.kindLabel}; record mode ${p.mode})</span>
        ${p.instruction ? html`<span style="display:block;margin-top:3px">${p.instruction}</span>` : ""}
        ${p.workInstruction ? html`<span class="muted" style="display:block">Work instruction ${p.workInstruction}</span>` : ""}</td>
      <td>${def.footer?.show_qr !== false ? html`<div class="qr" data-payload="${payload}">${qrSvg(payload, `QR code ${payload}`)}</div>` : ""}<span class="muted">${meta.documentNumber}</span></td>
    </tr>
  </tbody></table>
  ${
    on.has("parameters")
      ? html`<h2>Readings</h2><table><thead><tr><th>Parameter</th><th>Limits</th><th style="width:22%">Actual</th><th style="width:12%">Time</th><th style="width:16%">Initials</th></tr></thead><tbody>${
          p.parameters.length
            ? p.parameters.map((x) => html`<tr><td>${x.name}${x.uom ? html` <span class="muted">(${x.uom})</span>` : ""}</td><td>${x.limits}</td><td class="cell"></td><td></td><td></td></tr>`)
            : [0, 1, 2].map(() => html`<tr><td class="cell"></td><td></td><td></td><td></td><td></td></tr>`)
        }</tbody></table>`
      : ""
  }
  ${
    on.has("checklist") && p.checklist.length
      ? html`<h2>Checklist</h2><table><tbody>${p.checklist.map((c) => html`<tr><td style="width:6%">${c.itemNo}</td><td>${c.text}</td><td style="width:34%">Yes<span class="box"></span> No<span class="box"></span> N/A<span class="box"></span></td></tr>`)}</tbody></table>`
      : ""
  }
  ${on.has("notes") ? html`<h2>Notes</h2>${[0, 1, 2, 3, 4].map(() => html`<div class="line"></div>`)}` : ""}
  ${
    on.has("signatures")
      ? html`<h2>Sign-off</h2><table><tbody>
    <tr><td style="width:50%"><span class="lbl">Conducted by (name, signature, date/time):</span><div class="cell"></div></td><td><span class="lbl">Checked by (name, signature, date/time):</span><div class="cell"></div></td></tr>
    <tr><td><span class="lbl">Transcribed into the system by (name, date):</span><div class="cell"></div></td><td><span class="lbl">Transcription reviewed by (different person, date):</span><div class="cell"></div></td></tr>
  </tbody></table>`
      : ""
  }
  <p class="muted">Issued ${p.issuedAt} by ${p.issuedBy} · Site ${d.batch.siteCode} · Template ${meta.templateCode} v${meta.templateVersionNo}${def.footer?.show_hash !== false ? ` · checksum ${meta.definitionChecksum.slice(0, 8)}` : ""}${meta.reprintNo > 0 ? ` · REPRINT ${meta.reprintNo} of ${meta.reprintOfNumber ?? meta.documentNumber}` : ""}</p>
  <p class="muted">${def.footer?.uncontrolled_copy_text ?? ""} ${d.notice}</p>
</div>`;
    return { css, body, pageCount: null };
  },
};

import { qrSvg } from "../barcode";
import { canonicalJson, sha256Hex } from "../checksum";
import { html, type SafeHtml } from "../html";
import type { TemplateDefinition } from "../schemas";
import { BMR_REQUIRED_SECTIONS, BMR_SECTIONS, bmrDataSchema, type BmrData } from "./bmr-data";
import { logoSvg } from "./bmr-logo";
import { FONT_STACK, MONO_STACK, cssString } from "./shared";
import type { DocumentMeta, FrozenDataset, Renderer } from "./types";

/**
 * Batch Manufacturing Record renderer v1 (US-3-17, US-3-18; docs/reports-and-templates.md §2).
 *
 * Lays out the company's paper BMR (docs/source/bmr-acapulco-soap.jpeg): logo and title block,
 * DISPENSING AND WEIGHING table with TOTAL, PROCEDURE, the conducted/checked checklist, then the
 * yield / test results / final disposition / QA signature / remarks block. Sections the paper
 * form does not have (line clearance answers, process parameters, equipment, packaging
 * reconciliation, deviations, amendments, paper pages, audit appendix) follow in the order of the
 * template definition and can be switched on and off per template version (except C, E, H, J).
 *
 * Pure: reads only the frozen dataset (bmr/v1) and the pinned definition. Identity on every
 * printed page comes from CSS @page margin boxes: "Batch B-xx · page x of y" (ADR-026 browser
 * print, no stored PDF). The content hash (sha256 of the canonical dataset) is printed so a
 * reprint can be shown to carry the same body as the original.
 */

export const BMR_DATASETS = ["bmr/v1"] as const;

type Section = TemplateDefinition["sections"][number];

function label(def: TemplateDefinition, key: string, fallback: string) {
  return def.labels?.en?.[key] ?? fallback;
}

/** First 8 hex of sha256 over the canonical dataset: equal for an original and its reprints. */
export function bmrContentHash(data: unknown): string {
  return sha256Hex(canonicalJson(data)).slice(0, 8);
}

function pageCss(def: TemplateDefinition, meta: DocumentMeta, d: BmrData): string {
  const m = def.page.margin_mm;
  const size = def.page.size === "Letter" ? "letter" : "A4";
  const ident = `Batch ${d.batch.number} · ${d.batch.productName} · ${meta.documentNumber}${meta.watermark ? ` · ${meta.watermark}` : ""}`;
  const pageOf = `Batch ${d.batch.number} · page `;
  const foot = `${meta.templateCode} v${meta.templateVersionNo} · Rev ${meta.recordRevisionNo}`;
  return `
@page { size: ${size} ${def.page.orientation}; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;
  @top-left { content: ${cssString(meta.organizationName || "Bryel's Care")}; font: 7pt ${FONT_STACK}; color: #333; }
  @top-right { content: ${cssString(ident)}; font: 600 7.5pt ${FONT_STACK}; color: #111; }
  @bottom-left { content: ${cssString(foot)}; font: 7pt ${FONT_STACK}; color: #333; }
  @bottom-right { content: ${cssString(pageOf)} counter(page) " of " counter(pages); font: 600 7.5pt ${FONT_STACK}; color: #111; }
}
.bmr { color: #111; font: 9pt/1.3 ${FONT_STACK}; background: #fff; position: relative; }
.bmr-screen { width: 210mm; max-width: 100%; margin: 0 auto 24px; padding: 12mm; box-sizing: border-box; box-shadow: 0 2px 12px rgba(0,0,0,.12); overflow: hidden; }
.bmr table { width: 100%; border-collapse: collapse; }
.bmr th, .bmr td { border: 0.8px solid #222; padding: 3px 5px; vertical-align: top; text-align: left; }
.bmr thead { display: table-header-group; }
.bmr tfoot { display: table-footer-group; }
.bmr tr, .bmr .avoid-break { break-inside: avoid; }
.bmr .page-break { break-before: page; }
.bmr .lbl { font-size: 7.5pt; color: #333; display: block; }
.bmr .val { font-weight: 700; font-size: 10pt; }
.bmr table.disp { table-layout: fixed; font-size: 8pt; }
.bmr table.disp th { font-size: 7.5pt; font-weight: 600; }
.bmr table.disp td, .bmr table.disp th { overflow-wrap: anywhere; }
.bmr .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.bmr th.num { white-space: normal; }
.bmr .nowrap { white-space: nowrap; font-size: 7.5pt; }
.bmr h2 { font-size: 9pt; font-weight: 700; margin: 10px 0 4px; letter-spacing: .02em; text-transform: uppercase; break-after: avoid; }
.bmr .title { text-align: center; font-weight: 800; font-size: 12pt; letter-spacing: .03em; }
.bmr .logo svg { width: 100%; max-width: 46mm; height: auto; display: block; }
.bmr .sig-at { display: block; font-size: 6.5pt; color: #555; }
.bmr .sig-line { display: inline-block; min-width: 38mm; border-bottom: 0.8px solid #222; height: 12px; vertical-align: bottom; }
.bmr .box { display: inline-block; width: 9px; height: 9px; border: 1px solid #222; margin-right: 4px; vertical-align: -1px; text-align: center; line-height: 8px; font-size: 8pt; }
.bmr .muted { color: #555; font-size: 7.5pt; }
.bmr .flag { font-weight: 700; }
.bmr .struck { text-decoration: line-through; color: #555; }
.bmr .reason { display: block; font-size: 7.5pt; color: #333; text-decoration: none; }
.bmr .na { font-style: italic; color: #444; }
.bmr .ident { font: 600 8pt/1.3 ${MONO_STACK}; }
.bmr .qr svg { width: 22mm; height: 22mm; display: block; }
.bmr .qr-small svg { width: 16mm; height: 16mm; display: block; }
.bmr .mark { display: inline-block; border: 1px solid #111; padding: 0 4px; font-weight: 700; font-size: 8pt; }
.bmr .closing { display: flex; gap: 6mm; align-items: flex-start; margin-top: 10px; break-inside: avoid; }
.bmr .gap { height: 0; }
.bmr-wm { position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font: 800 40pt/1 ${FONT_STACK}; color: rgba(198, 40, 40, .12); white-space: nowrap; pointer-events: none; z-index: 0; }
.bmr-content { position: relative; z-index: 1; }
@media print {
  html, body { background: #fff !important; }
  .bmr-screen { width: auto; margin: 0; padding: 0; box-shadow: none; overflow: visible; }
  .bmr-wm { position: fixed; top: 45%; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;
}

function signature(s: { name: string; at: string | null } | null, handwritten: boolean): SafeHtml {
  if (!s) return handwritten ? html`<span class="sig-line"></span>` : html``;
  return html`<span>${s.name}${s.at ? html`<span class="sig-at">${s.at}</span>` : ""}</span>`;
}

function notCaptured(what: string): SafeHtml {
  return html`<p class="na">${what} is not captured electronically in this system version; it is part of the paper record.</p>`;
}

/* ------------------------------------------------------------------ sections */

function headerBlock(def: TemplateDefinition, d: BmrData, meta: DocumentMeta): SafeHtml {
  const b = d.batch;
  const qr = def.footer?.show_qr !== false ? html`<div class="qr-small" data-payload="BC:DOC:${meta.documentNumber}">${qrSvg(`BC:DOC:${meta.documentNumber}`, `QR code BC:DOC:${meta.documentNumber}`)}</div>` : "";
  return html`<table class="avoid-break" data-section="header_block">
  <tbody>
    <tr><td colspan="4" class="title">${def.header?.title ?? "BATCH MANUFACTURING RECORD"}</td></tr>
    <tr>
      <td rowspan="2" style="width:24%;vertical-align:middle">${def.header?.show_logo !== false ? html`<div class="logo">${logoSvg()}</div>` : html`<b>${meta.organizationName}</b>`}</td>
      <td colspan="2"><span class="lbl">Product Name:</span><span class="val">${b.productName.toUpperCase()}</span><span class="muted"> (${b.productCode})</span></td>
      <td style="width:26%"><span class="lbl">Batch Number:</span><span class="val">${b.number}</span></td>
    </tr>
    <tr>
      <td><span class="lbl">Department:</span><span class="val">${b.department}</span></td>
      <td><span class="lbl">Batch Formula No.:</span><span class="val">${b.formulaLabel}</span></td>
      <td><span class="lbl">Batch Size:</span><span class="val">${b.batchSizeText}</span></td>
    </tr>
    <tr>
      <td colspan="2"><span class="lbl">Start Date:</span><span class="val">${b.startText ?? ""}</span>${!b.startText && b.plannedStartText ? html`<span class="muted">Planned ${b.plannedStartText}</span>` : ""}</td>
      <td colspan="2"><span class="lbl">End Date:</span><span class="val">${b.endText ?? ""}</span></td>
    </tr>
    <tr>
      <td colspan="3" class="muted">
        Document <span class="ident">${meta.documentNumber}</span> · Rev ${meta.recordRevisionNo} · Site ${b.siteCode}${b.routingLabel ? html` · Routing ${b.routingLabel}` : ""}${b.inspectionPlanLabel ? html` · Inspection plan ${b.inspectionPlanLabel}` : ""}
        · Template ${meta.templateCode} v${meta.templateVersionNo}${meta.watermark ? html` · <span class="mark">${meta.watermark}</span>` : ""}${meta.reprintNo > 0 ? html` · <b>REPRINT ${meta.reprintNo} of ${meta.reprintOfNumber ?? meta.documentNumber}</b>` : ""}
      </td>
      <td>${qr}</td>
    </tr>
  </tbody>
</table>`;
}

function batchSummary(d: BmrData): SafeHtml {
  const s = d.summary;
  return html`<h2>Batch summary</h2>
<table class="avoid-break" data-section="batch_summary"><tbody><tr>
  <td><span class="lbl">State</span><b>${d.batch.statusLabel}</b></td>
  <td><span class="lbl">Steps</span>${s.stepsDone} of ${s.stepsTotal} recorded</td>
  <td><span class="lbl">Open deviations</span>${s.openDeviations === null ? html`<span class="na">not tracked in this version</span>` : String(s.openDeviations)}</td>
  <td><span class="lbl">Holds</span>${s.holds.length ? s.holds.join("; ") : "None"}</td>
  <td><span class="lbl">Reopened</span>${d.batch.reopenCount ? `${d.batch.reopenCount} time(s)` : "Never"}</td>
</tr></tbody></table>`;
}

function materials(def: TemplateDefinition, sec: Section, d: BmrData): SafeHtml {
  const m = d.materials;
  const lines = m.groups.flatMap((g) => g.lines);
  const filler = sec.handwritten_lines ? Math.max(0, 8 - lines.length) : 0;
  const multiGroup = m.groups.length > 1 || (m.groups[0]?.phase ?? null) !== null;
  const lineRows = (l: BmrData["materials"]["groups"][number]["lines"][number]) => {
    const recs = l.records.length ? l.records : [null];
    return recs.map((r, i) => {
      const first = i === 0;
      const cls = r?.struck ? "struck" : "";
      return html`<tr data-line="${l.lineNo}">
        <td>${first ? html`<b>${l.name}</b>${l.inci ? html`<span class="muted" style="display:block">${l.inci}</span>` : ""}<span class="muted">${l.code} · tol ${l.toleranceText}</span>` : html`<span class="muted">… ${l.name}, weighing ${i + 1}</span>`}</td>
        <td class="nowrap"><span class="${cls}">${r?.lotNumber ?? ""}</span>${r?.supplierLot ? html`<span class="muted" style="display:block">${r.supplierLot}</span>` : ""}</td>
        <td><span class="${cls}">${r?.expiryText ?? ""}</span></td>
        <td class="num">${first ? l.theoreticalText : ""}</td>
        <td class="num"><span class="${cls}">${r?.actualText ?? ""}</span>${r?.struck && r.struckReason ? html`<span class="reason">${r.struckReason}</span>` : ""}</td>
        <td>${r ? (r.withinTolerance ? "✓ Yes" : html`<span class="flag">✗ No (exception)</span>`) : ""}${r?.scale ? html`<span class="sig-at">Scale ${r.scale}</span>` : ""}</td>
        <td>${r ? html`<span>${r.operator}<span class="sig-at">${r.at}</span></span>` : sec.handwritten_lines ? "" : ""}</td>
        <td>${r?.checker ?? ""}</td>
      </tr>`;
    });
  };
  return html`<h2>${label(def, "materials_title", "Dispensing and weighing")}</h2>
<table class="disp" data-section="materials">
  <colgroup><col style="width:23%"/><col style="width:12%"/><col style="width:10%"/><col style="width:11%"/><col style="width:11%"/><col style="width:9%"/><col style="width:12%"/><col style="width:12%"/></colgroup>
  <thead><tr>
    <th>${label(def, "ingredient", "Ingredient (INCI Name)")}</th><th>Batch Number</th><th>Expiration Date</th>
    <th class="num">${label(def, "theoretical", "Theoretical Weight/ Volume (g)")}</th><th class="num">${label(def, "actual", "Actual Weigh/ Volume (g)")}</th>
    <th>Within tolerance</th><th>Conducted by</th><th>Checked by</th>
  </tr></thead>
  <tbody>
    ${m.groups.map(
      (g) => html`${multiGroup ? html`<tr><td colspan="8"><b>Phase: ${g.phase ?? "unassigned"}</b></td></tr>` : ""}
      ${g.lines.map(lineRows)}
      ${multiGroup ? html`<tr><td colspan="3"><b>Total (${g.phase ?? "unassigned"})</b></td><td class="num"><b>${g.totalTheoreticalText}</b></td><td class="num"><b>${g.totalActualText}</b></td><td colspan="3"></td></tr>` : ""}`,
    )}
    ${Array.from({ length: filler }, () => html`<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`)}
    <tr><td colspan="3"><b>TOTAL</b></td><td class="num"><b>${m.totalTheoreticalText}</b></td><td class="num"><b>${m.totalActualText}</b></td><td colspan="3" class="muted">${m.toleranceNote}${m.roundingNote ? html` ${m.roundingNote}` : ""}</td></tr>
  </tbody>
</table>`;
}

function processSteps(sec: Section, d: BmrData): SafeHtml {
  const showText = sec.show_instruction_text !== false;
  return html`<h2>Procedure</h2>
<table data-section="process_steps">
  <thead><tr><th style="width:5%">#</th><th style="width:45%">Step and instruction</th><th>Readings / notes</th><th style="width:16%">Record</th></tr></thead>
  <tbody>
    ${d.steps.map(
      (s) => html`<tr>
      <td>${s.stepNo}</td>
      <td><b>${s.name}</b> <span class="muted">(${s.kindLabel})</span>${showText && s.instruction ? html`<span class="muted" style="display:block">${s.instruction}</span>` : ""}${s.workInstruction ? html`<span class="muted" style="display:block">Work instruction ${s.workInstruction}</span>` : ""}</td>
      <td>${s.readings ?? (sec.handwritten_lines ? html`<span class="sig-line" style="min-width:60mm"></span>` : "")}</td>
      <td class="muted">${s.mode}</td>
    </tr>`,
    )}
  </tbody>
</table>`;
}

function checklist(sec: Section, d: BmrData): SafeHtml {
  const hw = !!sec.handwritten_lines;
  return html`<h2>Checklist</h2>
<table class="avoid-break" data-section="checklist">
  <thead><tr><th>Step</th><th style="width:28%">Conducted by</th><th style="width:28%">Checked by</th></tr></thead>
  <tbody>
    ${d.steps.map((s) => html`<tr><td>${s.stepNo}. ${s.name}</td><td>${signature(s.conducted, hw)}</td><td>${signature(s.checked, hw)}</td></tr>`)}
  </tbody>
</table>`;
}

function lineClearance(d: BmrData): SafeHtml {
  const lc = d.lineClearance;
  return html`<h2>Line clearance checklist</h2>
<div data-section="line_clearance">${
    !lc.available
      ? notCaptured("The line clearance checklist")
      : lc.rows.length === 0
        ? html`<p class="muted">No checklist answers recorded.</p>`
        : html`<table><thead><tr><th>Step</th><th>#</th><th>Check</th><th>Answer</th><th>By / at</th></tr></thead><tbody>${lc.rows.map(
            (r) => html`<tr><td>${r.stepNo}. ${r.stepName}</td><td>${r.itemNo}</td><td>${r.text}${r.note ? html`<span class="reason">${r.note}</span>` : ""}</td><td><b>${r.answer}</b></td><td>${r.by ?? ""}<span class="sig-at">${r.at ?? ""}</span></td></tr>`,
          )}</tbody></table>`
  }</div>`;
}

function parameters(d: BmrData): SafeHtml {
  const p = d.parameters;
  return html`<h2>Process parameters</h2>
<div data-section="process_parameters">${
    !p.available
      ? notCaptured("Process parameter readings")
      : p.rows.length === 0
        ? html`<p class="muted">No readings recorded.</p>`
        : html`<table><thead><tr><th>Step</th><th>Parameter</th><th>Limits</th><th class="num">Actual</th><th>Within</th><th>Recorded by / at</th></tr></thead><tbody>${p.rows.map(
            (r) => html`<tr><td>${r.stepNo}</td><td>${r.parameter}${r.uom ? html` <span class="muted">(${r.uom})</span>` : ""}</td><td>${r.limits}</td><td class="num"><span class="${r.struck ? "struck" : ""}">${r.value}</span>${r.struck && r.struckReason ? html`<span class="reason">${r.struckReason}</span>` : ""}</td><td>${r.within === null ? "" : r.within ? "✓" : html`<span class="flag">✗ !</span>`}</td><td>${r.by ?? ""}<span class="sig-at">${r.at ?? ""}</span></td></tr>`,
          )}</tbody></table>`
  }</div>`;
}

function equipment(d: BmrData): SafeHtml {
  const e = d.equipment;
  return html`<h2>Equipment used</h2>
<div data-section="equipment">${
    !e.available
      ? notCaptured("Equipment use")
      : e.rows.length === 0
        ? html`<p class="muted">No equipment use recorded.</p>`
        : html`<table><thead><tr><th>Step</th><th>Equipment</th><th>Calibration due at use</th><th>Cleaning at start</th><th>Operator / at</th><th>Exception</th></tr></thead><tbody>${e.rows.map(
            (r) => html`<tr><td>${r.stepNo ?? ""}</td><td>${r.code} ${r.name}</td><td>${r.calibrationDue ?? ""}</td><td>${r.cleaning ?? ""}</td><td>${r.operator ?? ""}<span class="sig-at">${r.at ?? ""}</span></td><td>${r.exception ?? ""}</td></tr>`,
          )}</tbody></table>`
  }</div>`;
}

function kvTable(rows: { label: string; value: string }[]): SafeHtml {
  return html`<table class="avoid-break"><tbody>${rows.map((r) => html`<tr><td style="width:40%">${r.label}</td><td><b>${r.value}</b></td></tr>`)}</tbody></table>`;
}

function packaging(d: BmrData): SafeHtml {
  const p = d.packaging;
  return html`<h2>Packaging and label reconciliation</h2>
<div data-section="packaging_reconciliation">${!p.available ? notCaptured("Packaging and label reconciliation") : p.rows.length === 0 ? html`<p class="muted">No reconciliation recorded.</p>` : kvTable(p.rows)}</div>`;
}

/** Paper footer block, row 1: theoretical / actual yield / expiry (+ outputs and yield record detail when captured). */
function outputYield(d: BmrData): SafeHtml {
  const y = d.outputYield;
  return html`<table class="avoid-break" data-section="output_yield" style="margin-top:10px"><tbody><tr>
  <td style="width:38%"><span class="lbl">Theoretical Yield:</span><span class="val">${y.theoreticalText}</span></td>
  <td style="width:32%"><span class="lbl">Actual Yield:</span>${y.actualText ? html`<span class="val">${y.actualText}</span>` : ""}${y.detailText ? html`<span class="muted"> ${y.detailText}</span>` : ""}</td>
  <td><span class="lbl">Expiration Date:</span><span class="val">${y.expiryText ?? ""}</span>${y.outputLot ? html`<span class="muted"> (lot ${y.outputLot})</span>` : ""}</td>
</tr>${
    y.outputs.available && y.outputs.rows.length
      ? html`<tr><td colspan="3"><span class="lbl">Outputs:</span>${y.outputs.rows.map((o) => html`<span style="display:block">${o.kind}: ${o.item} · ${o.qty}${o.lot ? html` · lot ${o.lot}` : ""}${o.location ? html` · ${o.location}` : ""}</span>`)}</td></tr>`
      : ""
  }${
    y.yieldRecord.available && y.yieldRecord.rows.length
      ? html`<tr><td colspan="3"><span class="lbl">Yield record:</span>${y.yieldRecord.rows.map((r) => html`<span style="display:inline-block;margin-right:12px">${r.label}: <b>${r.value}</b></span>`)}</td></tr>`
      : ""
  }</tbody></table>`;
}

/** Paper footer block, rows 2–3: test results, test date / conducted / checked. */
function qc(d: BmrData): SafeHtml {
  const q = d.qc;
  return html`<table class="avoid-break" data-section="qc"><tbody>
  <tr><td colspan="3"><span class="lbl">Test Results:</span>${
    q.tests.length === 0
      ? html`<span class="muted">No results recorded.</span>`
      : html`<table style="margin-top:3px"><tbody>${q.tests.map(
          (t) => html`<tr><td style="width:34%">${t.name}</td><td>Spec: ${t.spec}</td><td>Result: ${t.result}</td><td style="width:12%">${t.passed ? "✓ Pass" : html`<span class="flag">✗ Fail</span>`}</td></tr>`,
        )}</tbody></table>`
  }${
    q.inspections.available && q.inspections.rows.length
      ? html`<span class="lbl" style="margin-top:4px">Inspections:</span>${q.inspections.rows.map((i) => html`<span style="display:block">${i.number}${i.plan ? html` (${i.plan})` : ""} · ${i.status}${i.sampledBy ? html` · sampled by ${i.sampledBy}` : ""}${i.reviewedBy ? html` · reviewed by ${i.reviewedBy}` : ""}${i.at ? html` · ${i.at}` : ""}</span>`)}`
      : ""
  }</td></tr>
  <tr>
    <td style="width:38%"><span class="lbl">Test Date:</span>${q.testDateText ?? ""}</td>
    <td style="width:32%"><span class="lbl">Conducted:</span>${q.conductedBy ?? ""}</td>
    <td><span class="lbl">Checked By:</span>${q.checkedBy ?? ""}</td>
  </tr>
</tbody></table>`;
}

function deviations(d: BmrData): SafeHtml {
  const v = d.deviations;
  return html`<h2>Deviations and controlled exceptions</h2>
<div data-section="deviations">${
    !v.available
      ? notCaptured("The deviation register")
      : v.rows.length === 0
        ? html`<p class="muted">No deviations raised for this batch.</p>`
        : html`<table><thead><tr><th>Number</th><th>Kind / severity</th><th>Description</th><th>Status</th><th>Raised</th><th>Closed</th></tr></thead><tbody>${v.rows.map(
            (r) => html`<tr><td class="ident">${r.number}</td><td>${r.kind} · ${r.severity}</td><td>${r.description}</td><td><b>${r.status}</b></td><td>${r.raisedBy ?? ""}<span class="sig-at">${r.raisedAt ?? ""}</span></td><td>${r.closedBy ?? ""}<span class="sig-at">${r.closedAt ?? ""}</span></td></tr>`,
          )}</tbody></table>`
  }${d.exceptions.length ? html`<p><b>Controlled exceptions:</b></p>${d.exceptions.map((e) => html`<p class="muted">${e}</p>`)}` : ""}</div>`;
}

/** Paper footer block, rows 4–5 plus signature lines (J). */
function dispositionSignatures(sec: Section, d: BmrData): SafeHtml {
  const disp = d.disposition;
  const hw = sec.handwritten_lines !== false && d.controlledRecord === "paper";
  const approved = disp?.decision === "release";
  const disapproved = disp?.decision === "reject";
  return html`<table class="avoid-break" data-section="disposition_signatures"><tbody>
  <tr><td colspan="3"><span class="lbl">Final Disposition:</span>
    <span style="display:inline-block;min-width:45%;margin-left:18%"><span class="box">${approved ? "✓" : ""}</span>Approved</span>
    <span><span class="box">${disapproved ? "✓" : ""}</span>Disapproved</span>
    ${disp && disp.decision === "other" ? html`<span style="display:block"><b>${disp.label}</b></span>` : ""}
    ${disp?.reason ? html`<span class="muted" style="display:block">Reason: ${disp.reason}</span>` : ""}
  </td></tr>
  <tr>
    <td colspan="2"><span class="lbl">Name and Signature of QA:</span>${disp ? html`<b>${disp.decidedBy}</b><span class="muted"> (electronically recorded; an attestation, not a validated electronic signature)</span>` : ""}${hw ? html` <span class="sig-line"></span>` : ""}</td>
    <td><span class="lbl">Date:</span>${disp ? disp.decidedAt : ""}</td>
  </tr>
  ${hw ? html`<tr><td style="width:38%"><span class="lbl">Production (conducted by):</span><span class="sig-line"></span></td><td style="width:32%"><span class="lbl">QA reviewer:</span><span class="sig-line"></span></td><td><span class="lbl">Date:</span><span class="sig-line" style="min-width:20mm"></span></td></tr>` : ""}
</tbody></table>`;
}

function remarks(d: BmrData): SafeHtml {
  const active = d.amendments.filter((a) => !a.superseded);
  return html`<table class="avoid-break" data-section="remarks"><tbody><tr><td style="min-height:40px">
  <span class="lbl">Remarks:</span>${d.remarks ?? ""}
  ${d.exceptions.map((e) => html`<span style="display:block">${e}</span>`)}
  ${!d.remarks && d.exceptions.length === 0 && d.amendments.length === 0 ? html`<span class="muted">None</span>` : ""}
  ${
    d.amendments.length
      ? html`<span class="lbl" style="margin-top:6px">Amendments (${active.length} current, append-only):</span>${d.amendments.map(
          (a) => html`<span style="display:block" class="avoid-break">
      <b>A${a.no}</b>${a.reopenNo ? html` (reopen ${a.reopenNo})` : ""} · ${a.section} · ${a.reference}: <span class="struck">${a.previous}</span> → <b class="${a.superseded ? "struck" : ""}">${a.corrected}</b>
      <span class="reason">Reason: ${a.reason} · ${a.by}, ${a.at}${a.superseded ? " · superseded by a later amendment" : ""}</span></span>`,
        )}`
      : ""
  }
  ${d.reopens.length ? html`<span class="lbl" style="margin-top:6px">Reopened:</span>${d.reopens.map((r) => html`<span style="display:block">Reopen ${r.reopenNo} → ${r.target}: ${r.reason} (scope: ${r.scope}) · requested by ${r.requestedBy} · ${r.approvals} · ${r.at}</span>`)}` : ""}
</td></tr></tbody></table>`;
}

function attachments(d: BmrData): SafeHtml {
  return html`<h2>Attachments: paper record pages</h2>
<div data-section="attachments">${
    d.attachments.length === 0
      ? html`<p class="muted">No paper pages for this batch; all steps were recorded electronically.</p>`
      : html`<table><thead><tr><th>Reference</th><th>Step</th><th>Status</th><th>File (sha256)</th><th>Transcribed by</th><th>Reviewed by / at</th></tr></thead><tbody>${d.attachments.map(
          (a) => html`<tr><td class="ident">${a.reference}</td><td>${a.stepLabel}</td><td>${a.status}</td><td>${a.fileName ?? "—"}${a.sha8 ? html` <span class="ident">${a.sha8}</span>` : ""}</td><td>${a.transcribedBy ?? ""}</td><td>${a.reviewedBy ?? ""}<span class="sig-at">${a.reviewedAt ?? ""}</span></td></tr>`,
        )}</tbody></table>`
  }</div>`;
}

function auditAppendix(d: BmrData): SafeHtml {
  return html`<h2>Audit trail appendix</h2>
<div data-section="audit_appendix">
<table class="disp"><colgroup><col style="width:17%"/><col style="width:18%"/><col style="width:25%"/><col style="width:40%"/></colgroup>
  <thead><tr><th>When</th><th>Who</th><th>Event</th><th>Detail</th></tr></thead>
  <tbody>${d.audit.length ? d.audit.map((a) => html`<tr><td class="nowrap">${a.at}</td><td>${a.actor}</td><td>${a.event}</td><td>${a.detail ?? ""}</td></tr>`) : html`<tr><td colspan="4" class="muted">No events.</td></tr>`}</tbody>
</table>
${
  d.documents.length
    ? html`<h2>Earlier documents of this batch</h2><table class="disp"><thead><tr><th>Document</th><th>Generation</th><th>Status</th><th>By</th><th>At</th></tr></thead><tbody>${d.documents.map(
        (x) => html`<tr><td class="ident">${x.number}</td><td>${x.label}</td><td>${x.status}</td><td>${x.by}</td><td class="nowrap">${x.at}</td></tr>`,
      )}</tbody></table>`
    : ""
}
</div>`;
}

function closing(def: TemplateDefinition, d: BmrData, meta: DocumentMeta): SafeHtml {
  const payload = `BC:DOC:${meta.documentNumber}`;
  return html`<div class="closing">
  ${def.footer?.show_qr !== false ? html`<div class="qr" data-payload="${payload}">${qrSvg(payload, `QR code ${payload}`)}</div>` : ""}
  <div class="muted" style="font-size:7.5pt">
    <div>Scan: ${payload} (sign-in required) · Status ${d.batch.statusLabel} · Site ${d.batch.siteCode} · Generated ${meta.generatedAt} by ${meta.generatedByName}</div>
    <div>Formula snapshot ${d.batch.formulaLabel}${d.batch.routingLabel ? html`, routing ${d.batch.routingLabel}` : ""}${d.batch.inspectionPlanLabel ? html`, inspection plan ${d.batch.inspectionPlanLabel}` : ""} taken ${d.batch.snapshotTakenText}; created by ${d.batch.createdBy}.</div>
    <div class="ident">Template ${meta.templateCode} v${meta.templateVersionNo}${def.footer?.show_hash !== false ? html` · checksum ${meta.definitionChecksum.slice(0, 8)} · content ${bmrContentHash(d)}` : ""} · Source rev ${meta.sourceRevisionAt}</div>
    ${meta.reprintNo > 0 ? html`<div><b>REPRINT ${meta.reprintNo} of ${meta.reprintOfNumber ?? meta.documentNumber}</b></div>` : ""}
    <div>Controlled record: ${d.controlledRecord === "paper" ? "the signed paper copy (electronic sign-offs are attestations pending QA validation)" : "this electronic record"}. ${def.footer?.uncontrolled_copy_text ?? ""}</div>
    <div>${d.notice}</div>
  </div>
</div>`;
}

/* ------------------------------------------------------------------ renderer */

const RENDER: Record<string, (def: TemplateDefinition, sec: Section, d: BmrData, meta: DocumentMeta) => SafeHtml> = {
  header_block: (def, _s, d, meta) => headerBlock(def, d, meta),
  batch_summary: (_def, _s, d) => batchSummary(d),
  materials: (def, s, d) => materials(def, s, d),
  process_steps: (_def, s, d) => processSteps(s, d),
  checklist: (_def, s, d) => checklist(s, d),
  line_clearance: (_def, _s, d) => lineClearance(d),
  process_parameters: (_def, _s, d) => parameters(d),
  equipment: (_def, _s, d) => equipment(d),
  packaging_reconciliation: (_def, _s, d) => packaging(d),
  output_yield: (_def, _s, d) => outputYield(d),
  qc: (_def, _s, d) => qc(d),
  deviations: (_def, _s, d) => deviations(d),
  disposition_signatures: (_def, s, d) => dispositionSignatures(s, d),
  remarks: (_def, _s, d) => remarks(d),
  attachments: (_def, _s, d) => attachments(d),
  audit_appendix: (_def, _s, d) => auditAppendix(d),
};

/** US-3-17 AC1: a `bmr` definition must keep C, E, H and J and use only known sections. */
export function bmrDefinitionErrors(def: TemplateDefinition): string[] {
  const errors: string[] = [];
  const known = Object.keys(BMR_SECTIONS);
  for (const s of def.sections) if (!known.includes(s.id)) errors.push(`sections: "${s.id}" is not a BMR section (use ${known.join(", ")}).`);
  const ids = def.sections.map((s) => s.id);
  if (new Set(ids).size !== ids.length) errors.push("sections: each section may appear only once.");
  for (const req of BMR_REQUIRED_SECTIONS) {
    const s = def.sections.find((x) => x.id === req);
    if (!s || !s.enabled) errors.push(`sections: "${req}" (${BMR_SECTIONS[req]}) is required on a BMR and cannot be disabled.`);
  }
  if (def.page.size === "label") errors.push("page.size: a BMR prints on A4 or Letter.");
  return errors;
}

export function defaultBmrDefinition(): TemplateDefinition {
  return {
    schema_version: "document_template/v1",
    renderer: { id: "bmr", version: 1 },
    dataset: "bmr/v1",
    page: { size: "A4", orientation: "portrait", margin_mm: { top: 16, right: 12, bottom: 16, left: 12 } },
    header: { show_logo: true, title: "BATCH MANUFACTURING RECORD", identity_fields: ["batch_number", "product_name", "formula_code_rev"] },
    footer: { show_qr: true, uncontrolled_copy_text: "Printed copies are uncontrolled unless signed.", show_hash: true },
    sections: [
      { id: "header_block", enabled: true },
      { id: "materials", enabled: true, handwritten_lines: true },
      { id: "process_steps", enabled: true, show_instruction_text: true },
      { id: "checklist", enabled: true },
      { id: "output_yield", enabled: true },
      { id: "qc", enabled: true },
      { id: "disposition_signatures", enabled: true, handwritten_lines: true },
      { id: "remarks", enabled: true },
      { id: "batch_summary", enabled: true },
      { id: "line_clearance", enabled: true },
      { id: "process_parameters", enabled: true },
      { id: "equipment", enabled: true },
      { id: "packaging_reconciliation", enabled: true },
      { id: "deviations", enabled: true },
      { id: "attachments", enabled: true },
      { id: "audit_appendix", enabled: true, break_before: "page" },
    ],
    options: { print_percentages: false, watermarks: "default", totals_from_unrounded: true },
  };
}

export const bmrRendererV1: Renderer = {
  id: "bmr",
  version: 1,
  kinds: ["bmr"],
  datasets: BMR_DATASETS,
  title: "Batch Manufacturing Record (paper BMR layout)",
  defaultDefinition: () => defaultBmrDefinition(),
  validateDefinition: (def) => bmrDefinitionErrors(def),
  validateData(dataset, data) {
    if (!(BMR_DATASETS as readonly string[]).includes(dataset)) throw new Error(`BMR renderer v1 does not support dataset ${dataset}.`);
    bmrDataSchema.parse(data);
  },
  render(def, input: FrozenDataset) {
    const d = bmrDataSchema.parse(input.data);
    const meta = input.meta;
    const watermark = def.options?.watermarks === "none" ? null : meta.watermark;
    const parts = def.sections
      .filter((s) => s.enabled && RENDER[s.id])
      .map((s) => (s.break_before === "page" ? html`<div class="page-break"></div>${RENDER[s.id](def, s, d, meta)}` : RENDER[s.id](def, s, d, meta)));
    const body = html`<div class="bmr bmr-screen" data-testid="document" data-document-number="${meta.documentNumber}" aria-label="Batch Manufacturing Record ${d.batch.number}">
  ${watermark ? html`<div class="bmr-wm" aria-hidden="true">${watermark}</div>` : ""}
  <div class="bmr-content">${parts}${closing(def, d, meta)}</div>
</div>`;
    return { css: pageCss(def, meta, d), body, pageCount: null };
  },
};

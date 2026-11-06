import { plural } from "@/lib/plural";
import { qrSvg } from "../barcode";
import { html, type SafeHtml } from "../html";
import type { TemplateDefinition } from "../schemas";
import { bmrDataSchema, type BmrData } from "./bmr-data";
import { logoSvg } from "./bmr-logo";
import { BMR_DATASETS, bmrContentHash, bmrDefinitionErrors } from "./bmr-v1";
import { FONT_STACK, MONO_STACK, cssString } from "./shared";
import type { DocumentMeta, FrozenDataset, Renderer } from "./types";

/**
 * Batch Manufacturing Record renderer v2 (owner request 2026-11: "BMR print is a mess", Chrome print and
 * "Save as PDF"; docs/reports-and-templates.md §2.2, §2.3, §2.7).
 *
 * Same dataset as v1 (`bmr/v1`, with the optional v2 fields), a cleaner A4 portrait layout in seven numbered
 * parts that follow the work: 1 Batch identity and recipe version, 2 Dispensing and weighing, 3 Procedure
 * (each step with who did it, who checked, start and end, readings with units and OK ranges, machines, then
 * the paper checklist), 4 Packaging and labels, 5 Yield, 6 Problems and changes, 7 QA decision and
 * sign-offs (new page), then the appendix (paper pages, audit trail, earlier documents).
 *
 * Printed field names approved on the paper form stay as they are (Product Name, Batch Number, Batch Formula
 * No., Theoretical Weight/ Volume (g), Actual Weigh/ Volume (g), Conducted by, Checked by, Theoretical Yield,
 * Actual Yield, Expiration Date, Test Results, Final Disposition, Name and Signature of QA, Remarks). The
 * template may relabel them through `labels.en`.
 *
 * Chrome (131+) prints the running header and "Page x of y" from @page margin boxes on every page. Rows,
 * step blocks and signature blocks never split; long tables repeat their header. Body 10 pt, tables 9 pt.
 * Pure and deterministic (no clock, no locale, no Intl): v1 stays registered so documents printed with v1
 * re-render to their recorded checksum; a template moves to v2 only when QA approves a new version.
 *
 * Changed in place on 2026-11-06 (live check of the small demo, findings 3–5), the day v2 shipped: v2 was in use
 * only by the demo profiles, which reset (DEMO_SEED_VERSION raised so stored demo BMRs are generated again), so no
 * recorded v2 document outside the demo depends on the earlier output. From here the v2 output is frozen
 * (tests/unit/documents/bmr-v2.test.ts pins its checksum); any later change is a v3. Layout changes:
 * - No forced page break except before part 7. When part 6 is short (nothing or a few lines), parts 6 and 7 are
 *   one block that never splits and moves to a new page only when it does not fit, so "Problems and changes" is
 *   never alone on a page and part 7 is never split; a long part 6 keeps the break before part 7. The appendix
 *   flows on (no break before the audit trail).
 * - Part 7's results table has fixed columns; a result word ("Conforms") never wraps.
 * - A long watermark ("IN PROGRESS — NOT THE FINAL RECORD", the working copy) is set smaller so it fits the page.
 */

type Section = TemplateDefinition["sections"][number];

function label(def: TemplateDefinition, key: string, fallback: string) {
  return def.labels?.en?.[key] ?? fallback;
}

function on(def: TemplateDefinition, id: string): Section | null {
  return def.sections.find((s) => s.id === id && s.enabled) ?? null;
}

/** Running identity for the page margin boxes: "Acapulco Soap 135 g · Batch B-26-0001 · Lot L-2611-00015". */
export function bmrRunningHeader(d: Pick<BmrData, "batch" | "outputYield">): string {
  const lot = d.batch.lotNumber ?? d.outputYield.outputLot ?? null;
  return [d.batch.productName, `Batch ${d.batch.number}`, lot ? `Lot ${lot}` : null].filter(Boolean).join(" · ");
}

function pageCss(def: TemplateDefinition, meta: DocumentMeta, d: BmrData, watermark: string | null): string {
  const m = def.page.margin_mm;
  const size = def.page.size === "Letter" ? "letter" : "A4";
  const left = `${meta.organizationName || "Bryel's Care"} · Batch Manufacturing Record`;
  const foot = `${meta.documentNumber} · Rev ${meta.recordRevisionNo} · ${meta.templateCode} v${meta.templateVersionNo}${meta.reprintNo > 0 ? ` · REPRINT ${meta.reprintNo}` : ""}`;
  return `
@page { size: ${size} ${def.page.orientation}; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;
  @top-left { content: ${cssString(left)}; font: 600 8pt ${FONT_STACK}; color: #222; vertical-align: bottom; padding-bottom: 3mm; }
  @top-right { content: ${cssString(bmrRunningHeader(d))}; font: 700 8.5pt ${FONT_STACK}; color: #111; vertical-align: bottom; padding-bottom: 3mm; }
  @bottom-left { content: ${cssString(foot)}; font: 7.5pt ${FONT_STACK}; color: #333; vertical-align: top; padding-top: 3mm; }
  @bottom-center { content: ${cssString(watermark ?? "")}; font: 700 7.5pt ${FONT_STACK}; color: #333; vertical-align: top; padding-top: 3mm; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 700 8.5pt ${FONT_STACK}; color: #111; vertical-align: top; padding-top: 3mm; }
}
.bmr2 { color: #111; font: 10pt/1.38 ${FONT_STACK}; background: #fff; position: relative; text-align: left; }
.bmr2-screen { width: 210mm; max-width: 100%; margin: 0 auto 24px; padding: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; box-sizing: border-box; box-shadow: 0 2px 12px rgba(0,0,0,.12); overflow: hidden; }
.bmr2 *, .bmr2 *::before, .bmr2 *::after { box-sizing: border-box; }
.bmr2 table { width: 100%; border-collapse: collapse; display: table; font-size: 9pt; line-height: 1.32; margin: 0; }
.bmr2 thead { display: table-header-group; }
.bmr2 tbody { display: table-row-group; }
.bmr2 tfoot { display: table-footer-group; }
.bmr2 tr { display: table-row; break-inside: avoid; page-break-inside: avoid; }
.bmr2 th, .bmr2 td { display: table-cell; border: 0.25mm solid #333; padding: 1.3mm 1.8mm; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
.bmr2 th { font-weight: 700; font-size: 8.5pt; overflow-wrap: normal; hyphens: manual; background: #eef0ec; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.bmr2 .keep { break-inside: avoid; page-break-inside: avoid; }
.bmr2 .page-break { break-before: page; page-break-before: always; }
.bmr2 h1 { font: 800 15pt/1.2 ${FONT_STACK}; letter-spacing: .02em; margin: 0; }
.bmr2 h2 { font: 700 11.5pt/1.25 ${FONT_STACK}; margin: 7mm 0 2mm; padding-bottom: 1mm; border-bottom: 0.5mm solid #111; break-after: avoid; page-break-after: avoid; }
.bmr2 h2 .no { display: inline-block; min-width: 7mm; }
.bmr2 h3 { font: 700 10pt/1.3 ${FONT_STACK}; margin: 4mm 0 1.5mm; break-after: avoid; page-break-after: avoid; }
.bmr2 p { margin: 1mm 0; }
.bmr2 .lbl { display: block; font-size: 7.5pt; font-weight: 600; color: #444; letter-spacing: .01em; }
.bmr2 .val { font-weight: 700; }
.bmr2 .muted { color: #444; font-size: 8.5pt; }
.bmr2 .small { font-size: 8pt; color: #444; display: block; }
.bmr2 .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.bmr2 th.num { white-space: normal; }
.bmr2 .ok { font-weight: 600; }
.bmr2 .flag { font-weight: 800; }
.bmr2 .struck { text-decoration: line-through; color: #555; }
.bmr2 .reason { display: block; font-size: 8pt; color: #333; text-decoration: none; }
.bmr2 .ident { font: 600 8.5pt/1.3 ${MONO_STACK}; }
.bmr2 .mark { display: inline-block; border: 0.3mm solid #111; padding: 0 1.5mm; font-weight: 700; font-size: 8.5pt; }
.bmr2 .sig b { display: block; }
.bmr2 .sig .small { margin-top: .3mm; }
.bmr2 .sig-line { display: block; border-bottom: 0.25mm solid #333; height: 7mm; }
.bmr2 .box { display: inline-block; width: 3.4mm; height: 3.4mm; border: 0.3mm solid #111; margin-right: 1.5mm; vertical-align: -0.6mm; text-align: center; line-height: 3mm; font-size: 8pt; font-weight: 800; }
.bmr2 .titlebar { display: grid; grid-template-columns: 48mm 1fr 24mm; gap: 4mm; align-items: center; border: 0.4mm solid #111; padding: 3mm 4mm; }
.bmr2 .titlebar .logo svg { width: 46mm; height: auto; display: block; }
.bmr2 .titlebar .center { text-align: center; }
.bmr2 .titlebar .qr svg { width: 22mm; height: 22mm; display: block; }
.bmr2 .facts td { width: 25%; }
.bmr2 .step { margin: 0 0 3mm; }
.bmr2 .step th.head { background: #e3e7df; font-size: 9.5pt; }
.bmr2 .step .instr { font-size: 9pt; }
.bmr2 .none { font-style: italic; color: #444; font-size: 9pt; }
.bmr2 ul.plain { margin: 1mm 0 0; padding-left: 5mm; }
.bmr2 ul.plain li { margin: .6mm 0; break-inside: avoid; }
.bmr2 .closing { display: grid; grid-template-columns: 24mm 1fr; gap: 4mm; align-items: start; margin-top: 6mm; padding-top: 3mm; border-top: 0.3mm solid #333; font-size: 8pt; color: #333; break-inside: avoid; }
.bmr2 .closing .qr svg { width: 22mm; height: 22mm; display: block; }
.bmr2 td.word { overflow-wrap: normal; word-break: normal; white-space: nowrap; }
.bmr2-wm { position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font: 800 ${(watermark ?? "").length > 20 ? 24 : 40}pt/1 ${FONT_STACK}; color: rgba(198, 40, 40, ${(watermark ?? "").length > 20 ? ".16" : ".10"}); white-space: nowrap; pointer-events: none; z-index: 0; }
.bmr2-content { position: relative; z-index: 1; }
@media print {
  html, body { background: #fff !important; }
  .bmr2-screen { width: auto; margin: 0; padding: 0; box-shadow: none; overflow: visible; }
  .bmr2-wm { position: fixed; top: 48%; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;
}

/** "Rhea Mendoza" / "Production Operator · 14 Oct 2026, 09:00": name, role and time (owner request). */
function sig(name: string | null | undefined, role: string | null | undefined, at: string | null | undefined, blankLine: boolean): SafeHtml {
  if (!name) return blankLine ? html`<span class="sig-line"></span>` : html`<span class="none">Not yet</span>`;
  const sub = [role, at].filter(Boolean).join(" · ");
  return html`<span class="sig"><b>${name}</b>${sub ? html`<span class="small">${sub}</span>` : ""}</span>`;
}

function none(text: string): SafeHtml {
  return html`<p class="none">${text}</p>`;
}

function notCaptured(what: string): SafeHtml {
  return none(`${what} is not captured electronically in this system version; it is part of the paper record.`);
}

/* ------------------------------------------------------------------ 1 identity */

function part1(def: TemplateDefinition, d: BmrData, meta: DocumentMeta): SafeHtml {
  const b = d.batch;
  const s = d.summary;
  const lot = b.lotNumber ?? d.outputYield.outputLot ?? null;
  const payload = `BC:DOC:${meta.documentNumber}`;
  const showSummary = !!on(def, "batch_summary");
  const cell = (lbl: string, value: SafeHtml | string, extra: SafeHtml | string = "") => html`<td><span class="lbl">${lbl}</span><span class="val">${value}</span>${extra}</td>`;
  return html`<section data-section="header_block">
<div class="titlebar keep">
  <div class="logo">${def.header?.show_logo !== false ? logoSvg() : html`<b>${meta.organizationName}</b>`}</div>
  <div class="center">
    <h1>${def.header?.title ?? "BATCH MANUFACTURING RECORD"}</h1>
    <div class="muted">Document <span class="ident">${meta.documentNumber}</span> · Rev ${meta.recordRevisionNo}</div>
    ${meta.watermark ? html`<div style="margin-top:1mm"><span class="mark">${meta.watermark}</span></div>` : ""}
    ${meta.reprintNo > 0 ? html`<div><b>REPRINT ${meta.reprintNo} of ${meta.reprintOfNumber ?? meta.documentNumber}</b></div>` : ""}
  </div>
  <div class="qr">${def.footer?.show_qr !== false ? html`<div data-payload="${payload}">${qrSvg(payload, `QR code ${payload}`)}</div>` : ""}</div>
</div>
<h2><span class="no">1</span>Batch identity and recipe version</h2>
<table class="facts keep"><tbody>
  <tr>${cell(label(def, "product_name", "Product Name:"), b.productName.toUpperCase(), html`<span class="small">Product code ${b.productCode}</span>`)}${cell(label(def, "batch_number", "Batch Number:"), b.number)}${cell("Lot (finished goods):", lot ?? "Not made yet")}${cell(label(def, "batch_size", "Batch Size:"), b.batchSizeText)}</tr>
  <tr>${cell(label(def, "formula_no", "Batch Formula No.:"), b.formulaLabel, html`<span class="small">Recipe version fixed ${b.snapshotTakenText}</span>${b.recipeApprovalText ? html`<span class="small"><b>${b.recipeApprovalText}</b></span>` : ""}`)}${cell("Steps version:", b.routingLabel ?? "—")}${cell("Inspection plan:", b.inspectionPlanLabel ?? "—")}${cell(label(def, "department", "Department:"), b.department, html`<span class="small">Site ${b.siteCode}</span>`)}</tr>
  <tr>${cell(label(def, "start_date", "Start Date:"), b.startText ?? "", !b.startText && b.plannedStartText ? html`<span class="small">Planned ${b.plannedStartText}</span>` : "")}${cell(label(def, "end_date", "End Date:"), b.endText ?? "")}${cell("Status at print:", b.statusLabel)}${cell("Planned by:", b.createdBy)}</tr>
  ${
    showSummary
      ? html`<tr>${cell("Steps recorded:", `${s.stepsDone} of ${s.stepsTotal}`)}${cell("Open problem reports:", s.openDeviations === null ? "not tracked" : String(s.openDeviations))}${cell("Holds:", s.holds.length ? s.holds.join("; ") : "None")}${cell("Reopened:", b.reopenCount ? plural(b.reopenCount, "time") : "Never")}</tr>`
      : ""
  }
</tbody></table>
</section>`;
}

/* ------------------------------------------------------------------ 2 materials */

function part2(def: TemplateDefinition, sec: Section, d: BmrData): SafeHtml {
  const m = d.materials;
  const anyRecorded = m.groups.some((g) => g.lines.some((l) => l.records.length));
  const filler = sec.handwritten_lines && !anyRecorded ? 3 : 0;
  const multiGroup = m.groups.length > 1 || (m.groups[0]?.phase ?? null) !== null;
  const lineRows = (l: BmrData["materials"]["groups"][number]["lines"][number]): SafeHtml[] => {
    const recs = l.records.length ? l.records : [null];
    return recs.map((r, i) => {
      const first = i === 0;
      const cls = r?.struck ? "struck" : "";
      return html`<tr data-line="${l.lineNo}">
        <td>${first ? html`<b>${l.name}</b>${l.inci ? html`<span class="small">${l.inci}</span>` : ""}<span class="small">${l.code} · allowed ${l.toleranceText}</span>` : html`<span class="small">${l.name}, weighing ${i + 1}</span>`}</td>
        <td><span class="${cls}">${r?.lotNumber ?? ""}</span>${r?.supplierLot ? html`<span class="small">Supplier lot ${r.supplierLot}</span>` : ""}${r ? html`<span class="small">Expires ${r.expiryText}</span>` : ""}</td>
        <td class="num">${first ? l.theoreticalText : ""}</td>
        <td class="num"><span class="${cls}">${r?.actualText ?? ""}</span>${r?.struck && r.struckReason ? html`<span class="reason">${r.struckReason}</span>` : ""}</td>
        <td>${r ? (r.withinTolerance ? html`<span class="ok">✓ Yes</span>` : html`<span class="flag">✗ No</span>${r.exceptionReason ? html`<span class="reason">${r.exceptionReason}</span>` : ""}`) : ""}${r?.scale ? html`<span class="small">Scale ${r.scale}</span>` : ""}</td>
        <td>${r ? sig(r.operator, r.operatorRole, r.at, false) : ""}</td>
        <td>${r ? sig(r.checker, r.checkerRole, r.checkedAt, d.controlledRecord === "paper") : ""}</td>
      </tr>`;
    });
  };
  // Row groups that never split: one per ingredient (its weighings), phase headers with their first line, and
  // the last ingredient together with the blank rows and the TOTAL (§2.3: TOTAL kept with the last rows).
  const chunks: SafeHtml[][] = [];
  for (const g of m.groups) {
    g.lines.forEach((l, i) => chunks.push([...(multiGroup && i === 0 ? [html`<tr><td colspan="7"><b>Phase: ${g.phase ?? "unassigned"}</b></td></tr>`] : []), ...lineRows(l)]));
    if (multiGroup) {
      const total = html`<tr><td colspan="2"><b>Total (${g.phase ?? "unassigned"})</b></td><td class="num"><b>${g.totalTheoreticalText}</b></td><td class="num"><b>${g.totalActualText}</b></td><td colspan="3"></td></tr>`;
      if (chunks.length) chunks[chunks.length - 1].push(total);
      else chunks.push([total]);
    }
  }
  const tail = [
    ...Array.from({ length: filler }, () => html`<tr><td style="height:9mm"></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`),
    html`<tr><td colspan="2"><b>TOTAL</b></td><td class="num"><b>${m.totalTheoreticalText}</b></td><td class="num"><b>${m.totalActualText}</b></td><td colspan="3" class="muted">${m.toleranceNote}${m.roundingNote ? html` ${m.roundingNote}` : ""}</td></tr>`,
  ];
  if (chunks.length) chunks[chunks.length - 1].push(...tail);
  else chunks.push(tail);
  return html`<section data-section="materials">
<h2><span class="no">2</span>${label(def, "materials_title", "Dispensing and weighing")}</h2>
<table>
  <colgroup><col style="width:22%"/><col style="width:14%"/><col style="width:12%"/><col style="width:12%"/><col style="width:8%"/><col style="width:16%"/><col style="width:16%"/></colgroup>
  <thead><tr>
    <th>${label(def, "ingredient", "Ingredient (INCI Name)")}</th><th>${label(def, "lot", "Batch Number")} <span class="small">lot used, expiry</span></th>
    <th class="num">${label(def, "theoretical", "Theoretical Weight/ Volume (g)")}</th><th class="num">${label(def, "actual", "Actual Weigh/ Volume (g)")}</th>
    <th>Within range</th><th>${label(def, "conducted_by", "Conducted by")}</th><th>${label(def, "checked_by", "Checked by")}</th>
  </tr></thead>
  ${chunks.map((c) => html`<tbody class="keep">${c}</tbody>`)}
</table>
</section>`;
}

/* ------------------------------------------------------------------ 3 procedure */

function part3(def: TemplateDefinition, d: BmrData): SafeHtml {
  const stepsSec = on(def, "process_steps");
  const checklistSec = on(def, "checklist");
  const showText = stepsSec?.show_instruction_text !== false;
  // Paper is the controlled record: a signature not yet given prints as a blank line to sign by hand.
  const hw = d.controlledRecord === "paper";
  const showLc = !!on(def, "line_clearance") && d.lineClearance.available;
  const showParams = !!on(def, "process_parameters") && d.parameters.available;
  const showEq = !!on(def, "equipment") && d.equipment.available;
  const block = (s: BmrData["steps"][number]) => {
    const readings = showParams ? d.parameters.rows.filter((r) => r.stepNo === s.stepNo) : [];
    const checks = showLc ? d.lineClearance.rows.filter((r) => r.stepNo === s.stepNo) : [];
    const machines = showEq ? d.equipment.rows.filter((r) => r.stepNo === s.stepNo) : [];
    return html`<table class="step keep" data-step="${s.stepNo}">
  <colgroup><col style="width:25%"/><col style="width:25%"/><col style="width:25%"/><col style="width:25%"/></colgroup>
  <thead><tr><th class="head" colspan="4">Step ${s.stepNo}. ${s.name} <span class="muted">(${s.kindLabel}${s.mode !== "electronic" ? `, ${s.mode}` : ""})</span>${s.statusText ? html` <span class="muted">· ${s.statusText}</span>` : ""}</th></tr></thead>
  <tbody>
  ${showText && (s.instruction || s.workInstruction) ? html`<tr><td colspan="4" class="instr">${s.instruction ?? ""}${s.workInstruction ? html`<span class="small">Work instruction ${s.workInstruction}</span>` : ""}</td></tr>` : ""}
  <tr>
    <td><span class="lbl">${label(def, "conducted_by", "Conducted by")}</span>${sig(s.conducted?.name, s.conducted?.role, s.conducted?.at, hw)}</td>
    <td><span class="lbl">${label(def, "checked_by", "Checked by")}</span>${sig(s.checked?.name, s.checked?.role, s.checked?.at, hw)}</td>
    <td><span class="lbl">Started</span>${s.startText ?? ""}</td>
    <td><span class="lbl">Ended</span>${s.endText ?? ""}</td>
  </tr>
  ${
    readings.length
      ? html`<tr><td colspan="4" style="padding:0"><table><thead><tr><th>Reading</th><th>OK range</th><th class="num">Value</th><th>OK?</th><th>Written by</th></tr></thead><tbody>${readings.map(
          (r) => html`<tr><td>${r.parameter}${r.uom ? html` <span class="muted">(${r.uom})</span>` : ""}</td><td>${r.limits}${r.uom && r.limits !== "—" ? ` ${r.uom}` : ""}</td><td class="num"><span class="${r.struck ? "struck" : "val"}">${r.value}${r.uom ? ` ${r.uom}` : ""}</span>${r.struck && r.struckReason ? html`<span class="reason">${r.struckReason}</span>` : ""}</td><td>${r.within === null ? "—" : r.within ? html`<span class="ok">✓ Yes</span>` : html`<span class="flag">✗ No</span>`}</td><td>${sig(r.by, null, r.at, false)}</td></tr>`,
        )}</tbody></table></td></tr>`
      : ""
  }
  ${s.readings ? html`<tr><td colspan="4"><span class="lbl">Readings and notes</span>${s.readings}</td></tr>` : ""}
  ${s.notes ? html`<tr><td colspan="4"><span class="lbl">Notes</span>${s.notes}</td></tr>` : ""}
  ${
    checks.length
      ? html`<tr><td colspan="4" style="padding:0"><table><thead><tr><th style="width:6%">#</th><th>Check</th><th style="width:14%">Answer</th><th style="width:28%">Answered by</th></tr></thead><tbody>${checks.map(
          (r) => html`<tr><td>${r.itemNo}</td><td>${r.text}${r.note ? html`<span class="reason">${r.note}</span>` : ""}</td><td><b>${r.answer}</b></td><td>${sig(r.by, null, r.at, false)}</td></tr>`,
        )}</tbody></table></td></tr>`
      : ""
  }
  ${
    machines.length
      ? html`<tr><td colspan="4" style="padding:0"><table><thead><tr><th>Machine</th><th>Calibration due at use</th><th>Clean at start</th><th>Used by</th></tr></thead><tbody>${machines.map(
          (e) => html`<tr><td>${e.name} <span class="muted">(${e.code})</span>${e.exception ? html`<span class="reason">Exception: ${e.exception}</span>` : ""}</td><td>${e.calibrationDue ?? "—"}</td><td>${e.cleaning ?? "—"}</td><td>${sig(e.operator, null, e.at, false)}</td></tr>`,
        )}</tbody></table></td></tr>`
      : ""
  }
  </tbody>
</table>`;
  };
  const unassignedMachines = showEq ? d.equipment.rows.filter((r) => r.stepNo === null) : [];
  return html`<section data-section="process_steps">
<h2><span class="no">3</span>${label(def, "procedure_title", "Procedure")}</h2>
${d.steps.length ? (stepsSec ? d.steps.map(block) : "") : none("The steps version of this batch has no steps.")}
${
  unassignedMachines.length
    ? html`<h3>Machines not tied to a step</h3><table class="keep"><thead><tr><th>Machine</th><th>Calibration due at use</th><th>Clean at start</th><th>Used by</th></tr></thead><tbody>${unassignedMachines.map(
        (e) => html`<tr><td>${e.name} <span class="muted">(${e.code})</span></td><td>${e.calibrationDue ?? "—"}</td><td>${e.cleaning ?? "—"}</td><td>${sig(e.operator, null, e.at, false)}</td></tr>`,
      )}</tbody></table>`
    : ""
}
${on(def, "line_clearance") && !d.lineClearance.available ? notCaptured("The line clearance checklist") : ""}
${on(def, "process_parameters") && !d.parameters.available ? notCaptured("Process parameter readings") : ""}
${on(def, "equipment") && !d.equipment.available ? notCaptured("Equipment use") : ""}
${
  checklistSec
    ? html`<div data-section="checklist"><h3>${label(def, "checklist_title", "Checklist")}</h3>
<table class="keep"><thead><tr><th>Step</th><th style="width:30%">${label(def, "conducted_by", "Conducted by")}</th><th style="width:30%">${label(def, "checked_by", "Checked by")}</th></tr></thead>
<tbody>${d.steps.map((s) => html`<tr><td>${s.stepNo}. ${s.name}</td><td>${sig(s.conducted?.name, s.conducted?.role, s.conducted?.at, hw)}</td><td>${sig(s.checked?.name, s.checked?.role, s.checked?.at, hw)}</td></tr>`)}</tbody></table></div>`
    : ""
}
</section>`;
}

/* ------------------------------------------------------------------ 4 packaging */

function part4(d: BmrData): SafeHtml {
  const p = d.packaging;
  const lines = d.packagingLines ?? [];
  const boxes = d.boxes;
  const labels = d.labelsPrinted ?? [];
  const nothing = !lines.length && !p.rows.length && !boxes && !labels.length;
  return html`<section data-section="packaging_reconciliation">
<h2><span class="no">4</span>Packaging and labels</h2>
${
  lines.length
    ? html`<h3>Wrappers and packaging taken</h3><table class="keep"><thead><tr><th>Packaging</th><th class="num">Needed</th><th class="num">Taken</th><th>Lots taken</th></tr></thead><tbody>${lines.map(
        (l) => html`<tr><td><b>${l.name}</b></td><td class="num">${l.neededText}</td><td class="num">${l.takenText}</td><td>${l.lots ?? "—"}</td></tr>`,
      )}</tbody></table>`
    : ""
}
${p.rows.length ? html`<h3>Packaging and label count</h3><table class="keep"><tbody>${p.rows.map((r) => html`<tr><td style="width:38%">${r.label}</td><td><b>${r.value}</b></td></tr>`)}</tbody></table>` : ""}
${
  boxes
    ? html`<h3>Boxes: ${boxes.summary}</h3><table><thead><tr><th style="width:12%">Box</th><th class="num" style="width:18%">Pieces</th><th>Box number</th><th style="width:20%">Status</th></tr></thead><tbody>${boxes.rows.map(
        (b) => html`<tr><td>${b.boxNo}</td><td class="num">${b.pieces}</td><td class="ident">${b.number ?? "—"}</td><td>${b.status}</td></tr>`,
      )}</tbody></table>`
    : ""
}
${
  labels.length
    ? html`<h3>Labels printed</h3><table><thead><tr><th>Label</th><th class="num" style="width:10%">Copies</th><th style="width:22%">Status</th><th style="width:30%">Printed by</th></tr></thead><tbody>${labels.map(
        (l) => html`<tr><td>${l.kind}${l.reprint ? html`<span class="small">${l.reprint}</span>` : ""}</td><td class="num">${String(l.copies)}</td><td>${l.status}</td><td>${sig(l.by, null, l.at, false)}</td></tr>`,
      )}</tbody></table>`
    : ""
}
${nothing ? (p.available ? none("Nothing recorded yet.") : notCaptured("Packaging and label reconciliation")) : ""}
</section>`;
}

/* ------------------------------------------------------------------ 5 yield */

function part5(d: BmrData): SafeHtml {
  const y = d.outputYield;
  return html`<section data-section="output_yield">
<h2><span class="no">5</span>Yield</h2>
<table class="keep"><tbody>
  <tr>
    <td style="width:34%"><span class="lbl">Theoretical Yield:</span><span class="val">${y.theoreticalText}</span></td>
    <td style="width:33%"><span class="lbl">Actual Yield:</span>${y.actualText ? html`<span class="val">${y.actualText}</span>` : html`<span class="none">Not made yet</span>`}${y.detailText ? html`<span class="small">${y.detailText.replace(/^\((.*)\)$/, "$1")}</span>` : ""}</td>
    <td><span class="lbl">Expiration Date:</span>${y.expiryText ? html`<span class="val">${y.expiryText}</span>` : ""}${y.outputLot ? html`<span class="small">Lot ${y.outputLot}</span>` : ""}</td>
  </tr>
  ${y.yieldRecord.available && y.yieldRecord.rows.length ? html`<tr><td colspan="3"><span class="lbl">Yield record</span>${y.yieldRecord.rows.map((r) => html`<span style="display:inline-block;margin-right:5mm">${r.label}: <b>${r.value}</b></span>`)}</td></tr>` : ""}
</tbody></table>
${
  y.outputs.available && y.outputs.rows.length
    ? html`<h3>What was made</h3><table class="keep"><thead><tr><th>Kind</th><th>Item</th><th class="num">Quantity</th><th>Lot</th><th>Put in</th></tr></thead><tbody>${y.outputs.rows.map(
        (o) => html`<tr><td>${o.kind}</td><td>${o.item}</td><td class="num">${o.qty}</td><td>${o.lot ?? "—"}</td><td>${o.location ?? "—"}</td></tr>`,
      )}</tbody></table>`
    : ""
}
</section>`;
}

/* ------------------------------------------------------------------ 6 problems and changes */

function part6(def: TemplateDefinition, d: BmrData): SafeHtml {
  const v = d.deviations;
  const showDev = !!on(def, "deviations");
  const changes = d.materialChanges ?? [];
  const active = d.amendments.filter((a) => !a.superseded);
  const empty = !changes.length && !d.exceptions.length && !(showDev && v.rows.length) && !d.amendments.length && !d.reopens.length;
  return html`<section data-section="deviations">
<h2><span class="no">6</span>Problems and changes</h2>
${changes.length ? html`<h3>Other lot or ingredient used</h3><ul class="plain">${changes.map((c) => html`<li>${c}</li>`)}</ul>` : ""}
${d.exceptions.length ? html`<h3>Weighing and step exceptions</h3><ul class="plain">${d.exceptions.map((e) => html`<li>${e}</li>`)}</ul>` : ""}
${
  showDev && v.available && v.rows.length
    ? html`<h3>Problem reports (deviations)</h3><table><thead><tr><th style="width:14%">Number</th><th style="width:13%">Kind, severity</th><th>What happened</th><th style="width:15%">Status</th><th style="width:16%">Raised by</th><th style="width:16%">Closed by</th></tr></thead><tbody>${v.rows.map(
        (r) => html`<tr><td class="ident">${r.number}</td><td>${r.kind}, ${r.severity}</td><td>${r.description}</td><td><b>${r.status}</b></td><td>${sig(r.raisedBy, null, r.raisedAt, false)}</td><td>${r.closedBy ? sig(r.closedBy, null, r.closedAt, false) : ""}</td></tr>`,
      )}</tbody></table>`
    : ""
}
${showDev && !v.available ? notCaptured("The deviation register") : ""}
${
  d.amendments.length
    ? html`<h3>Corrections to this record (${active.length} current; nothing is erased)</h3><table><thead><tr><th style="width:7%">No.</th><th style="width:22%">Where</th><th>Was → now</th><th style="width:22%">By</th></tr></thead><tbody>${d.amendments.map(
        (a) => html`<tr><td>A${a.no}${a.reopenNo ? html`<span class="small">reopen ${a.reopenNo}</span>` : ""}</td><td>${a.section}<span class="small">${a.reference}</span></td><td><span class="struck">${a.previous}</span> → <b class="${a.superseded ? "struck" : ""}">${a.corrected}</b><span class="reason">Reason: ${a.reason}${a.superseded ? " · superseded by a later amendment" : ""}</span></td><td>${sig(a.by, null, a.at, false)}</td></tr>`,
      )}</tbody></table>`
    : ""
}
${d.reopens.length ? html`<h3>Record reopened</h3><ul class="plain">${d.reopens.map((r) => html`<li>Reopen ${r.reopenNo}: ${r.reason} (what may change: ${r.scope}) · asked by ${r.requestedBy}${r.approvals ? ` · approved: ${r.approvals}` : ""} · ${r.at}</li>`)}</ul>` : ""}
${empty ? none("No problems, corrections or changes recorded.") : ""}
</section>`;
}

/** Part 6 fits in a few lines: no problem reports, corrections or reopens, and at most three changes or exceptions. */
function part6IsShort(d: BmrData): boolean {
  return !d.deviations.rows.length && !d.amendments.length && !d.reopens.length && (d.materialChanges?.length ?? 0) + d.exceptions.length <= 3;
}

/* ------------------------------------------------------------------ 7 QA decision */

function part7(def: TemplateDefinition, d: BmrData): SafeHtml {
  const q = d.qc;
  const disp = d.disposition;
  const hw = on(def, "disposition_signatures")?.handwritten_lines !== false && d.controlledRecord === "paper";
  const approved = disp?.decision === "release";
  const disapproved = disp?.decision === "reject";
  return html`<section data-section="qc">
<h2><span class="no">7</span>QA decision and sign-offs</h2>
<h3>${label(def, "test_results", "Test Results:")}</h3>
${
  q.tests.length
    ? html`<table class="keep"><colgroup><col style="width:22%"/><col style="width:30%"/><col style="width:15%"/><col style="width:10%"/><col style="width:23%"/></colgroup><thead><tr><th>Test</th><th>Specification</th><th>Result</th><th>Pass?</th><th>Tested by</th></tr></thead><tbody>${q.tests.map(
        (t) => html`<tr><td>${t.name}</td><td>${t.spec}</td><td class="${t.result.length <= 12 ? "word" : ""}"><b>${t.result}</b></td><td class="word">${t.passed ? html`<span class="ok">✓ Pass</span>` : html`<span class="flag">✗ Fail</span>`}</td><td>${sig(t.testedBy, null, t.at, false)}</td></tr>`,
      )}</tbody></table>`
    : none("No results recorded yet.")
}
${
  q.inspections.available && q.inspections.rows.length
    ? html`<p class="muted">Inspections: ${q.inspections.rows.map((i) => `${i.number}${i.plan ? ` (${i.plan})` : ""}, ${i.status}${i.sampledBy ? `, sampled by ${i.sampledBy}` : ""}${i.reviewedBy ? `, reviewed by ${i.reviewedBy}` : ""}${i.at ? `, ${i.at}` : ""}`).join("; ")}</p>`
    : ""
}
<table class="keep" style="margin-top:2mm"><tbody><tr>
  <td style="width:34%"><span class="lbl">${label(def, "test_date", "Test Date:")}</span>${q.testDateText ?? ""}</td>
  <td style="width:33%"><span class="lbl">${label(def, "qc_conducted", "Conducted:")}</span>${q.conductedBy ?? ""}</td>
  <td><span class="lbl">${label(def, "qc_checked", "Checked By:")}</span>${q.checkedBy ?? ""}</td>
</tr></tbody></table>
<table class="keep" data-section="disposition_signatures" style="margin-top:4mm"><tbody>
  <tr><td colspan="2">
    <span class="lbl">${label(def, "final_disposition", "Final Disposition:")}</span>
    <span style="display:inline-block;margin:1mm 14mm 0 0"><span class="box">${approved ? "✓" : ""}</span><b>Approved</b></span>
    <span style="display:inline-block"><span class="box">${disapproved ? "✓" : ""}</span><b>Disapproved</b></span>
    ${disp && disp.decision === "other" ? html`<span style="display:block;margin-top:1mm"><b>${disp.label}</b></span>` : ""}
    ${disp?.reason ? html`<span class="small" style="margin-top:1mm">Reason: ${disp.reason}</span>` : ""}
    ${disp?.recordReviewed ? html`<span class="small">The batch record was reviewed before the decision.</span>` : ""}
    ${disp?.testerReleased ? html`<span class="small"><b>Tested and released by the same person</b> (allowed by the company settings).</span>` : ""}
    ${disp?.overrideReason ? html`<span class="small" data-field="override_reason"><b>Released by a person who worked on this batch (owner override). Reason: ${disp.overrideReason}</b></span>` : ""}
    ${!disp ? html`<span class="small">No QA decision yet.</span>` : ""}
  </td></tr>
  <tr>
    <td style="width:62%"><span class="lbl">${label(def, "qa_signature", "Name and Signature of QA:")}</span>${disp ? html`${sig(disp.decidedBy, disp.decidedByRole ?? "QA", null, false)}<span class="small">Electronically recorded; an attestation, not a validated electronic signature.</span>` : ""}${hw ? html`<span class="sig-line"></span>` : ""}</td>
    <td><span class="lbl">${label(def, "qa_date", "Date:")}</span>${disp ? html`<b>${disp.decidedAt}</b>` : ""}</td>
  </tr>
  ${
    hw
      ? html`<tr><td colspan="2" style="padding:0"><table><tbody><tr>
    <td style="width:38%"><span class="lbl">Production (conducted by): name, signature</span><span class="sig-line"></span></td>
    <td style="width:38%"><span class="lbl">QA reviewer: name, signature</span><span class="sig-line"></span></td>
    <td><span class="lbl">Date and time</span><span class="sig-line"></span></td>
  </tr></tbody></table></td></tr>`
      : ""
  }
</tbody></table>
${on(def, "remarks") ? html`<table class="keep" data-section="remarks" style="margin-top:3mm"><tbody><tr><td style="height:16mm"><span class="lbl">${label(def, "remarks", "Remarks:")}</span>${d.remarks ?? ""}</td></tr></tbody></table>` : ""}
</section>`;
}

/* ------------------------------------------------------------------ appendix */

function attachments(d: BmrData): SafeHtml {
  return html`<section data-section="attachments">
<h2>Appendix A · Paper record pages</h2>
${
  d.attachments.length === 0
    ? none("No paper pages for this batch; all steps were recorded electronically.")
    : html`<table><thead><tr><th>Reference</th><th>Step</th><th>Status</th><th>File (sha256)</th><th>Typed in by</th><th>Reviewed by</th></tr></thead><tbody>${d.attachments.map(
        (a) => html`<tr><td class="ident">${a.reference}</td><td>${a.stepLabel}</td><td>${a.status.replace(/_/g, " ")}</td><td>${a.fileName ?? "—"}${a.sha8 ? html` <span class="ident">${a.sha8}</span>` : ""}</td><td>${a.transcribedBy ?? ""}</td><td>${sig(a.reviewedBy, null, a.reviewedAt, false)}</td></tr>`,
      )}</tbody></table>`
}
</section>`;
}

function auditAppendix(d: BmrData): SafeHtml {
  return html`<section data-section="audit_appendix">
<h2>Appendix B · Audit trail</h2>
<table><colgroup><col style="width:19%"/><col style="width:19%"/><col style="width:62%"/></colgroup>
  <thead><tr><th>When</th><th>Who</th><th>What happened</th></tr></thead>
  <tbody>${d.audit.length ? d.audit.map((a) => html`<tr><td class="num" style="text-align:left">${a.at}</td><td>${a.actor}</td><td>${a.event}${a.detail ? html`<span class="small">${a.detail}</span>` : ""}</td></tr>`) : html`<tr><td colspan="3" class="none">No events.</td></tr>`}</tbody>
</table>
${
  d.documents.length
    ? html`<h3>Earlier documents of this batch</h3><table><thead><tr><th>Document</th><th>Generation</th><th>Status</th><th>By</th></tr></thead><tbody>${d.documents.map(
        (x) => html`<tr><td class="ident">${x.number}</td><td>${x.label}</td><td>${x.status}</td><td>${sig(x.by, null, x.at, false)}</td></tr>`,
      )}</tbody></table>`
    : ""
}
</section>`;
}

function closing(def: TemplateDefinition, d: BmrData, meta: DocumentMeta): SafeHtml {
  const payload = `BC:DOC:${meta.documentNumber}`;
  return html`<div class="closing">
  <div class="qr">${def.footer?.show_qr !== false ? html`<div data-payload="${payload}">${qrSvg(payload, `QR code ${payload}`)}</div>` : ""}</div>
  <div>
    <div>Scan ${payload} to open this record (sign-in required). Status ${d.batch.statusLabel} · Site ${d.batch.siteCode} · Generated ${meta.generatedAt} by ${meta.generatedByName}.</div>
    <div>Recipe ${d.batch.formulaLabel}${d.batch.routingLabel ? `, steps ${d.batch.routingLabel}` : ""}${d.batch.inspectionPlanLabel ? `, inspection plan ${d.batch.inspectionPlanLabel}` : ""}, fixed ${d.batch.snapshotTakenText}; planned by ${d.batch.createdBy}.</div>
    <div>Controlled record: ${d.controlledRecord === "paper" ? "the signed paper copy (electronic sign-offs are attestations pending QA validation)" : "this electronic record"}. ${def.footer?.uncontrolled_copy_text ?? ""}</div>
    <div>${d.notice}</div>
    <div class="ident" style="font-size:7.5pt">Template ${meta.templateCode} v${meta.templateVersionNo}${def.footer?.show_hash !== false ? ` · checksum ${meta.definitionChecksum.slice(0, 8)} · content ${bmrContentHash(d)}` : ""} · record as of ${d.batch.revisionText ?? meta.sourceRevisionAt}</div>
    ${meta.reprintNo > 0 ? html`<div><b>REPRINT ${meta.reprintNo} of ${meta.reprintOfNumber ?? meta.documentNumber}</b></div>` : ""}
  </div>
</div>`;
}

/* ------------------------------------------------------------------ renderer */

/** Default v2 definition: same section ids as v1 (C, E, H, J required); v2 prints them in its seven parts. */
export function defaultBmrDefinitionV2(): TemplateDefinition {
  return {
    schema_version: "document_template/v1",
    renderer: { id: "bmr", version: 2 },
    dataset: "bmr/v1",
    page: { size: "A4", orientation: "portrait", margin_mm: { top: 20, right: 14, bottom: 16, left: 14 } },
    header: { show_logo: true, title: "BATCH MANUFACTURING RECORD", identity_fields: ["batch_number", "product_name", "formula_code_rev"] },
    footer: { show_qr: true, uncontrolled_copy_text: "Printed copies are uncontrolled unless signed.", show_hash: true },
    sections: [
      { id: "header_block", enabled: true },
      { id: "batch_summary", enabled: true },
      { id: "materials", enabled: true, handwritten_lines: true },
      { id: "process_steps", enabled: true, show_instruction_text: true },
      { id: "line_clearance", enabled: true },
      { id: "process_parameters", enabled: true },
      { id: "equipment", enabled: true },
      { id: "checklist", enabled: true },
      { id: "packaging_reconciliation", enabled: true },
      { id: "output_yield", enabled: true },
      { id: "deviations", enabled: true },
      { id: "remarks", enabled: true },
      { id: "qc", enabled: true, break_before: "page" },
      { id: "disposition_signatures", enabled: true, handwritten_lines: true },
      { id: "attachments", enabled: true },
      { id: "audit_appendix", enabled: true, break_before: "page" },
    ],
    options: { print_percentages: false, watermarks: "default", totals_from_unrounded: true },
  };
}

export const bmrRendererV2: Renderer = {
  id: "bmr",
  version: 2,
  kinds: ["bmr"],
  datasets: BMR_DATASETS,
  title: "Batch Manufacturing Record (seven parts, A4 portrait)",
  defaultDefinition: () => defaultBmrDefinitionV2(),
  validateDefinition: (def) => bmrDefinitionErrors(def),
  validateData(dataset, data) {
    if (!(BMR_DATASETS as readonly string[]).includes(dataset)) throw new Error(`BMR renderer v2 does not support dataset ${dataset}.`);
    bmrDataSchema.parse(data);
  },
  render(def, input: FrozenDataset) {
    const d = bmrDataSchema.parse(input.data);
    const meta = input.meta;
    const watermark = def.options?.watermarks === "none" ? null : meta.watermark;
    // Only part 7 may start a new page (2026-11-06); a short part 6 goes with it as one unsplit block.
    const qaBreak = on(def, "qc")?.break_before === "page" || on(def, "disposition_signatures")?.break_before === "page";
    const qaOn = !!on(def, "qc") || !!on(def, "disposition_signatures");
    const sixWithSeven = qaOn && qaBreak && !!on(def, "deviations") && part6IsShort(d);
    const pageBreak = html`<div class="page-break"></div>`;
    const parts: SafeHtml[] = [
      part1(def, d, meta),
      on(def, "materials") ? part2(def, on(def, "materials")!, d) : html``,
      on(def, "process_steps") || on(def, "checklist") ? part3(def, d) : html``,
      on(def, "packaging_reconciliation") ? part4(d) : html``,
      on(def, "output_yield") ? part5(d) : html``,
      sixWithSeven
        ? html`<div class="review keep">${part6(def, d)}${part7(def, d)}</div>`
        : html`${on(def, "deviations") ? part6(def, d) : ""}${qaOn ? html`${qaBreak ? pageBreak : ""}${part7(def, d)}` : ""}`,
      on(def, "attachments") ? attachments(d) : html``,
      on(def, "audit_appendix") ? auditAppendix(d) : html``,
    ];
    const body = html`<div class="bmr2 bmr2-screen" data-testid="document" data-renderer="bmr-v2" data-document-number="${meta.documentNumber}" aria-label="Batch Manufacturing Record ${d.batch.number}">
  ${watermark ? html`<div class="bmr2-wm" aria-hidden="true">${watermark}</div>` : ""}
  <div class="bmr2-content">${parts}${closing(def, d, meta)}</div>
</div>`;
    return { css: pageCss(def, meta, d, watermark), body, pageCount: null };
  },
};

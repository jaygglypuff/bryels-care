import { z } from "zod";
import { html } from "../html";
import type { TemplateDefinition } from "../schemas";
import { assertNoLotPayload, batchIdentitySchema, identityBlock, sheetCss, sheetFoot, sheetHead, watermarkOf } from "./batch-sheet-shared";
import type { FrozenDataset, Renderer } from "./types";

/**
 * Dispensing sheet v1 (US-3-08, FR-documents-09, docs/process-maps.md W05-05; reports-and-templates
 * dispensing sheet): batch identity, then per ingredient the target quantity, tolerance (± and the
 * absolute range), the expected (staged or reserved) lots with location and expiry, the scales
 * that may be used, and blank columns for actual weight, scale id, operator and checker initials.
 * It never prints formula percentages (A-PM-16) and never a lot barcode: the operator must scan
 * the physical container at the scale.
 */

export const DISPENSING_SHEET_DATASETS = ["dispensing_sheet/batch/v1"] as const;

const t = (max: number) => z.string().max(max);
export const dispensingSheetDataSchema = z.object({
  batch: batchIdentitySchema,
  lines: z
    .array(
      z.object({
        lineNo: z.number().int(),
        materialCode: t(40),
        materialName: t(120),
        inciName: t(200).nullable(),
        phase: t(20).nullable(),
        targetText: t(40),
        toleranceText: t(40),
        rangeText: t(60),
        requiresChecker: z.boolean(),
        expectedLots: z.array(z.object({ lotNumber: t(64), where: t(64), qtyText: t(40), expiresText: t(40), kind: z.enum(["staged", "reserved"]) })).max(20),
      }),
    )
    .max(80),
  totalText: t(40),
  scales: z.array(z.object({ code: t(64), name: t(120), statusText: t(120) })).max(30),
  notes: z.array(t(300)).max(10),
});
export type DispensingSheetData = z.infer<typeof dispensingSheetDataSchema>;

export const dispensingSheetRendererV1: Renderer = {
  id: "dispensing_sheet",
  version: 1,
  kinds: ["dispensing_sheet"],
  datasets: DISPENSING_SHEET_DATASETS,
  title: "Dispensing sheet (A4)",
  defaultDefinition(): TemplateDefinition {
    return {
      schema_version: "document_template/v1",
      renderer: { id: "dispensing_sheet", version: 1 },
      dataset: "dispensing_sheet/batch/v1",
      page: { size: "A4", orientation: "landscape", margin_mm: { top: 18, right: 12, bottom: 16, left: 12 } },
      header: { show_logo: false, title: "DISPENSING SHEET", identity_fields: [] },
      footer: { show_qr: true, uncontrolled_copy_text: "Weigh only staged, released lots. Scan the container at the scale; this sheet carries no lot barcodes.", show_hash: true },
      sections: [
        { id: "identity", enabled: true },
        { id: "ingredients", enabled: true, handwritten_lines: true },
        { id: "scales", enabled: true },
        { id: "notes", enabled: true },
        { id: "signatures", enabled: true },
      ],
      options: { watermarks: "default", print_percentages: false },
    };
  },
  validateData(dataset, data) {
    if (!(DISPENSING_SHEET_DATASETS as readonly string[]).includes(dataset)) throw new Error(`Dispensing sheet renderer v1 does not support dataset ${dataset}.`);
    dispensingSheetDataSchema.parse(data);
    assertNoLotPayload(data);
  },
  render(def, input: FrozenDataset) {
    const d = dispensingSheetDataSchema.parse(input.data);
    const m = input.meta;
    const on = new Set(def.sections.filter((s) => s.enabled).map((s) => s.id));
    const handwritten = def.sections.find((s) => s.id === "ingredients")?.handwritten_lines !== false;
    const wm = watermarkOf(def, m);
    const body = html`<div class="doc doc-screen" data-testid="document">
  ${sheetHead(def, m, "DISPENSING SHEET", wm)}
  <main>
    ${on.has("identity") ? identityBlock(d.batch) : ""}
    ${on.has("ingredients")
      ? html`<h2 class="sec">Ingredients</h2>
    <table class="grid" data-testid="ingredients">
      <thead><tr><th>#</th><th>Ingredient</th><th>Phase</th><th>Target</th><th>Tolerance</th><th>Accept range</th><th>Expected lot · location · expiry</th>${handwritten ? html`<th>Actual</th><th>Scale</th><th>Operator</th><th>Checker</th>` : ""}</tr></thead>
      <tbody>${d.lines.map(
        (l) => html`<tr>
        <td class="num">${l.lineNo}</td>
        <td><strong>${l.materialName}</strong><br />${l.materialCode}${l.inciName ? html`<br /><em>${l.inciName}</em>` : ""}</td>
        <td>${l.phase ?? "—"}</td>
        <td class="num">${l.targetText}</td>
        <td class="num">${l.toleranceText}</td>
        <td class="num">${l.rangeText}</td>
        <td>${l.expectedLots.length ? l.expectedLots.map((x) => html`<div>${x.lotNumber} · ${x.where} · ${x.qtyText} · exp ${x.expiresText}${x.kind === "reserved" ? " (reserved, not staged)" : ""}</div>`) : html`<div>No lot staged or reserved</div>`}</td>
        ${handwritten ? html`<td class="blank"></td><td class="blank"></td><td class="blank"></td><td class="blank">${l.requiresChecker ? "required" : ""}</td>` : ""}
      </tr>`,
      )}
      <tr><td></td><td><strong>Total (theoretical)</strong></td><td></td><td class="num"><strong>${d.totalText}</strong></td><td colspan="${handwritten ? 7 : 3}"></td></tr>
      </tbody>
    </table>`
      : ""}
    ${on.has("scales")
      ? html`<h2 class="sec">Scales</h2>
    ${d.scales.length ? html`<table class="grid"><thead><tr><th>Scale</th><th>Name</th><th>Status at print</th></tr></thead><tbody>${d.scales.map((s) => html`<tr><td>${s.code}</td><td>${s.name}</td><td>${s.statusText}</td></tr>`)}</tbody></table>` : html`<p class="note">No scale is registered at this site.</p>`}`
      : ""}
    ${on.has("notes") && d.notes.length ? html`<h2 class="sec">Notes</h2>${d.notes.map((n) => html`<p class="note">${n}</p>`)}` : ""}
    ${on.has("signatures") ? html`<div class="sign"><div>Dispensed by (operator)</div><div>Checked by (checker)</div><div>Date / time</div></div>` : ""}
  </main>
  ${sheetFoot(def, m)}
</div>`;
    return { css: sheetCss(def, m, d.batch), body, pageCount: null };
  },
};

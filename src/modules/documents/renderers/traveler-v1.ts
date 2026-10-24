import { z } from "zod";
import { html } from "../html";
import type { TemplateDefinition } from "../schemas";
import { assertNoLotPayload, batchIdentitySchema, identityBlock, sheetCss, sheetFoot, sheetHead, watermarkOf } from "./batch-sheet-shared";
import type { FrozenDataset, Renderer } from "./types";

/**
 * Batch traveler v1 (US-3-08, FR-documents-09): the sheet that travels with the batch from
 * staging to packaging. Batch identity, the routing steps from the frozen snapshot with check
 * boxes, who conducted / checked and when, the staged materials summary and the staging location.
 * The BC:DOC QR opens the record; the traveler is a companion of the BMR, not a replacement.
 */

export const TRAVELER_DATASETS = ["traveler/batch/v1"] as const;

const t = (max: number) => z.string().max(max);
export const travelerDataSchema = z.object({
  batch: batchIdentitySchema,
  steps: z
    .array(
      z.object({
        stepNo: z.number().int(),
        name: t(120),
        kindWord: t(40),
        area: t(40).nullable(),
        requiresChecker: z.boolean(),
        parametersText: t(400).nullable(),
        doneText: t(120).nullable(),
      }),
    )
    .max(60),
  materials: z.array(z.object({ materialName: t(120), materialCode: t(40), targetText: t(40), stagedText: t(40), lotsText: t(300) })).max(80),
  stagingText: t(120).nullable(),
});
export type TravelerData = z.infer<typeof travelerDataSchema>;

export const travelerRendererV1: Renderer = {
  id: "traveler",
  version: 1,
  kinds: ["traveler"],
  datasets: TRAVELER_DATASETS,
  title: "Batch traveler (A4)",
  defaultDefinition(): TemplateDefinition {
    return {
      schema_version: "document_template/v1",
      renderer: { id: "traveler", version: 1 },
      dataset: "traveler/batch/v1",
      page: { size: "A4", orientation: "portrait", margin_mm: { top: 18, right: 14, bottom: 16, left: 14 } },
      header: { show_logo: false, title: "BATCH TRAVELER", identity_fields: [] },
      footer: { show_qr: true, uncontrolled_copy_text: "Travels with the batch. The electronic batch record is the controlled record.", show_hash: true },
      sections: [
        { id: "identity", enabled: true },
        { id: "steps", enabled: true, handwritten_lines: true },
        { id: "materials", enabled: true },
        { id: "signatures", enabled: true },
      ],
      options: { watermarks: "default" },
    };
  },
  validateData(dataset, data) {
    if (!(TRAVELER_DATASETS as readonly string[]).includes(dataset)) throw new Error(`Traveler renderer v1 does not support dataset ${dataset}.`);
    travelerDataSchema.parse(data);
    assertNoLotPayload(data);
  },
  render(def, input: FrozenDataset) {
    const d = travelerDataSchema.parse(input.data);
    const m = input.meta;
    const on = new Set(def.sections.filter((s) => s.enabled).map((s) => s.id));
    const handwritten = def.sections.find((s) => s.id === "steps")?.handwritten_lines !== false;
    const wm = watermarkOf(def, m);
    const body = html`<div class="doc doc-screen" data-testid="document">
  ${sheetHead(def, m, "BATCH TRAVELER", wm)}
  <main>
    ${on.has("identity") ? identityBlock(d.batch) : ""}
    ${d.stagingText ? html`<p class="note"><strong>Staged at:</strong> ${d.stagingText}</p>` : ""}
    ${on.has("steps")
      ? html`<h2 class="sec">Route</h2>
    <table class="grid" data-testid="steps">
      <thead><tr><th>Step</th><th>Activity</th><th>Area</th><th>Parameters</th><th>Recorded</th>${handwritten ? html`<th>Done (initials)</th><th>Checked</th><th>Time</th>` : ""}</tr></thead>
      <tbody>${d.steps.map(
        (s) => html`<tr>
        <td class="num">${s.stepNo}</td>
        <td><strong>${s.name}</strong><br />${s.kindWord}</td>
        <td>${s.area ?? "—"}</td>
        <td>${s.parametersText ?? "—"}</td>
        <td>${s.doneText ?? "—"}</td>
        ${handwritten ? html`<td class="blank"></td><td class="blank">${s.requiresChecker ? "required" : ""}</td><td class="blank"></td>` : ""}
      </tr>`,
      )}</tbody>
    </table>`
      : ""}
    ${on.has("materials")
      ? html`<h2 class="sec">Materials</h2>
    <table class="grid" data-testid="materials"><thead><tr><th>Ingredient</th><th>Target</th><th>Staged</th><th>Lots</th></tr></thead>
      <tbody>${d.materials.map((x) => html`<tr><td><strong>${x.materialName}</strong><br />${x.materialCode}</td><td class="num">${x.targetText}</td><td class="num">${x.stagedText}</td><td>${x.lotsText}</td></tr>`)}</tbody>
    </table>`
      : ""}
    ${on.has("signatures") ? html`<div class="sign"><div>Production supervisor</div><div>QA</div><div>Date</div></div>` : ""}
  </main>
  ${sheetFoot(def, m)}
</div>`;
    return { css: sheetCss(def, m, d.batch), body, pageCount: null };
  },
};

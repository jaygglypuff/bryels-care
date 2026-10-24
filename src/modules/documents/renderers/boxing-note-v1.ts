import { z } from "zod";
import { html } from "../html";
import type { TemplateDefinition } from "../schemas";
import { assertFulfilmentSafe, fulfilmentCss, fulfilmentFoot, fulfilmentHead, idGrid, watermarkOf } from "./fulfilment-shared";
import type { FrozenDataset, Renderer } from "./types";

/**
 * Boxing note / packing list v1 (US-4-07, US-4-08, US-4-11; docs/reports-and-templates.md §5).
 * One template kind (`boxing_note`) with three variants: `batch` (boxing at the end of a batch),
 * `order` (packing list of a shipment, verified against the order) and `repack` (customer carton
 * count, lineage printed). A regeneration after a repack supersedes the earlier version and prints
 * "replaces DOC-…". Never prices, never scannable box codes.
 */
export const BOXING_NOTE_DATASETS = ["boxing_note/v1"] as const;

const t = (max: number) => z.string().max(max);
const tn = (max: number) => z.string().max(max).nullable();

export const boxingNoteDataSchema = z.object({
  variant: z.enum(["batch", "order", "repack"]),
  pack: z.object({
    packNumber: t(40),
    sourceText: t(160),
    customerText: tn(200),
    productText: t(200),
    lotText: t(300),
    packedOn: t(40),
    packedBy: t(120),
    checkedBy: tn(120),
    checkedAt: tn(40),
    configText: t(240),
    defaultConfigUsed: z.boolean(),
    unitsPerBox: z.number().int(),
    shippingMarks: tn(300),
    statusText: t(40),
  }),
  boxes: z
    .array(
      z.object({
        boxNo: z.number().int(),
        boxNumber: t(64),
        kind: t(20),
        sku: t(40),
        lotNumber: t(64),
        expiresText: t(40),
        qtyText: t(40),
        partial: z.boolean(),
        statusText: t(60),
        locationText: tn(80),
        lineageText: tn(300),
      }),
    )
    .max(2000),
  totals: z.object({ boxes: z.number().int(), unitsText: t(60), expectedText: tn(60), differenceText: tn(60), bySkuLot: z.array(z.object({ sku: t(40), lotNumber: t(64), boxes: z.number().int(), unitsText: t(60) })).max(200) }),
  lineage: z.array(z.object({ fromBox: t(64), toBox: t(64), lotNumber: t(64), qtyText: t(40), atText: t(40) })).max(2000),
  replaces: tn(40),
});
export type BoxingNoteData = z.infer<typeof boxingNoteDataSchema>;

const TITLE: Record<BoxingNoteData["variant"], string> = { batch: "BOXING NOTE", order: "PACKING LIST", repack: "PACKING LIST · REPACK" };

export const boxingNoteRendererV1: Renderer = {
  id: "boxing_note",
  version: 1,
  kinds: ["boxing_note"],
  datasets: BOXING_NOTE_DATASETS,
  title: "Boxing note / packing list (A4)",
  defaultDefinition(): TemplateDefinition {
    return {
      schema_version: "document_template/v1",
      renderer: { id: "boxing_note", version: 1 },
      dataset: "boxing_note/v1",
      page: { size: "A4", orientation: "portrait", margin_mm: { top: 18, right: 14, bottom: 16, left: 14 } },
      footer: { show_qr: true, uncontrolled_copy_text: "Printed copy. The electronic pack record is the controlled record.", show_hash: true },
      sections: [
        { id: "identity", enabled: true },
        { id: "boxes", enabled: true },
        { id: "totals", enabled: true },
        { id: "lineage", enabled: true },
        { id: "signatures", enabled: true, handwritten_lines: true },
      ],
      options: { watermarks: "default" },
    };
  },
  validateData(dataset, data) {
    if (!(BOXING_NOTE_DATASETS as readonly string[]).includes(dataset)) throw new Error(`Boxing note renderer v1 does not support dataset ${dataset}.`);
    boxingNoteDataSchema.parse(data);
    assertFulfilmentSafe(data);
  },
  render(def, input: FrozenDataset) {
    const d = boxingNoteDataSchema.parse(input.data);
    const m = input.meta;
    const on = new Set(def.sections.filter((s) => s.enabled).map((s) => s.id));
    const wm = watermarkOf(def, m);
    const p = d.pack;
    const title = TITLE[d.variant];
    const body = html`<div class="doc doc-screen" data-testid="document">
  ${fulfilmentHead(def, m, title, wm)}
  <main>
    ${on.has("identity")
      ? idGrid([
          ["Pack", p.packNumber],
          [d.variant === "order" ? "Order / shipment" : d.variant === "batch" ? "Batch" : "Source", p.sourceText],
          ["Customer", p.customerText],
          ["SKU", p.productText],
          ["Lot(s)", p.lotText],
          ["Packed", `${p.packedOn} · ${p.packedBy}`],
          ["Checked", p.checkedBy ? `${p.checkedAt ?? ""} · ${p.checkedBy}` : "Not yet verified"],
          ["Configuration", `${p.configText}${p.defaultConfigUsed ? " (default config used)" : ""}`],
        ])
      : ""}
    ${d.replaces ? html`<p class="note"><strong>Replaces ${d.replaces}</strong> (regenerated after a repack; the earlier version is superseded).</p>` : ""}
    ${p.shippingMarks ? html`<p class="note" data-testid="marks"><strong>Shipping marks:</strong> ${p.shippingMarks}</p>` : ""}
    ${on.has("boxes")
      ? html`<h2 class="sec">Boxes</h2>
    <table class="grid" data-testid="boxes">
      <thead><tr><th>#</th><th>Box</th><th>SKU</th><th>Lot</th><th>Expiry</th><th>Qty</th><th>Status</th><th>Location</th>${on.has("lineage") ? html`<th>Lineage</th>` : ""}</tr></thead>
      <tbody>${d.boxes.map(
        (b) => html`<tr>
        <td class="num">${b.boxNo}</td>
        <td><strong>${b.boxNumber}</strong>${b.kind !== "box" ? html`<br />${b.kind}` : ""}</td>
        <td>${b.sku}</td>
        <td>${b.lotNumber}</td>
        <td>${b.expiresText}</td>
        <td class="num">${b.qtyText}${b.partial ? html` <span class="badge">PARTIAL</span>` : ""}</td>
        <td>${b.statusText}</td>
        <td>${b.locationText ?? "—"}</td>
        ${on.has("lineage") ? html`<td>${b.lineageText ?? "—"}</td>` : ""}
      </tr>`,
      )}</tbody>
    </table>`
      : ""}
    ${on.has("totals")
      ? html`<div class="keep" data-testid="totals"><h2 class="sec">Totals</h2>
    <table class="grid"><thead><tr><th>SKU</th><th>Lot</th><th>Boxes</th><th>Units</th></tr></thead>
      <tbody>${d.totals.bySkuLot.map((r) => html`<tr><td>${r.sku}</td><td>${r.lotNumber}</td><td class="num">${r.boxes}</td><td class="num">${r.unitsText}</td></tr>`)}
      <tr class="group"><td colspan="2">Total</td><td class="num">${d.totals.boxes}</td><td class="num">${d.totals.unitsText}</td></tr></tbody>
    </table>
    ${d.totals.expectedText ? html`<p class="note">Expected (lot output): <strong>${d.totals.expectedText}</strong> · difference: <strong>${d.totals.differenceText ?? "0"}</strong></p>` : ""}
    <p class="note">Units per box: ${p.unitsPerBox}</p></div>`
      : ""}
    ${on.has("lineage") && d.lineage.length
      ? html`<h2 class="sec">Repack lineage</h2>
    <table class="grid" data-testid="lineage"><thead><tr><th>From box</th><th>To box</th><th>Lot</th><th>Qty</th><th>When</th></tr></thead>
      <tbody>${d.lineage.map((l) => html`<tr><td>${l.fromBox}</td><td>${l.toBox}</td><td>${l.lotNumber}</td><td class="num">${l.qtyText}</td><td>${l.atText}</td></tr>`)}</tbody>
    </table>`
      : ""}
    ${on.has("signatures") ? html`<div class="sign keep"><div>Packed by: ${p.packedBy}</div><div>Checked by: ${p.checkedBy ?? ""}</div><div>Date</div></div>` : ""}
  </main>
  ${fulfilmentFoot(def, m, "pack state")}
</div>`;
    return { css: fulfilmentCss(def, m, `${p.packNumber} · ${title}`), body, pageCount: null };
  },
};

import { z } from "zod";
import { html } from "../html";
import type { TemplateDefinition } from "../schemas";
import { assertFulfilmentSafe, fulfilmentCss, fulfilmentFoot, fulfilmentHead, idGrid, watermarkOf } from "./fulfilment-shared";
import type { FrozenDataset, Renderer } from "./types";

/**
 * Pick list v1 (US-4-10, FR-documents-09; docs/reports-and-templates.md §6). Rows grouped by
 * location in walk order with the FEFO rank among the allocated lots, the box id (or "loose
 * units"), quantity to pick and a blank picked cell. Lines whose lot is no longer usable print
 * `BLOCKED – <status>`. Only the document's own BC:DOC code is printed (A-RPT-15): the picker must
 * scan the physical box or lot label. No address, no prices.
 */
export const PICK_LIST_DATASETS = ["pick_list/v1"] as const;

const t = (max: number) => z.string().max(max);
const tn = (max: number) => z.string().max(max).nullable();

export const pickListDataSchema = z.object({
  pick: z.object({
    pickNumber: t(40),
    orderNumber: t(40),
    shipmentNumber: tn(40),
    customerText: t(200),
    requestedDeliveryText: t(40),
    pickerText: t(120),
    createdText: t(80),
    ruleText: t(200),
  }),
  groups: z
    .array(
      z.object({
        locationCode: t(64),
        locationName: t(120),
        rows: z
          .array(
            z.object({
              sku: t(40),
              productName: t(160),
              lotNumber: t(64),
              expiresText: t(40),
              fefoRank: z.number().int(),
              boxText: t(80),
              qtyText: t(40),
              pickedText: tn(40),
              statusText: t(80),
              blocked: z.boolean(),
            }),
          )
          .max(500),
      }),
    )
    .max(200),
  totals: z.object({ linesText: t(40), unitsText: t(60) }),
  notes: z.array(t(300)).max(10),
});
export type PickListData = z.infer<typeof pickListDataSchema>;

export const pickListRendererV1: Renderer = {
  id: "pick_list",
  version: 1,
  kinds: ["pick_list"],
  datasets: PICK_LIST_DATASETS,
  title: "Pick list (A4)",
  defaultDefinition(): TemplateDefinition {
    return {
      schema_version: "document_template/v1",
      renderer: { id: "pick_list", version: 1 },
      dataset: "pick_list/v1",
      page: { size: "A4", orientation: "portrait", margin_mm: { top: 18, right: 12, bottom: 16, left: 12 } },
      footer: { show_qr: true, uncontrolled_copy_text: "Scan every box or lot label at the shelf; this list is a guide, the scan is the record.", show_hash: true },
      sections: [
        { id: "identity", enabled: true },
        { id: "rows", enabled: true, group_by: "location", handwritten_lines: true },
        { id: "signatures", enabled: true },
      ],
      options: { watermarks: "default" },
    };
  },
  validateData(dataset, data) {
    if (!(PICK_LIST_DATASETS as readonly string[]).includes(dataset)) throw new Error(`Pick list renderer v1 does not support dataset ${dataset}.`);
    pickListDataSchema.parse(data);
    assertFulfilmentSafe(data);
  },
  render(def, input: FrozenDataset) {
    const d = pickListDataSchema.parse(input.data);
    const m = input.meta;
    const on = new Set(def.sections.filter((s) => s.enabled).map((s) => s.id));
    const handwritten = def.sections.find((s) => s.id === "rows")?.handwritten_lines !== false;
    const wm = watermarkOf(def, m);
    const p = d.pick;
    const body = html`<div class="doc doc-screen" data-testid="document">
  ${fulfilmentHead(def, m, "PICK LIST", wm)}
  <main>
    ${on.has("identity")
      ? idGrid([
          ["Pick", p.pickNumber],
          ["Order", p.orderNumber],
          ["Shipment", p.shipmentNumber],
          ["Customer", p.customerText],
          ["Requested delivery", p.requestedDeliveryText],
          ["Picker", p.pickerText],
          ["Created", p.createdText],
          ["Rule", p.ruleText],
        ])
      : ""}
    ${on.has("rows")
      ? html`<table class="grid" data-testid="rows">
      <thead><tr><th>Location</th><th>SKU</th><th>Lot</th><th>Expiry</th><th>FEFO</th><th>Box</th><th>To pick</th><th>Picked</th>${handwritten ? html`<th>Short reason</th>` : ""}</tr></thead>
      <tbody>${d.groups.map(
        (g) => html`<tr class="group"><td colspan="${handwritten ? 9 : 8}">${g.locationCode} · ${g.locationName}</td></tr>
        ${g.rows.map(
          (r) => html`<tr>
          <td>${g.locationCode}</td>
          <td><strong>${r.sku}</strong><br />${r.productName}</td>
          <td>${r.lotNumber}${r.blocked ? html`<br /><span class="badge inv">${r.statusText}</span>` : ""}</td>
          <td>${r.expiresText}</td>
          <td class="num">${r.fefoRank}</td>
          <td>${r.boxText}</td>
          <td class="num">${r.qtyText}</td>
          <td class="${r.pickedText ? "num" : "blank"}">${r.pickedText ?? ""}</td>
          ${handwritten ? html`<td class="blank"></td>` : ""}
        </tr>`,
        )}`,
      )}</tbody>
    </table>
    <p class="note">Lines: ${d.totals.linesText} · units to pick: ${d.totals.unitsText}</p>`
      : ""}
    ${d.notes.map((n) => html`<p class="note">${n}</p>`)}
    ${on.has("signatures") ? html`<div class="sign keep"><div>Picked by</div><div>Checked by</div><div>Date / time</div></div>` : ""}
  </main>
  ${fulfilmentFoot(def, m, "pick state")}
</div>`;
    return { css: fulfilmentCss(def, m, `${p.pickNumber} · ${p.orderNumber}`), body, pageCount: null };
  },
};

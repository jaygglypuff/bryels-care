import { z } from "zod";
import { html } from "../html";
import type { TemplateDefinition } from "../schemas";
import { fulfilmentCss, fulfilmentFoot, fulfilmentHead, idGrid, watermarkOf } from "./fulfilment-shared";
import type { FrozenDataset, Renderer } from "./types";

/**
 * Purchase order v1 (Wave 4 W4A, US-6-02, W04-06; docs/reports-and-templates.md §9 `purchase_order`).
 * The supplier copy: company and ship-to, PO number and dates, supplier, lines with quantities, unit
 * prices and amounts, totals, and the approval block with role titles only (never personal names,
 * docs/permissions-matrix.md §7 "employee names: documents show role titles"). Tax amounts are what
 * procurement entered from the supplier quotation; terms and statutory wording are configuration
 * validated by the accountant (A-RPT-12) and printed only when set.
 */
export const PURCHASE_ORDER_DATASETS = ["purchase_order/v1"] as const;

const t = (max: number) => z.string().max(max);
const tn = (max: number) => z.string().max(max).nullable();

export const purchaseOrderDataSchema = z.object({
  company: z.object({ name: t(200), address: tn(300) }),
  po: z.object({
    poNumber: t(40),
    orderDateText: t(40),
    expectedDateText: tn(40),
    promisedDateText: tn(40),
    paymentTermsText: tn(60),
    currency: t(3),
    supplierReference: tn(80),
    urgentText: tn(300),
    revisionText: tn(80),
  }),
  supplier: z.object({ code: t(40), name: t(200), contact: tn(160), address: tn(400), email: tn(200), phone: tn(60) }),
  shipTo: z.object({ siteName: t(200), warehouse: tn(200) }),
  lines: z
    .array(
      z.object({
        lineNo: z.number().int(),
        materialCode: t(40),
        materialName: t(200),
        supplierPartNumber: tn(80),
        qtyText: t(40),
        unitPriceText: t(40),
        amountText: t(40),
        expectedText: tn(40),
      }),
    )
    .min(1)
    .max(200),
  totals: z.object({ subtotalText: t(40), taxText: t(40), totalText: t(40) }),
  approvals: z.array(z.object({ title: t(120), whenText: t(60) })).max(5),
  preparedByTitle: t(80),
  notes: tn(1000),
  termsText: tn(2000),
});
export type PurchaseOrderData = z.infer<typeof purchaseOrderDataSchema>;

export const purchaseOrderRendererV1: Renderer = {
  id: "purchase_order",
  version: 1,
  kinds: ["purchase_order"],
  datasets: PURCHASE_ORDER_DATASETS,
  title: "Purchase order (A4, supplier copy)",
  defaultDefinition(): TemplateDefinition {
    return {
      schema_version: "document_template/v1",
      renderer: { id: "purchase_order", version: 1 },
      dataset: "purchase_order/v1",
      page: { size: "A4", orientation: "portrait", margin_mm: { top: 16, right: 14, bottom: 16, left: 14 } },
      footer: { show_qr: true, uncontrolled_copy_text: "Please quote the PO number on your delivery receipt and invoice.", show_hash: true },
      sections: [{ id: "lines", enabled: true }],
      options: { watermarks: "default" },
    };
  },
  validateData(dataset, data) {
    if (!(PURCHASE_ORDER_DATASETS as readonly string[]).includes(dataset)) throw new Error(`Purchase order renderer v1 does not support dataset ${dataset}.`);
    purchaseOrderDataSchema.parse(data);
  },
  render(def, input: FrozenDataset) {
    const d = purchaseOrderDataSchema.parse(input.data);
    const m = input.meta;
    const wm = watermarkOf(def, m);
    const body = html`<div class="doc doc-screen" data-testid="document">
  ${fulfilmentHead(def, m, "PURCHASE ORDER", wm, d.company.address)}
  <p class="copy-word"><span class="badge inv">SUPPLIER COPY</span> <strong class="pono">PO ${d.po.poNumber}</strong>${d.po.revisionText ? html` <span class="badge">${d.po.revisionText}</span>` : ""}</p>
  ${d.po.urgentText ? html`<p class="note"><span class="badge inv">URGENT</span> ${d.po.urgentText}</p>` : ""}
  ${idGrid([
    ["Order date", d.po.orderDateText],
    ["Expected delivery", d.po.expectedDateText],
    ["Promised by supplier", d.po.promisedDateText],
    ["Payment terms", d.po.paymentTermsText],
    ["Currency", d.po.currency],
    ["Supplier reference", d.po.supplierReference],
    ["Deliver to", d.shipTo.siteName],
    ["Warehouse", d.shipTo.warehouse],
  ])}
  ${idGrid([
    ["Supplier", `${d.supplier.name} (${d.supplier.code})`],
    ["Address", d.supplier.address],
    ["Contact", d.supplier.contact],
    ["Email · phone", [d.supplier.email, d.supplier.phone].filter(Boolean).join(" · ") || null],
  ])}
  <table class="grid" data-testid="po-lines">
    <thead><tr><th>#</th><th>Material</th><th>Description</th><th>Supplier part</th><th>Quantity</th><th>Unit price</th><th>Amount</th><th>Expected</th></tr></thead>
    <tbody>${d.lines.map(
      (l) => html`<tr>
      <td>${l.lineNo}</td>
      <td><strong>${l.materialCode}</strong></td>
      <td>${l.materialName}</td>
      <td>${l.supplierPartNumber ?? "—"}</td>
      <td class="num">${l.qtyText}</td>
      <td class="num">${l.unitPriceText}</td>
      <td class="num">${l.amountText}</td>
      <td>${l.expectedText ?? "—"}</td>
    </tr>`,
    )}
    <tr class="group"><td colspan="6">Subtotal</td><td class="num">${d.totals.subtotalText}</td><td></td></tr>
    <tr><td colspan="6">Tax (as quoted; rules set by the company's accountant)</td><td class="num">${d.totals.taxText}</td><td></td></tr>
    <tr class="group"><td colspan="6">Total (${d.po.currency})</td><td class="num">${d.totals.totalText}</td><td></td></tr></tbody>
  </table>
  ${d.notes ? html`<p class="note"><strong>Notes:</strong> ${d.notes}</p>` : ""}
  ${d.termsText ? html`<p class="note" data-testid="terms">${d.termsText}</p>` : ""}
  <div class="keep" data-testid="approvals">
    <h2 class="sec">Authorisation</h2>
    <div class="sign"><div>Prepared by: ${d.preparedByTitle}</div>${d.approvals.map((a) => html`<div>Approved: ${a.title}<br />${a.whenText}</div>`)}</div>
  </div>
  ${fulfilmentFoot(def, m, "PO state")}
</div>`;
    const extra = `
.copy-word { margin: 2mm 0; display: flex; gap: 3mm; align-items: center; }
.copy-word .pono { font-size: 11pt; }`;
    return { css: fulfilmentCss(def, m, `PO ${d.po.poNumber}`, extra), body, pageCount: null };
  },
};

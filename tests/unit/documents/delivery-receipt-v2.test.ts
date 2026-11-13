import { describe, expect, it } from "vitest";
import { type DeliveryReceiptData, deliveryReceiptRendererV1 } from "@/modules/documents/renderers/delivery-receipt-v1";
import { deliveryReceiptRendererV2 } from "@/modules/documents/renderers/delivery-receipt-v2";
import { checkDefinition, findRenderer, renderFrozen, renderersForKind } from "@/modules/documents/renderers/registry";
import type { DocumentMeta } from "@/modules/documents/renderers/types";
import { newerLayoutDefinition } from "@/modules/documents/templates";

/** ADR-133 item 10: delivery receipt v2 (product name first, code small after); v1 unchanged. Fictional data. */
const meta: DocumentMeta = {
  documentNumber: "DOC-26-0000101",
  documentKind: "delivery_receipt",
  templateCode: "DR-STD",
  templateName: "Delivery receipt",
  templateVersionNo: 1,
  definitionChecksum: "b".repeat(64),
  watermark: null,
  recordRevisionNo: 1,
  reprintNo: 0,
  reprintOfNumber: null,
  sourceRevisionAt: "2026-11-10T03:00:00.000Z",
  sourceState: "dispatched",
  generatedAt: "10 Nov 2026, 11:05",
  generatedByName: "Lito Pascual",
  siteCode: "NFD",
  organizationName: "Bryel's Care Corporation (demo)",
  traceRef: "ABCDEF34",
};
const data: DeliveryReceiptData = {
  company: { name: "Bryel's Care Corporation (demo)", shipFrom: "North Fields Plant, Calamba" },
  dr: { drNumber: "DR-26-00007", shipmentNumber: "SHP-26-00007", orderNumber: "SO-26-00004", customerPo: null, dispatchedText: "10 Nov 2026, 10:00", carrier: null, trackingNumber: null, driverName: "Ramon", vehiclePlate: "NBC 1234", packagesText: "1", grossWeightText: null },
  customer: { code: "CUS-001", name: "Luntian Wellness Stores (fictional)", shipTo: "12 Rizal Ave., Santa Rosa", contact: null },
  lines: [{ sku: "ACS-135", productName: "Acapulco Soap 135 g", lotNumber: "L-2611-00015", expiresText: "13 Oct 2028", boxesText: "BOX-26-0001", shippedText: "24 pcs", orderedText: "24 pcs", remainingText: "0 pcs", overShipment: false }],
  totals: { unitsText: "24 pcs", boxes: 1 },
  overShipmentText: null,
  copies: ["Customer"],
  statutoryText: null,
  remarks: null,
  acknowledgment: null,
};

describe("delivery receipt renderers", () => {
  it("v1 and v2 are both registered; new templates get v2 first", () => {
    expect(findRenderer("delivery_receipt", 1)).toBe(deliveryReceiptRendererV1);
    expect(findRenderer("delivery_receipt", 2)).toBe(deliveryReceiptRendererV2);
    expect(renderersForKind("delivery_receipt").map((r) => r.version)).toEqual([2, 1]);
    expect(checkDefinition(deliveryReceiptRendererV2.defaultDefinition("delivery_receipt"), "delivery_receipt").ok).toBe(true);
  });

  it("v2 puts the product name first and the code small after it, in one column", () => {
    const out = renderFrozen(deliveryReceiptRendererV2.defaultDefinition("delivery_receipt"), "delivery_receipt", { meta, data });
    expect(out.body.value).toContain("<th>Product</th><th>Lot</th>");
    expect(out.body.value).not.toContain("<th>SKU</th>");
    expect(out.body.value).toContain('<td data-testid="dr-product"><strong>Acapulco Soap 135 g</strong> <span class="code">ACS-135</span></td>');
    expect(out.css).toContain(".code");
  });

  it("v1 is unchanged: SKU first, then the product (printed receipts keep their checksum)", () => {
    const def = deliveryReceiptRendererV1.defaultDefinition("delivery_receipt");
    const a = renderFrozen(def, "delivery_receipt", { meta, data });
    const b = renderFrozen(def, "delivery_receipt", { meta, data });
    expect(a.checksumSha256).toBe(b.checksumSha256);
    expect(a.body.value).toContain("<th>SKU</th><th>Product</th>");
    expect(a.body.value).toContain("<td><strong>ACS-135</strong></td>");
  });

  it("a v1 template can move to v2 only as a new version (newerLayoutDefinition); v2 has nothing newer", () => {
    const moved = newerLayoutDefinition("delivery_receipt", deliveryReceiptRendererV1.defaultDefinition("delivery_receipt"));
    expect(moved?.renderer).toEqual({ id: "delivery_receipt", version: 2 });
    expect(newerLayoutDefinition("delivery_receipt", deliveryReceiptRendererV2.defaultDefinition("delivery_receipt"))).toBeNull();
  });
});

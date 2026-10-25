import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { salesOrders, shipments } from "@/db/schema";
import { cancelInvoice, createInvoiceFromShipment, defaultTaxCode, approveInvoice, issueInvoice, submitInvoice } from "@/modules/finance";
import { placePortalOrder } from "@/modules/portal";
import { createOrder, createQuote, reverseShipment } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { PW, clearOrgSetting, customerByCode, loadW4b, productBySku, setOrgSetting, shipNfdOrder, stockUp, type W4b } from "../../support/w4b";
import { portalSignIn } from "../../support/w4e";

/**
 * Wave 4 integration checks across streams:
 * - W3E ↔ W4B: a dispatch whose shipment is already invoiced cannot be reversed (the invoice is cancelled,
 *   or credited in full, first), so stock and receivables never disagree;
 * - W4B ↔ W3D/W4E: the demo seed configures no default sales tax code, so quotes, staff orders and portal
 *   orders work; a configured code without a reviewed rate refuses all three (TAX_CONFIG_MISSING), and the
 *   portal customer sees a plain message instead of finance instructions.
 */
let w: W4b;
const key = () => crypto.randomUUID();
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW4b();
  await stockUp(w);
});

describe("W3E ↔ W4B: reversing an invoiced dispatch", () => {
  it("a draft invoice blocks the reversal until finance cancels it", async () => {
    const s = await shipNfdOrder(w, "CUS-003", [{ sku: "ACS-135", qty: "24", price: "72.50" }]);
    const { invoiceId } = await createInvoiceFromShipment(w.sales, { shipmentId: s.shipment.id });
    const e = await expectCode(reverseShipment(w.manager, s.shipment.id, { reason: "Truck did not leave the yard", idempotencyKey: key() }), "conflict");
    expect(e.details?.code).toBe("SHIPMENT_INVOICED");
    expect(e.message).toMatch(/cancel/i);
    const [still] = await db.select().from(shipments).where(eq(shipments.id, s.shipment.id));
    expect(still.status).toBe("dispatched");
    await cancelInvoice(w.finance, invoiceId, "Shipment is being reversed (test)");
    const r = await reverseShipment(w.manager, s.shipment.id, { reason: "Truck did not leave the yard", idempotencyKey: key() });
    expect(r.movements).toBeGreaterThan(0);
  });

  it("an issued invoice blocks the reversal: credit it in full first", async () => {
    const s = await shipNfdOrder(w, "CUS-003", [{ sku: "GBS-135", qty: "12", price: "70.00" }]);
    const { invoiceId } = await createInvoiceFromShipment(w.sales, { shipmentId: s.shipment.id });
    await submitInvoice(w.sales, invoiceId);
    await approveInvoice(w.finance, invoiceId);
    await issueInvoice(w.finance2, invoiceId, { password: PW });
    const e = await expectCode(reverseShipment(w.manager, s.shipment.id, { reason: "Dispatched to the wrong customer", idempotencyKey: key() }), "conflict");
    expect(e.details?.code).toBe("SHIPMENT_INVOICED");
    expect(e.message).toMatch(/credit note/i);
  });
});

describe("W4B tax configuration and demo ordering (quotes, staff orders, portal orders)", () => {
  it("the seed configures no default sales tax code, so quotes, staff orders and portal orders work without a tax line", async () => {
    expect(await defaultTaxCode(db, w.orgId, "sales")).toBeNull();
    const c = await customerByCode("CUS-003");
    const acs = (await productBySku("ACS-135")).id;
    const q = await createQuote(w.sales, { customerId: c.id, lines: [{ productId: acs, qtyUnits: "48" }] });
    expect(q.quoteNumber).toBeTruthy();
    const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(5), lines: [{ productId: acs, qtyUnits: "48", unitPrice: "72.50" }] });
    const [row] = await db.select().from(salesOrders).where(eq(salesOrders.id, o.id));
    expect(Number(row.taxAmount)).toBe(0);
    const joy = (await portalSignIn("portal.mabuhay@bryels-care.test")).ctx;
    const p = await placePortalOrder(joy, { lines: [{ productId: acs, qty: "48" }], requestedDeliveryOn: inDays(10) }, { idempotencyKey: key() });
    expect(["confirmed", "pending_approval", "submitted"]).toContain(p.status);
  });

  it("a configured sales code without a reviewed rate refuses quotes, orders and portal orders (TAX_CONFIG_MISSING); the portal shows a plain message", async () => {
    await setOrgSetting(w.orgId, "finance.tax.default_sales_code", "NOT-REVIEWED");
    try {
      const c = await customerByCode("CUS-003");
      const acs = (await productBySku("ACS-135")).id;
      const e1 = await expectCode(createQuote(w.sales, { customerId: c.id, lines: [{ productId: acs, qtyUnits: "48" }] }), "validation");
      expect(e1.details?.code).toBe("TAX_CONFIG_MISSING");
      const e2 = await expectCode(createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(5), lines: [{ productId: acs, qtyUnits: "48", unitPrice: "72.50" }] }), "validation");
      expect(e2.details?.code).toBe("TAX_CONFIG_MISSING");
      const joy = (await portalSignIn("portal.mabuhay@bryels-care.test")).ctx;
      const e3 = await expectCode(placePortalOrder(joy, { lines: [{ productId: acs, qty: "48" }], requestedDeliveryOn: inDays(10) }, { idempotencyKey: key() }), "validation");
      expect(e3.details?.code).toBe("TAX_CONFIG_MISSING");
      expect(e3.message).not.toMatch(/finance|tax configuration/i);
      expect(e3.message).toMatch(/Bryel's Care/);
    } finally {
      await clearOrgSetting(w.orgId, "finance.tax.default_sales_code");
    }
  });

  it("the FICTIONAL reviewed placeholder FICT-OUT can be chosen for a demo: quotes then carry its rate", async () => {
    await setOrgSetting(w.orgId, "finance.tax.default_sales_code", "FICT-OUT");
    try {
      const c = await customerByCode("CUS-003");
      const acs = (await productBySku("ACS-135")).id;
      const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(5), lines: [{ productId: acs, qtyUnits: "10", unitPrice: "100.00" }] });
      const [row] = await db.select().from(salesOrders).where(eq(salesOrders.id, o.id));
      expect(Number(row.taxAmount)).toBe(120);
    } finally {
      await clearOrgSetting(w.orgId, "finance.tax.default_sales_code");
    }
  });

});

/**
 * ADR-124 item 1 (demo rehearsal 2026-11-07): after the invoice is sent for approval the delivery still read
 * "Next: finance bills it" with "Open invoice draft". The delivery's and the order's next step now follow the invoice:
 * no invoice / draft → finance bills it; sent for approval → waiting for the named approvers (nextActors, the same
 * record as To approve, owner override as in ADR-122); approved → finance saves it to the books; saved → get paid.
 * The same stages are the "How work flows" invoice counts. Scoped like the delivery: never another site's.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invoices, settings } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { getWorkFlowItems } from "@/modules/analytics";
import { approveInvoice, billingStepOfOrder, billingStepOfShipment, issueInvoice, submitInvoice } from "@/modules/finance";
import { billingStepWords } from "@/lib/billing-step-words";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { PW, bundle, loadW4b, setOrgSetting, shipNfdOrder, stockUp, withPermissions, type W4b } from "../../support/w4b";

let w: W4b;
let shipmentId: string;
let orderId: string;
let invoiceId: string;

const flowIds = async (key: "not_billed" | "inv_draft" | "inv_to_approve" | "inv_approved") => (await getWorkFlowItems(w.owner, key)).items.map((i) => i.id);

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW4b({ draftAtDispatch: true });
  await stockUp(w);
  const s = await shipNfdOrder(w, "CUS-001", [{ sku: "ACS-135", qty: "12", price: "68" }]);
  shipmentId = s.shipment.id;
  orderId = s.orderId;
  invoiceId = (await db.select().from(invoices).where(eq(invoices.shipmentId, shipmentId)))[0].id;
}, 180_000);

describe("the delivery's and the order's next step follow the invoice", () => {
  it("draft made at dispatch: finance bills it, the draft is ready", async () => {
    const step = await billingStepOfShipment(w.finance, shipmentId);
    expect(step).toMatchObject({ stage: "draft", invoice: { id: invoiceId, status: "draft" } });
    expect(step!.next?.does).toBe("sends the invoice for approval");
    const words = billingStepWords(step!);
    expect(words.text).toMatch(/Next: finance bills it/);
    expect(words.action?.label).toBe("Open the invoice draft");
    expect((await billingStepOfOrder(w.sales, orderId))?.stage).toBe("draft");
    expect(await flowIds("inv_draft")).toContain(invoiceId);
    expect(await flowIds("not_billed")).not.toContain(shipmentId);
  });

  it("sent for approval: waiting for the named approvers, never the person who sent it", async () => {
    await submitInvoice(w.sales, invoiceId);
    const step = await billingStepOfShipment(w.warehouse, shipmentId);
    expect(step?.stage).toBe("submitted");
    // The warehouse may not open invoices: the stage and the names, no invoice link.
    expect(step!.invoice).toBeNull();
    expect(step!.next?.kind).toBe("invoice");
    const ids = step!.next!.people.map((p) => p.userId);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain(w.sales.userId);
    const words = billingStepWords(step!);
    expect(words.text).not.toMatch(/finance bills it/);
    expect(words.text).toMatch(/sent for approval/);
    expect(words.waitingFor).toMatch(/^Waiting for .+ \(.+\) to approve the invoice/);
    expect(words.action).toBeUndefined();
    // Finance sees the same stage and the link to the invoice (not "the draft").
    const f = billingStepWords((await billingStepOfShipment(w.finance, shipmentId))!);
    expect(f.action?.label).toMatch(/^Open the invoice/);
    expect(f.action?.label).not.toMatch(/draft/);
    expect((await billingStepOfOrder(w.sales, orderId))?.stage).toBe("submitted");
    expect(await flowIds("inv_to_approve")).toContain(invoiceId);
    expect(await flowIds("inv_draft")).not.toContain(invoiceId);
  });

  it("approved: finance saves it to the books", async () => {
    await approveInvoice(w.finance, invoiceId);
    const step = await billingStepOfShipment(w.owner, shipmentId);
    expect(step?.stage).toBe("approved");
    expect(step!.next?.does).toBe("saves it to the books");
    expect(billingStepWords(step!).text).toMatch(/Next: finance saves it to the books/);
    expect((await billingStepOfOrder(w.sales, orderId))?.stage).toBe("approved");
    expect(await flowIds("inv_approved")).toContain(invoiceId);
  });

  it("saved to the books: billed, next get paid", async () => {
    await issueInvoice(w.finance2, invoiceId, { password: PW });
    const step = await billingStepOfShipment(w.finance, shipmentId);
    expect(step?.stage).toBe("billed");
    expect(step!.invoice?.number).toMatch(/^INV-/);
    expect(billingStepWords(step!).text).toMatch(/Next: get paid/);
    expect((await billingStepOfOrder(w.sales, orderId))?.stage).toBe("billed");
    expect(await flowIds("inv_approved")).not.toContain(invoiceId);
  });

  it("never another site's delivery, and not without delivery or invoice permission", async () => {
    const rvsOnly = withPermissions(w.finance, bundle("finance"), w.finance.roleCodes, [w.rvs]);
    await expectCode(billingStepOfShipment(rvsOnly, shipmentId), "not_found");
    await expectCode(billingStepOfOrder(rvsOnly, orderId), "not_found");
    const nobody = withPermissions(w.warehouse, ["inventory.lot.view"], w.warehouse.roleCodes, [w.nfd]);
    await expectCode(billingStepOfShipment(nobody, shipmentId), "forbidden");
    await expectCode(billingStepOfOrder(nobody, orderId), "forbidden");
  });
});

describe("ADR-126 setting sales.show_invoice_stage_without_invoice_access", () => {
  const KEY = "sales.show_invoice_stage_without_invoice_access";
  afterEach(async () => {
    await db.delete(settings).where(and(eq(settings.organizationId, w.orgId), eq(settings.key, KEY)));
  });

  it("on (default): people without invoice access see the stage and the next step, without a link", async () => {
    expect(await getSetting(db, w.orgId, KEY)).toBe(true);
    const step = await billingStepOfShipment(w.warehouse, shipmentId);
    expect(step?.stage).toBe("billed");
    expect(step!.invoice).toBeNull();
    expect(billingStepWords(step!).text).toMatch(/Billed\. Next: get paid/);
  });

  it("off: people without invoice access see only Delivered (no stage, no names); finance still sees everything", async () => {
    await setOrgSetting(w.orgId, KEY, false);
    const step = await billingStepOfShipment(w.warehouse, shipmentId);
    expect(step).toEqual({ stage: "hidden", invoice: null, next: null });
    expect(billingStepWords(step!)).toEqual({ text: "Delivered." });
    const order = await billingStepOfOrder(w.warehouse, orderId);
    expect(order).toMatchObject({ stage: "hidden", invoice: null, next: null });
    expect(billingStepWords(order!, "Sent out to the customer.")).toEqual({ text: "Sent out to the customer." });
    // Finance and sales (who hold finance.invoice.view) still see the stage and the invoice.
    const f = await billingStepOfShipment(w.finance, shipmentId);
    expect(f?.stage).toBe("billed");
    expect(f!.invoice?.number).toMatch(/^INV-/);
    expect((await billingStepOfOrder(w.sales, orderId))?.stage).toBe("billed");
    // Scoping is unchanged: without delivery or invoice permission it is still refused.
    const nobody = withPermissions(w.warehouse, ["inventory.lot.view"], w.warehouse.roleCodes, [w.nfd]);
    await expectCode(billingStepOfShipment(nobody, shipmentId), "forbidden");
  });
});

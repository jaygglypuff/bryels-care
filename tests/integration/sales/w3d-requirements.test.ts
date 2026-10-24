/**
 * US-4-02 customer requirements and packaging configuration (W3D). Tests: statemachine.* (version),
 * fefo.min_shelf_life_customer (snapshot on the order line), separation of duties, role escalation.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { customerRequirements, salesOrderLines } from "@/db/schema";
import {
  approveRequirement,
  createArtworkVersion,
  createOrder,
  draftRequirement,
  effectiveRequirements,
  listRequirements,
  rejectRequirement,
  resolvePackagingConfig,
  retireRequirement,
  setItemCode,
  submitOrder,
  submitRequirement,
} from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { expectCode } from "../../support/kit";
import { auditCount, inDays, loadW3d, newCustomer, productId, type W3d } from "../../support/w3d";

let w: W3d;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW3d();
});

async function approved(customerId: string, input: Partial<Parameters<typeof draftRequirement>[1]> & { requirementKind: Parameters<typeof draftRequirement>[1]["requirementKind"] }) {
  const r = await draftRequirement(w.sales, { customerId, effectiveFrom: today(), ...input });
  await submitRequirement(w.sales, r.id);
  await approveRequirement(w.qa, r.id, "Checked against the customer's spec (fictional)");
  return r;
}

describe("US-4-02 requirement versions", () => {
  it("statemachine: draft → pending_approval → approved by another person; illegal moves are 409 and write nothing", async () => {
    const c = await newCustomer(w);
    const r = await draftRequirement(w.sales, { customerId: c.id, requirementKind: "min_remaining_shelf_life_days", valueNumeric: "300", effectiveFrom: today() });
    expect(r).toMatchObject({ status: "draft", versionNo: 1 });
    await expectCode(approveRequirement(w.qa, r.id), "state");
    await submitRequirement(w.sales, r.id);
    await expectCode(submitRequirement(w.sales, r.id), "state");
    // The submitter cannot approve, even when also holding the approve permission.
    const salesWithApprove = (await import("../../support/w3d")).withPermissions(w.sales, [...w.sales.permissions, "masterdata.customer_requirement.approve"]);
    await expectCode(approveRequirement(salesWithApprove, r.id), "separation_of_duties");
    await expectCode(approveRequirement(w.warehouse, r.id), "forbidden");
    await approveRequirement(w.qa, r.id);
    expect(await auditCount(r.id, "masterdata.customer_requirement.approved")).toBe(1);
    const [row] = await db.select().from(customerRequirements).where(eq(customerRequirements.id, r.id));
    expect(row).toMatchObject({ status: "approved", approvedBy: w.qa.userId, submittedBy: w.sales.userId });
    // Only one open version per requirement; approved content is never edited in place.
    const v2 = await draftRequirement(w.sales, { customerId: c.id, requirementKind: "min_remaining_shelf_life_days", valueNumeric: "330", effectiveFrom: inDays(10) });
    expect(v2.versionNo).toBe(2);
    await expectCode(draftRequirement(w.sales, { customerId: c.id, requirementKind: "min_remaining_shelf_life_days", valueNumeric: "1", effectiveFrom: today() }), "conflict");
    await submitRequirement(w.sales, v2.id);
    await approveRequirement(w.qa, v2.id);
    const [v1] = await db.select().from(customerRequirements).where(eq(customerRequirements.id, r.id));
    expect(v1.effectiveTo).toBe(inDays(10)); // superseded on the new version's date
    // Today v1 still applies; v2 is scheduled.
    const eff = await effectiveRequirements(db, w.orgId, c.id, null);
    expect(eff.min_remaining_shelf_life_days?.versionNo).toBe(1);
    const list = await listRequirements(w.warehouse, c.id);
    expect(list.find((x) => x.id === v2.id)?.scheduled).toBe(true);
  });

  it("a rejected or returned version needs a reason; a retired version stops applying", async () => {
    const c = await newCustomer(w);
    const r = await draftRequirement(w.sales, { customerId: c.id, requirementKind: "coa_required", valueText: "true", effectiveFrom: today() });
    await submitRequirement(w.sales, r.id);
    await expectCode(rejectRequirement(w.qa, r.id, ""), "validation");
    await rejectRequirement(w.qa, r.id, "Spec reference missing", { returnToDraft: true });
    await submitRequirement(w.sales, r.id);
    await approveRequirement(w.qa, r.id);
    expect((await effectiveRequirements(db, w.orgId, c.id, null)).coa_required?.id).toBe(r.id);
    await retireRequirement(w.qa, r.id, "Customer dropped the CoA request");
    expect((await effectiveRequirements(db, w.orgId, c.id, null)).coa_required).toBeUndefined();
  });

  it("a product-specific approved version beats the all-products one", async () => {
    const c = await newCustomer(w);
    const acs = await productId("ACS-135");
    await approved(c.id, { requirementKind: "min_remaining_shelf_life_days", valueNumeric: "200" });
    await approved(c.id, { requirementKind: "min_remaining_shelf_life_days", valueNumeric: "400", productId: acs });
    expect((await effectiveRequirements(db, w.orgId, c.id, acs)).min_remaining_shelf_life_days?.valueNumeric).toBe("400.000000");
    expect((await effectiveRequirements(db, w.orgId, c.id, await productId("GBS-135"))).min_remaining_shelf_life_days?.valueNumeric).toBe("200.000000");
  });

  it("fefo.min_shelf_life_customer: submitting an order snapshots the approved minimum shelf life and the requirement ids on each line", async () => {
    const c = await newCustomer(w, { minShelfLifeDays: 120 });
    const acs = await productId("ACS-135");
    const req = await approved(c.id, { requirementKind: "min_remaining_shelf_life_days", valueNumeric: "450", productId: acs });
    await setItemCode(w.sales, { customerId: c.id, productId: acs, customerItemCode: "CUST-SOAP-01" });
    const o = await createOrder(w.sales, { customerId: c.id, requestedDeliveryOn: inDays(10), lines: [{ productId: acs, qtyUnits: "48", unitPrice: "70" }, { productId: await productId("GBS-135"), qtyUnits: "48", unitPrice: "70" }] });
    await submitOrder(w.sales, o.id);
    const lines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, o.id)).orderBy(salesOrderLines.lineNo);
    expect(lines[0].minRemainingShelfLifeDays).toBe(450);
    expect(lines[0].customerItemCode).toBe("CUST-SOAP-01");
    expect((lines[0].requirementSnapshot as { requirementIds: string[] }).requirementIds).toEqual([req.id]);
    // No requirement for GBS: the customer default applies.
    expect(lines[1].minRemainingShelfLifeDays).toBe(120);
  });

  it("packaging configuration: the customer's approved carton count and artwork override the SKU default; none → default flagged", async () => {
    const c = await newCustomer(w);
    const acs = await productId("ACS-135");
    const dflt = await resolvePackagingConfig(db, w.orgId, c.id, acs);
    expect(dflt.usedDefault).toBe(true);
    const art = await createArtworkVersion(w.sales, { customerId: c.id, productId: acs, artworkCode: "ART-T3D-" + Date.now().toString(36).slice(-4), versionLabel: "v2" });
    await approved(c.id, { requirementKind: "carton_count", valueNumeric: "24", productId: acs });
    await approved(c.id, { requirementKind: "label_artwork", artworkVersionId: art.id, productId: acs });
    const cfg = await resolvePackagingConfig(db, w.orgId, c.id, acs);
    expect(cfg).toMatchObject({ unitsPerBox: 24, unitsPerBoxSource: "customer_requirement", usedDefault: false });
    expect(cfg.artwork?.versionLabel).toBe("v2");
    expect(cfg.requirementIds).toHaveLength(2);
  });

  it("role escalation: warehouse and production can view requirements but not draft them", async () => {
    const c = await newCustomer(w);
    await expectCode(draftRequirement(w.warehouse, { customerId: c.id, requirementKind: "moq", valueNumeric: "10", effectiveFrom: today() }), "forbidden");
    expect(await listRequirements(w.warehouse, c.id)).toEqual([]);
    await expectCode(draftRequirement(w.sales, { customerId: c.id, requirementKind: "moq", valueNumeric: "ten", effectiveFrom: today() }), "validation");
  });
});

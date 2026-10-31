/**
 * ADR-088 (grade-5 standard): nobody types a code on the Setup screens. Every set-up record left
 * without a code gets one from the system in the same transaction (WH-, LINE-, DEP-, QCP- running
 * numbers; site initials; reason and unit short names from the words), a typed code is still
 * validated and unique, a blank code on edit keeps the code, and a new material takes its QA
 * defaults from its kind. Negative tests: role escalation and cross-site creates stay refused.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, materials, products, supplierMaterialChanges, supplierMaterials, suppliers, warehouses } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import {
  createDepartment,
  createInspectionPlan,
  createLine,
  createLocation,
  createMaterialMaster,
  createReasonCode,
  createSite,
  createSupplier,
  createUom,
  createWarehouse,
  getInspectionPlanDetail,
  saveInspectionPlanDraft,
  updateLocation,
  updateMaterial,
  updateSupplier,
  updateWarehouse,
} from "@/modules/masterdata";
import { createMaterialWithUsualSupplier } from "@/modules/procurement";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit } from "../../support/kit";

let kit: Kit;
let admin: AuthContext;
let adminNfdOnly: AuthContext;
let qa: AuthContext;
let operator: AuthContext;
let procurement: AuthContext;
let owner: AuthContext;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  admin = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
  adminNfdOnly = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  procurement = await asUser(kit, "procurement@bryels-care.test", "procurement", [kit.nfd, kit.rvs]);
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
}, 180_000);

describe("ADR-088 codes made by the system", () => {
  it("sites get initials from the name; a taken one gets a number", async () => {
    const a = await createSite(admin, { name: "Batangas Annex (fictional)" });
    expect(a.code).toBe("BAF");
    const b = await createSite(admin, { name: "Batangas Annex Fictional" });
    expect(b.code).toBe("BAF2");
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "masterdata.site.created"), eq(auditEvents.entityId, a.id)));
    expect(ev.after).toMatchObject({ code: "BAF", codeAssigned: true });
    await expectCode(createSite(admin, { name: "Bad", code: "toolong1" }), "validation");
    await expectCode(createSite(operator, { name: "Nope" }), "forbidden");
  });

  it("warehouses, lines and departments get WH-, LINE- and DEP- numbers; blank on edit keeps the code", async () => {
    const w = await createWarehouse(admin, { siteId: kit.nfd.id, name: "Packaging store (fictional)", warehouseKind: "packaging" });
    expect(w.code).toMatch(/^WH-\d{4}$/);
    const w2 = await createWarehouse(admin, { siteId: kit.nfd.id, name: "Second store (fictional)", warehouseKind: "general", code: "" });
    expect(w2.code).not.toBe(w.code);
    const kept = await updateWarehouse(admin, w.id, { name: "Packaging store renamed (fictional)", warehouseKind: "packaging", code: "" });
    expect(kept.code).toBe(w.code);
    const d = await createDepartment(admin, { siteId: kit.nfd.id, name: "Maintenance (fictional)" });
    expect(d.code).toMatch(/^DEP-\d{4}$/);
    const l = await createLine(admin, { siteId: kit.nfd.id, name: "Soap room 2 (fictional)", departmentId: d.id });
    expect(l.code).toMatch(/^LINE-\d{4}$/);
    // Cross-site: a site outside the caller's scope stays refused.
    await expectCode(createWarehouse(adminNfdOnly, { siteId: kit.rvs.id, name: "Elsewhere", warehouseKind: "general" }), "not_found"); // out-of-scope sites are hidden
    await expectCode(createLine(operator, { siteId: kit.nfd.id, name: "No permission" }), "forbidden");
  });

  it("locations keep their code when the edit form leaves it blank", async () => {
    const [w] = await db.select().from(warehouses).where(eq(warehouses.siteId, kit.nfd.id));
    const l = await createLocation(admin, { warehouseId: w.id, name: "Shelf 3 (fictional)", kind: "storage" });
    expect(l.code).toMatch(/^LOC-\d{4}$/);
    const after = await updateLocation(admin, l.id, { name: "Shelf 3B (fictional)", kind: "storage", code: "" });
    expect(after.code).toBe(l.code);
    expect(after.name).toBe("Shelf 3B (fictional)");
  });

  it("reasons and units get short names from the words", async () => {
    const r = await createReasonCode(admin, { name: "Pest found in store", appliesTo: ["adjustment"] });
    expect(r.code).toBe("pest_found_in_store");
    const r2 = await createReasonCode(admin, { name: "Pest found in store!", appliesTo: ["scrap"] });
    expect(r2.code).toBe("pest_found_in_store_2");
    const u = await createUom(admin, { name: "Steel drum", dimension: "count" });
    expect(u.code).toBe("steel_drum");
    await expectCode(createUom(admin, { name: "Kilo again", dimension: "mass", code: "KG" }), "conflict");
    await expectCode(createReasonCode(operator, { name: "Nope", appliesTo: ["adjustment"] }), "forbidden");
  });

  it("quality checks get QCP- numbers and a name from the item; test codes come from the test names", async () => {
    const [p] = await db.select().from(products).limit(1);
    const { planId } = await createInspectionPlan(qa, { planKind: "in_process", productId: p.id });
    const v = await getInspectionPlanDetail(qa, planId);
    expect(v!.plan.code).toMatch(/^QCP-\d{4}$/);
    expect(v!.plan.name).toContain(p.name);
    await saveInspectionPlanDraft(qa, {
      planId,
      name: v!.plan.name,
      tests: [
        { testCode: "", name: "Appearance", valueKind: "text", specText: "Smooth" },
        { name: "Appearance", valueKind: "pass_fail", specText: "No cracks" },
        { testCode: "PH", name: "pH", valueKind: "numeric", uom: "pH", specMin: "5", specMax: "7" },
      ],
    });
    const after = await getInspectionPlanDetail(qa, planId);
    expect(after!.tests.map((t) => t.testCode)).toEqual(["APPEARANCE", "APPEARANCE-2", "PH"]);
    await expectCode(createInspectionPlan(qa, { planKind: "incoming" }), "validation");
    await expectCode(createInspectionPlan(operator, { planKind: "in_process", productId: p.id }), "forbidden");
  });

  it("suppliers: blank code on edit keeps the code; a new supplier starts 'new'", async () => {
    const s = await createSupplier(procurement, { name: "Island Oils (fictional)" });
    expect(s.code).toMatch(/^SUP-\d{4}$/);
    expect(s.qualityStatus).toBe("new");
    const after = await updateSupplier(procurement, s.id, { name: "Island Oils Trading (fictional)", code: "", qualityStatus: "new" });
    expect(after.code).toBe(s.code);
  });
});

describe("ADR-088 new material in three questions", () => {
  it("QA defaults follow the kind: ingredients and packaging wait for QA, supplies do not", async () => {
    const ing = await createMaterialMaster(admin, { name: "Kokum butter (fictional)", materialKind: "raw_material", baseUom: "g" });
    expect(ing.code).toMatch(/^MAT-\d{4}$/);
    expect([ing.requiresCoa, ing.requiresIncomingInspection, ing.allocationRule]).toEqual([true, true, "fefo"]);
    const pkg = await createMaterialMaster(admin, { name: "Kraft box (fictional)", materialKind: "packaging", baseUom: "pcs" });
    expect(pkg.requiresIncomingInspection).toBe(true);
    const sup = await createMaterialMaster(admin, { name: "Nitrile gloves (fictional)", materialKind: "consumable", baseUom: "pcs" });
    expect([sup.requiresCoa, sup.requiresIncomingInspection]).toEqual([false, false]);
    const forced = await createMaterialMaster(admin, { name: "Glove box checked (fictional)", materialKind: "consumable", baseUom: "pcs", requiresIncomingInspection: "true", requiresCoa: "false" });
    expect([forced.requiresCoa, forced.requiresIncomingInspection]).toEqual([false, true]);
    await expectCode(createMaterialMaster(admin, { name: "No kind (fictional)", baseUom: "g" }), "validation");
    await expectCode(createMaterialMaster(admin, { name: "No unit (fictional)", materialKind: "raw_material" }), "validation");
  });

  it("an edit with a blank code and no allocation rule keeps both", async () => {
    const m = await createMaterialMaster(admin, { name: "Mango butter (fictional)", materialKind: "raw_material", baseUom: "g" });
    await db.update(materials).set({ allocationRule: "fifo" }).where(eq(materials.id, m.id));
    const after = await updateMaterial(admin, m.id, { name: "Mango butter refined (fictional)", materialKind: "raw_material", baseUom: "g", code: "" });
    expect(after.code).toBe(m.code);
    expect(after.allocationRule).toBe("fifo");
  });

  it("a usual supplier is proposed for the approved list with the pack size, in one transaction", async () => {
    const [s] = await db.select().from(suppliers).where(eq(suppliers.organizationId, kit.orgId)).limit(1);
    const m = await createMaterialWithUsualSupplier(owner, { name: "Cocoa butter (fictional)", materialKind: "raw_material", baseUom: "g", standardPackQty: "25", standardPackUom: "kg", usualSupplierId: s.id });
    const [pair] = await db.select().from(supplierMaterials).where(and(eq(supplierMaterials.supplierId, s.id), eq(supplierMaterials.materialId, m.id)));
    expect(pair.isApproved).toBe(false);
    expect([pair.packQty && Number(pair.packQty), pair.packUom]).toEqual([25, "kg"]);
    const changes = await db.select().from(supplierMaterialChanges).where(eq(supplierMaterialChanges.supplierMaterialId, pair.id));
    expect(changes.map((c) => c.status)).toEqual(["pending"]);
    // Without masterdata.supplier.edit the whole create is refused (nothing half-made).
    const before = (await db.select({ id: materials.id }).from(materials).where(eq(materials.organizationId, kit.orgId))).length;
    await expectCode(createMaterialWithUsualSupplier(qa, { name: "QA cannot pick suppliers (fictional)", materialKind: "raw_material", baseUom: "g", usualSupplierId: s.id }), "forbidden");
    expect((await db.select({ id: materials.id }).from(materials).where(eq(materials.organizationId, kit.orgId))).length).toBe(before);
  });
});

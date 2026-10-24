/**
 * US-1-22 products and SKUs, US-1-23 materials, US-1-24 reason codes: codes, lifecycles, audit,
 * exports through src/lib/export.ts (permission, neutralisation, platform.export.created) and
 * authz.role_escalation on every write.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, reasonCodes, uoms } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { runExport } from "@/lib/export";
import {
  DEFAULT_REASON_CODES,
  assertReasonCode,
  changeMaterialStatus,
  changeProductStatus,
  changeSkuStatus,
  createMaterialMaster,
  createProduct,
  createReasonCode,
  createSku,
  getMaterial,
  getProduct,
  listMaterialMaster,
  listReasonCodes,
  listSkus,
  materialsExport,
  productsExport,
  reasonCodeOptions,
  updateMaterial,
  updateProduct,
  updateReasonCode,
  updateSku,
} from "@/modules/masterdata";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit } from "../../support/kit";
import { expectDbError } from "./helpers";

let kit: Kit;
let admin: AuthContext;
let owner: AuthContext;
let planner: AuthContext;
let qa: AuthContext;
let procurement: AuthContext;
let operator: AuthContext;
let manager: AuthContext;
let sales: AuthContext;
let pcsId: string;
let kgId: string;

const events = (entityId: string, action: string) => db.select().from(auditEvents).where(and(eq(auditEvents.entityId, entityId), eq(auditEvents.action, action)));
const text = (b: Buffer) => b.toString("utf8");

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  admin = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  planner = await asUser(kit, "planner.nfd@bryels-care.test", "production_planner", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  procurement = await asUser(kit, "procurement@bryels-care.test", "procurement", [kit.rvs]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd, kit.rvs]);
  const units = await db.select().from(uoms).where(eq(uoms.organizationId, kit.orgId));
  pcsId = units.find((u) => u.code === "pcs")!.id;
  kgId = units.find((u) => u.code === "kg")!.id;
}, 180_000);

describe("products and SKUs (US-1-22)", () => {
  it("a product code is organization-unique and scan-safe, the family is configured, status draft → active → discontinued", async () => {
    const base = { code: "ccs-100", name: "Calamansi Cream Soap 100 g (fictional)", family: "soap", unitNetMassG: "100", unitsPerBox: "48", shelfLifeDays: "730" };
    await expectCode(createProduct(operator, base), "forbidden");
    await expectCode(createProduct(planner, { ...base, code: "CCS 100" }), "validation");
    await expectCode(createProduct(planner, { ...base, family: "Perfume" }), "validation");
    await expectCode(createProduct(planner, { ...base, code: "ACS-135" }), "conflict");
    const p = await createProduct(planner, base);
    expect(p).toMatchObject({ code: "CCS-100", family: "Soap", status: "draft" });
    expect(await events(p.id, "masterdata.product.created")).toHaveLength(1);
    await expectCode(changeProductStatus(operator, { id: p.id, status: "active" }), "forbidden");
    await changeProductStatus(planner, { id: p.id, status: "active" });
    await expectCode(changeProductStatus(planner, { id: p.id, status: "draft" }), "state");
    const u = await updateProduct(qa, p.id, { ...base, code: "CCS-100", shelfLifeDays: "540" });
    expect(u.shelfLifeDays).toBe(540);
    const ev = (await events(p.id, "masterdata.product.updated")).find((e) => (e.after as Record<string, unknown>).shelfLifeDays !== undefined)!;
    expect(ev.before).toMatchObject({ shelfLifeDays: 730 });
    expect(ev.after).toMatchObject({ shelfLifeDays: 540 });
    // A product in use (formula, batches) keeps its code.
    const acs = (await (await import("@/modules/masterdata")).listProducts(planner, { q: "ACS-135" }))[0];
    await expectCode(updateProduct(planner, acs.id, { ...base, code: "ACS-999", name: acs.name, family: "Soap" }), "state");
  });

  it("an SKU requires a product and a base stock unit, defaults to fefo, validates the GTIN and activates only under an active product", async () => {
    const p = (await (await import("@/modules/masterdata")).listProducts(planner, { q: "CCS-100" }))[0];
    const sku = { productId: p.id, code: "CCS-100-12", name: "Calamansi Cream Soap 12-pack", uomBaseId: pcsId, unitsPerBox: "4", boxesPerPallet: "60", shelfLifeDays: "540" };
    await expectCode(createSku(operator, sku), "forbidden");
    await expectCode(createSku(planner, { ...sku, uomBaseId: kgId }), "validation");
    await expectCode(createSku(planner, { ...sku, gtin: "4800000000001" }), "validation");
    await expectCode(createSku(planner, { ...sku, code: "GBS-135" }), "conflict");
    const s = await createSku(planner, { ...sku, gtin: "4800000000002" });
    expect(s).toMatchObject({ code: "CCS-100-12", allocationRule: "fefo", status: "draft", unitsPerBox: 4, boxesPerPallet: 60, gtin: "4800000000002" });
    await expectCode(createSku(planner, { ...sku }), "conflict");
    const upd = await updateSku(qa, s.id, { ...sku, gtin: "4800000000002", retestDays: "180" });
    expect(upd.retestDays).toBe(180);
    await changeSkuStatus(planner, { id: s.id, status: "active" });
    // Discontinuing the product needs a reason and discontinues its SKUs.
    await expectCode(changeProductStatus(planner, { id: p.id, status: "discontinued" }), "validation");
    await changeProductStatus(planner, { id: p.id, status: "discontinued", reason: "Range rationalised (demo)" });
    expect((await listSkus(sales, { productId: p.id }))[0].status).toBe("discontinued");
    expect(await events(s.id, "masterdata.sku.updated")).toHaveLength(3);
    await expectCode(createSku(planner, { ...sku, code: "CCS-100-24" }), "state");
    // The seeded products carry their default SKU.
    const acs = (await (await import("@/modules/masterdata")).listProducts(sales, { q: "ACS-135" }))[0];
    expect((await getProduct(sales, acs.id)).skus.map((x) => x.code)).toEqual(["ACS-135"]);
  });

  it("export.formula_neutralized: products export needs masterdata.product.export, neutralises formulas and writes platform.export.created", async () => {
    await expectCode(runExport(planner, productsExport, {}, "csv"), "forbidden");
    const p = await createProduct(planner, { code: "FORM-1", name: "=HYPERLINK(\"http://x\")", family: "Other", unitNetMassG: "1", unitsPerBox: "1", shelfLifeDays: "1" });
    const file = await runExport(sales, productsExport, {}, "csv");
    const body = text(file.body);
    expect(body).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(body).toContain('"FORM-1"');
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.export.created"), eq(auditEvents.entityNumber, "masterdata.products")));
    expect(ev.after).toMatchObject({ code: "masterdata.products", rowCount: file.rowCount });
    void p;
  });
});

describe("materials (US-1-23)", () => {
  const base = { code: "mat-0090", name: "Calamansi Extract (fictional)", materialKind: "raw_material", baseUom: "g", shelfLifeDays: "365" };

  it("code scan-safe and unique, class from the list, base unit must be a base unit, CoA and inspection default true, fefo default, INCI warning only", async () => {
    await expectCode(createMaterialMaster(operator, base), "forbidden");
    await expectCode(createMaterialMaster(planner, { ...base, materialKind: "chemical" }), "validation");
    await expectCode(createMaterialMaster(planner, { ...base, baseUom: "kg" }), "validation");
    await expectCode(createMaterialMaster(planner, { ...base, code: "MAT-0012" }), "conflict");
    const m = await createMaterialMaster(planner, base);
    expect(m).toMatchObject({ code: "MAT-0090", requiresCoa: true, requiresIncomingInspection: true, allocationRule: "fefo", status: "active" });
    expect(m.warnings[0]).toMatch(/INCI/);
    const box = await createMaterialMaster(procurement, { code: "PKG-0190", name: "Gift box (fictional)", materialKind: "packaging", baseUom: "pcs" });
    expect(box.warnings).toEqual([]);
    const lye = await createMaterialMaster(planner, { code: "MAT-0091", name: "33.33% Lye Solution B (fictional)", materialKind: "intermediate", baseUom: "g", inciName: "Sodium Hydroxide (aqueous)", shelfLifeDays: "30", hazardNotes: "Corrosive (content validated by QA)" });
    expect(lye).toMatchObject({ materialKind: "intermediate", shelfLifeDays: 30, hazardNotes: "Corrosive (content validated by QA)" });
    expect(lye.warnings).toEqual([]);
  });

  it("procurement at any site sees the organization-wide list without cost fields; edits are audited; codes fixed once in use; lifecycle", async () => {
    const list = await listMaterialMaster(procurement);
    expect(list.length).toBeGreaterThanOrEqual(15);
    expect(Object.keys(list[0])).not.toEqual(expect.arrayContaining(["unitCost", "standardCost", "cost"]));
    const m = list.find((x) => x.code === "MAT-0090")!;
    const upd = await updateMaterial(qa, m.id, { ...base, code: "MAT-0090", inciName: "Citrus Microcarpa Fruit Extract", allergenNotes: "Citrus (QA to confirm)" });
    expect(upd.warnings).toEqual([]);
    const [ev] = await events(m.id, "masterdata.material.updated");
    expect(ev.before).toMatchObject({ inciName: null });
    expect(ev.after).toMatchObject({ inciName: "Citrus Microcarpa Fruit Extract" });
    await expectCode(updateMaterial(operator, m.id, base), "forbidden");
    const coconut = list.find((x) => x.code === "MAT-0012")!;
    expect((await getMaterial(procurement, coconut.id)).inUse).toBe(true);
    await expectCode(updateMaterial(planner, coconut.id, { ...base, code: "MAT-0012X", name: coconut.name }), "state");
    await expectCode(updateMaterial(planner, coconut.id, { ...base, code: "MAT-0012", name: coconut.name, baseUom: "mL" }), "state");
    await expectCode(changeMaterialStatus(planner, { id: m.id, status: "blocked" }), "validation");
    await changeMaterialStatus(planner, { id: m.id, status: "blocked", reason: "Supplier spec under review" });
    await changeMaterialStatus(planner, { id: m.id, status: "discontinued", reason: "Not used" });
    await expectCode(changeMaterialStatus(planner, { id: m.id, status: "active" }), "state");
    await expectCode(updateMaterial(planner, m.id, base), "state");
  });

  it("material export needs masterdata.material.export (procurement yes, planner no) and is audited", async () => {
    await expectCode(runExport(planner, materialsExport, {}, "csv"), "forbidden");
    const f = await runExport(procurement, materialsExport, { materialKind: "packaging" }, "csv");
    expect(text(f.body)).toContain("PKG-0190");
    expect(text(f.body)).not.toContain("MAT-0012");
  });
});

describe("reason codes (US-1-24)", () => {
  // The lists Wave 1 and W2B held in code before the shared table (now removed from the code).
  const WAVE1_CODES = {
    reprint: ["lost_copy", "damaged_label", "status_change", "repack", "customer_copy", "other"],
    hold: ["supplier_complaint", "suspected_contamination", "damaged_packaging", "documentation_issue", "investigation", "retest_due", "other"],
    receipt: ["no_purchase_order", "urgent_purchase", "replacement_delivery", "sample_or_free_goods", "other"],
    adjustment: ["found", "found_unlabelled", "lost", "damaged", "spillage", "expired_disposal", "data_correction", "other"],
    count_variance: ["damage", "mis_location", "unrecorded_issue", "unrecorded_receipt", "data_entry", "loss", "found", "other"],
    scrap: ["broken_bar", "underweight", "appearance", "packaging_damage", "other"],
    rework: ["broken_bar", "underweight", "appearance", "packaging_damage", "other"],
  } as const;

  it("seeds every code the Wave 1 modules held in code, merged by code with the same categories", async () => {
    const all = await listReasonCodes(operator, { includeInactive: true });
    const has = (category: string, codes: readonly string[]) => {
      const inCat = all.filter((r) => r.appliesTo.includes(category)).map((r) => r.code);
      for (const c of codes) expect(inCat, `${category} has ${c}`).toContain(c);
    };
    for (const [category, codes] of Object.entries(WAVE1_CODES)) has(category, codes);
    expect(all.length).toBe(DEFAULT_REASON_CODES.length);
    // Reprint "other" required a note in W1E; the merged row keeps that.
    expect(all.find((r) => r.code === "other")!.requiresNote).toBe(true);
  });

  it("only codes applying to the category are offered; requires_note forces a note (max 500); deactivated codes stay in history but cannot be chosen", async () => {
    const adj = await reasonCodeOptions(db, kit.orgId, "adjustment");
    expect(adj.map((r) => r.code)).toContain("spillage");
    expect(adj.map((r) => r.code)).not.toContain("lost_copy");
    await expectCode(assertReasonCode(db, kit.orgId, "adjustment", "lost_copy"), "validation");
    await expectCode(assertReasonCode(db, kit.orgId, "adjustment", "other", ""), "validation");
    await expectCode(assertReasonCode(db, kit.orgId, "adjustment", "other", "x".repeat(501)), "validation");
    expect(await assertReasonCode(db, kit.orgId, "adjustment", "other", "Pallet dropped")).toMatchObject({ code: "other", note: "Pallet dropped", requiresApproval: false });
    const [spill] = await db.select().from(reasonCodes).where(and(eq(reasonCodes.organizationId, kit.orgId), eq(reasonCodes.code, "spillage")));
    await expectCode(updateReasonCode(manager, spill.id, { name: "Spillage", appliesTo: ["adjustment"], isActive: false }), "forbidden");
    await updateReasonCode(admin, spill.id, { name: "Spillage", appliesTo: ["adjustment"], requiresApproval: true, isActive: false });
    const [ev] = await events(spill.id, "masterdata.reason_code.updated");
    expect(ev.before).toMatchObject({ isActive: true, requiresApproval: false });
    expect(ev.after).toMatchObject({ isActive: false, requiresApproval: true });
    expect((await reasonCodeOptions(db, kit.orgId, "adjustment")).map((r) => r.code)).not.toContain("spillage");
    await expectCode(assertReasonCode(db, kit.orgId, "adjustment", "spillage"), "validation");
    expect((await listReasonCodes(owner, { category: "adjustment", includeInactive: true })).map((r) => r.code)).toContain("spillage");
  });

  it("admins add codes (lower-case, unique, at least one category); the code itself never changes", async () => {
    await expectCode(createReasonCode(qa, { code: "pest", name: "Pest found", appliesTo: ["hold"] }), "forbidden");
    await expectCode(createReasonCode(admin, { code: "Pest Found", name: "Pest found", appliesTo: ["hold"] }), "validation");
    await expectCode(createReasonCode(admin, { code: "pest", name: "Pest found", appliesTo: [] }), "validation");
    await expectCode(createReasonCode(admin, { code: "pest", name: "Pest found", appliesTo: ["nonsense"] }), "validation");
    await expectCode(createReasonCode(admin, { code: "other", name: "dupe", appliesTo: ["hold"] }), "conflict");
    const r = await createReasonCode(admin, { code: "pest", name: "Pest found", appliesTo: ["hold", "hold"], requiresNote: true });
    expect(r.appliesTo).toEqual(["hold"]);
    await expectDbError(db.update(reasonCodes).set({ code: "pests" }).where(eq(reasonCodes.id, r.id)), /CODE_IMMUTABLE/);
  });
});

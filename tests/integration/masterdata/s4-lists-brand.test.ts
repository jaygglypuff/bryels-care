/**
 * ADR-076 (stream S4): editable dropdown lists (Master data → Lists) and material brand / standard pack.
 * - Lists: defaults stand in until the first change; add, rename, reorder, turn off, delete only when unused;
 *   codes never change (trigger); every change is audited; forms accept only active options; concurrent first
 *   edits write the defaults once; role escalation is refused.
 * - Brand and pack: on the material, on the supplier × material pair, on the receipt line and the lot;
 *   pack units must convert to the base unit; cross-site and role negatives.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, customers, goodsReceiptLines, inventoryLots, lookupValues, materials, products, supplierMaterials, suppliers } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import {
  addLookupValue,
  assertLookupValue,
  createMaterialMaster,
  createProduct,
  deleteLookupValue,
  getMaterial,
  listLookupLists,
  lookupLabels,
  lookupOptions,
  lookupValueCount,
  moveLookupValue,
  renameLookupValue,
  setLookupValueActive,
  updateMaterial,
  updateProduct,
} from "@/modules/masterdata";
import { createCustomer } from "@/modules/sales";
import { receiveAndPost } from "@/modules/inventory/receiving";
import { editLotAttributes } from "@/modules/inventory/lots-admin";
import { approvedMaterialsFor, updateSupplierMaterialPack } from "@/modules/procurement";
import { lotLabelEntity } from "@/modules/documents/datasets";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loc, type Kit, loadKit } from "../../support/kit";
import { expectDbError } from "./helpers";

let kit: Kit;
let admin: AuthContext;
let owner: AuthContext;
let operator: AuthContext;
let planner: AuthContext;
let sales: AuthContext;
let procurement: AuthContext;
let wh: AuthContext;
let whRvs: AuthContext;
let auditor: AuthContext;
let manager: AuthContext;

const events = (action: string) => db.select().from(auditEvents).where(eq(auditEvents.action, action));
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  admin = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  planner = await asUser(kit, "planner.nfd@bryels-care.test", "production_planner", [kit.nfd]);
  sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd, kit.rvs]);
  procurement = await asUser(kit, "procurement@bryels-care.test", "procurement", [kit.nfd, kit.rvs]);
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  whRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
  auditor = await asUser(kit, "auditor@bryels-care.test", "auditor", [kit.nfd, kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
}, 180_000);

describe("editable lists (Master data → Lists)", () => {
  it("shows every editable list with its shipped defaults and use counts; fixed lists are not there", async () => {
    const lists = await listLookupLists(admin);
    expect(lists.map((l) => l.key)).toEqual(["product_family", "material_category", "customer_segment", "supplier_category"]);
    const fam = lists.find((l) => l.key === "product_family")!;
    expect(fam.values.map((v) => v.label)).toEqual(["Soap", "Lotion", "Cream", "Oil", "Other"]);
    expect(fam.values.find((v) => v.code === "Soap")!.inUse).toBeGreaterThan(0); // seeded soaps
    const cat = lists.find((l) => l.key === "material_category")!;
    expect(cat.values.find((v) => v.code === "oils_fats")!.inUse).toBeGreaterThanOrEqual(2); // coconut and palm oil
    expect(await lookupValueCount(db, kit.orgId, "product_family")).toBe(0); // nothing written until the first change
    // Every role can read the lists (they are dropdown choices); the auditor too.
    expect((await listLookupLists(operator)).length).toBe(4);
    expect((await listLookupLists(auditor)).length).toBe(4);
  });

  it("authz.role_escalation: only list admins (system admin, owner) change a list", async () => {
    for (const c of [operator, planner, sales, procurement, wh, auditor]) {
      await expectCode(addLookupValue(c, { listKey: "product_family", label: "Perfume" }), "forbidden");
      await expectCode(renameLookupValue(c, { listKey: "product_family", code: "Soap", label: "Bar soap" }), "forbidden");
      await expectCode(setLookupValueActive(c, { listKey: "product_family", code: "Oil", active: false }), "forbidden");
      await expectCode(moveLookupValue(c, { listKey: "product_family", code: "Oil", direction: "up" }), "forbidden");
      await expectCode(deleteLookupValue(c, { listKey: "product_family", code: "Other" }), "forbidden");
    }
    expect(await lookupValueCount(db, kit.orgId, "product_family")).toBe(0);
  });

  it("adds an option: the defaults are written once, the new option goes last, duplicates and bad input are refused, audited", async () => {
    const row = await addLookupValue(admin, { listKey: "product_family", label: "Shampoo Bar" });
    expect(row).toMatchObject({ code: "shampoo_bar", label: "Shampoo Bar", isActive: true });
    const opts = await lookupOptions(db, kit.orgId, "product_family");
    expect(opts.map((o) => o.label)).toEqual(["Soap", "Lotion", "Cream", "Oil", "Other", "Shampoo Bar"]);
    expect(await lookupValueCount(db, kit.orgId, "product_family")).toBe(6);
    await expectCode(addLookupValue(admin, { listKey: "product_family", label: "shampoo bar" }), "conflict");
    await expectCode(addLookupValue(admin, { listKey: "product_family", label: "   " }), "validation");
    await expectCode(addLookupValue(admin, { listKey: "product_family", label: "x".repeat(61) }), "validation");
    // Lists that drive program logic cannot be reached.
    await expectCode(addLookupValue(admin, { listKey: "location_kind", label: "Freezer" }), "validation");
    await expectCode(addLookupValue(admin, { listKey: "batch_status", label: "Paused" }), "validation");
    const [ev] = (await events("masterdata.lookup_value.created")).filter((e) => e.entityId === row.id);
    expect(ev).toMatchObject({ entityType: "lookup_value", entityNumber: "product_family:shampoo_bar", siteId: null, actorId: admin.userId });
    // The owner can change lists too.
    const o = await addLookupValue(owner, { listKey: "product_family", label: "Body Wash" });
    expect(o.code).toBe("body_wash");
  });

  it("new products use the list; an option in use cannot be deleted, only turned off; a turned-off option is refused for new records but kept on old ones", async () => {
    const base = { name: "Fictional Shampoo Bar 80 g", unitNetMassG: "80", unitsPerBox: "48", shelfLifeDays: "730" };
    const p = await createProduct(planner, { ...base, code: "SHB-080", family: "Shampoo Bar" }); // by label, any case
    expect(p.family).toBe("shampoo_bar");
    await expectCode(createProduct(planner, { ...base, code: "SHB-081", family: "Perfume" }), "validation");
    await expectCode(deleteLookupValue(admin, { listKey: "product_family", code: "shampoo_bar" }), "state");
    await setLookupValueActive(admin, { listKey: "product_family", code: "shampoo_bar", active: false });
    expect((await lookupOptions(db, kit.orgId, "product_family")).map((o) => o.value)).not.toContain("shampoo_bar");
    expect((await lookupOptions(db, kit.orgId, "product_family", { keep: "shampoo_bar" })).map((o) => o.value)).toContain("shampoo_bar");
    await expectCode(createProduct(planner, { ...base, code: "SHB-082", family: "shampoo_bar" }), "validation");
    // The existing product keeps its family on edit.
    const after = await updateProduct(planner, p.id, { ...base, code: "SHB-080", name: "Fictional Shampoo Bar 80 g (new wrap)", family: "shampoo_bar" });
    expect(after.family).toBe("shampoo_bar");
    await setLookupValueActive(admin, { listKey: "product_family", code: "shampoo_bar", active: true });
    expect((await lookupOptions(db, kit.orgId, "product_family")).map((o) => o.value)).toContain("shampoo_bar");
  });

  it("renames keep the stored code, so records show the new name; reorders renumber the list; unused options can be deleted", async () => {
    await renameLookupValue(admin, { listKey: "product_family", code: "Soap", label: "Bar soap" });
    const labels = await lookupLabels(db, kit.orgId, "product_family");
    expect(labels.get("Soap")).toBe("Bar soap");
    const [acs] = await db.select().from(products).where(eq(products.skuCode, "ACS-135"));
    expect(acs.family).toBe("Soap");
    expect(await assertLookupValue(db, kit.orgId, "product_family", "bar SOAP", { field: "family" })).toBe("Soap");
    await expectCode(renameLookupValue(admin, { listKey: "product_family", code: "Lotion", label: "bar soap" }), "conflict");
    await expectCode(renameLookupValue(admin, { listKey: "product_family", code: "nope", label: "Nope" }), "not_found");

    await moveLookupValue(admin, { listKey: "product_family", code: "Oil", direction: "up" });
    let order = (await lookupOptions(db, kit.orgId, "product_family")).map((o) => o.value);
    expect(order.slice(0, 4)).toEqual(["Soap", "Lotion", "Oil", "Cream"]);
    expect(await moveLookupValue(admin, { listKey: "product_family", code: "Soap", direction: "up" })).toEqual({ moved: false });
    const rows = await db.select().from(lookupValues).where(and(eq(lookupValues.organizationId, kit.orgId), eq(lookupValues.listKey, "product_family")));
    expect(rows.map((r) => r.sortOrder).sort((a, b) => a - b)).toEqual([10, 20, 30, 40, 50, 60, 70]);

    const typo = await addLookupValue(admin, { listKey: "product_family", label: "Lotoin" });
    await deleteLookupValue(admin, { listKey: "product_family", code: typo.code });
    order = (await lookupOptions(db, kit.orgId, "product_family")).map((o) => o.value);
    expect(order).not.toContain(typo.code);
    expect((await events("masterdata.lookup_value.deleted")).some((e) => e.entityId === typo.id)).toBe(true);
    const upd = (await events("masterdata.lookup_value.updated")).find((e) => e.entityNumber === "product_family:Soap");
    expect(upd?.before).toMatchObject({ label: "Soap" });
    expect(upd?.after).toMatchObject({ label: "Bar soap" });
  });

  it("a required list keeps at least one option in use", async () => {
    const opts = await lookupOptions(db, kit.orgId, "product_family");
    for (const o of opts.slice(1)) await setLookupValueActive(admin, { listKey: "product_family", code: o.value, active: false });
    await expectCode(setLookupValueActive(admin, { listKey: "product_family", code: opts[0].value, active: false }), "state");
    for (const o of opts.slice(1)) await setLookupValueActive(admin, { listKey: "product_family", code: o.value, active: true });
  });

  it("the stored code never changes (database trigger)", async () => {
    await expectDbError(db.execute(sql`update lookup_values set code = 'bar_soap' where list_key = 'product_family' and code = 'Soap'`), /CODE_IMMUTABLE/);
  });

  it("concurrent first edits of a list write the defaults once; the same new name twice gives one conflict", async () => {
    const [a, b] = await Promise.allSettled([
      addLookupValue(admin, { listKey: "supplier_category", label: "Essential oils" }),
      addLookupValue(owner, { listKey: "supplier_category", label: "Logistics" }),
    ]);
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("fulfilled");
    expect(await lookupValueCount(db, kit.orgId, "supplier_category")).toBe(6 + 2);
    const same = await Promise.allSettled([addLookupValue(admin, { listKey: "supplier_category", label: "Cleaning" }), addLookupValue(owner, { listKey: "supplier_category", label: "cleaning" })]);
    expect(same.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await lookupValueCount(db, kit.orgId, "supplier_category")).toBe(9);
  });

  it("customer types: by code or name, turned-off types refused; supplier and material categories validated", async () => {
    const c = await createCustomer(sales, { code: `S4-${Date.now().toString(36).toUpperCase()}`, name: "Fictional Spa Buyer", minShelfLifeDays: 0, shipToAddress: "3 Sampaguita St., Calamba, Laguna", segment: "Salon / spa" });
    expect(c.segment).toBe("salon_spa");
    await expectCode(createCustomer(sales, { code: "S4-BAD", name: "Bad type", minShelfLifeDays: 0, shipToAddress: "x street", segment: "Hotel" }), "validation");
    const hotel = await addLookupValue(admin, { listKey: "customer_segment", label: "Hotel" });
    const ok = await createCustomer(sales, { code: "S4-HOTEL", name: "Fictional Hotel", minShelfLifeDays: 0, shipToAddress: "4 Ilang-Ilang St., Santa Rosa", segment: "hotel" });
    expect(ok.segment).toBe(hotel.code);
    await setLookupValueActive(admin, { listKey: "customer_segment", code: hotel.code, active: false });
    await expectCode(createCustomer(sales, { code: "S4-HOTEL2", name: "Fictional Hotel 2", minShelfLifeDays: 0, shipToAddress: "5 Rosal St., Santa Rosa", segment: "Hotel" }), "validation");
    const [row] = await db.select().from(customers).where(eq(customers.id, ok.id));
    expect(row.segment).toBe(hotel.code); // kept on the existing customer

    const [laguna] = await db.select().from(suppliers).where(eq(suppliers.name, "Laguna Oleo Supply"));
    expect(laguna.category).toBe("oils_chemicals"); // demo seed
    await expectCode(createMaterialMaster(planner, { code: "S4-CAT-BAD", name: "Bad category", materialKind: "raw_material", baseUom: "g", category: "Perfumes" }), "validation");
  });
});

describe("material brand and standard pack", () => {
  it("demo seed: oils carry a fictional brand and a standard pack", async () => {
    const [coco] = await db.select().from(materials).where(eq(materials.code, "MAT-0012"));
    expect(coco).toMatchObject({ category: "oils_fats", brand: "Isla Gold (fictional)", standardPackQty: "18.000000", standardPackUom: "kg" });
    const [palm] = await db.select().from(materials).where(eq(materials.code, "MAT-0013"));
    expect(palm).toMatchObject({ brand: "Golden Frond (fictional)", standardPackQty: "25.000000", standardPackUom: "kg" });
    const lots = await db.select().from(inventoryLots).where(eq(inventoryLots.materialId, palm.id));
    expect(new Set(lots.map((l) => l.brand))).toEqual(new Set(["Golden Frond (fictional)", "Laguna Red Palm (fictional)"]));
  });

  it("validates the pack (quantity > 0, unit converts to the base unit) and keeps fields left out on edit", async () => {
    const base = { code: "S4-OIL-1", name: "Fictional Sunflower Oil", materialKind: "raw_material", baseUom: "g" };
    await expectCode(createMaterialMaster(planner, { ...base, standardPackQty: "18", standardPackUom: "pcs" }), "validation");
    await expectCode(createMaterialMaster(planner, { ...base, standardPackQty: "0", standardPackUom: "kg" }), "validation");
    await expectCode(createMaterialMaster(planner, { ...base, standardPackQty: "abc", standardPackUom: "kg" }), "validation");
    await expectCode(createMaterialMaster(planner, { ...base, brand: "b".repeat(81) }), "validation");
    await expectCode(createMaterialMaster(operator, { ...base, brand: "Sunny" }), "forbidden");
    const m = await createMaterialMaster(planner, { ...base, brand: " Sunny Fields (fictional) ", standardPackQty: "18", standardPackUom: "kg", category: "Oils and fats" });
    expect(m).toMatchObject({ brand: "Sunny Fields (fictional)", standardPackQty: "18.000000", standardPackUom: "kg", category: "oils_fats" });
    const noUnit = await createMaterialMaster(planner, { ...base, code: "S4-OIL-2", standardPackQty: "500" });
    expect(noUnit).toMatchObject({ standardPackQty: "500.000000", standardPackUom: "g" });
    // An edit without the new fields (older API client) keeps them.
    await updateMaterial(planner, m.id, { ...base, name: "Fictional Sunflower Oil (high oleic)" });
    const got = await getMaterial(planner, m.id);
    expect(got).toMatchObject({ brand: "Sunny Fields (fictional)", standardPackQty: "18.000000", standardPackUom: "kg", category: "oils_fats" });
    await updateMaterial(planner, m.id, { ...base, name: got.name, brand: "", standardPackQty: "", category: "" });
    expect(await getMaterial(planner, m.id)).toMatchObject({ brand: null, standardPackQty: null, standardPackUom: null, category: null });
    await expectCode(updateMaterial(operator, m.id, { ...base, brand: "x" }), "forbidden");
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, m.id), eq(auditEvents.action, "masterdata.material.updated")));
    expect(ev.some((e) => (e.before as Record<string, unknown>)?.brand === "Sunny Fields (fictional)")).toBe(true);
  });

  it("supplier × material brand and pack: procurement sets them, units are checked, the PO picker offers them as defaults", async () => {
    const [laguna] = await db.select().from(suppliers).where(eq(suppliers.name, "Laguna Oleo Supply"));
    const [coco] = await db.select().from(materials).where(eq(materials.code, "MAT-0012"));
    const [pair] = await db.select().from(supplierMaterials).where(and(eq(supplierMaterials.supplierId, laguna.id), eq(supplierMaterials.materialId, coco.id)));
    await expectCode(updateSupplierMaterialPack(operator, { supplierMaterialId: pair.id, brand: "X" }), "forbidden");
    await expectCode(updateSupplierMaterialPack(sales, { supplierMaterialId: pair.id, brand: "X" }), "forbidden");
    await expectCode(updateSupplierMaterialPack(procurement, { supplierMaterialId: pair.id, packQty: "18", packUom: "pcs" }), "validation");
    await expectCode(updateSupplierMaterialPack(procurement, { supplierMaterialId: randomUUID() }), "not_found");
    await updateSupplierMaterialPack(procurement, { supplierMaterialId: pair.id, brand: "Isla Gold Premium (fictional)", packQty: "20", packUom: "kg" });
    const [after] = await db.select().from(supplierMaterials).where(eq(supplierMaterials.id, pair.id));
    expect(after).toMatchObject({ brand: "Isla Gold Premium (fictional)", packQty: "20.000000", packUom: "kg" });
    const picker = await approvedMaterialsFor(procurement, laguna.id);
    expect(picker.find((p) => p.materialId === coco.id)).toMatchObject({ brand: "Isla Gold Premium (fictional)", packQty: "20.000000", packUom: "kg" });
  });

  it("receiving records the brand on the line and the lot (and the material label); too long is refused; other roles and sites are refused", async () => {
    const [coco] = await db.select().from(materials).where(eq(materials.code, "MAT-0012"));
    const qua = await loc(kit.nfd.id, "QUA-01");
    const line = { materialId: coco.id, qty: "2", uom: "kg", supplierLotNumber: `S4-${Date.now()}`, expiresOn: future(400), locationId: qua.id, storageConditionsConfirmed: true, containerCount: 1 };
    await expectCode(receiveAndPost(wh, { idempotencyKey: randomUUID(), supplierName: "Laguna Oleo Supply", supplierDocumentNumber: "DR-S4-0", lines: [{ ...line, brand: "z".repeat(81) }] }), "validation");
    await expectCode(receiveAndPost(sales, { idempotencyKey: randomUUID(), supplierName: "Laguna Oleo Supply", supplierDocumentNumber: "DR-S4-X", lines: [{ ...line, brand: "Isla Gold" }] }), "forbidden");
    // authz.cross_site: an RVS warehouse user cannot put stock into an NFD location.
    await expectCode(receiveAndPost(whRvs, { idempotencyKey: randomUUID(), supplierName: "Laguna Oleo Supply", supplierDocumentNumber: "DR-S4-Y", lines: [{ ...line, brand: "Isla Gold" }] }), "validation");
    const r = await receiveAndPost(wh, { idempotencyKey: randomUUID(), supplierName: "Laguna Oleo Supply", supplierDocumentNumber: "DR-S4-1", lines: [{ ...line, brand: "  Isla Gold (fictional) " }] });
    const [gl] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, r.receiptId));
    expect(gl.brand).toBe("Isla Gold (fictional)");
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, gl.lotId!));
    expect(lot.brand).toBe("Isla Gold (fictional)");
    const ds = await lotLabelEntity(wh, lot.id);
    expect(ds.entity.brand).toBe("Isla Gold (fictional)");
    // Corrections go through the audited lot edit.
    await editLotAttributes(manager, lot.id, { brand: "Isla Gold Premium (fictional)", reason: "Brand typed wrongly at receipt" });
    const [fixed] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, lot.id));
    expect(fixed.brand).toBe("Isla Gold Premium (fictional)");
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, lot.id), eq(auditEvents.action, "inventory.inventory_lot.attributes_changed")));
    expect(ev[0].before).toMatchObject({ brand: "Isla Gold (fictional)" });
    // A receipt line without a brand stays without one.
    const r2 = await receiveAndPost(wh, { idempotencyKey: randomUUID(), supplierName: "Laguna Oleo Supply", supplierDocumentNumber: "DR-S4-2", lines: [{ ...line, supplierLotNumber: `S4B-${Date.now()}` }] });
    const [gl2] = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, r2.receiptId));
    expect(gl2.brand).toBeNull();
  });
});

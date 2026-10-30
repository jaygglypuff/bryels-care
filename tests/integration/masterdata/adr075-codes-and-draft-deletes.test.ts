/**
 * ADR-075 (owner requests): the system assigns master-data codes when the code is left blank
 * (MAT-0001, PRD-0001, SUP-0001, CUS-0001, LOC-0001, EQP-0001; concurrency-safe), and a
 * never-submitted draft with no dependants can be deleted by its creator or an editor
 * (site-scoped, audited `<module>.<entity>.deleted` with the row in `before`).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, customers, formulaRevisions, formulas, materials, products, purchaseRequests, salesOrders, stockAdjustments, suppliers, warehouses } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { createAdjustment, deleteDraftAdjustment, submitAdjustment } from "@/modules/inventory";
import {
  changeMaterialStatus,
  createEquipment,
  createFormula,
  createLocation,
  createMaterialMaster,
  createProduct,
  createSupplier,
  deleteFormulaDraft,
  deleteMaterial,
  deleteProduct,
  deleteSupplier,
} from "@/modules/masterdata";
import { createPurchaseRequest, deletePurchaseRequestDraft, submitPurchaseRequest } from "@/modules/procurement";
import { createCustomer, createOrder, deleteCustomer, deleteDraftOrder } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit, loc, makeLot } from "../../support/kit";

let kit: Kit;
let owner: AuthContext;
let admin: AuthContext;
let planner: AuthContext;
let operator: AuthContext;
let procurement: AuthContext;
let sales: AuthContext;
let salesRvs: AuthContext;
let wh: AuthContext;
let wh2: AuthContext;
let whRvs: AuthContext;
let manager: AuthContext;

const deletedEvent = async (action: string, entityId: string) => (await db.select().from(auditEvents).where(and(eq(auditEvents.action, action), eq(auditEvents.entityId, entityId))))[0];
const mat = (name: string) => ({ code: "", name, materialKind: "raw_material", baseUom: "g", shelfLifeDays: "365" });
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

beforeAll(async () => {
  await resetTestDatabase();
  // Until the lead generates the merged migration, apply the stream SQL (idempotent: CREATE OR REPLACE / DROP IF EXISTS).
  for (const stmt of readFileSync(path.resolve(__dirname, "../../../src/db/sql/s3.sql"), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await db.execute(sql.raw(stmt));
  kit = await loadKit();
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  admin = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
  planner = await asUser(kit, "planner.nfd@bryels-care.test", "production_planner", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  procurement = await asUser(kit, "procurement@bryels-care.test", "procurement", [kit.nfd, kit.rvs]);
  sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd, kit.rvs]);
  salesRvs = await asUser(kit, "sales2@bryels-care.test", "sales_cs", [kit.rvs]);
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  wh2 = await asUser(kit, "warehouse2.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  whRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
}, 180_000);

describe("ADR-075 system-assigned codes", () => {
  it("a blank material code gets the next MAT-nnnn, skipping codes already typed by hand", async () => {
    const typed = await createMaterialMaster(admin, { ...mat("Hand-coded (fictional)"), code: "MAT-0001" });
    expect(typed.code).toBe("MAT-0001");
    const a = await createMaterialMaster(admin, mat("Auto A (fictional)"));
    expect(a.code).toBe("MAT-0002");
    const b = await createMaterialMaster(admin, { ...mat("Auto B (fictional)"), code: "   " });
    expect(b.code).toBe("MAT-0003");
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "masterdata.material.created"), eq(auditEvents.entityId, a.id)));
    expect(ev.after).toMatchObject({ code: "MAT-0002", codeAssigned: true });
  });

  it("two creates at the same moment get different codes", async () => {
    const [x, y, z] = await Promise.all([createMaterialMaster(admin, mat("Race X (fictional)")), createMaterialMaster(admin, mat("Race Y (fictional)")), createMaterialMaster(admin, mat("Race Z (fictional)"))]);
    const codes = new Set([x.code, y.code, z.code]);
    expect(codes.size).toBe(3);
    for (const c of codes) expect(c).toMatch(/^MAT-\d{4}$/);
  });

  it("products, suppliers, customers, locations and equipment get PRD-, SUP-, CUS-, LOC- and EQP- codes", async () => {
    const p = await createProduct(admin, { code: "", name: "Auto product (fictional)", family: "soap", unitNetMassG: "100", unitsPerBox: "48", shelfLifeDays: "730" });
    expect(p.code).toBe("PRD-0001");
    const s = await createSupplier(procurement, { code: "", name: "Auto Supplier Co (fictional)", qualityStatus: "new" });
    expect(s.code).toMatch(/^SUP-\d{4}$/); // the seed already uses SUP-0001..: those numbers are skipped
    expect(["SUP-0001", "SUP-0002"]).not.toContain(s.code);
    const c = await createCustomer(sales, { code: "", name: "Auto Customer (fictional)", minShelfLifeDays: 0, shipToAddress: "1 Test Street, Quezon City" });
    expect(c.code).toBe("CUS-0001");
    const [w] = await db.select().from(warehouses).where(eq(warehouses.siteId, kit.nfd.id));
    const l = await createLocation(admin, { warehouseId: w.id, code: "", name: "Auto rack (fictional)", kind: "storage" });
    expect(l.code).toBe("LOC-0001");
    const e = await createEquipment(admin, { siteId: kit.nfd.id, code: "", name: "Auto scale (fictional)", equipmentKind: "scale" });
    const [eq1] = await db.select({ code: auditEvents.entityNumber }).from(auditEvents).where(and(eq(auditEvents.action, "masterdata.equipment.created"), eq(auditEvents.entityId, e.equipmentId)));
    expect(eq1.code).toBe("EQP-0001");
  });

  it("a typed code is still validated and must be unique; creating still needs the create permission", async () => {
    await expectCode(createMaterialMaster(admin, { ...mat("Bad"), code: "bad code!" }), "validation");
    await expectCode(createMaterialMaster(admin, { ...mat("Dup"), code: "MAT-0001" }), "conflict");
    await expectCode(createMaterialMaster(operator, mat("No permission")), "forbidden");
    await expectCode(createSupplier(wh, { code: "", name: "Nope Co", qualityStatus: "new" }), "forbidden");
  });
});

describe("ADR-075 deleting drafts", () => {
  it("material: the creator or an editor deletes an unused one; audit has the row; others are refused", async () => {
    const m = await createMaterialMaster(admin, mat("Delete me (fictional)"));
    // The creator-only rule (create without edit) is covered by the purchase request test below.
    const other = await createMaterialMaster(planner, mat("Planner's (fictional)"));
    await expectCode(deleteMaterial(operator, m.id), "forbidden");
    await deleteMaterial(admin, m.id);
    expect(await db.select().from(materials).where(eq(materials.id, m.id))).toHaveLength(0);
    const ev = await deletedEvent("masterdata.material.deleted", m.id);
    expect(ev.before).toMatchObject({ code: m.code, name: "Delete me (fictional)" });
    // An editor may delete someone else's.
    await deleteMaterial(planner, other.id);
    await expectCode(deleteMaterial(planner, other.id), "not_found");
  });

  it("material: one that is used (lots) or blocked is never deleted", async () => {
    const [used] = await db.select().from(materials).where(eq(materials.code, "MAT-0012"));
    const e = await expectCode(deleteMaterial(planner, used.id), "state");
    expect(e.message).toMatch(/already used by .*lots/);
    const b = await createMaterialMaster(planner, mat("Blocked (fictional)"));
    await changeMaterialStatus(planner, { id: b.id, status: "blocked", reason: "Supplier problem" });
    await expectCode(deleteMaterial(planner, b.id), "state");
  });

  it("product and supplier: draft / new and unused only", async () => {
    const p = await createProduct(planner, { code: "", name: "Draft product (fictional)", family: "soap", unitNetMassG: "50", unitsPerBox: "24", shelfLifeDays: "365" });
    await expectCode(deleteProduct(operator, p.id), "forbidden");
    await deleteProduct(planner, p.id);
    expect(await db.select().from(products).where(eq(products.id, p.id))).toHaveLength(0);
    expect((await deletedEvent("masterdata.product.deleted", p.id)).before).toMatchObject({ skuCode: p.code });
    const [acs] = await db.select().from(products).where(eq(products.skuCode, "ACS-135"));
    await expectCode(deleteProduct(planner, acs.id), "state");

    const s = await createSupplier(procurement, { code: "", name: "Draft Supplier (fictional)", qualityStatus: "new" });
    await expectCode(deleteSupplier(wh, s.id), "forbidden");
    await deleteSupplier(procurement, s.id);
    expect(await db.select().from(suppliers).where(eq(suppliers.id, s.id))).toHaveLength(0);
    const approved = await createSupplier(procurement, { code: "", name: "Approved Supplier (fictional)", qualityStatus: "approved" });
    await expectCode(deleteSupplier(procurement, approved.id), "state");
  });

  it("customer: unused only, with its addresses; warehouse cannot; used customers are kept", async () => {
    const c = await createCustomer(sales, { code: "", name: "Delete Customer (fictional)", minShelfLifeDays: 0, shipToAddress: "2 Test Street, Pasig", contactName: "Test Person" });
    await expectCode(deleteCustomer(wh, c.id), "forbidden");
    await deleteCustomer(sales, c.id);
    expect(await db.select().from(customers).where(eq(customers.id, c.id))).toHaveLength(0);
    const ev = await deletedEvent("masterdata.customer.deleted", c.id);
    expect((ev.before as { code: string }).code).toBe(c.code);
    expect(ev.before).toMatchObject({ deletedChildRows: { customer_addresses: 1, customer_contacts: 1 } });
    const [used] = await db.select().from(customers).where(eq(customers.code, "CUS-001"));
    await expectCode(deleteCustomer(sales, used.id), "state");
  });

  it("formula: deleting the only draft revision removes the formula too", async () => {
    const [ahl] = await db.select().from(products).where(eq(products.skuCode, "AHL-250"));
    const f = await createFormula(planner, { productId: ahl.id, code: "F-AHL-DEL", name: "Delete trial", referenceBatchSizeG: "1000", theoreticalYieldPct: "97" });
    const [rev] = await db.select().from(formulaRevisions).where(eq(formulaRevisions.formulaId, f.formulaId));
    await expectCode(deleteFormulaDraft(operator, rev.id), "forbidden");
    const r = await deleteFormulaDraft(planner, rev.id);
    expect(r.formulaId).toBeNull();
    expect(await db.select().from(formulas).where(eq(formulas.id, f.formulaId))).toHaveLength(0);
    expect(await deletedEvent("masterdata.formula_revision.deleted", rev.id)).toBeTruthy();
    expect(await deletedEvent("masterdata.formula.deleted", f.formulaId)).toBeTruthy();
  });

  it("purchase request: site-scoped, creator or editor, never once submitted", async () => {
    const [m] = await db.select().from(materials).where(eq(materials.code, "PKG-0101"));
    const pr = await createPurchaseRequest(wh, { lines: [{ materialId: m.id, qty: "100", uom: "pcs" }], idempotencyKey: "adr075-pr-1" });
    await expectCode(deletePurchaseRequestDraft(whRvs, { requestId: pr.requestId }), "not_found"); // other site
    await expectCode(deletePurchaseRequestDraft(wh2, { requestId: pr.requestId }), "forbidden"); // not the creator, no .edit
    await deletePurchaseRequestDraft(wh, { requestId: pr.requestId });
    expect(await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, pr.requestId))).toHaveLength(0);
    const ev = await deletedEvent("procurement.purchase_request.deleted", pr.requestId);
    expect(ev.siteId).toBe(kit.nfd.id);
    expect((ev.before as { lines: unknown[] }).lines).toHaveLength(1);

    const sub = await createPurchaseRequest(wh, { lines: [{ materialId: m.id, qty: "50", uom: "pcs" }], idempotencyKey: "adr075-pr-2" });
    await submitPurchaseRequest(wh, { requestId: sub.requestId });
    await expectCode(deletePurchaseRequestDraft(procurement, { requestId: sub.requestId }), "state");
  });

  it("sales order: a draft goes with its lines; other sites cannot see it", async () => {
    const [c] = await db.select().from(customers).where(eq(customers.code, "CUS-001"));
    const [acs] = await db.select().from(products).where(eq(products.skuCode, "ACS-135"));
    const o = await createOrder(sales, { customerId: c.id, requestedDeliveryOn: inDays(10), lines: [{ productId: acs.id, qtyUnits: "12", unitPrice: "70" }] });
    const id = o.id;
    const [row] = await db.select().from(salesOrders).where(eq(salesOrders.id, id));
    if (row.siteId !== kit.rvs.id) await expectCode(deleteDraftOrder(salesRvs, id), "not_found");
    await deleteDraftOrder(sales, id);
    expect(await db.select().from(salesOrders).where(eq(salesOrders.id, id))).toHaveLength(0);
    const ev = await deletedEvent("sales.sales_order.deleted", id);
    expect((ev.before as { lines: unknown[] }).lines).toHaveLength(1);
  });

  it("stock adjustment: a draft is deleted; a submitted one is kept (cancel instead)", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const lot = await makeLot(owner, kit.nfd.id, a01.id, "500");
    const a = await createAdjustment(wh, { reasonCode: "found", lines: [{ lotId: lot.id, locationId: a01.id, direction: "increase", qty: "5" }], idempotencyKey: "adr075-adj-1" });
    await expectCode(deleteDraftAdjustment(whRvs, a.id), "not_found");
    await expectCode(deleteDraftAdjustment(wh2, a.id), "forbidden");
    await deleteDraftAdjustment(manager, a.id); // an approver may delete someone's draft
    expect(await db.select().from(stockAdjustments).where(eq(stockAdjustments.id, a.id))).toHaveLength(0);
    const b = await createAdjustment(wh, { reasonCode: "found", lines: [{ lotId: lot.id, locationId: a01.id, direction: "increase", qty: "3" }], idempotencyKey: "adr075-adj-2" });
    await submitAdjustment(wh, b.id);
    await expectCode(deleteDraftAdjustment(wh, b.id), "state");
  });
});

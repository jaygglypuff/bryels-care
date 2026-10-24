/**
 * US-1-21 units of measure and conversions (ADR-010; docs/testing.md §4.12, §9.15 S1-12):
 * uom.dimension_mismatch_rejected, uom.density_requires_material, uom.mass_to_mass_exact,
 * uom.entered_and_base_stored, second-user approval of a conversion version, the ledger reading the
 * UOM table instead of fixed factors, and the W2G custom SQL being part of the migrate path.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, materials, stockMovements, uomConversions, uoms } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { postMovement } from "@/modules/inventory/ledger";
import { createUom, decideConversion, findConversionStep, listConversions, listUoms, proposeConversion, toBaseQuantity, updateUom } from "@/modules/masterdata";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit, loc, makeLot } from "../../support/kit";
import { expectDbError } from "./helpers";
import { customMigration } from "../../support/custom-sql";

const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

let kit: Kit;
let admin: AuthContext;
let owner: AuthContext;
let manager: AuthContext;
let wh: AuthContext;
let operator: AuthContext;
const unit = async (code: string) => (await db.select().from(uoms).where(and(eq(uoms.organizationId, kit.orgId), eq(uoms.code, code))))[0];

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  admin = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
}, 180_000);

describe("W2G custom SQL is part of the normal migrate path", () => {
  it("the custom migration is a verbatim copy of src/db/sql/w2g.sql and installs the triggers", async () => {
    const { migration, canonical } = customMigration("w2g");
    expect(migration.endsWith(canonical)).toBe(true);
    const t = await db.execute<{ tgname: string }>(sql`select tgname from pg_trigger where not tgisinternal and tgname in ('tg_uom_conversions_dimension', 'tg_uom_conversions_immutable', 'tg_uoms_code_immutable', 'tg_reason_codes_code_immutable')`);
    expect(t.map((r) => r.tgname).sort()).toEqual(["tg_reason_codes_code_immutable", "tg_uom_conversions_dimension", "tg_uom_conversions_immutable", "tg_uoms_code_immutable"]);
  });
});

describe("units (US-1-21 AC3)", () => {
  it("every role reads the seeded units; one base per dimension; editing needs masterdata.uom.admin", async () => {
    const list = await listUoms(operator);
    expect(list.map((u) => u.code).sort()).toEqual(["L", "g", "kg", "mL", "mg", "pcs"].sort());
    expect(list.filter((u) => u.isBase).map((u) => u.code).sort()).toEqual(["g", "mL", "pcs"]);
    await expectCode(createUom(manager, { code: "drum", name: "drum", dimension: "count" }), "forbidden");
    await expectCode(createUom(admin, { code: "kgx", name: "x", dimension: "mass", isBase: true }), "conflict");
    await expectCode(createUom(admin, { code: "KG", name: "dupe", dimension: "mass" }), "conflict");
    const drum = await createUom(admin, { code: "drum", name: "drum (200 L)", dimension: "count" });
    expect(drum).toMatchObject({ code: "drum", isBase: false, isActive: true });
    await expectCode(updateUom(admin, (await unit("g")).id, { name: "gram", isActive: false }), "state");
    const renamed = await updateUom(admin, drum.id, { name: "steel drum", isActive: true });
    expect(renamed.name).toBe("steel drum");
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, drum.id), eq(auditEvents.action, "masterdata.uom.updated")));
    expect(ev.before).toMatchObject({ name: "drum (200 L)" });
    expect(ev.after).toMatchObject({ name: "steel drum" });
  });

  it("unit codes and dimensions are immutable in the database too (tg_uoms_code_immutable)", async () => {
    const g = await unit("g");
    await expectDbError(db.update(uoms).set({ code: "gram" }).where(eq(uoms.id, g.id)), /CODE_IMMUTABLE/);
    await expectDbError(db.update(uoms).set({ dimension: "volume" }).where(eq(uoms.id, g.id)), /CODE_IMMUTABLE/);
  });
});

describe("conversions (US-1-21 AC1, AC3)", () => {
  it("uom.dimension_mismatch_rejected: g → mL without a material is a 422 UOM_DIMENSION_MISMATCH from the service and the trigger", async () => {
    const [g, mL] = [await unit("g"), await unit("mL")];
    const e = await expectCode(proposeConversion(admin, { fromUomId: g.id, toUomId: mL.id, factor: "1.1" }), "validation");
    expect(e.message).toContain("UOM_DIMENSION_MISMATCH");
    expect(e.details).toMatchObject({ reason: "UOM_DIMENSION_MISMATCH", field: "materialId" });
    await expectDbError(db.insert(uomConversions).values({ organizationId: kit.orgId, fromUomId: g.id, toUomId: mL.id, factor: "1.1" }), /UOM_DIMENSION_MISMATCH/);
  });

  it("uom.density_requires_material: g → mL with a material saves as a versioned, material-specific row; approval needs a second user", async () => {
    const [g, mL] = [await unit("g"), await unit("mL")];
    const [glycerin] = await db.select().from(materials).where(eq(materials.code, "MAT-0061"));
    const proposed = await proposeConversion(admin, { fromUomId: mL.id, toUomId: g.id, factor: "1.26", materialId: glycerin.id, reason: "Density from supplier spec (fictional)" });
    expect(proposed).toMatchObject({ status: "pending_approval", revisionNo: 1, materialId: glycerin.id });
    // Not usable before approval.
    expect(await findConversionStep(db, kit.orgId, "mL", "g", glycerin.id)).toBeNull();
    await expectCode(decideConversion(admin, { id: proposed.id, decision: "approved" }), "separation_of_duties");
    await expectCode(decideConversion(manager, { id: proposed.id, decision: "approved" }), "forbidden");
    const approved = await decideConversion(owner, { id: proposed.id, decision: "approved", note: "Checked against the spec sheet" });
    expect(approved.status).toBe("approved");
    expect(await findConversionStep(db, kit.orgId, "mL", "g", glycerin.id)).toEqual({ factor: "1.260000000000", direction: "forward" });
    // A generic (material-less) lookup still refuses mL → g.
    expect(await findConversionStep(db, kit.orgId, "mL", "g", null)).toBeNull();
    // Version 2 replaces version 1 on approval; the audit row carries the before/after factor.
    const v2 = await proposeConversion(admin, { fromUomId: mL.id, toUomId: g.id, factor: "1.261", materialId: glycerin.id, reason: "Updated spec" });
    await expectCode(proposeConversion(admin, { fromUomId: mL.id, toUomId: g.id, factor: "1.262", materialId: glycerin.id }), "conflict");
    await expectCode(proposeConversion(admin, { fromUomId: g.id, toUomId: mL.id, factor: "0.79", materialId: glycerin.id }), "conflict");
    await decideConversion(owner, { id: v2.id, decision: "approved" });
    const rows = (await listConversions(wh)).filter((r) => r.materialId === glycerin.id);
    expect(rows.map((r) => [r.revisionNo, r.status])).toEqual([
      [2, "approved"],
      [1, "retired"],
    ]);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, v2.id), eq(auditEvents.action, "masterdata.uom_conversion.approved")));
    expect(ev.before).toMatchObject({ factor: "1.260000000000" });
    expect(ev.after).toMatchObject({ factor: "1.261000000000", status: "approved" });
    // A decided version is immutable (tg_uom_conversions_immutable).
    await expectDbError(db.update(uomConversions).set({ factor: "2" }).where(eq(uomConversions.id, v2.id)), /UOM_CONVERSION_IMMUTABLE/);
    // Rejecting needs a reason.
    const v3 = await proposeConversion(admin, { fromUomId: mL.id, toUomId: g.id, factor: "1.3", materialId: glycerin.id });
    await expectCode(decideConversion(owner, { id: v3.id, decision: "rejected" }), "validation");
    expect((await decideConversion(owner, { id: v3.id, decision: "rejected", note: "Typo" })).status).toBe("rejected");
  });

  it("g → kg saves without a material (same dimension); a non-positive factor is refused", async () => {
    const [g, kg] = [await unit("g"), await unit("kg")];
    await expectCode(proposeConversion(admin, { fromUomId: kg.id, toUomId: g.id, factor: "0" }), "validation");
    // kg → g is the installed reference conversion; changing it to the same factor is refused, the inverse pair is refused.
    await expectCode(proposeConversion(admin, { fromUomId: kg.id, toUomId: g.id, factor: "1000" }), "validation");
    await expectCode(proposeConversion(admin, { fromUomId: g.id, toUomId: kg.id, factor: "0.001" }), "conflict");
    const pcs = await unit("pcs");
    const drum = await unit("drum");
    const p = await proposeConversion(admin, { fromUomId: drum.id, toUomId: pcs.id, factor: "1" });
    expect(p.status).toBe("pending_approval");
  });

  it("concurrency: two simultaneous proposals for the same new pair → one pending version, one 409", async () => {
    const [mg, kg] = [await unit("mg"), await unit("kg")];
    const results = await Promise.allSettled([proposeConversion(admin, { fromUomId: kg.id, toUomId: mg.id, factor: "1000000" }), proposeConversion(owner, { fromUomId: kg.id, toUomId: mg.id, factor: "1000000" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "conflict" });
    const rows = await db.select().from(uomConversions).where(and(eq(uomConversions.fromUomId, kg.id), eq(uomConversions.toUomId, mg.id)));
    expect(rows).toHaveLength(1);
  });
});

describe("quantity helper (US-1-21 AC2)", () => {
  it("uom.mass_to_mass_exact: kg → g → kg round trip of 0.1 is exact; entered and base are both returned", async () => {
    const toG = await toBaseQuantity(db, kit.orgId, { qty: "0.1", uom: "kg" }, "g");
    expect(toG).toEqual({ entered: { qty: "0.1", uom: "kg" }, base: { qty: "100", uom: "g" } });
    const back = await toBaseQuantity(db, kit.orgId, { qty: toG.base.qty, uom: "g" }, "kg");
    expect(back.base).toEqual({ qty: "0.1", uom: "kg" });
    expect((await toBaseQuantity(db, kit.orgId, { qty: "2.5", uom: "kg" }, "g")).base.qty).toBe("2500");
    await expectCode(toBaseQuantity(db, kit.orgId, { qty: "1", uom: "mL" }, "g"), "validation");
  });
});

describe("ledger reads the UOM table (ADR-010, V-UOM)", () => {
  it("uom.entered_and_base_stored: 2.5 kg posts as 2500 g with both stored; a mismatch and an unconfigured unit are refused", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const a02 = await loc(kit.nfd.id, "A-02");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "5000");
    const { movement } = await db.transaction((tx) => postMovement(tx, wh, { movementType: "transfer", lotId: lot.id, fromLocationId: a01.id, toLocationId: a02.id, qtyBase: "2500", entered: { qty: "2.5", uom: "kg" }, sourceDocumentType: "test" }));
    const [m] = await db.select().from(stockMovements).where(eq(stockMovements.id, movement.id));
    expect([m.qtyEntered, m.enteredUom, m.qtyBase, m.baseUom]).toEqual(["2.500000", "kg", "2500.000000", "g"]);
    await expectCode(db.transaction((tx) => postMovement(tx, wh, { movementType: "transfer", lotId: lot.id, fromLocationId: a02.id, toLocationId: a01.id, qtyBase: "100", entered: { qty: "1", uom: "kg" }, sourceDocumentType: "test" })), "validation");
    await expectCode(db.transaction((tx) => postMovement(tx, wh, { movementType: "transfer", lotId: lot.id, fromLocationId: a02.id, toLocationId: a01.id, qtyBase: "100", entered: { qty: "100", uom: "mL" }, sourceDocumentType: "test" })), "validation");
    // mg (reference row mg → g = 0.001) still works as with the old fixed factors.
    await db.transaction((tx) => postMovement(tx, wh, { movementType: "transfer", lotId: lot.id, fromLocationId: a02.id, toLocationId: a01.id, qtyBase: "1", entered: { qty: "1000", uom: "mg" }, sourceDocumentType: "test" }));
  });

  it("a material-specific approved conversion (density) applies to that material's lots only", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const b01 = await loc(kit.nfd.id, "B-01");
    const glycerinLot = await makeLot(wh, kit.nfd.id, a01.id, "1261", { materialCode: "MAT-0061" });
    await db.transaction((tx) => postMovement(tx, wh, { movementType: "transfer", lotId: glycerinLot.id, fromLocationId: a01.id, toLocationId: b01.id, qtyBase: "1261", entered: { qty: "1000", uom: "mL" }, sourceDocumentType: "test" }));
    const coconutLot = await makeLot(wh, kit.nfd.id, a01.id, "1261");
    await expectCode(db.transaction((tx) => postMovement(tx, wh, { movementType: "transfer", lotId: coconutLot.id, fromLocationId: a01.id, toLocationId: b01.id, qtyBase: "1261", entered: { qty: "1000", uom: "mL" }, sourceDocumentType: "test" })), "validation");
  });
});

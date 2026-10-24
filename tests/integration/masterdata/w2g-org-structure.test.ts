/**
 * US-1-20 organization structure: sites, departments, warehouses with special locations,
 * locations (class/status rules, organization-unique codes, deactivation), production lines and
 * the link to the W1D equipment register. Negative tests: authz.cross_site.* (masterdata.location),
 * role escalation on every admin command.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, equipment, sites } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { postMovement } from "@/modules/inventory/ledger";
import {
  assignEquipmentToLine,
  changeEquipmentBlockingRule,
  changeLineStatus,
  changeLocationStatus,
  createDepartment,
  createLine,
  createLocation,
  createSite,
  createWarehouse,
  designateSpecialLocation,
  getLine,
  getLocation,
  getWarehouse,
  listLines,
  listLocations,
  listSites,
  listWarehouses,
  setSiteActive,
  setWarehouseActive,
  updateDepartment,
  updateLocation,
  updateSite,
} from "@/modules/masterdata";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, type Kit, loadKit, loc, makeLot } from "../../support/kit";

let kit: Kit;
let admin: AuthContext;
let manager: AuthContext;
let managerRvs: AuthContext;
let wh: AuthContext;
let auditor: AuthContext;
let operator: AuthContext;

const events = (entityId: string, action: string) => db.select().from(auditEvents).where(and(eq(auditEvents.entityId, entityId), eq(auditEvents.action, action)));

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  admin = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  managerRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "site_manager", [kit.rvs]);
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  auditor = await asUser(kit, "auditor@bryels-care.test", "auditor", [kit.nfd, kit.rvs]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
}, 180_000);

describe("sites (US-1-20 AC2)", () => {
  it("site code matches ^[A-Z0-9]{1,6}$, timezone defaults to the organization's, masterdata.site.changed records before/after", async () => {
    await expectCode(createSite(admin, { code: "TOOLONG1", name: "X" }), "validation");
    await expectCode(createSite(admin, { code: "A-1", name: "X" }), "validation");
    await expectCode(createSite(admin, { code: "NFD", name: "Dupe" }), "conflict");
    await expectCode(createSite(admin, { code: "BAT", name: "Bad tz", timezone: "Mars/Olympus" }), "validation");
    await expectCode(createSite(manager, { code: "BAT", name: "Batangas" }), "forbidden");
    const s = await createSite(admin, { code: "bat", name: "Batangas Annex (fictional)" });
    expect(s).toMatchObject({ code: "BAT", timezone: "Asia/Manila", country: "PH", isActive: true });
    // The new site is not in this context yet (assignments refresh on the next request); edits use a fresh context.
    const admin2 = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs, { id: s.id, code: s.code, name: s.name }]);
    const u = await updateSite(admin2, s.id, { code: "BTG", name: "Batangas Annex (fictional)", city: "Lipa" });
    expect(u.code).toBe("BTG");
    const [ev] = await events(s.id, "masterdata.site.changed");
    expect(ev.before).toMatchObject({ code: "BAT", city: null });
    expect(ev.after).toMatchObject({ code: "BTG", city: "Lipa" });
    // A site in use keeps its code.
    await expectCode(updateSite(admin, kit.nfd.id, { code: "NFX", name: "North Fields Plant" }), "state");
    // Every role sees all sites by name.
    expect((await listSites(operator)).map((x) => x.code)).toEqual(expect.arrayContaining(["NFD", "RVS", "BTG"]));
    // Deactivate (never delete); reason required; a site with stock cannot be deactivated.
    await expectCode(setSiteActive(admin2, { siteId: s.id, active: false, reason: "" }), "validation");
    await expectCode(setSiteActive(admin, { siteId: kit.nfd.id, active: false, reason: "Closing the plant" }), "state");
    const off = await setSiteActive(admin2, { siteId: s.id, active: false, reason: "Annex not opening this year" });
    expect(off.isActive).toBe(false);
    expect(await events(s.id, "masterdata.site.deactivated")).toHaveLength(1);
    const [row] = await db.select().from(sites).where(eq(sites.id, s.id));
    expect(row).toBeTruthy();
  });
});

describe("departments, warehouses and special locations (US-1-20 AC1)", () => {
  it("a new warehouse lists every special location as missing; designation is audited per role and the list shrinks", async () => {
    await expectCode(createWarehouse(manager, { siteId: kit.nfd.id, code: "WH2", name: "Packaging store", warehouseKind: "packaging" }), "forbidden");
    await expectCode(createWarehouse(admin, { siteId: "00000000-0000-4000-8000-000000000000", code: "WH9", name: "Ghost", warehouseKind: "general" }), "not_found");
    const w = await createWarehouse(admin, { siteId: kit.nfd.id, code: "WH2", name: "Packaging store", warehouseKind: "packaging" });
    expect(w.missing).toEqual(["receiving", "staging", "quarantine", "hold", "rejected", "recall"]);
    const rcv = await createLocation(admin, { warehouseId: w.id, code: "NFD-W2-RCV", name: "WH2 receiving", kind: "receiving" });
    const bin = await createLocation(admin, { warehouseId: w.id, code: "NFD-W2-A1", name: "Bin A1", kind: "storage" });
    // Kind must match the role; location must be in the warehouse.
    await expectCode(designateSpecialLocation(admin, { warehouseId: w.id, role: "receiving", locationId: bin.id }), "validation");
    const other = await loc(kit.nfd.id, "RCV");
    await expectCode(designateSpecialLocation(admin, { warehouseId: w.id, role: "receiving", locationId: other.id }), "validation");
    await expectCode(designateSpecialLocation(manager, { warehouseId: w.id, role: "receiving", locationId: rcv.id }), "forbidden");
    const r = await designateSpecialLocation(admin, { warehouseId: w.id, role: "receiving", locationId: rcv.id });
    expect(r.missing).toEqual(["staging", "quarantine", "hold", "rejected", "recall"]);
    const [ev] = await events(rcv.id, "masterdata.location.special_designated");
    expect(ev.after).toMatchObject({ role: "receiving", locationCode: "NFD-W2-RCV", warehouseCode: "WH2" });
    const detail = await getWarehouse(manager, w.id);
    expect(detail.designations.map((d) => d.role)).toEqual(["receiving"]);
    // The seeded NFD warehouse is missing staging and recall.
    const list = await listWarehouses(manager);
    expect(list.find((x) => x.code === "WH1")!.missing).toEqual(["staging", "recall"]);
  });

  it("departments are site-scoped; a department with an active line cannot be deactivated", async () => {
    await expectCode(createDepartment(manager, { siteId: kit.nfd.id, code: "MNT", name: "Maintenance" }), "forbidden");
    await expectCode(createDepartment(admin, { siteId: kit.nfd.id, code: "PROD", name: "Duplicate" }), "conflict");
    const d = await createDepartment(admin, { siteId: kit.nfd.id, code: "MNT", name: "Maintenance" });
    const line = await createLine(admin, { siteId: kit.nfd.id, code: "FILL-1", name: "Filling line", departmentId: d.id });
    await expectCode(updateDepartment(admin, d.id, { code: "MNT", name: "Maintenance", isActive: false }), "state");
    await changeLineStatus(admin, { lineId: line.id, status: "inactive", reason: "Line moved to RVS" });
    const off = await updateDepartment(admin, d.id, { code: "MNT", name: "Maintenance", isActive: false });
    expect(off.isActive).toBe(false);
    expect(await events(d.id, "masterdata.department.deactivated")).toHaveLength(1);
  });
});

describe("locations (US-1-20 AC1–AC3)", () => {
  it("authz.cross_site.location: a site manager at NFD asking for RVS sees only NFD rows; RVS detail is not found", async () => {
    const rows = await listLocations(manager, { siteId: kit.rvs.id });
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.siteId))).toEqual(new Set([kit.nfd.id]));
    const rvsRcv = await loc(kit.rvs.id, "RCV");
    await expectCode(getLocation(manager, rvsRcv.id), "not_found");
    const rvsWh = (await listWarehouses(managerRvs))[0];
    await expectCode(createLocation(manager, { warehouseId: rvsWh.id, code: "RVS-X1", name: "Sneaky", kind: "storage" }), "not_found");
    await expectCode(changeLocationStatus(manager, { locationId: rvsRcv.id, status: "blocked", reason: "cross-site attempt" }), "not_found");
  });

  it("codes are scan-safe and organization-unique for new locations; the tree rejects cycles and other warehouses", async () => {
    const wh1 = (await listWarehouses(manager)).find((w) => w.code === "WH1")!;
    await expectCode(createLocation(manager, { warehouseId: wh1.id, code: "bad code!", name: "x", kind: "storage" }), "validation");
    // FG-01 exists at RVS: a new NFD location may not reuse it.
    await expectCode(createLocation(manager, { warehouseId: wh1.id, code: "FG-01", name: "dupe", kind: "storage" }), "conflict");
    await expectCode(createLocation(auditor, { warehouseId: wh1.id, code: "Z-01", name: "Zone Z", kind: "storage" }), "forbidden");
    const zone = await createLocation(manager, { warehouseId: wh1.id, code: "Z-01", name: "Zone Z", kind: "storage" });
    const rack = await createLocation(wh, { warehouseId: wh1.id, code: "Z-01-R1", name: "Rack 1", kind: "storage", parentLocationId: zone.id });
    expect(rack.parentLocationId).toBe(zone.id);
    await expectCode(updateLocation(wh, rack.id, { code: "Z-01-R1", name: "Rack 1", kind: "storage" }), "forbidden");
    await expectCode(updateLocation(manager, zone.id, { code: "Z-01", name: "Zone Z", kind: "storage", parentLocationId: rack.id }), "validation");
    const w2 = (await listWarehouses(manager)).find((w) => w.code === "WH2")!;
    await expectCode(createLocation(manager, { warehouseId: w2.id, code: "NFD-W2-B1", name: "x", kind: "storage", parentLocationId: zone.id }), "validation");
    const renamed = await updateLocation(manager, rack.id, { code: "Z-01-RACK1", name: "Rack one", kind: "storage", parentLocationId: zone.id });
    expect(renamed.code).toBe("Z-01-RACK1");
    const [ev] = await events(rack.id, "masterdata.location.updated");
    expect(ev.before).toMatchObject({ code: "Z-01-R1", name: "Rack 1" });
  });

  it("concurrency: the same new location code created at two sites at once → exactly one succeeds", async () => {
    const nfdWh = (await listWarehouses(admin, { siteId: kit.nfd.id })).find((w) => w.code === "WH1")!;
    const rvsWh = (await listWarehouses(admin, { siteId: kit.rvs.id }))[0];
    const results = await Promise.allSettled([
      createLocation(admin, { warehouseId: nfdWh.id, code: "RACE-01", name: "Race NFD", kind: "storage" }),
      createLocation(admin, { warehouseId: rvsWh.id, code: "RACE-01", name: "Race RVS", kind: "storage" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "conflict" });
  });

  it("a blocked location takes no movement in or out (ledger); a location holding stock cannot be deactivated or change class or code", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const zone = (await listLocations(manager, { q: "Z-01" })).find((l) => l.code === "Z-01")!;
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "100");
    await db.transaction((tx) => postMovement(tx, wh, { movementType: "transfer", lotId: lot.id, fromLocationId: a01.id, toLocationId: zone.id, qtyBase: "40", sourceDocumentType: "test" }));
    await expectCode(changeLocationStatus(wh, { locationId: zone.id, status: "blocked", reason: "Spill being cleaned" }), "forbidden");
    await changeLocationStatus(manager, { locationId: zone.id, status: "blocked", reason: "Spill being cleaned" });
    await expectCode(db.transaction((tx) => postMovement(tx, wh, { movementType: "transfer", lotId: lot.id, fromLocationId: a01.id, toLocationId: zone.id, qtyBase: "1", sourceDocumentType: "test" })), "state");
    await expectCode(db.transaction((tx) => postMovement(tx, wh, { movementType: "transfer", lotId: lot.id, fromLocationId: zone.id, toLocationId: a01.id, qtyBase: "1", sourceDocumentType: "test" })), "state");
    expect(await events(zone.id, "masterdata.location.blocked")).toHaveLength(1);
    // Deactivation needs masterdata.location.admin and an empty location.
    await expectCode(changeLocationStatus(manager, { locationId: zone.id, status: "inactive", reason: "Zone closed" }), "forbidden");
    await expectCode(changeLocationStatus(admin, { locationId: zone.id, status: "inactive", reason: "Zone closed" }), "state");
    await expectCode(updateLocation(manager, zone.id, { code: "Z-01", name: "Zone Z", kind: "quarantine" }), "state");
    await expectCode(updateLocation(manager, zone.id, { code: "Z-02", name: "Zone Z", kind: "storage" }), "state");
    await changeLocationStatus(manager, { locationId: zone.id, status: "active", reason: "Spill cleaned" });
    await db.transaction((tx) => postMovement(tx, wh, { movementType: "transfer", lotId: lot.id, fromLocationId: zone.id, toLocationId: a01.id, qtyBase: "40", sourceDocumentType: "test" }));
    // Still has an active child (the rack) → refused until the child is inactive.
    await expectCode(changeLocationStatus(admin, { locationId: zone.id, status: "inactive", reason: "Zone closed" }), "state");
    const rack = (await listLocations(manager, { q: "Z-01-RACK1" }))[0];
    await changeLocationStatus(admin, { locationId: rack.id, status: "inactive", reason: "Zone closed" });
    const off = await changeLocationStatus(admin, { locationId: zone.id, status: "inactive", reason: "Zone closed" });
    expect(off).toMatchObject({ status: "inactive", isActive: false });
    expect(await events(zone.id, "masterdata.location.deactivated")).toHaveLength(1);
    expect((await listLocations(manager, { q: "Z-01" })).length).toBe(0);
    expect((await listLocations(manager, { q: "Z-01", includeInactive: true })).length).toBe(2);
    // A designated special location cannot be deactivated.
    const hld = await loc(kit.nfd.id, "HLD-01");
    await expectCode(changeLocationStatus(admin, { locationId: hld.id, status: "inactive", reason: "Moving the cage" }), "state");
  });

  it("a warehouse is deactivated only after its locations", async () => {
    const w2 = (await listWarehouses(admin)).find((w) => w.code === "WH2")!;
    await expectCode(setWarehouseActive(admin, { warehouseId: w2.id, active: false, reason: "Store merged" }), "state");
  });
});

describe("production lines and the equipment register (US-1-20 AC3)", () => {
  it("lines are site-scoped; equipment is assigned to a line of its site; blocking_rule changes are audited", async () => {
    await expectCode(createLine(manager, { siteId: kit.nfd.id, code: "SOAP-2", name: "Soap line 2" }), "forbidden");
    const rvsDept = (await import("@/modules/masterdata")).listDepartments;
    const [rvsWhDept] = await rvsDept(admin, { siteId: kit.rvs.id });
    await expectCode(createLine(admin, { siteId: kit.nfd.id, code: "SOAP-2", name: "Soap line 2", departmentId: rvsWhDept.id }), "validation");
    const line = await createLine(admin, { siteId: kit.nfd.id, code: "SOAP-2", name: "Soap line 2" });
    const seeded = (await listLines(manager)).find((l) => l.code === "SOAP-1")!;
    expect(seeded.equipmentCount).toBeGreaterThanOrEqual(3);
    const detail = await getLine(manager, seeded.id);
    expect(detail.equipment.map((e) => e.code)).toEqual(expect.arrayContaining(["MIX-01", "MLD-01"]));
    const [mix] = await db.select().from(equipment).where(eq(equipment.code, "MIX-01"));
    await expectCode(assignEquipmentToLine(operator, { equipmentId: mix.id, productionLineId: line.id }), "forbidden");
    const moved = await assignEquipmentToLine(manager, { equipmentId: mix.id, productionLineId: line.id });
    expect(moved).toMatchObject({ productionLineId: line.id, lineLabel: "Soap line 2" });
    expect(await events(mix.id, "masterdata.equipment.line_assigned")).toHaveLength(1);
    // Cross-site: an RVS manager cannot touch NFD equipment or lines.
    await expectCode(assignEquipmentToLine(managerRvs, { equipmentId: mix.id, productionLineId: null }), "not_found");
    await expectCode(getLine(managerRvs, line.id), "not_found");
    // Blocking rule: relaxing needs a reason; audited before/after.
    await expectCode(changeEquipmentBlockingRule(manager, { equipmentId: mix.id, blockingRule: "warn" }), "validation");
    await changeEquipmentBlockingRule(manager, { equipmentId: mix.id, blockingRule: "warn", reason: "Mixer used for trials only this week" });
    const [ev] = await events(mix.id, "masterdata.equipment.blocking_rule_changed");
    expect(ev.before).toMatchObject({ blockingRule: "block" });
    expect(ev.after).toMatchObject({ blockingRule: "warn" });
    // Line status machine: inactive → down is not a transition.
    await changeLineStatus(admin, { lineId: line.id, status: "inactive", reason: "Not commissioned" });
    await expectCode(changeLineStatus(admin, { lineId: line.id, status: "down", reason: "x" }), "state");
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, locations } from "@/db/schema";
import { sectionForItem, sectionOf } from "@/lib/location-sections";
import { receivingFormData } from "@/modules/inventory/receiving";
import { putAwayOptions } from "@/modules/inventory/receiving-putaway";
import { sectionSummary, stockBySection } from "@/modules/inventory/sections";
import { createLocation, listLocations, updateLocation } from "@/modules/masterdata";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, makeLot, type Kit } from "../../support/kit";

/** S6 (ADR-077): warehouse sections on locations; stock grouped by section; receiving suggests the section. */

let kit: Kit;
beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
});

describe("S6 warehouse sections", () => {
  it("derives a section from the class and warehouse kind when none is set", () => {
    expect(sectionOf({ section: "returns", kind: "quarantine" })).toBe("returns");
    expect(sectionOf({ section: null, kind: "quarantine" })).toBe("qa_hold");
    expect(sectionOf({ section: null, kind: "hold" })).toBe("qa_hold");
    expect(sectionOf({ section: null, kind: "staging" })).toBe("production");
    expect(sectionOf({ section: null, kind: "storage" }, "packaging")).toBe("packaging");
    expect(sectionOf({ section: null, kind: "storage" }, "general")).toBe("other");
    expect(sectionOf({ section: "bogus", kind: "receiving" })).toBe("other");
    expect(sectionForItem({ itemKind: "material", materialKind: "raw_material" })).toBe("raw_materials");
    expect(sectionForItem({ itemKind: "material", materialKind: "packaging" })).toBe("packaging");
    expect(sectionForItem({ itemKind: "product" })).toBe("finished_goods");
  });

  it("groups stock at the current site by section, with tiles that count lots", async () => {
    const wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
    const a01 = await loc(kit.nfd.id, "A-01");
    const fg = await loc(kit.nfd.id, "FG-01");
    const lot = await makeLot(wh, kit.nfd.id, a01.id, "1000");
    const tiles = await sectionSummary(wh);
    expect(tiles.map((t) => t.section)).toEqual(["raw_materials", "packaging", "finished_goods", "qa_hold", "returns", "production", "other"]);
    const raw = tiles.find((t) => t.section === "raw_materials")!;
    expect(raw.label).toBe("Raw materials");
    expect(raw.lots).toBeGreaterThanOrEqual(1);
    expect(raw.locations).toBeGreaterThanOrEqual(3); // A-01, A-02, B-01

    const groups = await stockBySection(wh);
    const rawGroup = groups.find((g) => g.section === "raw_materials")!;
    expect(rawGroup.rows.some((r) => r.lotId === lot.id && Number(r.onHand) === 1000 && r.locationCodes === "A-01")).toBe(true);
    expect(rawGroup.rows.length).toBe(raw.lots);
    // A lot in two sections is listed under both with the quantity of each section.
    await makeLot(wh, kit.nfd.id, fg.id, "1"); // a different lot in finished goods
    const only = await stockBySection(wh, { section: "finished_goods" });
    expect(only.map((g) => g.section)).toEqual(["finished_goods"]);
    // Search narrows inside the groups.
    const q = await stockBySection(wh, { q: lot.lotNumber });
    expect(q.flatMap((g) => g.rows).map((r) => r.lotId)).toEqual([lot.id]);
  });

  it("is scoped to the caller's current site and needs inventory.lot.view", async () => {
    const nfdWh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
    const nfdLot = await makeLot(nfdWh, kit.nfd.id, (await loc(kit.nfd.id, "A-02")).id, "5");
    const rvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
    const rows = (await stockBySection(rvs)).flatMap((g) => g.rows);
    expect(rows.some((r) => r.lotId === nfdLot.id)).toBe(false);
    // Asking for an NFD location id from RVS returns nothing (no leak).
    expect((await stockBySection(rvs, { locationId: (await loc(kit.nfd.id, "A-02")).id })).length).toBe(0);
    const noPerm = await asUser(kit, "sales@bryels-care.test", ["masterdata.customer.view"], [kit.nfd]);
    await expectCode(sectionSummary(noPerm), "forbidden");
    await expectCode(stockBySection(noPerm), "forbidden");
  });

  it("master data sets, keeps and audits a location's section; bad values are refused", async () => {
    const admin = await asUser(kit, "admin@bryels-care.test", "system_admin", [kit.nfd, kit.rvs]);
    const ret = await loc(kit.nfd.id, "RET-01");
    expect(ret.section).toBe("returns");
    const [wh] = await db.select({ id: locations.warehouseId }).from(locations).where(eq(locations.id, ret.id));
    const l = await createLocation(admin, { warehouseId: wh.id, code: "S6-PKG-02", name: "Packaging shelf 2 (fictional)", kind: "storage", section: "packaging" });
    expect(l.section).toBe("packaging");
    // An edit that does not send the section keeps it.
    const kept = await updateLocation(admin, l.id, { code: l.code, name: "Packaging shelf two", kind: "storage" });
    expect(kept.section).toBe("packaging");
    const moved = await updateLocation(admin, l.id, { code: l.code, name: kept.name, kind: "storage", section: "finished_goods" });
    expect(moved.section).toBe("finished_goods");
    const cleared = await updateLocation(admin, l.id, { code: l.code, name: kept.name, kind: "storage", section: "" });
    expect(cleared.section).toBeNull();
    await expectCode(updateLocation(admin, l.id, { code: l.code, name: kept.name, kind: "storage", section: "basement" }), "validation");
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, l.id), eq(auditEvents.action, "masterdata.location.updated")));
    expect(ev.length).toBe(3);
    const listed = (await listLocations(admin, { siteId: kit.nfd.id })).find((x) => x.id === l.id)!;
    expect(listed.effectiveSection).toBe("other"); // cleared: storage in a general warehouse
    // Another site's manager cannot edit it.
    const rvsMgr = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.rvs]);
    await expectCode(updateLocation(rvsMgr, l.id, { code: l.code, name: "x name", kind: "storage", section: "packaging" }), "not_found");
  });

  it("receiving and put-away suggest the section the item belongs in", async () => {
    const wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
    const form = await receivingFormData(wh);
    const pkg = form.materials.find((m) => m.materialKind === "packaging");
    const raw = form.materials.find((m) => m.materialKind === "raw_material")!;
    expect(raw.section).toBe("raw_materials");
    if (pkg) expect(pkg.section).toBe("packaging");
    expect(form.storageBySection.raw_materials).toEqual(expect.arrayContaining(["A-01", "A-02", "B-01"]));
    expect(form.locations.find((l) => l.code === "QUA-01")?.section).toBe("qa_hold");

    const lot = await makeLot(wh, kit.nfd.id, (await loc(kit.nfd.id, "RCV")).id, "10");
    const opts = await putAwayOptions(wh, lot.id);
    expect(opts.suggestedSection).toBe("raw_materials");
    expect(opts.suggestedSectionLabel).toBe("Raw materials");
    expect(opts.suggestedCodes).toEqual(expect.arrayContaining(["A-01", "A-02", "B-01"]));
    expect(opts.destinations[0].section).toBe("raw_materials");
  });
});

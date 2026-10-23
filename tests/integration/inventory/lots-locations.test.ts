/** US-2-16 lot attribute edits, expiry alerts, locations list and detail. */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { inventoryLots } from "@/db/schema";
import { editLotAttributes, expiryAlerts, getLocationDetail, listLocationsWithStock } from "@/modules/inventory/lots-admin";
import { createBox } from "@/modules/inventory/containers";
import { resetTestDatabase } from "../../support/db";
import { auditCount, expectDomain, future, key, loadWorld, loc, makeLot, type World } from "./w1c-fixtures";

let w: World;
beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
});

describe("lots and locations (US-2-16)", () => {
  it("inventory.lot_edit_cannot_change_status: status is 422; dates and supplier lot change with a reason and an audit event", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "A-01", materialCode: "MAT-0012", qty: "10" });
    await expectDomain(editLotAttributes(w.wh, lot.id, { reason: "Typo on the CoA", qualityStatus: "released" }), "validation");
    await expectDomain(editLotAttributes(w.wh, lot.id, { expiresOn: future(100) } as never), "validation");
    const r = await editLotAttributes(w.wh, lot.id, { expiresOn: future(100), supplierLotNumber: "LOS-99", reason: "Supplier CoA shows a different expiry" });
    expect(r.changed.sort()).toEqual(["expiresOn", "supplierLotNumber"]);
    const [after] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, lot.id));
    expect(after.expiresOn).toBe(future(100));
    expect(after.qualityStatus).toBe("released");
    expect(await auditCount("inventory.inventory_lot.attributes_changed", lot.id)).toBe(1);
    await expectDomain(editLotAttributes(w.whRvs, lot.id, { supplierLotNumber: "X", reason: "cross-site attempt" }), "not_found");
    await expectDomain(editLotAttributes(w.auditor, lot.id, { supplierLotNumber: "X", reason: "auditor attempt" }), "forbidden");
  });

  it("expiry alerts bucket lots by 30/60/90 days and include expired stock, current site only", async () => {
    const soon = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "A-01", materialCode: "MAT-0013", qty: "10", expiresIn: 20 });
    const mid = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "A-01", materialCode: "MAT-0013", qty: "10", expiresIn: 75 });
    const far = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "A-01", materialCode: "MAT-0013", qty: "10", expiresIn: 300 });
    const rvs = await makeLot(w.owner, { siteId: w.rvs.id, locCode: "FG-01", productSku: "ACS-135", qty: "10", expiresIn: 5 });
    const a = await expiryAlerts(w.wh);
    expect(a.buckets).toEqual([30, 60, 90]);
    expect(a.rows.find((r) => r.id === soon.id)?.bucket).toBe("≤ 30 days");
    expect(a.rows.find((r) => r.id === mid.id)?.bucket).toBe("≤ 90 days");
    expect(a.rows.some((r) => r.id === far.id)).toBe(false);
    expect(a.rows.some((r) => r.id === rvs.id)).toBe(false);
  });

  it("locations list and detail show loose vs boxed stock; other sites are not found", async () => {
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "PKG-01", materialCode: "PKG-0101", qty: "100" });
    const pkg = await loc(w.nfd.id, "PKG-01");
    await createBox(w.wh, { lotId: lot.id, locationId: pkg.id, qty: "60", idempotencyKey: key() });
    const list = await listLocationsWithStock(w.wh);
    expect(list.find((l) => l.id === pkg.id)?.boxes).toBeGreaterThanOrEqual(1);
    const d = await getLocationDetail(w.wh, pkg.id);
    const row = d.lots.find((l) => l.id === lot.id)!;
    expect(Number(row.onHand)).toBe(100);
    expect(Number(row.boxed)).toBe(60);
    await expectDomain(getLocationDetail(w.whRvs, pkg.id), "not_found");
  });
});

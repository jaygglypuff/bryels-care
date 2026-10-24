import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, containers, dispositions, inventoryBalances, inventoryLots, labelVerifications } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { applyBulkDisposition, bulkDispositionCandidates, labelVerificationLocations, labelVerificationZone, verifyLabelScan } from "@/modules/quality";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, makeLot, type Kit } from "../../support/kit";
import { customMigration } from "../../support/custom-sql";

let kit: Kit;
let manager: AuthContext;
let qa: AuthContext;
let owner: AuthContext;
let warehouse: AuthContext;
let warehouseRvs: AuthContext;

const root = path.resolve(__dirname, "../../..");

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd, kit.rvs]);
  owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  warehouse = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  warehouseRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
}, 180_000);

describe("W2C custom SQL", () => {
  it("the custom migration is a verbatim copy of src/db/sql/w2c.sql and is in the journal", () => {
    const { migration, canonical } = customMigration("w2c");
    expect(migration.endsWith(canonical)).toBe(true);
  });
});

describe("US-2-23 QA bulk disposition", () => {
  let lots: { id: string; lotNumber: string }[];

  it("lists quarantined lots of the current site for qa_qc only (quality.disposition_only_qa)", async () => {
    const qua = await loc(kit.nfd.id, "QUA-01");
    const a = await makeLot(manager, kit.nfd.id, qua.id, "1000", { status: "quarantine", expiresOn: "2031-01-31" });
    const b = await makeLot(manager, kit.nfd.id, qua.id, "1000", { status: "quarantine", expiresOn: "2031-02-28" });
    const expired = await makeLot(manager, kit.nfd.id, qua.id, "1000", { status: "quarantine", expiresOn: "2026-01-01" });
    lots = [a, b, expired];
    await expectCode(bulkDispositionCandidates(owner), "forbidden");
    await expectCode(bulkDispositionCandidates(warehouse), "forbidden");
    const c = await bulkDispositionCandidates(qa, { expiresFrom: "2025-01-01", expiresTo: "2031-12-31", itemKind: "material" });
    const ids = c.rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(lots.map((l) => l.id)));
    expect(c.rows.find((r) => r.id === expired.id)?.expired).toBe(true);
  });

  it("requires re-authentication with the user's own password", async () => {
    await expectCode(applyBulkDisposition(qa, { lotIds: lots.map((l) => l.id), decision: "release", reasonCode: "legacy_release", password: "wrong-password" }), "reauth_required");
    await expectCode(applyBulkDisposition(owner, { lotIds: lots.map((l) => l.id), decision: "release", reasonCode: "legacy_release", password: "demo1234" }), "forbidden");
    await expectCode(applyBulkDisposition(qa, { lotIds: lots.map((l) => l.id), decision: "release", reasonCode: "made_up", password: "demo1234" }), "validation");
  });

  it("releases each lot through the normal path with one correlation id; expired lots are refused", async () => {
    const r = await applyBulkDisposition(qa, { lotIds: lots.map((l) => l.id), decision: "release", reasonCode: "legacy_release", note: "Opening stock R1", password: "demo1234" });
    expect(r).toMatchObject({ total: 3, done: 2, failed: 1 });
    expect(r.outcomes.find((o) => o.lotId === lots[2].id)).toMatchObject({ ok: false });
    const st = await db.select({ id: inventoryLots.id, s: inventoryLots.qualityStatus }).from(inventoryLots).where(inArray(inventoryLots.id, lots.map((l) => l.id)));
    expect(st.filter((x) => x.s === "released")).toHaveLength(2);
    expect(st.find((x) => x.id === lots[2].id)?.s).toBe("quarantine");
    const d = await db.select().from(dispositions).where(inArray(dispositions.subjectId, lots.map((l) => l.id)));
    expect(d).toHaveLength(2);
    expect(d[0].reason).toBe("legacy_release: Opening stock R1");
    const ev = await db.select().from(auditEvents).where(and(inArray(auditEvents.entityId, lots.map((l) => l.id)), eq(auditEvents.action, "quality.disposition.released")));
    expect(ev).toHaveLength(2);
    expect(new Set(ev.map((e) => e.correlationId))).toEqual(new Set([r.correlationId]));
    const summary = await db.select().from(auditEvents).where(eq(auditEvents.action, "quality.disposition.bulk_applied"));
    expect(summary).toHaveLength(1);
    expect(summary[0].correlationId).toBe(r.correlationId);
  });
});

describe("US-2-24 label verification scan", () => {
  it("verifies a box once, leaves the container unchanged and shrinks the remaining list", async () => {
    const [box] = await db.select().from(containers).where(and(eq(containers.siteId, kit.nfd.id), inArray(containers.status, ["open", "sealed"])));
    expect(box).toBeTruthy();
    const zones = await labelVerificationLocations(warehouse);
    expect(zones.find((z) => z.id === box.currentLocationId)?.boxes).toBeGreaterThan(0);
    const zone0 = await labelVerificationZone(warehouse, box.currentLocationId!);
    expect(zone0.items.some((i) => i.kind === "box" && i.id === box.id && !i.verifiedAt)).toBe(true);
    await expectCode(verifyLabelScan(qa, { locationId: box.currentLocationId!, scan: `BC:BOX:${box.containerNumber}` }), "forbidden"); // qa_qc lacks inventory.container.edit
    const r = await verifyLabelScan(warehouse, { locationId: box.currentLocationId!, scan: `BC:BOX:${box.containerNumber}` });
    expect(r.status).toBe("verified");
    const again = await verifyLabelScan(warehouse, { locationId: box.currentLocationId!, scan: `bc:box:${box.containerNumber.toLowerCase()}` });
    expect(again.status).toBe("already");
    const [after] = await db.select().from(containers).where(eq(containers.id, box.id));
    expect(after.status).toBe(box.status);
    expect(after.updatedAt.getTime()).toBe(box.updatedAt.getTime());
    const zone1 = await labelVerificationZone(warehouse, box.currentLocationId!);
    expect((await labelVerificationLocations(warehouse)).find((z) => z.id === box.currentLocationId)?.verifiedBoxes).toBe(1);
    expect(zone1.verified).toBe(zone0.verified + 1);
    expect(zone1.remaining.some((i) => i.id === box.id)).toBe(false);
    expect(zone1.targetPct).toBe(99);
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "inventory.container.verified"), eq(auditEvents.entityId, box.id)));
    expect(ev).toHaveLength(1);
    expect(await db.select().from(labelVerifications).where(eq(labelVerifications.containerId, box.id))).toHaveLength(1);
  });

  it("verifies a loose lot label and answers 'not found at your site' for unknown or other-site codes (authz.cross_site.scan)", async () => {
    const b01 = await loc(kit.nfd.id, "B-01");
    const [bal] = await db.select({ lotId: inventoryBalances.lotId, lotNumber: inventoryLots.lotNumber }).from(inventoryBalances).innerJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId)).where(and(eq(inventoryBalances.locationId, b01.id), gt(inventoryBalances.qtyBase, "0")));
    const r = await verifyLabelScan(warehouse, { locationId: b01.id, scan: `BC:LOT:${bal.lotNumber}` });
    expect(r).toMatchObject({ status: "verified", kind: "lot" });
    expect(await db.select().from(labelVerifications).where(and(eq(labelVerifications.lotId, bal.lotId), isNull(labelVerifications.containerId)))).toHaveLength(1);
    await expectCode(verifyLabelScan(warehouse, { locationId: b01.id, scan: "BC:BOX:NOPE-0001" }), "not_found");
    const rvsFg = await loc(kit.rvs.id, "FG-01");
    await expectCode(verifyLabelScan(warehouseRvs, { locationId: rvsFg.id, scan: `BC:LOT:${bal.lotNumber}` }), "not_found");
    await expectCode(verifyLabelScan(warehouseRvs, { locationId: b01.id, scan: `BC:LOT:${bal.lotNumber}` }), "not_found");
    await expectCode(verifyLabelScan(warehouse, { locationId: b01.id, scan: "https://evil.example" }), "validation");
  });
});

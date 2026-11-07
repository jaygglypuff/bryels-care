/**
 * ADR-126 setting `scan.typed_code_counts_as_check` (A-SCAN-TYPED-01; owner 2026-11-07: "decide which is the best,
 * but give me an option I can edit in the settings"). On (default, today's behaviour): a typed label number counts as
 * the check. Off: the verification checks (second check of the box, label check, weighing lot confirmation, online and
 * offline replay) take a scan only; `typed` is refused like `tap`, with a plain message, and nothing is recorded.
 * Put-away and look-ups keep typing. The setting is restricted and owner-only: a non-owner cannot make it take effect.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { auditEvents, batchMaterials, batches, customers, dispenseRecords, inventoryLots, labelVerifications, packVerificationScans, packs, products, settingChangeRequests, settings, users } from "@/db/schema";
import { AuthContext, buildContextForUser, type SiteRef } from "@/lib/auth/context";
import { createSessionRecord } from "@/lib/auth/session-store";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { TYPING_IS_OFF } from "@/lib/scan/code-sql";
import { getSetting, settingDefinition } from "@/lib/settings";
import type { ReplayResponse } from "@/lib/offline/server/replay";
import { replaySyncBatch } from "@/lib/offline/server/replay";
import { activateDevice, requestDeviceRegistration } from "@/lib/offline/server/devices";
import type { SyncCommandWire } from "@/lib/offline/protocol";
import { approveSettingChange, changeSetting, screenPreferences } from "@/modules/governance";
import { createBox, postMovement } from "@/modules/inventory";
import { createBatch, recordDispense, startBatch } from "@/modules/production";
import { verifyLabelScan } from "@/modules/quality";
import { allocateOrder, completePick, confirmOrder, createOrder, getPick, manilaToday, scanPackVerification, scanPick, startPick } from "@/modules/sales";
import { resolvePickRef } from "@/modules/scan/pick";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, type Kit } from "../../support/kit";
import { acapulcoRevisionId, allowDirectBatches, cleanEquipment, lotBySupplierLot, manilaDay, signChecklist, snapshotOf } from "../../support/w2b";

const KEY = "scan.typed_code_counts_as_check";
const key = () => uuidv7();
const loose = (code: string) => code.replace(/-/g, "").toLowerCase();

let kit: Kit;

async function typingOff() {
  await typingDefault();
  await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: KEY, value: false });
}
async function typingDefault() {
  await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, KEY), isNull(settings.siteId)));
}

/* ------------------------------------------------------------------ offline helpers (as offline-sync.test.ts) */
type Actor = { ctx: AuthContext; sessionId: string };
async function actor(email: string, roles: string[], siteList: SiteRef[]): Promise<Actor> {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  const { session } = await createSessionRecord({ userId: u.id });
  const p = new Set(roles.flatMap((r) => ROLE_BUNDLES[r]?.permissions ?? []));
  const ctx = new AuthContext(u.id, kit.orgId, u.displayName, u.email, roles, p, siteList, siteList[0].id, {
    session: { id: session.id, reauthenticatedAt: null, mfaVerifiedAt: null, privileged: false },
  });
  return { ctx, sessionId: session.id };
}
let seq = 1;
function command(a: Actor, type: string, payload: Record<string, unknown>): SyncCommandWire {
  const createdAt = new Date();
  return {
    id: uuidv7(),
    idempotencyKey: randomUUID(),
    type,
    payload,
    siteId: kit.nfd.id,
    clientCreatedAt: createdAt.toISOString(),
    clientSequence: seq++,
    dependsOn: null,
    authSnapshotIssuedAt: new Date(createdAt.getTime() - 60_000).toISOString(),
    authSnapshotSessionId: a.sessionId,
    authSnapshotUserId: a.ctx.userId,
  };
}
async function replayOk(a: Actor, cmds: SyncCommandWire[], deviceKey: string) {
  const r = await replaySyncBatch(a.ctx, { body: { deviceSentAt: new Date().toISOString(), commands: cmds }, deviceKey });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  if (!r.body.ok) throw new Error("not ok");
  return r.body.data as ReplayResponse;
}

/** A soap batch in process with the weighing step open; returns the first two ingredient lines and their lot numbers. */
async function batchReadyToWeigh(manager: AuthContext, operator: AuthContext, checker: AuthContext) {
  const { batchId } = await createBatch(manager, { formulaRevisionId: await acapulcoRevisionId(), plannedSizeKg: "17.6", plannedStartOn: manilaDay(0) });
  await startBatch(operator, batchId);
  await cleanEquipment(operator, "SC-01");
  const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
  await signChecklist(operator, checker, batchId, [...snapshotOf(b).steps].sort((x, y) => x.stepNo - y.stepNo)[0]);
  const lines = await db.select().from(batchMaterials).where(eq(batchMaterials.batchId, batchId)).orderBy(batchMaterials.lineNo);
  return {
    batchId,
    coconut: lines[0],
    palm: lines[1],
    coconutLot: (await lotBySupplierLot("LOS-24871")).lotNumber,
    palmLot: (await lotBySupplierLot("MPC-7731")).lotNumber,
  };
}

/* ------------------------------------------------------------------ fixtures */
let sales: AuthContext;
let wh: AuthContext;
let mgr: AuthContext;
let fg01: string;
const spare: { id: string; containerNumber: string }[] = [];
let shipmentId: string;
let picked: string[] = [];
let manager: Actor;
let operator: Actor;
let checker: Actor;
let deviceKey: string;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd]);
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  mgr = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  const [p] = await db.insert(products).values({ organizationId: kit.orgId, skuCode: "TST-TCS-01", name: "Test Guava Bar 135 g (fictional)", family: "Soap", unitNetMassG: "135", unitsPerBox: 24 }).returning();
  fg01 = (await loc(kit.nfd.id, "FG-01")).id;
  const expires = new Date(Date.now() + 600 * 86_400_000).toISOString().slice(0, 10);
  const [l] = await db.insert(inventoryLots).values({ organizationId: kit.orgId, siteId: kit.nfd.id, lotNumber: `L-TCS-${uuidv7().slice(-6).toUpperCase()}`, itemKind: "product", productId: p.id, expiresOn: expires, manufacturedOn: manilaToday(), qualityStatus: "released", baseUom: "pcs" }).returning();
  await db.transaction((tx) => postMovement(tx, mgr, { movementType: "receipt", lotId: l.id, toLocationId: fg01, qtyBase: "96", sourceDocumentType: "test_fixture" }));
  for (let i = 0; i < 4; i++) spare.push(await createBox(wh, { lotId: l.id, locationId: fg01, qty: "24", idempotencyKey: uuidv7() }));
  const [c] = await db.select().from(customers).where(eq(customers.code, "CUS-002"));
  const o = await createOrder(sales, { customerId: c.id, requestedDeliveryOn: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), lines: [{ productId: p.id, qtyUnits: "48", unitPrice: "70" }] });
  await confirmOrder(sales, o.id);
  await allocateOrder(wh, o.id);
  const started = await startPick(wh, o.id, { idempotencyKey: key() });
  shipmentId = started.shipmentId;
  picked = (await getPick(wh, started.pickId)).rows.filter((r) => r.boxNumber).map((r) => r.boxNumber!);
  for (const b of picked) await scanPick(wh, started.pickId, { payload: `BC:BOX:${b}`, via: "scan", idempotencyKey: key() });
  await completePick(wh, started.pickId, {});

  manager = await actor("manager.nfd@bryels-care.test", ["site_manager"], [kit.nfd]);
  operator = await actor("operator.nfd@bryels-care.test", ["production_operator"], [kit.nfd]);
  checker = await actor("checker.nfd@bryels-care.test", ["production_operator"], [kit.nfd]);
  deviceKey = randomBytes(32).toString("base64url");
  const reg = await requestDeviceRegistration(operator.ctx, { deviceKey, label: "Typed check device", platform: "android", deviceClass: "floor_shared", siteId: kit.nfd.id });
  await activateDevice(manager.ctx, { deviceId: reg.deviceId, workflows: ["dispensing"] });
  await allowDirectBatches(kit);
}, 240_000);

afterEach(typingDefault);

describe("the setting", () => {
  it("is on by default, restricted and owner-only, with grade-5 words and who should change it", async () => {
    const def = settingDefinition(KEY)!;
    expect(def).toMatchObject({ default: true, restricted: true, ownerOnly: true, requiresApproval: true, group: "Scan and search", assumption: "A-SCAN-TYPED-01" });
    expect(def.label).toBe("A typed label number counts as a check");
    expect(def.whoChanges).toMatch(/after QA says yes/);
    expect(await getSetting(db, kit.orgId, KEY)).toBe(true);
    expect((await screenPreferences(wh)).typedChecks).toBe(true);
  });

  it("role escalation: QA and the site manager cannot change it; a second administrator cannot approve it; the owner can, audited", async () => {
    const ctx = async (email: string) => {
      const [u] = await db.select().from(users).where(eq(users.email, email));
      return (await buildContextForUser(u.id, kit.nfd.id))!;
    };
    await expectCode(changeSetting(await ctx("qa.nfd@bryels-care.test"), { key: KEY, siteId: null, value: false, reason: "QA tries alone (test)" }, "demo1234"), "forbidden");
    await expectCode(changeSetting(await ctx("manager.nfd@bryels-care.test"), { key: KEY, siteId: null, value: false, reason: "Manager tries (test)" }, "demo1234"), "forbidden");
    const admin = await ctx("admin@bryels-care.test");
    const r = await changeSetting(admin, { key: KEY, siteId: null, value: false, reason: "QA asked for scans only (test)" }, "demo1234");
    expect(r.status).toBe("submitted");
    expect(await getSetting(db, kit.orgId, KEY)).toBe(true);
    await expectCode(approveSettingChange(admin, r.requestId, { password: "demo1234" }), "separation_of_duties");
    const e = await expectCode(approveSettingChange(await ctx("admin2@bryels-care.test"), r.requestId, { password: "demo1234" }), "forbidden");
    expect(e.message).toContain("Only the owner");
    expect(await getSetting(db, kit.orgId, KEY)).toBe(true);
    await approveSettingChange(await ctx("owner@bryels-care.test"), r.requestId, { password: "demo1234" });
    expect(await getSetting(db, kit.orgId, KEY)).toBe(false);
    const [req] = await db.select().from(settingChangeRequests).where(eq(settingChangeRequests.id, r.requestId));
    expect(req.status).toBe("applied");
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.setting.changed"), eq(auditEvents.entityNumber, KEY)));
    expect(ev.before).toEqual({ value: null });
    expect(ev.after).toEqual({ value: false });
    expect((await screenPreferences(wh)).typedChecks).toBe(false);
  });
});

describe("off: the verification checks take a scan only", () => {
  it("second check of the box: a typed number is refused in plain words and not recorded; a scan is checked", async () => {
    await typingOff();
    const e = await expectCode(scanPackVerification(mgr, shipmentId, { payload: loose(picked[0]), via: "typed", idempotencyKey: key() }), "validation");
    expect(e.message).toBe(TYPING_IS_OFF);
    expect(e.details?.code).toBe("TYPED_NOT_A_CHECK");
    expect(await db.select().from(packVerificationScans).where(eq(packVerificationScans.scanPayload, loose(picked[0])))).toHaveLength(0);
    // A tap is still refused for its own reason; a scan works.
    expect((await expectCode(scanPackVerification(mgr, shipmentId, { payload: `BC:BOX:${picked[0]}`, via: "tap", idempotencyKey: key() }), "validation")).details?.code).toBe("TAP_NOT_A_CHECK");
    const r = await scanPackVerification(mgr, shipmentId, { payload: `BC:BOX:${picked[0]}`, via: "scan", idempotencyKey: key() });
    expect(r.outcome).toBe("verified");
  });

  it("on again: the typed number counts as the second check (today's behaviour)", async () => {
    const r = await scanPackVerification(mgr, shipmentId, { payload: loose(picked[1]), via: "typed", idempotencyKey: key() });
    expect(r.outcome).toBe("verified");
    const [pack] = await db.select().from(packs).where(eq(packs.shipmentId, shipmentId));
    const ok = await db.select().from(packVerificationScans).where(and(eq(packVerificationScans.packId, pack.id), eq(packVerificationScans.result, "ok")));
    const all = await db.select().from(packVerificationScans).where(eq(packVerificationScans.packId, pack.id));
    expect(ok.map((x) => x.entryMode).sort(), JSON.stringify(all.map((x) => [x.result, x.entryMode, x.scanPayload]))).toEqual(["scan", "typed"]);
  });

  it("label check: typed refused while off, accepted (recorded as typed) when on; look-ups still take typing", async () => {
    const [b1, b2] = spare.filter((b) => !picked.includes(b.containerNumber));
    await typingOff();
    const e = await expectCode(verifyLabelScan(wh, { locationId: fg01, scan: loose(b1.containerNumber), via: "typed" }), "validation");
    expect(e.message).toBe(TYPING_IS_OFF);
    expect(await db.select().from(labelVerifications).where(eq(labelVerifications.containerId, b1.id))).toHaveLength(0);
    // Finding a box by its typed number is a look-up, not a check: still allowed.
    expect((await resolvePickRef(wh, "container", loose(b1.containerNumber))).code).toBe(b1.containerNumber);
    expect((await verifyLabelScan(wh, { locationId: fg01, scan: `BC:BOX:${b1.containerNumber}`, via: "scan" })).status).toBe("verified");
    await typingDefault();
    expect((await verifyLabelScan(wh, { locationId: fg01, scan: loose(b2.containerNumber), via: "typed" })).status).toBe("verified");
    const [row] = await db.select().from(labelVerifications).where(eq(labelVerifications.containerId, b2.id));
    expect(row.entryMode).toBe("typed");
  });
});

describe("weighing lot confirmation, online and offline replay", () => {
  it("off: online typed (and a bare last 4) is refused, offline typed replay is rejected, a scan applies; nothing typed is recorded", async () => {
    const w = await batchReadyToWeigh(manager.ctx, operator.ctx, checker.ctx);
    await typingOff();
    // Online Weigh card: the preselected lot confirmed by typing its number.
    const online = await expectCode(
      recordDispense(operator.ctx, { batchId: w.batchId, batchMaterialId: w.coconut.id, lotRef: `BC:LOT:${w.coconutLot}`, lotPreselected: true, lotConfirm: w.coconutLot, lotConfirmVia: "typed", qty: "3723.2", equipmentRef: "SC-01", idempotencyKey: key() }),
      "validation",
    );
    expect(online.message).toBe(TYPING_IS_OFF);
    // Older screens: the last 4 with no `via` can only have been typed.
    await expectCode(
      recordDispense(operator.ctx, { batchId: w.batchId, batchMaterialId: w.coconut.id, lotRef: `BC:LOT:${w.coconutLot}`, lotPreselected: true, lotConfirm: w.coconutLot.slice(-4), qty: "3723.2", equipmentRef: "SC-01", idempotencyKey: key() }),
      "validation",
    );
    // Offline replay of a weighing whose lot was typed.
    const typed = command(operator, "production.dispense_record.create", { batchId: w.batchId, batchMaterialId: w.coconut.id, lotRef: `BC:LOT:${w.coconutLot}`, lotVia: "typed", qty: "3723.2", equipmentRef: "SC-01" });
    const d1 = await replayOk(operator, [typed], deviceKey);
    expect(d1.results[0], JSON.stringify(d1.results[0])).toMatchObject({ status: "rejected", reasonCode: "validation_failed" });
    expect(d1.results[0].errorMessage).toBe(TYPING_IS_OFF);
    expect(await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, w.coconut.id))).toHaveLength(0);
    // A scanned lot is still a confirmation, offline and online.
    const scan = command(operator, "production.dispense_record.create", { batchId: w.batchId, batchMaterialId: w.coconut.id, lotRef: `BC:LOT:${w.coconutLot}`, lotVia: "scan", qty: "3723.2", equipmentRef: "SC-01" });
    expect((await replayOk(operator, [scan], deviceKey)).results[0].status).toBe("applied");
    const r = await recordDispense(operator.ctx, { batchId: w.batchId, batchMaterialId: w.palm.id, lotRef: `BC:LOT:${w.palmLot}`, lotPreselected: true, lotConfirm: `BC:LOT:${w.palmLot}`, lotConfirmVia: "scan", qty: w.palm.theoreticalQtyG, equipmentRef: "SC-01", idempotencyKey: key() });
    expect(r.status).toBeTruthy();
    const recs = await db.select().from(dispenseRecords).where(inArray(dispenseRecords.batchMaterialId, [w.coconut.id, w.palm.id]));
    const evs = await Promise.all(recs.map(async (x) => (await db.select().from(auditEvents).where(and(eq(auditEvents.action, "production.dispense_record.recorded"), eq(auditEvents.entityId, x.id))))[0]));
    expect(evs.map((e) => (e.after as { lotConfirmed: string }).lotConfirmed).sort()).toEqual(["scan", "scan"]);
  });

  it("on (default): online and offline typed lot numbers confirm the lot, recorded as typed", async () => {
    const w = await batchReadyToWeigh(manager.ctx, operator.ctx, checker.ctx);
    const typed = command(operator, "production.dispense_record.create", { batchId: w.batchId, batchMaterialId: w.coconut.id, lotRef: `BC:LOT:${w.coconutLot}`, lotVia: "typed", qty: "3723.2", equipmentRef: "SC-01" });
    expect((await replayOk(operator, [typed], deviceKey)).results[0].status).toBe("applied");
    await recordDispense(operator.ctx, { batchId: w.batchId, batchMaterialId: w.palm.id, lotRef: `BC:LOT:${w.palmLot}`, lotPreselected: true, lotConfirm: loose(w.palmLot), lotConfirmVia: "typed", qty: w.palm.theoreticalQtyG, equipmentRef: "SC-01", idempotencyKey: key() });
    const recs = await db.select().from(dispenseRecords).where(inArray(dispenseRecords.batchMaterialId, [w.coconut.id, w.palm.id]));
    expect(recs).toHaveLength(2);
    const evs = await Promise.all(recs.map(async (x) => (await db.select().from(auditEvents).where(and(eq(auditEvents.action, "production.dispense_record.recorded"), eq(auditEvents.entityId, x.id))))[0]));
    expect(evs.map((e) => (e.after as { lotConfirmed: string }).lotConfirmed)).toEqual(["typed", "typed"]);
  });
});

/**
 * W4D offline sync (US-7-01..06) against a real database: POST /api/v1/sync/commands replay
 * (idempotent per command id, lost response), the authorization snapshot rules (age, queue age,
 * revoked session, device changed hands, permission revoked while offline), device registration and
 * policy, cross-site refusal, dependency_failed, count_plan_closed, offline weighing rules
 * (out of tolerance, wrong lot), the conflict queue resolved each way, the reference DTO allow-list,
 * discards at logout and the diagnostics card. Fictional seed data only.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, count, eq, inArray } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import {
  auditEvents,
  batchMaterials,
  batches,
  deviations,
  dispenseRecords,
  sessions,
  settings,
  stockAdjustments,
  stockCountEntries,
  stockMovements,
  syncCommands,
  syncConflicts,
  users,
} from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { createSessionRecord } from "@/lib/auth/session-store";
import { ROLE_BUNDLES } from "@/lib/permissions";
import type { ReplayResponse } from "@/lib/offline/server/replay";
import { replaySyncBatch } from "@/lib/offline/server/replay";
import { activateDevice, changeDeviceStatus, listDevices, requestDeviceRegistration } from "@/lib/offline/server/devices";
import { getConflict, listConflicts, listMyConflicts, recordDiscardedCommands, resolveConflict, syncDiagnostics } from "@/lib/offline/server/conflicts";
import { buildReference } from "@/lib/offline/server/reference";
import { buildAuthSnapshot } from "@/lib/offline/server/snapshot";
import type { SyncCommandWire } from "@/lib/offline/protocol";
import { cancelCount, createCount, releaseCount } from "@/modules/inventory";
import { createBatch, startBatch } from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { type Kit, expectCode, loadKit, loc, makeLot, onHand } from "../../support/kit";
import { acapulcoRevisionId, allowDirectBatches, cleanEquipment, lotBySupplierLot, manilaDay, signChecklist, snapshotOf } from "../../support/w2b";

let kit: Kit;
const HOUR = 3_600_000;

type Actor = { ctx: AuthContext; sessionId: string };

/** A context with a real session row (the replay checks the snapshot's session). */
async function actor(email: string, roles: string[], siteList: SiteRef[], perms?: string[]): Promise<Actor> {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  const { session } = await createSessionRecord({ userId: u.id });
  const p = new Set(perms ?? roles.flatMap((r) => ROLE_BUNDLES[r]?.permissions ?? []));
  const ctx = new AuthContext(u.id, kit.orgId, u.displayName, u.email, roles, p, siteList, siteList[0].id, {
    session: { id: session.id, reauthenticatedAt: null, mfaVerifiedAt: null, privileged: false },
  });
  return { ctx, sessionId: session.id };
}

const deviceKey = () => randomBytes(32).toString("base64url");
let seq = 1;

function command(a: Actor, type: string, payload: Record<string, unknown>, o: { siteId?: string; createdAt?: Date; snapshotAt?: Date; sessionId?: string | null; userId?: string; dependsOn?: string } = {}): SyncCommandWire {
  const createdAt = o.createdAt ?? new Date();
  return {
    id: uuidv7(),
    idempotencyKey: randomUUID(),
    type,
    payload,
    siteId: o.siteId ?? kit.nfd.id,
    clientCreatedAt: createdAt.toISOString(),
    clientSequence: seq++,
    dependsOn: o.dependsOn ?? null,
    authSnapshotIssuedAt: (o.snapshotAt ?? new Date(createdAt.getTime() - 60_000)).toISOString(),
    authSnapshotSessionId: o.sessionId === undefined ? a.sessionId : o.sessionId,
    authSnapshotUserId: o.userId ?? a.ctx.userId,
  };
}

async function replay(a: Actor | null, cmds: SyncCommandWire[], key: string | null, sentAt = new Date()) {
  const r = await replaySyncBatch(a?.ctx ?? null, { body: { deviceSentAt: sentAt.toISOString(), commands: cmds }, deviceKey: key });
  return r;
}
async function ok(a: Actor, cmds: SyncCommandWire[], key: string | null, sentAt?: Date) {
  const r = await replay(a, cmds, key, sentAt);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  if (!r.body.ok) throw new Error("not ok");
  return r.body.data as ReplayResponse;
}

let manager: Actor;
let warehouse: Actor;
let warehouse2: Actor;
let operator: Actor;
let checker: Actor;
let whRvs: Actor;
let managerRvs: Actor;
let auditor: Actor;
let deviceA: string; // NFD floor device: stock_count, movement_request, dispensing
let deviceAId: string;

async function registerDevice(by: Actor, approver: Actor, workflows: string[], siteId = kit.nfd.id) {
  const key = deviceKey();
  const r = await requestDeviceRegistration(by.ctx, { deviceKey: key, label: `Test device ${seq}`, platform: "android", deviceClass: "floor_shared", siteId });
  expect(r.status).toBe("pending");
  await activateDevice(approver.ctx, { deviceId: r.deviceId, workflows });
  return { key, id: r.deviceId };
}

async function openCount(locationCode: string, counters: string[]) {
  const l = await loc(kit.nfd.id, locationCode);
  const c = await createCount(manager.ctx, { countKind: "spot", isBlind: true, locationIds: [l.id], counterUserIds: counters });
  await releaseCount(manager.ctx, c.id);
  return { countId: c.id, location: l };
}

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  manager = await actor("manager.nfd@bryels-care.test", ["site_manager"], [kit.nfd]);
  warehouse = await actor("warehouse.nfd@bryels-care.test", ["warehouse_operator"], [kit.nfd]);
  warehouse2 = await actor("warehouse2.nfd@bryels-care.test", ["warehouse_operator"], [kit.nfd]);
  operator = await actor("operator.nfd@bryels-care.test", ["production_operator"], [kit.nfd]);
  checker = await actor("checker.nfd@bryels-care.test", ["production_operator"], [kit.nfd]);
  whRvs = await actor("warehouse.rvs@bryels-care.test", ["warehouse_operator"], [kit.rvs]);
  managerRvs = await actor("sales@bryels-care.test", ["site_manager"], [kit.rvs]);
  auditor = await actor("auditor@bryels-care.test", ["auditor"], [kit.nfd, kit.rvs]);
  const d = await registerDevice(warehouse, manager, ["stock_count", "movement_request", "dispensing"]);
  deviceA = d.key;
  deviceAId = d.id;
});

describe("device registration (US-7-06)", () => {
  it("self-service request is pending until a device admin activates it; role escalation and cross-site are refused", async () => {
    const key = deviceKey();
    const r = await requestDeviceRegistration(warehouse.ctx, { deviceKey: key, label: "Counting phone 2", platform: "android", siteId: kit.nfd.id });
    expect(r).toMatchObject({ status: "pending", replayed: false });
    expect((await requestDeviceRegistration(warehouse.ctx, { deviceKey: key, label: "Counting phone 2", platform: "android", siteId: kit.nfd.id })).replayed).toBe(true);
    await expectCode(requestDeviceRegistration(warehouse.ctx, { deviceKey: deviceKey(), label: "Other site", siteId: kit.rvs.id }), "not_found");
    await expectCode(requestDeviceRegistration(warehouse.ctx, { deviceKey: "short", label: "x", siteId: kit.nfd.id }), "validation");
    // A warehouse operator cannot activate devices; another site's manager cannot see this one.
    await expectCode(activateDevice(warehouse.ctx, { deviceId: r.deviceId, workflows: ["stock_count"] }), "forbidden");
    await expectCode(activateDevice(managerRvs.ctx, { deviceId: r.deviceId, workflows: ["stock_count"] }), "not_found");
    await expectCode(activateDevice(manager.ctx, { deviceId: r.deviceId, workflows: ["teleport"] }), "validation");
    await activateDevice(manager.ctx, { deviceId: r.deviceId, workflows: ["stock_count"] });
    await expectCode(changeDeviceStatus(manager.ctx, { deviceId: r.deviceId, to: "removed", reason: "no" }), "validation");
    await changeDeviceStatus(manager.ctx, { deviceId: r.deviceId, to: "removed", reason: "Phone lost on the floor" });
    await expectCode(activateDevice(manager.ctx, { deviceId: r.deviceId, workflows: [] }), "state");
    await expectCode(requestDeviceRegistration(warehouse.ctx, { deviceKey: key, label: "Again", siteId: kit.nfd.id }), "state");
    const listed = await listDevices(manager.ctx);
    expect(listed.find((x) => x.id === r.deviceId)?.status).toBe("removed");
    expect(await listDevices(managerRvs.ctx)).not.toContainEqual(expect.objectContaining({ id: r.deviceId }));
    await expectCode(listDevices(warehouse.ctx), "forbidden");
    const actions = (await db.select({ a: auditEvents.action }).from(auditEvents).where(eq(auditEvents.entityId, r.deviceId))).map((x) => x.a);
    expect(actions).toEqual(expect.arrayContaining(["platform.device.registration_requested", "platform.device.activated", "platform.device.removed"]));
  });

  it("the authorization snapshot carries the device, per-site permissions and an expiry ≤ 12 h and ≤ the session", async () => {
    const s = await buildAuthSnapshot(warehouse.ctx, deviceA);
    expect(s.device).toMatchObject({ id: deviceAId, status: "active", siteId: kit.nfd.id });
    expect(s.device!.allowedWorkflows).toEqual(expect.arrayContaining(["stock_count", "movement_request", "dispensing"]));
    expect(s.permissions[kit.nfd.id]).toContain("inventory.stock_count.submit");
    expect(s.sessionId).toBe(warehouse.sessionId);
    const age = new Date(s.expiresAt).getTime() - new Date(s.issuedAt).getTime();
    expect(age).toBeLessThanOrEqual(12 * HOUR);
    expect(new Date(s.expiresAt).getTime()).toBeLessThanOrEqual(new Date(s.sessionExpiresAt!).getTime());
    expect(s.policy).toMatchObject({ maxAttempts: 20, maxQueueAgeHours: 72, snapshotMaxAgeHours: 12, retryScheduleSeconds: [5, 30, 120, 600, 1800] });
  });
});

describe("replay is idempotent per command id (US-7-02)", () => {
  it("offline.replay_after_lost_response: a resent batch returns the stored results and posts once", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const a02 = await loc(kit.nfd.id, "A-02");
    const lot = await makeLot(manager.ctx, kit.nfd.id, a01.id, "100");
    const pkgLot = await makeLot(manager.ctx, kit.nfd.id, (await loc(kit.nfd.id, "PKG-01")).id, "40", { materialCode: "PKG-0101" });
    const { countId, location } = await openCount("PKG-01", [warehouse.ctx.userId]);
    const move = command(warehouse, "inventory.movement.transfer", { lotId: lot.id, fromLocationId: a01.id, toLocationId: a02.id, qty: "30", reason: "Offline move test" });
    const cnt = command(warehouse, "inventory.stock_count.record", { countId, locationId: location.id, lotId: pkgLot.id, qty: "39" });
    const first = await ok(warehouse, [cnt, move], deviceA);
    // Answered in device order (clientSequence), whatever the order in the request.
    expect(first.results.map((r) => [r.id, r.status])).toEqual([
      [move.id, "applied"],
      [cnt.id, "applied"],
    ]);
    // The response was lost: the device sends the same batch again.
    const again = await ok(warehouse, [move, cnt], deviceA);
    expect(again.results.every((r) => r.status === "applied")).toBe(true);
    expect(await onHand(lot.id, a02.id)).toBe("30");
    expect((await db.select({ n: count() }).from(stockMovements).where(and(eq(stockMovements.lotId, lot.id), eq(stockMovements.movementType, "transfer"))))[0].n).toBe(1);
    expect((await db.select({ n: count() }).from(stockCountEntries).where(eq(stockCountEntries.stockCountId, countId)))[0].n).toBe(1);
    const rows = await db.select().from(syncCommands).where(inArray(syncCommands.id, [move.id, cnt.id]));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "applied" && r.deviceRegistrationId === deviceAId && r.sessionId === warehouse.sessionId)).toBe(true);
    expect(rows.find((r) => r.id === move.id)).toMatchObject({ appliedEntityType: "stock_movement" });
    expect(rows.find((r) => r.id === cnt.id)).toMatchObject({ appliedEntityType: "stock_count_entry" });
    const accepted = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.sync_command.replay_accepted"), inArray(auditEvents.entityId, [move.id, cnt.id])));
    expect(accepted).toHaveLength(2);
    await cancelCount(manager.ctx, countId, "test done");
  });

  it("refuses an unauthenticated replay (401, nothing recorded) and a malformed batch (422)", async () => {
    const c = command(warehouse, "inventory.movement.transfer", { lotId: uuidv7(), fromLocationId: uuidv7(), toLocationId: uuidv7(), qty: "1", reason: "x x x" });
    const r = await replay(null, [c], deviceA);
    expect(r.status).toBe(401);
    expect(await db.select().from(syncCommands).where(eq(syncCommands.id, c.id))).toHaveLength(0);
    const bad = await replaySyncBatch(warehouse.ctx, { body: { deviceSentAt: new Date().toISOString(), commands: [{ ...c, id: randomUUID() }] }, deviceKey: deviceA });
    expect(bad.status).toBe(422);
  });

  it("offline.online_only_rejected: a queued QA release is refused with ONLINE_ONLY and parked", async () => {
    const c = command(warehouse, "quality.disposition.approve", { lotId: uuidv7() });
    const d = await ok(warehouse, [c], deviceA);
    expect(d.results[0]).toMatchObject({ status: "rejected", errorCode: "ONLINE_ONLY", reasonCode: "validation_failed" });
    const [conf] = await db.select().from(syncConflicts).where(eq(syncConflicts.syncCommandId, c.id));
    expect(conf).toMatchObject({ status: "open", reasonCode: "validation_failed", userId: warehouse.ctx.userId });
  });

  it("flags clock skew beyond 10 minutes without rejecting (A-OFF-05)", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    const lot = await makeLot(manager.ctx, kit.nfd.id, a01.id, "10");
    const c = command(warehouse, "inventory.movement.transfer", { lotId: lot.id, fromLocationId: a01.id, toLocationId: (await loc(kit.nfd.id, "A-02")).id, qty: "1", reason: "Skew test" });
    const d = await ok(warehouse, [c], deviceA, new Date(Date.now() - 20 * 60_000));
    expect(d.results[0].status).toBe("applied");
    const [row] = await db.select().from(syncCommands).where(eq(syncCommands.id, c.id));
    expect(row.isClockSkewFlagged).toBe(true);
    expect(row.clockSkewSeconds).toBeGreaterThan(1100);
  });
});

describe("authorization snapshot rules (US-7-03)", () => {
  let lotId: string;
  let a01: string;
  let a02: string;
  beforeAll(async () => {
    a01 = (await loc(kit.nfd.id, "A-01")).id;
    a02 = (await loc(kit.nfd.id, "A-02")).id;
    lotId = (await makeLot(manager.ctx, kit.nfd.id, a01, "50")).id;
  });
  const mv = (a: Actor, o: Parameters<typeof command>[3] = {}) => command(a, "inventory.movement.transfer", { lotId, fromLocationId: a01, toLocationId: a02, qty: "1", reason: "Snapshot test" }, o);

  it("offline.auth_snapshot_too_old: work captured more than 12 h after the last server contact is parked", async () => {
    const created = new Date(Date.now() - HOUR);
    const c = mv(warehouse, { createdAt: created, snapshotAt: new Date(created.getTime() - 13 * HOUR) });
    const d = await ok(warehouse, [c], deviceA);
    expect(d.results[0]).toMatchObject({ status: "rejected", reasonCode: "auth_snapshot_expired", errorCode: "AUTH_SNAPSHOT_EXPIRED" });
    expect(await onHand(lotId, a02)).toBe("0");
  });

  it("offline.queue_age_exceeded_to_conflict: work queued more than 72 h ago is parked, nothing posted", async () => {
    const created = new Date(Date.now() - 73 * HOUR);
    const c = mv(warehouse, { createdAt: created, snapshotAt: new Date(created.getTime() - HOUR) });
    const d = await ok(warehouse, [c], deviceA);
    expect(d.results[0]).toMatchObject({ status: "rejected", reasonCode: "auth_snapshot_expired", errorCode: "QUEUE_AGE_EXCEEDED" });
    const audits = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.sync_command.replay_rejected"), eq(auditEvents.entityId, c.id)));
    expect(audits).toHaveLength(1);
  });

  it("offline.expired_session: work captured under a session that was revoked is parked even after signing in again", async () => {
    const old = await createSessionRecord({ userId: warehouse.ctx.userId });
    await db.update(sessions).set({ revokedAt: new Date(), revokedReason: "admin revoked all sessions" }).where(eq(sessions.id, old.session.id));
    const c = mv(warehouse, { sessionId: old.session.id });
    const d = await ok(warehouse, [c], deviceA);
    expect(d.results[0]).toMatchObject({ status: "rejected", reasonCode: "session_revoked", errorCode: "SESSION_REVOKED" });
    // Captured under an older session that only expired (idle): accepted with the current sign-in.
    const idle = await createSessionRecord({ userId: warehouse.ctx.userId });
    await db.update(sessions).set({ idleExpiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, idle.session.id));
    const c2 = mv(warehouse, { sessionId: idle.session.id });
    expect((await ok(warehouse, [c2], deviceA)).results[0].status).toBe("applied");
  });

  it("a device that changed hands never applies the first person's work under the second sign-in", async () => {
    const c = mv(warehouse, { userId: warehouse2.ctx.userId, sessionId: warehouse2.sessionId });
    const d = await ok(warehouse, [c], deviceA);
    expect(d.results[0]).toMatchObject({ status: "rejected", reasonCode: "session_revoked", errorCode: "DEVICE_USER_CHANGED" });
    const [row] = await db.select().from(syncCommands).where(eq(syncCommands.id, c.id));
    expect(row.userId).toBe(warehouse2.ctx.userId);
  });

  it("offline.permission_revoked_while_offline: PERMISSIONS_CHANGED, parked, nothing posted", async () => {
    const before = await onHand(lotId, a02);
    const revoked: Actor = {
      sessionId: warehouse.sessionId,
      ctx: new AuthContext(warehouse.ctx.userId, kit.orgId, warehouse.ctx.displayName, warehouse.ctx.email, ["warehouse_operator"], new Set(ROLE_BUNDLES.warehouse_operator.permissions.filter((p) => p !== "inventory.movement.post")), [kit.nfd], kit.nfd.id, warehouse.ctx.options),
    };
    const c = mv(revoked);
    const d = await ok(revoked, [c], deviceA);
    expect(d.permissionsChanged).toBe(true);
    expect(d.results[0]).toMatchObject({ status: "rejected", reasonCode: "permission_denied", errorCode: "PERMISSIONS_CHANGED" });
    expect(d.snapshot.permissions[kit.nfd.id]).not.toContain("inventory.movement.post");
    expect(await onHand(lotId, a02)).toBe(before);
  });

  it("authz.cross_site: a Site B user's command naming Site A is refused; Site A stock is untouched", async () => {
    const before = await onHand(lotId, a02);
    const c = mv(whRvs, { siteId: kit.nfd.id });
    const d = await ok(whRvs, [c], null);
    expect(d.results[0]).toMatchObject({ status: "rejected", reasonCode: "site_not_allowed" });
    expect(await onHand(lotId, a02)).toBe(before);
    // Site A's reviewer sees it in the Site A queue; Site B's manager does not.
    expect((await listConflicts(manager.ctx)).some((x) => x.id === d.results[0].conflictId)).toBe(true);
    expect((await listConflicts(managerRvs.ctx)).some((x) => x.id === d.results[0].conflictId)).toBe(false);
    await expectCode(getConflict(managerRvs.ctx, d.results[0].conflictId!), "not_found");
  });

  it("device policy: a workflow not granted to the device, a suspended device, or the site policy refuses the work", async () => {
    const countOnly = await registerDevice(warehouse, manager, ["stock_count"]);
    const c1 = mv(warehouse);
    expect((await ok(warehouse, [c1], countOnly.key)).results[0]).toMatchObject({ status: "rejected", errorCode: "DEVICE_NOT_ALLOWED" });
    await changeDeviceStatus(manager.ctx, { deviceId: countOnly.id, to: "suspended", reason: "Battery swollen" });
    const c2 = mv(warehouse);
    expect((await ok(warehouse, [c2], countOnly.key)).results[0]).toMatchObject({ status: "rejected", errorCode: "DEVICE_NOT_ACTIVE" });
    // Anonymous browsers may queue moves (A-OFF-03 default) unless the site turns it off.
    const c3 = mv(warehouse);
    expect((await ok(warehouse, [c3], null)).results[0].status).toBe("applied");
    const [row] = await db.insert(settings).values({ organizationId: kit.orgId, scope: "site", siteId: kit.nfd.id, key: "offline.anonymous_movement_requests", value: false }).returning();
    const c4 = mv(warehouse);
    expect((await ok(warehouse, [c4], null)).results[0]).toMatchObject({ status: "rejected", errorCode: "DEVICE_NOT_ALLOWED" });
    await db.delete(settings).where(eq(settings.id, row.id));
  });

  it("offline.dependency_failed: a move depending on a refused move is not attempted; independent work still applies", async () => {
    const first = mv(warehouse);
    first.payload = { ...first.payload, qty: "100000" }; // more than on hand → insufficient
    const second = mv(warehouse, { dependsOn: first.id });
    const third = mv(warehouse);
    const d = await ok(warehouse, [first, second, third], deviceA);
    const by = Object.fromEntries(d.results.map((r) => [r.id, r]));
    expect(by[first.id]).toMatchObject({ status: "conflict", reasonCode: "insufficient_stock" });
    expect(by[second.id]).toMatchObject({ status: "conflict", reasonCode: "dependency_failed" });
    expect(by[third.id].status).toBe("applied");
  });
});

describe("offline counting and weighing (US-7-04)", () => {
  it("offline.count_plan_closed: a count line replayed after the count closed is parked as count_closed", async () => {
    const lot = await makeLot(manager.ctx, kit.nfd.id, (await loc(kit.nfd.id, "B-01")).id, "5", { materialCode: "MAT-0061" });
    const { countId, location } = await openCount("B-01", [warehouse.ctx.userId]);
    const c = command(warehouse, "inventory.stock_count.record", { countId, locationId: location.id, lotId: lot.id, qty: "5" });
    await cancelCount(manager.ctx, countId, "Count closed while the phone was offline");
    const d = await ok(warehouse, [c], deviceA);
    expect(d.results[0]).toMatchObject({ status: "conflict", reasonCode: "count_closed" });
    const [conf] = await db.select().from(syncConflicts).where(eq(syncConflicts.syncCommandId, c.id));
    expect(conf).toMatchObject({ relatedEntityType: "stock_count", relatedEntityId: countId });
    expect((conf.serverState as { status: string }).status).toBe("cancelled");
  });

  it("offline.dispense_capture_rules: within tolerance applies (checker signs later); wrong lot and out of tolerance are parked, never accepted", async () => {
    await allowDirectBatches(kit);
    const opDevice = await registerDevice(operator, manager, ["dispensing"]);
    const { batchId } = await createBatch(manager.ctx, { formulaRevisionId: await acapulcoRevisionId(), plannedSizeKg: "17.6", plannedStartOn: manilaDay(0) });
    await startBatch(operator.ctx, batchId);
    await cleanEquipment(operator.ctx, "SC-01");
    const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
    await signChecklist(operator.ctx, checker.ctx, batchId, [...snapshotOf(b).steps].sort((x, y) => x.stepNo - y.stepNo)[0]);
    const lines = await db.select().from(batchMaterials).where(eq(batchMaterials.batchId, batchId)).orderBy(batchMaterials.lineNo);
    const coconut = lines[0];
    const palm = lines[1];
    const coconutLot = `BC:LOT:${(await lotBySupplierLot("LOS-24871")).lotNumber}`;
    const palmLot = `BC:LOT:${(await lotBySupplierLot("MPC-7731")).lotNumber}`;

    // The reference cache lists the batch with its lines and tolerances, without any cost.
    const ref = await buildReference(operator.ctx, kit.nfd.id, opDevice.key);
    const cached = ref.batches!.find((x) => x.id === batchId)!;
    expect(cached.lines[0]).toMatchObject({ id: coconut.id, theoreticalQtyG: coconut.theoreticalQtyG, tolerancePct: coconut.tolerancePct });
    expect(cached.weighing?.requiresEquipment).toBe(true);

    const wrong = command(operator, "production.dispense_record.create", { batchId, batchMaterialId: coconut.id, lotRef: palmLot, qty: "3723.2", equipmentRef: "SC-01" });
    const out = command(operator, "production.dispense_record.create", { batchId, batchMaterialId: coconut.id, lotRef: coconutLot, qty: "3650.0", equipmentRef: "SC-01" });
    const good = command(operator, "production.dispense_record.create", { batchId, batchMaterialId: coconut.id, lotRef: coconutLot, qty: "3723.2", equipmentRef: "SC-01" });
    const d = await ok(operator, [wrong, out, good], opDevice.key);
    const by = Object.fromEntries(d.results.map((r) => [r.id, r]));
    expect(by[wrong.id], JSON.stringify(by[wrong.id])).toMatchObject({ status: "conflict", reasonCode: "wrong_lot" });
    expect(by[out.id]).toMatchObject({ status: "conflict", reasonCode: "out_of_tolerance" });
    expect(by[good.id].status).toBe("applied");
    const recs = await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, coconut.id));
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ isWithinTolerance: true, checkerId: null, operatorId: operator.ctx.userId });
    // The out-of-tolerance capture opened a deviation stub for QA and waits in review.
    const [conf] = await db.select().from(syncConflicts).where(eq(syncConflicts.syncCommandId, out.id));
    const devId = (conf.serverState as { deviationId?: string }).deviationId;
    expect(devId).toBeTruthy();
    const [dev] = await db.select().from(deviations).where(eq(deviations.id, devId!));
    expect(dev.batchId).toBe(batchId);
    // A device registered for counting only cannot replay weighings.
    const countOnly = await registerDevice(operator, manager, ["stock_count"]);
    const c = command(operator, "production.dispense_record.create", { batchId, batchMaterialId: palm.id, lotRef: palmLot, qty: "1", equipmentRef: "SC-01" });
    expect((await ok(operator, [c], countOnly.key)).results[0]).toMatchObject({ status: "rejected", errorCode: "DEVICE_NOT_ALLOWED" });
  });
});

describe("conflict review queue (US-7-05)", () => {
  async function parkedMove(qty = "100000") {
    const a01 = await loc(kit.nfd.id, "A-01");
    const lot = await makeLot(manager.ctx, kit.nfd.id, a01.id, "20");
    const c = command(warehouse, "inventory.movement.transfer", { lotId: lot.id, fromLocationId: a01.id, toLocationId: (await loc(kit.nfd.id, "A-02")).id, qty, reason: "Conflict review test" });
    const d = await ok(warehouse, [c], deviceA);
    expect(d.results[0].status).toBe("conflict");
    return { lot, conflictId: d.results[0].conflictId!, commandId: c.id };
  }

  it("visibility: the reviewer sees the site queue, the operator their own, an auditor reads, Site B sees nothing", async () => {
    const { conflictId } = await parkedMove();
    expect((await listConflicts(manager.ctx)).some((c) => c.id === conflictId)).toBe(true);
    expect((await listMyConflicts(warehouse.ctx)).some((c) => c.id === conflictId)).toBe(true);
    await expectCode(listConflicts(warehouse.ctx), "forbidden");
    const mine = await getConflict(warehouse.ctx, conflictId);
    expect(mine).toMatchObject({ isOwn: true, canResolve: false });
    expect((await getConflict(auditor.ctx, conflictId)).canResolve).toBe(false);
    await expectCode(getConflict(whRvs.ctx, conflictId), "not_found");
    await expectCode(getConflict(warehouse2.ctx, conflictId), "not_found");
  });

  it("offline.conflict_resolved_each_way: discard needs a note; self-resolution and role escalation are refused", async () => {
    const { conflictId } = await parkedMove();
    await expectCode(resolveConflict(manager.ctx, { conflictId, action: "discard", note: "no" }), "validation");
    await expectCode(resolveConflict(warehouse.ctx, { conflictId, action: "discard", note: "My own mistake" }), "separation_of_duties");
    await expectCode(resolveConflict(auditor.ctx, { conflictId, action: "discard", note: "Auditor tries" }), "forbidden");
    await expectCode(resolveConflict(managerRvs.ctx, { conflictId, action: "discard", note: "Other site tries" }), "not_found");
    const r = await resolveConflict(manager.ctx, { conflictId, action: "discard", note: "Server balance is right; the move never happened" });
    expect(r).toMatchObject({ ok: true, status: "resolved_discarded" });
    await expectCode(resolveConflict(manager.ctx, { conflictId, action: "discard", note: "Second time" }), "state");
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.sync_conflict.resolved"), eq(auditEvents.entityId, conflictId)));
    expect(ev.after).toMatchObject({ status: "resolved_discarded", choice: "discard" });
    expect(ev.reason).toBe("Server balance is right; the move never happened");
  });

  it("re-apply with corrected data creates a NEW audited command; the original is superseded, never re-run", async () => {
    const { lot, conflictId, commandId } = await parkedMove("100000");
    const a02 = await loc(kit.nfd.id, "A-02");
    // Unchanged data fails again: the conflict stays open and the attempt is recorded.
    const fail = await resolveConflict(manager.ctx, { conflictId, action: "reapply", note: "Try again as sent" });
    expect(fail.ok).toBe(false);
    expect((await db.select().from(syncConflicts).where(eq(syncConflicts.id, conflictId)))[0].status).toBe("open");
    const r = await resolveConflict(manager.ctx, { conflictId, action: "reapply", note: "Operator confirmed 12, typo on the phone", overrides: { qty: "12" } });
    expect(r).toMatchObject({ ok: true, status: "resolved_amended" });
    expect(await onHand(lot.id, a02.id)).toBe("12");
    const [c] = await db.select().from(syncConflicts).where(eq(syncConflicts.id, conflictId));
    expect(c.resolutionCommandId).toBeTruthy();
    const [orig] = await db.select().from(syncCommands).where(eq(syncCommands.id, commandId));
    expect(orig.status).toBe("superseded");
    const [res] = await db.select().from(syncCommands).where(eq(syncCommands.id, c.resolutionCommandId!));
    expect(res).toMatchObject({ status: "applied", userId: warehouse.ctx.userId, createdBy: manager.ctx.userId, resolutionOfConflictId: conflictId });
    // The posting is attributed to the system re-apply on behalf of the reviewer.
    const [mvAudit] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.sync_command.replay_accepted"), eq(auditEvents.entityId, res.id)));
    expect(mvAudit).toMatchObject({ actorLabel: "system:sync.reapply", onBehalfOf: manager.ctx.userId });
    // The original is never applied: a resend of the original batch answers superseded and posts nothing more.
    const resend = await ok(warehouse, [{ ...command(warehouse, "x.y.z", {}), id: commandId, idempotencyKey: orig.idempotencyKey, type: orig.commandType, payload: orig.payload as Record<string, unknown> }], deviceA);
    expect(resend.results[0].status).toBe("superseded");
    expect(await onHand(lot.id, a02.id)).toBe("12");
  });

  it("escalation creates a stock adjustment draft or a deviation and records it on the conflict", async () => {
    const one = await parkedMove();
    const adj = await resolveConflict(manager.ctx, { conflictId: one.conflictId, action: "escalate_adjustment", note: "Found 5 more than the system shows", direction: "increase", qty: "5", reasonCode: "found" });
    expect(adj).toMatchObject({ ok: true, status: "escalated" });
    const [c1] = await db.select().from(syncConflicts).where(eq(syncConflicts.id, one.conflictId));
    expect(c1.escalatedEntityType).toBe("stock_adjustment");
    const [a] = await db.select().from(stockAdjustments).where(eq(stockAdjustments.id, c1.escalatedEntityId!));
    expect(a.status).toBe("draft");
    const two = await parkedMove();
    const dev = await resolveConflict(manager.ctx, { conflictId: two.conflictId, action: "escalate_deviation", note: "Stock record and floor disagree; investigate" });
    expect(dev).toMatchObject({ ok: true, status: "escalated" });
    const [c2] = await db.select().from(syncConflicts).where(eq(syncConflicts.id, two.conflictId));
    expect(c2.escalatedEntityType).toBe("deviation");
  });
});

describe("reference cache, discards and diagnostics (US-7-01, US-7-06)", () => {
  it("offline.no_sensitive_cache: the reference payload has no price, cost, payroll or personal fields; cross-site is refused", async () => {
    const ref = await buildReference(warehouse.ctx, kit.nfd.id, deviceA);
    expect(ref.lots!.length).toBeGreaterThan(0);
    expect(ref.locations!.every((l) => l.siteId === kit.nfd.id)).toBe(true);
    expect(ref.lots!.every((l) => l.siteId === kit.nfd.id)).toBe(true);
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.add(k), walk(x));
    };
    walk(ref);
    const banned = [...keys].filter((k) => /price|cost|amount|salary|payroll|wage|email|phone|address|password|token|tax|credit/i.test(k));
    expect(banned).toEqual([]);
    await expectCode(buildReference(warehouse.ctx, kit.rvs.id, deviceA), "not_found");
    // A warehouse operator has no batches section (no dispensing permission).
    expect(ref.batches).toBeNull();
  });

  it("offline.logout_clears_cache: discarded queued commands are audited as platform.sync_command.discarded", async () => {
    const id = uuidv7();
    const r = await recordDiscardedCommands(warehouse.ctx, { reason: "signed_out", commands: [{ id, type: "inventory.stock_count.record", siteId: kit.nfd.id, clientCreatedAt: new Date().toISOString(), summary: "Count PKG-01", status: "pending" }] });
    expect(r.discarded).toBe(1);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "platform.sync_command.discarded"), eq(auditEvents.entityId, id)));
    expect(ev).toMatchObject({ actorId: warehouse.ctx.userId, reason: "signed_out" });
    await expectCode(recordDiscardedCommands(warehouse.ctx, { reason: "signed_out", commands: [] }), "validation");
  });

  it("diagnostics Sync card shows backlog, conflicts and devices as counts only", async () => {
    const admin = await actor("admin@bryels-care.test", ["system_admin"], [kit.nfd, kit.rvs]);
    const d = await syncDiagnostics(admin.ctx);
    expect(d.openConflicts).toBeGreaterThan(0);
    expect(d.devices.active).toBeGreaterThan(0);
    expect(d.applied24h).toBeGreaterThan(0);
    expect(JSON.stringify(d)).not.toMatch(/payload|deviceKey|token/i);
    await expectCode(syncDiagnostics(warehouse.ctx), "forbidden");
  });
});

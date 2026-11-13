/**
 * ADR-133 item 4 (ADR-130 §3, A-OFF-WGH-01): the Weigh card's no-signal path end to end. Save with no signal builds
 * the queued command (`queuedWeighCommand`, the same function the card uses), the phone's outbox accepts it under its
 * local checks (`enqueue`, fake-indexeddb), and the replay on the server records the weighing with how the lot was
 * confirmed (`lotVia`). A resend of the same command is answered from its stored result; a typed lot is refused on
 * replay while `scan.typed_code_counts_as_check` is off; a tap is never sent as a confirmation. Fictional data only.
 */
import "fake-indexeddb/auto";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { auditEvents, batchMaterials, batches, dispenseRecords, settings, users } from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { createSessionRecord } from "@/lib/auth/session-store";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { TYPING_IS_OFF } from "@/lib/scan/code-sql";
import { enqueue, toWire } from "@/lib/offline/outbox";
import type { AuthSnapshot } from "@/lib/offline/protocol";
import { activateDevice, requestDeviceRegistration } from "@/lib/offline/server/devices";
import { type ReplayResponse, replaySyncBatch } from "@/lib/offline/server/replay";
import { META, OfflineDb, setMeta } from "@/lib/offline/store";
import { queuedWeighCommand } from "@/lib/offline/weigh-queue";
import { createBatch, startBatch } from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { loadKit, type Kit } from "../../support/kit";
import { acapulcoRevisionId, allowDirectBatches, cleanEquipment, lotBySupplierLot, manilaDay, signChecklist, snapshotOf } from "../../support/w2b";

type Actor = { ctx: AuthContext; sessionId: string };
let kit: Kit;
let manager: Actor;
let operator: Actor;
let checker: Actor;
let deviceKey: string;
let deviceId: string;

async function actor(email: string, roles: string[], siteList: SiteRef[]): Promise<Actor> {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  const { session } = await createSessionRecord({ userId: u.id });
  const p = new Set(roles.flatMap((r) => ROLE_BUNDLES[r]?.permissions ?? []));
  const ctx = new AuthContext(u.id, kit.orgId, u.displayName, u.email, roles, p, siteList, siteList[0].id, { session: { id: session.id, reauthenticatedAt: null, mfaVerifiedAt: null, privileged: false } });
  return { ctx, sessionId: session.id };
}

/** The phone's sign-in snapshot (what the outbox checks before queuing). */
function phoneSnapshot(now: Date): AuthSnapshot {
  const H = 3_600_000;
  return {
    userId: operator.ctx.userId,
    displayName: operator.ctx.displayName,
    organizationId: kit.orgId,
    sessionId: operator.sessionId,
    issuedAt: new Date(now.getTime() - 60_000).toISOString(),
    expiresAt: new Date(now.getTime() + 12 * H).toISOString(),
    sessionExpiresAt: new Date(now.getTime() + 24 * H).toISOString(),
    currentSiteId: kit.nfd.id,
    sites: [{ id: kit.nfd.id, code: "NFD", name: kit.nfd.name }],
    permissions: { [kit.nfd.id]: ["production.dispense_record.create"] },
    siteWorkflows: { [kit.nfd.id]: ["dispensing"] },
    anonymousMovementRequests: { [kit.nfd.id]: false },
    device: { id: deviceId, status: "active", label: "Weigh tablet", siteId: kit.nfd.id, siteCode: "NFD", allowedWorkflows: ["dispensing"] },
    policy: { retryScheduleSeconds: [5, 30, 120, 600, 1800], maxAttempts: 3, maxQueueAgeHours: 72, snapshotMaxAgeHours: 12, fullRefreshAfterHours: 24, clockSkewFlagMinutes: 10 },
    serverTime: now.toISOString(),
  };
}

let phoneSeq = 0;
let phone: OfflineDb;

async function batchReadyToWeigh() {
  const { batchId } = await createBatch(manager.ctx, { formulaRevisionId: await acapulcoRevisionId(), plannedSizeKg: "17.6", plannedStartOn: manilaDay(0) });
  await startBatch(operator.ctx, batchId);
  await cleanEquipment(operator.ctx, "SC-01");
  const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
  await signChecklist(operator.ctx, checker.ctx, batchId, [...snapshotOf(b).steps].sort((x, y) => x.stepNo - y.stepNo)[0]);
  const lines = await db.select().from(batchMaterials).where(eq(batchMaterials.batchId, batchId)).orderBy(batchMaterials.lineNo);
  return { batchId, coconut: lines[0], palm: lines[1], coconutLot: (await lotBySupplierLot("LOS-24871")).lotNumber, palmLot: (await lotBySupplierLot("MPC-7731")).lotNumber };
}

/** Save with no signal: the card's command goes into the phone's outbox, then is sent as on reconnect. */
async function queueAndReplay(input: Parameters<typeof queuedWeighCommand>[0]) {
  const now = new Date();
  await setMeta(phone, META.snapshot, phoneSnapshot(now));
  const entry = await enqueue(phone, queuedWeighCommand(input), { now, sequence: () => ++phoneSeq });
  const wire = toWire(entry);
  const send = async () => {
    const r = await replaySyncBatch(operator.ctx, { body: { deviceSentAt: new Date().toISOString(), commands: [wire] }, deviceKey });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    if (!r.body.ok) throw new Error("not ok");
    return (r.body.data as ReplayResponse).results[0];
  };
  return { entry, wire, send };
}

const lotConfirmedOf = async (batchMaterialId: string) => {
  const recs = await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, batchMaterialId));
  return Promise.all(recs.map(async (r) => ((await db.select().from(auditEvents).where(and(eq(auditEvents.action, "production.dispense_record.recorded"), eq(auditEvents.entityId, r.id))))[0].after as { lotConfirmed: string }).lotConfirmed));
};

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  manager = await actor("manager.nfd@bryels-care.test", ["site_manager"], [kit.nfd]);
  operator = await actor("operator.nfd@bryels-care.test", ["production_operator"], [kit.nfd]);
  checker = await actor("checker.nfd@bryels-care.test", ["production_operator"], [kit.nfd]);
  deviceKey = randomBytes(32).toString("base64url");
  const reg = await requestDeviceRegistration(operator.ctx, { deviceKey, label: "Weigh tablet", platform: "android", deviceClass: "floor_shared", siteId: kit.nfd.id });
  deviceId = reg.deviceId;
  await activateDevice(manager.ctx, { deviceId, workflows: ["dispensing"] });
  await allowDirectBatches(kit);
  phone = new OfflineDb(`weigh-queue-${Date.now()}`);
}, 240_000);

afterEach(async () => {
  await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, "scan.typed_code_counts_as_check"), isNull(settings.siteId)));
});

describe("Weigh with no signal: queued on the phone, replayed with how the lot was confirmed", () => {
  it("the card's command passes the phone's checks; a typed lot replays as typed; a resend changes nothing", async () => {
    const w = await batchReadyToWeigh();
    const q = await queueAndReplay({ siteId: kit.nfd.id, batchId: w.batchId, batchMaterialId: w.coconut.id, materialName: "Coconut Oil", qty: "3723.2", unit: "g", lotCode: `BC:LOT:${w.coconutLot}`, lotNumber: w.coconutLot, lotVia: "typed", locationId: null, requiresScale: true, scale: "SC-01" });
    expect(q.entry.payload).toMatchObject({ lotRef: `BC:LOT:${w.coconutLot}`, lotVia: "typed", equipmentRef: "SC-01", uom: "g" });
    const first = await q.send();
    expect(first, JSON.stringify(first)).toMatchObject({ status: "applied" });
    expect(await lotConfirmedOf(w.coconut.id)).toEqual(["typed"]);
    // A resend after a lost answer (same id and key) is answered from the stored result.
    const again = await q.send();
    expect(again.status).toBe("applied");
    expect(await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, w.coconut.id))).toHaveLength(1);
  });

  it("a scanned lot replays as scan; a tap is not sent as a confirmation", async () => {
    const w = await batchReadyToWeigh();
    const tapped = queuedWeighCommand({ siteId: kit.nfd.id, batchId: w.batchId, batchMaterialId: w.palm.id, materialName: "Palm Oil", qty: "1", unit: "g", lotCode: "", lotNumber: w.palmLot, lotVia: "tap", locationId: null, requiresScale: false, scale: "SC-01" });
    expect(tapped.payload).toMatchObject({ lotRef: `BC:LOT:${w.palmLot}`, equipmentRef: null });
    expect(tapped.payload.lotVia).toBeUndefined();
    const q = await queueAndReplay({ siteId: kit.nfd.id, batchId: w.batchId, batchMaterialId: w.coconut.id, materialName: "Coconut Oil", qty: "3723.2", unit: "g", lotCode: `BC:LOT:${w.coconutLot}`, lotNumber: w.coconutLot, lotVia: "scan", locationId: null, requiresScale: true, scale: "SC-01" });
    expect((await q.send()).status).toBe("applied");
    expect(await lotConfirmedOf(w.coconut.id)).toEqual(["scan"]);
  });

  it("typing turned off while the weighing waited on the phone: the typed lot is refused on replay, nothing is recorded", async () => {
    const w = await batchReadyToWeigh();
    const q = await queueAndReplay({ siteId: kit.nfd.id, batchId: w.batchId, batchMaterialId: w.coconut.id, materialName: "Coconut Oil", qty: "3723.2", unit: "g", lotCode: `BC:LOT:${w.coconutLot}`, lotNumber: w.coconutLot, lotVia: "typed", locationId: null, requiresScale: true, scale: "SC-01" });
    await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: "scan.typed_code_counts_as_check", value: false });
    const r = await q.send();
    expect(r, JSON.stringify(r)).toMatchObject({ status: "rejected", reasonCode: "validation_failed" });
    expect(r.errorMessage).toBe(TYPING_IS_OFF);
    expect(await db.select().from(dispenseRecords).where(eq(dispenseRecords.batchMaterialId, w.coconut.id))).toHaveLength(0);
  });
});

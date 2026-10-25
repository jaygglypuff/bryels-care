/**
 * W4D device outbox and retry rules (US-7-02, US-7-03; docs/offline-sync.md §4.1, §4.2) on
 * fake-indexeddb with a fixed clock: persistence across restarts, FIFO batches with stable ids and
 * keys, the A-OFF-08 backoff and attempt limit, terminal server decisions, dependency_failed,
 * expired-session and snapshot-age blocking, and the wipe at sign-out.
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { OFFLINE_WORKFLOWS as SCHEMA_WORKFLOWS, SYNC_CONFLICT_REASONS as SCHEMA_REASONS } from "@/db/schema/offline";
import { OfflineRefused, type Transport, type TransportResult, dueBatch, enqueue, flush, outboxStats, recoverInterrupted, resetForSyncNow, unsentCommands } from "@/lib/offline/outbox";
import { canQueueOffline, isReferenceStale, isTransientStatus, queueAgeWarning, retryDelayMs } from "@/lib/offline/policy";
import { OFFLINE_WORKFLOWS, SYNC_CONFLICT_REASONS, type AuthSnapshot, type SyncCommandWire } from "@/lib/offline/protocol";
import { deviceIdentity, nextSequence, resetDeviceIdentity } from "@/lib/offline/device";
import { saveReference } from "@/lib/offline/reference-cache";
import { META, OfflineDb, setMeta, wipe } from "@/lib/offline/store";

const SITE = "0199f6a2-1c2b-7d3e-8f40-123456789abc";
const OTHER = "0199f6a2-1c2b-7d3e-8f40-123456789abd";
const T0 = new Date("2026-10-25T08:00:00Z");
const H = 3_600_000;

function snapshot(o: Partial<AuthSnapshot> = {}, at = T0): AuthSnapshot {
  return {
    userId: "0199f6a2-1c2b-7d3e-8f40-0000000000aa",
    displayName: "Lito Pascual",
    organizationId: "0199f6a2-1c2b-7d3e-8f40-0000000000bb",
    sessionId: "0199f6a2-1c2b-7d3e-8f40-0000000000cc",
    issuedAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + 12 * H).toISOString(),
    sessionExpiresAt: new Date(at.getTime() + 24 * H).toISOString(),
    currentSiteId: SITE,
    sites: [{ id: SITE, code: "NFD", name: "North Fields Plant" }],
    permissions: { [SITE]: ["inventory.stock_count.submit", "inventory.movement.post", "production.dispense_record.create"] },
    siteWorkflows: { [SITE]: ["movement_request", "dispensing", "stock_count"] },
    anonymousMovementRequests: { [SITE]: true },
    device: { id: "0199f6a2-1c2b-7d3e-8f40-0000000000dd", status: "active", label: "Tablet 1", siteId: SITE, siteCode: "NFD", allowedWorkflows: ["stock_count", "dispensing"] },
    policy: { retryScheduleSeconds: [5, 30, 120, 600, 1800], maxAttempts: 3, maxQueueAgeHours: 72, snapshotMaxAgeHours: 12, fullRefreshAfterHours: 24, clockSkewFlagMinutes: 10 },
    serverTime: at.toISOString(),
    ...o,
  };
}

let dbSeq = 0;
async function freshDb(snap: AuthSnapshot | null = snapshot()) {
  const name = `test-offline-${++dbSeq}`;
  const db = new OfflineDb(name);
  if (snap) await setMeta(db, META.snapshot, snap);
  return { db, name };
}

let seq = 0;
const countPayload = () => ({ countId: uuidv7(), locationId: uuidv7(), lotId: uuidv7(), qty: "12" });
const add = (db: OfflineDb, now = T0, extra: Partial<Parameters<typeof enqueue>[1]> = {}) =>
  enqueue(db, { type: "inventory.stock_count.record", payload: countPayload(), siteId: SITE, summary: "Count line", ...extra }, { now, sequence: () => ++seq });

/** A transport that records what it was sent and answers from a script. */
function scripted(answers: ((cmds: SyncCommandWire[]) => TransportResult)[]) {
  const calls: SyncCommandWire[][] = [];
  const t: Transport = async (cmds) => {
    calls.push(cmds);
    const a = answers.shift();
    if (!a) throw new Error("unexpected send");
    return a(cmds);
  };
  return { t, calls };
}
const allApplied = (cmds: SyncCommandWire[]): TransportResult => ({ kind: "ok", results: cmds.map((c) => ({ id: c.id, status: "applied" as const })), snapshot: snapshot(), permissionsChanged: false });

describe("retry schedule and policy (A-OFF-08, A-OFF-02)", () => {
  it("waits 5 s, 30 s, 2 min, 10 min, 30 min, then 30 min again, each ±20 %", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map((n) => retryDelayMs(n, undefined, 0.5))).toEqual([5000, 30000, 120000, 600000, 1800000, 1800000, 1800000]);
    expect(retryDelayMs(1, undefined, 0)).toBe(4000);
    expect(retryDelayMs(1, undefined, 0.99999999)).toBeLessThanOrEqual(6000);
    expect(retryDelayMs(2, [7], 0.5)).toBe(7000);
  });

  it("treats timeouts, 429 and 5xx as transient; other answers are decisions", () => {
    expect([408, 429, 500, 502, 503].every(isTransientStatus)).toBe(true);
    expect([400, 401, 403, 404, 409, 422].some(isTransientStatus)).toBe(false);
  });

  it("offline.auth_snapshot_too_old / expired session / device grant / permission decide whether work may be queued", () => {
    const s = snapshot();
    expect(canQueueOffline(null, "inventory.stock_count.record", SITE, T0)).toMatchObject({ ok: false, code: "no_snapshot" });
    expect(canQueueOffline(s, "inventory.stock_count.record", SITE, new Date(T0.getTime() + H)).ok).toBe(true);
    expect(canQueueOffline(s, "inventory.stock_count.record", SITE, new Date(T0.getTime() + 12 * H + 1))).toMatchObject({ ok: false, code: "snapshot_expired" });
    expect(canQueueOffline(snapshot({ sessionExpiresAt: new Date(T0.getTime() + H).toISOString() }), "inventory.stock_count.record", SITE, new Date(T0.getTime() + 2 * H))).toMatchObject({ ok: false, code: "session_expired" });
    expect(canQueueOffline(s, "quality.disposition.approve", SITE, T0)).toMatchObject({ ok: false, code: "not_offline_capable" });
    expect(canQueueOffline(s, "inventory.stock_count.record", OTHER, T0)).toMatchObject({ ok: false, code: "site_not_allowed" });
    // The device is granted counting and weighing but not moves; moves fall back to nothing because the device is registered.
    expect(canQueueOffline(s, "inventory.movement.transfer", SITE, T0)).toMatchObject({ ok: false, code: "device_not_registered" });
    // Unregistered browser: moves only (A-OFF-03), never counting.
    const anon = snapshot({ device: null });
    expect(canQueueOffline(anon, "inventory.movement.transfer", SITE, T0).ok).toBe(true);
    expect(canQueueOffline(anon, "inventory.stock_count.record", SITE, T0)).toMatchObject({ ok: false, code: "device_not_registered" });
    expect(canQueueOffline(snapshot({ device: { ...s.device!, status: "suspended" } }), "inventory.stock_count.record", SITE, T0)).toMatchObject({ ok: false, code: "device_not_registered" });
    expect(canQueueOffline(snapshot({ siteWorkflows: { [SITE]: ["dispensing"] } }), "inventory.stock_count.record", SITE, T0)).toMatchObject({ ok: false, code: "workflow_not_allowed" });
    expect(canQueueOffline(snapshot({ permissions: { [SITE]: [] } }), "inventory.stock_count.record", SITE, T0)).toMatchObject({ ok: false, code: "permission_missing" });
  });

  it("warns before the queue age limit (A-OFF-09) and marks reference data stale after 24 h (A-OFF-01)", () => {
    const created = T0.toISOString();
    expect(queueAgeWarning(created, new Date(T0.getTime() + 10 * H), 72)).toBeNull();
    expect(queueAgeWarning(created, new Date(T0.getTime() + 60 * H), 72)).toEqual({ hoursLeft: 12, expired: false });
    expect(queueAgeWarning(created, new Date(T0.getTime() + 73 * H), 72)).toEqual({ hoursLeft: 0, expired: true });
    expect(isReferenceStale(null, T0, 24)).toBe(true);
    expect(isReferenceStale(new Date(T0.getTime() - 23 * H).toISOString(), T0, 24)).toBe(false);
    expect(isReferenceStale(new Date(T0.getTime() - 25 * H).toISOString(), T0, 24)).toBe(true);
  });

  it("device and server catalogues agree", () => {
    expect([...OFFLINE_WORKFLOWS]).toEqual([...SCHEMA_WORKFLOWS]);
    expect([...SYNC_CONFLICT_REASONS]).toEqual([...SCHEMA_REASONS]);
  });
});

describe("outbox (US-7-02)", () => {
  it("refuses to queue with an expired snapshot or an invalid payload; keeps the queue", async () => {
    const { db } = await freshDb();
    await expect(add(db, new Date(T0.getTime() + 13 * H))).rejects.toBeInstanceOf(OfflineRefused);
    await expect(enqueue(db, { type: "inventory.stock_count.record", payload: { countId: "x" }, siteId: SITE, summary: "bad" }, { now: T0, sequence: () => ++seq })).rejects.toMatchObject({ code: "validation" });
    expect(await db.outbox.count()).toBe(0);
  });

  it("offline.tab_closed_pending / offline.app_restart: queued commands survive a new store instance and flush once, in order", async () => {
    const { db, name } = await freshDb();
    const a = await add(db);
    const b = await add(db);
    const c = await add(db);
    db.close();
    const reopened = new OfflineDb(name);
    expect(await reopened.outbox.count()).toBe(3);
    const s = scripted([allApplied]);
    const sum = await flush(reopened, { transport: s.t, now: () => T0 });
    expect(sum).toMatchObject({ sent: 3, synced: 3 });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].map((x) => x.id)).toEqual([a.id, b.id, c.id]);
    expect(s.calls[0][0]).toMatchObject({ idempotencyKey: a.idempotencyKey, authSnapshotUserId: snapshot().userId, clientSequence: a.sequence });
    expect(await flush(reopened, { transport: s.t, now: () => T0 })).toMatchObject({ sent: 0 });
  });

  it("a command left `syncing` by a crash goes back to pending and is resent with the same id and key", async () => {
    const { db } = await freshDb();
    const a = await add(db);
    await db.outbox.update(a.id, { status: "syncing" });
    await recoverInterrupted(db);
    const s = scripted([allApplied]);
    await flush(db, { transport: s.t, now: () => T0 });
    expect(s.calls[0][0]).toMatchObject({ id: a.id, idempotencyKey: a.idempotencyKey });
  });

  it("offline.partial_connectivity / replay_after_lost_response: a transport failure backs off and resends the batch unchanged", async () => {
    const { db } = await freshDb();
    const a = await add(db);
    const s = scripted([() => ({ kind: "transient", message: "the request timed out" }), allApplied]);
    const first = await flush(db, { transport: s.t, now: () => T0, random: () => 0.5 });
    expect(first).toMatchObject({ sent: 1, retrying: 1, transportError: "the request timed out" });
    const row = await db.outbox.get(a.id);
    expect(row).toMatchObject({ status: "pending", attempts: 1, nextAttemptAt: T0.getTime() + 5000 });
    // Not due yet: nothing is sent.
    expect((await flush(db, { transport: s.t, now: () => new Date(T0.getTime() + 4000) })).sent).toBe(0);
    await flush(db, { transport: s.t, now: () => new Date(T0.getTime() + 5000) });
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1][0]).toEqual(s.calls[0][0]);
    expect((await db.outbox.get(a.id))?.status).toBe("synced");
  });

  it("offline.retry_max_attempts_failed: after max attempts the command is `failed` and no longer sent; Sync now gives it one fresh budget", async () => {
    const { db } = await freshDb();
    const a = await add(db);
    const fail = () => ({ kind: "transient", message: "no connection" }) as TransportResult;
    const s = scripted([fail, fail, fail, allApplied]);
    let t = T0.getTime();
    for (let i = 0; i < 3; i++) {
      await flush(db, { transport: s.t, now: () => new Date(t), random: () => 0.5 });
      t += 2 * H;
    }
    expect(await db.outbox.get(a.id)).toMatchObject({ status: "failed", attempts: 3 });
    expect((await flush(db, { transport: s.t, now: () => new Date(t + 10 * H) })).sent).toBe(0);
    expect(s.calls).toHaveLength(3);
    expect((await outboxStats(db)).failed).toBe(1);
    await resetForSyncNow(db, new Date(t));
    await flush(db, { transport: s.t, now: () => new Date(t) });
    expect(s.calls).toHaveLength(4);
    expect((await db.outbox.get(a.id))?.status).toBe("synced");
  });

  it("a server decision is final: a conflict is never resent; `retry` answers back off", async () => {
    const { db } = await freshDb();
    const a = await add(db);
    const b = await add(db);
    const s = scripted([
      (cmds) => ({
        kind: "ok",
        results: [
          { id: cmds[0].id, status: "conflict", reasonCode: "count_closed", errorMessage: "Count closed", conflictId: uuidv7() },
          { id: cmds[1].id, status: "retry", errorMessage: "Read-only window" },
        ],
        snapshot: snapshot(),
        permissionsChanged: true,
      }),
      allApplied,
    ]);
    const sum = await flush(db, { transport: s.t, now: () => T0, random: () => 0.5 });
    expect(sum).toMatchObject({ conflicts: 1, retrying: 1, permissionsChanged: true });
    expect(await db.outbox.get(a.id)).toMatchObject({ status: "conflict", reasonCode: "count_closed", lastError: "Count closed" });
    await flush(db, { transport: s.t, now: () => new Date(T0.getTime() + 10_000) });
    expect(s.calls[1].map((x) => x.id)).toEqual([b.id]);
  });

  it("offline.dependency_failed: a command depending on a conflicted one is closed locally and never sent", async () => {
    const { db } = await freshDb();
    const a = await add(db);
    await db.outbox.update(a.id, { status: "conflict" });
    const b = await add(db, T0, { dependsOn: a.id });
    const c = await add(db);
    const due = await dueBatch(db, T0);
    expect(due.map((x) => x.id)).toEqual([c.id]);
    expect(await db.outbox.get(b.id)).toMatchObject({ status: "conflict", reasonCode: "dependency_failed" });
  });

  it("offline.expired_session: a 401 keeps the queue pending without spending attempts", async () => {
    const { db } = await freshDb();
    const a = await add(db);
    const s = scripted([() => ({ kind: "unauthenticated" })]);
    const sum = await flush(db, { transport: s.t, now: () => T0 });
    expect(sum.needsSignIn).toBe(true);
    expect(await db.outbox.get(a.id)).toMatchObject({ status: "pending", attempts: 0 });
    expect(await unsentCommands(db)).toHaveLength(1);
  });

  it("a refused batch (HTTP 4xx) is terminal on the device", async () => {
    const { db } = await freshDb();
    const a = await add(db);
    const s = scripted([() => ({ kind: "refused", status: 422, message: "The sync batch is malformed." })]);
    await flush(db, { transport: s.t, now: () => T0 });
    expect(await db.outbox.get(a.id)).toMatchObject({ status: "conflict", errorCode: "HTTP_422" });
  });

  it("offline.logout_clears_cache: wipe leaves no business rows; the device identity survives with a monotonic sequence", async () => {
    const { db } = await freshDb();
    await add(db);
    await saveReference(db, {
      siteId: SITE,
      generatedAt: T0.toISOString(),
      full: true,
      cursor: T0.toISOString(),
      materials: [{ id: uuidv7(), code: "MAT-0012", name: "Coconut Oil", baseUom: "g", materialKind: "raw_material" }],
      locations: [{ id: uuidv7(), siteId: SITE, code: "A-01", name: "Oils rack", kind: "storage", isActive: true }],
      lots: [],
      counts: [],
      batches: [],
    });
    expect(await db.materials.count()).toBe(1);
    await wipe(db);
    for (const t of [db.outbox, db.meta, db.materials, db.locations, db.lots, db.counts, db.batches, db.syncLog]) expect(await t.count()).toBe(0);

    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const id = deviceIdentity(ls);
    expect(id.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect([nextSequence(ls), nextSequence(ls), nextSequence(ls)]).toEqual([1, 2, 3]);
    resetDeviceIdentity(ls);
    expect(deviceIdentity(ls).key).not.toBe(id.key);
    expect(nextSequence(ls)).toBe(4);
  });
});

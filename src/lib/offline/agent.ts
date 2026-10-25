/**
 * The sync agent: one per browser tab. Owns the local store, flushes the outbox on the `online`
 * event, when the tab comes back to the foreground, on a timer while online and on "Sync now"
 * (docs/offline-sync.md §4.1), refreshes the authorization snapshot on every sync and every 30 min,
 * and publishes a small state object for the sync chip and panel (useSyncExternalStore).
 *
 * People and devices: when a different person signs in, the previous person's unsent work is sent
 * once (the server parks it for review, never applying it under the new sign-in) and the store is
 * wiped; when an administrator removed the device, the same happens and the device key is replaced.
 */
import { deviceIdentity, nextSequence, resetDeviceIdentity } from "./device";
import { type EnqueueInput, OfflineRefused, enqueue, flush, outboxStats, pruneSynced, recoverInterrupted, resetForSyncNow, restartSchedule, unsentCommands } from "./outbox";
import type { OutboxStats } from "./outbox";
import { isReferenceStale } from "./policy";
import type { AuthSnapshot } from "./protocol";
import { referenceTimes, saveReference } from "./reference-cache";
import { META, OFFLINE_DB_NAME, OfflineDb, type OutboxEntry, getMeta, getSnapshot, log, setMeta, wipe } from "./store";
import { TransportError, fetchReference, fetchSnapshot, httpTransport, postDiscards, requestRegistration } from "./transport";

export type SyncState = {
  ready: boolean;
  supported: boolean;
  online: boolean;
  syncing: boolean;
  needsSignIn: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  stats: OutboxStats;
  snapshot: AuthSnapshot | null;
  referenceAt: Record<string, string>;
  permissionsChangedAt: string | null;
  /** Unsent changes of the previous person, sent for supervisor review at the change of person. */
  handedOver: number;
  deviceKey: string | null;
};

const EMPTY_STATS: OutboxStats = { pending: 0, syncing: 0, synced: 0, failed: 0, conflict: 0, oldestPendingAt: null };
const INITIAL: SyncState = {
  ready: false,
  supported: true,
  online: true,
  syncing: false,
  needsSignIn: false,
  lastSyncAt: null,
  lastError: null,
  stats: EMPTY_STATS,
  snapshot: null,
  referenceAt: {},
  permissionsChangedAt: null,
  handedOver: 0,
  deviceKey: null,
};

const TICK_MS = 15_000;
const SNAPSHOT_REFRESH_MS = 30 * 60_000;

class SyncAgent {
  private state: SyncState = INITIAL;
  private listeners = new Set<() => void>();
  private db: OfflineDb | null = null;
  private starting: Promise<void> | null = null;
  private flushing: Promise<void> | null = null;
  private lastSnapshotAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  private set(p: Partial<SyncState>) {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  private store(): OfflineDb {
    if (!this.db) this.db = new OfflineDb(OFFLINE_DB_NAME);
    return this.db;
  }

  get deviceKey(): string {
    return deviceIdentity(localStorage).key;
  }

  /** Starts once per tab. `expectedUserId` is the person the server says is signed in (null on the offline page). */
  start(expectedUserId: string | null = null): Promise<void> {
    if (typeof window === "undefined") return Promise.resolve();
    if (!("indexedDB" in window)) {
      this.set({ supported: false, ready: true });
      return Promise.resolve();
    }
    if (!this.starting) this.starting = this.boot(expectedUserId);
    else if (expectedUserId) void this.starting.then(() => this.checkPerson(expectedUserId));
    return this.starting;
  }

  private async boot(expectedUserId: string | null) {
    const db = this.store();
    await recoverInterrupted(db);
    this.set({ online: navigator.onLine, deviceKey: this.deviceKey });
    if (expectedUserId) await this.checkPerson(expectedUserId);
    await this.refreshState();
    this.set({ ready: true });
    window.addEventListener("online", () => {
      this.set({ online: true });
      void restartSchedule(this.store(), new Date()).then(() => this.flushNow());
    });
    window.addEventListener("offline", () => this.set({ online: false }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.flushNow();
    });
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    if (navigator.onLine) await this.refreshSnapshot().catch(() => undefined);
    await this.flushNow();
  }

  private async tick() {
    if (!navigator.onLine) return;
    if (Date.now() - this.lastSnapshotAt > SNAPSHOT_REFRESH_MS) await this.refreshSnapshot().catch(() => undefined);
    await this.flushNow();
    await this.autoRefreshReference().catch(() => undefined);
  }

  /** A change of person on the device: hand the previous person's unsent work to review, then wipe. */
  private async checkPerson(userId: string) {
    const db = this.store();
    const stored = await getSnapshot(db);
    if (stored && stored.userId !== userId) {
      const unsent = await unsentCommands(db);
      if (unsent.length && navigator.onLine) {
        await resetForSyncNow(db, new Date());
        await flush(db, { transport: httpTransport(() => this.deviceKey), now: () => new Date() }).catch(() => undefined);
      }
      const left = await unsentCommands(db);
      await wipe(db);
      await log(db, "reset", `signed-in person changed; ${unsent.length - left.length} unsent change(s) sent for review`);
      this.set({ handedOver: unsent.length - left.length, snapshot: null, referenceAt: {} });
    }
  }

  async refreshState() {
    const db = this.store();
    await pruneSynced(db, new Date());
    this.set({
      stats: await outboxStats(db),
      snapshot: await getSnapshot(db),
      referenceAt: await referenceTimes(db),
      lastSyncAt: await getMeta<string>(db, META.lastSyncAt),
      permissionsChangedAt: await getMeta<string>(db, META.permissionsChanged),
    });
  }

  /** GET /api/v1/sync/snapshot; handles device removal and expired sessions. */
  async refreshSnapshot(): Promise<AuthSnapshot | null> {
    const db = this.store();
    try {
      let snap = await fetchSnapshot(this.deviceKey);
      this.lastSnapshotAt = Date.now();
      const stored = await getSnapshot(db);
      if (stored && stored.userId !== snap.userId) await this.checkPerson(snap.userId);
      if (snap.device?.status === "removed") {
        // docs/offline-sync.md §6: device removal clears the local store on next open.
        await resetForSyncNow(db, new Date());
        await flush(db, { transport: httpTransport(() => this.deviceKey), now: () => new Date() }).catch(() => undefined);
        await wipe(db);
        resetDeviceIdentity(localStorage);
        await log(db, "reset", "device removed by an administrator; local data cleared and a new device key created");
        snap = await fetchSnapshot(this.deviceKey);
      }
      await setMeta(db, META.snapshot, snap);
      this.set({ online: true, needsSignIn: false, lastError: null, deviceKey: this.deviceKey });
      await this.refreshState();
      return snap;
    } catch (e) {
      if (e instanceof TransportError && e.kind === "unauthenticated") {
        // An expired session blocks new offline work at once (docs/offline-sync.md §2); the queue is kept.
        const stored = await getSnapshot(db);
        if (stored) await setMeta(db, META.snapshot, { ...stored, sessionExpiresAt: new Date().toISOString() });
        this.set({ needsSignIn: true });
        await this.refreshState();
        return null;
      }
      if (e instanceof TransportError && e.kind === "network") this.set({ online: false });
      throw e;
    }
  }

  async flushNow(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      const db = this.store();
      this.set({ syncing: true });
      try {
        const sum = await flush(db, { transport: httpTransport(() => this.deviceKey), now: () => new Date() });
        if (sum.sent) this.set({ online: !sum.transportError, needsSignIn: sum.needsSignIn, lastError: sum.transportError ? `Could not reach the server: ${sum.transportError}` : null });
      } catch (e) {
        this.set({ lastError: e instanceof Error ? e.message : "Sync failed" });
      } finally {
        await this.refreshState();
        this.set({ syncing: false });
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  /** "Sync now": failed commands get one fresh attempt budget, then flush, then refresh the snapshot and cached data. */
  async syncNow(siteId?: string) {
    await resetForSyncNow(this.store(), new Date());
    await this.flushNow();
    await this.refreshSnapshot().catch(() => undefined);
    const site = siteId ?? this.state.snapshot?.currentSiteId;
    if (site && this.state.referenceAt[site]) await this.refreshReference(site).catch(() => undefined);
  }

  async refreshReference(siteId: string) {
    const ref = await fetchReference(siteId, this.deviceKey);
    await saveReference(this.store(), ref);
    await this.refreshState();
  }

  /** Refreshes cached data the person already downloaded once, when older than the full-refresh window (A-OFF-01). */
  private async autoRefreshReference() {
    const snap = this.state.snapshot;
    if (!snap) return;
    for (const [siteId, at] of Object.entries(this.state.referenceAt)) {
      if (isReferenceStale(at, new Date(), snap.policy.fullRefreshAfterHours)) await this.refreshReference(siteId);
    }
  }

  async enqueue(input: EnqueueInput): Promise<OutboxEntry> {
    const entry = await enqueue(this.store(), input, { now: new Date(), sequence: () => nextSequence(localStorage) });
    await this.refreshState();
    if (navigator.onLine) void this.flushNow();
    return entry;
  }

  async registerDevice(a: { label: string; deviceClass: string; siteId: string }) {
    const ua = navigator.userAgent;
    const platform = /android/i.test(ua) ? "android" : /iphone|ipad|ipod/i.test(ua) ? "ios" : /windows/i.test(ua) ? "windows" : /mac os/i.test(ua) ? "macos" : "other";
    const browser = /edg\//i.test(ua) ? "Edge" : /chrome|crios/i.test(ua) ? "Chrome" : /firefox|fxios/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : null;
    const r = await requestRegistration({ deviceKey: this.deviceKey, label: a.label, platform, browser, deviceClass: a.deviceClass, siteId: a.siteId });
    await this.refreshSnapshot().catch(() => undefined);
    return r;
  }

  async unsent(): Promise<OutboxEntry[]> {
    return unsentCommands(this.store());
  }

  async listQueue(): Promise<OutboxEntry[]> {
    return (await this.store().outbox.toArray()).sort((a, b) => b.sequence - a.sequence);
  }

  /** Removes one unsent command from the queue (audited on the server as `platform.sync_command.discarded`). */
  async removeFromQueue(id: string) {
    const db = this.store();
    const e = await db.outbox.get(id);
    if (!e || (e.status !== "pending" && e.status !== "failed")) throw new OfflineRefused("state", "Only changes that were not sent can be removed.");
    await postDiscards({ reason: "removed_from_queue", commands: [{ id: e.id, type: e.type, siteId: e.siteId, clientCreatedAt: e.createdAt, summary: e.summary, status: e.status }] }, this.deviceKey);
    await db.outbox.delete(id);
    await this.refreshState();
  }

  /** Support bundle of unsent work (A-OFF-06): a JSON file the person can hand to IT before signing out. */
  async supportBundle(): Promise<Blob> {
    const db = this.store();
    const snap = await getSnapshot(db);
    const body = { exportedAt: new Date().toISOString(), person: snap ? { userId: snap.userId, name: snap.displayName } : null, device: snap?.device ?? null, unsent: await unsentCommands(db), log: await db.syncLog.toArray() };
    return new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
  }

  /**
   * Sign-out (US-7-06, `offline.logout_clears_cache`): the listed unsent commands are discarded with an
   * audit row on the server first; then the local store and the runtime caches are deleted. Throws when
   * the audit cannot be written (offline): sign-out needs a connection anyway.
   */
  async clearForSignOut(discard: OutboxEntry[]) {
    if (discard.length) {
      await postDiscards({ reason: "signed_out", commands: discard.map((e) => ({ id: e.id, type: e.type, siteId: e.siteId, clientCreatedAt: e.createdAt, summary: e.summary, status: e.status })) }, this.deviceKey);
    }
    if (this.timer) clearInterval(this.timer);
    const db = this.store();
    await wipe(db);
    db.close();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    this.db = null;
    if ("caches" in window) {
      for (const name of await caches.keys()) if (!name.includes("precache")) await caches.delete(name);
    }
    this.state = { ...INITIAL, ready: true, deviceKey: this.deviceKey };
    for (const l of this.listeners) l();
  }

  /** Cached reference rows for capture screens. */
  async reference() {
    const db = this.store();
    return { materials: await db.materials.toArray(), locations: await db.locations.toArray(), lots: await db.lots.toArray(), counts: await db.counts.toArray(), batches: await db.batches.toArray() };
  }
}

let agent: SyncAgent | null = null;
export function syncAgent(): SyncAgent {
  if (!agent) agent = new SyncAgent();
  return agent;
}
export const SERVER_STATE: SyncState = INITIAL;
export { OfflineRefused };

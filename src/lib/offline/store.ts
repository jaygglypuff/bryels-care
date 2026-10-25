/**
 * The device's local store (IndexedDB via Dexie; ADR-018, docs/offline-sync.md §2). Business data
 * only: reference tables for the signed-in person's sites, their own outbox and a short sync log.
 * Deleted on sign-out, on a change of person and when an administrator removes the device
 * (`offline.logout_clears_cache`). No prices, costs, payroll or personal data are ever stored.
 */
import Dexie, { type Table } from "dexie";
import type { AuthSnapshot, ReferenceBatch, ReferenceCount, ReferenceLocation, ReferenceLot, ReferenceMaterial, SyncConflictReason } from "./protocol";

export const OFFLINE_DB_NAME = "bryels-care-offline";

/** Device-side outbox status (docs/offline-sync.md §4.2). */
export type OutboxStatus = "pending" | "syncing" | "synced" | "failed" | "conflict";

export type OutboxEntry = {
  id: string;
  idempotencyKey: string;
  type: string;
  payload: Record<string, unknown>;
  siteId: string;
  /** Plain-language line for the queue and the logout warning, e.g. "Count CNT-26-0001 · A-01 · 12 pcs". */
  summary: string;
  createdAt: string;
  sequence: number;
  dependsOn: string | null;
  authSnapshotIssuedAt: string;
  authSnapshotSessionId: string | null;
  authSnapshotUserId: string;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms of the next send attempt. */
  nextAttemptAt: number;
  lastError: string | null;
  errorCode: string | null;
  reasonCode: SyncConflictReason | null;
  conflictId: string | null;
  appliedEntityNumber: string | null;
  updatedAt: string;
};

export type MetaRow = { key: string; value: unknown };
export type SyncLogRow = { id?: number; at: string; kind: "flush" | "refresh" | "discard" | "reset" | "error"; detail: string };

export class OfflineDb extends Dexie {
  outbox!: Table<OutboxEntry, string>;
  meta!: Table<MetaRow, string>;
  materials!: Table<ReferenceMaterial, string>;
  locations!: Table<ReferenceLocation, string>;
  lots!: Table<ReferenceLot, string>;
  counts!: Table<ReferenceCount, string>;
  batches!: Table<ReferenceBatch, string>;
  syncLog!: Table<SyncLogRow, number>;

  constructor(name = OFFLINE_DB_NAME, deps?: { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange }) {
    super(name, deps);
    this.version(1).stores({
      outbox: "id, status, sequence, siteId",
      meta: "key",
      materials: "id, code",
      locations: "id, siteId, code",
      lots: "id, siteId, lotNumber, materialId",
      counts: "id, siteId",
      batches: "id, siteId",
      syncLog: "++id, at",
    });
  }
}

export const META = {
  snapshot: "snapshot",
  /** siteId → ISO time of the last full reference refresh. */
  reference: "reference",
  lastSyncAt: "last_sync_at",
  permissionsChanged: "permissions_changed",
} as const;

export async function getMeta<T>(db: OfflineDb, key: string): Promise<T | null> {
  return ((await db.meta.get(key))?.value as T | undefined) ?? null;
}
export async function setMeta(db: OfflineDb, key: string, value: unknown) {
  await db.meta.put({ key, value });
}

export const getSnapshot = (db: OfflineDb) => getMeta<AuthSnapshot>(db, META.snapshot);

export async function log(db: OfflineDb, kind: SyncLogRow["kind"], detail: string, now = new Date()) {
  await db.syncLog.add({ at: now.toISOString(), kind, detail: detail.slice(0, 300) });
  const n = await db.syncLog.count();
  if (n > 200) {
    const old = await db.syncLog.orderBy("id").limit(n - 200).primaryKeys();
    await db.syncLog.bulkDelete(old);
  }
}

/** Removes every business table of the device (sign-out, change of person, device removed). */
export async function wipe(db: OfflineDb) {
  await db.transaction("rw", [db.outbox, db.meta, db.materials, db.locations, db.lots, db.counts, db.batches, db.syncLog], async () => {
    await Promise.all([db.outbox.clear(), db.meta.clear(), db.materials.clear(), db.locations.clear(), db.lots.clear(), db.counts.clear(), db.batches.clear(), db.syncLog.clear()]);
  });
}

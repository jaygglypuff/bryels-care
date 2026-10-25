/**
 * Reference cache on the device (US-7-01, docs/offline-sync.md §7). A refresh replaces the site's
 * rows in one transaction and records when it happened, so screens show "data as of <time>" and a
 * cache older than `offline.full_refresh_after_hours` (A-OFF-01) is refreshed in full on reconnect.
 */
import type { ReferencePayload } from "./protocol";
import { type OfflineDb, META, getMeta, log, setMeta } from "./store";

export async function saveReference(db: OfflineDb, ref: ReferencePayload, now = new Date()) {
  await db.transaction("rw", [db.materials, db.locations, db.lots, db.counts, db.batches, db.meta], async () => {
    if (ref.materials) {
      await db.materials.clear();
      await db.materials.bulkPut(ref.materials);
    }
    for (const [table, rows] of [
      [db.locations, ref.locations],
      [db.lots, ref.lots],
      [db.counts, ref.counts],
      [db.batches, ref.batches],
    ] as const) {
      await table.where("siteId").equals(ref.siteId).delete();
      if (rows) await (table as typeof db.lots).bulkPut(rows as never[]);
    }
    const at = (await getMeta<Record<string, string>>(db, META.reference)) ?? {};
    await setMeta(db, META.reference, { ...at, [ref.siteId]: ref.generatedAt });
  });
  await log(db, "refresh", `reference for site ${ref.siteId}: ${ref.lots?.length ?? 0} lots, ${ref.counts?.length ?? 0} counts, ${ref.batches?.length ?? 0} batches`, now);
}

export async function referenceTimes(db: OfflineDb): Promise<Record<string, string>> {
  return (await getMeta<Record<string, string>>(db, META.reference)) ?? {};
}

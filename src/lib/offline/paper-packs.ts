/**
 * ADR-134: paper batch record packs kept on the device, so Chrome can print them when the connection is gone.
 *
 * The packs are business documents of batches the person may already see (the server checks permissions and sites);
 * they live in the person's own IndexedDB store, which sign-out and a change of person delete (store.ts `wipe`). The
 * service worker caches no signed-in page (docs/offline-sync.md §11.3 decision 1): printing reads the store and prints
 * the stored HTML in a frame, on the open batch page or on the precached `/offline` page.
 */
import type { CachedPaperPack, OfflineDb } from "./store";

/** What the list endpoint answers (src/modules/production/paper-pack.ts `UpcomingPaperPack`). */
export type PackListItem = { batchId: string; batchNumber: string; productName: string; status: string; plannedStartOn: string | null; siteId: string; packId: string | null; version: string | null; pageCount: number };
/** What the pack endpoint answers (`PaperPackForDevice`). */
export type PackPayload = Omit<CachedPaperPack, "userId" | "savedAt" | "pages"> & { madeAt: string; pages: (CachedPaperPack["pages"][number] & { paperRecordId?: string; documentId?: string | null })[] };

export type PackFetcher = { list: () => Promise<PackListItem[]>; pack: (batchId: string) => Promise<PackPayload | null> };

/** A copy not listed any more (batch finished or out of the window) is dropped after this long. */
const KEEP_UNLISTED_MS = 2 * 86_400_000;

export async function savePaperPack(db: OfflineDb, userId: string, p: PackPayload, now = new Date()) {
  const row: CachedPaperPack = {
    batchId: p.batchId,
    siteId: p.siteId,
    batchNumber: p.batchNumber,
    productName: p.productName,
    status: p.status,
    plannedStartOn: p.plannedStartOn,
    packId: p.packId,
    version: p.version,
    madeAtText: p.madeAtText,
    pages: p.pages.map((x) => ({ reference: x.reference, documentNumber: x.documentNumber, stepNo: x.stepNo, stepName: x.stepName, status: x.status })),
    html: p.html,
    userId,
    savedAt: now.toISOString(),
  };
  await db.paperPacks.put(row);
  return row;
}

export async function cachedPaperPack(db: OfflineDb, userId: string, batchId: string): Promise<CachedPaperPack | null> {
  const row = await db.paperPacks.get(batchId);
  return row && row.userId === userId ? row : null;
}

export async function cachedPaperPacks(db: OfflineDb, userId: string): Promise<CachedPaperPack[]> {
  return (await db.paperPacks.where("userId").equals(userId).toArray()).sort((a, z) => (a.plannedStartOn ?? "").localeCompare(z.plannedStartOn ?? "") || a.batchNumber.localeCompare(z.batchNumber));
}

/**
 * Downloads the packs of today's and the next batches (only those whose version changed), and drops copies that are
 * no longer listed for KEEP_UNLISTED_MS. Throws when the list cannot be fetched: nothing is removed then.
 */
export async function refreshPaperPacks(db: OfflineDb, userId: string, f: PackFetcher, now = new Date()) {
  const list = await f.list();
  let saved = 0;
  let kept = 0;
  const listed = new Set<string>();
  for (const item of list) {
    if (!item.packId || !item.version) continue;
    listed.add(item.batchId);
    const have = await cachedPaperPack(db, userId, item.batchId);
    if (have && have.version === item.version) {
      kept += 1;
      await db.paperPacks.update(item.batchId, { savedAt: now.toISOString(), status: item.status });
      continue;
    }
    const p = await f.pack(item.batchId);
    if (!p) continue;
    await savePaperPack(db, userId, p, now);
    saved += 1;
  }
  let removed = 0;
  for (const row of await db.paperPacks.toArray()) {
    const foreign = row.userId !== userId;
    const stale = !listed.has(row.batchId) && now.getTime() - new Date(row.savedAt).getTime() > KEEP_UNLISTED_MS;
    if (foreign || stale) {
      await db.paperPacks.delete(row.batchId);
      removed += 1;
    }
  }
  return { saved, kept, removed };
}

/** Fetches with the same rules as the sync transport: same origin, no store, JSON envelope `{ ok, data }`. */
async function getJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(url, { cache: "no-store", credentials: "same-origin", signal: ctrl.signal });
    const body = (await res.json().catch(() => null)) as { ok: true; data: T } | { ok: false; error: { message: string } } | null;
    if (!res.ok || !body || !body.ok) throw new Error(body && !body.ok ? body.error.message : `HTTP ${res.status}`);
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}

export const httpPackFetcher: PackFetcher = {
  list: () => getJson<{ packs: PackListItem[] }>("/api/v1/production/paper-packs").then((d) => d.packs),
  pack: (batchId) => getJson<{ pack: PackPayload | null }>(`/api/v1/production/paper-packs/${encodeURIComponent(batchId)}`).then((d) => d.pack),
};

/**
 * Prints stored pack HTML with the browser's print dialog, from a hidden frame (no script in the pack; the frame is
 * sandboxed and same-origin only so the parent page can call print). Works with no connection.
 */
export function printPackHtml(html: string, doc: Document = document): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = doc.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("data-testid", "paper-pack-frame");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        setTimeout(() => frame.remove(), 60_000);
      }
    };
    frame.srcdoc = html;
    doc.body.appendChild(frame);
  });
}

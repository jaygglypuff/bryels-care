/**
 * ADR-134: the device copy of the paper batch record packs (fake-indexeddb). The device downloads the packs of today's
 * and the next batches, replaces a copy when the pack changed, keeps a copy it cannot refresh while offline, drops
 * packs no longer listed, never keeps another person's copy, and loses everything at sign-out (wipe). Fictional data.
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { type PackFetcher, cachedPaperPack, cachedPaperPacks, refreshPaperPacks, savePaperPack } from "@/lib/offline/paper-packs";
import { OfflineDb, wipe } from "@/lib/offline/store";

const ME = "0199f6a2-1c2b-7d3e-8f40-0000000000aa";
const OTHER = "0199f6a2-1c2b-7d3e-8f40-0000000000ab";
const SITE = "0199f6a2-1c2b-7d3e-8f40-123456789abc";
const B1 = "0199f6a2-1c2b-7d3e-8f40-0000000000b1";
const B2 = "0199f6a2-1c2b-7d3e-8f40-0000000000b2";
const T0 = new Date("2026-11-13T00:00:00Z");

const pack = (batchId: string, version: string) => ({
  batchId,
  batchNumber: batchId === B1 ? "B-26-0101" : "B-26-0102",
  productName: "Acapulco Soap 135 g",
  siteId: SITE,
  status: "planned",
  plannedStartOn: "2026-11-13",
  packId: `pack-${batchId}`,
  version,
  madeAt: T0.toISOString(),
  madeAtText: "13 Nov 2026, 08:00",
  pages: [{ paperRecordId: "x", reference: "B-26-0101-P01", documentId: null, documentNumber: "DOC-26-0000301", stepNo: 1, stepName: "Check the area", status: "issued" }],
  html: `<!doctype html><p>${batchId} ${version}</p>`,
});

function fetcher(list: { batchId: string; version: string | null }[], log: string[] = []): PackFetcher {
  return {
    list: async () => list.map((x) => ({ batchId: x.batchId, batchNumber: "B", productName: "P", status: "planned", plannedStartOn: null, siteId: SITE, packId: x.version ? `pack-${x.batchId}` : null, version: x.version, pageCount: x.version ? 1 : 0 })),
    pack: async (batchId) => {
      log.push(batchId);
      const v = list.find((x) => x.batchId === batchId)?.version;
      return v ? pack(batchId, v) : null;
    },
  };
}

describe("paper batch record packs on the device (ADR-134)", () => {
  it("downloads the listed packs, skips unchanged ones and replaces changed ones", async () => {
    const db = new OfflineDb(`pp-${Math.random()}`);
    const log: string[] = [];
    const r1 = await refreshPaperPacks(db, ME, fetcher([{ batchId: B1, version: "v1" }, { batchId: B2, version: null }], log), T0);
    expect(r1).toMatchObject({ saved: 1, kept: 0, removed: 0 });
    expect((await cachedPaperPack(db, ME, B1))?.html).toContain("v1");
    expect(await cachedPaperPack(db, ME, B2)).toBeNull();
    await refreshPaperPacks(db, ME, fetcher([{ batchId: B1, version: "v1" }], log), T0);
    expect(log).toEqual([B1]);
    await refreshPaperPacks(db, ME, fetcher([{ batchId: B1, version: "v2" }], log), T0);
    expect((await cachedPaperPack(db, ME, B1))?.html).toContain("v2");
  });

  it("drops a pack that is no longer listed after a while, but keeps a pack opened on its batch page today", async () => {
    const db = new OfflineDb(`pp-${Math.random()}`);
    await refreshPaperPacks(db, ME, fetcher([{ batchId: B1, version: "v1" }]), T0);
    await savePaperPack(db, ME, pack(B2, "v1"), T0);
    const r = await refreshPaperPacks(db, ME, fetcher([]), new Date(T0.getTime() + 3_600_000));
    expect(r.removed).toBe(0);
    const later = await refreshPaperPacks(db, ME, fetcher([]), new Date(T0.getTime() + 4 * 86_400_000));
    expect(later.removed).toBe(2);
    expect(await cachedPaperPacks(db, ME)).toEqual([]);
  });

  it("a copy saved for another person is never shown, and sign-out removes every copy", async () => {
    const db = new OfflineDb(`pp-${Math.random()}`);
    await savePaperPack(db, OTHER, pack(B1, "v1"), T0);
    expect(await cachedPaperPack(db, ME, B1)).toBeNull();
    expect(await cachedPaperPacks(db, ME)).toEqual([]);
    await savePaperPack(db, ME, pack(B2, "v1"), T0);
    await wipe(db);
    expect(await cachedPaperPacks(db, ME)).toEqual([]);
    expect(await db.paperPacks.count()).toBe(0);
  });

  it("when the list cannot be fetched (no internet) the copies stay", async () => {
    const db = new OfflineDb(`pp-${Math.random()}`);
    await refreshPaperPacks(db, ME, fetcher([{ batchId: B1, version: "v1" }]), T0);
    const offline: PackFetcher = { list: async () => Promise.reject(new Error("No connection to the server.")), pack: async () => null };
    await expect(refreshPaperPacks(db, ME, offline, new Date(T0.getTime() + 9 * 86_400_000))).rejects.toThrow();
    expect((await cachedPaperPack(db, ME, B1))?.batchNumber).toBe("B-26-0101");
  });
});

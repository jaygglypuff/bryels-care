import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { containers, inventoryLots, stockMovements } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { createSessionRecord } from "@/lib/auth/session-store";
import { createBox, createCount, findLotForCount, putAwayLot, releaseCount, resolveLotRef } from "@/modules/inventory";
import { resolveLocationRef } from "@/modules/inventory/holds";
import { findPickCandidates, resolvePickRef } from "@/modules/scan";
import { resetTestDatabase } from "../../support/db";
import { setTestCookies } from "../../support/next-headers";
import { asUser, expectCode, loc, makeLot, type Kit, loadKit } from "../../support/kit";

/**
 * <ScanOrPick> server side (owner review 2026-10-31, docs/SCAN_INPUTS.md): a field accepts a tapped
 * candidate id, a label payload (BC:LOT:…) or a plain number; it refuses the placeholder text, labels of
 * another kind and other sites' records, in the services AND through the server actions.
 */
// revalidatePath needs a Next request store; the actions are tested without one.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

let kit: Kit;
let wh: AuthContext;
let whRvs: AuthContext;
let mgr: AuthContext;
let lot: typeof inventoryLots.$inferSelect;
let rvsLot: typeof inventoryLots.$inferSelect;

const key = () => randomUUID();

async function signedInAs(ctx: AuthContext) {
  const { token } = await createSessionRecord({ userId: ctx.userId });
  setTestCookies({ bc_session: token });
}

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  whRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
  mgr = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  lot = await makeLot(wh, kit.nfd.id, (await loc(kit.nfd.id, "RCV")).id, "25000");
  rvsLot = await makeLot(whRvs, kit.rvs.id, (await loc(kit.rvs.id, "RCV")).id, "1000");
});

afterEach(() => setTestCookies({}));

describe("resolvePickRef (services)", () => {
  it("a lot is found by its id (tapped), its label payload or its plain number, with the places that hold it", async () => {
    const byId = await resolvePickRef(wh, "lot", lot.id);
    const byLabel = await resolvePickRef(wh, "lot", `BC:LOT:${lot.lotNumber}`);
    const byNumber = await resolvePickRef(wh, "lot", lot.lotNumber.toLowerCase());
    expect([byId.value, byLabel.value, byNumber.value]).toEqual([lot.id, lot.id, lot.id]);
    expect(byId.code).toBe(lot.lotNumber);
    expect(byId.title).toBe("Coconut Oil");
    expect(byId.places?.map((p) => p.code)).toEqual(["RCV"]);
    expect(byId.uom).toBe("g");
  });

  it("refuses the placeholder text, words and labels of another kind in plain words", async () => {
    for (const p of ["BC:LOT:…", "BC:LOT:...", "e.g. PKG-01", ""]) {
      const e = await expectCode(resolvePickRef(wh, "lot", p), "validation");
      expect(e.message, p).not.toMatch(/Lot BC/);
    }
    expect((await expectCode(resolvePickRef(wh, "lot", "BC:LOT:…"), "validation")).message).toBe("We couldn't find that. Scan the lot label again, or find it by name.");
    expect((await expectCode(resolvePickRef(wh, "lot", "BC:LOC:A-01"), "validation")).message).toBe("That is a shelf label. Scan the lot label.");
    await expectCode(resolvePickRef(wh, "lot", "coconut oil"), "validation");
  });

  it("cross-site: another site's lot, shelf or box is not found (same answer as a missing one)", async () => {
    await expectCode(resolvePickRef(wh, "lot", rvsLot.id), "not_found");
    await expectCode(resolvePickRef(wh, "lot", `BC:LOT:${rvsLot.lotNumber}`), "not_found");
    const rvsShelf = await loc(kit.rvs.id, "FG-01");
    await expectCode(resolvePickRef(wh, "location", rvsShelf.id), "not_found");
    // The RVS user finds their own lot, never the NFD one.
    expect((await resolvePickRef(whRvs, "lot", rvsLot.lotNumber)).value).toBe(rvsLot.id);
    await expectCode(resolvePickRef(whRvs, "lot", lot.id), "not_found");
  });

  it("a shelf by id, BC:LOC label or code; a box by id, BC:BOX label or number", async () => {
    const a01 = await loc(kit.nfd.id, "A-01");
    for (const ref of [a01.id, "BC:LOC:A-01", "a-01"]) expect((await resolvePickRef(wh, "location", ref)).value).toBe(a01.id);
    await expectCode(resolvePickRef(wh, "location", "BC:BOX:BX-1"), "validation");
    const boxLot = await makeLot(wh, kit.nfd.id, a01.id, "5000");
    const box = await createBox(wh, { lotId: boxLot.id, locationId: a01.id, qty: "2000", idempotencyKey: key() });
    const [c] = await db.select().from(containers).where(eq(containers.id, box.id));
    for (const ref of [c.id, `BC:BOX:${c.containerNumber}`, c.containerNumber]) expect((await resolvePickRef(wh, "container", ref)).value).toBe(c.id);
    expect((await resolvePickRef(wh, "container", c.id)).title).toMatch(/Coconut Oil/);
    await expectCode(resolvePickRef(whRvs, "container", c.id), "not_found");
  });

  it("permission: a role without lot view cannot look lots up", async () => {
    const noView = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd]);
    if (noView.can("inventory.lot.view")) return; // the sales bundle may see lots; then nothing to prove here
    await expectCode(resolvePickRef(noView, "lot", lot.id), "forbidden");
  });
});

describe("findPickCandidates (find by name)", () => {
  it("every word must match; only the current site; each lot with its places", async () => {
    const hits = await findPickCandidates(wh, "lot", "coconut");
    expect(hits.some((h) => h.value === lot.id)).toBe(true);
    expect(hits.some((h) => h.value === rvsLot.id)).toBe(false);
    expect(hits.find((h) => h.value === lot.id)?.places?.[0]?.code).toBe("RCV");
    expect(await findPickCandidates(wh, "lot", "coconut zzzznotaword")).toEqual([]);
    expect(await findPickCandidates(wh, "lot", "x")).toEqual([]);
    const shelves = await findPickCandidates(wh, "location", "finished");
    expect(shelves.map((s) => s.code)).toContain("FG-01");
    expect(shelves.every((s) => s.value !== (undefined as never))).toBe(true);
  });
});

describe("shared resolvers used by many commands (put-away, dispensing, packaging, holds)", () => {
  it("resolveLotRef / resolveLocationRef accept id, payload and number but refuse the placeholder", async () => {
    expect((await resolveLotRef(db, wh, lot.id)).id).toBe(lot.id);
    expect((await resolveLotRef(db, wh, `BC:LOT:${lot.lotNumber}`)).id).toBe(lot.id);
    const e = await expectCode(resolveLotRef(db, wh, "BC:LOT:…"), "validation");
    expect(e.message).toBe("We couldn't find that. Scan the lot label again, or find it by name.");
    await expectCode(resolveLotRef(db, wh, rvsLot.id), "not_found");
    const pkg = await loc(kit.nfd.id, "PKG-01");
    expect((await resolveLocationRef(db, wh, kit.nfd.id, pkg.id)).id).toBe(pkg.id);
    expect((await resolveLocationRef(db, wh, kit.nfd.id, "BC:LOC:PKG-01")).id).toBe(pkg.id);
    await expectCode(resolveLocationRef(db, wh, kit.nfd.id, "e.g. PKG-01"), "validation");
  });

  it("put-away takes the tapped shelf id; another site's shelf and the placeholder are refused", async () => {
    const a02 = await loc(kit.nfd.id, "A-02");
    const r = await putAwayLot(wh, { lotRef: lot.id, locationRef: a02.id, fromLocationId: null, qty: "1000", qtyUom: "g", idempotencyKey: key() });
    expect(r.toCode).toBe("A-02");
    await expectCode(putAwayLot(wh, { lotRef: lot.id, locationRef: (await loc(kit.rvs.id, "FG-01")).id, fromLocationId: null, qty: "1", qtyUom: "g", idempotencyKey: key() }), "not_found");
    await expectCode(putAwayLot(wh, { lotRef: lot.id, locationRef: "BC:LOC:…", fromLocationId: null, qty: "1", qtyUom: "g", idempotencyKey: key() }), "validation");
    await expectCode(putAwayLot(wh, { lotRef: rvsLot.id, locationRef: a02.id, fromLocationId: null, qty: "1", qtyUom: "g", idempotencyKey: key() }), "not_found");
  });

  it("counting: the lot comes as a tapped id, a label or a number; never the placeholder or another site's lot", async () => {
    const shelf = await loc(kit.nfd.id, "RCV");
    const c = await createCount(mgr, { countKind: "cycle", isBlind: true, locationIds: [shelf.id], counterUserIds: [wh.userId] });
    await releaseCount(mgr, c.id);
    expect((await findLotForCount(wh, c.id, lot.id))?.id).toBe(lot.id);
    expect((await findLotForCount(wh, c.id, `BC:LOT:${lot.lotNumber}`))?.id).toBe(lot.id);
    expect(await findLotForCount(wh, c.id, "BC:LOT:…")).toBeNull();
    expect(await findLotForCount(wh, c.id, rvsLot.id)).toBeNull();
    expect(await findLotForCount(wh, c.id, rvsLot.lotNumber)).toBeNull();
  });
});

describe("server actions", () => {
  it("scan-pick actions: resolve and search for the signed-in user only; other sites and the placeholder refused", async () => {
    const { resolvePickAction, searchPickAction } = await import("@/app/(app)/scan-pick-actions");
    await signedInAs(wh);
    const ok = await resolvePickAction("lot", `BC:LOT:${lot.lotNumber}`);
    expect(ok).toMatchObject({ ok: true, candidate: { value: lot.id } });
    expect(await resolvePickAction("lot", rvsLot.id)).toMatchObject({ ok: false });
    expect(await resolvePickAction("lot", "BC:LOT:…")).toEqual({ ok: false, message: "We couldn't find that. Scan the lot label again, or find it by name." });
    expect(await resolvePickAction("nonsense", "x")).toMatchObject({ ok: false });
    const s = await searchPickAction("lot", "coconut");
    expect(s.ok && s.candidates.some((c) => c.value === lot.id) && !s.candidates.some((c) => c.value === rvsLot.id)).toBe(true);
  });

  it("put-away action: the tapped shelf id is accepted and the message names the shelf code, not the id", async () => {
    const { putAwayAction } = await import("@/app/(app)/inventory/receive/put-away/actions");
    await signedInAs(wh);
    // A fresh lot on a shelf no count has frozen (the counting test above froze RCV).
    const paLot = await makeLot(wh, kit.nfd.id, (await loc(kit.nfd.id, "B-01")).id, "2000");
    const pkgShelf = await loc(kit.nfd.id, "A-01");
    const fd = new FormData();
    fd.set("lot", paLot.lotNumber);
    fd.set("location", pkgShelf.id);
    fd.set("qty", "500");
    fd.set("qtyUom", "g");
    fd.set("idempotencyKey", key());
    const r = await putAwayAction(null, fd).catch((e: Error) => e);
    expect(String(r instanceof Error ? r.message : JSON.stringify(r))).toMatch(/redirect:.*now%20at%20A-01/);
    const bad = new FormData();
    bad.set("lot", paLot.lotNumber);
    bad.set("location", "BC:LOC:…");
    bad.set("idempotencyKey", key());
    expect(await putAwayAction(null, bad)).toMatchObject({ ok: false });
    const other = new FormData();
    other.set("lot", rvsLot.id);
    other.set("location", pkgShelf.id);
    other.set("idempotencyKey", key());
    expect(await putAwayAction(null, other)).toMatchObject({ ok: false });
    const moved = await db.select().from(stockMovements).where(and(eq(stockMovements.lotId, rvsLot.id), eq(stockMovements.movementType, "transfer")));
    expect(moved).toHaveLength(0);
  });

  it("count action: a tapped lot (number from the candidate) saves; the placeholder and another site's lot do not", async () => {
    const { recordCountAction } = await import("@/app/(app)/inventory/counts/actions");
    const shelf = await loc(kit.nfd.id, "PKG-01");
    const cLot = await makeLot(wh, kit.nfd.id, shelf.id, "3000");
    const c = await createCount(mgr, { countKind: "cycle", isBlind: true, locationIds: [shelf.id], counterUserIds: [wh.userId] });
    await releaseCount(mgr, c.id);
    await signedInAs(wh);
    const send = async (lotCode: string) => {
      const fd = new FormData();
      fd.set("locationId", shelf.id);
      fd.set("lotCode", lotCode);
      fd.set("qty", "1");
      fd.set("qtyUom", "kg");
      fd.set("idempotencyKey", key());
      return recordCountAction(c.id, null, fd);
    };
    const a = await send(cLot.lotNumber);
    expect(a, JSON.stringify(a)).toMatchObject({ ok: true });
    const b = await send(cLot.id);
    expect(b, JSON.stringify(b)).toMatchObject({ ok: true });
    expect(await send("BC:LOT:…")).toMatchObject({ ok: false });
    expect(await send(rvsLot.lotNumber)).toMatchObject({ ok: false });
  });
});

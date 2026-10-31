/**
 * Usability test 2026-10-30: the warehouse Home shows six big tiles in plain words with live counts of
 * the current site (Receive, Put away, Move, Count, Fix stock, Find); other roles keep their tiles.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getOperatorHome } from "@/modules/analytics";
import { createAdjustment } from "@/modules/inventory/adjustments";
import { createCount } from "@/modules/inventory/counts";
import { lotsToPutAway } from "@/modules/inventory";
import { resetTestDatabase } from "../../support/db";
import { key, loadWorld, loc, makeLot, type World } from "./w1c-fixtures";

let w: World;
beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
});

const tile = async (ctx: World["wh"], k: string) => (await getOperatorHome(ctx)).find((t) => t.key === k);

describe("warehouse Home tiles", () => {
  it("shows Receive, Put away, Move, Count, Fix stock and Find for a warehouse operator, in that order", async () => {
    const tiles = await getOperatorHome(w.wh);
    expect(tiles.slice(0, 6).map((t) => t.title)).toEqual(["Receive", "Put away", "Move", "Count", "Fix stock", "Find"]);
    expect(tiles.find((t) => t.key === "putaway")?.count).toBe(new Set((await lotsToPutAway(w.wh)).map((l) => l.lotId)).size);
  });

  it("counts open counts and unfinished stock fixes of the current site only", async () => {
    const countBefore = (await tile(w.wh, "count"))!.count;
    const rvsBefore = (await tile(w.whRvs, "count"))?.count ?? 0;
    await createCount(w.manager, { countKind: "cycle", isBlind: true, locationIds: [(await loc(w.nfd.id, "A-02")).id], counterUserIds: [] });
    expect((await tile(w.wh, "count"))!.count).toBe(countBefore + 1);
    expect((await tile(w.whRvs, "count"))?.count ?? 0).toBe(rvsBefore);

    const fixBefore = (await tile(w.wh, "fix"))!.count;
    const lot = await makeLot(w.owner, { siteId: w.nfd.id, locCode: "B-01", materialCode: "MAT-0061", qty: "1000" });
    await createAdjustment(w.wh, { reasonCode: "damaged", lines: [{ lotId: lot.id, locationId: (await loc(w.nfd.id, "B-01")).id, direction: "decrease", qty: "1" }], idempotencyKey: key() });
    expect((await tile(w.wh, "fix"))!.count).toBe(fixBefore + 1);
    expect((await tile(w.whRvs, "fix"))?.count ?? 0).toBe(0);
  });

  it("keeps the old tiles for people who do not move stock (no warehouse tiles without inventory.movement.post)", async () => {
    const tiles = await getOperatorHome(w.auditor);
    expect(tiles.map((t) => t.key)).not.toContain("putaway");
    expect(tiles.map((t) => t.key)).not.toContain("move");
  });
});

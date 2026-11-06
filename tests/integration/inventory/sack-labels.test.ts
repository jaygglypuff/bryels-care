/** ADR-110 C7: the lot label of a delivery in several sacks carries the quantity per sack (or none), scoped by site. */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { goodsReceiptLines, inventoryLots } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { lotLabelEntity } from "@/modules/documents/datasets";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, seedLot, type Kit } from "../../support/kit";

let kit: Kit;
let wh: AuthContext;
let whRvs: AuthContext;
const lotId = async (seq: string) => (await db.select().from(inventoryLots).where(eq(inventoryLots.lotNumber, seedLot(seq))))[0].id;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  whRvs = await asUser(kit, "warehouse.rvs@bryels-care.test", "warehouse_operator", [kit.rvs]);
}, 180_000);

describe("C7 sack labels", () => {
  it("15 kg in 4 sacks: each label says 3.75 kg each and is numbered", async () => {
    const id = await lotId("00009");
    await db.update(goodsReceiptLines).set({ containerCount: 4 }).where(eq(goodsReceiptLines.lotId, id));
    const e = await lotLabelEntity(wh, id);
    expect(e.entity.quantityText).toBe("3.75 kg each");
    expect(e.entity.containerCount).toBe(4);
  });

  it("uneven (600 g in 7) or partly used: no quantity, only the sack number", async () => {
    const a = await lotId("00008");
    await db.update(goodsReceiptLines).set({ containerCount: 7 }).where(eq(goodsReceiptLines.lotId, a));
    expect((await lotLabelEntity(wh, a)).entity.quantityText).toBeNull();
    const b = await lotId("00004");
    await db.update(goodsReceiptLines).set({ containerCount: 2 }).where(eq(goodsReceiptLines.lotId, b));
    expect((await lotLabelEntity(wh, b)).entity.quantityText).toBeNull();
  });

  it("one container keeps the lot quantity; another site cannot read the label", async () => {
    const id = await lotId("00010");
    const e = await lotLabelEntity(wh, id);
    expect(e.entity.quantityText).toBe("12.00 kg");
    expect(e.entity.containerCount ?? null).toBeNull();
    await expectCode(lotLabelEntity(whRvs, id), "not_found");
  });
});

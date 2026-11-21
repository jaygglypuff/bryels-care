/**
 * ADR-138 §1: "Made for" on production orders with no customer order (stock, online shop, samples, other with a
 * note). Information only: shown on the order and the list; the cover rule still treats it as for stock.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, workOrders } from "@/db/schema";
import { createProductionOrder, listProductionOrders, madeForText } from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { day, expectCode, loadWorld, productId, type World } from "./w2a-fixtures";

let w: World;
let acs: string;
beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
  acs = await productId("ACS-135");
}, 120_000);

describe("Made for (ADR-138)", () => {
  it("stores the choice, shows it in words, and needs a note for Other", async () => {
    const r = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(1), madeFor: "online_shop" });
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, r.workOrderId));
    expect(wo).toMatchObject({ madeFor: "online_shop", salesOrderId: null, madeForNote: null });
    const row = (await listProductionOrders(w.planner, { status: "all" })).find((x) => x.id === r.workOrderId)!;
    expect(row.madeFor).toBe("For the online shop");
    await expectCode(createProductionOrder(w.planner, { productId: acs, plannedStart: day(1), madeFor: "other" }), "validation");
    await expectCode(createProductionOrder(w.planner, { productId: acs, plannedStart: day(1), madeFor: "for_fun" }), "validation");
    const o = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(1), madeFor: "other", madeForNote: "Trade fair in March" });
    const [wo2] = await db.select().from(workOrders).where(eq(workOrders.id, o.workOrderId));
    expect(madeForText(wo2)).toBe("Other: Trade fair in March");
    // No choice = for stock.
    const s = await createProductionOrder(w.planner, { productId: acs, plannedStart: day(1) });
    expect((await listProductionOrders(w.planner, { status: "all" })).find((x) => x.id === s.workOrderId)!.madeFor).toBe("For stock");
    expect(await db.select().from(auditEvents).where(eq(auditEvents.entityId, r.workOrderId))).not.toHaveLength(0);
  });
  it("a customer order wins: the words name the customer order", () => {
    expect(madeForText({ madeFor: null, salesOrderNumber: "SO-26-00012" })).toBe("For SO-26-00012");
    expect(madeForText({ madeFor: "samples" })).toBe("For samples");
  });
});

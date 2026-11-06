/**
 * Live check 2026-11-06 finding 2: the weigh card's reason comes from the read model. A batch that is not started
 * says "Start the batch first …" for everyone (never "Your role cannot weigh"); the role reason is only for a batch
 * that is ready to weigh. Cross-site negative.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { batches } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { approveProductionOrder, createProductionOrder, getWeighView } from "@/modules/production";
import { manilaToday } from "@/modules/sales";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";
import { makeExecutionFixture } from "../../support/w2b";

let kit: Kit;
let operator: AuthContext;
let operatorRvs: AuthContext;
let qa: AuthContext;
let batchId: string;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  operatorRvs = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.rvs]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd]);
  const planner = await asUser(kit, "planner.nfd@bryels-care.test", "production_planner", [kit.nfd]);
  const mgr = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  const fx = await makeExecutionFixture(kit, [{ name: "Check the area is clean", kind: "line_clearance", area: "weighing", checklist: [{ text: "Clean" }] }, { name: "Weigh", kind: "dispensing" }]);
  const wo = await createProductionOrder(planner, { productId: fx.product.id, plannedStart: manilaToday(), idempotencyKey: `wb-${Date.now()}` });
  await approveProductionOrder(mgr, wo.workOrderId, { idempotencyKey: `wb-ap-${Date.now()}` });
  [{ id: batchId }] = await db.select({ id: batches.id }).from(batches).where(eq(batches.workOrderId, wo.workOrderId));
}, 240_000);

describe("weigh card reason (finding 2)", () => {
  it("a batch not started: the operator is told to start it, with the button to Get materials", async () => {
    const v = await getWeighView(operator, batchId);
    expect(v.canWeigh).toBe(false);
    expect(v.weighBlock?.code).toBe("not_picked");
    expect(v.weighBlock?.sentence).toBe("Start the batch first: get the materials, then do the clean-area check on step 1.");
    expect(v.weighBlock?.button?.target).toBe("materials");
  });

  it("a person without the weighing permission gets the same state reason while the batch is not started", async () => {
    const v = await getWeighView(qa, batchId);
    expect(v.weighBlock?.code).toBe("not_picked");
    expect(v.weighBlock?.sentence).not.toMatch(/role/i);
  });

  it("materials taken, start check not done: 'Start the batch first: do the clean-area check on step 1'", async () => {
    await db.update(batches).set({ status: "materials_staged" }).where(eq(batches.id, batchId)); // fixture: Get materials done
    const v = await getWeighView(operator, batchId);
    expect(v.weighBlock).toMatchObject({ code: "not_started", sentence: "Start the batch first: do the clean-area check on step 1.", buttonStepNo: 1 });
  });

  it("another site's operator cannot open the card", async () => {
    await expectCode(getWeighView(operatorRvs, batchId), "not_found");
  });
});

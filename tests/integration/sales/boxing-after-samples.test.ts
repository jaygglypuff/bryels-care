/**
 * Consultant review defect: "121 units still to box … blocked until boxes × units equal the lot output"
 * while the stock was 119 after 2 retained samples. The pack's expected units are the batch output
 * minus the samples that left the lot, so the last box can be made and the pack verified. The boxing
 * list shows only released lots that still have units to box (not quarantined, rejected or boxed ones).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { batchOutputs, inspections, inventoryBalances, packs } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { finishBatch } from "@/modules/production";
import { decideQualityCheck, getInspection, recordInspectionResults } from "@/modules/quality";
import { addBox, boxableOutputs, startPack, submitPack } from "@/modules/sales";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, type Kit } from "../../support/kit";
import { type Crew, directBatchReadyToFinish } from "../../support/g3";

let kit: Kit;
let crew: Required<Crew>;
let qa: AuthContext;
let wh: AuthContext;
let whRvs: AuthContext;
const key = () => `bx-${randomUUID()}`;

/** A batch finished with 60 good bars and 2 samples kept: output 60, stock 58. */
async function finished() {
  const b = await directBatchReadyToFinish(kit, crew);
  await finishBatch(crew.operator, { batchId: b.batchId, goodUnits: "60", samplesKept: "2", packaging: [{ materialId: b.wrapperMaterialId, damaged: "0", leftOver: "10" }], idempotencyKey: key() }, { checker: crew.checker });
  const [out] = await db.select().from(batchOutputs).where(and(eq(batchOutputs.batchId, b.batchId), eq(batchOutputs.outputKind, "finished"), isNotNull(batchOutputs.lotId)));
  return { ...b, outputId: out.id, lotId: out.lotId!, outputQty: new Decimal(out.qtyBase).toString() };
}

async function pass(batchId: string) {
  const [ins] = await db.select().from(inspections).where(eq(inspections.batchId, batchId));
  const v = await getInspection(qa, ins.id);
  const results = v.tests.map((t) => {
    if (t.valueKind !== "numeric") return { planTestId: t.id, value: "Conforms", conforms: true };
    const lo = t.specMin !== null ? new Decimal(t.specMin) : null;
    const hi = t.specMax !== null ? new Decimal(t.specMax) : null;
    return { planTestId: t.id, value: (lo && hi ? lo.plus(hi).div(2) : (lo ?? hi ?? new Decimal(1))).toString(), uom: t.uom };
  });
  await recordInspectionResults(qa, { inspectionId: ins.id, results });
  await decideQualityCheck(qa, { batchId, decision: "pass", recordReviewed: true, idempotencyKey: key() });
}

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  const manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  const operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  const checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  const planner = await asUser(kit, "planner.nfd@bryels-care.test", "production_planner", [kit.nfd]);
  wh = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.nfd]);
  whRvs = await asUser(kit, "warehouse.nfd@bryels-care.test", "warehouse_operator", [kit.rvs]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd]);
  crew = { manager, operator, checker, planner, warehouse: wh };
}, 240_000);

describe("boxing after retained samples", () => {
  it("expects the stock after samples (58), not the output (60); the last box makes the pack reconcile", async () => {
    const b = await finished();
    expect(b.outputQty).toBe("60");
    const stock = (await db.select().from(inventoryBalances).where(eq(inventoryBalances.lotId, b.lotId))).reduce((t, r) => t.plus(r.qtyBase), new Decimal(0));
    expect(stock.toString()).toBe("58");

    // Quarantined: not on the boxing list yet (released lots only).
    expect((await boxableOutputs(wh)).map((o) => o.id)).not.toContain(b.outputId);
    await pass(b.batchId);
    const listed = (await boxableOutputs(wh)).find((o) => o.id === b.outputId);
    expect(listed).toMatchObject({ lotStatus: "released", toBox: "58" });
    expect((await boxableOutputs(whRvs)).map((o) => o.id)).not.toContain(b.outputId);

    const r = await startPack(crew.operator, { sourceKind: "batch_output", batchOutputId: b.outputId, idempotencyKey: key() });
    const [p] = await db.select().from(packs).where(eq(packs.id, r.packId));
    expect(new Decimal(p.expectedUnitsBase!).toString()).toBe("58");
    // Started: no longer "to box".
    expect((await boxableOutputs(wh)).map((o) => o.id)).not.toContain(b.outputId);

    let left = 58;
    while (left > 0) {
      const q = Math.min(p.unitsPerBox, left);
      await addBox(crew.operator, r.packId, { qty: String(q), idempotencyKey: key() });
      left -= q;
    }
    await expect(submitPack(crew.operator, r.packId)).resolves.toMatchObject({ verificationMode: expect.any(String) });
    await expectCode(addBox(crew.operator, r.packId, { qty: "1", idempotencyKey: key() }), "state");
  });

  it("a failed (rejected) batch is not on the boxing list", async () => {
    const b = await finished();
    await decideQualityCheck(qa, { batchId: b.batchId, decision: "fail", reason: "Colour off, rejected", idempotencyKey: key() });
    expect((await boxableOutputs(wh)).map((o) => o.id)).not.toContain(b.outputId);
  });
});

/**
 * One path for production work (owner complaint 2026-10-31, UX audit A). The new flow screens do what the
 * old batch workspace did, with the same services and the same GMP controls:
 *   - the Start check is done from the step card; the checker signs it from their OWN session (checkStep),
 *     the doer cannot, another site cannot, a role without the permission cannot;
 *   - a weighing waiting for its check shows as a "Check" task on the checker's Home, never on the weigher's;
 *   - a batch without packaging lines offers the released packaging lots to tap (no typed code); the
 *     tapped lot (id + shelf id) is issued with the existing issuePackaging rules; other sites refused;
 *   - labels cannot be printed (lot and dates fixed) before the packaging step;
 *   - a batch without a production order gets flow screens (`without-order`), never the old workspace.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { batches, inventoryLots, materials, settings } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import {
  type FormulaSnapshot,
  approveProductionOrder,
  checkStep,
  completeStep,
  confirmPicked,
  createProductionOrder,
  getBatchFlowFacts,
  getStepCard,
  getWeighView,
  issuePackaging,
  isOldWorkspaceHref,
  myFloorTasks,
  nextBatchScreen,
  printBatchLabels,
  recordDispense,
  recordReading,
  returnStep,
  selectEquipment,
  submitChecklist,
} from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { cleanEquipment, signChecklist } from "../../support/w2b";
import { ctxFor, day, expectCode, loadWorld, productId, type World } from "./w2a-fixtures";

let w: World;
let checker: AuthContext;
let operatorRvs: AuthContext;
let batchId: string;
const key = () => `op-${uuidv7()}`;
const snap = async () => ((await db.select().from(batches).where(eq(batches.id, batchId)))[0].formulaSnapshot as FormulaSnapshot);
const steps = async () => [...(await snap()).steps].sort((a, z) => a.stepNo - z.stepNo);

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  w = await loadWorld();
  checker = await ctxFor(w.orgId, "checker.nfd@bryels-care.test", "production_operator", [w.nfd]);
  operatorRvs = await ctxFor(w.orgId, "operator.nfd@bryels-care.test", "production_operator", [w.rvs]);
  // An older product setup: no packaging per piece, so the batch has no packaging line (pick-from-list case).
  await db.update(settings).set({ value: {} }).where(and(eq(settings.organizationId, w.orgId), eq(settings.key, "production.packaging.per_piece")));
  const r = await createProductionOrder(w.planner, { productId: await productId("ACS-135"), plannedStart: day(0), idempotencyKey: key() });
  const a = await approveProductionOrder(w.manager, r.workOrderId, { idempotencyKey: key() });
  batchId = a.batches[0].batchId;
  await confirmPicked(w.operator, { batchId, all: true, idempotencyKey: key() });
  await cleanEquipment(w.operator, "SC-01");
  await cleanEquipment(w.operator, "MIX-01");
}, 180_000);

describe("Start check from the step card, checked from the checker's own session", () => {
  it("the Start check is the next screen of a ready batch (a flow screen)", async () => {
    const f = await getBatchFlowFacts(w.operator, db, batchId);
    const n = nextBatchScreen(f);
    expect(n.action).toBe("start");
    expect(n.href).toMatch(/^\/production\/orders\/[0-9a-f-]{36}\/step\/1\?batch=/);
    const v = await getStepCard(w.operator, batchId, 1);
    expect(v.canPerform).toBe(true);
    expect(v.blockedReason).toBeNull();
  });

  it("answered without a checker it waits; the doer sees the name pick, the checker sees 'Yes, I checked'", async () => {
    const s1 = (await steps())[0];
    const r = await signChecklist(w.operator, null, batchId, s1);
    expect(r.status).toBe("awaiting_check");
    const mine = await getStepCard(w.operator, batchId, 1);
    expect(mine.viewer).toMatchObject({ isDoer: true });
    const theirs = await getStepCard(checker, batchId, 1);
    expect(theirs.viewer).toMatchObject({ canCheck: true, isDoer: false });
    // The checker's Home has a Check task that opens the same step.
    const t = (await myFloorTasks(checker)).find((x) => x.batchId === batchId)!;
    expect(t.kind).toBe("check");
    expect(t.href).toContain("/step/1?batch=");
    expect(isOldWorkspaceHref(t.href)).toBe(false);
  });

  it("negatives: the doer cannot check, another site cannot, a role without the permission cannot", async () => {
    await expectCode(checkStep(w.operator, { batchId, stepNo: 1, idempotencyKey: key() }), "separation_of_duties");
    await expectCode(checkStep(operatorRvs, { batchId, stepNo: 1, idempotencyKey: key() }), "not_found");
    await expectCode(checkStep(w.sales, { batchId, stepNo: 1, idempotencyKey: key() }), "forbidden");
  });

  it("send it back, answer again, then the checker signs from their own session: the batch starts", async () => {
    await returnStep(checker, { batchId, stepNo: 1, reason: "Scale not checked today" });
    const s1 = (await steps())[0];
    await submitChecklist(w.operator, { batchId, stepNo: 1, answers: (s1.checklistItems ?? []).map((i) => ({ itemId: i.id, answer: "yes" as const })) }, { checker: null });
    const r = await checkStep(checker, { batchId, stepNo: 1, idempotencyKey: key() });
    expect(r.status).toBe("completed");
    expect((await db.select().from(batches).where(eq(batches.id, batchId)))[0].status).toBe("in_process");
  });
});

describe("weighings waiting for a check are the checker's Check task", () => {
  it("after an unchecked weighing the checker has 'Check a weighing' to the Weigh screen; the weigher does not", async () => {
    const v = await getWeighView(w.operator, batchId);
    const c = v.cards.find((x) => x.needsCheck)!;
    const lot = c.lots[0];
    await recordDispense(w.operator, { batchId, batchMaterialId: c.batchMaterialId, lotRef: lot.lotId, locationRef: lot.locationId, lotPreselected: true, lotConfirm: `BC:LOT:${lot.lotNumber}`, qty: c.target, equipmentRef: "SC-01" });
    const t = (await myFloorTasks(checker)).find((x) => x.batchId === batchId)!;
    expect(t).toMatchObject({ kind: "check", canDo: true });
    expect(t.title).toMatch(/^Check (a weighing|\d+ weighings)$/);
    expect(t.href).toMatch(/\/weigh\?batch=/);
    const mine = (await myFloorTasks(w.operator)).find((x) => x.batchId === batchId)!;
    expect(mine.kind).not.toBe("check");
  });
});

describe("packaging step without packaging lines: tap the lot, no typed code", () => {
  let pkgStepNo = 0;
  beforeAll(async () => {
    // Weigh the rest with a checker, then do the steps up to packaging.
    for (const st of await steps()) {
      if (st.stepNo === 1) continue;
      if (st.stepKind === "line_clearance") await signChecklist(w.operator, checker, batchId, st);
      else if (st.stepKind === "dispensing") {
        // Labels may not be printed while weighing (they fix the lot number and dates).
        await expectCode(printBatchLabels(w.operator, { batchId, copies: 5, idempotencyKey: key() }), "state");
        const v = await getWeighView(w.operator, batchId);
        for (const c of v.cards) {
          for (const x of c.waitingForCheck) await import("@/modules/production").then((m) => m.checkDispense(checker, { dispenseRecordId: x.id, idempotencyKey: key() }));
          if (c.done) continue;
          const lot = c.lots[0];
          await recordDispense(w.operator, { batchId, batchMaterialId: c.batchMaterialId, lotRef: lot.lotId, locationRef: lot.locationId, lotPreselected: true, lotConfirm: lot.last4, qty: c.target, equipmentRef: "SC-01" }, { checker });
        }
        await completeStep(w.operator, { batchId, stepNo: st.stepNo }, { checker });
      } else if (st.stepKind === "process") {
        if (st.requiresEquipment) await selectEquipment(w.operator, { batchId, stepNo: st.stepNo, equipmentRef: "MIX-01" });
        for (const p of st.parameters ?? []) if (p.isRequired) await recordReading(w.operator, { batchId, stepNo: st.stepNo, parameterId: p.id, value: p.valueKind === "numeric" ? (p.targetValue ?? p.minValue ?? "45") : p.valueKind === "boolean" ? "yes" : "MOULD-A" });
        await completeStep(w.operator, { batchId, stepNo: st.stepNo }, { checker });
      } else if (st.stepKind === "packaging") {
        pkgStepNo = st.stepNo;
        break;
      }
    }
  }, 180_000);

  it("the card offers released packaging lots at the site (name, lot, shelf, quantity) to choose from", async () => {
    const v = await getStepCard(w.operator, batchId, pkgStepNo);
    expect(v.packaging?.lines).toEqual([]);
    expect(v.packaging?.choose).toBe(true);
    expect(v.packaging?.needsScan).toBe(true);
    const c = v.packaging!.choices.find((x) => x.lotNumber)!;
    expect(c).toMatchObject({ materialName: expect.any(String), lotId: expect.any(String), locationId: expect.any(String), shelf: expect.any(String) });
    expect(Number(c.qty)).toBeGreaterThan(0);
    // The label is now allowed (packaging step reached) and its preview has the product name.
    expect(v.packaging!.labels.productName.length).toBeGreaterThan(0);
  });

  it("the tapped lot is issued with the usual rules; other sites and wrong materials are refused", async () => {
    const v = await getStepCard(w.operator, batchId, pkgStepNo);
    const c = v.packaging!.choices[0];
    await expectCode(issuePackaging(operatorRvs, { batchId, stepNo: pkgStepNo, lotRef: c.lotId, locationRef: c.locationId, qty: "10", idempotencyKey: key() }), "not_found");
    const [oil] = await db.select({ id: inventoryLots.id }).from(inventoryLots).innerJoin(materials, eq(materials.id, inventoryLots.materialId)).where(and(eq(materials.materialKind, "raw_material"), eq(inventoryLots.siteId, w.nfd.id))).limit(1);
    if (oil) await expectCode(issuePackaging(w.operator, { batchId, stepNo: pkgStepNo, lotRef: oil.id, qty: "1", idempotencyKey: key() }), "blocked_lot");
    const r = await issuePackaging(w.operator, { batchId, stepNo: pkgStepNo, lotRef: c.lotId, locationRef: c.locationId, qty: "10", idempotencyKey: key() });
    expect(r.lotNumber).toBe(c.lotNumber);
    const after = await getStepCard(w.operator, batchId, pkgStepNo);
    expect(after.packaging).toMatchObject({ needsScan: false, recorded: 1 });
  });
});

describe("a batch without a production order uses the flow screens", () => {
  it("B-26-0004 (seeded, no order) gets a without-order flow screen, never the old workspace", async () => {
    const [b] = await db.select({ id: batches.id }).from(batches).where(eq(batches.batchNumber, "B-26-0004"));
    const f = await getBatchFlowFacts(w.operator, db, b.id);
    expect(f.workOrderId).toBeNull();
    const n = nextBatchScreen(f);
    expect(n.href).toMatch(/^\/production\/orders\/without-order\/(materials|weigh|step\/\d+)\?batch=|\/finish$/);
    expect(isOldWorkspaceHref(n.href!)).toBe(false);
    await expectCode(getBatchFlowFacts(operatorRvs, db, b.id), "not_found");
  });
});

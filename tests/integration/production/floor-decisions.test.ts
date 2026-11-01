/**
 * ADR-104 §1 and §5, ADR-106 §1–3 (owner 2026-11-01): another material at weighing, the pick list per lot, the weigh
 * card following it, the note when another lot is weighed, and batches over several days. Fictional data.
 *
 *  - Get materials: per ingredient the exact lots in use-first order with how much from each; an opened container
 *    says what stays behind; the weigh card proposes the same lots in the same order.
 *  - Another allowed lot scanned at weighing: refused with the plain warning until a one-tap reason is given; then
 *    weighed, the set-aside moves, and QA sees the note on Check quality and the batch record. Expired lots and
 *    other sites' lots are never accepted.
 *  - "Use another lot": reason needed when not the lot to use first; idempotent; set-aside moved; role/site negatives.
 *  - Approved alternative: the line is swapped for this batch only (new line, old one `substituted`).
 *  - "Ask to use something else": only a QA person by own roles decides; the requester, the site manager and the
 *    owner (even with the owner override) cannot; approval swaps the line; the operator sees "Waiting for QA (Nina)".
 *  - Stop for today: pause recorded and audited; the next day's task reads "Continue … · started yesterday"; TV "day 2".
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { auditEvents, batchMaterials, batchPauses, batches, bomLineAlternatives, inventoryBalances, inventoryLots, locations, materials, stockReservations } from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import { PERMISSIONS, ROLE_BUNDLES } from "@/lib/permissions";
import {
  type FormulaSnapshot,
  approveProductionOrder,
  batchMaterialChanges,
  confirmPicked,
  createProductionOrder,
  decideMaterialSubstitution,
  getFloorDisplay,
  getMaterialsList,
  getWeighView,
  materialSubstitutionApprovalVerdicts,
  myFloorTasks,
  recordDispense,
  requestMaterialSubstitution,
  stopForToday,
  useAnotherLot,
  useApprovedAlternative,
} from "@/modules/production";
import { getQualityCheck } from "@/modules/quality";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, makeLot, type Kit } from "../../support/kit";
import { cleanEquipment, signChecklist } from "../../support/w2b";
import { day, productId } from "./w2a-fixtures";

let kit: Kit;
let operator: AuthContext;
let checker: AuthContext;
let operatorRvs: AuthContext;
let manager: AuthContext;
let planner: AuthContext;
let qa: AuthContext;
let qaLead: AuthContext;
let qaRvs: AuthContext;
let sales: AuthContext;
let ownerOverride: AuthContext;
let batchId: string;
let lotA: typeof inventoryLots.$inferSelect;
let lotB: typeof inventoryLots.$inferSelect;
let lotC: typeof inventoryLots.$inferSelect;
let coconutLine: typeof batchMaterials.$inferSelect;
const key = () => `fd-${uuidv7()}`;

async function lineOf(code: string) {
  const [r] = await db
    .select({ bm: batchMaterials })
    .from(batchMaterials)
    .innerJoin(materials, eq(materials.id, batchMaterials.materialId))
    .where(and(eq(batchMaterials.batchId, batchId), eq(materials.code, code), sql`${batchMaterials.status} <> 'substituted'`));
  return r.bm;
}
async function material(code: string) {
  return (await db.select().from(materials).where(eq(materials.code, code)))[0];
}
async function activeReservation(lotId: string) {
  return db.select().from(stockReservations).where(and(eq(stockReservations.lotId, lotId), eq(stockReservations.status, "active")));
}

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  operatorRvs = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.rvs]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  planner = await asUser(kit, "planner.nfd@bryels-care.test", "production_planner", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd]);
  qaLead = await asUser(kit, "qa.lead@bryels-care.test", "qa_qc", [kit.nfd]).catch(async () => asUser(kit, "auditor@bryels-care.test", "qa_qc", [kit.nfd]));
  qaRvs = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.rvs]);
  sales = await asUser(kit, "sales@bryels-care.test", "sales_cs", [kit.nfd]);
  const owner = await asUser(kit, "owner@bryels-care.test", "owner_director", [kit.nfd, kit.rvs]);
  ownerOverride = new AuthContext(owner.userId, kit.orgId, owner.displayName, owner.email, ["owner_director"], new Set(PERMISSIONS), [kit.nfd, kit.rvs], kit.nfd.id, {
    ownerOverride: { basePermissions: new Set(ROLE_BUNDLES.owner_director.permissions), used: [] },
  });
  // Two coconut oil lots that expire before every seeded one: A holds 1 kg (taken whole), B is an opened 50 kg drum.
  const [seedLoc] = await db
    .select({ id: locations.id })
    .from(inventoryBalances)
    .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .innerJoin(materials, eq(materials.id, inventoryLots.materialId))
    .where(and(eq(materials.code, "MAT-0012"), eq(inventoryLots.siteId, kit.nfd.id), eq(inventoryLots.qualityStatus, "released"), sql`${inventoryBalances.qtyBase} > 0`, eq(locations.kind, "storage")))
    .limit(1);
  lotA = await makeLot(manager, kit.nfd.id, seedLoc.id, "1000", { expiresOn: "2027-03-01" });
  lotB = await makeLot(manager, kit.nfd.id, seedLoc.id, "50000", { expiresOn: "2027-03-02" });
  lotC = await makeLot(manager, kit.nfd.id, seedLoc.id, "40000", { expiresOn: "2027-06-01" });
  const r = await createProductionOrder(planner, { productId: await productId("ACS-135"), plannedStart: day(0), idempotencyKey: key() });
  const a = await approveProductionOrder(manager, r.workOrderId, { idempotencyKey: key() });
  batchId = a.batches[0].batchId;
  coconutLine = await lineOf("MAT-0012");
}, 240_000);

describe("ADR-106 Get materials: lots in use-first order, how much from each, what stays in the container", () => {
  it("splits the coconut oil over lot A (all of it) and the opened drum B (weigh out the rest, the rest stays)", async () => {
    const v = await getMaterialsList(operator, batchId);
    const line = v.lines.find((l) => l.materialCode === "MAT-0012")!;
    expect(line.plan.steps.map((s) => s.lotNumber).slice(0, 2)).toEqual([lotA.lotNumber, lotB.lotNumber]);
    expect(line.plan.steps[0]).toMatchObject({ all: true, take: "1000" });
    const need = Number(coconutLine.theoreticalQtyG);
    expect(Number(line.plan.steps[1].take)).toBeCloseTo(need - 1000, 3);
    expect(line.plan.steps[1].all).toBe(false);
    expect(line.plan.sentence).toContain(`Take all 1 kg of lot ${lotA.lotNumber}`);
    expect(line.plan.sentence).toContain(`bring lot ${lotB.lotNumber} (50 kg in it`);
    expect(line.plan.sentence).toMatch(/stays for the next batch/);
    expect(line.plan.short).toBe("0");
  });

  it("another site cannot read the list", async () => {
    await expectCode(getMaterialsList(operatorRvs, batchId), "not_found");
  });
});

describe("ADR-106 weighing follows Get materials; another lot needs a reason and leaves a note for QA", () => {
  beforeAll(async () => {
    await confirmPicked(operator, { batchId, all: true, idempotencyKey: key() });
    await cleanEquipment(operator, "SC-01");
    await cleanEquipment(operator, "MIX-01");
    const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
    const s1 = [...(b.formulaSnapshot as FormulaSnapshot).steps].sort((x, z) => x.stepNo - z.stepNo)[0];
    await signChecklist(operator, checker, batchId, s1);
  });

  it("the weigh card proposes the same lots in the same order with amounts", async () => {
    const v = await getWeighView(operator, batchId);
    const card = v.cards.find((c) => c.batchMaterialId === coconutLine.id)!;
    expect(card.plan.map((p) => p.lotNumber)).toEqual([lotA.lotNumber, lotB.lotNumber]);
    expect(card.proposal).toBe(`from ${lotA.lotNumber}: 1 kg, then ${lotB.lotNumber}: ${Number(((Number(coconutLine.theoreticalQtyG) - 1000) / 1000).toFixed(3)).toLocaleString("en-PH", { maximumFractionDigits: 3 })} kg`);
    expect(card.lots[0].lotNumber).toBe(lotA.lotNumber);
    // Other lots are offered only under "Use another lot" (one way to pick): never the set-aside ones.
    expect(card.otherLots.some((o) => o.lotNumber === lotC.lotNumber)).toBe(true);
    expect(card.otherLots.some((o) => o.lotNumber === lotA.lotNumber)).toBe(false);
  });

  it("a lot not taken at Get materials is refused with the plain warning until a reason is tapped", async () => {
    const e = await expectCode(
      recordDispense(operator, { batchId, batchMaterialId: coconutLine.id, lotRef: lotC.id, qty: "1000", partial: true, equipmentRef: "SC-01", lotPreselected: true, lotConfirm: `BC:LOT:${lotC.lotNumber}` }, { checker }),
      "blocked_lot",
    );
    expect(e.message).toBe(`This is not the lot you took at Get materials (${lotA.lotNumber}, ${lotB.lotNumber}). You can continue — QA will see a note.`);
    expect((e.details as { offPlan?: boolean }).offPlan).toBe(true);
  });

  it("expired lots and another site's lots are never accepted, even with a reason", async () => {
    const expired = await makeLot(manager, kit.nfd.id, lotA.id ? (await db.select().from(inventoryBalances).where(eq(inventoryBalances.lotId, lotA.id)))[0].locationId : "", "5000", { expiresOn: "2026-01-01" });
    await expectCode(recordDispense(operator, { batchId, batchMaterialId: coconutLine.id, lotRef: expired.id, qty: "1000", partial: true, equipmentRef: "SC-01", offPlanReasonCode: "damaged" }, { checker }), "blocked_lot");
    const rvsLoc = (await db.select().from(locations).where(eq(locations.siteId, kit.rvs.id)).limit(1))[0];
    const other = await makeLot(ownerOverride, kit.rvs.id, rvsLoc.id, "5000");
    const e = await recordDispense(operator, { batchId, batchMaterialId: coconutLine.id, lotRef: other.id, qty: "1000", partial: true, equipmentRef: "SC-01", offPlanReasonCode: "damaged" }, { checker }).catch((x) => x);
    expect(["not_found", "blocked_lot"]).toContain(e.code);
    // Another site's operator cannot weigh this batch at all.
    await expectCode(recordDispense(operatorRvs, { batchId, batchMaterialId: coconutLine.id, lotRef: lotC.id, qty: "1000", equipmentRef: "SC-01", offPlanReasonCode: "damaged" }), "not_found");
  });

  it("with a one-tap reason it is weighed; the set-aside moves; QA sees the note on Check quality and the batch record", async () => {
    const need = coconutLine.theoreticalQtyG;
    await recordDispense(operator, { batchId, batchMaterialId: coconutLine.id, lotRef: lotC.id, qty: need, equipmentRef: "SC-01", lotPreselected: true, lotConfirm: `BC:LOT:${lotC.lotNumber}`, offPlanReasonCode: "cant_reach" }, { checker });
    const changes = await batchMaterialChanges(db, batchId);
    const note = changes.find((c) => c.batchMaterialId === coconutLine.id)!;
    expect(note.kind).toBe("floor_lot");
    expect(note.sentence).toContain(`Coconut Oil: lot changed from`);
    expect(note.sentence).toContain(`to ${lotC.lotNumber} — Not the lot taken at Get materials`);
    expect(note.sentence).toContain("I can't reach it, by Rhea Mendoza");
    const q = await getQualityCheck(qa, batchId);
    expect(q.exceptions.some((x) => x.kind === "lot_not_taken" && x.text.includes(lotC.lotNumber))).toBe(true);
    // The order's set-aside of lot A was released for the weighed amount (it stays free for the next batch).
    expect((await activeReservation(lotC.id)).length).toBe(0); // converted by the weighing
    const [line] = await db.select().from(batchMaterials).where(eq(batchMaterials.id, coconutLine.id));
    expect(line.status).toBe("dispensed");
  });
});

describe("ADR-104 §1a Use another lot (same ingredient)", () => {
  let palm: typeof batchMaterials.$inferSelect;
  let late: typeof inventoryLots.$inferSelect;
  let early: typeof inventoryLots.$inferSelect;
  beforeAll(async () => {
    palm = await lineOf("MAT-0013");
    const [locRow] = await db.select({ id: inventoryBalances.locationId }).from(inventoryBalances).where(eq(inventoryBalances.lotId, lotA.id));
    early = await makeLot(manager, kit.nfd.id, locRow.id, "60000", { expiresOn: "2027-09-01", materialCode: "MAT-0013" });
    late = await makeLot(manager, kit.nfd.id, locRow.id, "60000", { expiresOn: "2029-09-01", materialCode: "MAT-0013" });
  });

  it("roles and sites: QA (cannot weigh) is refused, another site does not find the batch", async () => {
    await expectCode(useAnotherLot(qa, { batchId, batchMaterialId: palm.id, lotId: late.id, reasonCode: "damaged" }), "forbidden");
    await expectCode(useAnotherLot(operatorRvs, { batchId, batchMaterialId: palm.id, lotId: late.id, reasonCode: "damaged" }), "not_found");
  });

  it("a lot that is not the one to use first needs a reason; with it the set-aside moves; a repeat returns the first result", async () => {
    const v = await getWeighView(operator, batchId);
    const card = v.cards.find((c) => c.batchMaterialId === palm.id)!;
    const first = card.otherLots.find((o) => o.useFirst)!;
    expect(first.lotNumber).not.toBe(late.lotNumber);
    const e = await expectCode(useAnotherLot(operator, { batchId, batchMaterialId: palm.id, lotId: late.id }), "validation");
    expect(e.message).toMatch(/should be used first/);
    await expectCode(useAnotherLot(operator, { batchId, batchMaterialId: palm.id, lotId: late.id, reasonCode: "other" }), "validation");
    const k = key();
    const r1 = await useAnotherLot(operator, { batchId, batchMaterialId: palm.id, lotId: late.id, reasonCode: "damaged", note: "Drum lid broken", idempotencyKey: k });
    const r2 = await useAnotherLot(operator, { batchId, batchMaterialId: palm.id, lotId: late.id, reasonCode: "damaged", note: "Drum lid broken", idempotencyKey: k });
    expect(r2.substitutionId).toBe(r1.substitutionId);
    expect(r1.reason).toBe("The first lot is damaged: Drum lid broken");
    expect((await activeReservation(late.id)).reduce((s, x) => s + Number(x.qtyBase), 0)).toBeCloseTo(Number(palm.theoreticalQtyG), 3);
    const after = await getWeighView(operator, batchId);
    expect(after.cards.find((c) => c.batchMaterialId === palm.id)!.lots[0].lotNumber).toBe(late.lotNumber);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "production.batch_material.lot_changed"), eq(auditEvents.entityId, batchId), sql`${auditEvents.after}->>'lot' = ${late.lotNumber}`));
    expect(ev).toBeTruthy();
    expect(early).toBeTruthy();
  });
});

describe("ADR-104 §1b the recipe's approved alternative", () => {
  it("swaps the line for this batch only: new line, old one substituted, history kept", async () => {
    const lye = await lineOf("MAT-0021");
    const alt = await material("MAT-0043");
    // Fixture: the approved recipe lists an alternative (written with triggers off: approved recipes are fixed).
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.insert(bomLineAlternatives).values({ bomLineId: lye.bomLineId!, materialId: alt.id, ratio: "1", notes: "Fictional test alternative" });
    });
    const v = await getWeighView(operator, batchId);
    const card = v.cards.find((c) => c.batchMaterialId === lye.id)!;
    expect(card.alternatives.map((a) => a.materialName)).toEqual([alt.name]);
    const k = key();
    const r = await useApprovedAlternative(operator, { batchId, batchMaterialId: lye.id, alternativeId: card.alternatives[0].id, idempotencyKey: k });
    const again = await useApprovedAlternative(operator, { batchId, batchMaterialId: lye.id, alternativeId: card.alternatives[0].id, idempotencyKey: k });
    expect(again.newBatchMaterialId).toBe(r.newBatchMaterialId);
    const [old] = await db.select().from(batchMaterials).where(eq(batchMaterials.id, lye.id));
    expect(old.status).toBe("substituted");
    const after = await getWeighView(operator, batchId);
    expect(after.cards.some((c) => c.batchMaterialId === lye.id)).toBe(false);
    const nc = after.cards.find((c) => c.batchMaterialId === r.newBatchMaterialId)!;
    expect(nc.materialName).toBe(alt.name);
    expect(nc.insteadOf?.materialName).toBeTruthy();
    // Not offered again on the swapped line; a second swap of the old line is refused.
    await expectCode(useApprovedAlternative(operator, { batchId, batchMaterialId: lye.id, alternativeId: card.alternatives[0].id }), "state");
  });
});

describe("ADR-104 §1b ask to use something else: QA decides (A-FD-02)", () => {
  let line: typeof batchMaterials.$inferSelect;
  let requestId: string;
  beforeAll(async () => {
    line = await lineOf("MAT-0051");
  });

  it("the operator asks; the card says who must say yes", async () => {
    const other = await material("MAT-0013");
    const r = await requestMaterialSubstitution(operator, { batchId, batchMaterialId: line.id, substituteMaterialId: other.id, reason: "Fragrance lot smells off", idempotencyKey: key() });
    requestId = r.requestId;
    const v = await getWeighView(operator, batchId);
    const card = v.cards.find((c) => c.batchMaterialId === line.id)!;
    expect(card.waitingForQa).toMatchObject({ substituteName: other.name, mine: true });
    expect(card.waitingForQa?.qaNames).toContain("Nina");
    expect(card.canAskOther).toBe(false);
    await expectCode(requestMaterialSubstitution(operator, { batchId, batchMaterialId: line.id, substituteMaterialId: other.id, reason: "Second ask", idempotencyKey: key() }), "conflict");
  });

  it("negatives: the requester, the site manager, the owner with the override and another site's QA cannot decide", async () => {
    await expectCode(decideMaterialSubstitution(operator, { requestId, decision: "approve" }), "forbidden");
    await expectCode(decideMaterialSubstitution(manager, { requestId, decision: "approve" }), "forbidden");
    await expectCode(decideMaterialSubstitution(ownerOverride, { requestId, decision: "approve" }), "forbidden");
    await expectCode(decideMaterialSubstitution(qaRvs, { requestId, decision: "approve" }), "not_found");
    await expectCode(decideMaterialSubstitution(sales, { requestId, decision: "approve" }), "not_found").catch(async () => expectCode(decideMaterialSubstitution(sales, { requestId, decision: "approve" }), "forbidden"));
    const verdicts = await materialSubstitutionApprovalVerdicts(qa, [requestId]);
    expect(verdicts.get(requestId)?.canDecide).toBe(true);
    expect((await materialSubstitutionApprovalVerdicts(manager, [requestId])).get(requestId)?.canDecide).toBe(false);
    expect((await materialSubstitutionApprovalVerdicts(ownerOverride, [requestId])).get(requestId)?.canDecide).toBe(false);
  });

  it("a QA person approves: the line is swapped for this batch; a repeat replays; the new ingredient can be weighed", async () => {
    const k = key();
    const r = await decideMaterialSubstitution(qa, { requestId, decision: "approve", note: "OK for this batch", idempotencyKey: k });
    expect(r.status).toBe("approved");
    const again = await decideMaterialSubstitution(qa, { requestId, decision: "approve", note: "OK for this batch", idempotencyKey: k });
    expect(again.newBatchMaterialId).toBe(r.newBatchMaterialId);
    await expectCode(decideMaterialSubstitution(qaLead, { requestId, decision: "approve" }), "state");
    const [old] = await db.select().from(batchMaterials).where(eq(batchMaterials.id, line.id));
    expect(old.status).toBe("substituted");
    const v = await getWeighView(operator, batchId);
    const card = v.cards.find((c) => c.batchMaterialId === r.newBatchMaterialId)!;
    expect(card.insteadOf?.sentence).toMatch(/approved by QA \(Nina Quiambao\)/);
    const lot = card.lots[0];
    await recordDispense(operator, { batchId, batchMaterialId: card.batchMaterialId, lotRef: lot.lotId, locationRef: lot.locationId, qty: card.target, equipmentRef: "SC-01", lotPreselected: true, lotConfirm: `BC:LOT:${lot.lotNumber}` }, { checker });
  });

  it("QA asking themselves cannot approve their own request; a second QA person can", async () => {
    const pine = await lineOf("MAT-0043");
    const other = await material("MAT-0012");
    const r = await requestMaterialSubstitution(qa, { batchId, batchMaterialId: pine.id, substituteMaterialId: other.id, reason: "QA asks on the floor" }).catch((e) => e);
    // QA cannot weigh, so cannot ask on the floor either (production.dispense_record.create).
    expect(r.code).toBe("forbidden");
  });
});

describe("ADR-104 §5 stop for today, continue tomorrow", () => {
  it("records where we stopped (audited, idempotent); roles and sites refused", async () => {
    await expectCode(stopForToday(sales, { batchId, stepNo: 2 }), "forbidden");
    await expectCode(stopForToday(operatorRvs, { batchId, stepNo: 2 }), "not_found");
    const k = key();
    const p1 = await stopForToday(operator, { batchId, stepNo: 2, note: "Two lines left to weigh", idempotencyKey: k });
    const p2 = await stopForToday(operator, { batchId, stepNo: 2, note: "Two lines left to weigh", idempotencyKey: k });
    expect(p2.pauseId).toBe(p1.pauseId);
    expect(p1.whereStopped).toMatch(/^Step 2 · /);
    expect((await db.select().from(batchPauses).where(eq(batchPauses.batchId, batchId))).length).toBe(1);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "production.batch.paused"), eq(auditEvents.entityId, batchId)));
    expect(ev).toBeTruthy();
  });

  it("the next day the task reads Continue … · started yesterday, with the note; the TV says day 2", async () => {
    await db.execute(sql`update batches set started_at = now() - interval '1 day' where id = ${batchId}`);
    const t = (await myFloorTasks(operator)).find((x) => x.batchId === batchId)!;
    expect(t.title).toMatch(/^Continue Acapulco Soap.* · step \d+ · started yesterday$/);
    expect(t.dayNo).toBe(2);
    expect(t.pauseNote).toMatch(/^Stopped today by Rhea: Step 2 · .* — Two lines left to weigh$/);
    const floor = await getFloorDisplay(operator);
    expect(floor.makingNow.cards.find((c) => c.batchId === batchId)?.dayLabel).toBe("day 2");
  });
});

describe("weigh targets of a batch not at the recipe size (33.333 kg, as when an order is split evenly) are typed at 3 decimals", () => {
  it("every target and window has at most 3 decimals and weighing exactly the target is accepted", async () => {
    const r = await createProductionOrder(planner, { productId: await productId("ACS-135"), plannedStart: day(0), batchSizeKg: "33.333", idempotencyKey: key() });
    const a = await approveProductionOrder(manager, r.workOrderId, { idempotencyKey: key() });
    const id = a.batches[0].batchId;
    const raw = await db.select().from(batchMaterials).where(eq(batchMaterials.batchId, id));
    expect(raw.some((l) => new Decimal(l.theoreticalQtyG).decimalPlaces() > 3)).toBe(true);
    await confirmPicked(operator, { batchId: id, all: true, idempotencyKey: key() });
    const [b] = await db.select().from(batches).where(eq(batches.id, id));
    await signChecklist(operator, checker, id, [...(b.formulaSnapshot as FormulaSnapshot).steps].sort((x, z) => x.stepNo - z.stepNo)[0]);
    const v = await getWeighView(operator, id);
    for (const c of v.cards) for (const x of [c.target, c.min, c.max]) expect(new Decimal(x).decimalPlaces()).toBeLessThanOrEqual(3);
    const c = v.cards.find((x) => x.plan.length === 1 && new Decimal(raw.find((l) => l.id === x.batchMaterialId)!.theoreticalQtyG).decimalPlaces() > 3)!;
    const lot = c.lots[0];
    const res = await recordDispense(operator, { batchId: id, batchMaterialId: c.batchMaterialId, lotRef: lot.lotId, locationRef: lot.locationId, qty: c.target, equipmentRef: "SC-01", lotPreselected: true, lotConfirm: `BC:LOT:${lot.lotNumber}` }, { checker });
    expect(res.withinTolerance).toBe(true);
    expect(res.status).toBe("dispensed");
  });
});

/**
 * "Every approval must indicate who approves next" (owner, 2026-11-01; docs/NEXT_APPROVER.md): `nextActors` names the
 * people who can do the next step, by site, permission, step roles and same-person rules (ADR-091 for operational
 * records, independent second person for floor checks and QA), and `notifyNextActors` tells them once.
 * Contexts are built from the real seeded assignments (buildContextForUser).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, like, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { batchMaterials, materials, notifications, products, roles, suppliers, userSiteAssignments, users } from "@/db/schema";
import { type AuthContext, buildContextForUser } from "@/lib/auth/context";
import { nextActorsSentence } from "@/lib/next-actors-words";
import { nextActors } from "@/modules/governance";
import { createPurchaseOrder, decidePurchaseOrder, procurementNextActors, sendPurchaseOrder, submitPurchaseOrder } from "@/modules/procurement";
import { batchQaNext, createBatch, createWorkOrder, myFloorTasks, productionOrderNext, recordDispense, startBatch, submitChecklist, type FormulaSnapshot } from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { type Kit, loadKit, loc, makeLot } from "../../support/kit";
import { type FixtureStep, allowDirectBatches, cleanEquipment, makeExecutionFixture, manilaDay } from "../../support/w2b";

let kit: Kit;
const uid = async (email: string) => (await db.select().from(users).where(eq(users.email, email)))[0].id;
const ctx = async (email: string): Promise<AuthContext> => (await buildContextForUser(await uid(email), kit.nfd.id))!;
const names = (n: { people: { name: string }[] } | null) => (n?.people ?? []).map((p) => p.name);

const STEPS: FixtureStep[] = [
  { name: "Weighing area clearance", kind: "line_clearance", area: "weighing", checklist: [{ text: "Bench clear" }] },
  { name: "Weighing", kind: "dispensing", equipmentKind: "scale" },
  { name: "Transfer to quarantine", kind: "transfer" },
];
let fixture: Awaited<ReturnType<typeof makeExecutionFixture>>;

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  registerAppHooks();
  await allowDirectBatches(kit);
  // An operator at the other site only (cross-site negative).
  await db.insert(users).values({ organizationId: kit.orgId, email: "operator.rvs@bryels-care.test", displayName: "Rico Santos (fictional)", passwordHash: "!" });
  const [op] = await db.select().from(roles).where(and(eq(roles.organizationId, kit.orgId), eq(roles.code, "production_operator")));
  await db.insert(userSiteAssignments).values({ userId: await uid("operator.rvs@bryels-care.test"), roleId: op.id, siteId: kit.rvs.id });
  fixture = await makeExecutionFixture(kit, STEPS);
}, 180_000);

async function batchAtWeighing(operator: AuthContext, checker: AuthContext) {
  const manager = await ctx("manager.nfd@bryels-care.test");
  const { batchId } = await createBatch(manager, { formulaRevisionId: fixture.formulaRevisionId, plannedSizeKg: "1.5", plannedStartOn: manilaDay(0) });
  await startBatch(operator, batchId);
  return { batchId, manager, checker };
}

describe("weighing check", () => {
  it("names the people who can check, never the weigher or another site's people, and tells them once", async () => {
    const operator = await ctx("operator.nfd@bryels-care.test");
    const checker = await ctx("checker.nfd@bryels-care.test");
    const { batchId, manager } = await batchAtWeighing(operator, checker);
    const [b] = await db.execute<{ formula_snapshot: FormulaSnapshot }>(sql`select formula_snapshot from batches where id = ${batchId}`);
    const clearance = b.formula_snapshot.steps.find((s) => s.stepKind === "line_clearance")!;
    await submitChecklist(operator, { batchId, stepNo: clearance.stepNo, answers: clearance.checklistItems!.map((i) => ({ itemId: i.id, answer: "yes" as const })) }, { checker });
    await cleanEquipment(operator, "SC-01");
    const lines = await db.select().from(batchMaterials).where(eq(batchMaterials.batchId, batchId)).orderBy(batchMaterials.lineNo);
    const b01 = (await loc(kit.nfd.id, "B-01")).id;
    const coconut = await makeLot(manager, kit.nfd.id, b01, "2000", { materialCode: "MAT-0012" });
    const palm = await makeLot(manager, kit.nfd.id, b01, "2000", { materialCode: "MAT-0013" });

    const r = await recordDispense(operator, { batchId, batchMaterialId: lines[0].id, lotRef: coconut.id, qty: "1000", equipmentRef: "SC-01" });
    expect(r.needsCheck).toBe(true);

    const next = await nextActors(operator, "weighing_check", { siteId: kit.nfd.id, excludeUserIds: [operator.userId] });
    expect(names(next)).toContain("Jun Dela Cruz");
    expect(names(next)).toContain("Dino Reyes");
    expect(names(next)).not.toContain("Rhea Mendoza");
    expect(names(next)).not.toContain("Rico Santos (fictional)");
    expect(next.people[0].role).toBe("operator"); // floor people first
    expect(nextActorsSentence(next)).toMatch(/^Next: Jun \(operator\)/);
    expect(nextActorsSentence(next)).toContain("checks this weighing — they will see it on their Home.");

    // Even the owner never checks a weighing as the weigher's stand-in: the weigher is excluded for everyone.
    const asChecker = await nextActors(checker, "weighing_check", { siteId: kit.nfd.id, excludeUserIds: [checker.userId] });
    expect(asChecker.viewer.can).toBe(false);

    const sent = async () => db.select().from(notifications).where(like(notifications.dedupeKey, `handoff.weighing_check:${batchId}:%`));
    const first = await sent();
    expect(first.map((n) => n.recipientUserId)).toContain(checker.userId);
    expect(first.map((n) => n.recipientUserId)).not.toContain(operator.userId);
    expect(first[0].link).toContain(`/weigh?batch=${batchId}`);

    // A second weighing of the same step does not tell the same people again.
    await recordDispense(operator, { batchId, batchMaterialId: lines[1].id, lotRef: palm.id, qty: "503", equipmentRef: "SC-01" });
    const again = await sent();
    expect(again.length).toBe(first.length);
    expect(again.filter((n) => n.recipientUserId === checker.userId)).toHaveLength(1);

    // The checker's Home lists "Check 2 weighings" for this batch; the weigher's does not.
    const tasks = await myFloorTasks(checker);
    const t = tasks.find((x) => x.batchId === batchId);
    expect(t?.kind).toBe("check");
    expect(t?.canDo).toBe(true);
    const mine = (await myFloorTasks(operator)).find((x) => x.batchId === batchId);
    expect(mine?.kind === "check" && mine.canDo).toBe(false);
  });

  it("start check without a co-signer tells the checkers, not the person who answered", async () => {
    const operator = await ctx("operator.nfd@bryels-care.test");
    const checker = await ctx("checker.nfd@bryels-care.test");
    const { batchId } = await batchAtWeighing(operator, checker);
    const [b] = await db.execute<{ formula_snapshot: FormulaSnapshot }>(sql`select formula_snapshot from batches where id = ${batchId}`);
    const clearance = b.formula_snapshot.steps.find((s) => s.stepKind === "line_clearance")!;
    const r = await submitChecklist(operator, { batchId, stepNo: clearance.stepNo, answers: clearance.checklistItems!.map((i) => ({ itemId: i.id, answer: "yes" as const })) });
    expect(r.status).toBe("awaiting_check");
    const rows = await db.select().from(notifications).where(and(eq(notifications.kind, "handoff.start_check"), eq(notifications.entityId, batchId)));
    expect(rows.map((n) => n.recipientUserId)).toContain(checker.userId);
    expect(rows.map((n) => n.recipientUserId)).not.toContain(operator.userId);
  });
});

describe("purchase order steps", () => {
  it("step 1 names the site manager, step 2 the owner (never the step-1 approver)", async () => {
    const buyer = await ctx("procurement@bryels-care.test");
    const [s] = await db.select().from(suppliers).where(sql`${suppliers.name} like 'Laguna Oleo Supply%'`);
    const [m] = await db.select().from(materials).where(eq(materials.code, "MAT-0012"));
    const po = await createPurchaseOrder(buyer, { supplierId: s.id, lines: [{ materialId: m.id, qty: "400", uom: "kg" }] });
    await submitPurchaseOrder(buyer, { purchaseOrderId: po.purchaseOrderId });
    const step1 = await procurementNextActors(buyer, "purchase_order", po.purchaseOrderId);
    expect(step1?.stepNo).toBe(1);
    expect(step1?.stepsTotal).toBe(2);
    expect(names(step1)).toEqual(["Dino Reyes"]);
    expect(nextActorsSentence(step1!)).toBe("Next: Dino (site manager) approves it (step 1 of 2) — they will see it in To approve.");

    await decidePurchaseOrder(await ctx("manager.nfd@bryels-care.test"), { purchaseOrderId: po.purchaseOrderId, decision: "approve" });
    const step2 = await procurementNextActors(buyer, "purchase_order", po.purchaseOrderId);
    expect(step2?.stepNo).toBe(2);
    expect(names(step2)).toEqual(["Ana Villanueva"]);
    expect(step2?.people[0].role).toBe("owner");
    // The manager who approved step 1 reads who is next, and may not decide step 2.
    const asManager = await procurementNextActors(await ctx("manager.nfd@bryels-care.test"), "purchase_order", po.purchaseOrderId);
    expect(asManager?.viewer.can).toBe(false);
    expect(names(asManager)).toEqual(["Ana Villanueva"]);

    // Approved and sent: who sends it, then the warehouse is told the delivery is coming (C9(a)).
    await decidePurchaseOrder(await ctx("owner@bryels-care.test"), { purchaseOrderId: po.purchaseOrderId, decision: "approve" });
    expect(nextActorsSentence((await procurementNextActors(await ctx("manager.nfd@bryels-care.test"), "purchase_order", po.purchaseOrderId))!)).toContain("sends it to the supplier");
    await sendPurchaseOrder(buyer, { purchaseOrderId: po.purchaseOrderId, email: false, idempotencyKey: `t-${Date.now()}` });
    const coming = await db.select().from(notifications).where(and(eq(notifications.kind, "handoff.delivery_coming"), eq(notifications.entityId, po.purchaseOrderId)));
    const lito = (await db.select().from(users).where(eq(users.email, "warehouse.nfd@bryels-care.test")))[0].id;
    expect(coming.map((n) => n.recipientUserId)).toContain(lito);
    expect(coming.map((n) => n.recipientUserId)).not.toContain(buyer.userId);
    expect(coming[0].title).toMatch(/^Delivery coming/);
  });
});

describe("QA decision and top-role self-approval", () => {
  it("only QA people decide a batch", async () => {
    const operator = await ctx("operator.nfd@bryels-care.test");
    const checker = await ctx("checker.nfd@bryels-care.test");
    const { batchId } = await batchAtWeighing(operator, checker);
    const next = await batchQaNext(operator, batchId);
    expect(next!.people.length).toBeGreaterThan(0);
    expect(next!.people.every((p) => p.role === "QA")).toBe(true);
    expect(names(next)).toContain("Nina Quiambao");
    expect(nextActorsSentence(next!)).toContain("decides if the batch may be sold — they will see it on Check quality.");
  });

  it('the site manager reads "You can approve this yourself" on their own production order; a planner\'s order names the approvers', async () => {
    const [p] = await db.select().from(products).where(eq(products.skuCode, "ACS-135"));
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    const manager = await ctx("manager.nfd@bryels-care.test");
    const own = await createWorkOrder(manager, { productId: p.id, batchCount: 1, plannedStart: day(2), plannedEnd: day(3) });
    const mine = await productionOrderNext(manager, own.workOrderId);
    expect(mine?.viewer.selfApproval).toBe(true);
    expect(nextActorsSentence(mine!)).toMatch(/^You can approve this yourself because you are the site manager\./);

    const planner = await ctx("planner.nfd@bryels-care.test");
    const theirs = await createWorkOrder(planner, { productId: p.id, batchCount: 1, plannedStart: day(2), plannedEnd: day(3) });
    const next = await productionOrderNext(planner, theirs.workOrderId);
    expect(next?.viewer.can).toBe(false);
    expect(names(next)).toContain("Dino Reyes");
    expect(names(next)).not.toContain("Cora Villamor");
  });
});

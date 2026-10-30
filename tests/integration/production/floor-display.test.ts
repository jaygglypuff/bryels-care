/**
 * Floor screen (docs/FLOOR_DISPLAY.md, ADR-084): the read-only read model behind the production TV.
 *   - a started batch shows in "Making now" with its current step, step x of y and the assignee's first name;
 *   - an approved order that has not started shows in "Next up" with pieces and the late flag;
 *   - "Waiting" counts curing, quality check and orders missing materials; "Today" sums the daily log;
 *   - no prices and no customer names in the payload;
 *   - negative: another site's user gets not_found, a role without production.batch.view is forbidden.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { batches, roles, salesOrders, userSiteAssignments, users, workOrders } from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import { ROLE_BUNDLES } from "@/lib/permissions";
import { type FormulaSnapshot, addDailyLog, approveProductionOrder, assignProductionOrder, confirmPicked, createProductionOrder, getFloorDisplay } from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { signChecklist } from "../../support/w2b";
import { ctxFor, day, expectCode, loadWorld, productId, type World } from "./w2a-fixtures";

let w: World;
let checker: AuthContext;
let display: AuthContext;
let startedOrder: string;
let startedBatch: string;
let waitingOrder: string;
const key = () => `floor-${uuidv7()}`;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
  checker = await ctxFor(w.orgId, "checker.nfd@bryels-care.test", "production_operator", [w.nfd]);
  display = await ctxFor(w.orgId, "floor.nfd@bryels-care.test", "floor_display", [w.nfd]);

  // An order that is started: materials ticked, Start check signed → in_process, assigned to Rhea.
  startedOrder = (await createProductionOrder(w.planner, { productId: await productId("ACS-135"), plannedStart: day(0), idempotencyKey: key() })).workOrderId;
  startedBatch = (await approveProductionOrder(w.manager, startedOrder, { idempotencyKey: key() })).batches[0].batchId;
  await assignProductionOrder(w.manager, startedOrder, { assigneeId: w.operator.userId });
  await confirmPicked(w.operator, { batchId: startedBatch, all: true, idempotencyKey: key() });
  const [b] = await db.select().from(batches).where(eq(batches.id, startedBatch));
  const clearance = [...(b.formulaSnapshot as FormulaSnapshot).steps].sort((x, z) => x.stepNo - z.stepNo).find((s) => s.stepKind === "line_clearance")!;
  await signChecklist(w.operator, checker, startedBatch, clearance);

  // An order approved but not started, needed yesterday (late).
  waitingOrder = (await createProductionOrder(w.planner, { productId: await productId("GBS-135"), quantityUnits: "120", plannedStart: day(-2), neededBy: day(-1), idempotencyKey: key() })).workOrderId;
  await approveProductionOrder(w.manager, waitingOrder, { idempotencyKey: key() });

  // Today's daily log on the started order: 40 good, 2 rejects.
  await addDailyLog(w.operator, { workOrderId: startedOrder, batchId: startedBatch, goodQty: "40", defects: [{ defectType: "Cracked bar", quantity: "2" }], idempotencyKey: key() });
}, 180_000);

describe("getFloorDisplay", () => {
  it("shows a started batch in Making now with its current step, position and assignee first name", async () => {
    const v = await getFloorDisplay(display);
    expect(v.site.code).toBe("NFD");
    const card = v.makingNow.cards.find((c) => c.batchId === startedBatch);
    expect(card, "started batch in Making now").toBeTruthy();
    expect(card!.status).toBe("in_process");
    expect(card!.stepName).toBeTruthy();
    expect(card!.stepIndex).toBeGreaterThan(1); // the Start check is done
    expect(card!.stepTotal).toBeGreaterThanOrEqual(card!.stepIndex);
    expect(card!.stepText).toBe(`Step ${card!.stepIndex} of ${card!.stepTotal} · ${card!.stepName}`);
    expect(Number(card!.percent)).toBeGreaterThan(0);
    expect(card!.assignee).toBe(w.operator.displayName.split(" ")[0]);
    expect(card!.productName).toBe("Acapulco Soap 135 g");
    expect(card!.startedAt).not.toBeNull();
    expect(v.makingNow.cards.length).toBeLessThanOrEqual(6);
    expect(v.makingNow.cards.length + v.makingNow.more).toBe(v.makingNow.total);
  });

  it("shows an approved order that has not started in Next up, late first, with pieces", async () => {
    const v = await getFloorDisplay(w.owner, { siteId: w.nfd.id });
    const row = v.nextUp.rows.find((r) => r.workOrderId === waitingOrder);
    expect(row, "approved order in Next up").toBeTruthy();
    expect(row!.late).toBe(true);
    expect(row!.piecesText).toMatch(/bars/);
    expect(row!.neededByText).toMatch(/^Needed by /);
    expect(v.nextUp.rows[0].late).toBe(true); // ordered by needed-by: the late order is first
    // The started order is in Making now, not in Next up.
    expect(v.nextUp.rows.some((r) => r.workOrderId === startedOrder)).toBe(false);
    expect(v.nextUp.rows.length).toBeLessThanOrEqual(5);
  });

  it("counts the waiting panel and sums today's daily log", async () => {
    const v = await getFloorDisplay(display);
    expect(v.waiting.curing).toBeGreaterThanOrEqual(0);
    expect(v.waiting.qualityCheck).toBeGreaterThanOrEqual(0);
    expect(v.waiting.missingMaterials).toBeGreaterThanOrEqual(0);
    expect(v.today).not.toBeNull();
    expect(Number(v.today!.made)).toBeGreaterThanOrEqual(40);
    expect(Number(v.today!.rejects)).toBeGreaterThanOrEqual(2);
  });

  it("an approved order whose release recorded shortages counts as missing materials", async () => {
    const before = (await getFloorDisplay(display)).waiting.missingMaterials;
    await db
      .update(workOrders)
      .set({ releaseShortages: [{ materialCode: "MAT-0012", short: "1000" }] })
      .where(eq(workOrders.id, waitingOrder));
    const v = await getFloorDisplay(display);
    expect(v.waiting.missingMaterials).toBe(before + 1);
    expect(v.nextUp.rows.find((r) => r.workOrderId === waitingOrder)!.missingMaterials).toBe(true);
  });

  it("shows no prices and no customer names", async () => {
    const [so] = await db.select({ customerId: salesOrders.customerId }).from(salesOrders).limit(1);
    const json = JSON.stringify(await getFloorDisplay(w.owner, { siteId: w.nfd.id }));
    expect(json).not.toMatch(/price|unitCost|amount|customer/i);
    expect(so).toBeTruthy();
  });

  it("refuses another site: a user of RVS only gets not_found for NFD and sees nothing of NFD on RVS", async () => {
    const rvsDisplay = await ctxFor(w.orgId, "floor.nfd@bryels-care.test", "floor_display", [w.rvs]);
    await expectCode(getFloorDisplay(rvsDisplay, { siteId: w.nfd.id }), "not_found");
    const own = await getFloorDisplay(rvsDisplay);
    expect(own.site.code).toBe("RVS");
    expect(own.makingNow.cards.some((c) => c.batchId === startedBatch)).toBe(false);
    expect(own.nextUp.rows.some((r) => r.workOrderId === waitingOrder || r.workOrderId === startedOrder)).toBe(false);
  });

  it("refuses a role without production.batch.view", async () => {
    expect(ROLE_BUNDLES.sales_cs.permissions).not.toContain("production.batch.view");
    await expectCode(getFloorDisplay(w.sales), "forbidden");
  });

  it("the demo seed has the Floor display role and the display account at NFD only", async () => {
    const [r] = await db.select().from(roles).where(eq(roles.code, "floor_display"));
    expect(r.allowsOrganizationWide).toBe(false);
    expect([...ROLE_BUNDLES.floor_display.permissions].sort()).toEqual(["production.batch.view", "production.daily_log.view", "production.work_order.view"]);
    const [u] = await db.select().from(users).where(eq(users.email, "floor.nfd@bryels-care.test"));
    expect(u.displayName).toBe("Floor TV NFD");
    const a = await db.select().from(userSiteAssignments).where(and(eq(userSiteAssignments.userId, u.id), eq(userSiteAssignments.roleId, r.id)));
    expect(a.map((x) => x.siteId)).toEqual([w.nfd.id]);
  });
});

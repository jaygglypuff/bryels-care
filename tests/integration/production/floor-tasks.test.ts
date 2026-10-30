/**
 * Operator task list (UX review "Your tasks today"): one task per batch at the current site
 * that the user can act on now or soon, with or without a production order. A batch of an order
 * assigned to someone else is never listed; another site's batches never appear; the read needs
 * production.batch.view. Waiting tasks name who can do it by first name or role, never by e-mail.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { batches } from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import { approveProductionOrder, assignProductionOrder, createProductionOrder, floorTaskCounts, myFloorTasks, waitingWords } from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { ctxFor, day, expectCode, loadWorld, productId, type World } from "./w2a-fixtures";

let w: World;
let checker: AuthContext;
let mineBatch: string;
let theirsBatch: string;
let openBatch: string;

async function approvedOrderBatch(assignee: string | null) {
  const r = await createProductionOrder(w.planner, { productId: await productId("ACS-135"), plannedStart: day(0) });
  const a = await approveProductionOrder(w.manager, r.workOrderId);
  if (assignee) await assignProductionOrder(w.planner, r.workOrderId, { assigneeId: assignee });
  return a.batches[0].batchId;
}

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
  checker = await ctxFor(w.orgId, "checker.nfd@bryels-care.test", "production_operator", [w.nfd]);
  mineBatch = await approvedOrderBatch(w.operator.userId);
  theirsBatch = await approvedOrderBatch(checker.userId);
  openBatch = await approvedOrderBatch(null);
}, 180_000);

describe("myFloorTasks", () => {
  it("lists the seeded batch that has no production order (B-26-0004, being made) with one button to the batch page", async () => {
    const tasks = await myFloorTasks(w.operator);
    const t = tasks.find((x) => x.batchNumber === "B-26-0004");
    expect(t, "batch without an order is a task").toBeDefined();
    expect(t!.workOrderId).toBeNull();
    expect(t!.href).toBe(`/production/${t!.batchId}`);
    expect(t!.stepLabel).toMatch(/^Step \d+ of \d+ · /);
    expect(t!.percent).toBeGreaterThanOrEqual(0);
    expect(t!.percent).toBeLessThanOrEqual(100);
    expect(t!.title.length).toBeGreaterThan(0);
  });

  it("lists my order's batch first and the unassigned one, never one assigned to someone else", async () => {
    const tasks = await myFloorTasks(w.operator);
    const ids = tasks.map((t) => t.batchId);
    expect(ids[0]).toBe(mineBatch);
    expect(tasks[0].assignedToMe).toBe(true);
    expect(ids).toContain(openBatch);
    expect(ids).not.toContain(theirsBatch);
    // the colleague sees the one assigned to them, not mine
    const theirs = (await myFloorTasks(checker)).map((t) => t.batchId);
    expect(theirs).toContain(theirsBatch);
    expect(theirs).not.toContain(mineBatch);
  });

  it("a batch of an approved order: Get the materials; someone without the permission is told who, without e-mail addresses", async () => {
    const t = (await myFloorTasks(w.operator)).find((x) => x.batchId === openBatch)!;
    expect(t.title).toBe("Get the materials");
    expect(t.stepLabel).toBe("Not started");
    expect(t.canDo).toBe(true);
    expect(t.buttonLabel).toBe("Start");
    expect(t.href).toBe(`/production/orders/${t.workOrderId}/materials?batch=${openBatch}`);
    // a viewer who may not move stock waits, with names or roles only
    const viewer = new AuthContext(checker.userId, w.orgId, "Viewer", "viewer@bryels-care.test", [], new Set(["production.batch.view"]), [w.nfd], w.nfd.id);
    const v = (await myFloorTasks(viewer)).find((x) => x.batchId === openBatch)!;
    expect(v.canDo).toBe(false);
    expect(v.waitingFor).toBeTruthy();
    expect(v.waitingFor).not.toMatch(/@/);
  });

  it("counts: for you, weighing, waiting", async () => {
    const tasks = await myFloorTasks(w.operator);
    const c = floorTaskCounts(tasks);
    expect(c.forYou + c.waiting).toBe(tasks.length);
    expect(c.weighing).toBeLessThanOrEqual(tasks.length);
  });

  it("cross-site: an operator of another site never sees these batches", async () => {
    const rvsOp = await ctxFor(w.orgId, "operator.nfd@bryels-care.test", "production_operator", [w.rvs]);
    const ids = (await myFloorTasks(rvsOp)).map((t) => t.batchId);
    expect(ids).not.toContain(openBatch);
    expect(ids).not.toContain(mineBatch);
    const b4 = (await db.select({ id: batches.id }).from(batches).where(eq(batches.batchNumber, "B-26-0004")))[0].id;
    expect(ids).not.toContain(b4);
  });

  it("role escalation: without production.batch.view the read is forbidden", async () => {
    await expectCode(myFloorTasks(w.sales), "forbidden");
    const site: SiteRef = w.nfd;
    const nobody = new AuthContext(w.operator.userId, w.orgId, "No access", "x@bryels-care.test", [], new Set(["production.work_order.view"]), [site], site.id);
    await expectCode(myFloorTasks(nobody), "forbidden");
  });

  it("waiting words use first names or roles, never e-mail addresses", () => {
    expect(waitingWords({ roles: ["QA/QC"], people: [{ name: "Nina Quiambao" }] })).toBe("Nina");
    expect(waitingWords({ roles: ["QA/QC"], people: [{ name: "Nina Quiambao" }, { name: "Dino Reyes" }] })).toBe("Nina or Dino");
    expect(waitingWords({ roles: ["Warehouse Operator", "Site Manager"], people: [] })).toBe("Warehouse Operator or Site Manager");
  });
});

/**
 * ADR-082 (slice R3): a production order can be assigned to one person who makes it. "My work" lists
 * the operator's own orders first, then the open ones nobody took; an order assigned to someone else
 * is not in their list. Negatives: assigning needs production.work_order.edit at the order's site
 * (role escalation, cross-site); the assignee must be able to record production at that site; a
 * cancelled order cannot be reassigned. Every change is audited with before and after.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db/client";
import { auditEvents, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { assignProductionOrder, assigneeChoices, createProductionOrder, getProductionOrder, listProductionOrders } from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { ctxFor, day, expectCode, loadWorld, productId, type World } from "./w2a-fixtures";

let w: World;
let checker: AuthContext;
let mine: string;
let theirs: string;
let open: string;
const key = () => `asg-${uuidv7()}`;
const userId = async (email: string) => (await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0].id;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
  checker = await ctxFor(w.orgId, "checker.nfd@bryels-care.test", "production_operator", [w.nfd]);
  const make = async () => (await createProductionOrder(w.planner, { productId: await productId("ACS-135"), plannedStart: day(0), idempotencyKey: key() })).workOrderId;
  [mine, theirs, open] = [await make(), await make(), await make()];
}, 180_000);

describe("assigning a production order", () => {
  it("offers only people who can record production at the order's site", async () => {
    const choices = await assigneeChoices(w.planner, mine);
    const names = choices.map((c) => c.id);
    expect(names).toContain(w.operator.userId);
    expect(names).toContain(checker.userId);
    expect(names).not.toContain(w.warehouse.userId); // cannot record production
    expect(names).not.toContain(await userId("sales@bryels-care.test"));
  });

  it("planner assigns; the order shows who; the change is audited", async () => {
    await assignProductionOrder(w.planner, mine, { assigneeId: w.operator.userId });
    await assignProductionOrder(w.planner, theirs, { assigneeId: checker.userId });
    const view = await getProductionOrder(w.planner, mine);
    expect(view.assignee).toMatchObject({ id: w.operator.userId, name: "Rhea Mendoza" });
    const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, mine), eq(auditEvents.action, "production.production_order.assigned")));
    expect(ev).toHaveLength(1);
    expect(ev[0].after).toMatchObject({ assigneeId: w.operator.userId });
  });

  it("'My work' lists my orders first, then unassigned ones, never someone else's", async () => {
    const rows = await listProductionOrders(w.operator, { mine: true });
    const ids = rows.map((r) => r.id);
    expect(ids[0]).toBe(mine);
    expect(ids).toContain(open);
    expect(ids).not.toContain(theirs);
    expect(rows.find((r) => r.id === mine)!.assignedToMe).toBe(true);
    // the full list still shows everything with the assignee's name
    const all = await listProductionOrders(w.planner, {});
    expect(all.find((r) => r.id === theirs)!.assigneeName).toBe("Jun Dela Cruz");
  });

  it("unassigning puts the order back for anyone", async () => {
    await assignProductionOrder(w.planner, theirs, { assigneeId: null });
    expect((await listProductionOrders(w.operator, { mine: true })).map((r) => r.id)).toContain(theirs);
  });

  it("role escalation: an operator cannot assign", async () => {
    await expectCode(assignProductionOrder(w.operator, open, { assigneeId: w.operator.userId }), "forbidden");
  });

  it("cross-site: a planner of another site cannot see or assign the order", async () => {
    await expectCode(assignProductionOrder(w.plannerRvs, open, { assigneeId: w.operator.userId }), "not_found");
    await expectCode(assigneeChoices(w.plannerRvs, open), "not_found");
  });

  it("refuses an assignee who cannot record production there", async () => {
    await expectCode(assignProductionOrder(w.planner, open, { assigneeId: w.warehouse.userId }), "validation");
    await expectCode(assignProductionOrder(w.planner, open, { assigneeId: uuidv7() }), "validation");
  });
});

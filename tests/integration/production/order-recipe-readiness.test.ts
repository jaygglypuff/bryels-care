/**
 * ADR-116 (owner bug report 2026-11-06): "when I successfully saved a recipe and used it for a production order, and
 * then approved it for batch, I get a routing error for that product."
 *
 * Cause: a recipe made in the wizard is two versions (ingredients = formula, steps = routing), approved one by one. The
 * New order screen offered every product with an approved formula, and approving the order then failed on the steps
 * with the raw "has no approved routing effective on … (V-REV)". Now:
 *   - the New order choices only offer products whose recipe AND steps are approved and in use; the others are listed
 *     with one plain sentence naming who approves next (nextActors);
 *   - creating and approving an order refuse with that same sentence, and nothing changes;
 *   - once QA and the manager approve both parts, the order approves end to end and the batch's Get materials list exists.
 * Negatives: another organization learns nothing; an operator cannot create or approve orders; another site's planner
 * cannot approve.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { batches, materials, users, workOrders } from "@/db/schema";
import { AuthContext } from "@/lib/auth/context";
import { createProduct, decideFormulaRevision, decideRoutingRevision, newStep, productReadiness, recipeReadiness, saveRecipe, type RecipeSaveInput } from "@/modules/masterdata";
import { approveProductionOrder, createProductionOrder, createWorkOrder, getMaterialsList, getProductionOrder, workOrderFormOptions } from "@/modules/production";
import { resetTestDatabase } from "../../support/db";
import { ctxFor, day, expectCode, loadWorld, setOrgSetting, type World } from "./w2a-fixtures";

let w: World;
let mats: { id: string }[];
let qaFirst: string;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadWorld();
  await setOrgSetting(w.orgId, "production.work_order.allow_release_with_shortage", true);
  mats = await db.select({ id: materials.id }).from(materials).where(and(eq(materials.status, "active"), eq(materials.materialKind, "raw_material"))).orderBy(asc(materials.code)).limit(2);
  const [q] = await db.select({ name: users.displayName }).from(users).where(eq(users.email, "qa.nfd@bryels-care.test"));
  qaFirst = q.name.split(" ")[0];
}, 180_000);

function recipe(productId: string, over: Partial<RecipeSaveInput> = {}): RecipeSaveInput {
  return {
    productId,
    formulaId: null,
    routingId: null,
    batchKg: "10",
    expectedPct: "100",
    view: "pct",
    lines: [
      { materialId: mats[0].id, amount: "60", src: "pct", diffKind: "pct", diff: "2", needsCheck: false, phaseCode: null, scaling: "proportional", isCritical: true },
      { materialId: mats[1].id, amount: "40", src: "pct", diffKind: "pct", diff: "2", needsCheck: false, phaseCode: null, scaling: "proportional", isCritical: true },
    ],
    steps: [newStep("weigh"), newStep("mix"), newStep("pour")],
    changeSummary: "",
    useFrom: "",
    formulaNotes: "",
    routingNotes: "",
    submit: true,
    activateProduct: true,
    ...over,
  };
}

/** A product with a recipe sent from the wizard, the ingredients approved by QA and the manager, the steps still waiting. */
async function halfApproved(name: string) {
  const p = await createProduct(w.planner, { code: null, name, family: "Soap", unitNetMassG: "100", unitsPerBox: 10, shelfLifeDays: 365 });
  const r = await saveRecipe(w.planner, recipe(p.id));
  await decideFormulaRevision(w.qa, { id: r.formula.revisionId, decision: "approved" });
  await decideFormulaRevision(w.manager, { id: r.formula.revisionId, decision: "approved" });
  return { productId: p.id, routingRevisionId: r.routing!.revisionId };
}

describe("a product whose steps are still waiting for approval (the owner's routing error)", () => {
  let pid: string;
  let routingRevisionId: string;
  let orderId: string;

  beforeAll(async () => {
    ({ productId: pid, routingRevisionId } = await halfApproved("Readiness Soap"));
  });

  it("is not offered on New order; the reason names who approves the steps", async () => {
    const opts = await workOrderFormOptions(w.planner);
    const f = opts.formulas.find((x) => x.productId === pid)!;
    expect(f.effectiveRevision).toBeTruthy(); // the formula alone is approved, which is what the screen used to check
    expect(f.notReady).toMatch(/^This product's steps are waiting for approval by /);
    expect(f.notReady).toContain(`${qaFirst} (QA)`);
    expect(f.notReady).toMatch(/— it can be made after that\.$/);
  });

  it("creating an order is refused with the same sentence, nothing written", async () => {
    const before = (await db.select().from(workOrders)).length;
    const e = await expectCode(createProductionOrder(w.planner, { productId: pid, plannedStart: day(0) }), "validation");
    expect(e.message).toBe((await productReadiness(w.planner, pid, day(0))).sentence);
    expect(e.details?.fieldErrors).toHaveProperty("productId");
    expect((await db.select().from(workOrders)).length).toBe(before);
  });

  it("approving an order made before (old work order path) refuses with the plain sentence, not the raw routing error; nothing changes", async () => {
    const wo = await createWorkOrder(w.planner, { productId: pid, batchCount: 1, plannedStart: day(0), plannedEnd: day(0) });
    orderId = wo.workOrderId;
    const view = await getProductionOrder(w.manager, orderId);
    expect(view.notReady).toMatch(/^This product's steps are waiting for approval by .*\(QA\)/);
    const e = await expectCode(approveProductionOrder(w.manager, orderId, { idempotencyKey: randomUUID() }), "validation");
    expect(e.message).not.toMatch(/routing|V-REV/);
    expect(e.message).toBe(view.notReady);
    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, orderId));
    expect(row.status).toBe("draft");
    expect(await db.select().from(batches).where(eq(batches.workOrderId, orderId))).toHaveLength(0);
  });

  it("after QA and the manager approve the steps: offered, and Approve plans the batch end to end (Get materials exists)", async () => {
    await decideRoutingRevision(w.qa, { id: routingRevisionId, decision: "approved" });
    // QA approved step 1: the sentence now names the second step's people, never QA again
    expect((await productReadiness(w.planner, pid, day(0))).sentence).toMatch(/^This product's steps are waiting for approval by /);
    await decideRoutingRevision(w.manager, { id: routingRevisionId, decision: "approved" });
    expect((await productReadiness(w.planner, pid, day(0))).ready).toBe(true);
    expect((await workOrderFormOptions(w.planner)).formulas.find((x) => x.productId === pid)!.notReady).toBeNull();
    expect((await getProductionOrder(w.manager, orderId)).notReady).toBeNull();
    const r = await approveProductionOrder(w.manager, orderId, { idempotencyKey: randomUUID() });
    expect(r.batches).toHaveLength(1);
    const list = await getMaterialsList(w.operator, r.batches[0].batchId);
    expect(list.lines.map((l) => l.materialId).sort()).toEqual(mats.map((m) => m.id).sort());
    // and a new order for it is accepted
    const again = await createProductionOrder(w.planner, { productId: pid, plannedStart: day(0) });
    expect(again.workOrderNumber).toBeTruthy();
  });
});

describe("other reasons, in plain words", () => {
  it("both parts waiting for the same people read as one sentence; an approved part used only from a later day says so", async () => {
    const p = await createProduct(w.planner, { code: null, name: "Readiness Soap Two", family: "Soap", unitNetMassG: "100", unitsPerBox: 10, shelfLifeDays: 365 });
    const r = await saveRecipe(w.planner, recipe(p.id));
    const both = await productReadiness(w.planner, p.id, day(0));
    expect(both.sentence).toMatch(/^This product's recipe and steps are waiting for approval by .*\(QA\).* — it can be made after that\.$/);
    // approved with a later "use from" day
    for (const c of [w.qa, w.manager]) {
      await decideFormulaRevision(c, { id: r.formula.revisionId, decision: "approved", effectiveFrom: day(3) });
      await decideRoutingRevision(c, { id: r.routing!.revisionId, decision: "approved", effectiveFrom: day(3) });
    }
    const later = await productReadiness(w.planner, p.id, day(0));
    expect(later.ready).toBe(false);
    expect(later.sentence).toMatch(/can be used only from .* — it can be made from that day\.$/);
    expect((await productReadiness(w.planner, p.id, day(3))).ready).toBe(true);
    await expectCode(createProductionOrder(w.planner, { productId: p.id, plannedStart: day(0) }), "validation");
    expect((await createProductionOrder(w.planner, { productId: p.id, plannedStart: day(3) })).workOrderNumber).toBeTruthy();
  });

  it("a draft names the person who must send it; no recipe at all says so", async () => {
    const p = await createProduct(w.planner, { code: null, name: "Readiness Soap Draft", family: "Soap", unitNetMassG: "100", unitsPerBox: 10, shelfLifeDays: 365 });
    expect((await productReadiness(w.planner, p.id, day(0))).sentence).toBe("This product has no approved recipe and steps yet: make its recipe and send it for approval — it can be made after that.");
    await saveRecipe(w.planner, recipe(p.id, { submit: false, activateProduct: false }));
    expect((await productReadiness(w.planner, p.id, day(0))).sentence).toMatch(/^This product's recipe and steps are still a draft: you must finish them/);
    const first = w.planner.displayName.split(" ")[0];
    expect((await productReadiness(w.manager, p.id, day(0))).sentence).toContain(`still a draft: ${first} must finish them`);
  });
});

describe("negatives", () => {
  it("another organization learns nothing about this organization's products", async () => {
    const { productId: pid } = await halfApproved("Readiness Soap Tenant");
    const other = new AuthContext(randomUUID(), randomUUID(), "Other", "other@example.test", ["site_manager"], w.manager.permissions, [{ ...w.nfd, id: randomUUID() }], randomUUID());
    const r = (await recipeReadiness(other, [pid], day(0))).get(pid)!;
    expect(r.ready).toBe(false);
    expect(r.sentence).not.toContain(qaFirst);
    expect(r.recipe.kind).toBe("none");
    expect(r.steps.kind).toBe("none");
  });

  it("an operator cannot create or approve; another site's people cannot approve this site's order", async () => {
    const { productId: pid } = await halfApproved("Readiness Soap Roles");
    await expectCode(createProductionOrder(w.operator, { productId: pid, plannedStart: day(0) }), "forbidden");
    const wo = await createWorkOrder(w.planner, { productId: pid, batchCount: 1, plannedStart: day(0), plannedEnd: day(0) });
    await expectCode(approveProductionOrder(w.operator, wo.workOrderId), "forbidden");
    const managerRvs = await ctxFor(w.orgId, "manager.nfd@bryels-care.test", "site_manager", [w.rvs]);
    const e = await approveProductionOrder(managerRvs, wo.workOrderId).then(
      () => null,
      (x: { code?: string }) => x,
    );
    expect(["forbidden", "not_found"]).toContain(e?.code);
  });
});

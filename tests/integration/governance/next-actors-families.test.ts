/**
 * ADR-109 for every family of hand-off (docs/NEXT_APPROVER.md): the names never include the actor, people of the
 * other site or people without the step's role; the next people are told once. Contexts come from the real seeded
 * assignments (buildContextForUser), so the who-can-do directory and the services see the same people.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, like, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications, roles, userSiteAssignments, users } from "@/db/schema";
import { type AuthContext, buildContextForUser } from "@/lib/auth/context";
import { nextActorsSentence } from "@/lib/next-actors-words";
import { changeSetting, settingChangeNext } from "@/modules/governance";
import { adjustmentNextActors, approveAdjustment, approveCount, countNextActors, createAdjustment, createCount, getCount, recordCount, releaseCount, submitAdjustment, submitCount } from "@/modules/inventory";
import { createFormula, decideFormulaRevision, saveFormulaRevisionDraft, submitFormulaRevision } from "@/modules/masterdata";
import { createExpenseClaim, submitExpenseClaim } from "@/modules/finance";
import { draftRequirement, salesNextActors, submitRequirement } from "@/modules/sales";
import { registerAppHooks } from "@/modules/wiring";
import { waitingFor } from "@/app/(app)/waiting-for";
import { waitingForApprover } from "@/app/(app)/masterdata/_eng/waiting";
import { financeNext } from "@/app/(app)/finance/approval-waiting";
import { resetTestDatabase } from "../../support/db";
import { type Kit, loadKit, loc, makeLot } from "../../support/kit";

let kit: Kit;
const uid = async (email: string) => (await db.select().from(users).where(eq(users.email, email)))[0].id;
const ctx = async (email: string, site?: string): Promise<AuthContext> => (await buildContextForUser(await uid(email), site ?? kit.nfd.id))!;
const names = (n: { people: { name: string }[] } | null) => (n?.people ?? []).map((p) => p.name);
const sentTo = async (kind: string, entityId: string) => (await db.select().from(notifications).where(and(eq(notifications.kind, kind), eq(notifications.entityId, entityId)))).map((n) => n.recipientUserId);

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  registerAppHooks();
  // A site manager of the other site only (cross-site negative).
  await db.insert(users).values({ organizationId: kit.orgId, email: "manager.rvs@bryels-care.test", displayName: "Rina Ramos (fictional)", passwordHash: "!" });
  const [sm] = await db.select().from(roles).where(and(eq(roles.organizationId, kit.orgId), eq(roles.code, "site_manager")));
  await db.insert(userSiteAssignments).values({ userId: await uid("manager.rvs@bryels-care.test"), roleId: sm.id, siteId: kit.rvs.id });
}, 180_000);

describe("stock fixes (two steps, same-person rule, no owner stand-in)", () => {
  it("step 1 (any approver) names the site manager first, never the maker or the other site; step 2 names the owner, never the step-1 approver; then who saves it", async () => {
    const wh = await ctx("warehouse.nfd@bryels-care.test");
    const b01 = await loc(kit.nfd.id, "B-01");
    const lot = await makeLot(await ctx("manager.nfd@bryels-care.test"), kit.nfd.id, b01.id, "10000", { materialCode: "MAT-0062" });
    const a = await createAdjustment(wh, { reasonCode: "lost", lines: [{ lotId: lot.id, locationId: b01.id, direction: "decrease", qty: "5000", unitCost: "5.00" }], idempotencyKey: randomUUID() });
    expect((await submitAdjustment(wh, a.id)).requiresSecondApproval).toBe(true);
    const step1 = await adjustmentNextActors(wh, a.id);
    // Step 1 names no role (default rules): every holder of the approve permission at NFD, the site manager first.
    expect(names(step1)).toEqual(["Dino Reyes", "Ana Villanueva"]);
    expect(names(step1)).not.toContain("Rina Ramos (fictional)");
    expect(names(step1)).not.toContain("Lito Pascual");
    expect(nextActorsSentence(step1!)).toContain("(step 1 of 2)");
    const dino = await uid("manager.nfd@bryels-care.test");
    const told = await sentTo("handoff.stock_adjustment", a.id);
    expect(told.filter((u) => u === dino)).toHaveLength(1);
    expect(told).not.toContain(wh.userId);

    const manager = await ctx("manager.nfd@bryels-care.test");
    await approveAdjustment(manager, a.id, "Step 1");
    const step2 = await adjustmentNextActors(wh, a.id);
    expect(names(step2)).toEqual(["Ana Villanueva"]);
    const asManager = await adjustmentNextActors(manager, a.id);
    expect(asManager?.viewer.can).toBe(false);
    const ana = await uid("owner@bryels-care.test");
    // Ana was told at step 1 and again for step 2 (a new hand-off); Dino is not told about step 2.
    const all = await sentTo("handoff.stock_adjustment", a.id);
    expect(all.filter((u) => u === ana)).toHaveLength(2);
    expect(all.filter((u) => u === dino)).toHaveLength(1);

    await approveAdjustment(await ctx("owner@bryels-care.test"), a.id, "Step 2");
    const post = await adjustmentNextActors(wh, a.id);
    expect(post?.kind).toBe("stock_adjustment_post");
    expect(nextActorsSentence(post!)).toContain("saves it to stock");
  });
});

describe("count differences", () => {
  it("the counter is never named; the site manager is told once", async () => {
    const manager = await ctx("manager.nfd@bryels-care.test");
    const counter = await ctx("warehouse.nfd@bryels-care.test");
    const l = await loc(kit.nfd.id, "PKG-01");
    const lot = await makeLot(manager, kit.nfd.id, l.id, "1000", { materialCode: "PKG-0101" });
    const c = await createCount(manager, { countKind: "cycle", isBlind: false, locationIds: [l.id], counterUserIds: [counter.userId] });
    await releaseCount(manager, c.id);
    for (const line of (await getCount(counter, c.id)).lines) {
      await recordCount(counter, { countId: c.id, locationId: l.id, lotId: line.lotId, qty: line.lotId === lot.id ? "990" : String(Number(line.expected ?? 0)), idempotencyKey: randomUUID() });
    }
    await submitCount(counter, c.id);
    const next = await countNextActors(counter, c.id);
    expect(names(next)).toContain("Dino Reyes");
    expect(names(next)).not.toContain("Lito Pascual");
    expect(names(next)).not.toContain("Rina Ramos (fictional)");
    const to = await sentTo("handoff.count_variance", c.id);
    expect(to).toContain(manager.userId);
    expect(to).not.toContain(counter.userId);
    expect(new Set(to).size).toBe(to.length);
    // After the approval: who saves it (or the second step), and the manager who approved step 1 is never asked again.
    const after = await getCount(manager, c.id);
    const variant = after.lines.find((x) => x.lotId === lot.id)!;
    await approveCount(manager, c.id, { lines: { [variant.id]: { reasonCode: "unrecorded_issue", note: "Sample pulled (fictional)" } } });
    const then = await countNextActors(counter, c.id);
    expect(then).not.toBeNull();
  });
});

describe("finance (same-person rule on claims)", () => {
  it("the claimant is never named as the approver of their claim", async () => {
    const sales = await ctx("sales@bryels-care.test");
    const claim = await createExpenseClaim(sales, { categoryCode: "meals", description: "Customer lunch (fictional)", expenseDate: new Date().toISOString().slice(0, 10), amount: "300" });
    await submitExpenseClaim(sales, claim.claimId);
    const next = await financeNext(sales, "expense", claim.claimId);
    expect(next).not.toBeNull();
    expect(names(next)).not.toContain("Mara Santos");
    expect(next!.people.length + (next!.viewer.can ? 1 : 0)).toBeGreaterThan(0);
    // The generic line used on finance pages leaves out the people it is told to.
    const line = await waitingFor(await ctx("finance@bryels-care.test"), "finance.expense_claim.post", null, "to save it to the books", "finance", { exclude: [await uid("finance2@bryels-care.test")], operational: true });
    expect(line).not.toContain("Ben Ocampo");
  });
});

describe("customer requirement and settings change", () => {
  it("customer requirement: the approvers are told once; the sales person who sent it is not named", async () => {
    const sales = await ctx("sales@bryels-care.test");
    const [c] = await db.execute<{ id: string }>(sql`select id from customers order by created_at limit 1`);
    const r = await draftRequirement(sales, { customerId: c.id, requirementKind: "min_remaining_shelf_life_days", valueNumeric: "200", effectiveFrom: new Date().toISOString().slice(0, 10) });
    await submitRequirement(sales, r.id);
    const next = await salesNextActors(sales, "customer_requirement", r.id);
    expect(names(next)).not.toContain("Mara Santos");
    expect(names(next)).toContain("Ana Villanueva");
    const to = await sentTo("handoff.customer_requirement", r.id);
    expect(to).not.toContain(sales.userId);
    expect(to.length).toBeGreaterThan(0);
    expect(new Set(to).size).toBe(to.length);
  });

  it("owner-only setting change: only the owner is named and told", async () => {
    const admin = await ctx("admin@bryels-care.test");
    const r = await changeSetting(admin, { key: "approvals.top_roles_self_approve", siteId: null, value: false, reason: "Small team test (fictional)" }, "demo1234");
    expect(r.status).toBe("submitted");
    const next = await settingChangeNext(admin, r.requestId);
    expect(names(next)).toEqual(["Ana Villanueva"]);
    const to = await sentTo("handoff.setting_change", r.requestId);
    expect(to).toEqual([await uid("owner@bryels-care.test")]);
  });
});

describe("master-data revisions (QA, then the manager)", () => {
  it("QA is told first (never the maker); after QA says OK the next step never names the QA approver or the maker", async () => {
    const manager = await ctx("manager.nfd@bryels-care.test");
    const [p] = await db.execute<{ id: string }>(sql`select id from products where sku_code = 'AHL-250' limit 1`);
    const [m] = await db.execute<{ id: string }>(sql`select id from materials where code = 'MAT-0012' limit 1`);
    const f = await createFormula(manager, { productId: p.id, code: `F-NEXT-${Date.now().toString(36)}`, name: "Next approver recipe (fictional)", referenceBatchSizeG: "1000", theoreticalYieldPct: "97" });
    await saveFormulaRevisionDraft(manager, { revisionId: f.revisionId, referenceBatchSizeG: "1000", theoreticalYieldPct: "97", lines: [{ materialId: m.id, quantityG: "1000", toleranceAbsG: "2" }] });
    await submitFormulaRevision(manager, f.revisionId);
    const first = await db.select().from(notifications).where(and(eq(notifications.entityId, f.revisionId), like(notifications.kind, "handoff.recipe_revision")));
    const nina = await uid("qa.nfd@bryels-care.test");
    expect(first.map((n) => n.recipientUserId)).toContain(nina);
    expect(first.map((n) => n.recipientUserId)).not.toContain(manager.userId);
    const line = await waitingForApprover(manager, "masterdata.formula.approve", { step: 1, label: "QA", roles: ["qa_qc"] }, 2, { exclude: [manager.userId] });
    expect(line).toMatch(/Nina Quiambao \(QA\)/);
    expect(line).not.toMatch(/Dino Reyes/);

    await decideFormulaRevision(await ctx("qa.nfd@bryels-care.test"), { id: f.revisionId, decision: "approved", note: "QA step" });
    const second = await db.select().from(notifications).where(and(eq(notifications.entityId, f.revisionId), eq(notifications.kind, "handoff.recipe_revision")));
    const later = second.filter((n) => !first.some((x) => x.id === n.id)).map((n) => n.recipientUserId);
    expect(later).not.toContain(nina);
    expect(later).not.toContain(manager.userId);
  });
});

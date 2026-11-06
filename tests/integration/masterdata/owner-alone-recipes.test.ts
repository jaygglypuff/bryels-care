/**
 * ADR-117 (owner decision 2026-11-07): "If you are the owner, why would you let someone approve it? Example recipe,
 * production order." The owner chose "Owner approves alone (setting)": with `approvals.owner_approves_recipes_alone`
 * on (default on, owner-only), the Owner/Director (organization-wide) approves every step of a recipe (formula), its
 * steps (routing) and how-to sheets (work instructions) alone, their own included, in one press. Each step is recorded
 * as the owner's with `ownerAlone`, audited (`governance.owner_alone.used`) and shown as "Approved by Ana Villanueva
 * (owner) — no separate QA review". Inspection plans, QA holds and every other QA decision stay independent; site
 * managers, QA users and another organization's owner get no such power; with the setting off nothing changes.
 * Contexts are built from the real assignments (buildContextForUser), as in production.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { approvalDecisions, auditEvents, formulaRevisions, inspectionPlans, materials, roles, routingRevisions, settings, userSiteAssignments, users } from "@/db/schema";
import { AuthContext, buildContextForUser } from "@/lib/auth/context";
import { getSetting, settingDefinition } from "@/lib/settings";
import { listMyApprovals, refreshActionItems } from "@/modules/action-centre";
import { approveSettingChange, changeSetting, nextActors } from "@/modules/governance";
import { placeHold, liftHold } from "@/modules/inventory";
import {
  approveRecipeAlone,
  createInspectionPlan,
  createProduct,
  createWorkInstruction,
  decideFormulaRevision,
  decideInspectionPlan,
  decideRoutingRevision,
  decideWorkInstructionRevision,
  getFormulaRevision,
  getInspectionPlanDetail,
  getRecipe,
  getRoutingRevision,
  getWorkInstruction,
  newStep,
  productReadiness,
  saveInspectionPlanDraft,
  saveRecipe,
  saveWorkInstructionDraft,
  submitInspectionPlan,
  submitWorkInstructionRevision,
  type RecipeSaveInput,
} from "@/modules/masterdata";
import { approveProductionOrder, buildBmrDataset, createProductionOrder, getMaterialsList } from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { expectCode, type Kit, loadKit, loc, makeLot } from "../../support/kit";

const KEY = "approvals.owner_approves_recipes_alone";
const NOTE = "You can approve this alone because you are the owner (no separate QA review).";
let kit: Kit;
let mats: { id: string }[];

async function userId(email: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return u.id;
}
async function grant(email: string, roleCode: string, siteId: string | null) {
  const [r] = await db.select().from(roles).where(and(eq(roles.organizationId, kit.orgId), eq(roles.code, roleCode)));
  await db.insert(userSiteAssignments).values(siteId ? { userId: await userId(email), roleId: r.id, siteId } : { userId: await userId(email), roleId: r.id, isOrganizationWide: true });
}
async function newUser(email: string, name: string) {
  await db.insert(users).values({ organizationId: kit.orgId, email, displayName: name, passwordHash: "!" });
}
const ctx = async (email: string) => (await buildContextForUser(await userId(email), kit.nfd.id))!;
const owner = () => ctx("owner@bryels-care.test");
const qa = () => ctx("qa.nfd@bryels-care.test");
const qa2 = () => ctx("qa2.nfd@bryels-care.test");
const manager = () => ctx("manager.nfd@bryels-care.test");
async function settingOff() {
  await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, KEY), isNull(settings.siteId)));
  await db.insert(settings).values({ organizationId: kit.orgId, scope: "organization", key: KEY, value: false });
}
async function settingDefault() {
  await db.delete(settings).where(and(eq(settings.organizationId, kit.orgId), eq(settings.key, KEY)));
}
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

function recipe(productId: string): RecipeSaveInput {
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
  };
}

/** A new product with a recipe and steps written and sent by `author` (both waiting for approval). */
async function sentRecipe(author: AuthContext, name: string) {
  const p = await createProduct(author, { code: null, name, family: "Soap", unitNetMassG: "100", unitsPerBox: 10, shelfLifeDays: 365 });
  const r = await saveRecipe(author, recipe(p.id));
  return { productId: p.id, formulaId: r.formulaId, formulaRevisionId: r.formula.revisionId, routingRevisionId: r.routing!.revisionId };
}

beforeAll(async () => {
  await resetTestDatabase();
  kit = await loadKit();
  registerAppHooks();
  mats = await db.select({ id: materials.id }).from(materials).where(and(eq(materials.status, "active"), eq(materials.materialKind, "raw_material"))).orderBy(asc(materials.code)).limit(2);
  // A second QA person who also writes recipes (for the "setting off" path) and a QA who is not the author.
  await newUser("qa2.nfd@bryels-care.test", "Teresa Lim (fictional)");
  await grant("qa2.nfd@bryels-care.test", "qa_qc", kit.nfd.id);
  await grant("qa2.nfd@bryels-care.test", "production_planner", kit.nfd.id);
  // The site manager also plans at NFD (writes recipes) — still no owner-alone power.
  await grant("manager.nfd@bryels-care.test", "production_planner", kit.nfd.id);
  // The owner writes recipes and makes production orders at NFD (a small company).
  await grant("owner@bryels-care.test", "production_planner", kit.nfd.id);
}, 240_000);

beforeEach(settingDefault);

describe("setting approvals.owner_approves_recipes_alone", () => {
  it("is on by default, restricted and owner-only; a change needs the owner's approval", async () => {
    const def = settingDefinition(KEY)!;
    expect(def).toMatchObject({ default: true, restricted: true, ownerOnly: true, requiresApproval: true, group: "Approvals" });
    expect(def.label).toBe("The owner may approve recipes and their steps alone (no separate QA review)");
    expect(def.description).toBe("GMP auditors usually expect a QA person who did not write the recipe to review it.");
    expect(await getSetting(db, kit.orgId, KEY)).toBe(true);
    expect((await owner()).ownerApprovesRecipesAlone).toBe(true);
    expect((await manager()).ownerApprovesRecipesAlone).toBe(false);
    expect((await qa()).ownerApprovesRecipesAlone).toBe(false);

    const admin = await ctx("admin@bryels-care.test");
    const r = await changeSetting(admin, { key: KEY, siteId: null, value: false, reason: "Auditor asked for QA review (test)" }, "demo1234");
    expect(r.status).toBe("submitted");
    expect(await getSetting(db, kit.orgId, KEY)).toBe(true);
    const admin2 = await ctx("admin2@bryels-care.test");
    const e = await expectCode(approveSettingChange(admin2, r.requestId, { password: "demo1234" }), "forbidden");
    expect(e.message).toContain("Only the owner");
    await expectCode(changeSetting(await manager(), { key: KEY, siteId: null, value: false, reason: "Manager tries (test)" }, "demo1234"), "forbidden");
    await approveSettingChange(await owner(), r.requestId, { password: "demo1234" });
    expect(await getSetting(db, kit.orgId, KEY)).toBe(false);
    expect((await owner()).ownerApprovesRecipesAlone).toBe(false);
  });
});

describe("the owner approves their own recipe and steps alone", () => {
  let x: Awaited<ReturnType<typeof sentRecipe>>;

  beforeAll(async () => {
    x = await sentRecipe(await owner(), "Owner Alone Soap");
  });

  it("the waiting recipe offers one Approve to the owner and names the owner for everyone else", async () => {
    const o = await owner();
    const r = (await getRecipe(o, x.formulaId))!;
    expect(r.mode).toBe("waiting");
    expect(r.ownerAlone).toMatchObject({ canApproveAlone: true, note: NOTE, waitingParts: ["recipe", "steps"] });
    const fv = (await getFormulaRevision(o, x.formulaRevisionId))!;
    expect(fv.approval).toMatchObject({ canDecide: true, ownerAlone: true, ownerAloneNote: NOTE });
    // QA sees the QA step and "— or Ana (owner) alone"; the owner reads "you alone (you are the owner)".
    const forQa = await productReadiness(await qa(), x.productId);
    expect(forQa.sentence).toMatch(/waiting for approval by you or .*\(QA\) — or Ana \(owner\) alone — it can be made after that\.$/);
    expect(forQa.sentence).toContain("— or Ana (owner) alone");
    const forManager0 = await productReadiness(await manager(), x.productId);
    expect(forManager0.sentence).toMatch(/^This product's recipe and steps are waiting for approval by Nina \(QA\).* — or Ana \(owner\) alone — it can be made after that\.$/);
    const forOwner = await productReadiness(o, x.productId);
    expect(forOwner.sentence).toContain("you alone (you are the owner)");
    const n = await nextActors(await qa(), "recipe_revision", { siteId: null, roleCodes: ["qa_qc"], excludeUserIds: [o.userId], stepNo: 1, stepsTotal: 2, roleStandIn: false });
    expect(n.ownerAlone?.map((p) => p.name)).toEqual(["Ana Villanueva"]);
    // "To approve" counts it for the owner (with the owner-alone words), for QA at the QA step, never for the site manager.
    await refreshActionItems(kit.orgId);
    const mine = (await listMyApprovals(o)).filter((a) => a.entityId === x.formulaRevisionId || a.entityId === x.routingRevisionId);
    expect(mine).toHaveLength(2);
    expect(mine.every((a) => a.canDecide && a.selfApprovalNote === NOTE)).toBe(true);
    const forQaRows = (await listMyApprovals(await qa())).filter((a) => a.entityId === x.formulaRevisionId);
    expect(forQaRows[0]?.canDecide).toBe(true);
    expect(forQaRows[0]?.selfApprovalNote).toBeNull();
    const forManager = (await listMyApprovals(await manager())).filter((a) => a.entityId === x.formulaRevisionId);
    expect(forManager.every((a) => !a.canDecide)).toBe(true);
  });

  it("one press approves both parts, every step flagged ownerAlone; audited; the product is ready", async () => {
    const o = await owner();
    const res = await approveRecipeAlone(o, { formulaId: x.formulaId });
    expect(res).toEqual({ recipe: "approved", steps: "approved", ownerAlone: true });
    const [f] = await db.select().from(formulaRevisions).where(eq(formulaRevisions.id, x.formulaRevisionId));
    const [rt] = await db.select().from(routingRevisions).where(eq(routingRevisions.id, x.routingRevisionId));
    expect([f.status, rt.status]).toEqual(["approved", "approved"]);
    expect(f.approvedBy).toBe(f.submittedBy); // the same-person trigger accepted it under bc.owner_alone
    const ds = await db.select().from(approvalDecisions).where(inArray(approvalDecisions.recordId, [x.formulaRevisionId, x.routingRevisionId])).orderBy(asc(approvalDecisions.recordType), asc(approvalDecisions.step));
    expect(ds).toHaveLength(4);
    expect(ds.every((d) => d.decidedBy === o.userId && d.ownerAlone && d.note === "Owner approved alone (no separate QA review)")).toBe(true);
    for (const id of [x.formulaRevisionId, x.routingRevisionId]) {
      const used = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, "governance.owner_alone.used")));
      expect(used).toHaveLength(1);
      expect((used[0].after as { steps: string[] }).steps).toHaveLength(2);
      expect((used[0].after as { steps: string[] }).steps[0]).toContain("(a QA step)");
      const [approved] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, id), sql`${auditEvents.action} like '%_revision.approved'`));
      expect(approved.after).toMatchObject({ ownerAlone: true, approvalNote: "Owner approved alone (no separate QA review)" });
      expect((approved.after as { ownerAloneSteps: string[] }).ownerAloneSteps).toHaveLength(2);
    }
    // The records say it, for every viewer.
    const label = "Ana Villanueva (owner) — no separate QA review";
    expect((await getFormulaRevision(await qa(), x.formulaRevisionId))!.revision.approvedByName).toBe(label);
    expect((await getRoutingRevision(await qa(), x.routingRevisionId))!.revision.approvedByName).toBe(label);
    expect((await getRecipe(await qa(), x.formulaId))!.ownerAlone.approvedText).toBe(`Approved by ${label}`);
    expect((await productReadiness(o, x.productId)).ready).toBe(true);
  });

  it("a production order for it is created and approved by the owner alone (ADR-091); Get materials exists; the BMR says who approved the recipe", async () => {
    const o = await owner();
    const nfdStock = await loc(kit.nfd.id, "B-01");
    for (const m of mats) {
      const [row] = await db.select({ code: materials.code }).from(materials).where(eq(materials.id, m.id));
      await makeLot(o, kit.nfd.id, nfdStock.id, "50000", { materialCode: row.code });
    }
    const wo = await createProductionOrder(o, { productId: x.productId, plannedStart: day(1) });
    const r = await approveProductionOrder(o, wo.workOrderId, { idempotencyKey: randomUUID() });
    expect(r.batches).toHaveLength(1);
    const list = await getMaterialsList(o, r.batches[0].batchId);
    expect(list.lines.length).toBeGreaterThan(0);
    const own = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, wo.workOrderId), eq(auditEvents.action, "governance.self_approval.used")));
    expect(own.length).toBeGreaterThanOrEqual(1);
    const bmr = await buildBmrDataset(db, o, r.batches[0].batchId);
    expect(bmr.data.batch.recipeApprovalText).toBe("Approved by Ana Villanueva (owner) — no separate QA review");
  });
});

describe("how-to sheets", () => {
  it("the owner approves their own how-to sheet alone (its one step names QA)", async () => {
    const o = await owner();
    const w = await createWorkInstruction(o, { name: "Owner alone mixing sheet (fictional)", bodyMarkdown: "Mix slowly." });
    const rev = { id: w.revisionId };
    await saveWorkInstructionDraft(o, { revisionId: rev.id, bodyMarkdown: "Mix slowly for 10 minutes.", changeSummary: null });
    await submitWorkInstructionRevision(o, rev.id);
    const pending = (await getWorkInstruction(o, w.workInstructionId))!.revisions[0];
    expect(pending).toMatchObject({ canDecide: true, ownerAlone: true, ownerAloneNote: NOTE });
    const d = await decideWorkInstructionRevision(o, { id: rev.id, decision: "approved" });
    expect(d).toMatchObject({ status: "approved", ownerAlone: true });
    expect((await getWorkInstruction(await qa(), w.workInstructionId))!.revisions[0].approvedByName).toBe("Ana Villanueva (owner) — no separate QA review");
  });
});

describe("with the setting off nothing changes", () => {
  it("the QA step needs a QA person who is not the author; the owner cannot decide it", async () => {
    await settingOff();
    const t = await qa2();
    const x = await sentRecipe(t, "Setting Off Soap");
    const o = await owner();
    expect(o.ownerApprovesRecipesAlone).toBe(false);
    expect((await getRecipe(o, x.formulaId))!.ownerAlone.canApproveAlone).toBe(false);
    await expectCode(approveRecipeAlone(o, { formulaId: x.formulaId }), "forbidden");
    await expectCode(decideFormulaRevision(o, { id: x.formulaRevisionId, decision: "approved" }), "forbidden"); // QA step, owner is not QA
    await expectCode(decideFormulaRevision(t, { id: x.formulaRevisionId, decision: "approved" }), "separation_of_duties"); // QA author
    expect((await productReadiness(await qa(), x.productId)).sentence).not.toContain("alone");
    await decideFormulaRevision(await qa(), { id: x.formulaRevisionId, decision: "approved" });
    const r = await decideFormulaRevision(o, { id: x.formulaRevisionId, decision: "approved" });
    expect(r).toMatchObject({ status: "approved", ownerAlone: false });
    const ds = await db.select().from(approvalDecisions).where(eq(approvalDecisions.recordId, x.formulaRevisionId));
    expect(ds.some((d) => d.ownerAlone)).toBe(false);
    await settingDefault();
  });
});

describe("no owner-alone power for anyone else, and never for QA decisions", () => {
  it("a site manager and a QA user decide only their own step, as before", async () => {
    const m = await manager();
    const x = await sentRecipe(m, "Manager Recipe Soap");
    await expectCode(decideFormulaRevision(m, { id: x.formulaRevisionId, decision: "approved" }), "forbidden"); // QA step
    const q = await qa();
    const r = await decideFormulaRevision(q, { id: x.formulaRevisionId, decision: "approved" });
    expect(r).toMatchObject({ status: "pending_approval", step: 1 });
    // The manager may not approve their own recipe at the manager step (organization-level record, ADR-091).
    await expectCode(decideFormulaRevision(m, { id: x.formulaRevisionId, decision: "approved" }), "separation_of_duties");
    const ds = await db.select().from(approvalDecisions).where(eq(approvalDecisions.recordId, x.formulaRevisionId));
    expect(ds.some((d) => d.ownerAlone)).toBe(false);
  });

  it("the owner approving someone else's recipe after QA decided step 1 is an ordinary decision (no flag)", async () => {
    const x = await sentRecipe(await manager(), "Ordinary Owner Step Soap");
    await decideFormulaRevision(await qa(), { id: x.formulaRevisionId, decision: "approved" });
    const o = await owner();
    expect((await getFormulaRevision(o, x.formulaRevisionId))!.approval).toMatchObject({ canDecide: true, ownerAlone: false, ownerAloneNote: null });
    const r = await decideFormulaRevision(o, { id: x.formulaRevisionId, decision: "approved" });
    expect(r).toMatchObject({ status: "approved", ownerAlone: false });
    expect((await getFormulaRevision(o, x.formulaRevisionId))!.revision.approvedByName).toBe("Ana Villanueva");
    expect(await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, x.formulaRevisionId), eq(auditEvents.action, "governance.owner_alone.used")))).toHaveLength(0);
  });

  it("inspection plans keep the independent QA person, even for the owner holding QA with the setting on", async () => {
    await grant("owner@bryels-care.test", "qa_qc", kit.nfd.id);
    const o = await owner();
    expect(o.ownerApprovesRecipesAlone).toBe(true);
    const [p] = await db.select().from(materials).limit(1);
    const { planId } = await createInspectionPlan(o, { planKind: "incoming", materialId: p.id });
    const v = (await getInspectionPlanDetail(o, planId))!;
    await saveInspectionPlanDraft(o, { planId, name: v.plan.name, tests: [{ name: "Appearance", valueKind: "pass_fail", specText: "Clean" }] });
    await submitInspectionPlan(o, planId);
    await expectCode(decideInspectionPlan(o, { id: planId, decision: "approved" }), "separation_of_duties");
    const [row] = await db.select().from(inspectionPlans).where(eq(inspectionPlans.id, planId));
    expect(row.status).toBe("pending_approval");
  });

  it("a quality hold the owner placed is not lifted by the owner (QA release stays independent)", async () => {
    const o = await owner();
    const b01 = await loc(kit.nfd.id, "B-01");
    const lot = await makeLot(o, kit.nfd.id, b01.id, "100", { materialCode: "MAT-0063" });
    const h = await placeHold(o, { scope: "lot", lotRef: lot.id, reasonCode: "other", reason: "Owner suspects a leak (fictional)", idempotencyKey: randomUUID() });
    await expectCode(liftHold(o, { holdId: h.holdId, resolution: "released", reason: "Owner lifts own hold" }), "separation_of_duties");
  });

  it("another organization's owner cannot approve this organization's recipe", async () => {
    const x = await sentRecipe(await manager(), "Tenant Soap");
    const o = await owner();
    const other = new AuthContext(randomUUID(), randomUUID(), "Other Owner", "owner@other.test", ["owner_director"], o.permissions, [{ ...kit.nfd, id: randomUUID() }], randomUUID(), { ownerAlone: { used: [] } });
    expect(other.ownerApprovesRecipesAlone).toBe(true);
    await expectCode(decideFormulaRevision(other, { id: x.formulaRevisionId, decision: "approved" }), "not_found");
    await expectCode(approveRecipeAlone(other, { formulaId: x.formulaId }), "not_found");
    const [f] = await db.select().from(formulaRevisions).where(eq(formulaRevisions.id, x.formulaRevisionId));
    expect(f.status).toBe("pending_approval");
  });
});

describe("the database guard", () => {
  it("bc.owner_alone opens recipe, steps and how-to sheet revisions only — never inspection plans", async () => {
    const ownerId = await userId("owner@bryels-care.test");
    const [f] = await db.select().from(formulaRevisions).where(eq(formulaRevisions.status, "approved")).limit(1);
    const accepted = await db
      .transaction(async (tx) => {
        await tx.execute(sql`select set_config('bc.owner_alone', 'on', true)`);
        await tx.execute(sql`alter table formula_revisions disable trigger tg_formula_revisions_immutable`);
        await tx.update(formulaRevisions).set({ submittedBy: ownerId, approvedBy: ownerId }).where(eq(formulaRevisions.id, f.id));
        await tx.execute(sql`set constraints all immediate`);
        tx.rollback();
      })
      .catch((e) => e);
    expect(String(accepted?.cause?.message ?? accepted?.message ?? "")).not.toContain("formula_rev_sod_ck");
    const [plan] = await db.select().from(inspectionPlans).limit(1);
    const refused = await db
      .transaction(async (tx) => {
        await tx.execute(sql`select set_config('bc.owner_alone', 'on', true)`);
        await tx.execute(sql`alter table inspection_plans disable trigger tg_inspection_plans_immutable`);
        await tx.update(inspectionPlans).set({ submittedBy: ownerId, approvedBy: ownerId }).where(eq(inspectionPlans.id, plan.id));
        await tx.execute(sql`set constraints all immediate`);
        tx.rollback();
      })
      .catch((e) => e);
    expect(String(refused?.cause?.message ?? refused?.message ?? "")).toContain("inspection_plans_sod_ck");
    const withoutFlag = await db
      .transaction(async (tx) => {
        await tx.execute(sql`alter table formula_revisions disable trigger tg_formula_revisions_immutable`);
        await tx.update(formulaRevisions).set({ submittedBy: ownerId, approvedBy: ownerId }).where(eq(formulaRevisions.id, f.id));
        await tx.execute(sql`set constraints all immediate`);
        tx.rollback();
      })
      .catch((e) => e);
    expect(String(withoutFlag?.cause?.message ?? withoutFlag?.message ?? "")).toContain("formula_rev_sod_ck");
  });

  it("the owner-alone flag on a decision is refused for any other record type", async () => {
    const [plan] = await db.select().from(inspectionPlans).limit(1);
    const e = await db
      .insert(approvalDecisions)
      .values({ organizationId: kit.orgId, recordType: "inspection_plan", recordId: plan.id, step: 9, decision: "approved", decidedBy: await userId("owner@bryels-care.test"), ownerAlone: true })
      .catch((x) => x);
    expect(String(e?.cause?.message ?? e?.message ?? "")).toContain("approval_decisions_owner_alone_ck");
  });

  it("the custom migration matches src/db/sql/adr117.sql", async () => {
    const { customMigration } = await import("../../support/custom-sql");
    const { migration, canonical } = customMigration("adr117");
    expect(migration.trim()).toBe(canonical.trim());
  });
});

/**
 * ADR-089: the guided "New recipe" wizard sits on top of the existing formula, routing, product and
 * material services. These tests prove that it writes exactly what the services write, keeps drafts
 * as drafts until the normal approval, copies recipes as new drafts, refuses people without the
 * permissions, and that a batch still needs the approved versions.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import {
  batchMaterials,
  batches,
  bomLines,
  formulaRevisions,
  formulas,
  materials,
  organizations,
  products,
  routingRevisions,
  routingStepChecklistItems,
  routingStepParameters,
  routingSteps,
  routings,
  skus,
} from "@/db/schema";
import { AuthContext, type SiteRef } from "@/lib/auth/context";
import {
  type RecipeSaveInput,
  type RecipeStepDraft,
  createFormula,
  createProduct,
  createRecipeIngredient,
  createRecipePackaging,
  createRecipeProduct,
  createRouting,
  decideFormulaRevision,
  decideRoutingRevision,
  getRecipe,
  getRecipeCopy,
  listFormulas,
  listRoutings,
  newStep,
  packagingKeep,
  recipeWizardOptions,
  saveFormulaRevisionDraft,
  saveRecipe,
  saveRoutingRevisionDraft,
} from "@/modules/masterdata";
import { type FormulaSnapshot, createBatch, getMaterialsList, getWeighView } from "@/modules/production";
import { allowDirectBatches } from "../../support/w2b";
import { expectCode, manilaDate, setupW1D } from "./helpers";

let nfd: SiteRef;
let planner: AuthContext;
let manager: AuthContext;
let qa: AuthContext;
let operator: AuthContext;
let mats: { id: string; name: string }[];
const today = manilaDate(0);

beforeAll(async () => {
  const s = await setupW1D();
  await allowDirectBatches({ orgId: (await db.select({ id: organizations.id }).from(organizations).limit(1))[0].id });
  nfd = s.nfd;
  planner = await s.ctxFor("planner.nfd@bryels-care.test", "production_planner", [nfd]);
  manager = await s.ctxFor("manager.nfd@bryels-care.test", "site_manager", [nfd]);
  qa = await s.ctxFor("qa.nfd@bryels-care.test", "qa_qc", [nfd, s.rvs]);
  operator = await s.ctxFor("operator.nfd@bryels-care.test", "production_operator", [nfd]);
  mats = await db
    .select({ id: materials.id, name: materials.name })
    .from(materials)
    .where(and(eq(materials.status, "active"), eq(materials.materialKind, "raw_material")))
    .orderBy(asc(materials.code))
    .limit(3);
  expect(mats).toHaveLength(3);
}, 180_000);

async function newProduct(name: string) {
  const p = await createProduct(planner, { code: null, name, family: "Soap", unitNetMassG: "135", unitsPerBox: 48, shelfLifeDays: 730 });
  return p.id;
}

function soapSteps(): RecipeStepDraft[] {
  const clean = { ...newStep("clean"), name: "Start check", checklist: [{ text: "Tables and pots are clean", requiresPhoto: false, isBlocking: true }] };
  const weigh = { ...newStep("weigh"), needsCheck: true };
  const heat = newStep("heat");
  heat.readings = [{ ...heat.readings[0], min: "60", max: "70" }];
  const mix = { ...newStep("mix"), instruction: "Add the lye slowly while mixing.", readings: [{ name: "Mixed until thick", kind: "yesno" as const, unit: "", min: "", max: "", target: "", code: "", required: true }] };
  const pour = newStep("pour");
  const cure = { ...newStep("wait"), name: "Cure", waitAmount: "4", waitUnit: "weeks" as const };
  const cut = newStep("cut");
  const wrap = newStep("wrap");
  const move = newStep("move");
  return [clean, weigh, heat, mix, pour, cure, cut, wrap, move];
}

function input(productId: string, over: Partial<RecipeSaveInput> = {}): RecipeSaveInput {
  return {
    productId,
    formulaId: null,
    routingId: null,
    batchKg: "17.6",
    expectedPct: "95",
    view: "pct",
    lines: [
      { materialId: mats[0].id, amount: "21.1545", src: "pct", diffKind: "pct", diff: "2", needsCheck: false, phaseCode: null, scaling: "proportional", isCritical: true },
      { materialId: mats[1].id, amount: "49.3612", src: "pct", diffKind: "pct", diff: "2", needsCheck: false, phaseCode: null, scaling: "proportional", isCritical: true },
      { materialId: mats[2].id, amount: "29.4843", src: "pct", diffKind: "g", diff: "5", needsCheck: true, phaseCode: null, scaling: "proportional", isCritical: true },
    ],
    steps: soapSteps(),
    changeSummary: "",
    useFrom: "",
    formulaNotes: "",
    routingNotes: "",
    submit: false,
    activateProduct: false,
    ...over,
  };
}

/** Everything stored for a formula revision and a routing revision, without ids, codes and times. */
async function stored(formulaRevisionId: string, routingRevisionId: string) {
  const [fr] = await db.select().from(formulaRevisions).where(eq(formulaRevisions.id, formulaRevisionId));
  const lines = await db.select().from(bomLines).where(eq(bomLines.formulaRevisionId, formulaRevisionId)).orderBy(asc(bomLines.lineNo));
  const [rr] = await db.select().from(routingRevisions).where(eq(routingRevisions.id, routingRevisionId));
  const steps = await db.select().from(routingSteps).where(eq(routingSteps.routingRevisionId, routingRevisionId)).orderBy(asc(routingSteps.stepNo));
  const ids = steps.map((s) => s.id);
  const params = await db.select().from(routingStepParameters).where(inArray(routingStepParameters.routingStepId, ids));
  const items = await db.select().from(routingStepChecklistItems).where(inArray(routingStepChecklistItems.routingStepId, ids));
  const stepNo = new Map(steps.map((s) => [s.id, s.stepNo]));
  return {
    formula: { revisionNo: fr.revisionNo, status: fr.status, referenceBatchSizeG: fr.referenceBatchSizeG, theoreticalYieldPct: fr.theoreticalYieldPct, effectiveFrom: fr.effectiveFrom, notes: fr.notes },
    lines: lines.map(({ id: _i, formulaRevisionId: _f, ...l }) => l),
    routing: { revisionNo: rr.revisionNo, status: rr.status, effectiveFrom: rr.effectiveFrom, notes: rr.notes },
    steps: steps.map(({ id: _i, routingRevisionId: _r, ...s }) => s),
    params: params.map(({ id: _i, routingStepId, ...x }) => ({ step: stepNo.get(routingStepId), ...x })).sort((a, b) => a.step! - b.step! || a.sequence - b.sequence),
    items: items.map(({ id: _i, routingStepId, ...x }) => ({ step: stepNo.get(routingStepId), ...x })).sort((a, b) => a.step! - b.step! || a.itemNo - b.itemNo),
  };
}

describe("saving through the existing services", () => {
  it("creates exactly the formula and routing records the existing services create (drafts, version 1)", async () => {
    const viaWizard = await newProduct("Wizard Soap A");
    const r = await saveRecipe(planner, input(viaWizard));
    expect(r.formula).toMatchObject({ revisionNo: 1, status: "draft", changed: true });
    expect(r.routing).toMatchObject({ revisionNo: 1, status: "draft", changed: true });

    // The same recipe typed into the existing services by hand (grams per 17,600 g batch).
    const viaServices = await newProduct("Wizard Soap B");
    const f = await createFormula(planner, { productId: viaServices, code: "F-WIZ-B", name: "Wizard Soap B", referenceBatchSizeG: "17600", theoreticalYieldPct: "95" });
    await saveFormulaRevisionDraft(planner, {
      revisionId: f.revisionId,
      referenceBatchSizeG: "17600",
      theoreticalYieldPct: "95",
      lines: [
        { materialId: mats[0].id, quantityG: "3723.192", tolerancePct: "2", toleranceAbsG: null, scaling: "proportional", isCritical: true, requiresChecker: false },
        { materialId: mats[1].id, quantityG: "8687.5712", tolerancePct: "2", toleranceAbsG: null, scaling: "proportional", isCritical: true, requiresChecker: false },
        { materialId: mats[2].id, quantityG: "5189.2368", tolerancePct: null, toleranceAbsG: "5", scaling: "proportional", isCritical: true, requiresChecker: true },
      ],
    });
    const rt = await createRouting(planner, { productId: viaServices, code: "R-WIZ-B", name: "Steps B" });
    await saveRoutingRevisionDraft(planner, {
      revisionId: rt.revisionId,
      steps: [
        { name: "Start check", stepKind: "line_clearance", area: "production", requiresChecker: false, checklistItems: [{ text: "Tables and pots are clean", requiresPhoto: false, isBlocking: true }] },
        { name: "Weigh the ingredients", stepKind: "dispensing", requiresChecker: true },
        { name: "Heat", stepKind: "process", requiresChecker: false, parameters: [{ code: "temperature", name: "Temperature", valueKind: "numeric", uom: "°C", minValue: "60", maxValue: "70", isRequired: true }] },
        { name: "Mix", stepKind: "process", instruction: "Add the lye slowly while mixing.", requiresChecker: false, parameters: [{ code: "mixed_until_thick", name: "Mixed until thick", valueKind: "boolean", isRequired: true }] },
        { name: "Pour into moulds", stepKind: "process", requiresChecker: false },
        { name: "Cure", stepKind: "curing", requiresChecker: false, minDurationMinutes: 40320 },
        { name: "Cut", stepKind: "cutting", requiresChecker: false },
        { name: "Wrap and label", stepKind: "packaging", requiresChecker: false },
        { name: "Move to the hold area", stepKind: "transfer", requiresChecker: false },
      ],
    });
    const a = await stored(r.formula.revisionId, r.routing!.revisionId);
    const b = await stored(f.revisionId, rt.revisionId);
    expect(a).toEqual(b);
    expect(a.lines.map((l) => l.quantityG)).toEqual(["3723.192000", "8687.571200", "5189.236800"]);
  });

  it("percent amounts must add up to exactly 100 %; nothing is written otherwise", async () => {
    const pid = await newProduct("Wizard Soap Short");
    const bad = input(pid);
    bad.lines[2] = { ...bad.lines[2], amount: "26.9843" };
    const e = await expectCode(saveRecipe(planner, bad), "validation");
    expect((e.details?.fieldErrors as Record<string, string>).lines).toMatch(/^Total 97\.5% — add 2\.5% more/);
    expect(await db.select().from(formulas).where(eq(formulas.productId, pid))).toHaveLength(0);
    // a waiting step needs its time
    const noWait = input(pid);
    noWait.steps[5] = { ...noWait.steps[5], waitAmount: "" };
    const w = await expectCode(saveRecipe(planner, noWait), "validation");
    expect(w.details?.fieldErrors).toHaveProperty("steps.5.minDurationMinutes");
    // the services' own schema runs before anything is written (step field keys kept)
    const noArea = input(pid);
    noArea.steps[0] = { ...noArea.steps[0], area: "" };
    const a = await expectCode(saveRecipe(planner, noArea), "validation");
    expect(a.details?.fieldErrors).toHaveProperty("steps.0.area");
    expect(await db.select().from(formulas).where(eq(formulas.productId, pid))).toHaveLength(0);
    expect(await db.select().from(routings).where(eq(routings.productId, pid))).toHaveLength(0);
  });

  it("removes what it created when a later command fails (no half recipe)", async () => {
    const pid = await newProduct("Wizard Soap Rollback");
    const bad = input(pid);
    // passes the schema, refused by the routing service (instruction of no organization)
    bad.steps[2] = { ...bad.steps[2], keep: { ...bad.steps[2].keep, workInstructionRevisionId: randomUUID() } };
    await expectCode(saveRecipe(planner, bad), "validation");
    expect(await db.select().from(formulas).where(eq(formulas.productId, pid))).toHaveLength(0);
    expect(await db.select().from(routings).where(eq(routings.productId, pid))).toHaveLength(0);
  });
});

describe("who may save", () => {
  it("refuses a user without masterdata.formula.create (operator, QA) and writes nothing", async () => {
    const pid = await newProduct("Wizard Soap Roles");
    await expectCode(saveRecipe(operator, input(pid)), "forbidden");
    await expectCode(saveRecipe(qa, input(pid)), "forbidden");
    await expectCode(recipeWizardOptions(operator), "forbidden");
    await expectCode(createRecipeProduct(qa, { name: "x", sizeG: "135", family: "Soap", unitsPerBox: "48", shelfLifeMonths: "24" }), "forbidden");
    await expectCode(createRecipeIngredient(operator, { name: "x" }), "forbidden");
    expect(await db.select().from(formulas).where(eq(formulas.productId, pid))).toHaveLength(0);
    // a site manager may edit recipes but not make products or ingredients (role escalation refused)
    await expectCode(createRecipeProduct(manager, { name: "x", sizeG: "135", family: "Soap", unitsPerBox: "48", shelfLifeMonths: "24" }), "forbidden");
    // submitting needs the submit permissions; making the product active needs product edit
    await expectCode(saveRecipe(manager, input(pid, { activateProduct: true })), "forbidden");
  });

  it("another organization sees nothing and cannot save into this one", async () => {
    const pid = await newProduct("Wizard Soap Tenant");
    const r = await saveRecipe(planner, input(pid));
    const other = new AuthContext(randomUUID(), randomUUID(), "Other", "other@example.test", ["production_planner"], planner.permissions, [{ ...nfd, id: randomUUID() }], randomUUID());
    expect(await getRecipe(other, r.formulaId)).toBeNull();
    await expectCode(saveRecipe(other, input(pid)), "not_found");
    await expectCode(saveRecipe(other, input(pid, { formulaId: r.formulaId })), "not_found");
    await expectCode(getRecipeCopy(other, r.formulaId), "not_found");
  });
});

describe("product, ingredients and versions", () => {
  it("makes a product and an ingredient inline with the existing services", async () => {
    const p = await createRecipeProduct(planner, { name: "Calamansi Soap 135 g", sizeG: "135", family: "Soap", unitsPerBox: "48", shelfLifeMonths: "24" });
    // one go: product + its sellable item (SKU, same code, pieces) + both active, for someone allowed all three
    expect(p).toMatchObject({ name: "Calamansi Soap 135 g", status: "active", family: "Soap", notes: [] });
    const [row] = await db.select().from(products).where(eq(products.id, p.id));
    expect(row.shelfLifeDays).toBe(730);
    expect(row.status).toBe("active");
    expect(row.skuCode).toMatch(/^PRD-/);
    const [sku] = await db.select().from(skus).where(eq(skus.productId, p.id));
    expect(sku).toMatchObject({ code: row.skuCode, status: "active", unitsPerBox: 48, shelfLifeDays: 730 });
    const m = await createRecipeIngredient(planner, { name: "Calamansi Extract (test)" });
    expect(m).toMatchObject({ kind: "raw_material", baseUom: "g", status: "active" });
    const opts = await recipeWizardOptions(planner);
    expect(opts.products.some((x) => x.id === p.id && x.formulaId === null)).toBe(true);
    expect(opts.defaultDiffPct).toBe("2");
    // a second recipe for the same product is refused with a pointer to "Make a new version"
    await saveRecipe(planner, input(p.id));
    const dup = await expectCode(saveRecipe(planner, input(p.id)), "conflict");
    expect(dup.message).toMatch(/Make a new version/);
  });

  it("edit and new version: unchanged parts get no new version; changes go into one draft; version 2 needs a reason to send", async () => {
    const [acs] = await db.select().from(formulas).where(eq(formulas.code, "F-ACS-01"));
    const view = await getRecipe(planner, acs.id);
    expect(view!.mode).toBe("approved");
    const base = { ...view!.draft, submit: false, activateProduct: false };
    const same = await saveRecipe(planner, base);
    expect(same.formula.changed).toBe(false);
    expect(same.routing!.changed).toBe(false);
    expect(same.message).toMatch(/Nothing changed/);
    const before = await db.select().from(formulaRevisions).where(eq(formulaRevisions.formulaId, acs.id));

    const changed = { ...base, lines: base.lines.map((l, i) => (i === 0 ? { ...l, amount: "3700" } : l)) };
    const v2 = await saveRecipe(planner, changed);
    expect(v2.formula).toMatchObject({ revisionNo: before.length + 1, status: "draft", changed: true });
    expect(v2.routing!.changed).toBe(false);
    const routingRevs = await db.select().from(routingRevisions).where(eq(routingRevisions.routingId, v2.routingId!));
    expect(routingRevs.filter((r) => r.status === "draft")).toHaveLength(0);

    // saving again goes into the same draft
    const again = await saveRecipe(planner, { ...changed, lines: changed.lines.map((l, i) => (i === 0 ? { ...l, amount: "3710" } : l)) });
    expect(again.formula.revisionId).toBe(v2.formula.revisionId);
    const reread = await getRecipe(planner, acs.id);
    expect(reread!.mode).toBe("draft");
    expect(reread!.versions.formula.open).toMatchObject({ no: v2.formula.revisionNo, status: "draft" });
    expect(reread!.draft.lines[0].amount).toBe("3710");

    const noReason = await expectCode(saveRecipe(planner, { ...reread!.draft, submit: true, activateProduct: false }), "validation");
    expect(noReason.details?.fieldErrors).toHaveProperty("changeSummary");
    const sent = await saveRecipe(planner, { ...reread!.draft, changeSummary: "Less coconut oil", submit: true, activateProduct: false });
    expect(sent.formula.status).toBe("pending_approval");
    // while waiting, the ingredients cannot change
    const waiting = await getRecipe(planner, acs.id);
    expect(waiting!.mode).toBe("waiting");
    expect(waiting!.locks.ingredients).toBe(true);
    await expectCode(saveRecipe(planner, { ...waiting!.draft, lines: waiting!.draft.lines.slice(1), submit: false, activateProduct: false }), "state");
  });

  it("copy from another recipe: same ingredients and steps as a new draft, the source untouched", async () => {
    const [gbs] = await db.select().from(formulas).where(eq(formulas.code, "F-GBS-01"));
    const srcBefore = await db.select().from(formulaRevisions).where(eq(formulaRevisions.formulaId, gbs.id));
    const copy = await getRecipeCopy(planner, gbs.id);
    expect(copy.lines.length).toBeGreaterThan(0);
    expect(copy.steps.length).toBeGreaterThan(0);
    const pid = await newProduct("Wizard Soap Copy");
    const { from, ...parts } = copy;
    expect(from).toMatch(/F-GBS-01/);
    const r = await saveRecipe(planner, { productId: pid, formulaId: null, routingId: null, view: "g", changeSummary: "", useFrom: "", formulaNotes: "", routingNotes: "", ...parts });
    expect(r.formula).toMatchObject({ revisionNo: 1, status: "draft" });
    const src = await getRecipe(planner, gbs.id);
    const srcRev = src!.versions.formula.current!.id;
    const srcLines = await db.select().from(bomLines).where(eq(bomLines.formulaRevisionId, srcRev)).orderBy(asc(bomLines.lineNo));
    const newLines = await db.select().from(bomLines).where(eq(bomLines.formulaRevisionId, r.formula.revisionId)).orderBy(asc(bomLines.lineNo));
    const strip = (ls: typeof srcLines) => ls.map(({ id: _i, formulaRevisionId: _f, ...l }) => l);
    expect(strip(newLines)).toEqual(strip(srcLines));
    const srcSteps = await db.select().from(routingSteps).where(eq(routingSteps.routingRevisionId, src!.versions.routing!.current!.id)).orderBy(asc(routingSteps.stepNo));
    const newSteps = await db.select().from(routingSteps).where(eq(routingSteps.routingRevisionId, r.routing!.revisionId)).orderBy(asc(routingSteps.stepNo));
    const stripS = (ss: typeof srcSteps) => ss.map(({ id: _i, routingRevisionId: _r, inspectionPlanId: _p, ...s }) => s);
    expect(stripS(newSteps)).toEqual(stripS(srcSteps));
    expect(await db.select().from(formulaRevisions).where(eq(formulaRevisions.formulaId, gbs.id))).toEqual(srcBefore);
  });
});

describe("list counts (usability test bug)", () => {
  it("the recipe list counts ingredients and the steps list counts steps", async () => {
    const f = (await listFormulas(planner)).find((x) => x.code === "F-ACS-01")!;
    expect(f.effective?.lineCount).toBe(5);
    const acsProduct = f.productId;
    const r = (await listRoutings(planner)).find((x) => x.productId === acsProduct)!;
    expect(r.effective?.stepCount).toBeGreaterThan(0);
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from routing_steps where routing_revision_id = ${r.effective!.id}`)) as unknown as { n: number }[];
    expect(r.effective?.stepCount).toBe(n);
  });
});

describe("by pieces and packaging for each piece (ADR-088 §4, ADR-092)", () => {
  const wrapperLine = (materialId: string, perPiece = "1") => ({ materialId, perPiece, from: null, keep: packagingKeep() });

  it("70 bars of 135 g at 95 % → batch size 9,948 g; the wrapper is a packaging line of 70 pcs, outside the percent total; shown back as 70 bars", async () => {
    const pid = await newProduct("Wizard Soap Pieces");
    const wrapper = await createRecipePackaging(planner, { name: "Soap wrapper 135 g (pieces test)" });
    expect(wrapper).toMatchObject({ kind: "packaging", baseUom: "pcs", status: "active" });
    // percent view, three ingredients at exactly 100 %, plus one packaging line: accepted (packaging is not in the total)
    const r = await saveRecipe(planner, input(pid, { batchBy: "pcs", pieces: "70", batchKg: "", packaging: [wrapperLine(wrapper.id)] }));
    const [rev] = await db.select().from(formulaRevisions).where(eq(formulaRevisions.id, r.formula.revisionId));
    expect(rev.referenceBatchSizeG).toBe("9948.000000");
    expect(rev.theoreticalYieldPct).toBe("95.000000");
    const lines = await db.select().from(bomLines).where(eq(bomLines.formulaRevisionId, rev.id)).orderBy(asc(bomLines.lineNo));
    expect(lines).toHaveLength(4);
    // ingredients in grams of the 9,948 g batch
    expect(lines.slice(0, 3).map((l) => l.quantityG)).toEqual(["2104.449660", "4910.452176", "2933.098164"]);
    expect(lines.slice(0, 3).reduce((a, l) => a.plus(l.quantityG), new Decimal(0)).eq(9948)).toBe(true);
    // the packaging line: 70 pieces, counted not weighed, scales with the batch
    expect(lines[3]).toMatchObject({ materialId: wrapper.id, quantityG: "70.000000", tolerancePct: "0.000000", toleranceAbsG: null, scaling: "proportional", requiresChecker: false, isCritical: false });

    const view = await getRecipe(planner, r.formulaId);
    expect(view!.draft).toMatchObject({ batchBy: "pcs", pieces: "70", batchKg: "9.948" });
    expect(view!.draft.lines).toHaveLength(3);
    expect(view!.draft.packaging).toEqual([expect.objectContaining({ materialId: wrapper.id, perPiece: "1" })]);
    expect(view!.product.pieceG).toBe("135");
    // saving what was read back changes nothing
    await saveRecipe(planner, { ...view!.draft, submit: false, activateProduct: false });
    const again = await db.select().from(bomLines).where(eq(bomLines.formulaRevisionId, rev.id)).orderBy(asc(bomLines.lineNo));
    expect(again.map(({ id: _i, ...l }) => l)).toEqual(lines.map(({ id: _i, ...l }) => l));
    // "Copy from another recipe" carries the packaging per piece (worked out again for the new product)
    expect((await getRecipeCopy(planner, r.formulaId)).packaging).toEqual([expect.objectContaining({ materialId: wrapper.id, perPiece: "1", from: null })]);
  });

  it("refuses packaging as an ingredient, an ingredient as packaging, and pieces that are not a whole number", async () => {
    const pid = await newProduct("Wizard Soap Kinds");
    const wrapper = await createRecipePackaging(planner, { name: "Soap wrapper (kinds test)" });
    const asIngredient = input(pid);
    asIngredient.lines = [...asIngredient.lines.slice(0, 2), { ...asIngredient.lines[2], materialId: wrapper.id }];
    const a = await expectCode(saveRecipe(planner, asIngredient), "validation");
    expect(a.details?.fieldErrors).toHaveProperty("lines.2.materialId");
    const b = await expectCode(saveRecipe(planner, input(pid, { packaging: [wrapperLine(mats[0].id)] })), "validation");
    expect(b.details?.fieldErrors).toHaveProperty("packaging.0.materialId");
    const c = await expectCode(saveRecipe(planner, input(pid, { batchBy: "pcs", pieces: "7.5" })), "validation");
    expect(c.details?.fieldErrors).toHaveProperty("pieces");
    const d = await expectCode(saveRecipe(planner, input(pid, { packaging: [wrapperLine(wrapper.id, "0")] })), "validation");
    expect(d.details?.fieldErrors).toHaveProperty("packaging.0.perPiece");
    expect(await db.select().from(formulas).where(eq(formulas.productId, pid))).toHaveLength(0);
  });

  it("a product without a weight per piece: asked once and saved to the product, only by someone who may edit products", async () => {
    const pid = await newProduct("Wizard Soap No Weight");
    await db.update(products).set({ unitNetMassG: "0" }).where(eq(products.id, pid)); // legacy row without a size
    const noWeight = await expectCode(saveRecipe(planner, input(pid, { batchBy: "pcs", pieces: "70" })), "validation");
    expect(noWeight.details?.fieldErrors).toHaveProperty("pieceG");
    // the site manager may edit recipes but not products: refused with a plain reason, nothing written
    const mgr = await expectCode(saveRecipe(manager, input(pid, { batchBy: "pcs", pieces: "70", pieceG: "135" })), "validation");
    expect(mgr.message).toMatch(/can't change products/);
    expect((await db.select().from(products).where(eq(products.id, pid)))[0].unitNetMassG).toBe("0.000000");
    expect(await db.select().from(formulas).where(eq(formulas.productId, pid))).toHaveLength(0);
    const r = await saveRecipe(planner, input(pid, { batchBy: "pcs", pieces: "70", pieceG: "135" }));
    expect((await db.select().from(products).where(eq(products.id, pid)))[0].unitNetMassG).toBe("135.000000");
    const [rev] = await db.select().from(formulaRevisions).where(eq(formulaRevisions.id, r.formula.revisionId));
    expect(rev.referenceBatchSizeG).toBe("9948.000000");
  });

  it("refuses people without masterdata.formula.create / masterdata.material.create, and writes nothing", async () => {
    const pid = await newProduct("Wizard Soap Pieces Roles");
    const [pkg] = await db.select({ id: materials.id }).from(materials).where(and(eq(materials.materialKind, "packaging"), eq(materials.status, "active"))).limit(1);
    const byPieces = input(pid, { batchBy: "pcs", pieces: "70", packaging: [wrapperLine(pkg.id)] });
    await expectCode(saveRecipe(operator, byPieces), "forbidden");
    await expectCode(saveRecipe(qa, byPieces), "forbidden");
    await expectCode(createRecipePackaging(operator, { name: "x" }), "forbidden");
    await expectCode(createRecipePackaging(manager, { name: "x" }), "forbidden");
    expect(await db.select().from(formulas).where(eq(formulas.productId, pid))).toHaveLength(0);
  });

  it("an approved recipe by pieces: a batch lists the wrapper on Get materials (recipe packaging line, not weighed), scaled to the batch", async () => {
    const pid = await newProduct("Wizard Soap Pieces Batch");
    const wrapper = await createRecipePackaging(planner, { name: "Soap wrapper (batch test)" });
    const r = await saveRecipe(planner, input(pid, { batchBy: "pcs", pieces: "70", batchKg: "", packaging: [wrapperLine(wrapper.id)], submit: true, activateProduct: true }));
    await decideFormulaRevision(qa, { id: r.formula.revisionId, decision: "approved" });
    await decideFormulaRevision(manager, { id: r.formula.revisionId, decision: "approved" });
    await decideRoutingRevision(qa, { id: r.routing!.revisionId, decision: "approved" });
    await decideRoutingRevision(manager, { id: r.routing!.revisionId, decision: "approved" });
    // two batches' worth: 19.896 kg → 140 wrappers
    const b = await createBatch(manager, { formulaRevisionId: r.formula.revisionId, plannedSizeKg: "19.896", plannedStartOn: today });
    const [row] = await db.select().from(batches).where(eq(batches.id, b.batchId));
    const snap = row.formulaSnapshot as FormulaSnapshot;
    expect(snap.packaging).toEqual([expect.objectContaining({ materialId: wrapper.id, source: "recipe", qty: "140" })]);
    const [bm] = await db.select().from(batchMaterials).where(and(eq(batchMaterials.batchId, b.batchId), eq(batchMaterials.materialId, wrapper.id)));
    expect(bm.status).toBe("packaging");
    expect(new Decimal(bm.theoreticalQtyG).eq(140)).toBe(true);
    const list = await getMaterialsList(operator, b.batchId);
    const l = list.lines.find((x) => x.materialId === wrapper.id)!;
    expect(l).toMatchObject({ materialKind: "packaging", baseUom: "pcs", weighingOpen: false, needsCheck: false });
    expect(new Decimal(l.qty).eq(140)).toBe(true);
    // never on the Weigh screen
    expect((await getWeighView(operator, b.batchId)).cards.map((c) => c.materialName)).not.toContain(wrapper.name);
  });
});

describe("approval is still required before a batch can use it", () => {
  it("send for approval → batch refused → QA and manager approve → batch allowed", async () => {
    const pid = await newProduct("Wizard Soap Approve");
    const r = await saveRecipe(planner, input(pid, { submit: true, activateProduct: true }));
    expect(r.formula.status).toBe("pending_approval");
    expect(r.routing!.status).toBe("pending_approval");
    expect(r.productActivated).toBe(true);
    await expectCode(createBatch(manager, { formulaRevisionId: r.formula.revisionId, plannedSizeKg: "17.6", plannedStartOn: today }), "state");
    // the author can never approve their own recipe
    await expectCode(decideFormulaRevision(planner, { id: r.formula.revisionId, decision: "approved" }), "forbidden");
    await decideFormulaRevision(qa, { id: r.formula.revisionId, decision: "approved" });
    await expectCode(createBatch(manager, { formulaRevisionId: r.formula.revisionId, plannedSizeKg: "17.6", plannedStartOn: today }), "state");
    expect((await decideFormulaRevision(manager, { id: r.formula.revisionId, decision: "approved" })).status).toBe("approved");
    // formula approved, steps not yet: still refused
    await expectCode(createBatch(manager, { formulaRevisionId: r.formula.revisionId, plannedSizeKg: "17.6", plannedStartOn: today }), "validation");
    await decideRoutingRevision(qa, { id: r.routing!.revisionId, decision: "approved" });
    await decideRoutingRevision(manager, { id: r.routing!.revisionId, decision: "approved" });
    const b = await createBatch(manager, { formulaRevisionId: r.formula.revisionId, plannedSizeKg: "17.6", plannedStartOn: today });
    expect(b.batchNumber).toBeTruthy();
    // approved versions are frozen: the wizard opens them as "Make a new version"
    const view = await getRecipe(planner, r.formulaId);
    expect(view!.mode).toBe("approved");
    expect(view!.versions.formula.next).toBe(2);
  });
});

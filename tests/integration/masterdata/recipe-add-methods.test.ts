/**
 * ADR-137 through the recipe wizard: lines counted, measured, added as needed or an own way, and custom steps (choose
 * from a list, QA must sign), saved by `saveRecipe`, approved the normal way, read back unchanged, copied, and run on
 * the floor. Fictional data only.
 */
import { and, asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { batchMaterials, batches, bomLines, materials, routingStepParameters, routingSteps } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import {
  type RecipeSaveInput,
  type RecipeStepDraft,
  addMaterialUnit,
  createProduct,
  decideFormulaRevision,
  decideRoutingRevision,
  getRecipe,
  getRecipeCopy,
  newStep,
  saveRecipe,
} from "@/modules/masterdata";
import { completeStep, createBatch, recordDispense, recordReading, startBatch, submitChecklist } from "@/modules/production";
import { registerAppHooks } from "@/modules/wiring";
import { resetTestDatabase } from "../../support/db";
import { asUser, expectCode, loadKit, loc, makeLot, type Kit } from "../../support/kit";
import { allowDirectBatches, manilaDay, snapshotOf } from "../../support/w2b";

let kit: Kit;
let planner: AuthContext;
let qa: AuthContext;
let manager: AuthContext;
let operator: AuthContext;
let checker: AuthContext;
let M: Record<"coconut" | "palm" | "fragrance" | "lye" | "citric", string>;
let sachet: string;
let lyeMl: string;

const code = async (c: string) => (await db.select({ id: materials.id }).from(materials).where(eq(materials.code, c)))[0].id;

function steps(): RecipeStepDraft[] {
  const clean = { ...newStep("clean"), area: "weighing", name: "Start check", checklist: [{ text: "Area clean", requiresPhoto: false, isBlocking: true }] };
  const weigh = { ...newStep("weigh"), needsCheck: false };
  const look = newStep("custom");
  look.name = "Check the colour";
  look.instruction = "Compare with the colour card.";
  look.needsCheck = true;
  look.qaSigns = true;
  look.readings = [
    { name: "Colour", kind: "choice", options: ["Light green", "Green", "Dark green"], unit: "", min: "", max: "", target: "", code: "", required: true },
    { name: "Thickness", kind: "number", unit: "cP", min: "1000", max: "3000", target: "", code: "", required: true },
  ];
  const homog = newStep("homogenise");
  return [clean, weigh, look, homog];
}

function input(productId: string, over: Partial<RecipeSaveInput> = {}): RecipeSaveInput {
  return {
    productId,
    formulaId: null,
    routingId: null,
    batchKg: "10",
    expectedPct: "100",
    view: "pct",
    lines: [
      { materialId: M.coconut, amount: "60", src: "pct", diffKind: "pct", diff: "1", needsCheck: false, phaseCode: null, scaling: "proportional", isCritical: true },
      // 5 sachets of 25 g = 125 g = 1.25 %
      { materialId: M.fragrance, amount: "", src: "pct", method: "count", methodQty: "5", unitId: sachet, diffKind: "units", diff: "0", needsCheck: false, phaseCode: null, scaling: "proportional_round", rounding: "up", isCritical: true, note: "Shake the sachet first" },
      // 1,500 mL at 1.33 g/mL = 1,995 g = 19.95 %
      { materialId: M.lye, amount: "", src: "pct", method: "volume", methodQty: "1500", unitId: lyeMl, diffKind: "units", diff: "10", needsCheck: false, phaseCode: null, scaling: "proportional", isCritical: true },
      // own way, not measured: about 1,880 g = 18.8 %
      { materialId: M.palm, amount: "18.8", src: "pct", method: "custom", customName: "Pour from the jug to the red line", customUnit: "jug", customUnitQty: "", diffKind: "pct", diff: "5", needsCheck: false, phaseCode: null, scaling: "proportional", isCritical: true },
      // as needed: not in the 100 %
      { materialId: M.citric, amount: "20", src: "g", method: "as_needed", recordBy: "weigh", readingName: "pH", readingUnit: "", readingMin: "5.0", readingMax: "5.5", maxAmount: "40", diffKind: "pct", diff: "", needsCheck: false, phaseCode: null, scaling: "proportional", isCritical: true },
    ],
    steps: steps(),
    changeSummary: "",
    useFrom: "",
    formulaNotes: "",
    routingNotes: "",
    submit: false,
    activateProduct: false,
    ...over,
  };
}

beforeAll(async () => {
  await resetTestDatabase();
  registerAppHooks();
  kit = await loadKit();
  planner = await asUser(kit, "planner.nfd@bryels-care.test", "production_planner", [kit.nfd]);
  qa = await asUser(kit, "qa.nfd@bryels-care.test", "qa_qc", [kit.nfd]);
  manager = await asUser(kit, "manager.nfd@bryels-care.test", "site_manager", [kit.nfd]);
  operator = await asUser(kit, "operator.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  checker = await asUser(kit, "checker.nfd@bryels-care.test", "production_operator", [kit.nfd]);
  await allowDirectBatches(kit);
  M = { coconut: await code("MAT-0012"), palm: await code("MAT-0013"), fragrance: await code("MAT-0043"), lye: await code("MAT-0021"), citric: await code("MAT-0051") };
  sachet = (await addMaterialUnit(planner, { materialId: M.fragrance, kind: "pack", name: "sachet", qtyPerUnit: "25" })).unitId;
  lyeMl = (await addMaterialUnit(planner, { materialId: M.lye, kind: "volume", qtyPerUnit: "1.33" })).unitId;
}, 240_000);

describe("the wizard", () => {
  let productId: string;
  let formulaId: string;
  let revisionId: string;

  it("saves every way of adding, with the percent total counting units and leaving out as-needed lines", async () => {
    productId = (await createProduct(planner, { code: null, name: "Method Lotion (fictional)", family: "Lotion", unitNetMassG: "250", unitsPerBox: 24, shelfLifeDays: 730 })).id;
    const r = await saveRecipe(planner, input(productId, { submit: true, activateProduct: true }));
    formulaId = r.formulaId;
    revisionId = r.formula.revisionId;
    const lines = await db.select().from(bomLines).where(eq(bomLines.formulaRevisionId, r.formula.revisionId)).orderBy(asc(bomLines.lineNo));
    expect(lines.map((l) => [l.addMethod, l.quantityG, l.methodQty, l.methodUnit, l.scaling, l.rounding])).toEqual([
      ["weigh", "6000.000000", null, null, "proportional", null],
      ["count", "125.000000", "5.000000", "sachet", "proportional_round", "up"],
      ["volume", "1995.000000", "1500.000000", "mL", "proportional", null],
      ["custom", "1880.000000", null, "jug", "proportional", null],
      ["as_needed", "20.000000", null, null, "proportional", null],
    ]);
    expect(lines[1].operatorNote).toBe("Shake the sachet first");
    expect(lines[4].maxQtyG).toBe("40.000000");
    const st = await db.select().from(routingSteps).where(eq(routingSteps.routingRevisionId, r.routing!.revisionId)).orderBy(asc(routingSteps.stepNo));
    expect(st.map((s) => [s.name, s.stepKind, s.isCustom, s.qaSigns, s.requiresChecker])).toEqual([
      ["Start check", "line_clearance", false, false, false],
      ["Weigh the ingredients", "dispensing", false, false, false],
      ["Check the colour", "process", true, true, true],
      ["Homogenise", "process", false, false, false],
    ]);
    const params = await db.select().from(routingStepParameters).where(eq(routingStepParameters.routingStepId, st[2].id)).orderBy(asc(routingStepParameters.sequence));
    expect(params.map((p) => [p.valueKind, p.options])).toEqual([
      ["choice", ["Light green", "Green", "Dark green"]],
      ["numeric", null],
    ]);
    // The same people approve as for any recipe (ADR-117 owner rule unchanged).
    for (const who of [qa, manager]) {
      await decideFormulaRevision(who, { id: r.formula.revisionId, decision: "approved", effectiveFrom: manilaDay(0) });
      await decideRoutingRevision(who, { id: r.routing!.revisionId, decision: "approved", effectiveFrom: manilaDay(0) });
    }
  });

  it("refuses an as-needed line without its reading and a count without its unit, naming the field", async () => {
    const p2 = (await createProduct(planner, { code: null, name: "Method Lotion 2 (fictional)", family: "Lotion", unitNetMassG: "250", unitsPerBox: 24, shelfLifeDays: 730 })).id;
    const bad = input(p2);
    bad.lines[1] = { ...bad.lines[1], unitId: null };
    bad.lines[4] = { ...bad.lines[4], readingName: "" };
    const e = await expectCode(saveRecipe(planner, bad), "validation");
    const fe = e.details?.fieldErrors as Record<string, string>;
    expect(fe["lines.1.materialUnitId"]).toBeTruthy();
    expect(fe["lines.4.methodSpec.reading"]).toBeTruthy();
  });

  it("reads back exactly what was typed and an unchanged save makes no new version", async () => {
    const view = await getRecipe(planner, formulaId);
    const d = view!.draft;
    expect(d.lines[1]).toMatchObject({ method: "count", methodQty: "5", unitId: sachet, diffKind: "units", diff: "0", scaling: "proportional_round", rounding: "up", note: "Shake the sachet first" });
    expect(d.lines[3]).toMatchObject({ method: "custom", customName: "Pour from the jug to the red line", customUnit: "jug", customUnitQty: "", amount: "1880" });
    expect(d.lines[4]).toMatchObject({ method: "as_needed", recordBy: "weigh", readingName: "pH", readingMin: "5.0", readingMax: "5.5", maxAmount: "40", amount: "20" });
    expect(d.steps[2]).toMatchObject({ block: "custom", isCustom: true, qaSigns: true });
    expect(d.steps[2].readings[0]).toMatchObject({ kind: "choice", options: ["Light green", "Green", "Dark green"] });
    expect(d.steps[3].block).toBe("homogenise");
    const again = await saveRecipe(planner, { ...d, view: "g", submit: false, activateProduct: false });
    expect(again.formula.changed).toBe(false);
    expect(again.routing?.changed).toBe(false);
  });

  it("copies the ways of adding and the custom steps to another recipe", async () => {
    const copy = await getRecipeCopy(planner, formulaId);
    expect(copy!.lines.map((l) => l.method ?? "weigh")).toEqual(["weigh", "count", "volume", "custom", "as_needed"]);
    expect(copy!.steps.find((s) => s.isCustom)?.qaSigns).toBe(true);
  });

  it("runs on the floor: a choice from the list, and only QA signs the custom step", async () => {
    const { batchId } = await createBatch(manager, { formulaRevisionId: revisionId, plannedSizeKg: "10", plannedStartOn: manilaDay(0) });
    await startBatch(operator, batchId);
    const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
    const s = snapshotOf(b).steps.sort((x, y) => x.stepNo - y.stepNo);
    expect(s[2]).toMatchObject({ qaSigns: true, isCustom: true });
    await submitChecklist(operator, { batchId, stepNo: 1, answers: s[0].checklistItems!.map((i) => ({ itemId: i.id, answer: "yes" as const })) });
    const lines = await db.select().from(batchMaterials).where(eq(batchMaterials.batchId, batchId)).orderBy(asc(batchMaterials.lineNo));
    const b01 = (await loc(kit.nfd.id, "B-01")).id;
    const lot = (c: string, q: string) => makeLot(manager, kit.nfd.id, b01, q, { materialCode: c });
    await recordDispense(operator, { batchId, batchMaterialId: lines[0].id, lotRef: (await lot("MAT-0012", "7000")).id, qty: "6000" });
    await recordDispense(operator, { batchId, batchMaterialId: lines[1].id, lotRef: (await lot("MAT-0043", "500")).id, units: "5" });
    await recordDispense(operator, { batchId, batchMaterialId: lines[2].id, lotRef: (await lot("MAT-0021", "3000")).id, units: "1505" });
    // Own way, not measured: the operator writes what was used, judged ± 5 % in grams.
    await recordDispense(operator, { batchId, batchMaterialId: lines[3].id, lotRef: (await lot("MAT-0013", "3000")).id, qty: "1900" });
    await recordDispense(operator, { batchId, batchMaterialId: lines[4].id, lotRef: (await lot("MAT-0051", "100")).id, qty: "18", reading: "5.3" });
    await completeStep(operator, { batchId, stepNo: 2 });
    const colour = s[2].parameters!.find((p) => p.valueKind === "choice")!;
    const thick = s[2].parameters!.find((p) => p.valueKind === "numeric")!;
    await expectCode(recordReading(operator, { batchId, stepNo: 3, parameterId: colour.id, value: "Blue" }), "validation");
    await recordReading(operator, { batchId, stepNo: 3, parameterId: colour.id, value: "green" });
    await recordReading(operator, { batchId, stepNo: 3, parameterId: thick.id, value: "2000" });
    // A production checker is not QA.
    await expectCode(completeStep(operator, { batchId, stepNo: 3 }, { checker }), "forbidden");
    const done = await completeStep(operator, { batchId, stepNo: 3 }, { checker: qa });
    expect(done.status).toBe("completed");
    const [stored] = await db.select().from(batchMaterials).where(and(eq(batchMaterials.batchId, batchId), eq(batchMaterials.lineNo, 2)));
    expect([stored.methodTargetQty, stored.methodUnit]).toEqual(["5.000000", "sachet"]);
  });
});

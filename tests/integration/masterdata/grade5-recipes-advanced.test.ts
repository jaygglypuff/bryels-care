/**
 * Grade-5 pass of the recipe "advanced editing" screens (ADR-088, ADR-093, ADR-094): nobody types a
 * code for a product, a sellable item (SKU), a recipe (formula), its steps (routing) or a how-to sheet
 * (work instruction). A blank code is made by the server in the creating transaction (PRD-, SKU-, F-,
 * R-, WI- running numbers; a product's first sellable item takes the product's own code), typed codes
 * stay validated and unique, a blank code on edit keeps the code, and shelf life may be typed in
 * months. The advanced recipe page's gram total leaves packaging lines (pieces) out and lists them as
 * "Packaging per batch". Negative tests: roles without the right stay refused.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, uoms } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import {
  createFormula,
  createMaterialMaster as createMaterial,
  createProduct,
  createRouting,
  createSku,
  createWorkInstruction,
  formulaTotals,
  getFormulaRevision,
  saveFormulaRevisionDraft,
  updateProduct,
  updateSku,
} from "@/modules/masterdata";
import { expectCode, setupW1D } from "./helpers";

let planner: AuthContext;
let operator: AuthContext;
let qa: AuthContext;
let pcsId: string;

beforeAll(async () => {
  const s = await setupW1D();
  planner = await s.ctxFor("planner.nfd@bryels-care.test", "production_planner", [s.nfd]);
  operator = await s.ctxFor("operator.nfd@bryels-care.test", "production_operator", [s.nfd]);
  qa = await s.ctxFor("qa.nfd@bryels-care.test", "qa_qc", [s.nfd, s.rvs]);
  const [pcs] = await db.select({ id: uoms.id }).from(uoms).where(and(eq(uoms.organizationId, planner.organizationId), eq(uoms.code, "pcs")));
  pcsId = pcs.id;
}, 180_000);

const product = (extra: Record<string, unknown> = {}) => ({ name: "Kalamansi Bar (fictional)", family: "soap", unitNetMassG: "120", unitsPerBox: 24, shelfLifeMonths: 24, ...extra });

describe("products and sellable items without typed codes", () => {
  it("a new product gets PRD-nnnn; shelf life in months becomes days (24 → 730); a blank code on edit keeps it", async () => {
    const p = await createProduct(planner, product({ code: "" }));
    expect(p.code).toMatch(/^PRD-\d{4}$/);
    expect(p.shelfLifeDays).toBe(730);
    const kept = await updateProduct(planner, p.id, product({ code: "", name: "Kalamansi Bar renamed (fictional)", shelfLifeMonths: 6 }));
    expect(kept.code).toBe(p.code);
    expect(kept.shelfLifeDays).toBe(183);
    await expectCode(createProduct(planner, product({ shelfLifeMonths: "" })), "validation");
    await expectCode(createProduct(operator, product()), "forbidden");
  });

  it("the first sellable item takes the product's code, the next one SKU-nnnn; typed codes stay unique; blank on edit keeps it", async () => {
    const p = await createProduct(planner, product({ name: "Guava Bar 3-pack (fictional)" }));
    const first = await createSku(planner, { productId: p.id, code: "", name: "Guava Bar single (fictional)", uomBaseId: pcsId });
    expect(first.code).toBe(p.code);
    const second = await createSku(planner, { productId: p.id, name: "Guava Bar box of 12 (fictional)", uomBaseId: pcsId, variantLabel: "Box of 12" });
    expect(second.code).toMatch(/^SKU-\d{4}$/);
    const [ev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "masterdata.sku.created"), eq(auditEvents.entityId, second.id)));
    expect(ev.after).toMatchObject({ code: second.code, codeAssigned: true });
    await expectCode(createSku(planner, { productId: p.id, code: second.code, name: "Duplicate (fictional)", uomBaseId: pcsId }), "conflict");
    const kept = await updateSku(planner, second.id, { productId: p.id, code: "", name: "Guava Bar box of 12 renamed (fictional)", uomBaseId: pcsId });
    expect(kept.code).toBe(second.code);
    await expectCode(createSku(operator, { productId: p.id, name: "No right (fictional)", uomBaseId: pcsId }), "forbidden");
  });
});

describe("recipes (advanced), steps and how-to sheets without typed codes", () => {
  it("a new recipe gets F-nnnn and the product's name; steps get R-nnnn and 'Steps for <product>'; a how-to sheet gets WI-nnnn", async () => {
    const p = await createProduct(planner, product({ name: "Papaya Bar (fictional)" }));
    const f = await createFormula(planner, { productId: p.id, code: "", name: "", referenceBatchSizeG: "10000", theoreticalYieldPct: "95" });
    const fv = await getFormulaRevision(planner, f.revisionId);
    expect(fv!.formula.code).toMatch(/^F-\d{4}$/);
    expect(fv!.formula.name).toBe("Papaya Bar (fictional)");
    const r = await createRouting(planner, { productId: p.id, name: null });
    expect(r.routingId).toBeTruthy();
    const [rev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "masterdata.routing.created"), eq(auditEvents.entityId, r.routingId)));
    expect(rev.entityNumber).toMatch(/^R-\d{4}$/);
    expect(rev.after).toMatchObject({ codeAssigned: true });
    const wi = await createWorkInstruction(qa.can("masterdata.work_instruction.create") ? qa : planner, { name: "How to wrap a bar (fictional)", bodyMarkdown: "1. Fold. 2. Seal." });
    const [wev] = await db.select().from(auditEvents).where(and(eq(auditEvents.action, "masterdata.work_instruction.created"), eq(auditEvents.entityId, wi.workInstructionId)));
    expect(wev.entityNumber).toMatch(/^WI-\d{4}$/);
    // A typed code is still checked and unique.
    await expectCode(createFormula(planner, { productId: p.id, code: fv!.formula.code, referenceBatchSizeG: "1000", theoreticalYieldPct: "95" }), "conflict");
    await expectCode(createFormula(planner, { productId: p.id, code: "bad code!", referenceBatchSizeG: "1000", theoreticalYieldPct: "95" }), "validation");
    await expectCode(createFormula(operator, { productId: p.id, referenceBatchSizeG: "1000", theoreticalYieldPct: "95" }), "forbidden");
    await expectCode(createRouting(operator, { productId: p.id }), "forbidden");
  });

  it("the gram total leaves packaging lines out and lists them as packaging per batch (ADR-094)", async () => {
    const p = await createProduct(planner, product({ name: "Mango Bar (fictional)" }));
    const oil = await createMaterial(planner, { code: null, name: "Mango butter (fictional)", materialKind: "raw_material", baseUom: "g", status: "active" });
    const wrap = await createMaterial(planner, { code: null, name: "Mango wrapper (fictional)", materialKind: "packaging", baseUom: "pcs", status: "active" });
    const f = await createFormula(planner, { productId: p.id, referenceBatchSizeG: "1000", theoreticalYieldPct: "95" });
    await saveFormulaRevisionDraft(planner, {
      revisionId: f.revisionId,
      referenceBatchSizeG: "1000",
      theoreticalYieldPct: "95",
      lines: [
        { materialId: oil.id, quantityG: "1000", tolerancePct: "2" },
        { materialId: wrap.id, quantityG: "8", tolerancePct: "0" },
      ],
    });
    const v = await getFormulaRevision(planner, f.revisionId);
    expect(v!.totals.sumG).toBe("1000");
    expect(v!.totals.differenceG).toBe("0");
    expect(v!.totals.packaging).toEqual([{ materialName: "Mango wrapper (fictional)", pieces: "8" }]);
    expect(v!.lines.find((l) => l.materialId === wrap.id)).toMatchObject({ isPackaging: true });
  });

  it("formulaTotals is pure: ingredients add up in grams, packaging is listed apart", () => {
    const t = formulaTotals([
      { quantityG: "600.5", materialKind: "raw_material", materialName: "Oil" },
      { quantityG: "399.5", materialKind: "intermediate", materialName: "Lye solution" },
      { quantityG: "70", materialKind: "packaging", materialName: "Wrapper" },
    ]);
    expect(t.sumG.toString()).toBe("1000");
    expect(t.packaging).toEqual([{ materialName: "Wrapper", pieces: "70" }]);
  });
});

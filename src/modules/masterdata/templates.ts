import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { formulas, materials, products, routings } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { createFormula, saveFormulaRevisionDraft } from "./formulas";
import { createMaterial } from "./materials";
import { createProduct } from "./products";
import { createRouting, saveRoutingRevisionDraft } from "./routings";

/**
 * Starter example (owner feedback 2026-10-25, ADR-079): the Acapulco soap formula and a simple soap
 * routing, so a new company starts from a filled-in example instead of a blank page. Fictional,
 * illustrative quantities from the demo company — not an approved recipe. Creates only what is
 * missing (materials and product are matched by name), leaves the formula and routing as drafts for
 * the owner to review, submit and approve. Running it again changes nothing.
 */

const MATERIALS: { name: string; inciName: string | null; materialKind: "raw_material" | "intermediate" | "packaging"; baseUom: string; shelfLifeDays: number }[] = [
  { name: "Coconut Oil", inciName: "Cocos Nucifera (Coconut) Oil", materialKind: "raw_material", baseUom: "g", shelfLifeDays: 730 },
  { name: "Palm Oil", inciName: "Elaeis Guineensis (Palm) Oil", materialKind: "raw_material", baseUom: "g", shelfLifeDays: 540 },
  { name: "33.33% Lye Solution", inciName: "Sodium Hydroxide (aqueous)", materialKind: "intermediate", baseUom: "g", shelfLifeDays: 30 },
  { name: "Acapulco Extract", inciName: "Cassia Alata Leaf Extract", materialKind: "raw_material", baseUom: "g", shelfLifeDays: 365 },
  { name: "6% Green in Oil", inciName: "Chromium Oxide Greens dispersion", materialKind: "intermediate", baseUom: "g", shelfLifeDays: 180 },
  { name: "Soap wrapper 135 g", inciName: null, materialKind: "packaging", baseUom: "pcs", shelfLifeDays: 1825 },
];

/** Grams per 17.6 kg reference batch (demo company's illustrative Acapulco formula). */
const LINES: [string, string][] = [
  ["Coconut Oil", "3723.2"],
  ["Palm Oil", "8687.4"],
  ["33.33% Lye Solution", "4964.2"],
  ["Acapulco Extract", "190.9"],
  ["6% Green in Oil", "34.4"],
];

const STEPS = [
  { name: "Weighing", stepKind: "dispensing", instruction: "Weigh each ingredient against the formula.", requiresChecker: false },
  {
    name: "Mixing and pouring",
    stepKind: "process",
    instruction: "Add the lye solution to the oils slowly while mixing. Mix to trace, add extract and colour, pour into the moulds.",
    requiresChecker: false,
    parameters: [
      { code: "oil_temp", name: "Oil temperature at mixing", valueKind: "numeric", uom: "°C", isRequired: false },
      { code: "trace_time", name: "Time to trace", valueKind: "numeric", uom: "min", isRequired: false },
      { code: "mould_id", name: "Mould used", valueKind: "text", isRequired: false },
    ],
  },
  { name: "Curing and cutting", stepKind: "process", instruction: "Cure, then cut into 135 g bars. Note anything unusual.", requiresChecker: false },
  {
    name: "Wrapping and labeling",
    stepKind: "packaging",
    instruction: "Wrap the bars, print lot and expiry, count wrappers used and spoiled.",
    requiresChecker: false,
    parameters: [
      { code: "wrappers_used", name: "Wrappers used", valueKind: "numeric", uom: "pcs", isRequired: false },
      { code: "wrappers_destroyed", name: "Wrappers spoiled", valueKind: "numeric", uom: "pcs", isRequired: false },
    ],
  },
  { name: "Move to finished goods hold", stepKind: "transfer", instruction: "Move the bars to the hold area until they are approved for sale.", requiresChecker: false },
] as const;

/** Next free `PREFIX-0001` code in the organization (the example runs rarely; a plain scan is enough). */
export async function nextCode(table: "materials" | "products" | "formulas" | "routings", organizationId: string, prefix: string) {
  const t = { materials: [materials, materials.code, materials.organizationId], products: [products, products.skuCode, products.organizationId], formulas: [formulas, formulas.code, formulas.organizationId], routings: [routings, routings.code, routings.organizationId] } as const;
  const [tbl, col, org] = t[table];
  const rows = await db.select({ code: col }).from(tbl).where(and(eq(org, organizationId), sql`${col} like ${prefix + "-%"}`));
  const n = rows.reduce((max, r) => Math.max(max, /^\w+-(\d+)$/.test(r.code) ? Number(r.code.split("-")[1]) : 0), 0) + 1;
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

export async function installSoapExample(ctx: AuthContext) {
  ctx.require("masterdata.material.create");
  ctx.require("masterdata.product.create");
  ctx.require("masterdata.formula.create");
  ctx.require("masterdata.routing.create");
  const O = ctx.organizationId;
  const created: string[] = [];

  const matIds: Record<string, string> = {};
  for (const m of MATERIALS) {
    const [found] = await db.select({ id: materials.id }).from(materials).where(and(eq(materials.organizationId, O), sql`lower(${materials.name}) = ${m.name.toLowerCase()}`)).limit(1);
    if (found) {
      matIds[m.name] = found.id;
      continue;
    }
    const row = await createMaterial(ctx, { code: await nextCode("materials", O, m.materialKind === "packaging" ? "PKG" : "MAT"), name: m.name, inciName: m.inciName, materialKind: m.materialKind, baseUom: m.baseUom, shelfLifeDays: m.shelfLifeDays, status: "active" });
    matIds[m.name] = row.id;
    created.push(`material ${m.name}`);
  }

  const PRODUCT = "Acapulco Soap 135 g";
  let [product] = await db.select({ id: products.id }).from(products).where(and(eq(products.organizationId, O), sql`lower(${products.name}) = ${PRODUCT.toLowerCase()}`)).limit(1);
  if (!product) {
    const p = await createProduct(ctx, { code: await nextCode("products", O, "PRD"), name: PRODUCT, family: "Soap", unitNetMassG: "135", unitsPerBox: 48, shelfLifeDays: 730 });
    product = { id: p.id };
    created.push(`product ${PRODUCT}`);
  }

  const [hasFormula] = await db.select({ id: formulas.id }).from(formulas).where(and(eq(formulas.organizationId, O), eq(formulas.productId, product.id))).limit(1);
  let formulaRevisionId: string | null = null;
  if (!hasFormula) {
    const f = await createFormula(ctx, { productId: product.id, code: await nextCode("formulas", O, "F"), name: "Acapulco Soap (example)", referenceBatchSizeG: "17600", theoreticalYieldPct: "95", changeSummary: "Started from the built-in example" });
    await saveFormulaRevisionDraft(ctx, {
      revisionId: f.revisionId,
      referenceBatchSizeG: "17600",
      theoreticalYieldPct: "95",
      notes: "Example quantities from the fictional demo company. Check every quantity before approving.",
      lines: LINES.map(([name, quantityG]) => ({ materialId: matIds[name], quantityG, tolerancePct: "2", toleranceAbsG: null })),
    });
    formulaRevisionId = f.revisionId;
    created.push("formula (draft)");
  }

  const [hasRouting] = await db.select({ id: routings.id }).from(routings).where(and(eq(routings.organizationId, O), eq(routings.productId, product.id))).limit(1);
  let routingRevisionId: string | null = null;
  if (!hasRouting) {
    const r = await createRouting(ctx, { productId: product.id, code: await nextCode("routings", O, "R"), name: "Soap making (example)", changeSummary: "Started from the built-in example" });
    await saveRoutingRevisionDraft(ctx, { revisionId: r.revisionId, steps: STEPS.map((s) => ({ ...s, parameters: "parameters" in s ? s.parameters.map((p) => ({ ...p })) : [] })) });
    routingRevisionId = r.revisionId;
    created.push("routing (draft)");
  }
  return { productId: product.id, formulaRevisionId, routingRevisionId, created };
}

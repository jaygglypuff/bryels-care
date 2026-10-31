import "server-only";
import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { bomLines, formulaRevisions, formulas, materials, products, routingRevisions, routings, skus, uoms } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { createFormula, createFormulaRevision, deleteFormulaDraft, saveFormulaRevisionDraft, submitFormulaRevision, withdrawFormulaRevision } from "./formulas";
import { createMaterial } from "./materials";
import { monthsToDays } from "./products-shelf-life";
import { changeProductStatus, changeSkuStatus, createProduct, createSku, deleteProduct, productFamilies, updateProduct } from "./products";
import {
  BATCH_KG_DECIMALS,
  PER_PIECE_DECIMALS,
  PERCENT_DECIMALS,
  GRAM_DECIMALS,
  RECIPE_BLOCKS,
  type RecipeBlockKey,
  type RecipeDraft,
  WAIT_UNITS,
  detectPieces,
  draftPieces,
  fromBomLines,
  fromPackagingLines,
  isPieceGText,
  isPiecesText,
  piecesFromBatch,
  piecesToBatchKg,
  toPackagingLineInputs,
  fromRoutingSteps,
  gramsToKg,
  isDecimalText,
  kgToGrams,
  percentTotalText,
  plain,
  recipeTotals,
  toBomLineInputs,
  toStepInputs,
  waitToMinutes,
} from "./recipe-blocks";
import { createRouting, createRoutingRevision, deleteRoutingDraft, loadRoutingSteps, saveRoutingRevisionDraft, submitRoutingRevision, withdrawRoutingRevision } from "./routings";
import { AREAS, STEP_KINDS, SaveFormulaDraftInput, SaveRoutingDraftInput, parseInput } from "./schemas";
import { nextCode } from "./templates";
import { loadApprovalPolicy } from "./approval-policy";
import { businessToday, effectiveLabel, requireAny } from "./versioning";

/**
 * Guided "New recipe" wizard (ADR-089), server side. A thin orchestrator ON TOP of the existing
 * formula, routing, product and material services: every write is one of their commands, so their
 * permission checks, Zod validation, draft-only rules (src/db/sql/w1d.sql), audit events and the
 * approval path stay exactly as they are. This file adds no business rule of its own except:
 *  - amounts typed in percent must add up to exactly 100 % (the wizard's promise to the person);
 *  - a waiting step needs its minimum time;
 *  - a product gets one recipe here (a second formula for the same product is made in advanced editing).
 *
 * The services each run their own transaction. To avoid half-made recipes the whole input is
 * validated first with the services' own schemas, and when a later command fails the records this
 * call created are removed again with the services' own draft delete / withdraw (never-submitted
 * drafts only, ADR-075).
 */

type FieldErrors = Record<string, string>;
const fail = (message: string, fieldErrors: FieldErrors): never => {
  throw new DomainError("validation", message, { fieldErrors });
};

const uuid = z.string().uuid("Choose a valid option.");
const str = (max: number) => z.string().max(max, `Use at most ${max} characters.`);

const LineSchema = z
  .object({
    materialId: uuid,
    amount: str(30),
    src: z.enum(["g", "pct"]),
    diffKind: z.enum(["pct", "g"]),
    diff: str(30),
    needsCheck: z.boolean(),
    phaseCode: str(40).nullable(),
    scaling: z.enum(["proportional", "fixed"]),
    isCritical: z.boolean(),
  })
  .strict();

const ReadingSchema = z
  .object({ name: str(120), kind: z.enum(["number", "yesno", "text"]), unit: str(20), min: str(30), max: str(30), target: str(30), code: str(40), required: z.boolean() })
  .strict();

const StepSchema = z
  .object({
    block: z.enum(RECIPE_BLOCKS.map((b) => b.key) as [RecipeBlockKey, ...RecipeBlockKey[]]),
    stepKind: z.enum(STEP_KINDS),
    name: str(120),
    instruction: str(2000),
    needsCheck: z.boolean(),
    waitAmount: str(20),
    waitUnit: z.enum(WAIT_UNITS),
    area: z.union([z.enum(AREAS), z.literal("")]),
    checklist: z.array(z.object({ text: str(300), requiresPhoto: z.boolean(), isBlocking: z.boolean() }).strict()).max(40),
    readings: z.array(ReadingSchema).max(30),
    keep: z
      .object({ code: str(40).nullable(), workInstructionRevisionId: uuid.nullable(), blocksUntilComplete: z.boolean(), requiresEquipment: z.boolean(), equipmentKind: str(40).nullable() })
      .strict(),
  })
  .strict();

const PackagingSchema = z
  .object({
    materialId: uuid,
    perPiece: str(30),
    from: z.object({ qty: str(30), pieces: str(30) }).strict().nullable(),
    keep: z
      .object({
        tolerancePct: str(30).nullable(),
        toleranceAbsG: str(30).nullable(),
        phaseCode: str(40).nullable(),
        scaling: z.enum(["proportional", "fixed"]),
        isCritical: z.boolean(),
        requiresChecker: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const RecipeSaveInput = z
  .object({
    productId: uuid,
    formulaId: uuid.nullable(),
    routingId: uuid.nullable(),
    batchBy: z.enum(["kg", "pcs"]).default("kg"),
    pieces: str(12).default(""),
    pieceG: str(20).default(""),
    packaging: z.array(PackagingSchema).max(20, "A recipe can have at most 20 packaging items.").default([]),
    batchKg: str(30),
    expectedPct: str(30),
    view: z.enum(["g", "pct"]),
    lines: z.array(LineSchema).max(200, "A recipe can have at most 200 ingredients."),
    steps: z.array(StepSchema).max(60, "A recipe can have at most 60 steps."),
    changeSummary: str(1000),
    useFrom: str(10),
    formulaNotes: str(2000),
    routingNotes: str(2000),
    submit: z.boolean().default(false),
    activateProduct: z.boolean().default(false),
  })
  .strict();
/** What the wizard sends (the schema above checks every field again). */
export type RecipeSaveInput = RecipeDraft & { submit?: boolean; activateProduct?: boolean };

/** Field names of the services → field names of the wizard. */
const FIELD_MAP: Record<string, string> = { referenceBatchSizeG: "batchKg", theoreticalYieldPct: "expectedPct", effectiveFrom: "useFrom", notes: "formulaNotes" };
function renameFields(e: unknown, part: "formula" | "routing"): unknown {
  if (!(e instanceof DomainError)) return e;
  const fe = e.details?.fieldErrors as FieldErrors | undefined;
  if (!fe) return e;
  const out: FieldErrors = {};
  for (const [k, v] of Object.entries(fe)) out[part === "routing" && k === "notes" ? "routingNotes" : (FIELD_MAP[k] ?? k)] = v;
  return new DomainError(e.code, e.message, { ...e.details, fieldErrors: out });
}

/**
 * Checks the wizard's own promises and turns the input into the exact service payloads (without
 * revision ids), validated with the services' own schemas. Throws one validation error with every
 * field message found.
 */
export function prepareRecipe(v: z.output<typeof RecipeSaveInput>, opts: { pieceG?: string | null } = {}) {
  const fe: FieldErrors = {};
  const expected = v.expectedPct.trim();
  const expectedOk = isDecimalText(expected, 2) && new Decimal(expected).gt(0) && new Decimal(expected).lte(100);
  if (!expectedOk) fe.expectedPct = "Type a number above 0 and at most 100, like 95.";
  // ADR-088 §4: by pieces, the batch size is worked out (pieces × grams per piece ÷ expected %) and
  // stored in the formula's one base, kilograms / grams. The weight per piece comes from the product.
  const pieceG = opts.pieceG ?? null;
  const needsPieceG = v.batchBy === "pcs" || v.packaging.length > 0;
  if (needsPieceG && !isPieceGText(pieceG)) fe.pieceG = "Type how heavy one piece is, in grams, like 135.";
  let batchKg = v.batchKg.trim();
  if (v.batchBy === "pcs") {
    if (!isPiecesText(v.pieces)) fe.pieces = "Type how many pieces one batch makes, as a whole number, like 70.";
    else if (expectedOk && isPieceGText(pieceG)) batchKg = piecesToBatchKg(v.pieces, pieceG, expected)!;
  } else if (!isDecimalText(batchKg, BATCH_KG_DECIMALS) || new Decimal(batchKg).lte(0)) fe.batchKg = `Type how many kilograms one batch makes, like 17.6 (at most ${BATCH_KG_DECIMALS} decimals).`;
  const pieces = fe.pieces || fe.pieceG || fe.batchKg || fe.expectedPct ? "0" : draftPieces({ ...v, batchKg }, pieceG);
  v.packaging.forEach((p, i) => {
    const t = p.perPiece.trim();
    if (p.from ? !isDecimalText(p.from.qty, 6) || !isDecimalText(p.from.pieces, 6) : !isDecimalText(t, PER_PIECE_DECIMALS) || new Decimal(t).lte(0)) {
      fe[`packaging.${i}.perPiece`] = `Type how many go on one piece, like 1 (at most ${PER_PIECE_DECIMALS} decimals).`;
    }
  });
  if (v.packaging.length && pieces === "0" && !fe.pieceG && !fe.pieces && !fe.batchKg) fe.packaging = "One batch makes less than one piece, so the packaging can't be worked out. Check the batch size.";
  v.lines.forEach((l, i) => {
    const a = l.amount.trim();
    const dp = l.src === "pct" ? PERCENT_DECIMALS : GRAM_DECIMALS;
    if (!isDecimalText(a, dp) || new Decimal(a).lte(0)) fe[`lines.${i}.quantityG`] = l.src === "pct" ? `Type the percent, like 21.5 (at most ${dp} decimals).` : "Type the grams, like 3723.2.";
    const d = l.diff.trim();
    if (!isDecimalText(d, 6)) fe[`lines.${i}.tolerancePct`] = l.diffKind === "pct" ? "Type the allowed difference in percent, like 2." : "Type the allowed difference in grams, like 5.";
  });
  if (fe.batchKg === undefined && fe.pieces === undefined && fe.pieceG === undefined && isDecimalText(batchKg, BATCH_KG_DECIMALS) && v.view === "pct" && v.lines.length) {
    const t = recipeTotals(kgToGrams(batchKg), v.lines);
    if (!t.exact) fe.lines = `${percentTotalText(t)}. The amounts must add up to 100%.`;
  }
  v.steps.forEach((s, i) => {
    if (s.stepKind === "curing" || s.stepKind === "hold") {
      const m = waitToMinutes(s.waitAmount, s.waitUnit);
      if (m === null) fe[`steps.${i}.minDurationMinutes`] = "Type how long to wait.";
      else if (Number.isNaN(m) || m > 100_000) fe[`steps.${i}.minDurationMinutes`] = "Type how long to wait as a whole number of minutes, hours, days or weeks (at most 69 days).";
    }
  });
  if (Object.keys(fe).length) fail(Object.values(fe)[0], fe);

  const batchG = kgToGrams(batchKg);
  const formula = {
    referenceBatchSizeG: batchG,
    theoreticalYieldPct: plain(expected),
    effectiveFrom: v.useFrom.trim() || null,
    changeSummary: v.changeSummary.trim() || null,
    notes: v.formulaNotes.trim() || null,
    // Ingredients first (weighed, in the percent total), then the packaging lines (counted in pieces,
    // material kind packaging: ADR-092 reads them as "the recipe's packaging lines").
    lines: [...toBomLineInputs(batchG, v.lines), ...toPackagingLineInputs(pieces, v.packaging)],
  };
  const nIngredients = v.lines.length;
  /** Service field keys of the packaging lines (lines.N after the ingredients) → packaging.i. */
  const renamePackaging = (e: unknown) => {
    if (!(e instanceof DomainError) || !v.packaging.length) return e;
    const fe2 = e.details?.fieldErrors as FieldErrors | undefined;
    if (!fe2) return e;
    const out: FieldErrors = {};
    for (const [k, msg] of Object.entries(fe2)) {
      const m = /^lines\.(\d+)\.(.*)$/.exec(k);
      out[m && Number(m[1]) >= nIngredients ? `packaging.${Number(m[1]) - nIngredients}.perPiece` : k] = msg;
    }
    return new DomainError(e.code, e.message, { ...e.details, fieldErrors: out });
  };
  const routing = { effectiveFrom: v.useFrom.trim() || null, changeSummary: v.changeSummary.trim() || null, notes: v.routingNotes.trim() || null, steps: toStepInputs(v.steps) };
  // The services' own schemas, before anything is written (same field keys: lines.0.quantityG, steps.2.area …).
  const probe = randomUUID();
  let f: z.output<typeof SaveFormulaDraftInput>;
  let r: z.output<typeof SaveRoutingDraftInput>;
  try {
    f = parseInput(SaveFormulaDraftInput, { revisionId: probe, ...formula });
  } catch (e) {
    throw renamePackaging(renameFields(e, "formula"));
  }
  try {
    r = parseInput(SaveRoutingDraftInput, { revisionId: probe, ...routing });
  } catch (e) {
    throw renameFields(e, "routing");
  }
  return { formula, routing, parsedFormula: f, parsedRouting: r, batchKg, pieces, renamePackaging };
}

/* ------------------------------------------------------------------ comparing content */

const p = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? null : plain(v));

function formulaCanon(x: { referenceBatchSizeG: string; theoreticalYieldPct: string; lines: { materialId: string; quantityG: string; tolerancePct: string | null; toleranceAbsG: string | null; phaseCode: string | null; scaling: string; isCritical: boolean; requiresChecker: boolean }[] }) {
  return JSON.stringify([p(x.referenceBatchSizeG), p(x.theoreticalYieldPct), x.lines.map((l) => [l.materialId, p(l.quantityG), p(l.tolerancePct), p(l.toleranceAbsG), l.phaseCode ?? null, l.scaling, l.isCritical, l.requiresChecker])]);
}

type StepLike = {
  code: string | null;
  name: string;
  stepKind: string;
  area: string | null;
  instruction: string | null;
  workInstructionRevisionId: string | null;
  requiresChecker: boolean;
  blocksUntilComplete: boolean;
  requiresEquipment: boolean;
  equipmentKind: string | null;
  minDurationMinutes: number | null;
  parameters: { code: string; name: string; valueKind: string; uom: string | null; minValue: string | null; targetValue: string | null; maxValue: string | null; isRequired: boolean }[];
  checklistItems: { text: string; requiresPhoto: boolean; isBlocking: boolean }[];
};
function routingCanon(steps: StepLike[]) {
  return JSON.stringify(
    steps.map((s) => [
      s.code ?? null,
      s.name,
      s.stepKind,
      s.area ?? null,
      s.instruction ?? null,
      s.workInstructionRevisionId ?? null,
      s.requiresChecker,
      s.blocksUntilComplete,
      s.requiresEquipment,
      s.equipmentKind ?? null,
      s.minDurationMinutes ?? null,
      s.parameters.map((x) => [x.code, x.name, x.valueKind, x.uom ?? null, p(x.minValue), p(x.targetValue), p(x.maxValue), x.isRequired]),
      s.checklistItems.map((c) => [c.text, c.requiresPhoto, c.isBlocking]),
    ]),
  );
}

async function storedFormulaCanon(revisionId: string) {
  const [rev] = await db.select().from(formulaRevisions).where(eq(formulaRevisions.id, revisionId));
  const lines = await db.select().from(bomLines).where(eq(bomLines.formulaRevisionId, revisionId)).orderBy(asc(bomLines.lineNo));
  return formulaCanon({ referenceBatchSizeG: rev.referenceBatchSizeG, theoreticalYieldPct: rev.theoreticalYieldPct, lines });
}

/* ------------------------------------------------------------------ reading the current state */

type FRev = typeof formulaRevisions.$inferSelect;
type RRev = typeof routingRevisions.$inferSelect;
const isOpen = (s: string) => s === "draft" || s === "pending_approval";

async function formulaState(ctx: AuthContext, formulaId: string) {
  const [row] = await db
    .select({ formula: formulas, product: products })
    .from(formulas)
    .innerJoin(products, eq(products.id, formulas.productId))
    .where(and(eq(formulas.id, formulaId), eq(formulas.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row) throw new DomainError("not_found", "Recipe not found.");
  const revs = await db.select().from(formulaRevisions).where(eq(formulaRevisions.formulaId, formulaId)).orderBy(desc(formulaRevisions.revisionNo));
  return { ...row, revs, ...pickRevs(revs) };
}

function pickRevs<T extends FRev | RRev>(revs: T[]) {
  const today = businessToday();
  const open = revs.find((r) => isOpen(r.status)) ?? null;
  const effective = revs.find((r) => effectiveLabel(r, today) === "effective") ?? null;
  // What a new version starts from: the same default as createFormulaRevision / createRoutingRevision.
  const base = effective ?? revs[0] ?? null;
  return { open, effective, base, current: open ?? base };
}

/** The routing that holds this product's steps: the one with an open version, else the effective one, else the first. */
async function routingState(ctx: AuthContext, productId: string, routingId: string | null) {
  const rows = await db
    .select()
    .from(routings)
    .where(and(eq(routings.organizationId, ctx.organizationId), eq(routings.productId, productId), routingId ? eq(routings.id, routingId) : undefined))
    .orderBy(asc(routings.code));
  if (routingId && !rows.length) throw new DomainError("validation", "Those steps belong to another product. Reload the page.", { fieldErrors: { steps: "Reload the page." } });
  if (!rows.length) return null;
  const revs = await db.select().from(routingRevisions).where(inArray(routingRevisions.routingId, rows.map((r) => r.id))).orderBy(desc(routingRevisions.revisionNo));
  const today = businessToday();
  const pick =
    rows.find((r) => revs.some((x) => x.routingId === r.id && isOpen(x.status))) ?? rows.find((r) => revs.some((x) => x.routingId === r.id && effectiveLabel(x, today) === "effective")) ?? rows[0];
  const mine = revs.filter((x) => x.routingId === pick.id);
  return { routing: pick, revs: mine, ...pickRevs(mine) };
}

const versionWord = (no: number, status: string) =>
  `Version ${no} (${status === "pending_approval" ? "waiting for approval" : status === "approved" ? "approved" : status === "draft" ? "draft" : status.replace(/_/g, " ")})`;

/* ------------------------------------------------------------------ commands */

export type RecipeSaveResult = {
  formulaId: string;
  routingId: string | null;
  formula: { revisionId: string; revisionNo: number; status: string; changed: boolean };
  routing: { revisionId: string; revisionNo: number; status: string; changed: boolean } | null;
  productActivated: boolean;
  message: string;
};

/**
 * Grams of one piece of a product: the product's size (net mass per unit, what Finish and the
 * packaging lines count with), else the net content in grams of its SKU with the same code, else null.
 */
async function productPieceG(organizationId: string, product: { id: string; skuCode: string; unitNetMassG: string }): Promise<string | null> {
  if (new Decimal(product.unitNetMassG || 0).gt(0)) return plain(product.unitNetMassG);
  const rows = await db
    .select({ code: skus.code, qty: skus.netContentQty })
    .from(skus)
    .innerJoin(uoms, eq(uoms.id, skus.netContentUomId))
    .where(and(eq(skus.organizationId, organizationId), eq(skus.productId, product.id), eq(uoms.code, "g"), sql`${skus.netContentQty} > 0`))
    .orderBy(asc(skus.code));
  const pick = rows.find((r) => r.code === product.skuCode) ?? rows[0];
  return pick?.qty ? plain(pick.qty) : null;
}

/**
 * Ingredients are weighed and packaging is counted: an ingredient line may not be a packaging item
 * (it would count in the percent total and be weighed) and a packaging line must be one (ADR-092).
 */
async function assertMaterialKinds(organizationId: string, v: z.output<typeof RecipeSaveInput>) {
  const ids = [...new Set([...v.lines.map((l) => l.materialId), ...v.packaging.map((p) => p.materialId)])];
  if (!ids.length) return;
  const rows = await db.select({ id: materials.id, name: materials.name, kind: materials.materialKind }).from(materials).where(and(eq(materials.organizationId, organizationId), inArray(materials.id, ids)));
  const by = new Map(rows.map((r) => [r.id, r]));
  const fe: FieldErrors = {};
  v.lines.forEach((l, i) => {
    const m = by.get(l.materialId);
    if (m?.kind === "packaging") fe[`lines.${i}.materialId`] = `${m.name} is packaging: add it under "Packaging for each piece", not as an ingredient.`;
  });
  v.packaging.forEach((p, i) => {
    const m = by.get(p.materialId);
    if (!m) fe[`packaging.${i}.materialId`] = "Choose a packaging item from the list.";
    else if (m.kind !== "packaging") fe[`packaging.${i}.materialId`] = `${m.name} is not a packaging item. Choose a wrapper, label, bottle or box.`;
  });
  if (Object.keys(fe).length) fail(Object.values(fe)[0], fe);
}

/**
 * Saves the wizard: product → formula draft (ingredients) → routing draft (steps), then optionally
 * sends both for approval. A part that has not changed since its approved version is left alone
 * (no needless new version); a part with an open draft is saved into it; otherwise a new version is
 * started from the current one with the existing create-revision command.
 */
export async function saveRecipe(ctx: AuthContext, raw: unknown): Promise<RecipeSaveResult> {
  const v = parseInput(RecipeSaveInput, raw);
  // Each service checks again; checking here first means nothing is written for a person who cannot finish.
  ctx.require("masterdata.formula.edit");
  ctx.require("masterdata.routing.edit");
  if (v.submit) {
    ctx.require("masterdata.formula.submit");
    ctx.require("masterdata.routing.submit");
  }
  if (v.activateProduct) ctx.require("masterdata.product.edit");

  const [product] = await db.select().from(products).where(and(eq(products.id, v.productId), eq(products.organizationId, ctx.organizationId))).limit(1);
  if (!product) throw new DomainError("not_found", "Product not found.");

  // ADR-088 §4: the weight of one piece comes from the product (or its SKU's net content). When it has
  // none, the person types it once and it is saved to the product with the existing product command.
  const storedPieceG = await productPieceG(ctx.organizationId, product);
  const typedPieceG = v.pieceG.trim();
  const usesPieces = v.batchBy === "pcs" || v.packaging.length > 0;
  const savePieceG = !storedPieceG && usesPieces && isPieceGText(typedPieceG);
  if (savePieceG && !ctx.can("masterdata.product.edit")) {
    fail(`${product.name} has no weight per piece yet, and your role can't change products. Ask someone who can edit products to type its size (grams) under Products, or type the batch size in kilograms.`, {
      pieceG: "Your role can't save this to the product.",
    });
  }
  const prep = prepareRecipe(v, { pieceG: storedPieceG ?? (savePieceG ? typedPieceG : null) });
  await assertMaterialKinds(ctx.organizationId, v);

  // ---- plan the formula part
  let fState: Awaited<ReturnType<typeof formulaState>> | null = null;
  let fPlan: "create" | "new_version" | "save_draft" | "unchanged";
  if (!v.formulaId) {
    const [other] = await db.select({ id: formulas.id }).from(formulas).where(and(eq(formulas.organizationId, ctx.organizationId), eq(formulas.productId, product.id))).limit(1);
    if (other) {
      throw new DomainError("conflict", `${product.name} already has a recipe. Open it from the recipe list and choose "Make a new version".`, { fieldErrors: { productId: "This product already has a recipe." }, formulaId: other.id });
    }
    fPlan = "create";
  } else {
    fState = await formulaState(ctx, v.formulaId);
    if (fState.formula.productId !== product.id) fail("This recipe belongs to another product. Reload the page.", { productId: "Reload the page." });
    const changed = !fState.current || (await storedFormulaCanon(fState.current.id)) !== formulaCanon(prep.parsedFormula);
    if (fState.open?.status === "draft") fPlan = "save_draft";
    else if (fState.open?.status === "pending_approval") {
      if (changed) throw new DomainError("state", `The ingredients (${versionWord(fState.open.revisionNo, fState.open.status).toLowerCase()}) are waiting for approval and can't be changed now.`, { fieldErrors: { lines: "Waiting for approval." } });
      fPlan = "unchanged";
    } else fPlan = changed ? "new_version" : "unchanged";
  }

  // ---- plan the routing part
  const rState = await routingState(ctx, product.id, v.routingId);
  let rPlan: "create" | "new_version" | "save_draft" | "unchanged";
  if (!rState) rPlan = v.steps.length ? "create" : "unchanged";
  else {
    const changed = !rState.current || routingCanon(await loadRoutingSteps(db, rState.current.id)) !== routingCanon(prep.parsedRouting.steps);
    if (rState.open?.status === "draft") rPlan = "save_draft";
    else if (rState.open?.status === "pending_approval") {
      if (changed) throw new DomainError("state", `The steps (${versionWord(rState.open.revisionNo, rState.open.status).toLowerCase()}) are waiting for approval and can't be changed now.`, { fieldErrors: { steps: "Waiting for approval." } });
      rPlan = "unchanged";
    } else rPlan = changed ? "new_version" : "unchanged";
  }
  if (fPlan === "create" || fPlan === "new_version") ctx.require("masterdata.formula.create");
  if (rPlan === "create" || rPlan === "new_version") ctx.require("masterdata.routing.create");
  if (v.submit) {
    const fWillBeDraft = fPlan !== "unchanged" || fState?.open?.status === "draft";
    const rWillBeDraft = rPlan !== "unchanged" || rState?.open?.status === "draft";
    if (!fWillBeDraft && !rWillBeDraft) throw new DomainError("state", "Nothing to send: nothing changed since the approved version, or it is already waiting for approval.");
    const fe: FieldErrors = {};
    if (fWillBeDraft && !v.lines.length) fe.lines = "Add at least one ingredient.";
    if ((rWillBeDraft || !rState) && !v.steps.length) fe.steps = "Add at least one step.";
    const fNo = fPlan === "create" ? 1 : fPlan === "new_version" ? (fState!.revs[0]?.revisionNo ?? 0) + 1 : (fState?.open?.revisionNo ?? 1);
    const rNo = rPlan === "create" ? 1 : rPlan === "new_version" ? (rState!.revs[0]?.revisionNo ?? 0) + 1 : (rState?.open?.revisionNo ?? 1);
    if (((fWillBeDraft && fNo > 1) || (rWillBeDraft && rNo > 1)) && !v.changeSummary.trim()) fe.changeSummary = "Say in a few words what you changed and why.";
    if (Object.keys(fe).length) fail(Object.values(fe)[0], fe);
  }

  // ---- write through the existing services; undo what this call created when a later command fails
  const undo: (() => Promise<unknown>)[] = [];
  let formulaId = v.formulaId;
  let fRevId = fState?.open?.id ?? fState?.current?.id ?? null;
  let routingId = rState?.routing.id ?? null;
  let rRevId = rState?.open?.id ?? rState?.current?.id ?? null;
  let productActivated = false;
  try {
    if (savePieceG) {
      // A true fact about the product, kept even when a later command fails (a product's size can't go back to "none").
      await updateProduct(ctx, product.id, {
        code: product.skuCode,
        name: product.name,
        family: product.family,
        unitNetMassG: plain(typedPieceG),
        unitsPerBox: product.unitsPerBox,
        shelfLifeDays: product.shelfLifeDays,
        storageConditions: product.storageConditions,
      });
    }
    if (fPlan === "create") {
      const code = await nextCode("formulas", ctx.organizationId, "F");
      const r = await createFormula(ctx, {
        productId: product.id,
        code,
        name: product.name.slice(0, 120),
        referenceBatchSizeG: prep.formula.referenceBatchSizeG,
        theoreticalYieldPct: prep.formula.theoreticalYieldPct,
        changeSummary: prep.formula.changeSummary,
      });
      undo.push(() => deleteFormulaDraft(ctx, r.revisionId));
      formulaId = r.formulaId;
      fRevId = r.revisionId;
    } else if (fPlan === "new_version") {
      const r = await createFormulaRevision(ctx, { formulaId: fState!.formula.id, baseRevisionId: fState!.base?.id ?? null });
      undo.push(() => deleteFormulaDraft(ctx, r.revisionId));
      fRevId = r.revisionId;
    }
    if (fPlan !== "unchanged") {
      try {
        await saveFormulaRevisionDraft(ctx, { revisionId: fRevId, ...prep.formula });
      } catch (e) {
        throw prep.renamePackaging(renameFields(e, "formula"));
      }
    }

    if (rPlan === "create") {
      const code = await nextCode("routings", ctx.organizationId, "R");
      const r = await createRouting(ctx, { productId: product.id, code, name: `Steps for ${product.name}`.slice(0, 120), changeSummary: prep.routing.changeSummary });
      undo.push(() => deleteRoutingDraft(ctx, r.revisionId));
      routingId = r.routingId;
      rRevId = r.revisionId;
    } else if (rPlan === "new_version") {
      const r = await createRoutingRevision(ctx, { routingId: rState!.routing.id, baseRevisionId: rState!.base?.id ?? null });
      undo.push(() => deleteRoutingDraft(ctx, r.revisionId));
      rRevId = r.revisionId;
    }
    if (rPlan !== "unchanged") {
      try {
        await saveRoutingRevisionDraft(ctx, { revisionId: rRevId, ...prep.routing });
      } catch (e) {
        throw renameFields(e, "routing");
      }
    }

    if (v.submit) {
      const [fr] = await db.select().from(formulaRevisions).where(eq(formulaRevisions.id, fRevId!));
      if (fr.status === "draft") {
        await submitFormulaRevision(ctx, fr.id);
        undo.push(() => withdrawFormulaRevision(ctx, fr.id));
      }
      if (rRevId) {
        const [rr] = await db.select().from(routingRevisions).where(eq(routingRevisions.id, rRevId));
        if (rr.status === "draft") {
          await submitRoutingRevision(ctx, rr.id);
          undo.push(() => withdrawRoutingRevision(ctx, rr.id));
        }
      }
    }
    if (v.activateProduct && product.status === "draft") {
      await changeProductStatus(ctx, { id: product.id, status: "active", reason: "Made active from the step-by-step recipe" });
      productActivated = true;
    }
  } catch (e) {
    for (const u of undo.reverse()) {
      try {
        await u();
      } catch {
        // Best effort: the error the person sees is the original one.
      }
    }
    throw e;
  }

  const [fr] = await db.select().from(formulaRevisions).where(eq(formulaRevisions.id, fRevId!));
  const rr = rRevId ? (await db.select().from(routingRevisions).where(eq(routingRevisions.id, rRevId)))[0] : null;
  const sent = v.submit;
  const message = sent
    ? `Sent for approval: recipe ${versionWord(fr.revisionNo, fr.status).toLowerCase()}${rr ? `, steps ${versionWord(rr.revisionNo, rr.status).toLowerCase()}` : ""}.`
    : fPlan === "unchanged" && rPlan === "unchanged"
      ? "Nothing changed, so nothing was saved."
      : `Saved as a draft: ${versionWord(fr.revisionNo, fr.status)}.`;
  return {
    formulaId: formulaId!,
    routingId,
    formula: { revisionId: fr.id, revisionNo: fr.revisionNo, status: fr.status, changed: fPlan !== "unchanged" },
    routing: rr ? { revisionId: rr.id, revisionNo: rr.revisionNo, status: rr.status, changed: rPlan !== "unchanged" } : null,
    productActivated,
    message: productActivated ? `${message} The product is now active.` : message,
  };
}

const RecipeProductInput = z
  .object({
    name: z.string().trim().min(1, "Type the product name.").max(160),
    sizeG: z.string().trim(),
    family: z.string().trim().min(1, "Choose what kind of product it is."),
    unitsPerBox: z.string().trim(),
    shelfLifeMonths: z.string().trim(),
  })
  .strict();

/** Shelf life months → days (A-RW-01); one rule, shared with the product form (products-shelf-life.ts). */
export { monthsToDays };

/**
 * "Make a new product" inside the wizard, in one go with the existing services: the product (code
 * assigned), its sellable item (SKU with the same code, counted in pieces) and both made active —
 * each part only when the person holds that permission. What they may not do is listed in `notes`
 * in plain words (someone else finishes it); nothing is faked. When the SKU cannot be made the new
 * product is removed again (never-used draft, ADR-075).
 */
export async function createRecipeProduct(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.product.create");
  const v = parseInput(RecipeProductInput, raw);
  const fe: FieldErrors = {};
  if (!isDecimalText(v.sizeG, 3) || Number(v.sizeG) <= 0) fe.sizeG = "Type the size in grams, like 135.";
  const box = Number(v.unitsPerBox);
  if (!Number.isInteger(box) || box < 1 || box > 100000) fe.unitsPerBox = "Type how many go in one box, like 48.";
  const months = Number(v.shelfLifeMonths);
  if (!Number.isInteger(months) || months < 1 || months > 120) fe.shelfLifeMonths = "Type the months it stays good, like 24.";
  if (Object.keys(fe).length) fail(Object.values(fe)[0], fe);
  const days = monthsToDays(months);
  const p = await createProduct(ctx, { code: null, name: v.name, family: v.family, unitNetMassG: v.sizeG, unitsPerBox: box, shelfLifeDays: days });
  const notes: string[] = [];
  let skuId: string | null = null;
  try {
    if (ctx.can("masterdata.sku.create")) {
      const unit = await db.select({ id: uoms.id, code: uoms.code }).from(uoms).where(and(eq(uoms.organizationId, ctx.organizationId), inArray(uoms.code, ["pcs", "g"])));
      const pcs = unit.find((u) => u.code === "pcs");
      const g = unit.find((u) => u.code === "g");
      if (!pcs) throw new DomainError("validation", "The unit pcs is missing in Units of measure; add it first.");
      const sku = await createSku(ctx, { productId: p.id, code: p.code, name: p.name, uomBaseId: pcs.id, unitsPerBox: box, shelfLifeDays: days, netContentQty: v.sizeG, netContentUomId: g?.id ?? null });
      skuId = sku.id;
    } else notes.push("Someone who can add sellable items (SKUs) must add one for this product before it can be sold.");
  } catch (e) {
    try {
      await deleteProduct(ctx, p.id);
    } catch {
      // the original error is the one that matters
    }
    throw e;
  }
  let status = p.status;
  if (ctx.can("masterdata.product.edit")) {
    await changeProductStatus(ctx, { id: p.id, status: "active", reason: "Made in the step-by-step recipe" });
    status = "active";
    if (skuId && ctx.can("masterdata.sku.edit")) await changeSkuStatus(ctx, { id: skuId, status: "active", reason: "Made in the step-by-step recipe" });
    else if (skuId) notes.push("Someone who can edit sellable items must make its SKU active.");
  } else notes.push("The product is a draft: someone who can edit products must make it active before it can be made or sold.");
  return { id: p.id, name: p.name, code: p.code, family: p.family, unitNetMassG: p.unitNetMassG, status, notes };
}

/** "Add a new ingredient" inside the wizard: the existing createMaterial (raw material, weighed in grams, active). */
export async function createRecipeIngredient(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.material.create");
  const v = parseInput(z.object({ name: z.string().trim().min(1, "Type the ingredient name.").max(200), inciName: z.string().trim().max(300).optional() }).strict(), raw);
  const m = await createMaterial(ctx, { code: null, name: v.name, inciName: v.inciName || null, materialKind: "raw_material", baseUom: "g", status: "active" });
  return { id: m.id, code: m.code, name: m.name, kind: m.materialKind, baseUom: m.baseUom, status: m.status };
}

/**
 * "Add a new packaging item" inside the wizard (wrapper, label, bottle, box): the existing
 * createMaterial with kind packaging, counted in pieces, active (ADR-092 reads it as packaging).
 */
export async function createRecipePackaging(ctx: AuthContext, raw: unknown) {
  ctx.require("masterdata.material.create");
  const v = parseInput(z.object({ name: z.string().trim().min(1, "Type the name, like Soap wrapper 135 g.").max(200) }).strict(), raw);
  const m = await createMaterial(ctx, { code: null, name: v.name, inciName: null, materialKind: "packaging", baseUom: "pcs", status: "active" });
  return { id: m.id, code: m.code, name: m.name, kind: m.materialKind, baseUom: m.baseUom, status: m.status };
}

/* ------------------------------------------------------------------ queries */

/** Choices for the wizard: products, ingredients, product kinds, recipes to copy from, starting values. */
export async function recipeWizardOptions(ctx: AuthContext) {
  requireAny(ctx, ["masterdata.formula.create", "masterdata.formula.edit"]);
  const O = ctx.organizationId;
  const [prods, mats, families, recipeRows, diff, weighCheck] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        code: products.skuCode,
        family: products.family,
        unitNetMassG: products.unitNetMassG,
        pieceG: sql<string | null>`case when "products"."unit_net_mass_g" > 0 then "products"."unit_net_mass_g"::text else (select s.net_content_qty::text from ${skus} s join ${uoms} u on u.id = s.net_content_uom_id where s.product_id = "products"."id" and u.code = 'g' and s.net_content_qty > 0 order by (s.code = "products"."sku_code") desc, s.code limit 1) end`,
        status: products.status,
        formulaId: sql<string | null>`(select f.id from ${formulas} f where f.product_id = ${products.id} order by f.code limit 1)`,
      })
      .from(products)
      .where(and(eq(products.organizationId, O), sql`${products.status} <> 'discontinued'`))
      .orderBy(asc(products.name)),
    db
      .select({ id: materials.id, code: materials.code, name: materials.name, kind: materials.materialKind, baseUom: materials.baseUom, status: materials.status })
      .from(materials)
      .where(and(eq(materials.organizationId, O), inArray(materials.status, ["active", "draft"])))
      .orderBy(asc(materials.name)),
    productFamilies(db, O),
    db
      .select({ formulaId: formulas.id, code: formulas.code, productName: products.name })
      .from(formulas)
      .innerJoin(products, eq(products.id, formulas.productId))
      .where(and(eq(formulas.organizationId, O), sql`exists (select 1 from ${formulaRevisions} r where r.formula_id = ${formulas.id} and r.status in ('approved','draft','pending_approval'))`))
      .orderBy(asc(products.name)),
    getSetting(db, O, "masterdata.recipe.default_allowed_difference_pct"),
    getSetting(db, O, "production.weighing.second_person_check", ctx.currentSiteId),
  ]);
  return {
    products: prods.map((p) => ({ ...p, pieceG: p.pieceG ? plain(p.pieceG) : null })),
    materials: mats,
    families: families.map((f) => ({ code: f.value, label: f.label })),
    copySources: ctx.can("masterdata.routing.view") ? recipeRows : [],
    defaultDiffPct: String(diff),
    weighCheck: weighCheck as "all" | "marked" | "none",
    today: businessToday(),
    can: {
      create: ctx.can("masterdata.formula.create") && ctx.can("masterdata.routing.create"),
      edit: ctx.can("masterdata.formula.edit") && ctx.can("masterdata.routing.edit"),
      submit: ctx.can("masterdata.formula.submit") && ctx.can("masterdata.routing.submit"),
      createProduct: ctx.can("masterdata.product.create"),
      createMaterial: ctx.can("masterdata.material.create"),
      activateProduct: ctx.can("masterdata.product.edit"),
      /** Save a missing weight per piece to the product (ADR-088 §4). */
      editProduct: ctx.can("masterdata.product.edit"),
    },
  };
}
export type RecipeWizardOptions = Awaited<ReturnType<typeof recipeWizardOptions>>;

type RevInfo = { id: string; no: number; status: string } | null;
const info = (r: FRev | RRev | null): RevInfo => (r ? { id: r.id, no: r.revisionNo, status: r.status } : null);

/**
 * A recipe as the wizard shows it: the open version when there is one, else the current one
 * (effective, else the latest), with what may be changed.
 */
export async function getRecipe(ctx: AuthContext, formulaId: string) {
  ctx.require("masterdata.formula.view");
  ctx.require("masterdata.routing.view");
  if (!z.string().uuid().safeParse(formulaId).success) return null;
  let f: Awaited<ReturnType<typeof formulaState>>;
  try {
    f = await formulaState(ctx, formulaId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return null;
    throw e;
  }
  const r = await routingState(ctx, f.product.id, null);
  const fCur = f.current;
  const rCur = r?.current ?? null;
  const lines = fCur ? await db.select().from(bomLines).where(eq(bomLines.formulaRevisionId, fCur.id)).orderBy(asc(bomLines.lineNo)) : [];
  const steps = rCur ? await loadRoutingSteps(db, rCur.id) : [];
  const lineMats = lines.length ? await db.select({ id: materials.id, name: materials.name, kind: materials.materialKind }).from(materials).where(inArray(materials.id, [...new Set(lines.map((l) => l.materialId))])) : [];
  const kindOf = new Map(lineMats.map((m) => [m.id, m.kind]));
  // ADR-092: packaging lines (material kind packaging) are shown apart, per piece, never in the percent total.
  const ingredientRows = lines.filter((l) => kindOf.get(l.materialId) !== "packaging");
  const packagingRows = lines.filter((l) => kindOf.get(l.materialId) === "packaging");
  const pieceG = await productPieceG(ctx.organizationId, f.product);
  // ADR-088 §4: a batch size that is exactly "N pieces" is shown back as N pieces.
  const shownPieces = fCur ? detectPieces(fCur.referenceBatchSizeG, plain(fCur.theoreticalYieldPct), pieceG) : null;
  const batchPieces = fCur ? piecesFromBatch(fCur.referenceBatchSizeG, fCur.theoreticalYieldPct, pieceG) : "0";
  const draft: RecipeDraft = {
    productId: f.product.id,
    formulaId: f.formula.id,
    routingId: r?.routing.id ?? null,
    batchBy: shownPieces ? "pcs" : "kg",
    pieces: shownPieces ?? "",
    pieceG: "",
    batchKg: fCur ? gramsToKg(fCur.referenceBatchSizeG) : "",
    expectedPct: fCur ? plain(fCur.theoreticalYieldPct) : "100",
    view: "g",
    lines: fromBomLines(ingredientRows),
    packaging: fromPackagingLines(packagingRows, batchPieces),
    steps: fromRoutingSteps(steps),
    changeSummary: f.open?.status === "draft" ? (f.open.changeSummary ?? "") : r?.open?.status === "draft" ? (r.open.changeSummary ?? "") : "",
    useFrom: (f.open?.status === "draft" ? f.open.effectiveFrom : null) ?? (r?.open?.status === "draft" ? r.open.effectiveFrom : null) ?? "",
    formulaNotes: fCur?.notes ?? "",
    routingNotes: rCur?.notes ?? "",
  };
  const approvalPolicy = (await loadApprovalPolicy(db, ctx.organizationId, "formula_revision")).map((x) => ({ step: x.step, roles: x.roles }));
  const fPending = f.open?.status === "pending_approval";
  const rPending = r?.open?.status === "pending_approval";
  const anyDraft = f.open?.status === "draft" || r?.open?.status === "draft";
  return {
    formula: { id: f.formula.id, code: f.formula.code, name: f.formula.name },
    product: { id: f.product.id, name: f.product.name, code: f.product.skuCode, family: f.product.family, unitNetMassG: f.product.unitNetMassG, pieceG, status: f.product.status },
    routing: r ? { id: r.routing.id, code: r.routing.code } : null,
    versions: {
      formula: { open: info(f.open), effective: info(f.effective), current: info(fCur), next: (f.revs[0]?.revisionNo ?? 0) + 1 },
      routing: r ? { open: info(r.open), effective: info(r.effective), current: info(rCur), next: (r.revs[0]?.revisionNo ?? 0) + 1 } : null,
    },
    /** draft: something can be edited now; waiting: everything open is waiting for approval; approved: nothing open. */
    mode: anyDraft ? "draft" : fPending || rPending ? "waiting" : "approved",
    approvalPolicy,
    locks: { ingredients: fPending, steps: !!rPending },
    draft,
    materialNames: Object.fromEntries(lineMats.map((m) => [m.id, m.name])),
    can: {
      edit: ctx.can("masterdata.formula.edit") && ctx.can("masterdata.routing.edit"),
      newVersion: ctx.can("masterdata.formula.create") && ctx.can("masterdata.routing.create"),
    },
  } as const;
}
export type RecipeView = NonNullable<Awaited<ReturnType<typeof getRecipe>>>;

/** "Copy from another recipe": its ingredients and steps as a fresh wizard draft (nothing is written). */
export async function getRecipeCopy(ctx: AuthContext, formulaId: string) {
  const r = await getRecipe(ctx, formulaId);
  if (!r) throw new DomainError("not_found", "Recipe not found.");
  const { batchKg, expectedPct, lines, steps } = r.draft;
  // Packaging is copied per piece (worked out again for the new product's pieces); the batch size by weight.
  const packaging = (r.draft.packaging ?? []).filter((p) => p.perPiece).map((p) => ({ ...p, from: null }));
  return { from: `${r.product.name} (${r.formula.code})`, batchKg, expectedPct, lines, steps, packaging };
}

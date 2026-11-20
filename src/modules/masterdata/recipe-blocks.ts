import Decimal from "decimal.js";
import { type AddMethod, type RecordBy, type RoundingRule, isAddMethod, readSpec, stockToUnits, unitsToStock } from "./add-methods";

/**
 * Guided "New recipe" wizard (ADR-089): the pure part shared by the browser and the server.
 *
 * A recipe is a formula revision (ingredients) plus a routing revision (steps) of one product. The
 * wizard never stores anything itself: these helpers turn what the person typed into the exact
 * inputs of the existing services (`saveFormulaRevisionDraft`, `saveRoutingRevisionDraft`) and back,
 * so every save keeps going through the same validation, permissions, audit and approval path.
 *
 * Quantities are decimal strings (ADR-010). Percent ↔ grams uses decimal.js only:
 *   grams   = batch grams × percent ÷ 100     (exact: a finite decimal times a finite decimal)
 *   percent = grams ÷ batch grams × 100       (shown rounded to 4 decimals; never stored)
 * Every line remembers which number was typed (`src`), so switching the view back and forth never
 * changes a typed value.
 */

const Dx = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
type Num = Decimal.Value;
/** A decimal as a plain string (no exponent, no trailing zeros). */
export function plain(v: Num): string {
  const d = new Dx(v);
  return d.isZero() ? "0" : d.toFixed();
}

/** True when `v` is a non-negative number with at most `dp` decimals ("12", "12.5", ".5" not allowed). */
export function isDecimalText(v: string, dp: number): boolean {
  return new RegExp(`^\\d{1,12}(\\.\\d{1,${dp}})?$`).test(v.trim());
}

/* ------------------------------------------------------------------ ingredients */

export const BATCH_KG_DECIMALS = 3;
export const PERCENT_DECIMALS = 4;
export const GRAM_DECIMALS = 6;

/** Batch size typed in kg → grams (exact). */
export function kgToGrams(kg: string): string {
  return plain(new Dx(kg.trim() || "0").mul(1000));
}
export function gramsToKg(g: Num): string {
  return plain(new Dx(g).div(1000));
}

/** Grams of a line typed as a share of the batch (exact). */
export function gramsFromPercent(batchG: Num, pct: Num): string {
  return plain(new Dx(batchG).mul(pct).div(100));
}

/** Share of the batch of a line typed in grams, rounded to `dp` decimals for showing (0 when there is no batch size). */
export function percentFromGrams(batchG: Num, g: Num, dp = PERCENT_DECIMALS): string {
  const b = new Dx(batchG);
  if (b.lte(0)) return "0";
  return plain(new Dx(g).div(b).mul(100).toDecimalPlaces(dp));
}

export type AmountUnit = "g" | "pct";

export type RecipeLineDraft = {
  materialId: string;
  /** The number the person typed, in `src` units. */
  amount: string;
  src: AmountUnit;
  /** "Allowed difference": a percentage of the amount, grams, or (ADR-137) units of the method (sachets, mL, scoops). */
  diffKind: "pct" | "g" | "units";
  diff: string;
  /** "Needs a second person to check the weighing" (bom_lines.requires_checker; used when the company checks marked lines, ADR-080 §4). */
  needsCheck: boolean;
  /** Phase (oils, water part …), shown in "More". */
  phaseCode: string | null;
  scaling: "proportional" | "fixed" | "proportional_round";
  isCritical: boolean;
  /** ADR-104 §1b: approved alternatives of the line, kept as they were (edited in the advanced line editor). */
  alternatives?: { materialId: string; ratio: string; notes: string | null }[];
  /* ADR-137 "How is it added?" (absent = weigh). */
  method?: AddMethod;
  /** Units typed: how many sachets, mL, containers or own units. */
  methodQty?: string;
  /** The material unit version (pack or mL) the line uses. */
  unitId?: string | null;
  /** Own way: its name, its unit word and how much one unit is in the stock unit ("" = not measured). */
  customName?: string;
  customUnit?: string;
  customUnitQty?: string;
  /** proportional_round: up | down | nearest. */
  rounding?: RoundingRule | "";
  /** As needed: how the amount is recorded, the reading that says enough, and the most that may be added. */
  recordBy?: RecordBy;
  readingName?: string;
  readingUnit?: string;
  readingMin?: string;
  readingMax?: string;
  maxAmount?: string;
  /** A short how-to for the operator. */
  note?: string;
};

/** Stock units in one unit, by material unit id (the wizard's options; the server loads the real ones). */
export type UnitSizes = Record<string, string>;

export const methodOf = (l: Pick<RecipeLineDraft, "method">): AddMethod => l.method ?? "weigh";

/** The line is typed in units (count, volume, whole container, measured own way, as needed by count/volume). */
export function lineInUnits(l: Partial<RecipeLineDraft>): boolean {
  const m = l.method ?? "weigh";
  if (m === "count" || m === "volume" || m === "whole_container") return true;
  if (m === "custom") return isDecimalText(l.customUnitQty ?? "", 6) && new Dx((l.customUnitQty ?? "").trim() || "0").gt(0);
  if (m === "as_needed") return l.recordBy === "count" || l.recordBy === "volume";
  return false;
}

/** Stock units in one unit of the line (its material unit, or its own measured unit); null when unknown. */
export function linePerUnit(l: Partial<RecipeLineDraft>, units: UnitSizes = {}): string | null {
  if (l.method === "custom") return lineInUnits(l) ? plain((l.customUnitQty ?? "").trim()) : null;
  return l.unitId ? (units[l.unitId] ?? null) : null;
}

/** As-needed lines are added "until it is right": not part of the percent total (like packaging). */
export const inTotal = (l: Pick<RecipeLineDraft, "method">) => methodOf(l) !== "as_needed";

/** Grams (stock units) of one line for a batch size (exact). Empty or invalid amounts count as 0. */
export function lineGrams(batchG: Num, l: Pick<RecipeLineDraft, "amount" | "src"> & Partial<RecipeLineDraft>, units: UnitSizes = {}): string {
  if (l.method && l.method !== "weigh" && lineInUnits(l)) {
    const per = linePerUnit(l, units);
    const q = (l.methodQty ?? "").trim();
    if (!per || !isDecimalText(q, GRAM_DECIMALS)) return "0";
    return plain(unitsToStock(q, per));
  }
  const a = l.amount.trim();
  if (!isDecimalText(a, GRAM_DECIMALS)) return "0";
  return l.src === "g" ? plain(a) : gramsFromPercent(batchG, a);
}

/** What a line shows in the chosen view: the typed number when the view matches, else the converted one. */
export function lineShown(batchG: Num, l: Pick<RecipeLineDraft, "amount" | "src">, view: AmountUnit): string {
  if (l.src === view) return l.amount;
  const a = l.amount.trim();
  if (!isDecimalText(a, GRAM_DECIMALS)) return "";
  return view === "g" ? gramsFromPercent(batchG, a) : percentFromGrams(batchG, a);
}

export type RecipeTotals = { totalG: string; batchG: string; totalPct: string; gapPct: string; gapG: string; exact: boolean };

/** Totals of the ingredient lines against the batch size (exact in grams; percent shown to 4 decimals). As-needed lines are left out. */
export function recipeTotals(batchG: Num, lines: (Pick<RecipeLineDraft, "amount" | "src"> & Partial<RecipeLineDraft>)[], units: UnitSizes = {}): RecipeTotals {
  const b = new Dx(batchG);
  const total = lines.filter((l) => inTotal(l)).reduce((acc, l) => acc.plus(lineGrams(b, l, units)), new Dx(0));
  const pct = b.gt(0) ? total.div(b).mul(100) : new Dx(0);
  return {
    totalG: plain(total),
    batchG: plain(b),
    totalPct: plain(pct.toDecimalPlaces(PERCENT_DECIMALS)),
    gapPct: plain(new Dx(100).minus(pct).toDecimalPlaces(PERCENT_DECIMALS)),
    gapG: plain(b.minus(total)),
    exact: b.gt(0) && total.eq(b),
  };
}

const n0 = (v: string) => Number(v).toLocaleString("en-PH", { maximumFractionDigits: 6 });

/** "Total 97.5% — add 2.5% more" / "Total 101% — take away 1%" / "Total 100% — good". */
export function percentTotalText(t: RecipeTotals): string {
  const gap = new Dx(t.gapPct);
  if (t.exact) return "Total 100% — good";
  if (gap.isZero()) return `Total ${n0(t.totalPct)}% — almost: ${n0(plain(new Dx(t.gapG).abs()))} g ${new Dx(t.gapG).gt(0) ? "missing" : "too much"}`;
  return gap.gt(0) ? `Total ${n0(t.totalPct)}% — add ${n0(t.gapPct)}% more` : `Total ${n0(t.totalPct)}% — take away ${n0(plain(gap.abs()))}%`;
}

/** "Total 17,600 g of 17,600 g — good" / "… — 120 g missing" / "… — 0.1 g too much". */
export function gramsTotalText(t: RecipeTotals): string {
  const head = `Total ${n0(t.totalG)} g of ${n0(t.batchG)} g`;
  if (t.exact) return `${head} — good`;
  const gap = new Dx(t.gapG);
  return gap.gt(0) ? `${head} — ${n0(t.gapG)} g missing` : `${head} — ${n0(plain(gap.abs()))} g too much`;
}

const blankOr = (v: string | undefined | null) => (v && v.trim() ? v.trim() : null);

/**
 * Input of saveFormulaRevisionDraft for these lines (grams per reference batch, exact). ADR-137: the method fields go
 * with each line; the service works out the stock amount of a line in units from the unit's real size.
 */
export function toBomLineInputs(batchG: Num, lines: RecipeLineDraft[], units: UnitSizes = {}) {
  return lines.map((l) => {
    const method = methodOf(l);
    const inUnits = method !== "weigh" && lineInUnits(l);
    const per = linePerUnit(l, units);
    const grams = lineGrams(batchG, l, units);
    const tol =
      l.diffKind === "units" && method !== "weigh"
        ? { tolerancePct: null, toleranceAbsG: null, toleranceUnits: l.diff.trim() || null }
        : { tolerancePct: l.diffKind === "pct" ? l.diff.trim() || null : null, toleranceAbsG: l.diffKind === "g" ? l.diff.trim() || null : null, toleranceUnits: null };
    const asNeeded = method === "as_needed";
    // As needed: "at most" is typed in the same unit as the guess (grams or percent, or units for count / mL).
    const maxText = blankOr(l.maxAmount);
    const maxG = !asNeeded || !maxText || !isDecimalText(maxText, GRAM_DECIMALS) ? null : inUnits ? (per ? plain(unitsToStock(maxText, per)) : null) : l.src === "pct" ? gramsFromPercent(batchG, maxText) : plain(maxText);
    return {
      materialId: l.materialId,
      // A line in units sends a tiny placeholder until its unit is known; the service works out the real amount or names the missing field.
      quantityG: grams === "0" && inUnits ? "0.000001" : grams,
      ...(asNeeded ? { tolerancePct: null, toleranceAbsG: null, toleranceUnits: null } : tol),
      phaseCode: l.phaseCode,
      scaling: l.scaling,
      isCritical: l.isCritical,
      requiresChecker: l.needsCheck,
      addMethod: method,
      methodQty: inUnits ? blankOr(l.methodQty) : null,
      materialUnitId: method === "custom" || method === "weigh" ? null : (l.unitId ?? null),
      methodUnit: method === "custom" ? blankOr(l.customUnit) : null,
      methodUnitQty: method === "custom" && inUnits ? blankOr(l.customUnitQty) : null,
      maxQtyG: maxG,
      rounding: l.scaling === "proportional_round" ? l.rounding || null : null,
      methodSpec:
        method === "custom"
          ? { customName: (l.customName ?? "").trim() }
          : asNeeded
            ? { recordBy: l.recordBy ?? "weigh", reading: { name: (l.readingName ?? "").trim(), unit: (l.readingUnit ?? "").trim(), min: blankOr(l.readingMin), max: blankOr(l.readingMax) } }
            : null,
      operatorNote: blankOr(l.note),
      ...(l.alternatives?.length ? { alternatives: l.alternatives.map((a) => ({ materialId: a.materialId, ratio: a.ratio, notes: a.notes })) } : {}),
    };
  });
}

export type StoredLineRow = {
  materialId: string;
  quantityG: string;
  tolerancePct: string | null;
  toleranceAbsG: string | null;
  phaseCode: string | null;
  scaling: string;
  isCritical: boolean;
  requiresChecker: boolean;
  alternatives?: { materialId: string; ratio: string; notes: string | null }[];
  addMethod?: string;
  methodQty?: string | null;
  materialUnitId?: string | null;
  methodUnit?: string | null;
  methodUnitQty?: string | null;
  toleranceUnits?: string | null;
  maxQtyG?: string | null;
  rounding?: string | null;
  methodSpec?: unknown;
  operatorNote?: string | null;
};

/** Stored bom lines → wizard lines, typed in grams (or in units for a line counted or measured). */
export function fromBomLines(rows: StoredLineRow[]): RecipeLineDraft[] {
  return rows.map((r) => {
    const method: AddMethod = isAddMethod(r.addMethod) ? r.addMethod : "weigh";
    const spec = readSpec(r.methodSpec);
    const per = r.methodUnitQty ?? null;
    const unitsBack = (g: string | null | undefined) => (g === null || g === undefined || !per ? "" : plain(stockToUnits(g, per)));
    const hasUnits = r.toleranceUnits !== null && r.toleranceUnits !== undefined;
    const base: RecipeLineDraft = {
      materialId: r.materialId,
      amount: plain(r.quantityG),
      src: "g",
      diffKind: hasUnits ? "units" : r.toleranceAbsG !== null ? "g" : "pct",
      diff: hasUnits ? plain(r.toleranceUnits!) : r.toleranceAbsG !== null ? plain(r.toleranceAbsG) : r.tolerancePct !== null ? plain(r.tolerancePct) : "",
      needsCheck: r.requiresChecker,
      phaseCode: r.phaseCode,
      scaling: r.scaling === "fixed" ? "fixed" : r.scaling === "proportional_round" ? "proportional_round" : "proportional",
      isCritical: r.isCritical,
      ...(r.alternatives?.length ? { alternatives: r.alternatives.map((a) => ({ materialId: a.materialId, ratio: plain(a.ratio), notes: a.notes })) } : {}),
    };
    if (method === "weigh") return r.operatorNote ? { ...base, note: r.operatorNote } : base;
    const extra: Partial<RecipeLineDraft> = { method, unitId: r.materialUnitId ?? null, rounding: (r.rounding as RoundingRule | null) ?? "", note: r.operatorNote ?? "" };
    if (r.methodQty !== null && r.methodQty !== undefined) extra.methodQty = plain(r.methodQty);
    if (method === "custom") Object.assign(extra, { customName: spec.customName ?? "", customUnit: r.methodUnit ?? "", customUnitQty: per ? plain(per) : "" });
    if (method === "as_needed") {
      const by = spec.recordBy ?? "weigh";
      Object.assign(extra, {
        recordBy: by,
        readingName: spec.reading?.name ?? "",
        readingUnit: spec.reading?.unit ?? "",
        readingMin: spec.reading?.min ?? "",
        readingMax: spec.reading?.max ?? "",
        // The band to the maximum is stored in the stock unit; the wizard shows the guess and "at most" in the line's unit.
        diffKind: "pct",
        diff: "",
        ...(by === "weigh" ? { maxAmount: r.maxQtyG ? plain(r.maxQtyG) : "" } : { methodQty: unitsBack(r.quantityG), maxAmount: unitsBack(r.maxQtyG) }),
      });
    }
    return { ...base, ...extra };
  });
}

/* ------------------------------------------------------------------ batch by pieces (ADR-088 §4) */

/**
 * "One batch makes 70 bars of 135 g". The formula keeps its one stored base, the reference batch
 * size in grams; pieces are only another way to type it:
 *
 *   batch grams = pieces × grams per piece × 100 ÷ expected amount made (%)   rounded UP to whole grams
 *   pieces      = batch grams × expected % ÷ 100 ÷ grams per piece             rounded DOWN (as Finish)
 *
 * Rounding the batch up means the batch always makes at least the pieces asked for, and reading the
 * pieces back from the stored batch gives the same number again (so an edit shows the pieces back).
 */
export type BatchBy = "kg" | "pcs";
export const PIECE_G_DECIMALS = 3;
export const MAX_PIECES = 1_000_000;

/** A whole number of pieces from 1 to 1,000,000. */
export function isPiecesText(v: string): boolean {
  const t = v.trim();
  return /^\d{1,7}$/.test(t) && Number(t) >= 1 && Number(t) <= MAX_PIECES;
}

/** A weight per piece in grams above 0 (at most 3 decimals). */
export function isPieceGText(v: string | null | undefined): boolean {
  return !!v && isDecimalText(v, PIECE_G_DECIMALS) && new Dx(v.trim()).gt(0);
}

/** Batch grams for N pieces (whole grams, rounded up); null when an input is missing or not valid. */
export function piecesToBatchG(pieces: string, pieceG: string | null | undefined, expectedPct: string): string | null {
  if (!isPiecesText(pieces) || !isPieceGText(pieceG) || !isDecimalText(expectedPct, 2)) return null;
  const y = new Dx(expectedPct.trim());
  if (y.lte(0) || y.gt(100)) return null;
  return plain(new Dx(pieces.trim()).mul(pieceG!.trim()).mul(100).div(y).toDecimalPlaces(0, Decimal.ROUND_UP));
}

/** Same as piecesToBatchG, in kilograms (3 decimals at most, exact). */
export function piecesToBatchKg(pieces: string, pieceG: string | null | undefined, expectedPct: string): string | null {
  const g = piecesToBatchG(pieces, pieceG, expectedPct);
  return g === null ? null : gramsToKg(g);
}

/** Whole pieces one batch makes (rounded down); "0" when the weight per piece is unknown. */
export function piecesFromBatch(batchG: Num, expectedPct: Num, pieceG: Num | null | undefined): string {
  if (pieceG === null || pieceG === undefined || pieceG === "") return "0";
  const m = new Dx(pieceG);
  const b = new Dx(batchG || 0);
  if (m.lte(0) || b.lte(0)) return "0";
  return plain(b.mul(expectedPct || 0).div(100).div(m).floor());
}

/**
 * When a stored batch size is exactly what "N pieces" gives, the recipe was made by pieces: returns
 * N (shown back when editing); else null (the recipe is shown by weight).
 */
export function detectPieces(batchG: Num, expectedPct: string, pieceG: string | null | undefined): string | null {
  const n = piecesFromBatch(batchG, expectedPct, pieceG);
  if (n === "0") return null;
  const back = piecesToBatchG(n, pieceG, expectedPct);
  return back !== null && new Dx(back).eq(batchG) ? n : null;
}

/** Pieces one batch of this draft makes: the typed number when by pieces, else worked out from the weight. */
export function draftPieces(d: Pick<RecipeDraft, "batchKg" | "expectedPct"> & { batchBy?: BatchBy; pieces?: string }, pieceG: string | null | undefined): string {
  if (d.batchBy === "pcs") return isPiecesText(d.pieces ?? "") ? plain(d.pieces!.trim()) : "0";
  if (!isDecimalText(d.batchKg, BATCH_KG_DECIMALS)) return "0";
  return piecesFromBatch(kgToGrams(d.batchKg), d.expectedPct, pieceG);
}

/** "bars" for soap, else "pieces" (one word for the person; nothing is stored). */
export function pieceWord(family: string | null | undefined, n: number | string = 2): string {
  const soap = (family ?? "").toLowerCase().includes("soap");
  const one = String(n) === "1";
  return soap ? (one ? "bar" : "bars") : one ? "piece" : "pieces";
}

/* ------------------------------------------------------------------ packaging for each piece (ADR-092) */

/** Saved with a packaging line as it is (from advanced editing, or the defaults of a new line). */
export type PackagingKeep = { tolerancePct: string | null; toleranceAbsG: string | null; phaseCode: string | null; scaling: "proportional" | "fixed"; isCritical: boolean; requiresChecker: boolean };
/** A packaging line is counted, never weighed: no allowed difference, no second-person weighing check, scales with the batch. */
export const packagingKeep = (): PackagingKeep => ({ tolerancePct: "0", toleranceAbsG: null, phaseCode: null, scaling: "proportional", isCritical: false, requiresChecker: false });

export type RecipePackagingDraft = {
  materialId: string;
  /** "How many per piece" as typed (1 wrapper per bar; 0.0209 box per bar). */
  perPiece: string;
  /**
   * The stored line this came from (its quantity for `pieces` pieces), kept while the person does not
   * change "how many per piece", so opening and saving an unchanged recipe changes nothing.
   */
  from: { qty: string; pieces: string } | null;
  keep: PackagingKeep;
};
export const PER_PIECE_DECIMALS = 4;

/** Per piece shown for a stored line: quantity ÷ pieces (4 decimals). */
export function perPieceOf(qty: Num, pieces: Num): string {
  const n = new Dx(pieces);
  return n.gt(0) ? plain(new Dx(qty).div(n).toDecimalPlaces(PER_PIECE_DECIMALS)) : "";
}

/** Quantity of a packaging line for one batch of `pieces` pieces (6 decimals; the material's unit, usually pcs). */
export function packagingQty(pieces: Num, p: RecipePackagingDraft): string {
  if (p.from) {
    if (p.keep.scaling === "fixed" || new Dx(p.from.pieces).eq(pieces)) return plain(p.from.qty);
    const fp = new Dx(p.from.pieces);
    if (fp.gt(0)) return plain(new Dx(p.from.qty).mul(pieces).div(fp).toDecimalPlaces(6));
  }
  if (!isDecimalText(p.perPiece, PER_PIECE_DECIMALS)) return "0";
  return plain(new Dx(pieces).mul(p.perPiece.trim()).toDecimalPlaces(6));
}

/** Input lines of saveFormulaRevisionDraft for the packaging (after the ingredients; never in the percent total). */
export function toPackagingLineInputs(pieces: Num, list: RecipePackagingDraft[]) {
  return list.map((p) => ({
    materialId: p.materialId,
    quantityG: packagingQty(pieces, p),
    tolerancePct: p.keep.tolerancePct,
    toleranceAbsG: p.keep.toleranceAbsG,
    phaseCode: p.keep.phaseCode,
    scaling: p.keep.scaling,
    isCritical: p.keep.isCritical,
    requiresChecker: p.keep.requiresChecker,
  }));
}

/** Stored packaging lines → wizard packaging, per piece worked out from the pieces of the batch. */
export function fromPackagingLines(
  rows: { materialId: string; quantityG: string; tolerancePct: string | null; toleranceAbsG: string | null; phaseCode: string | null; scaling: string; isCritical: boolean; requiresChecker: boolean }[],
  pieces: Num,
): RecipePackagingDraft[] {
  return rows.map((r) => ({
    materialId: r.materialId,
    perPiece: perPieceOf(r.quantityG, pieces),
    from: { qty: plain(r.quantityG), pieces: plain(pieces) },
    keep: {
      tolerancePct: r.tolerancePct === null ? null : plain(r.tolerancePct),
      toleranceAbsG: r.toleranceAbsG === null ? null : plain(r.toleranceAbsG),
      phaseCode: r.phaseCode,
      scaling: r.scaling === "fixed" ? "fixed" : "proportional",
      isCritical: r.isCritical,
      requiresChecker: r.requiresChecker,
    },
  }));
}

/** "1 Soap wrapper per bar" / "0.0209 Shipping box per bar". */
export function packagingText(perPiece: string, name: string, family: string | null | undefined): string {
  const n = perPiece.trim();
  const shown = isDecimalText(n, 6) ? Number(n).toLocaleString("en-PH", { maximumFractionDigits: PER_PIECE_DECIMALS }) : "?";
  return `${shown} ${name} per ${pieceWord(family, 1)}`;
}

/* ------------------------------------------------------------------ steps */

/**
 * Ready-made step blocks and the existing routing step kind each one saves as (STEP_KINDS in
 * schemas.ts). Only kinds that exist are used; the block is not stored, it is worked out again
 * from the kind and the name when a recipe is opened (`blockFor`).
 */
export const RECIPE_BLOCKS = [
  { key: "weigh", label: "Weigh the ingredients", icon: "scale", stepKind: "dispensing", help: "Weigh every ingredient of the recipe on the scale." },
  { key: "clean", label: "Check the area is clean", icon: "sparkles", stepKind: "line_clearance", help: "Look that the room and tools are clean and nothing from the last batch is left." },
  { key: "heat", label: "Heat", icon: "flame", stepKind: "process", help: "Warm something up, for example the oils.", reading: { name: "Temperature", unit: "°C" } },
  { key: "mix", label: "Mix", icon: "blend", stepKind: "process", help: "Stir or blend until it looks right." },
  { key: "cool", label: "Cool", icon: "snowflake", stepKind: "process", help: "Let it cool down to the right temperature.", reading: { name: "Temperature", unit: "°C" } },
  { key: "add", label: "Add", icon: "circle-plus", stepKind: "process", help: "Add one group of ingredients, for example the colour and the scent." },
  { key: "pour", label: "Pour into moulds", icon: "cup-soda", stepKind: "process", help: "Pour the mix into the moulds." },
  { key: "wait", label: "Wait / cure", icon: "hourglass", stepKind: "curing", help: "Leave it alone for a set time, for example 4 weeks for soap to get hard." },
  { key: "cut", label: "Cut", icon: "scissors", stepKind: "cutting", help: "Cut the block into pieces." },
  { key: "wrap", label: "Wrap / label", icon: "package", stepKind: "packaging", help: "Wrap each piece and put the label on." },
  { key: "fill", label: "Fill bottles", icon: "milk", stepKind: "filling", help: "Fill, close and label the bottles." },
  { key: "qc", label: "Quality check", icon: "clipboard-check", stepKind: "in_process_qc", help: "Check the product during making, for example how it looks or its pH." },
  { key: "move", label: "Move to the hold area", icon: "truck", stepKind: "transfer", help: "Put the finished pieces in the hold area until the quality check passes. Done on the Finish screen." },
  // ADR-137: more ready-made blocks (each saves as an existing step kind; limits stay empty for the writer and QA).
  { key: "keep_warm", label: "Keep warm for a time", icon: "thermometer", stepKind: "hold", help: "Keep it at one temperature for a set time.", reading: { name: "Temperature", unit: "°C" } },
  { key: "homogenise", label: "Homogenise", icon: "blend", stepKind: "process", help: "Run the homogeniser at a set speed for a set time.", readings: [{ name: "Speed", unit: "rpm" }, { name: "Time", unit: "min" }] },
  { key: "look", label: "Check how it looks", icon: "eye", stepKind: "in_process_qc", help: "Look at the colour and the thickness and say if it is right.", yesno: "Looks right?" },
  { key: "sample", label: "Take a QA sample", icon: "test-tube", stepKind: "in_process_qc", help: "Take a small sample for QA and label it.", check: "Sample taken and labelled", qa: true },
  { key: "clean_tools", label: "Clean the tools", icon: "spray-can", stepKind: "process", help: "Wash the pots, mixers and tools after use.", check: "Tools washed and put away" },
  { key: "seal", label: "Close and seal", icon: "lock", stepKind: "process", help: "Close every bottle or jar and check the seal.", check: "Every cap is tight" },
  { key: "label", label: "Put on labels", icon: "tag", stepKind: "checklist", help: "Stick the labels and check they are straight and easy to read.", check: "Labels are straight and easy to read" },
  { key: "photo", label: "Take a photo", icon: "camera", stepKind: "checklist", help: "Take a photo for the record, for example of the colour.", photo: "Photo taken" },
  { key: "checklist", label: "Checklist", icon: "list-checks", stepKind: "checklist", help: "A list of things to tick, one by one." },
  { key: "custom", label: "My own step", icon: "square-pen", stepKind: "process", help: "Build your own step: give it a name, the instructions and the fields to fill in." },
  { key: "other", label: "Another step", icon: "wrench", stepKind: "process", help: "Any other job. Give it a clear name." },
] as const;
export type RecipeBlockKey = (typeof RECIPE_BLOCKS)[number]["key"];
export type RecipeBlock = (typeof RECIPE_BLOCKS)[number];
export const blockByKey = (k: string): RecipeBlock => RECIPE_BLOCKS.find((b) => b.key === k) ?? RECIPE_BLOCKS[RECIPE_BLOCKS.length - 1];

/** Plain words for each step kind (also used by "What is this?"). */
export const STEP_KIND_WORDS: Record<string, string> = {
  dispensing: "Weighing",
  line_clearance: "Clean check",
  process: "Making",
  in_process_qc: "Quality check",
  filling: "Filling",
  cutting: "Cutting",
  curing: "Curing (waiting)",
  hold: "Resting (waiting)",
  packaging: "Wrapping",
  transfer: "Moving to hold",
  reconciliation: "Counting",
  checklist: "Checklist",
};

/** The block of a stored step: by kind, and for "process" steps by the first word of the name. */
export function blockFor(stepKind: string, name: string, isCustom = false): RecipeBlockKey {
  if (isCustom) return "custom";
  const nm = name.toLowerCase();
  // ADR-137 blocks are found again by kind and name.
  if (stepKind === "hold" && /keep warm|\bhold\b/.test(nm)) return "keep_warm";
  if (stepKind === "process" && /homogeni[sz]/.test(nm)) return "homogenise";
  if (stepKind === "process" && /\bseal|\bcap\b|\bclose/.test(nm)) return "seal";
  if (stepKind === "process" && /\bclean|\bwash/.test(nm)) return "clean_tools";
  if (stepKind === "in_process_qc" && /sample/.test(nm)) return "sample";
  if (stepKind === "in_process_qc" && /\blook|appearance|colou?r/.test(nm)) return "look";
  if (stepKind === "checklist") return /photo/.test(nm) ? "photo" : /label/.test(nm) ? "label" : "checklist";
  switch (stepKind) {
    case "dispensing":
      return "weigh";
    case "line_clearance":
      return "clean";
    case "curing":
    case "hold":
      return "wait";
    case "cutting":
      return "cut";
    case "packaging":
      return "wrap";
    case "filling":
      return "fill";
    case "in_process_qc":
      return "qc";
    case "transfer":
      return "move";
    case "process": {
      const n = name.toLowerCase();
      if (/\bheat/.test(n)) return "heat";
      if (/\bcool/.test(n)) return "cool";
      if (/\bpour|\bmou?ld/.test(n)) return "pour";
      if (/^add\b/.test(n)) return "add";
      if (/\bmix|\bblend|\bstir/.test(n)) return "mix";
      return "other";
    }
    default:
      return "other";
  }
}

export const WAIT_UNITS = ["minutes", "hours", "days", "weeks"] as const;
export type WaitUnit = (typeof WAIT_UNITS)[number];
const MINUTES: Record<WaitUnit, number> = { minutes: 1, hours: 60, days: 1440, weeks: 10080 };

/** "4" weeks → 40320 minutes; null when empty; NaN when not a whole number of minutes. */
export function waitToMinutes(amount: string, unit: WaitUnit): number | null {
  const a = amount.trim();
  if (!a) return null;
  if (!isDecimalText(a, 4)) return Number.NaN;
  const m = new Dx(a).mul(MINUTES[unit]);
  return m.isInteger() && m.gt(0) ? m.toNumber() : Number.NaN;
}

/** 40320 minutes → 4 weeks; 90 → 1.5 hours; 7 → 7 minutes. */
export function minutesToWait(min: number | null | undefined): { amount: string; unit: WaitUnit } {
  if (!min) return { amount: "", unit: "days" };
  if (min % 10080 === 0) return { amount: String(min / 10080), unit: "weeks" };
  if (min % 1440 === 0) return { amount: String(min / 1440), unit: "days" };
  if (min % 15 === 0) return { amount: plain(new Dx(min).div(60)), unit: "hours" };
  return { amount: String(min), unit: "minutes" };
}

/** "4 weeks", "1 day", "90 minutes". */
export function waitText(min: number | null | undefined): string {
  if (!min) return "";
  const w = minutesToWait(min);
  const one = w.amount === "1";
  return `${w.amount} ${one ? w.unit.replace(/s$/, "") : w.unit}`;
}

export type RecipeReadingDraft = {
  name: string;
  /** number = a measured number with a unit; yesno = a yes/no answer; text = a short note; choice = one answer from a list (ADR-137). */
  kind: "number" | "yesno" | "text" | "choice";
  /** choice: the answers to choose from. */
  options?: string[];
  unit: string;
  min: string;
  max: string;
  /** Kept as they were (advanced editing only). */
  target: string;
  code: string;
  required: boolean;
};

export type RecipeChecklistItem = { text: string; requiresPhoto: boolean; isBlocking: boolean };

export type RecipeStepDraft = {
  block: RecipeBlockKey;
  /** The existing step kind it saves as (from the block; "wait" may be curing or hold; "other" keeps the stored kind). */
  stepKind: string;
  name: string;
  instruction: string;
  needsCheck: boolean;
  waitAmount: string;
  waitUnit: WaitUnit;
  /** Which room (needed by "Check the area is clean"). */
  area: string;
  checklist: RecipeChecklistItem[];
  readings: RecipeReadingDraft[];
  /** Advanced fields the wizard does not show; saved back unchanged. */
  keep: { code: string | null; workInstructionRevisionId: string | null; blocksUntilComplete: boolean; requiresEquipment: boolean; equipmentKind: string | null };
  /** ADR-137: QA must sign this step's check (also needs the second check). */
  qaSigns?: boolean;
  /** ADR-137: built in the step builder ("My own step"). */
  isCustom?: boolean;
};

export const emptyKeep = (): RecipeStepDraft["keep"] => ({ code: null, workInstructionRevisionId: null, blocksUntilComplete: true, requiresEquipment: false, equipmentKind: null });

/** A new step from a block, with the block's usual reading (empty limits). */
export function newStep(key: RecipeBlockKey): RecipeStepDraft {
  const b = blockByKey(key);
  const num = (name: string, unit: string): RecipeReadingDraft => ({ name, kind: "number", unit, min: "", max: "", target: "", code: "", required: true });
  const readings: RecipeReadingDraft[] = [];
  if ("reading" in b) readings.push(num(b.reading.name, b.reading.unit));
  if ("readings" in b) for (const r of b.readings) readings.push(num(r.name, r.unit));
  if ("yesno" in b) readings.push({ name: b.yesno, kind: "yesno", unit: "", min: "", max: "", target: "", code: "", required: true });
  const checklist: RecipeChecklistItem[] = [];
  if ("check" in b) checklist.push({ text: b.check, requiresPhoto: false, isBlocking: true });
  if ("photo" in b) checklist.push({ text: b.photo, requiresPhoto: true, isBlocking: true });
  const qa = "qa" in b && b.qa;
  return {
    block: b.key,
    stepKind: b.stepKind,
    name: b.key === "other" || b.key === "custom" || b.key === "checklist" ? "" : b.label.replace(" / ", " and "),
    instruction: "",
    // Only weighing (and a QA sample) starts with a second-person check (owner usability test); the author changes it per step.
    needsCheck: b.key === "weigh" || qa,
    waitAmount: "",
    waitUnit: b.key === "keep_warm" ? "minutes" : "days",
    area: b.key === "clean" ? "production" : "",
    checklist,
    readings,
    keep: emptyKeep(),
    ...(qa ? { qaSigns: true } : {}),
    ...(b.key === "custom" ? { isCustom: true } : {}),
  };
}

/** The parameter code made from its name ("Oil temperature" → oil_temperature), unique within the step. */
export function readingCode(name: string, i: number, taken: Set<string>): string {
  let c = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 36);
  if (!c) c = `reading_${i + 1}`;
  let out = c;
  for (let k = 2; taken.has(out); k++) out = `${c}_${k}`;
  taken.add(out);
  return out;
}

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** Input of saveRoutingRevisionDraft for these steps. */
export function toStepInputs(steps: RecipeStepDraft[]) {
  return steps.map((s) => {
    const taken = new Set<string>();
    for (const r of s.readings) if (r.code.trim()) taken.add(r.code.trim());
    const isWait = s.stepKind === "curing" || s.stepKind === "hold";
    const minutes = isWait ? waitToMinutes(s.waitAmount, s.waitUnit) : null;
    return {
      code: s.keep.code,
      name: s.name.trim(),
      stepKind: s.stepKind,
      area: blank(s.area),
      instruction: blank(s.instruction),
      workInstructionRevisionId: s.keep.workInstructionRevisionId,
      requiresChecker: s.needsCheck,
      blocksUntilComplete: s.keep.blocksUntilComplete,
      requiresEquipment: s.keep.requiresEquipment,
      equipmentKind: s.keep.equipmentKind,
      // NaN (not a whole number of minutes) is refused by the recipe service with a plain message.
      minDurationMinutes: minutes,
      parameters: s.readings.map((r, j) => {
        const numeric = r.kind === "number";
        const options = r.kind === "choice" ? (r.options ?? []).map((o) => o.trim()).filter(Boolean) : null;
        return {
          code: r.code.trim() || readingCode(r.name, j, taken),
          name: r.name.trim(),
          valueKind: numeric ? "numeric" : r.kind === "yesno" ? "boolean" : r.kind === "choice" ? "choice" : "text",
          uom: numeric ? blank(r.unit) : null,
          minValue: numeric ? blank(r.min) : null,
          targetValue: numeric ? blank(r.target) : null,
          maxValue: numeric ? blank(r.max) : null,
          isRequired: r.required,
          ...(options ? { options } : {}),
        };
      }),
      checklistItems: s.checklist.filter((c) => c.text.trim()).map((c) => ({ text: c.text.trim(), requiresPhoto: c.requiresPhoto, isBlocking: c.isBlocking })),
      // ADR-137: a QA-signed step always has the second check.
      ...(s.qaSigns ? { qaSigns: true, requiresChecker: true } : {}),
      ...(s.isCustom ? { isCustom: true } : {}),
    };
  });
}

/** Stored routing steps → wizard steps. */
export function fromRoutingSteps(
  steps: {
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
    parameters: { code: string; name: string; valueKind: string; uom: string | null; minValue: string | null; targetValue: string | null; maxValue: string | null; isRequired: boolean; options?: unknown }[];
    checklistItems: { text: string; requiresPhoto: boolean; isBlocking: boolean }[];
    qaSigns?: boolean;
    isCustom?: boolean;
  }[],
): RecipeStepDraft[] {
  return steps.map((s) => {
    const w = minutesToWait(s.minDurationMinutes);
    return {
      ...(s.qaSigns ? { qaSigns: true } : {}),
      ...(s.isCustom ? { isCustom: true } : {}),
      block: blockFor(s.stepKind, s.name, !!s.isCustom),
      stepKind: s.stepKind,
      name: s.name,
      instruction: s.instruction ?? "",
      needsCheck: s.requiresChecker,
      waitAmount: w.amount,
      waitUnit: w.unit,
      area: s.area ?? "",
      checklist: s.checklistItems.map((c) => ({ text: c.text, requiresPhoto: c.requiresPhoto, isBlocking: c.isBlocking })),
      readings: s.parameters.map((p) => ({
        name: p.name,
        kind: p.valueKind === "numeric" ? "number" : p.valueKind === "boolean" ? "yesno" : p.valueKind === "choice" ? "choice" : "text",
        ...(p.valueKind === "choice" && Array.isArray(p.options) ? { options: (p.options as unknown[]).map(String) } : {}),
        unit: p.uom ?? "",
        min: p.minValue !== null ? plain(p.minValue) : "",
        max: p.maxValue !== null ? plain(p.maxValue) : "",
        target: p.targetValue !== null ? plain(p.targetValue) : "",
        code: p.code,
        required: p.isRequired,
      })),
      keep: { code: s.code, workInstructionRevisionId: s.workInstructionRevisionId, blocksUntilComplete: s.blocksUntilComplete, requiresEquipment: s.requiresEquipment, equipmentKind: s.equipmentKind },
    };
  });
}

/** "Temperature 60–70 °C", "Temperature at least 60 °C", "pH", "Looks right? (yes/no)". */
export function readingText(r: Pick<RecipeReadingDraft, "name" | "kind" | "unit" | "min" | "max" | "options">): string {
  const name = r.name.trim() || "Reading";
  if (r.kind === "yesno") return `${name} (yes/no)`;
  if (r.kind === "choice") return `${name} (${(r.options ?? []).filter((o) => o.trim()).join(" / ") || "choose"})`;
  if (r.kind === "text") return `${name} (note)`;
  const u = r.unit.trim() ? ` ${r.unit.trim()}` : "";
  const mi = r.min.trim();
  const ma = r.max.trim();
  if (mi && ma) return `${name} ${mi}–${ma}${u}`;
  if (mi) return `${name} at least ${mi}${u}`;
  if (ma) return `${name} at most ${ma}${u}`;
  return `${name}${u ? ` (${u.trim()})` : ""}`;
}

/** What the operator will see: "Step 3 of 7 · Mix · Temperature 60–70 °C". */
export function stepPreviewLine(s: RecipeStepDraft, i: number, total: number): string {
  const parts = [`Step ${i + 1} of ${total}`, s.name.trim() || blockByKey(s.block).label];
  const isWait = s.stepKind === "curing" || s.stepKind === "hold";
  const m = isWait ? waitToMinutes(s.waitAmount, s.waitUnit) : null;
  if (m && !Number.isNaN(m)) parts.push(`Wait at least ${waitText(m)}`);
  for (const r of s.readings) parts.push(readingText(r));
  for (const c of s.checklist) if (c.requiresPhoto && c.text.trim()) parts.push(`Photo: ${c.text.trim()}`);
  if (s.needsCheck) parts.push(s.qaSigns ? "QA signs" : "Second person checks");
  return parts.join(" · ");
}

/** The wizard's whole state (also what "Copy from another recipe" and "Edit recipe" load). */
export type RecipeDraft = {
  productId: string;
  formulaId: string | null;
  routingId: string | null;
  batchKg: string;
  /** "Expected amount made" (theoretical yield, %). */
  expectedPct: string;
  view: AmountUnit;
  lines: RecipeLineDraft[];
  steps: RecipeStepDraft[];
  changeSummary: string;
  useFrom: string;
  formulaNotes: string;
  routingNotes: string;
  /** How the batch size is typed: kilograms, or pieces converted to kilograms (stored as kg; ADR-088 §4). */
  batchBy?: BatchBy;
  /** Pieces one batch makes, when by pieces. */
  pieces?: string;
  /** Grams per piece typed in the wizard, only when the product has none yet (saved to the product). */
  pieceG?: string;
  /** Wrappers, labels, bottles, boxes for each piece (recipe packaging lines, ADR-092). */
  packaging?: RecipePackagingDraft[];
};

/** Plain names of the areas a "Check the area is clean" step can be about (AREAS in schemas.ts). */
export const AREAS_WORDS: Record<string, string> = { weighing: "Weighing area", production: "Making area", packaging: "Packing area", filling: "Filling area", other: "Other area" };

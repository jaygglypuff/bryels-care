import Decimal from "decimal.js";
import { z } from "zod";

/**
 * ADR-137 "How is it added?" — the pure part shared by the recipe wizard (browser), the recipe and batch services, the
 * floor screens, the paper batch record and the BMR. No floating point: decimal.js only (ADR-010).
 *
 * Every recipe line keeps `quantity_g` = the planned amount in the material's STOCK unit (g, mL or pcs), whatever the
 * method. Planning, set-aside, what-to-buy and costing keep using it. The method says how the operator measures it:
 *
 * | method          | operator does                                   | judged in                         |
 * |-----------------|-------------------------------------------------|-----------------------------------|
 * | weigh           | weighs on the scale (unchanged)                 | stock unit, ± % or ± g            |
 * | count           | counts whole units (5 sachets)                  | units, exact or ± units / ± %     |
 * | volume          | measures mL with a jug or cylinder              | mL, ± mL or ± %                   |
 * | whole_container | adds the whole bag / drum / pail it scans       | number of containers (exact)      |
 * | as_needed       | adds until a reading is right (pH 5.0–5.5)      | the reading, and at most the max  |
 * | custom          | the writer's own way ("Scoop with spoon #3")    | its units (± units / ± %), or the |
 * |                 |                                                 | stock unit when "not measured"    |
 *
 * Stock is always posted in the stock unit: units × stock per unit (exact for count and whole containers; volume and
 * custom amounts are rounded half-up to 6 decimals of the stock unit, the precision of every quantity column).
 */

const D = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
type Num = Decimal.Value;

export const ADD_METHODS = ["weigh", "count", "volume", "whole_container", "as_needed", "custom"] as const;
export type AddMethod = (typeof ADD_METHODS)[number];
export const isAddMethod = (v: unknown): v is AddMethod => typeof v === "string" && (ADD_METHODS as readonly string[]).includes(v);

/** Grade-5 words for the method picker (wizard), the floor and the paper record. */
export const ADD_METHOD_WORDS: Record<AddMethod, { label: string; help: string; floorVerb: string }> = {
  weigh: { label: "Weigh it", help: "Put it on the scale and weigh it.", floorVerb: "Weigh" },
  count: { label: "Count it", help: "Add whole things, like 5 sachets or 2 bottles.", floorVerb: "Count" },
  volume: { label: "Measure it in mL", help: "Pour it into a jug or a measuring cylinder.", floorVerb: "Measure" },
  whole_container: { label: "Add the whole container", help: "Empty the whole bag, drum or pail into the mix.", floorVerb: "Add the whole container" },
  as_needed: { label: "Add until it is right", help: "Add a little at a time until a reading is right, like the pH.", floorVerb: "Add until it is right" },
  custom: { label: "My own way", help: "Give your own way a name, like \"Scoop with spoon #3\".", floorVerb: "Add" },
};

export const ROUNDING_RULES = ["up", "down", "nearest"] as const;
export type RoundingRule = (typeof ROUNDING_RULES)[number];
export const ROUNDING_WORDS: Record<RoundingRule, string> = { up: "round up", down: "round down", nearest: "round to the nearest" };

export const SCALING_RULES = ["proportional", "fixed", "proportional_round"] as const;
export type ScalingRule = (typeof SCALING_RULES)[number];

/** How an as-needed amount is recorded on the floor. */
export const RECORD_BY = ["weigh", "count", "volume"] as const;
export type RecordBy = (typeof RECORD_BY)[number];

const text = (max: number) => z.string().trim().max(max, `Use at most ${max} characters.`);
const decText = z.string().trim().regex(/^-?\d{1,9}(\.\d{1,6})?$/, "Type a number.");

/** Details stored in `bom_lines.method_spec` / `batch_materials.method_spec` (validated on every write). */
export const MethodSpecSchema = z
  .object({
    /** custom: the name of the way ("Scoop with measuring spoon #3"). */
    customName: text(80).optional(),
    /** as_needed: how the amount used is recorded. */
    recordBy: z.enum(RECORD_BY).optional(),
    /** as_needed: the reading that says "enough" (pH 5.0–5.5). */
    reading: z
      .object({ name: text(60).min(1, "Name the reading, for example pH."), unit: text(20), min: decText.nullable(), max: decText.nullable() })
      .strict()
      .optional(),
  })
  .strict();
export type MethodSpec = z.infer<typeof MethodSpecSchema>;

/** A method spec read back from jsonb (never trusted blindly: unknown shapes become {}). */
export function readSpec(v: unknown): MethodSpec {
  const r = MethodSpecSchema.safeParse(v ?? {});
  return r.success ? r.data : {};
}

/* ------------------------------------------------------------------ what a method measures in */

export type MethodFacts = {
  addMethod: string;
  methodUnit: string | null;
  methodUnitQty: string | null;
  methodSpec?: unknown;
};

/** The operator types units (not the stock unit): count, volume, whole container, measured custom, as-needed by count/volume. */
export function entersUnits(f: MethodFacts): boolean {
  if (f.addMethod === "count" || f.addMethod === "volume" || f.addMethod === "whole_container") return true;
  if (f.addMethod === "custom") return f.methodUnitQty !== null;
  if (f.addMethod === "as_needed") return readSpec(f.methodSpec).recordBy === "count" || readSpec(f.methodSpec).recordBy === "volume";
  return false;
}

/** Judged in method units (not in the stock unit): count, volume, whole container, measured custom. */
export function judgedInUnits(f: MethodFacts): boolean {
  return f.addMethod !== "as_needed" && entersUnits(f);
}

/** Units typed → stock units. Exact for whole units; otherwise rounded half-up to 6 decimals. */
export function unitsToStock(units: Num, perUnit: Num): Decimal {
  return new D(units).mul(perUnit).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}

/** Stock units → method units (for showing; 3 decimals). */
export function stockToUnits(stock: Num, perUnit: Num): Decimal {
  const p = new D(perUnit);
  return p.gt(0) ? new D(stock).div(p).toDecimalPlaces(3, Decimal.ROUND_HALF_UP) : new D(0);
}

/** Whole units only (count, whole container). */
export const WHOLE_UNIT_METHODS: readonly string[] = ["count", "whole_container"];

/* ------------------------------------------------------------------ scaling to a batch */

export type ScalableLine = {
  quantityG: string;
  scaling: string;
  rounding: string | null;
  addMethod: string;
  methodQty: string | null;
  methodUnitQty: string | null;
  maxQtyG?: string | null;
};

export type ScaledLine = {
  /** Planned amount in the stock unit for this batch. */
  targetG: Decimal;
  /** Planned amount in method units (null for weigh and not-measured custom). */
  methodTarget: Decimal | null;
  /** The exact scaled number before rounding, when the recipe rounds and it changed (shown, never silent). */
  roundedFrom: Decimal | null;
  /** As needed: the scaled maximum in the stock unit. */
  maxG: Decimal | null;
};

export class ScaleError extends Error {}

function roundWhole(v: Decimal, rule: string | null): Decimal {
  if (rule === "up") return v.toDecimalPlaces(0, Decimal.ROUND_UP);
  if (rule === "down") return v.toDecimalPlaces(0, Decimal.ROUND_DOWN);
  return v.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

/**
 * One recipe line scaled to a batch (factor = batch size ÷ recipe batch size). Fixed lines copy; proportional lines
 * multiply (6 decimals); `proportional_round` lines multiply the method units and round them to whole units by the
 * line's stated rule, then the stock amount follows the rounded units. A rounded result of 0 is refused (never added
 * silently as nothing).
 */
export function scaleLine(line: ScalableLine, factor: Num): ScaledLine {
  const f = new D(factor);
  const q = new D(line.quantityG);
  const perUnit = line.methodUnitQty !== null ? new D(line.methodUnitQty) : null;
  const units = line.methodQty !== null ? new D(line.methodQty) : null;
  const maxG = line.maxQtyG !== null && line.maxQtyG !== undefined ? new D(line.maxQtyG) : null;
  if (line.scaling === "fixed") {
    return { targetG: q, methodTarget: units, roundedFrom: null, maxG };
  }
  if (line.scaling === "proportional_round") {
    if (!units || !perUnit) throw new ScaleError("A rounded line needs its units.");
    const exact = units.mul(f).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
    const rounded = roundWhole(exact, line.rounding);
    if (rounded.lte(0)) throw new ScaleError(`This batch is too small: ${exact.toString()} rounds ${line.rounding ?? "nearest"} to 0.`);
    return { targetG: unitsToStock(rounded, perUnit), methodTarget: rounded, roundedFrom: rounded.eq(exact) ? null : exact, maxG: maxG ? maxG.mul(f).toDecimalPlaces(6) : null };
  }
  // proportional
  if (units && perUnit) {
    const mt = units.mul(f).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
    return { targetG: unitsToStock(mt, perUnit), methodTarget: mt, roundedFrom: null, maxG: maxG ? maxG.mul(f).toDecimalPlaces(6) : null };
  }
  return { targetG: q.mul(f).toDecimalPlaces(6), methodTarget: units ? units.mul(f).toDecimalPlaces(6) : null, roundedFrom: null, maxG: maxG ? maxG.mul(f).toDecimalPlaces(6) : null };
}

/** Sum of a line over several batches (production order requirements): each batch scales on its own. */
export function scaleLineOverBatches(line: ScalableLine, referenceBatchG: Num, batchSizesG: Num[]): Decimal {
  return batchSizesG.reduce<Decimal>((t, g) => t.plus(scaleLine(line, new D(g).div(referenceBatchG)).targetG), new D(0));
}

/* ------------------------------------------------------------------ judging what was added */

export type JudgeFacts = MethodFacts & {
  theoreticalQtyG: string;
  tolerancePct: string | null;
  toleranceAbsG: string | null;
  methodTargetQty: string | null;
  methodToleranceUnits: string | null;
  maxQtyG: string | null;
};

export type UnitWindow = { unit: string; target: Decimal; min: Decimal; max: Decimal };

/**
 * The OK window in method units for lines judged in units: target ± tolerance units, or ± the line's percentage of the
 * target. Exact decimals (no rounding: counted units are whole numbers).
 */
export function unitWindow(f: JudgeFacts): UnitWindow | null {
  if (!judgedInUnits(f) || f.methodTargetQty === null) return null;
  const target = new D(f.methodTargetQty);
  if (f.addMethod === "whole_container") return { unit: f.methodUnit ?? "container", target, min: target, max: target };
  const band = f.methodToleranceUnits !== null ? new D(f.methodToleranceUnits) : f.tolerancePct !== null ? target.mul(f.tolerancePct).div(100) : new D(0);
  const min = Decimal.max(target.minus(band), 0);
  return { unit: f.methodUnit ?? "", target, min, max: target.plus(band) };
}

export type Verdict = { kind: "ok" | "low" | "high"; by: Decimal };

/** Units total against the unit window. */
export function judgeUnits(w: UnitWindow, totalUnits: Num): Verdict {
  const t = new D(totalUnits);
  if (t.lt(w.min)) return { kind: "low", by: w.min.minus(t) };
  if (t.gt(w.max)) return { kind: "high", by: t.minus(w.max) };
  return { kind: "ok", by: new D(0) };
}

/** As needed: any amount above 0 up to the maximum (stock unit). */
export function judgeAsNeeded(maxG: Num, totalG: Num): Verdict {
  const t = new D(totalG);
  return t.gt(maxG) ? { kind: "high", by: t.minus(maxG) } : { kind: "ok", by: new D(0) };
}

/** The as-needed reading against its range ("5.2" within 5.0–5.5). Null when the value is not a number. */
export function readingWithin(spec: MethodSpec, raw: string): boolean | null {
  const v = raw.trim().replace(/,/g, "");
  if (!/^-?\d{1,9}(\.\d{1,6})?$/.test(v)) return null;
  const n = new D(v);
  const r = spec.reading;
  if (!r) return true;
  return (r.min === null || n.gte(r.min)) && (r.max === null || n.lte(r.max));
}

/* ------------------------------------------------------------------ words */

const n = (v: Num, dp = 3) => {
  const d = new D(v).toDecimalPlaces(dp);
  const [i, f] = d.toFixed().split(".");
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${f ? `.${f}` : ""}`;
};

/** "sachet" → "sachets" for counts other than 1 (only plain English words; "mL" and units with a dot never change). */
export function unitWord(unit: string, count: Num): string {
  const u = unit.trim();
  if (!u || u === "mL" || u === "L" || u === "g" || u === "kg" || u === "pcs" || /[^A-Za-z ]/.test(u)) return u;
  if (new D(count).eq(1)) return u;
  if (/(s|x|ch|sh)$/i.test(u)) return `${u}es`;
  if (/[^aeiou]y$/i.test(u)) return `${u.slice(0, -1)}ies`;
  return `${u}s`;
}

/** "5 sachets", "250 mL", "1 drum". */
export function unitsText(qty: Num, unit: string | null): string {
  return `${n(qty)} ${unitWord(unit ?? "", qty)}`.trim();
}

/** "5 sachets (125 g)" for a line in units; "125 g" for weigh. */
export function amountText(f: MethodFacts & { methodTargetQty: string | null; theoreticalQtyG: string }, baseUom: string): string {
  const base = `${n(f.theoreticalQtyG)} ${baseUom}`;
  if (f.methodTargetQty === null || !f.methodUnit || f.addMethod === "as_needed") return base;
  return `${unitsText(f.methodTargetQty, f.methodUnit)} (${base})`;
}

/** "Rounded up from 7.5 to 8 sachets (recipe rule)." */
export function roundedText(from: Num | null, to: Num | null, unit: string | null, rule: string | null): string | null {
  if (from === null || to === null) return null;
  const verb = rule === "down" ? "down" : rule === "up" ? "up" : "";
  return `Rounded ${verb ? `${verb} ` : ""}from ${n(from)} to ${unitsText(to, unit)} (recipe rule).`.replace("  ", " ");
}

/** "pH 5.0–5.5", "pH at least 5", "Thickness (looks right)". */
export function readingRangeText(spec: MethodSpec): string {
  const r = spec.reading;
  if (!r) return "";
  const u = r.unit ? ` ${r.unit}` : "";
  if (r.min !== null && r.max !== null) return `${r.name} ${r.min}–${r.max}${u}`;
  if (r.min !== null) return `${r.name} at least ${r.min}${u}`;
  if (r.max !== null) return `${r.name} at most ${r.max}${u}`;
  return r.name;
}

/** One line of what the operator will do: "Count 5 sachets", "Measure 250 mL", "Add until pH 5.0–5.5 (about 40 g, at most 80 g)". */
export function methodSentence(f: MethodFacts & { methodTargetQty: string | null; theoreticalQtyG: string; maxQtyG?: string | null }, baseUom: string): string {
  const spec = readSpec(f.methodSpec);
  switch (f.addMethod) {
    case "count":
      return `Count ${unitsText(f.methodTargetQty ?? "0", f.methodUnit)}`;
    case "volume":
      return `Measure ${unitsText(f.methodTargetQty ?? "0", "mL")}`;
    case "whole_container":
      return `Add ${f.methodTargetQty && !new D(f.methodTargetQty).eq(1) ? `${n(f.methodTargetQty)} whole ${unitWord(f.methodUnit ?? "container", f.methodTargetQty)}` : `the whole ${f.methodUnit ?? "container"}`}`;
    case "as_needed": {
      const by = spec.recordBy ?? "weigh";
      const about = by === "weigh" || !f.methodUnitQty ? `${n(f.theoreticalQtyG)} ${baseUom}` : unitsText(stockToUnits(f.theoreticalQtyG, f.methodUnitQty), by === "volume" ? "mL" : f.methodUnit);
      const most = f.maxQtyG ? (by === "weigh" || !f.methodUnitQty ? `${n(f.maxQtyG)} ${baseUom}` : unitsText(stockToUnits(f.maxQtyG, f.methodUnitQty), by === "volume" ? "mL" : f.methodUnit)) : null;
      return `Add until ${readingRangeText(spec) || "it is right"} (about ${about}${most ? `, at most ${most}` : ""})`;
    }
    case "custom":
      return f.methodUnitQty !== null && f.methodTargetQty !== null
        ? `${spec.customName ?? "Add"}: ${unitsText(f.methodTargetQty, f.methodUnit)}`
        : `${spec.customName ?? "Add"}: about ${n(f.theoreticalQtyG)} ${baseUom} (write what you used)`;
    default:
      return `Weigh ${n(f.theoreticalQtyG)} ${baseUom}`;
  }
}

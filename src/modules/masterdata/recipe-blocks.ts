import Decimal from "decimal.js";

/**
 * Guided "New recipe" wizard (ADR-086): the pure part shared by the browser and the server.
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
  /** "Allowed difference" when weighing: a percentage of the amount, or grams. */
  diffKind: "pct" | "g";
  diff: string;
  /** "Needs a second person to check the weighing" (bom_lines.requires_checker; used when the company checks marked lines, ADR-080 §4). */
  needsCheck: boolean;
  /** Kept as they were (advanced editing only). */
  phaseCode: string | null;
  scaling: "proportional" | "fixed";
  isCritical: boolean;
};

/** Grams of one line for a batch size (exact). Empty or invalid amounts count as 0. */
export function lineGrams(batchG: Num, l: Pick<RecipeLineDraft, "amount" | "src">): string {
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

/** Totals of the ingredient lines against the batch size (exact in grams; percent shown to 4 decimals). */
export function recipeTotals(batchG: Num, lines: Pick<RecipeLineDraft, "amount" | "src">[]): RecipeTotals {
  const b = new Dx(batchG);
  const total = lines.reduce((acc, l) => acc.plus(lineGrams(b, l)), new Dx(0));
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

/** Input of saveFormulaRevisionDraft for these lines (grams per reference batch, exact). */
export function toBomLineInputs(batchG: Num, lines: RecipeLineDraft[]) {
  return lines.map((l) => ({
    materialId: l.materialId,
    quantityG: lineGrams(batchG, l),
    tolerancePct: l.diffKind === "pct" ? l.diff.trim() || null : null,
    toleranceAbsG: l.diffKind === "g" ? l.diff.trim() || null : null,
    phaseCode: l.phaseCode,
    scaling: l.scaling,
    isCritical: l.isCritical,
    requiresChecker: l.needsCheck,
  }));
}

/** Stored bom lines → wizard lines, typed in grams. */
export function fromBomLines(
  rows: { materialId: string; quantityG: string; tolerancePct: string | null; toleranceAbsG: string | null; phaseCode: string | null; scaling: string; isCritical: boolean; requiresChecker: boolean }[],
): RecipeLineDraft[] {
  return rows.map((r) => ({
    materialId: r.materialId,
    amount: plain(r.quantityG),
    src: "g",
    diffKind: r.toleranceAbsG !== null ? "g" : "pct",
    diff: r.toleranceAbsG !== null ? plain(r.toleranceAbsG) : r.tolerancePct !== null ? plain(r.tolerancePct) : "",
    needsCheck: r.requiresChecker,
    phaseCode: r.phaseCode,
    scaling: r.scaling === "fixed" ? "fixed" : "proportional",
    isCritical: r.isCritical,
  }));
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
export function blockFor(stepKind: string, name: string): RecipeBlockKey {
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
  /** number = a measured number with a unit; yesno = a yes/no answer; text = a short note. */
  kind: "number" | "yesno" | "text";
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
};

export const emptyKeep = (): RecipeStepDraft["keep"] => ({ code: null, workInstructionRevisionId: null, blocksUntilComplete: true, requiresEquipment: false, equipmentKind: null });

/** A new step from a block, with the block's usual reading (empty limits). */
export function newStep(key: RecipeBlockKey): RecipeStepDraft {
  const b = blockByKey(key);
  const reading = "reading" in b ? b.reading : null;
  return {
    block: b.key,
    stepKind: b.stepKind,
    name: b.key === "other" ? "" : b.label.replace(" / ", " and "),
    instruction: "",
    // Only weighing starts with a second-person check (owner usability test); the author changes it per step.
    needsCheck: b.key === "weigh",
    waitAmount: "",
    waitUnit: "days",
    area: b.key === "clean" ? "production" : "",
    checklist: [],
    readings: reading ? [{ name: reading.name, kind: "number", unit: reading.unit, min: "", max: "", target: "", code: "", required: true }] : [],
    keep: emptyKeep(),
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
        return {
          code: r.code.trim() || readingCode(r.name, j, taken),
          name: r.name.trim(),
          valueKind: numeric ? "numeric" : r.kind === "yesno" ? "boolean" : "text",
          uom: numeric ? blank(r.unit) : null,
          minValue: numeric ? blank(r.min) : null,
          targetValue: numeric ? blank(r.target) : null,
          maxValue: numeric ? blank(r.max) : null,
          isRequired: r.required,
        };
      }),
      checklistItems: s.checklist.filter((c) => c.text.trim()).map((c) => ({ text: c.text.trim(), requiresPhoto: c.requiresPhoto, isBlocking: c.isBlocking })),
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
    parameters: { code: string; name: string; valueKind: string; uom: string | null; minValue: string | null; targetValue: string | null; maxValue: string | null; isRequired: boolean }[];
    checklistItems: { text: string; requiresPhoto: boolean; isBlocking: boolean }[];
  }[],
): RecipeStepDraft[] {
  return steps.map((s) => {
    const w = minutesToWait(s.minDurationMinutes);
    return {
      block: blockFor(s.stepKind, s.name),
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
        kind: p.valueKind === "numeric" ? "number" : p.valueKind === "boolean" ? "yesno" : "text",
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
export function readingText(r: Pick<RecipeReadingDraft, "name" | "kind" | "unit" | "min" | "max">): string {
  const name = r.name.trim() || "Reading";
  if (r.kind === "yesno") return `${name} (yes/no)`;
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
  if (s.needsCheck) parts.push("Second person checks");
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
};

/** Plain names of the areas a "Check the area is clean" step can be about (AREAS in schemas.ts). */
export const AREAS_WORDS: Record<string, string> = { weighing: "Weighing area", production: "Making area", packaging: "Packing area", filling: "Filling area", other: "Other area" };

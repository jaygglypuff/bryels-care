import Decimal from "decimal.js";

/**
 * Words and numbers on the printed batch record (live check 2026-11-06, finding 3): quantities with their unit and
 * the decimals they need ("120 pcs", "50 °C", "16,200.35 g"), signed differences with a real minus ("−0.35 g
 * (0.00 %)"), ranges and tolerances in plain words, step kinds and output kinds as words. Used by the BMR dataset
 * builder (bmr.ts); a printed document keeps its frozen dataset, so these words reach new BMRs only. Pure and
 * deterministic (no locale lookups at render time beyond the en-PH grouping), unit-tested in tests/unit/bmr-words.test.ts.
 */

const MINUS = "−";

/** "16,200.35" / "120" / "0.5": up to `maxDp` decimals, trailing zeros dropped, thousands grouped. */
export function num(v: Decimal.Value | null | undefined, maxDp = 2): string {
  if (v === null || v === undefined || v === "") return "";
  const d = new Decimal(v).toDecimalPlaces(maxDp);
  const [int, frac] = d.abs().toFixed().split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${d.isNeg() && !d.isZero() ? MINUS : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

/** "120 pcs", "50 °C", "16,200.35 g"; no unit → the number alone. */
export function qty(v: Decimal.Value | null | undefined, uom?: string | null, maxDp = 2): string {
  const n = num(v, maxDp);
  if (!n) return "";
  return uom ? `${n} ${uom}` : n;
}

/** A difference with its sign: "−0.35 g", "+2 pcs", "0 g". */
export function signedQty(v: Decimal.Value, uom?: string | null, maxDp = 2): string {
  const d = new Decimal(v).toDecimalPlaces(maxDp);
  const n = num(d, maxDp);
  return `${d.gt(0) ? "+" : ""}${n}${uom ? ` ${uom}` : ""}`;
}

/** "0.00 %" with exactly two decimals and a real minus. */
export function pct2(v: Decimal.Value | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const d = new Decimal(v).toDecimalPlaces(2);
  return `${d.isNeg() && !d.isZero() ? MINUS : ""}${d.abs().toFixed(2)} %`;
}

/** "95 %" / "95.5 %". */
export function pct(v: Decimal.Value | null | undefined, maxDp = 1): string {
  return v === null || v === undefined || v === "" ? "" : `${num(v, maxDp)} %`;
}

/** A reading's OK range in words: "40 – 60", "at least 40", "at most 60", "target 50"; "—" without limits. */
export function rangeWords(min: string | null, target: string | null, max: string | null): string {
  const lo = min !== null && min !== "" ? num(min, 3) : null;
  const hi = max !== null && max !== "" ? num(max, 3) : null;
  const t = target !== null && target !== "" ? num(target, 3) : null;
  const range = lo && hi ? `${lo} – ${hi}` : lo ? `at least ${lo}` : hi ? `at most ${hi}` : null;
  return [range, t ? `target ${t}` : null].filter(Boolean).join(", ") || "—";
}

/** A weighing tolerance in words: "3,579.1 to 3,651.4 g (± 1 %)" / "495 to 505 g (± 5 g)". */
export function toleranceWords(min: Decimal.Value, max: Decimal.Value, pctTol: Decimal.Value | null, absG: Decimal.Value | null): string {
  const by = absG !== null && absG !== undefined && absG !== "" ? `± ${num(absG, 3)} g` : `± ${num(pctTol ?? 0, 2)} %`;
  return `${num(min, 1)} to ${num(max, 1)} g (${by})`;
}

/** Packaging tolerance in words: "none allowed" for 0, else "up to 2 pcs". */
export function packagingToleranceWords(tolerance: Decimal.Value | null | undefined, uom: string): string {
  const t = new Decimal(tolerance ?? 0);
  return t.lte(0) ? "none allowed" : `up to ${qty(t, uom, 3)}`;
}

/** A step kind as a word ("line_clearance" → "Clean-area check"). Unknown kinds: the key in words. */
export const STEP_KIND_WORD: Record<string, string> = {
  line_clearance: "Clean-area check",
  dispensing: "Weighing",
  weighing: "Weighing",
  process: "Making",
  curing: "Waiting (curing)",
  cooling: "Waiting (cooling)",
  wait: "Waiting",
  cutting: "Cutting",
  filling: "Filling",
  packaging: "Packing and labels",
  transfer: "Move to the hold area",
  inspection: "In-process check",
};
export function stepKindWord(kind: string): string {
  return STEP_KIND_WORD[kind] ?? cap(kind.replace(/_/g, " "));
}

/** What a batch output is ("finished" → "Finished product"). */
export const OUTPUT_KIND_WORD: Record<string, string> = { finished: "Finished product", by_product: "By-product", rework: "For rework", scrap: "Scrap", sample: "Sample" };
export function outputKindWord(kind: string): string {
  return OUTPUT_KIND_WORD[kind] ?? cap(kind.replace(/_/g, " "));
}

export const cap = (t: string) => (t ? t[0]!.toUpperCase() + t.slice(1) : t);

/** "120 made = 118 in 5 boxes + 2 bars kept by QA as samples" (part 4: why fewer pieces are boxed than made). */
export function madeVsBoxedWords(made: Decimal.Value, boxed: Decimal.Value, boxes: number, samples: Decimal.Value, pieceWord: string, loose: Decimal.Value = 0): string {
  const parts = [`${num(boxed, 0)} in ${boxes} ${boxes === 1 ? "box" : "boxes"}`];
  if (new Decimal(samples).gt(0)) parts.push(`${num(samples, 0)} ${new Decimal(samples).eq(1) ? singular(pieceWord) : pieceWord} kept by QA as samples`);
  if (new Decimal(loose).gt(0)) parts.push(`${num(loose, 0)} not boxed`);
  return `${num(made, 0)} made = ${parts.join(" + ")}`;
}
const singular = (w: string) => (w.endsWith("s") ? w.slice(0, -1) : w);

/** Location codes in a recorded note ("Posted to QUA-01") replaced by the place name ("Posted to QA waiting area (QUA-01)"). */
export function placeNamesInText(text: string, places: ReadonlyMap<string, string>): string {
  if (!places.size) return text;
  const codes = [...places.keys()].sort((a, b) => b.length - a.length).map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return text.replace(new RegExp(`\\b(${codes.join("|")})\\b`, "g"), (c) => `${places.get(c)} (${c})`);
}

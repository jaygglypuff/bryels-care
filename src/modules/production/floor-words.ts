import Decimal from "decimal.js";

/**
 * Round 5 floor words (ADR-130): numbers without trailing zeros, the weighing unit, and the plain sentences for a
 * reading that is missing or outside its range. Pure functions, shared by services and screens (no "server-only").
 */

/** "90.000000" → "90", "17919" → "17,919", "17.9190" → "17.919". Decimal only, never floating point. */
export function plainNumber(v: Decimal.Value | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  let d: Decimal;
  try {
    d = new Decimal(typeof v === "string" ? v.replace(/,/g, "") : v);
  } catch {
    return String(v);
  }
  const neg = d.isNeg() && !d.isZero();
  const [int, frac = ""] = d.abs().toFixed().split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const f = frac.replace(/0+$/, "");
  return `${neg ? "-" : ""}${grouped}${f ? `.${f}` : ""}`;
}

/**
 * The unit the operator types on the Weigh card (round 5 problem 4). Materials kept in grams are weighed in kg
 * when the amount is 1 kg or more (a platform scale shows kg), else in grams. Stored amounts stay in grams.
 * Assumption A-WGH-UNIT-01: until a scale record carries its own display unit, the amount decides.
 */
export function weighUnitFor(baseUom: string, targetBase: Decimal.Value): string {
  if (baseUom !== "g") return baseUom;
  return new Decimal(targetBase || 0).gte(1000) ? "kg" : "g";
}

/** Base grams → the weighing unit, as a plain string for the keypad ("17.919"). */
export function inWeighUnit(baseQty: Decimal.Value, baseUom: string, unit: string): Decimal {
  const d = new Decimal(baseQty || 0);
  return baseUom === "g" && unit === "kg" ? d.div(1000) : d;
}

type Limits = { name: string; uom: string | null; minValue: string | null; maxValue: string | null; valueKind: string };

const withUnit = (n: string, uom: string | null) => (uom ? `${n} ${uom}` : n);

/**
 * A reading outside its range in one plain sentence (round 5 B3):
 * "90 °C is above the 75 °C limit. Check again. If it is right, say why."
 */
export function outOfRangeSentence(p: Limits, value: string | number | null): string {
  if (p.valueKind === "boolean") return `${p.name}: the answer must be yes. Check again. If it is right, say why.`;
  if (value === null || value === undefined || p.valueKind !== "numeric") return `${p.name} is outside the range. Check again. If it is right, say why.`;
  const v = plainNumber(value);
  let d: Decimal | null = null;
  try {
    d = new Decimal(String(value).replace(/,/g, ""));
  } catch {
    d = null;
  }
  if (d && p.maxValue !== null && d.gt(p.maxValue)) return `${withUnit(v, p.uom)} is above the ${withUnit(plainNumber(p.maxValue), p.uom)} limit. Check again. If it is right, say why.`;
  if (d && p.minValue !== null && d.lt(p.minValue)) return `${withUnit(v, p.uom)} is below the ${withUnit(plainNumber(p.minValue), p.uom)} limit. Check again. If it is right, say why.`;
  return `${withUnit(v, p.uom)} is outside the range. Check again. If it is right, say why.`;
}

/** An empty required field (round 5 B4): "Type the Mix temperature (°C). Nothing was saved." */
export function missingReadingSentence(p: { name: string; uom: string | null }): string {
  return `Type the ${p.name}${p.uom ? ` (${p.uom})` : ""} first.`;
}

/** The range for a hint under the field: "OK 65–75 °C". */
export function rangeWords(p: Limits): string | null {
  if (p.valueKind !== "numeric" || (p.minValue === null && p.maxValue === null)) return null;
  if (p.minValue !== null && p.maxValue !== null) return `OK ${plainNumber(p.minValue)}–${plainNumber(p.maxValue)}${p.uom ? ` ${p.uom}` : ""}`;
  return p.minValue !== null ? `OK from ${withUnit(plainNumber(p.minValue), p.uom)}` : `OK up to ${withUnit(plainNumber(p.maxValue), p.uom)}`;
}

/**
 * Short reasons for changing a saved value (round 5 B3): tapped, not typed. "Other" asks for a few words. The
 * service keeps its rule (at least 5 characters); every choice is longer than that.
 */
export const CORRECTION_REASONS = [
  { code: "typed_wrong", label: "I typed it wrong" },
  { code: "measured_again", label: "I measured again" },
  { code: "other", label: "Other reason" },
] as const;

/** The stored correction reason from a tapped choice and the optional words ("I measured again: thermometer cold"). */
export function correctionReasonText(code: string | null | undefined, note: string | null | undefined): string | null {
  const n = (note ?? "").trim();
  const c = CORRECTION_REASONS.find((r) => r.code === code);
  if (!c) return n || null;
  if (c.code === "other") return n ? `Other: ${n}` : null;
  return n ? `${c.label}: ${n}` : c.label;
}

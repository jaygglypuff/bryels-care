import Decimal from "decimal.js";

/**
 * Friendly units for the warehouse screens (usability test 2026-10-30: "50" saved as 50 g of palm oil).
 *
 * Items are stored in a base unit (g, mL or pcs; ADR-010). People think in kg, L and pieces, so every
 * warehouse quantity box offers the friendly unit first and accepts "20 kg" typed into the box. The
 * conversion to the base unit is done again on the SERVER with these functions (decimal.js, never
 * floating point); a unit that is not kg/g, L/mL or pcs, or one of another kind than the item's base
 * unit, is refused. Pure and client-safe; the server wrapper is `qtyInputToBase` in
 * src/modules/inventory/units.ts. These are SI facts (1 kg = 1,000 g), not business rules.
 */

const FACTOR: Record<string, { base: string; factor: string }> = {
  kg: { base: "g", factor: "1000" },
  g: { base: "g", factor: "1" },
  L: { base: "mL", factor: "1000" },
  mL: { base: "mL", factor: "1" },
  pcs: { base: "pcs", factor: "1" },
};

const ALIASES: Record<string, string> = {
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  g: "g", gr: "g", gram: "g", grams: "g",
  l: "L", lt: "L", ltr: "L", liter: "L", liters: "L", litre: "L", litres: "L",
  ml: "mL", milliliter: "mL", milliliters: "mL", millilitre: "mL", millilitres: "mL",
  pc: "pcs", pcs: "pcs", piece: "pcs", pieces: "pcs",
};

/** "KG", "kilos" → "kg"; "l" → "L"; "ml" → "mL"; unknown → null. */
export function normalizeUnit(u: string | null | undefined): string | null {
  const k = String(u ?? "").trim().toLowerCase().replace(/\.$/, "");
  return k ? (ALIASES[k] ?? null) : null;
}

/** Base unit of a (normalized) unit: kg → g, L → mL, pcs → pcs; unknown → null. */
export function baseOfUnit(u: string | null | undefined): string | null {
  const n = normalizeUnit(u);
  return n ? FACTOR[n].base : null;
}

/** Units offered in the picker for an item counted in `baseUom`; the friendly one first. */
export function unitChoices(baseUom: string): string[] {
  if (baseUom === "g") return ["kg", "g"];
  if (baseUom === "mL") return ["L", "mL"];
  return [baseUom];
}

/** The unit a person would use: kg for gram items, L for millilitre items, else the base unit. */
export function friendlyUnit(baseUom: string): string {
  return baseUom === "g" ? "kg" : baseUom === "mL" ? "L" : baseUom;
}

/** Friendly unit for one amount: under 1 kg (1 L) stays in g (mL). */
export function friendlyUnitFor(qtyBase: Decimal.Value, baseUom: string): string {
  const d = new Decimal(qtyBase);
  if ((baseUom === "g" || baseUom === "mL") && d.abs().lt(1000) && !d.isZero()) return baseUom;
  return friendlyUnit(baseUom);
}

/** "20 kg" → { qty: "20", unit: "kg" }; "1,500" → { qty: "1500", unit: null }; not a number → null. */
export function parseQtyText(text: string | null | undefined): { qty: string; unit: string | null } | null {
  const m = /^\s*(-?[0-9][0-9,]*(?:\.[0-9]+)?|-?\.[0-9]+)\s*([a-zA-Z.]+)?\s*$/.exec(String(text ?? ""));
  if (!m) return null;
  const qty = m[1].replace(/,/g, "");
  return { qty: qty.startsWith(".") ? `0${qty}` : qty.startsWith("-.") ? `-0${qty.slice(1)}` : qty, unit: m[2] ? m[2] : null };
}

function allowedText(baseUom: string) {
  const c = unitChoices(baseUom);
  return c.length > 1 ? c.join(" or ") : c[0];
}

export type BaseQtyResult = { ok: true; qtyBase: Decimal; unit: string } | { ok: false; message: string };

/**
 * Typed amount (+ the picker's unit) → base quantity. A unit typed in the box ("20 kg") wins over the
 * picker. Zero is allowed (a count of nothing); callers that need > 0 check it themselves.
 */
export function toBaseQty(text: string | null | undefined, pickerUnit: string | null | undefined, baseUom: string): BaseQtyResult {
  const p = parseQtyText(text);
  if (!p) return { ok: false, message: `Enter an amount like 20 or 12.5 (${allowedText(baseUom)}).` };
  const typed = p.unit ?? (pickerUnit && String(pickerUnit).trim() ? String(pickerUnit) : null);
  const unit = typed === null ? baseUom : normalizeUnit(typed) ?? (FACTOR[typed] ? typed : null);
  if (!unit || !FACTOR[unit] || FACTOR[unit].base !== baseUom) {
    return { ok: false, message: `"${typed}" is not a unit for this item. It is counted in ${allowedText(baseUom)}.` };
  }
  let q: Decimal;
  try {
    q = new Decimal(p.qty);
  } catch {
    return { ok: false, message: "Enter an amount like 20 or 12.5." };
  }
  if (!q.isFinite() || q.isNeg()) return { ok: false, message: "The amount cannot be less than zero." };
  if (q.decimalPlaces() > 6) return { ok: false, message: "Use at most 6 digits after the point." };
  const base = q.times(FACTOR[unit].factor);
  if (base.decimalPlaces() > 6 || base.gt("999999999999")) return { ok: false, message: "This amount is too precise or too large." };
  return { ok: true, qtyBase: base, unit };
}

/** Base quantity → text in `unit` for a quantity box ("60000" g in kg → "60"). */
export function baseToUnitText(qtyBase: Decimal.Value, baseUom: string, unit: string): string {
  const f = FACTOR[unit];
  if (!f || f.base !== baseUom) return new Decimal(qtyBase).toString();
  return new Decimal(qtyBase).div(f.factor).toDecimalPlaces(6).toString();
}

/** "60000" g → "60 kg"; "250" g → "250 g"; "2880" pcs → "2,880 pcs". Decimal-safe, at most 3 decimals. */
export function fmtFriendly(qtyBase: Decimal.Value, baseUom: string): string {
  let d = new Decimal(qtyBase);
  let u = baseUom;
  if ((baseUom === "g" || baseUom === "mL") && d.abs().gte(1000)) {
    d = d.div(1000);
    u = baseUom === "g" ? "kg" : "L";
  }
  const dp = d.isInteger() ? 0 : Math.min(d.decimalPlaces(), 3);
  const [int, rawFrac] = d.toFixed(dp).split(".");
  const frac = rawFrac?.replace(/0+$/, "");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${frac ? `${grouped}.${frac}` : grouped} ${u}`;
}

/**
 * Is a received amount out of line with the item's standard pack (ADR-076) or its past receipts?
 * Returns the unit that would make it normal ("50 g" → "kg") or null when nothing to ask. Only gram and
 * millilitre items can mix up units; the reference is the standard pack, else the median of past receipts.
 * More than 20× smaller or larger than the reference counts as unusual.
 */
export function unusualAmount(a: {
  qtyBase: Decimal.Value;
  baseUom: string;
  typedQty: string;
  typedUnit: string;
  packQtyBase: Decimal.Value | null;
  pastQtyBase: Decimal.Value[];
}): { suggestUnit: string; suggestBase: Decimal; referenceBase: Decimal } | null {
  if (a.baseUom !== "g" && a.baseUom !== "mL") return null;
  const q = new Decimal(a.qtyBase);
  if (q.lte(0)) return null;
  let ref: Decimal | null = a.packQtyBase !== null && a.packQtyBase !== undefined ? new Decimal(a.packQtyBase) : null;
  if (!ref || ref.lte(0)) {
    const past = a.pastQtyBase.map((x) => new Decimal(x)).filter((x) => x.gt(0)).sort((x, y) => x.comparedTo(y));
    ref = past.length ? past[Math.floor(past.length / 2)] : null;
  }
  if (!ref || ref.lte(0)) return null;
  const ratio = q.div(ref);
  const big = friendlyUnit(a.baseUom);
  const typedUnit = normalizeUnit(a.typedUnit) ?? a.baseUom;
  const typed = parseQtyText(a.typedQty);
  if (!typed) return null;
  const n = new Decimal(typed.qty);
  if (ratio.lt(new Decimal(1).div(20)) && typedUnit === a.baseUom) {
    return { suggestUnit: big, suggestBase: n.times(1000), referenceBase: ref };
  }
  if (ratio.gt(20) && typedUnit === big) {
    return { suggestUnit: a.baseUom, suggestBase: n, referenceBase: ref };
  }
  return null;
}
